# Roadmap: Folders, Notion migration, and cross-device sync (no auth)

## Context

Noteato currently stores notes as a flat directory of `.md` files with hand-rolled
YAML-ish frontmatter (`src/main/storage.ts`, `src/main/frontmatter.ts`) — no
database, no lock-in, by design. Two planned features both build on the same
underlying gap (no folder concept exists at all today):

1. **Folder support**, so notes can be organized hierarchically, and a
   **Notion migration path** that imports an exported Notion workspace
   (pages → notes, page hierarchy → folders) on top of it.
2. **Cross-device sync with no login/auth** — i.e. no account system, no
   server Noteato operates. The existing `notes:chooseFolder` picker already
   lets a user point the notes directory anywhere; the plan is to make Noteato a
   well-behaved citizen of a folder that's *already* synced by
   infrastructure the user owns (iCloud Drive, Dropbox, Syncthing), rather
   than building a sync transport/protocol from scratch.

This was validated with a Plan-agent review against the actual current code
(`storage.ts`, `NoteEditor.tsx`, `MainLayout.tsx`). Two real correctness gaps
surfaced that reshape the design below — both are addressed as first-class
work, not follow-ups:

- **Stale open-tab paths.** `NoteEditor` caches `note.filename` in its own
  state after the initial load and never re-syncs it from props (`MainLayout`
  deliberately doesn't push filename changes into open tabs — see its comment
  on `handleNoteSaved`). Once a note can move (via a folder move, a folder
  rename, or an external rename synced in from another device) while its tab
  is open, the next autosave calls `notes:save(oldPath, ...)`, which does
  `read(oldPath)` first and throws `ENOENT` — silently losing the edit via an
  unhandled rejection. This needs a real fix (self-healing lookup by `id`),
  not a workaround, because **both** features trigger it.
- **`NoteStore.save()` has no optimistic-concurrency check today** — it reads
  the existing file, then unconditionally overwrites it with a fresh
  `updatedAt`. That's the actual data-loss hole cross-device sync needs
  closed; the file watcher is a UX nicety on top, not the safety net.

Given the pre-existing "simple, fast, no bloat" bias in this codebase (BYOK
AI added as thin SDK wrappers, no frameworks), the guiding principle for both
features is: **extend the filesystem model, don't replace it.** No folder
database entity, no sync server, no CRDT/merge engine.

---

## Phase 1 — Folder support (foundation)

**Model:** the filesystem is the only source of truth. `NoteSummary.filename`
becomes "path relative to `notesDir`" everywhere (can contain `/`) instead of
a bare filename — `pathFor()`'s existing `join(notesDir, filename)` already
handles nested paths for free. No new field is added to frontmatter; a
note's folder is simply where its file lives.

### `src/main/storage.ts`
- `list()`: replace the non-recursive `readdirSync` with a recursive walk
  (`readdirSync(dir, { withFileTypes: true })`, recursing into directories,
  skipping dotfiles/`.git`/symlinks), collecting `.md` files as
  `notesDir`-relative paths.
- `create(title, folder?)`: write into `join(notesDir, folder ?? '', file)`,
  `mkdirSync(..., { recursive: true })` as needed.
- `save()`: fix the rename-on-title-change path to preserve
  `dirname(filename)` instead of assuming root — currently it always computes
  `desiredFilename` at the top level.
- Add `createFolder(relativePath)`, `renameFolder(oldPath, newPath)`,
  `deleteFolder(relativePath)`, `moveNote(filename, newFolder)`. All resolve
  the target path and verify it stays within `notesDir` (reject `..`
  traversal) before touching the filesystem.
- **Self-healing lookup by `id`**: `read()`/`save()` take the given path as a
  hint, not gospel — on `ENOENT`, fall back to a scan of `list()` matching
  `meta.id`, and return the corrected path to the caller. This is the fix for
  the stale-open-tab problem, and Phase 2's sync watcher reuses it directly.
- Fix `setNotesDir()`: it currently only migrates top-level `.md` files
  (`readdirSync(this.notesDir).filter(f => f.endsWith('.md'))`, non-recursive)
  — once folders exist this silently strands every subfolder. Make it a
  recursive tree move with per-file (not per-directory) collision handling.

### `src/main/index.ts` / `src/preload/*`
- New IPC handlers + `window.api.notes.*` methods for the folder CRUD above,
  plus a `notes:listFolders` call (or derive folders client-side from the
  flat list — but empty folders need explicit tracking since they wouldn't
  otherwise appear, so a real listing call is simpler).
- `notes:save`/`notes:read` responses include the corrected path when a
  self-heal occurred, so the renderer can update its cached filename.

### `src/renderer/src/components/Sidebar.tsx`
- Flat `<ul>` → recursive collapsible tree, built by grouping the flat
  `NoteSummary[]` by path segments plus the separate folder listing (for
  empty folders). Expand/collapse state can live in `localStorage` next to
  the existing `noteato:sidebarCollapsed` key.
- Context menu (right-click or a hover `⋯` button, matching the existing
  hover-reveal pattern already used for the delete button) for New Folder /
  Rename / Move / Delete. **No drag-and-drop in v1** — explicitly deferred.
- Explicit decision, not an accident: if a note and folder resolve to the
  same display name at the same level (this *will* happen with Notion
  import — see Phase 3), render them as normal siblings; don't attempt
  dedup/merge.

### `src/renderer/src/components/MainLayout.tsx` / `NoteEditor.tsx`
- Wire the self-heal: when a save response reports a corrected path, update
  the tab's/editor's cached filename in place (this is the actual fix, not
  just error-swallowing).
- Closing/reassigning tabs when their containing folder is deleted.

**Risk ranking:** recursive `list`/`create`/save-rename fix — straightforward.
`setNotesDir` recursive migration — medium. Sidebar tree rewrite — the most
code, but mechanical. The stale-path self-heal is the one piece to design
carefully before starting the Sidebar work.

---

## Phase 2 — Cross-device sync without login/auth

No sync transport is built. Noteato's job is: don't corrupt data when the notes
folder changes underneath it (because some other synced device wrote to it),
and don't silently overwrite someone else's newer edit.

### `src/main/storage.ts`
- Wrap each per-file read in `toSummary()`/`list()` in try/catch — a single
  unreadable file (mid-sync, or an iCloud Drive on-demand-download
  placeholder) currently throws and kills the *entire* list. Skip and
  continue; it'll reappear once sync settles. This is a correctness fix
  needed regardless of sync, and becomes load-bearing once we're actively
  recommending a live-syncing folder.
- **Optimistic concurrency in `save()` — the actual safety net.** Thread a
  `baseUpdatedAt` through `SaveOptions` (the `updatedAt` the renderer started
  editing from). Inside `save()`, compare it against the freshly-read
  `existing.updatedAt`; if they differ, someone else wrote to this file since
  we last read it — don't overwrite. Instead:
  - Write the local (in-memory) version to a sibling
    `Title (conflict YYYY-MM-DD HHmm).md` file, **with a freshly minted
    `id`/`createdAt`** (reusing the same file verbatim would duplicate the
    `id`, which both `Sidebar` (`key={note.id}`) and `MainLayout`'s tab
    matching (`tabs.some(t => t.id === note.id)`) assume is unique — a
    duplicate makes the second note un-openable from the sidebar).
  - Return a conflict signal so the caller reloads the tab from the
    now-authoritative on-disk version and shows a toast (reuse the existing
    `ai-error-toast` pattern already in `NoteEditor.tsx` for the styling/copy).
  - This is the actual guard against the real race: Device A saves, Device B
    (tab open, clean, watcher hasn't fired yet) types one character and its
    own debounce fires — without this check, B unconditionally overwrites A.
    The watcher below is a proactive-refresh nicety for *unopened-edit* tabs,
    not the safety net.

### `src/main/watcher.ts` (new)
- Native `fs.watch(notesDir, { recursive: true }, ...)`, debounced ~300-500ms
  to coalesce multi-step sync-client writes. **Recursive `fs.watch` is
  macOS/Windows-only (FSEvents/ReadDirectoryChangesW) — fine here, since
  Noteato only ships for macOS** (`electron-builder --mac` in `package.json`),
  so no `chokidar` dependency is needed to cover this.
- Lifecycle tied to `setNotesDir()` changes (re-watch the new dir) and app
  quit (close the watcher).
- Emits an IPC event to the renderer on change (mirror the existing
  `shortcuts.subscribe` pattern in `src/preload/index.ts` for the
  subscribe/unsubscribe shape).

### `src/renderer/src/components/MainLayout.tsx` / `NoteEditor.tsx`
- Subscribe to the watcher event → `refreshNotes()`.
- Real dirty-state in `NoteEditor` (currently only an implicit, transient
  save-debounce timer) — needed so the app can tell "has this tab changed
  since it last matched disk" for both the conflict check and to decide
  whether an external delete of the open note should just close the tab
  (clean) or fall back to the conflict-copy path (dirty).
- External delete of a file with a clean open tab → close it with a toast.

### `src/renderer/src/components/SettingsModal.tsx`
- One-line hint under the Storage section: "To sync across devices, point
  this folder at a location synced by iCloud Drive, Dropbox, or Syncthing."
  No new settings fields — Noteato adds zero network code.
- Dropbox/iCloud's own auto-generated "...conflicted copy..." files will
  already show up as ordinary (oddly-named) notes via the existing `list()`
  — no extra code needed, but note this is a *third-party* conflict copy, so
  it carries the original `id` and inherits the same duplicate-`id` caveat;
  document it as a known limitation rather than solving it.

**Risk ranking:** try/catch robustness — trivial, do regardless. Watcher IPC
plumbing — mechanical. **`save()`'s optimistic-concurrency + conflict-copy
logic is the crux of this feature** and deserves explicit two-device testing
before considering it done.

---

## Phase 3 — Notion migration (built on Phase 1)

Source: the user runs Notion's own "Export → Markdown & CSV," unzips it
(Finder auto-unzips downloads). Noteato does **not** parse `.zip` directly — a
native folder picker (`dialog.showOpenDialog({ properties: ['openDirectory'] })`)
avoids adding a zip-handling dependency.

**Note:** the exact Notion export format below is from general knowledge, not
verified against a live export in this session — **treat pulling one real
Notion export and inspecting it as step zero**, before finalizing the
regexes.

### Two-pass import (in main process, new `src/main/notionImport.ts`)

A single deterministic "strip the trailing Notion hash" transform applied
independently to folder names, filenames, and link targets was the first
design — a Plan review caught two reasons that breaks and a real mapping
table is needed instead:
1. Title selection isn't the same transform as hash-stripping (title prefers
   the content's first `# Heading`, which commonly diverges from the
   filename), so a link-target rewrite based on hash-stripping alone won't
   match the real destination filename.
2. Notion's hash suffix exists specifically to disambiguate **duplicate page
   titles** — after stripping, two source pages can collide on the same
   cleaned name, and `NoteStore.create()`'s existing counter-suffix
   (`-1`, `-2`) renames the second one in a way a stateless regex can't see.

So: **Pass 1** walks the source tree once and builds
`Map<originalRelativePath, finalRelativePath>` for every file (note or
asset), applying the real naming rules (H1-preferred title, hash-stripped
fallback, collision counter) a single time. **Pass 2** copies each file into
`notesDir` at its mapped destination, and for `.md` files, rewrites any
markdown link/image target found in the map before creating the Noteato note
(percent-decode the target before matching, since Notion commonly
percent-encodes spaces in local links, then re-encode on write if needed).

- Filename/folder hash pattern: trailing `\s[0-9a-f]{32}` before the
  extension or end of a path segment.
- Title = first `# Heading` line if present, else the hash-stripped filename.
  Verify against a real export that this doesn't false-positive on a
  property-block page that has no H1 (title-only-in-filename case).
- Destination note created via Phase 1's folder-aware
  `NoteStore.create(title, folder)`, then `save()`d with the rewritten body.
- Non-`.md` assets (images etc.) copied verbatim to their mapped path.
- `.csv` files (database exports) are copied inertly — they won't show up in
  the sidebar (`list()` filters `.md` only). Explicit decision, not an
  accident; no CSV parsing in v1.
- A Notion "page with children" typically has a same-named-plus-hash sibling
  folder next to the page's own `.md` file — after stripping, both resolve to
  the same display name at the same tree level. **Explicit v1 decision:**
  render them as ordinary siblings (a note and a folder can share a display
  name — Phase 1's Sidebar already has to support this), not merged into a
  single folder-with-index-note construct.
- **Explicitly out of scope for v1**: links that reference a Notion page via
  its absolute `notion.so` URL/UUID (only relative same-export links benefit
  from the mapping table above) — the app has no in-app note-navigation
  feature today anyway, so this has low payoff; parsing per-page property
  blocks (`Status: ...`, `Tags: ...` lines some database-row exports prepend)
  into structured Noteato tags — left as plain text in the body to avoid
  silently dropping content on a mis-parse.

### Wiring
- `src/main/menu.ts`: "Import Notion Export…" under the Note menu, alongside
  the existing "Import Markdown…".
- `src/main/index.ts` / preload: `notes:importNotion` IPC handler calling the
  new module, returning the list of created notes (same shape as the
  existing `notes:import` flow) so `MainLayout.handleImport`-style code can
  refresh and open them.

**Risk ranking:** the mapping-table walk itself is mechanical once Phase 1's
folder-aware `create()` exists. The genuinely risky part is the *format
assumptions* — get a real Notion export and test the hash/H1/property-block
regexes against it before considering this done.

---

## Suggested build order

1. Phase 1 (folders) — foundation; fixes the stale-path bug that Phase 2 also
   depends on.
2. Phase 2 (sync robustness) — mostly correctness fixes to existing code
   (`save()`, `list()`) plus a watcher; smaller than it looks once Phase 1's
   self-heal exists.
3. Phase 3 (Notion import) — depends on Phase 1's folder-aware `create()`;
   start with a real Notion export sample before writing the regexes.

## Verification

- **Phase 1**: create nested folders via the sidebar, move a note between
  folders while its tab is open (confirm the self-heal keeps saving), rename
  a folder containing open tabs, switch `notesDir` via Settings with
  subfolders present and confirm everything migrates (not just top-level
  files).
- **Phase 2**: run two copies of Noteato pointed at the same folder (simulating
  two devices) — edit the same note in both within the same save-debounce
  window and confirm a conflict-copy is created (with a distinct `id`) rather
  than either edit being silently lost; delete a note externally while its
  tab is open, both clean and dirty.
- **Phase 3**: run against a real Notion export of a workspace with at least
  one duplicate page title and one page containing an image, confirm the
  image renders and the duplicate-titled pages both import without one
  clobbering the other.

---

## Phase 4 — Pin notes, reminders, general-purpose AI chatbot

Captured for later sequencing; not yet designed in file-level detail.

- **Pin notes**: a boolean on `NoteMeta` (like `fullWidth`), pinned notes
  render in a separate "Pinned" section at the top of the Sidebar, above the
  folder tree. Straightforward — same shape as the existing `fullWidth`
  toggle end-to-end (type, frontmatter field, IPC, UI toggle).
- **Reminders**: a due-date/time on a note (or a block-level reminder tied to
  a specific to-do item — needs a decision) that fires a native macOS
  notification (Electron `Notification` API, no extra deps) at the given
  time. Needs a lightweight in-process scheduler (main process holds
  timers keyed by note id; re-derive/reschedule on app launch from
  frontmatter so reminders survive a restart) — no background service, no
  push infra, consistent with the local-first model.
- **General-purpose AI chatbot** (distinct from the existing "Ask about this
  note" popup, which is deliberately scoped to one note's content): a
  separate chat surface with no note context injected, for general
  questions. Reuses the same BYOK `aiComplete` client
  (`src/renderer/src/ai/client.ts`) and the same provider/model settings —
  just a different system prompt (or none) and a different entry point/UI
  surface (e.g. its own panel or window, not anchored to a note). Needs a
  decision on where it lives in the UI (a persistent panel vs. a menu-
  triggered popup) before implementation.

---

## Phase 5 — Noteato Pro (licensed, hosted AI/dictation proxy)

Free Noteato is fully local + BYOK — the user supplies their own
Deepgram/Anthropic/OpenAI keys, and Noteato never sits between the app and
those providers. Noteato Pro is a second, paid product: same app, but AI and
dictation calls route through a Noteato-run proxy instead of the user's own
keys, gated by a purchased license.

**What's identical between the two:** everything non-AI — editor, notes
storage, folders (Phases 1-3), pin/reminders (Phase 4), sidebar, settings
infrastructure. The actual product difference is narrow:
- Settings gains a license-key field. When a valid license is present, AI
  and dictation calls route through the Noteato-run proxy instead of
  `src/main/ai.ts`'s direct Anthropic/OpenAI calls (and the Deepgram
  WebSocket in `useDictation.ts`) — same call sites, different endpoint/auth.
- A license validation path (exact mechanism TBD once the proxy exists —
  needs to work reasonably offline, e.g. cache a signed/short-lived token
  locally rather than requiring a phone-home on every launch).
- Pro-specific branding (product name, icon, `electron-builder` `appId`).

**Explicitly deferred, per your message** — not part of this pass: the
actual Cloudflare Worker proxy, and license issuance/validation backend. This
phase is scaffolding only until that exists.

**Open structural question before creating the copy:** since the free/pro
delta is narrow (a license gate + swapping BYOK for a hosted proxy at the
same call sites), a full separate codebase copy means every future fix or
feature in Phases 1-4 has to be manually ported to both trees by hand. Worth
deciding the fork mechanism deliberately rather than defaulting to a literal
`cp -r` — see the question asked in-session; whichever answer is chosen,
record it here once decided.
