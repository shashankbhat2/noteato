# Revamp status

Branch `revamp/agent-architecture`. Companion to [`phase-plan.md`](./phase-plan.md) (what to build)
and [`phase-0-audit.md`](./phase-0-audit.md) (what was there before).

Last updated: 2026-08-01, end of Phase 1.

---

## Where things stand

| Phase | | |
|---|---|---|
| **0 — Audit** | ✅ done | Report + measured baselines |
| **0.5A — Test & benchmark groundwork** | ✅ done | Vitest, Swift package, 3 benchmarks, docs archived |
| **0.5B — AI panel** | ✅ done | One floating panel, follows the focused note |
| **1 — Agent skeleton** | ✅ done | Menu-bar process, hotkeys, HUD, IPC, Electron client |
| **1.5 — Identity migration** | ⬜ next | Path-keyed → id-keyed. Pure refactor, no on-disk change |
| **2 — Capture path** | ⬜ | Mic, pre-roll ring buffer, commit to the §4.3 note format |
| **3 — On-device ASR** | ⬜ | FluidAudio (Parakeet on ANE) — benchmarked against whisper.cpp, then wired |
| **4 — Retrieval** | ⬜ | Hybrid index, type-to-search, result → audio seek |
| **5–7** | ⬜ | Dictation, meetings, tier gating |
| **Signing (parallel track)** | ⬜ not started | Gates the *release* of 1–4, blocks no development |

---

## Can you run it locally? Yes.

Apple Silicon + Xcode. Everything below works today on this branch.

### The app on its own

```bash
npm install
npm run dev
```

Unchanged from before, except the AI surface: one floating panel at the bottom of the window with
**mic · Enhance · Ask**, showing which note it is acting on. Enhance gives you a result with
Copy/Insert; Ask is a conversation, threaded per note. Selection actions are still in the bubble
menu. AI needs an Anthropic or OpenAI key in Settings.

### The agent (Phase 1)

Two terminals — the agent is a separate process, which is the whole point.

```bash
# 1. the resident agent
npm run dev:agent

# 2. the library, told to talk to it
NOTEATO_AGENT=1 npm run dev
```

What to try:

- **⌥⌘Space** → the capture HUD appears centred, over fullscreen apps, without stealing focus.
  Press again to dismiss. It is deliberately empty of controls: waveform and timer only. There is
  **no audio yet** — the waveform is an idle animation. That is Phase 2.
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
npm test            # 22 TS tests
npm run test:agent  # 14 Swift tests
npm run bench       # all three §10 benchmarks
```

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
| Transcription RTF | < 0.3× | — | Phase 3 |
| Hotkey → recording | 0 ms | — | Phase 2 |

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
