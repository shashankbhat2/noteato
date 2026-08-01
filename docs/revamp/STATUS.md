# Revamp status

Branch `revamp/agent-architecture`. Companion to [`phase-plan.md`](./phase-plan.md) (what to build)
and [`phase-0-audit.md`](./phase-0-audit.md) (what was there before).

Last updated: 2026-08-01, end of Phase 3.

---

## Where things stand

| Phase | | |
|---|---|---|
| **0 — Audit** | ✅ done | Report + measured baselines |
| **0.5A — Test & benchmark groundwork** | ✅ done | Vitest, Swift package, 3 benchmarks, docs archived |
| **0.5B — AI surface** | ✅ done | Per-note bottom Chat drawer; no separate page surface |
| **1 — Agent skeleton** | ✅ done | Menu-bar process, hotkeys, HUD, IPC, Electron client |
| **1.5 — Identity migration** | ✅ done | Notes keyed on id; renames no longer move a note out from under an open pane |
| **2 — Capture path** | 🟨 mostly | Mic, pre-roll, commit to the §4.3 format. **Library migration not done** — see below |
| **3 — On-device ASR** | ✅ done | FluidAudio (Parakeet on ANE), in a helper process that exits |

| **4 — Retrieval** | ⏭️ skipped for now | Search still 197 ms; no type-to-search. **Blocks the ship set** |
| **5 — Dictation** | 🟨 built | ⌥⌘D, streaming, injects into any app. Compatibility matrix partly verified |
| **6 — Meetings** | 🟨 built, unverified | Dual-stream + merge tested; **needs your Screen Recording grant to run at all** |
| **7 — Tier gating** | ⬜ next | |
| **Signing (parallel track)** | ⬜ not started | Gates the *release* of 1–4, blocks no development |

---

## Can you run it locally? Yes.

Apple Silicon + Xcode. Everything below works today on this branch.

### The app on its own

```bash
npm install
npm run dev
```

Each note pane has **Note · Transcript** tabs below the title and before the date. Transcript remains
disabled until recording and ASR state are exposed to the renderer. A gesture-style pill at the
bottom opens a glass Chat drawer over the note; its conversation and whole-note actions stay scoped
to that note. Selection actions remain in the bubble menu except on the fixed title H1. AI needs an
Anthropic or OpenAI key in Settings.

### The agent (Phase 1)

Two terminals — the agent is a separate process, which is the whole point.

```bash
# 1. the resident agent
npm run dev:agent

# 2. the library, told to talk to it
NOTEATO_AGENT=1 npm run dev
```

What to try:

- **⌥⌘Space** → the capture HUD appears, and **recording is already underway** — it opens with the
  last 10 seconds of audio, so speak *before* pressing the key and check the words are there.
  `Esc` or ⌥⌘Space again commits; `Cmd+Esc` discards. The note lands in your vault as
  `<timestamp>-<hash>/` holding `audio.m4a` and `note.md`.
- **The menu bar icon says what the mic is doing** — listening, recording, or off — and the menu
  carries "Pause listening". Locking the screen pauses it too.
- `npm run probe:capture -- --seconds 3` exercises the whole path against the real microphone and
  prints what it found, which is the fastest way to tell a permission problem from a code one.
- **⌥⌘S** → the compact side panel, exactly as before. The agent owns the key and forwards it; the
  library still owns the panel.
- **⇧⌥⌘S** → bring the library to the front, launching it if it isn't running.
- **The menu-bar waveform icon** → Capture, Open Library, and a line saying whether the library is
  connected.
- **Quit the library and press ⌥⌘Space again.** The HUD still opens. That is the §2 invariant: the
  agent is the source of truth and the library is an optional client.
- **Open Library** from the menu bar with nothing running → launches it. In dev, set
  `NOTEATO_LIBRARY_CMD='npm run dev'` before starting the agent, since there is no `.app` bundle to
  open.

Without `NOTEATO_AGENT=1` the library behaves exactly as it always has, and keeps its own `⌃⌥⇧S`
sidebar shortcut. With the agent connected, the agent owns every global shortcut and Electron stands
down — ownership is exclusive at runtime, never shared.

### Tests and benchmarks

```bash
npm test            # 35 TS tests
npm run test:agent  # 14 Swift tests
npm run bench       # all three §10 benchmarks
```

`better-sqlite3` is a native addon built against Electron's ABI, so it cannot load under Vitest. Tests
that touch `NoteStore` run against a stub (`test/stubs/better-sqlite3.ts`) that implements the
statements the store issues and throws on anything else — a new query fails loudly rather than
quietly returning nothing.

---

## Measured against §10

On this M2, 2026-08-01. `npm run bench` reproduces the first two.

| Metric | Budget | Measured | |
|---|---|---|---|
| Hotkey → HUD visible, cold | < 80 ms | **29 ms** | ✅ ~2.7× headroom |
| Hotkey → HUD visible, warm p95 | < 80 ms | **5 ms** | ✅ |
| Agent idle memory | < 150 MB | **46.7 MB** | ✅ |
| Agent idle CPU | < 1 % | **0.0 %** | ✅ |
| Search, 5k notes | < 150 ms | **197.7 ms** | ❌ Phase 4 fixes this |
| Library cold open | < 1.5 s | **3.11 s** | ❌ not yet addressed |
| Transcription RTF | < 0.3× | **0.01–0.02** | ✅ 57–196× realtime |
| Hotkey → recording | 0 ms | **0 ms** | ✅ already buffered |

The HUD figure measures `AgentCore.CaptureHUD` — the type the agent actually shows, not a stand-in.
It does **not** include hotkey dispatch; `RegisterEventHotKey` delivery measured well under a
millisecond in the Phase 0 audit, so the panel is the term that matters. If that ever stops holding,
the benchmark will quietly under-report.

For comparison, the Electron path this replaces: 283 ms cold, 319.6 MB for an *empty* window.

---

## What Phase 1 built

```
agent/Sources/AgentCore/     Framing, Protocol, SocketServer, CaptureHUD, HotkeyManager
agent/Sources/NoteatoAgent/  main, AppDelegate, LibraryLauncher
agent/Sources/PanelBench/    the §10 hotkey→HUD gate
src/main/agentClient.ts      the Electron side of the socket
```

- **Hotkeys** use `RegisterEventHotKey`, deliberately not a `CGEvent` tap — a tap needs Accessibility
  permission, and Phase 1 has not earned that. Asking for "control your computer" before the app can
  capture anything is how a prompt gets denied and never revisited.
- **IPC** is a Unix socket at `~/Library/Application Support/Noteato/agent.sock`, length-prefixed
  JSON. Unknown message types are ignored on both sides, so a newer agent paired with an older
  library degrades to the intersection rather than failing to connect.
- **Bundle layout** (the open question from the plan): the agent ships as
  `Noteato.app/Contents/Resources/NoteatoAgent` — a helper inside the one bundle, not a second app.
  One signature, one updater, existing release pipeline untouched. Residency will come from
  registering it as a login item, not from being the bundle's main executable.

### Known, deliberate gaps

- **No login-item registration yet.** You start the agent by hand. `SMAppService` registration wants
  a signed bundle to be meaningful, so it is sequenced with the signing track.
- **The socket file survives SIGTERM.** `applicationWillTerminate` does not fire for a bare `kill`,
  so `agent.sock` is left behind. `SocketServer.start()` unlinks a stale socket before binding, and
  a test covers it — a crashed agent always comes back.
- **The HUD does not record.** Phase 2.
- **`bench:panel` needs a window server**, so it is unreliable on hosted CI runners. It reports
  rather than gates there; the gate is meaningful locally.

---

## Meetings — blocked on a permission only you can grant

`⇧⌥⌘Space` starts a meeting: microphone as one channel, system audio as the other. Attribution is
exact by construction — the mic is you, system audio is them — rather than inferred from how voices
sound. FluidAudio ships a speaker diarizer and we are deliberately **not** using it: §8 rules out
N-speaker diarization, and a guarantee beats a good model here.

**Verified:** the merge logic, with 12 tests — chronological reconstruction from shared timestamps,
overlapping speech preserved rather than smoothed away, pause-based utterance splitting, renaming a
side, and markdown with timestamps that point back into the audio.

**Not verified — and it cannot be from here:** whether audio actually flows. `SystemAudioCapture`
reports `screenRecordingGranted: false` on this machine, so no stream has ever started. To unblock:

```
npm run probe:meeting          # play something audible while it runs
```

It will tell you whether the permission is held, whether the stream starts, and whether audio is
genuinely arriving — a stream that starts but delivers nothing is the failure that looks like
success, so it has its own line in the output.

**On the re-authorisation question the plan flagged:** the permission *check* is silent
(`CGPreflightScreenCaptureAccess` does not prompt), which is what lets §8's "never auto-record"
promise hold — merely checking cannot pop a dialog. Whether macOS 26 re-prompts periodically once
granted is still unanswered, because nothing here has been granted yet.

## Dictation — what is verified, and what is not

`⌥⌘D` starts and stops dictation. It streams from the microphone the agent already has open and
types confirmed text into whatever app is in front.

**Verified:** injection into TextEdit via the pasteboard route, with the clipboard's previous
contents restored exactly (checked with a sentinel value). Only *confirmed* decoder output is
injected, so text lands once and is never retroactively revised — §7's "no silent editorializing".

**Not verified:** the rest of §7's compatibility matrix — Slack, Mail, Safari, Chrome, Terminal,
iTerm, VS Code. `npm run probe:inject "some text"` injects into whatever is frontmost and reports
which route worked; running it once per app is the matrix, and it should be recorded here rather
than claimed.

**Worth knowing about permissions:** TCC attributes a command-line binary to the terminal that
launched it, so in development dictation inherits the terminal's Accessibility grant and appears to
work with no prompt. The shipped app needs its own grant, and ad-hoc signing means that grant is
keyed to the binary's hash — so it is re-requested on every rebuild until the signing track lands.
Development is therefore *easier* than production here, which is the direction that hides problems.

## What Phase 2 left undone, deliberately

**Existing notes have not been migrated** to the §4.3 directory layout. Captures write the new form
and the library reads both, so nothing is broken — but the flat `<slug>.md` notes already in your
vault stay as they are.

That is a real gap against the brief, and it is deferred on purpose: the migration rewrites every
note in a real library, and this session already found two ways the library moves a note away from
its audio (`flattenLibrary` and `save`). Both are fixed and tested. Doing a bulk rewrite in the same
pass, on files that have no backup, is how a session like this destroys someone's notes. It wants
the `flattenLibrary()` precedent — a full restorable copy first, and a one-time flag — as its own
piece of work.

**The Deepgram path is still present**, contrary to the phase plan, which had Phase 3 delete it. The
duplication that rule exists to prevent is gone — the agent owns note capture outright — and
Deepgram now serves only the mic in the chat composer, which dictates a *question* rather than
capturing a note. Phase 5 replaces that with the on-device streaming path; removing it now would
leave a dead button and no replacement for a whole phase.

---

## Engine decision (2026-08-01)

On-device transcription will use **[FluidAudio](https://github.com/FluidInference/FluidAudio)**
(Apache 2.0) — Swift-native Parakeet on the Apple Neural Engine — for voice notes, dictation and
meetings. It resolves the open question from the plan: the well-known Parakeet path is Python, which
a 150 MB menu-bar process cannot host.

Checked rather than assumed: it resolves and builds against our toolchain (Swift 6.3, macOS 14
target) and pulls **zero transitive dependencies**.

Two things carried into the plan rather than taken at face value:

- **The vendor's ~190× realtime is on an M4 Pro, with their audio.** Phase 3 still benchmarks it
  against `whisper.cpp` on our M2 before wiring, because §6 asks for latency-per-accuracy, not a
  press release.
- **We will not use its speaker diarization**, despite it being the most tempting thing in the
  package. §8 rules out N-speaker diarization deliberately; channel separation (mic = you, system
  audio = them) is exact by construction rather than inferred. FluidAudio does the transcription;
  the channels do the attribution. See Phase 6 in the plan.

---

## Still open for you

1. **Signing** — start the Developer Program enrollment when convenient. It gates the release of
   Phases 1–4 and has a lead time the code doesn't. See audit §5a for why it matters more than it
   looks (TCC re-prompts on every update without it).
2. **`Ask`-as-chat vs §11.** The brief rules out a chat surface; you asked for Ask to be one. Built
   as asked and threaded per note. Worth a deliberate decision on whether the per-note scoping makes
   it a different thing from what the brief was rejecting.
3. **Library cold open (3.11 s vs 1.5 s)** is unowned by any phase. Worth slotting into Phase 4,
   which is the last one before the ship.
