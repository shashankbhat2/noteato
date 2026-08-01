# Phase 0 — Audit

Branch: `revamp/agent-architecture`. Machine: Apple M2, macOS 26.5, Xcode 26.6 / Swift 6.3.3,
Node 25.9, Electron 33.2. All numbers below were measured on this machine; the harnesses are
described inline so they can be re-run.

No production code has changed. This is the report §12 asks for before Phase 1 starts.

---

## 1. Repo structure, main/renderer split, IPC surface

electron-vite project, ~12.6k lines of TS/TSX, three tsconfigs (`node`, `web`, root).

```
src/main/       18 files   Electron main. All disk, DB, OS integration.
src/preload/     2 files   The single contextBridge surface (`window.api`).
src/renderer/   40 files   React 19 + BlockNote 0.51. No direct fs access.
src/shared/      3 files   Types + the one global-shortcut accelerator.
```

Main-process modules, by responsibility:

| Module | Owns |
|---|---|
| `storage.ts` (882 ln) | The markdown library: list/read/save/search/trash, external file linking |
| `db.ts` | `better-sqlite3` at `userData/noteato.db`, `user_version` migrations, a KV store |
| `scratchStore.ts` | `scratch_notes` table — quick capture, *separate* from the markdown library |
| `sidebarMode.ts` (306 ln) | The compact edge panel: an Electron `type: 'panel'` window |
| `reminders.ts` | Per-note one-shot reminder timers + native notifications |
| `globalShortcuts.ts` | Exactly one accelerator (below) |
| `tray.ts`, `edgeHover.ts`, `fileWatcher.ts`, `menu.ts`, `windowState.ts`, `settings.ts`, `ai.ts`, `frontmatter.ts`, `notionImport.ts` | as named |

**IPC surface:** one preload bridge exposing `window.api` in 8 namespaces (`notes`, `scratch`,
`settings`, `sidebar`, `reminders`, `ai`, `app`, `shortcuts`). ~55 `ipcMain.handle` channels, all
request/response `invoke`. Push traffic goes the other way on 6 `webContents.send` channels
(`notes:changed`, `scratch:changed`, `sidebar:state-changed`, `reminders:fired`, `shortcut`,
`app:context-menu`), broadcast to every window.

The split is clean and the renderer is already a pure client of main — which is the good news for
§2, because the agent can slot in where main currently sits.

**The one structural fact that matters for the revamp: no audio ever crosses IPC today.** Capture,
encoding, the WebSocket, and the waveform all live in the renderer (`useDictation.ts`). The main
process has never touched a microphone. So §2's agent isn't taking work away from main — it's
taking it away from a browser tab.

---

## 2. Where Deepgram is wired in, and how tightly

**Far more loosely than the brief assumes.** It is one renderer-side file and five references:

| Location | What |
|---|---|
| `src/renderer/src/dictation/useDictation.ts` | The whole integration — 153 lines, `getUserMedia` → `MediaRecorder` → `WebSocket` to `wss://api.deepgram.com/v1/listen` |
| `src/renderer/src/components/DictationPanel.tsx` | The only consumer |
| `src/shared/types.ts:104`, `src/main/settings.ts:28` | `deepgramApiKey` field |
| `src/renderer/src/components/SettingsModal.tsx:495` | The settings input |
| `src/renderer/index.html:7` | CSP `connect-src wss://api.deepgram.com` |
| `README.md:61,103` | Docs |

The main process contains zero Deepgram code. Removing it is a six-file change with no
architectural ripple — the easiest item in the brief.

**Two corrections to the brief's framing, though:**

1. What Deepgram powers today is **not §7 dictation.** It injects transcript into the BlockNote
   editor of the currently-open note via `editor.insertInlineContent` — it requires the main window
   open with a note focused. §7 wants injection into the *frontmost app* via accessibility APIs.
   These share a name and nothing else. §7 is new construction, not a port.

2. §6's claim that cloud transcription makes pre-roll impossible is **confirmed and quantified.**
   TCP+TLS to `api.deepgram.com` from this machine, three runs: 593 / 510 / 509 ms. That is before
   the WebSocket upgrade, before auth, before the first audio byte. A 10-second pre-roll round-trip
   over that path is not a latency problem you optimize; it's the wrong shape.

---

## 3. Current note storage vs. §4.3, and what migration requires

**Today:** one flat markdown file per note at `<vault>/<slug>.md`, default vault
`~/Documents/Noteato` (configurable via `settings.notesDir`). Frontmatter is a **hand-rolled
`key: value` parser** (`frontmatter.ts`), not YAML — no nesting, no arrays beyond a
comma-split `tags: [a, b]`, quote-stripping as the only escaping.

```
---
id: <uuid>
title: "Launch notes"
createdAt / updatedAt: ISO
tags: [a, b]
fullWidth / pinned: bool
reminderAt: ISO or empty
---

# Launch notes
…body…
```

Two further stores exist that §4 doesn't account for:

- `scratch_notes` (SQLite) — the quick-capture surface behind the sidebar panel. Deliberately never
  touches the markdown library.
- `opened_files` (SQLite) — externally linked `.md` files and folders, surfaced in the same list but
  never rewritten.

**What migration to §4.3 actually costs — this is bigger than a format change:**

The load-bearing problem is that **identity today is the file path, not the id.** `save()` renames
the file whenever the title changes (`storage.ts:578-583`), and every renderer surface —
`panes.ts`, `MainLayout`, `Sidebar`, `SearchModal`, all of preload — addresses notes by relative
path. Notes carry a UUID in frontmatter, but nothing keys off it.

§4.3's `2026-08-01T14-32-11Z-a7f3/` directory names are immutable and title-independent. That is
strictly the better model, and it makes renames free — but converting to it means moving the entire
renderer from path-keyed to id-keyed addressing. Expect to touch nearly every renderer file. Budget
this properly; it is the largest single piece of Phase 2 and it is easy to under-scope because the
on-disk change looks small.

Two smaller items:

- **Reminders have nowhere to live.** `reminderAt` is read from note frontmatter by
  `ReminderScheduler`. The brief never mentions reminders. They're a shipped, documented feature
  with notification plumbing — the new `note.md` front-matter needs a slot for them, or the
  feature is being dropped. Flagging rather than deciding.
- **§4.3's "delete in Finder must reconcile" is nearly free already.** `list()` walks the directory
  each call, so a vanished note simply stops appearing. What breaks is renderer state holding a
  stale path — `read()` throws. Needs a catch, not an architecture.

---

## 4. Capture entry points, and measured latency

### There is no global capture hotkey today

The app registers **exactly one** global accelerator: `⌘⌥S` → toggle the sidebar panel
(`shared/globalShortcuts.ts:1`). It's registered only when `sidebarModeEnabled` is on, which is
gated behind onboarding — so on a fresh install there is no global hotkey at all.

Audio capture is a **button in the note editor toolbar** requiring the main window open and a note
focused. There is no hotkey→recording path to measure, so the honest reading is:

> hotkey → *(none)* → open window → click mic → `getUserMedia` → ~510 ms TLS → WS upgrade → first audio

Seconds, not milliseconds. §3's "recording begins 10 seconds in the past" is not a tightening of
this path; it's a different path.

### Measured numbers

Electron probe (`electron` binary, borderless `type: 'panel'` window, trivial `data:` document —
i.e. *generous* to Electron, since the real sidebar loads the full React+BlockNote bundle):

| | |
|---|---|
| `globalShortcut.register` | 0.66 ms (dispatch is sub-ms) |
| Warm `show()` → `isVisible()`, median of 12 | **1.28 ms** (p95 1.62) |
| Cold: construct → ready-to-show → shown | **283 ms** (construct 99, load 183) |
| Bare Electron idle RSS, 4 processes | **320 MB** |

Packaged app (`dist/mac-arm64`, v1.1.0, run against a throwaway `--user-data-dir`; the user's real
library and installed copy were untouched):

| | Measured | §10 budget |
|---|---|---|
| Cold launch → first window on screen | **3.11 s** | 1.5 s |
| Idle RSS, 4 processes | **411 MB** | 150 MB (agent) |

Native Swift probe on the same machine — a borderless non-activating `NSPanel` at 420×90 drawing a
64-bar waveform, which is the §4.1 HUD:

| | Measured | §10 budget |
|---|---|---|
| Cold: construct + `orderFrontRegardless` | **23.1 ms** | 80 ms |
| Warm `orderFrontRegardless`, median of 20 | **1.55 ms** (max 2.59) | 80 ms |
| Process RSS (AppKit + panel) | **33 MB** | 150 MB |

### What these numbers actually decide

- **The 80 ms HUD budget is reachable natively with ~3.5× headroom, and unreachable in Electron on
  the cold path.** Warm Electron show is genuinely fast (1.3 ms) — but "warm" means a renderer
  already booted and resident, which is exactly the 411 MB the brief is trying to escape. There is
  no Electron configuration that is both warm and under 150 MB. §2's process split is the right
  call and the measurements support it rather than merely permitting it.
- The current `⌘⌥S` reveal also runs a scripted **170 ms** enter animation
  (`sidebarMode.ts` `ENTER_MS`), so even warm it cannot settle inside 80 ms by construction.
- Cold open is **2× over** the §10 library budget already, before any new code.

---

## 5. Conflicts with what already exists

Ordered by how much they should change the plan.

### a. Signing and entitlements gate Phases 2, 5 and 6 — and aren't in the plan

`electron-builder.yml` ships `hardenedRuntime: false`, `gatekeeperAssess: false`, with the comment
"No Apple Developer account: publish unsigned builds for now." `release-signed.yml.disabled` and
`electron-builder.signed.yml.disabled` are parked.

The revamp asks for: a permanently-open microphone (§3), Accessibility text injection into other
apps (§7), and ScreenCaptureKit system-audio capture (§8). On current macOS those need a signed,
notarized, hardened-runtime binary with the right entitlements — and an unsigned app requesting
"control your computer" and "record your screen" is, at best, a support burden and at worst simply
refused. Current entitlements cover only `device.audio-input`.

**This is a prerequisite, not a phase.** Apple Developer Program enrollment should start now; it has
a lead time the code doesn't. Recommend treating it as Phase 0.5 with an explicit owner.

### b. §11 forbids a chat sidebar; the app ships two

`AgentPanel.tsx` (601 ln) is a full assistant that opens in its own pane — per-note history,
`@`-mentions of other notes as context, note creation from chat, streaming with cancellation.
`HomeView.tsx` carries a *second*, general-purpose chat assistant (`homeAssistantEnabled`).
`SelectionAiPopup.tsx` adds a third AI surface. All are documented in the README with a screenshot.

§11 says delete it and push back if asked to keep it. That's a defensible product call, but it is
deleting a headline shipped feature, not cleaning up scaffolding — **your call, not mine.** I've
made no change. Note that §9's "explicit, named actions with visible output" is compatible with
keeping `SelectionAiPopup`-style actions while dropping the two chat panes; that may be the cut you
actually want.

### c. §11 forbids tag taxonomies; tags are shipped and in user data

`TagBar.tsx`, `#tag` / `tag:` search syntax (`storage.ts` `parseSearchQuery`), `tags:` in every
note's frontmatter, documented `⌘K` tag filtering. Existing user notes carry tags on disk. Removing
the feature is easy; deciding what happens to the data in people's files is the actual question.

### d. §10's search budget is already missed by the current implementation

`NoteStore.search()` calls `list()`, which reads, parses and `stat`s **every** markdown file, then
re-reads every surviving candidate's body a second time. Benchmarked with a faithful port of that
algorithm against a synthetic 5,000-note library, warm page cache, ~1.5 KB bodies:

**190 ms median** (range 185–193) — over the 150 ms budget, and that is the optimistic reading. Real
voice notes with word-level transcripts are far larger than 1.5 KB, and this excludes IPC and
render time.

§5's hybrid BM25 + vector index therefore isn't an enhancement layered on a working search — it is
the fix for a search that does not currently meet the bar. Worth sequencing accordingly.

### e. §6's "Apple Silicon only" abandons a shipped audience

`build:mac` and `release` both pass `--arm64 --x64`; `dist/` holds x64 DMG and ZIP artifacts. The
config change is trivial. The decision — dropping existing Intel users at a version bump — is not.
Worth an explicit line in the release notes rather than a silent architecture drop.

### f. There is no test infrastructure to hang the CI gates on

`package.json` has no `test` script. CI runs `npm run typecheck` and `npm run build`, nothing else.
§10 requires automated latency tests for hotkey→HUD and search, failing the build on regression.
Phase 1 has to bring a test runner and a way to measure native panel latency in CI — and CI runs on
`macos-latest` shared runners, where absolute timings are noisy. Recommend the gate assert against a
generous ceiling (e.g. 80 ms with the real target tracked as a reported metric) rather than trying
to hold a tight bound on shared hardware.

### g. §3 and §12 disagree about ordering

§3 says the pre-roll buffer is "build this first." §12 Phase 1 says "No audio yet." Minor, but worth
settling: **I'd follow §12.** Pre-roll only means anything inside a resident process, so proving the
process model and the hotkey→panel latency first is the right order. §3's "first" is best read as
"first *feature*", which Phase 2 satisfies.

### h. `plan.md` and `roadmap.md` describe a different product

Both are checked into the repo root. `roadmap.md` Phase 1 is "Folder support (foundation)" — which
§11 explicitly forbids — plus Notion migration and a hosted AI proxy. `plan.md` is an iCloud sync
plan. `tldraw-integration.md` is a third direction. Recommend archiving all three under
`docs/archive/` so the next person reading the repo isn't handed contradictory plans.

### i. Smaller notes

- **`type: 'panel'` is already in use** for the sidebar — useful prior art for §4.1, and it confirms
  the ceiling: a non-activating panel in Electron still costs a full Chromium renderer.
- **`scratch_notes` needs a decision.** §4.2's "one flat stream" implies one inbox; the app has a
  markdown library *and* a separate SQLite scratch store as distinct user-facing surfaces. Merging
  them is a migration; keeping both contradicts the brief.
- **The custom frontmatter parser will need replacing** for §9's timestamp ranges — traceable
  summaries mean nested structure, which `key: value` line-splitting can't express.
- **Onboarding gates the tray and the only global shortcut** (`runtimeSettings()` forces them off
  until `onboardingCompleted`). An always-resident agent inverts that assumption; worth checking the
  first-run flow early rather than at the end of Phase 1.

---

## Recommendation

The architecture call in §2 is correct and the measurements support it independently: 33 MB / 1.6 ms
native versus 411 MB / 283 ms cold in Electron. Nothing in the code argues against the split.

Before Phase 1 starts, three things need your decision — they're product calls, not engineering
ones, and two of them are hard to reverse:

1. **Apple Developer Program enrollment** (§5a). Blocks Phases 2, 5, 6. Longest lead time. Start now.
2. **The chat assistants** (§5b) — delete both, keep the named-action AI surfaces, or keep one.
3. **Tags** (§5c) and **scratch notes** (§5i) — what happens to data already on users' disks.

Everything else in the brief I can proceed on as written.

Awaiting review before Phase 1.
