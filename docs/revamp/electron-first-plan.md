# Electron-first plan: retire NoteatoAgent.app

Status: proposed. Supersedes the agent-architecture direction in `phase-plan.md` from Phase 1 onward.

## Context

`revamp/agent-architecture` built a resident Swift menu-bar application — 4,750 lines
across a SwiftPM package with its own AppKit status item, HUD panel, hotkey manager,
ASR engine, Unix socket protocol, note writer, and six probe/bench executables. Electron
became a client of it. The result is two apps, two permission identities, two build
toolchains, and a socket protocol between them, for a product whose value is 17k lines
of React and CSS.

Meanwhile the native side has never paid off end to end. Per `STATUS.md`: meetings have
never run (Screen Recording was never granted), `MeetingTranscript.merge` is reachable
only from tests, `NoteatoTranscribe` is built and shipped but no process ever spawns it,
and `captureTranscribed` is a dead message type. Captures land as audio plus a stub
`note.md` and stop there.

The goal is to move all logic, state, and UI into Electron and reduce the native surface
to the few things macOS genuinely will not expose to a Chromium process.

## What must stay native, and why

OpenWhispr is the reference for this plan, but it is not "fully Electron" — on macOS it
ships five compiled Swift helpers plus a C++ AEC helper. The difference is shape, not
presence:

| | Noteato today | OpenWhispr |
|---|---|---|
| Native code | 4,750 lines; a full `.app` with menu bar, HUD, hotkeys, ASR, socket, note writer | 1,111 lines across 5 single-file `swiftc` scripts |
| Native's job | owns the product | dumb pipes: print `FN_DOWN`, stream PCM, post one ⌘V |
| Owns logic/state/UI | Swift | Electron |

Three things have no Electron API on macOS:

1. **Fn / Globe key.** `globalShortcut` cannot see it. Needs a `CGEvent` tap.
   (OpenWhispr: `resources/macos-globe-listener.swift`, 160 lines.)
2. **System audio.** `session.setDisplayMediaRequestHandler`'s `audio: 'loopback'` is
   **Windows-only**. macOS needs ScreenCaptureKit or a Core Audio process tap.
   (OpenWhispr: `resources/macos-audio-tap.swift`, 423 lines.)
3. **Synthesising ⌘V into another app.** Optional — `osascript -e 'tell application
   "System Events" to key code 9 using command down'` works with no compilation. A
   17-line binary is only a latency optimisation; OpenWhispr ships both and falls back
   (`src/helpers/clipboard.js:844-884`).

Target: **~320 lines of Swift, none of it an app.** Everything else — hotkey routing,
HUD, mic, ASR, notes, meetings, tray, permissions UX — moves into the Electron main
process and renderer.

## Target architecture

```
Electron main
├── dictation/fnListener.ts   spawn native/macos-fn-listener  → "FN_DOWN"/"FN_UP" on stdout
├── dictation/paste.ts        clipboard.writeText → spawn macos-paste (osascript fallback)
├── dictation/hud.ts          BrowserWindow (focusable:false, alwaysOnTop:'screen-saver')
├── asr/parakeetServer.ts     spawn sherpa-onnx-offline-websocket-server, talk WS
├── meeting.ts                mic (getUserMedia) + spawn native/macos-system-audio (PCM on stdout)
└── meeting/transcript.ts     TS port of MeetingTranscript.merge/segments/markdown

native/  (3 single-file swiftc targets, ~320 lines total, no bundle, no .app)
```

Mic audio comes from `getUserMedia` in the HUD renderer — no native mic helper needed.

### TCC consequence — call this out in release notes

Permissions today attach to `com.noteato.agent`. Bare helpers spawned as children of
Electron attribute to **Noteato.app** instead (the responsible process). That is the
better end state — one identity, one prompt each for Microphone / Accessibility /
Screen Recording — and it is what OpenWhispr does. But **upgrading users will be
re-prompted**, and each helper must be ad-hoc signed or ScreenCaptureKit will refuse to
start. `build-agent.sh` already does this signing dance; reuse the pattern.

---

## Phase 0 — baseline

Working tree is dirty: 18 modified files across `agent/Sources/**`, `src/main/{index,
tray,agentClient,agentLauncher}.ts`, `electron-builder.yml`, `scripts/build-agent.sh`,
`docs/revamp/*`. Commit or stash on `revamp/agent-architecture` first so the Swift
deletion is a reviewable diff, then branch `revamp/electron-first`.

## Phase 1 — three stdio helpers replace the agent app

New `native/` directory; `agent/` is deleted in Phase 5.

- `native/macos-fn-listener.swift` (~120 lines) — port `FnKeyMonitor` out of
  `agent/Sources/AgentCore/HotkeyManager.swift:*`. Same `CGEvent.tapCreate` on
  `.flagsChanged` filtering `kVK_Function` and swallowing the event so the Character
  Palette does not open. Prints `FN_DOWN` / `FN_UP` / `FN_INTERRUPTED`, `fflush(stdout)`
  each line. Shape: OpenWhispr `resources/macos-globe-listener.swift`.
- `native/macos-system-audio.swift` (~180 lines) — port
  `agent/Sources/AgentCore/SystemAudioCapture.swift` (ScreenCaptureKit `SCStream`,
  `capturesAudio`, `excludesCurrentProcessAudio`, the 2×2/1fps display-filter trick).
  Takes `--sample-rate` / `--chunk-ms`, writes raw int16 mono PCM to stdout, one-line
  JSON errors to stderr, keeps `CGPreflightScreenCaptureAccess` for the silent check.
  Consumption shape: OpenWhispr `src/helpers/audioTapManager.js:149-190`.
- `native/macos-paste.swift` (17 lines) — verbatim from OpenWhispr
  `resources/macos-fast-paste.swift`.

`scripts/build-native.mjs` compiles each with `swiftc -O -o resources/bin/<name>`, then
`codesign --force --sign -`. Replaces `scripts/build-agent.sh`.

## Phase 2 — dictation moves into the main process

Replaces `AppDelegate.swift`, `MicCapture.swift`, `CaptureHUD.swift`,
`DictationSession.swift`, `TextInjector.swift`, `PreRollBuffer.swift`.

- `src/main/dictation/fnListener.ts` — EventEmitter over the helper's stdout with
  arch check, `chmod +x` repair, and bounded auto-restart. Port
  OpenWhispr `src/helpers/globeKeyManager.js` (337 lines) nearly as-is.
- `src/main/dictation/hud.ts` — the drawer as a BrowserWindow: `frame:false`,
  `transparent:true`, `focusable:false`, `alwaysOnTop:'screen-saver'`, `skipTaskbar`,
  `hasShadow:false`, plus `setVisibleOnAllWorkspaces({visibleOnFullScreen:true})`.
  `focusable:false` is what keeps the user's caret in place — the property
  `DictationDrawer`'s non-activating `NSPanel` provided. Renderer route `?hud=1`
  alongside the existing `?sidebar=1` branch in `src/renderer/src/App.tsx:32`,
  reusing `src/renderer/src/components/Waveform.tsx` for the level meter.
  **The HUD gains a live transcript area** — this is new UI, not a port. The Swift
  drawer only ever showed a waveform (96×40 resting, 318×72 active); it now has to
  render growing partial text, which means a wider expanded state and a sensible
  overflow/truncation rule. Reference: OpenWhispr `src/components/TranscriptionPreviewOverlay.tsx`.
- Mic capture in the HUD renderer: `getUserMedia` → `AudioWorklet` → downsample to
  16 kHz int16 → IPC to main. Pre-roll ring buffer is a direct TS port of
  `PreRollBuffer.swift` (126 lines, already unit-tested — port the tests too).
- `src/main/dictation/paste.ts` — `clipboard.writeText`, snapshot and restore the prior
  clipboard after ~250 ms, spawn `macos-paste`, fall back to `osascript` when the binary
  is missing or untrusted. Bring over `DictationSpacing.prepare` from
  `TextInjector.swift` — the leading-space logic is the one piece of text handling worth
  keeping.

**Drop the AX injection path.** `TextInjector`'s AX `kAXSelectedText` route and value
splicing exist to support injecting confirmed phrases into the target app *mid-utterance*.
Phase 3 keeps streaming ASR but routes partials to Noteato's own HUD instead, so exactly
one clipboard paste happens per dictation — on release. That removes the need for AX
insertion entirely, along with its three fallback routes and `reportDictationFailure`.
This is also what OpenWhispr does: partials go to its overlay
(`useAudioRecording.js:154`), and the target app gets a single `safePaste` on completion
(`:186`). Its `fromStreaming: true` flag only shortens the paste delay to 15 ms — it is
not incremental injection.

## Phase 3 — streaming sherpa-onnx replaces FluidAudio

Target feel: words appear in the HUD as you speak; on release the decode is already done,
so the paste lands in tens of milliseconds with no spinner.

### This means giving up Parakeet TDT

`parakeet-tdt-0.6b-v3` is an **offline-runtime** model in sherpa-onnx. FluidAudio's
`SlidingWindowAsrManager` was faking streaming by sliding a window over it; sherpa-onnx
will not do that for you, and re-running an offline decode per window through the WS
server is far too expensive. Real streaming requires the online server plus an online
model:

| Model | Size | Languages |
|---|---|---|
| `sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11` | 650 MB | multilingual |
| `sherpa-onnx-nemotron-speech-streaming-en-0.6b-560ms-int8-2026-04-25` | 632 MB | English |

Default to the multilingual one — 18 MB more for no language ceiling. **Note the `560ms`
in both names: that is the model's chunk size, so ~0.5 s is the floor on how far the HUD
text trails your voice.** Budget a side-by-side accuracy check against today's Parakeet
build before committing; this is a genuine model change, not a repackaging.

### Pieces

- `scripts/download-sherpa-onnx.mjs` — fetch
  `sherpa-onnx-v{VER}-osx-universal2-shared.tar.bz2` from the k2-fsa releases, extract
  **both** `sherpa-onnx-online-websocket-server` (dictation) and
  `sherpa-onnx-offline-websocket-server` (meetings, Phase 4) plus the `*.dylib` set into
  `resources/bin/`. The binaries are small — ship both unconditionally.
  **Ad-hoc re-sign `libonnxruntime`** — upstream ships an invalid arm64 signature and
  dyld SIGKILLs the load. OpenWhispr's `scripts/download-sherpa-onnx.js:67` `adhocSign`
  handles exactly this; copy it.
- `src/main/asr/sherpaServer.ts` — handles both runtimes. Spawn on demand with
  `--tokens/--encoder/--decoder/--joiner/--port`, find a free port, resolve readiness off
  stderr, WS client, idle shutdown, PID file so a crashed Electron does not orphan it.
  Port OpenWhispr `src/helpers/parakeetWsServer.js:95-140` and `sidecarPidFile.js`.
  **Copy the online flags verbatim** — they are load-bearing and non-obvious:
  `--num-work-threads=2`, `--loop-interval-ms=2` (the default 10 ms tick adds idle time to
  faster-than-realtime decode), and `--warm-up=0` (a nonzero warm-up *aborts startup* for
  non-zipformer2 models; warm up app-side instead).
- `src/main/asr/onlineStream.ts` — the segment accumulator. The server refines a segment
  before its endpoint, so it is latest-wins per `segment` id, joined in first-arrival
  order plus the trailing partial. Port OpenWhispr `src/helpers/parakeetWsResult.js`
  `createOnlineAccumulator` (~50 lines) directly, plus its idle-timeout backstop for a
  server that goes quiet after `Done`.
- **Keep the server warm.** Spawn + model load is seconds; that cannot happen on Fn-down.
  Start it lazily on first dictation, then hold it with an idle timeout measured in
  minutes. Note this contradicts the old agent's 46.7 MB idle footprint — the ASR server
  resident with a 650 MB int8 model is the real memory cost of this design, and
  `bench/memory` should be re-run against it.

Settings: add `asrEngine: 'local' | 'deepgram'` to `src/main/settings.ts` and
`src/shared/types.ts`. Keep the existing Deepgram path
(`src/renderer/src/dictation/useDictation.ts`, 208 lines, works today) — it is the
zero-download default until the model is on disk.

## Phase 4 — meetings, finally end to end

- `src/main/meeting.ts` orchestrates: mic via the HUD renderer's `getUserMedia`, system
  audio via `macos-system-audio` stdout. Two channels, "me" and "them", exactly as
  `MeetingWriter.swift` splits them.
- Write `audio.m4a` / `audio-system.m4a` per the existing on-disk shape. If encoding in
  Node is friction, write WAV intermediates and encode once at commit via `ffmpeg-static`.
- **Meetings use the *offline* server and keep Parakeet TDT** (`parakeet-tdt-0.6b-v3`,
  680 MB). Long-form accuracy is what matters here and streaming models see less context,
  so this is worth a second model rather than reusing the dictation one. Both models
  download lazily and independently — dictation's on first Fn-hold, this one on first
  meeting — so a user only ever pays for the feature they reached for. Worst case both
  are present: ~1.33 GB.
- Transcribe both channels through the offline WS server, then port
  `MeetingTranscript.swift` (145 lines — `merge`, `segments(pauseSeconds: 0.9)`,
  `markdown()`) to `src/main/meeting/transcript.ts`. **Port
  `agent/Tests/AgentCoreTests/MeetingTests.swift` to vitest at the same time** — that
  logic is the one genuinely valuable, well-tested piece of the Swift package, and it is
  pure data transformation, so the port is mechanical and the coverage carries over.
- Wire the disabled Transcript tab at `src/renderer/src/components/NoteEditor.tsx:1212-1317`.
- Summarisation: reuse `src/main/ai.ts` (`completeAi`/`streamAi`) with a new action in
  `src/renderer/src/ai/noteActions.ts`.

This is where the plan delivers something that has never worked, not just a refactor.

## Phase 5 — delete, and collapse the glue

**Delete outright:** `agent/` (all 4,750 lines + 1,030 lines of tests),
`src/main/agentClient.ts` (158), `src/main/agentLauncher.ts` (88),
`resources/NoteatoAgent.app`, `scripts/build-agent.sh`, the `agent` job in
`.github/workflows/ci.yml`, and the agent entries in `.vscode/launch.json`.

**Collapse in `src/main/index.ts`:** the `AgentClient` block at `:70-124`,
`syncTrayOwnership()` at `:158-181` (the tray is now unconditionally Electron's — delete
the 4 s fallback timer), the startup dance at `:738-743`, and `:762`. The
`settingsChanged` send at `:623` goes away; main reads settings directly.

**Simplify:** `src/main/globalShortcuts.ts` — drop `setAgentConnected`/`sync` exclusive
ownership; Electron owns every shortcut. `src/main/tray.ts` — the tray menu takes over
what `AppDelegate.setUpStatusItem` had: Dictate, Record meeting, Open Library, Quit.

**Keep:** `src/main/storage.ts:111-123` (`CAPTURE_DIR` regex, `isCaptureNote`) — the
on-disk capture format is unchanged, and existing user data depends on it.

**`package.json`:** remove `build:agent`, `build:agent:release`, `test:agent`,
`dev:agent`, `bench:panel`, `bench:asr`, `transcribe`, `probe:capture`, `probe:inject`,
`probe:meeting`. Add `build:native`, `download:sherpa`. Wire both into `build:mac`,
`build:mac:arm64`, `build:mac:intel`, and `release` — **fixing the existing bug** where
`build:mac` and `build:mac:intel` skip the native step entirely and ship whatever stale
binary is on disk.

**`electron-builder.yml`:** replace the `extraFiles` → `Library/LoginItems/NoteatoAgent.app`
entry with `extraResources` from `resources/bin/`. Add
`NSAudioCaptureUsageDescription` to `mac.extendInfo`. Drop the stock Electron
`NSCameraUsageDescription` boilerplate noted in the audit while you are in there.

## Net effect

| | Before | After |
|---|---|---|
| Swift | 4,750 lines, a SwiftPM app + 6 probes + 1,030 lines of tests | ~320 lines, 3 stdio scripts |
| Processes | Electron + NoteatoAgent.app | Electron + short-lived helpers + ASR server on demand |
| IPC surfaces | Electron IPC **and** a versioned Unix socket protocol | Electron IPC only |
| Permission identities | `com.noteato.app` + `com.noteato.agent` | `com.noteato.app` |
| Toolchains | npm + SwiftPM | npm + one `swiftc` invocation |
| Meetings | never ran | working |
| Idle memory | 46.7 MB (agent) | higher — a warm ASR server holding a 650 MB int8 model |

All React/CSS is untouched. Renderer changes are additive: the `?hud=1` route (including
its new live-transcript area), the model-download UI in `SettingsModal.tsx`, and enabling
the Transcript tab.

## Verification

Per phase, not just at the end:

1. **Phase 1** — run each helper standalone from a terminal: `./resources/bin/macos-fn-listener`
   should print `FN_DOWN`/`FN_UP`; `./resources/bin/macos-system-audio --sample-rate 16000
   --chunk-ms 100 | hexdump -C | head` should show non-zero PCM while something plays.
   This is what the deleted `MeetingProbe`/`InjectProbe` were for — a terminal replaces them.
2. **Phase 2** — `npm run dev`, hold Fn, confirm the HUD appears and the caret does not
   move in TextEdit. Re-measure the Fn→HUD latency the old `PanelBench` gated at 80 ms
   (it was 29 ms cold); a BrowserWindow show is slower, so measure before assuming parity.
3. **Phase 3** — three separate measurements, because "instant" is the whole point:
   - *Partial latency*: time from speaking a word to it appearing in the HUD. The 560 ms
     model chunk is the floor; anything much above it means the audio path is adding lag.
   - *Release-to-paste*: time from Fn-up to text landing in the target app. Should be tens
     of milliseconds. If it is not, the stream is not keeping up with realtime and the
     design premise fails — check `--loop-interval-ms` and thread counts first.
   - *Accuracy*: run the same phrase set against today's Parakeet build. This is a
     **different model** (Nemotron streaming, not Parakeet TDT), so treat a regression as
     expected-until-disproven rather than a bug.
   Then dictate into TextEdit, Notes, and a browser field to confirm the paste path.
4. **Phase 4** — start a real call, record, confirm `audio.m4a` + `audio-system.m4a` are
   both non-empty, `meeting.json` is written, and the Transcript tab renders `**Me** · 0:04`
   style output. This has never once been exercised — budget time here.
5. **Regression** — `npm run typecheck && npm run test`; the existing 6 vitest suites plus
   the ported `PreRollBuffer` and `MeetingTranscript` tests.
6. **Packaged build** — `npm run build:mac:arm64`, then launch from `/Applications` and
   verify each permission prompt names **Noteato** and that dictation works after the
   Gatekeeper `xattr -cr` step the README documents.

## Open items

- **Upgrade path.** Existing installs have `NoteatoAgent.app` in
  `Contents/Library/LoginItems/` and possibly a running process. First launch of the new
  build should kill any stale `com.noteato.agent` process and delete the stale socket at
  `~/Library/Application Support/Noteato/agent.sock`.
- **Two model downloads** (650 MB streaming for dictation, 680 MB Parakeet TDT for
  meetings) are a real onboarding cost the Swift build hid — FluidAudio downloaded
  silently on first use. Lazy per-feature download is the plan; confirm Deepgram stays the
  dictation default until the local model is on disk.
- **Warm-server memory.** Holding the online server resident to keep Fn-down instant is
  the price of this design. Decide the idle-shutdown window, and whether the server should
  be pre-warmed at launch or on first Fn-hold — the first dictation after a cold start will
  otherwise be the one slow one.
- **Streaming model accuracy is unproven for your use.** If Nemotron streaming measurably
  underperforms Parakeet TDT on your own phrases, the fallback is the design you did not
  pick: offline Parakeet with a single paste on release, and a HUD that shows a level
  meter rather than live text. Worth knowing that exit exists before Phase 3 starts.
- **Intel Macs.** `build-agent.sh` was hard-coded `--arch arm64`. Building the helpers
  universal (`-target arm64-apple-macos14 -target x86_64-apple-macos14`) is cheap;
  sherpa-onnx already ships universal2. Decide whether Intel is supported.
