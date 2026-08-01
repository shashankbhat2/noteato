# Plan: tldraw canvases in Noteato

## Context

Add whiteboard/canvas notes to Noteato using [tldraw](https://tldraw.dev) — an
infinite-canvas SDK for React. The integration has to respect the existing
constraints of this codebase:

- **Local-first, offline, no lock-in.** Everything on disk in an open format,
  no CDN calls at runtime (the renderer CSP is `default-src 'self'`).
- **The filesystem is the only source of truth.** Notes are files under
  `notesDir`; folders are directories; ids/metadata live in the file itself
  (frontmatter for `.md`).
- **One editor per tab**, tabs keyed by note `id`, paths re-pointed on
  move/rename (`MainLayout.tsx`, `tabs.ts`).

### Chosen shape: canvas as a note *kind*, not a block

Two ways to integrate were considered:

1. **A tldraw block inside a markdown note** (custom BlockNote block hosting a
   canvas, JSON in a fenced code block). Rejected for v1: embeds a heavy
   canvas inside ProseMirror, wrecks the markdown round-trip
   (`blocksToMarkdownLossy` is the save path), and fights the AI/agent
   features that treat a note's body as markdown.
2. **A whole-note canvas** — a new note kind living as its own file in the
   notes tree, opened in a tab that renders `<Tldraw>` instead of
   `NoteEditor`. This matches how the app already works (a tab is one file,
   one editor) and is what this plan does.

### File format decision

Canvas notes are stored as **`.tldr` files** — tldraw's own JSON file format
(`{ tldrawFileFormatVersion, schema, records }`), the same thing tldraw.com
saves/opens. This keeps the "no lock-in" promise: a Noteato canvas can be
dragged onto tldraw.com and just works.

Noteato's per-note metadata (`id`, `createdAt`, `pinned`, `reminderAt`, …)
goes on the **`meta` field of the document record** inside the file (every
tldraw record carries a free-form `meta`), with `title` additionally mirrored
into the document record's `name` so tldraw.com shows it. This is the `.tldr`
equivalent of frontmatter: same file, still valid for other tools, survives
round-trips. The main process treats the snapshot as opaque JSON and only
touches the one record with `typeName === 'document'` — it does **not**
depend on the `tldraw` package.

A `.tldr` file that has no Noteato meta (e.g. the user dropped one in from
tldraw.com) gets an `id`/`createdAt` minted and written back on first read —
the same self-heal `openExternal()` already does for bare `.md` files.

### Licensing — decide before writing code

The tldraw SDK is **not MIT** — it ships under tldraw's own source-available
license. The free tier requires the "Made with tldraw" watermark to stay
visible; removing it requires a paid business license. Noteato itself stays
MIT, and bundling tldraw under its own license terms is permitted, but:

- The watermark stays. Do not hide or crop it.
- Add a "Third-party licenses" note to `README.md` (and the About/credits
  surface if one ever exists) naming tldraw and its license.
- Pin the exact `tldraw` version in `package.json` (license terms are
  per-version).

If the watermark is unacceptable for the product, stop here — that's a
product decision, not an engineering one.

---

## Phase 0 — Groundwork spike (offline rendering)

Prove tldraw renders fully offline inside the current CSP before touching the
storage layer. Half a day; throwaway route/component.

- `npm i tldraw` (verify React 19 peer support at install — the app is on
  React 19.2; recent tldraw 3.x supports it, but confirm the resolved version
  does. `tldraw` goes in `devDependencies` like every other renderer dep here —
  electron-vite bundles the renderer, only `@electron-toolkit/*` are runtime
  deps).
- Import `tldraw/tldraw.css` and mount a bare `<Tldraw />` behind a dev-only
  flag.
- **Self-host every asset.** By default tldraw loads fonts/icons/translations
  from its CDN, which the CSP (`default-src 'self'`) blocks. Use
  `@tldraw/assets` with the Vite import flavor (`getAssetUrlsByImport`) so
  everything is emitted into the bundle, and pass `assetUrls` to `<Tldraw>`.
- **CSP additions** in `src/renderer/index.html`: today there is no
  `img-src`/`font-src`, so both fall back to `'self'`, which blocks the
  `blob:`/`data:` URLs tldraw uses for images, exports, and (potentially)
  fonts. Extend to:
  `img-src 'self' blob: data:; font-src 'self' data:`.
  Keep `connect-src` untouched — part of the spike is confirming (DevTools
  network panel, Wi-Fi off) that **zero** requests leave the app, watermark
  included. If the watermark asset turns out to need the network, bundle-serve
  it if the license allows, otherwise allow that one origin in `img-src` —
  don't silently let it 404.
- Confirm dark mode flips via the `<Tldraw>` dark-mode option driven by
  `useTheme().resolvedTheme` (the app has its own three-way theme; don't use
  tldraw's OS inference).

**Exit criteria:** offline canvas, drawing works, image paste works, no CSP
violations in console, watermark visible.

---

## Phase 1 — Storage: `.tldr` as a first-class note file

### `src/shared/types.ts`
- `NoteSummary` gains `kind: 'md' | 'canvas'`, **derived from the file
  extension, not stored** — no new frontmatter field, consistent with "a
  note's folder is where its file lives".

### `src/main/canvasFile.ts` (new — the `.tldr` sibling of `frontmatter.ts`)
- `parseCanvasFile(raw): { meta: Partial<NoteMeta>; body: string }` —
  `JSON.parse`, find the `typeName === 'document'` record, read `meta`
  (title falls back to the record's `name`, then the filename). `body` is the
  raw JSON string, unchanged.
- `serializeCanvasFile(meta, body): string` — parse `body`, write `meta` onto
  the document record (and `title` → `name`), stringify. Tolerate an **empty
  body** (see create flow) by emitting a stub `{ "noteato": meta }` object
  that `parseCanvasFile` also understands — the first real save replaces it
  with a genuine snapshot.

### `src/main/storage.ts`
All of this is mechanical "dispatch on extension" plus regex generalization:
- `walkNotes()`: accept `.tldr` alongside `.md`.
- One pair of helpers — `parseAnyNote(relPath, raw)` /
  `serializeAnyNote(relPath, meta, body)` — used by `toSummary`, `read`,
  `save`, `setPinned`, `setReminder` (all five currently call the frontmatter
  functions directly). Pin/reminder must work on canvases because the sidebar
  offers them on every note.
- `toSummary` for a canvas: `excerpt: ''` (the renderer labels it "Canvas");
  wrap the parse in try/catch and skip unreadable files instead of killing
  `list()` — a corrupt/mid-write JSON file must not blank the sidebar.
- `create(title, folder, id, kind?)`: extension from kind; a new canvas is
  written as the meta-stub via `serializeCanvasFile(meta, '')` — the main
  process can't fabricate a real tldraw schema and shouldn't try; the
  renderer's first autosave (~600ms after open) writes the real snapshot.
- Generalize every hardcoded `.md` in rename/collision logic to
  `\.(md|tldr)$`: `save()`'s title-driven rename (`slugify(title) +
  extension`), `moveNote()`'s counter suffix, `restore()`'s counter suffix,
  and `baseName(...).replace(/\.md$/...)` title fallbacks.
- `search()`: canvas notes match on **title only** in v1 — do not substring
  the JSON body (it would "match" shape ids and color names). Text extraction
  from shape richText is a listed v2 item.
- `openExternal()` stays `.md`-only for now (OS file association for `.tldr`
  is deferred).
- **Perf note, do in this phase:** `list()` re-reads and re-parses every file
  on every call, and the renderer calls it per keystroke in the `@`-mention
  menu. That's tolerable for small `.md` files, not for multi-MB canvases
  with embedded images. Add an mtime-keyed summary cache to `NoteStore`
  (invalidate per file on `mtimeMs` change) — a general win that becomes
  load-bearing here.

### `src/main/index.ts` / `src/preload/index.ts`
- `notes:create` gains the optional `kind` argument (threaded through the
  existing handler — no new channel needed).
- No other IPC changes: `notes:save` already carries `{ title, body }` and a
  canvas's body is just a JSON string.

**Risk ranking:** mechanical except the summary cache (medium — get
invalidation right) and the meta-injection round-trip (write a small unit
check: parse → serialize → parse preserves records byte-for-byte apart from
the document record).

---

## Phase 2 — Renderer: CanvasEditor + tab dispatch

### `src/renderer/src/components/CanvasEditor.tsx` (new)
Mirrors `NoteEditor`'s outer chrome (toolbar with breadcrumb, reminder bell,
title input) but hosts `<Tldraw>`:
- Load: `window.api.notes.read(path)`; empty/stub body → fresh store;
  otherwise parse with tldraw's `.tldr` helpers (`parseTldrawJsonFile`) and
  hand the store/snapshot to `<Tldraw>`.
- Save: `editor.store.listen(handler, { scope: 'document', source: 'user' })`
  debounced with the same 600ms constant, serializing via tldraw's `.tldr`
  serializer (`serializeTldrawJson`) and calling the existing
  `window.api.notes.save(path, { title, body })`. Flush pending saves on
  unmount. Title edits reuse the same debounce → same slug-rename → `onSaved`
  re-points the tab exactly like markdown notes.
- Theme: dark-mode option from `useTheme().resolvedTheme`; must react to
  live theme switches.
- No dictation, no find bar, no markdown toggle, no full-width toggle (a
  canvas is inherently full-bleed), no AI selection toolbar — simply don't
  render them.

### `src/renderer/src/components/MainLayout.tsx`
- Tab dispatch: render `CanvasEditor` when the tab's path ends in `.tldr`,
  else `NoteEditor`. `Tab` needs no new field — the extension travels in
  `path`.
- **Undo/redo:** the app menu drives `editorsRef` (a
  `Map<string, NoteatoEditor>`). Widen the registry value to a minimal
  `{ undo(): void; redo(): void }` interface; `CanvasEditor` registers an
  adapter over the tldraw editor. `getAgentMarkdown`/`applyAgentMarkdown`
  then need a type guard (canvas registrations return null from
  `getMarkdown`) — verify `AgentPanel` already tolerates a null there.
- **Mount policy:** `MainLayout` keeps every tab mounted (`display: none`).
  N BlockNote editors are cheap; N tldraw stores are not. v1 decision:
  render `CanvasEditor` **only for the active tab** (flush-on-unmount makes
  this safe), keeping markdown tabs mounted as today. Re-opening a canvas tab
  re-reads from disk — acceptable, and sidesteps hidden-canvas
  ResizeObserver quirks entirely.

### `src/renderer/src/components/Sidebar.tsx`
- Distinct icon for `kind === 'canvas'` rows (e.g. Tabler `IconVectorBezier2`
  / `IconSketch`), tooltip/label "Canvas" where the excerpt would be.
- "New canvas" alongside "New note": the sidebar footer action and the
  folder context menu, both calling the extended `handleCreate` with
  `kind: 'canvas'`.

### `src/main/menu.ts` + shortcut plumbing
- "New Canvas" under the Note menu next to "New Note" (`⌥⌘N` — `⌘T`, `⌘⇧N`
  are taken), emitting a `new-canvas` action through the existing `shortcut`
  channel; `MainLayout`'s switch gains a case that calls
  `handleCreateInSelectedFolder` with the canvas kind.

### AI / agent / mentions — explicit v1 boundaries
- `@`-mention menu (`noteLinkItems`) and `SearchModal` results include canvas
  notes (they come from `list()`/`search()` for free); opening one opens the
  canvas tab. Mention chips *inside* a canvas are out of scope.
- **AgentPanel mention context:** wherever the agent reads a mentioned note's
  body for context, filter canvas notes to title-only — injecting megabytes
  of shape JSON into a prompt is a cost/quality bug, not a feature. Audit
  `AgentPanel.tsx`'s context-building path for this.
- "Ask about this note" / selection AI don't apply (their entry points live
  in `NoteEditor` and simply don't exist in `CanvasEditor`).

**Risk ranking:** CanvasEditor itself is small (tldraw does the heavy
lifting); the fiddly parts are the editors-registry type widening and making
sure the active-tab-only mount doesn't regress the markdown-tab behavior.

---

## Phase 3 — Polish & release

- `README.md`: feature bullet under Writing/Organization, plus the
  third-party-license note for tldraw.
- `CHANGELOG.md` `[Unreleased]` entry.
- Bundle-size sanity check: tldraw adds several MB of JS + assets to the
  renderer bundle; confirm `npm run build:mac` still produces a sane DMG and
  cold-start time doesn't visibly regress (canvas code could be
  `React.lazy`-split so markdown-only users never parse it — do this if
  startup measurably regresses).
- Release per the normal flow (tag push; never build/publish manually).

## Deferred (v2 candidates, deliberately out of scope)

- **On-disk asset store** — a `TLAssetStore` writing pasted images to an
  `assets/` folder beside the notes instead of base64-inside-the-JSON (the
  tldraw default). Keeps `.tldr` files small; needs care with move/rename.
- Full-text search inside canvases (extract text from shape richText).
- `.tldr` OS file association + `openExternal` support.
- Embedding a live canvas preview block inside markdown notes.
- PNG/SVG export menu item (tldraw ships the export machinery).
- Sticky notes on tldraw (the current sticky window is a plain textarea).

## Verification

Run through with Wi-Fi off (the offline promise is the point):

1. **Offline**: create a canvas, draw shapes, paste an image — no network
   requests, no CSP console errors, watermark visible.
2. **Persistence**: draw, wait past the debounce, quit, relaunch — canvas tab
   restores (tab-restore is by id and needs zero changes) with content
   intact; the `.tldr` file on disk opens on tldraw.com (spot-check once,
   online).
3. **File semantics**: rename via title → file slug-renamed in place, tab
   re-pointed; move between folders while the tab is open; pin; set a
   reminder and let it fire; delete → undo restores it.
4. **Coexistence**: markdown tab + canvas tab open together; menu Undo/Redo
   hits whichever is active; theme toggle flips both live; `⌘K` search finds
   the canvas by title (and does *not* match JSON internals).
5. **Robustness**: hand-corrupt a `.tldr` file → sidebar still lists
   everything else; drop a foreign tldraw.com `.tldr` into the notes folder →
   it appears, opens, and gets an id minted on first read.
6. **Build**: `npm run typecheck`, `npm run build:mac`, install the DMG, run
   checks 1–4 against the packaged app.
