# Meeting notes, started from the app itself

Status: proposed. Narrows `electron-first-plan.md` to one shippable slice. Dictation is\
 explicitly parked — the Swift agent keeps owning it, unchanged, for the whole of this plan.

## Context

Meeting mode was built in Swift and has never run end to end. Per `STATUS.md` it is\
 "🟨 built, unverified"; `SystemAudioCapture` reports `screenRecordingGranted: false` on\
 the dev machine so no stream has ever started, `MeetingTranscript.merge` is reachable\
 only from tests, no `meeting.json` is ever written, and nothing summarises. The only user\
 -visible trace is a permanently disabled Transcript tab at\
 `src/renderer/src/components/NoteEditor.tsx:1214`.

It is also invisible: the only ways to start a meeting are `⇧⌥⌘Space` and a menu item in\
 the Swift status bar, both of which live in a process the user does not know exists.

This plan builds meetings in Electron, owned by the app, triggerable from the app.

***

## The blocker: Electron cannot show a tray today

`src/main/index.ts:158-181` `syncTrayOwnership()` **suppresses Electron's tray whenever**\
** the agent is connected** — exclusive ownership by design. `src/main/globalShortcuts.ts`\
 does the same for accelerators: `setAgentConnected(true)` and Electron stands down\
 entirely, even for `CommandOrControl+Alt+S`.

So "start a meeting from the app" is blocked before any audio code is written. There is\
 no menu bar to put it in and no accelerator Electron is allowed to register.

**Phase 1 flips ownership back to Electron.** The agent becomes dictation-only: Fn\
 listener, mic, ASR, HUD, text injection. It gives up the status item, every global\
 shortcut, and meetings. This is a small, contained change to `AppDelegate.swift` and it\
 is the direction `electron-first-plan.md` goes anyway — doing it now is not throwaway work.

***

## Where the trigger goes

The governing fact: **you are never looking at Noteato when a meeting starts.** You are in\
 Zoom, Meet, or Slack. So in-window buttons are the secondary surface, not the primary one.

| Surface                                                                       | File                                                                 | Role                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tray menu** — "Record meeting" / "End meeting"                              | `src/main/tray.ts` `buildMenu()`                                     | **Primary.** Reachable from any app. Mirrors what `AppDelegate.setUpStatusItem` offered, now in the process that owns the feature.                                                                                        |
| **Global shortcut** `⇧⌥⌘Space`                                                | `src/shared/globalShortcuts.ts` + `globalShortcuts.ts`               | **Primary.** Plain Electron `globalShortcut` handles this fine — no Fn, no CGEvent tap, no Swift. Add `MEETING_ACCELERATOR` beside `SIDEBAR_MODE_ACCELERATOR`.                                                            |
| **Recording pill** — small always-on-top indicator with elapsed time and Stop | new `src/main/recorderWindow.ts`                                     | **Required, not optional.** A recording you cannot see is a recording you forget to stop. `focusable:false`, `alwaysOnTop:'screen-saver'`, `visibleOnAllWorkspaces`. Same window shape the dictation HUD will later need. |
| **Sidebar-mode panel**                                                        | `src/renderer/src/components/SidebarModeWindow.tsx`                  | Secondary. This panel already exists to be used while another app is focused — a record button belongs here.                                                                                                              |
| **Title bar button**                                                          | `src/renderer/src/components/TitleBar.tsx` (67 lines, has 2 buttons) | Secondary. Discoverability for people who have never opened the tray.                                                                                                                                                     |

Tray icon changes appearance while recording — `TrayManager` already rebuilds its menu on\
 demand, so this is a `setImage` plus a menu rebuild.

***

## A latent bug this plan must fix first

`src/main/frontmatter.ts` reads unknown frontmatter keys into `meta` (line 33) but\
 `serializeNoteFile` (line 78) writes a **fixed allowlist of 8 keys**. Anything else is\
 silently dropped on first save.

`MeetingWriter.swift` writes `source: meeting` and `durationSeconds` into `note.md`\
 frontmatter. **The first time a user edits that note in Noteato, its identity as a meeting**\
** note is erased.** This is already true for the capture notes on disk today.

Two changes, both needed:

1. Make `serializeNoteFile` preserve unknown keys round-trip. This is a data-loss bug for

anyone who hand-writes frontmatter, meetings or not.

1. **Do not put recording metadata in frontmatter anyway.** The README's pitch is that the

vault is plain `.md` the user owns; audio paths, word timings and speaker segments are\
 machine state. Put them in SQLite (`src/main/db.ts`, new `recordings` table at\
 `user_version` 3) keyed by note path, with the heavy data staying in `meeting.json`\
 next to the audio, exactly where `MeetingWriter` already puts it.

***

## Architecture

```javascript
Tray / ⇧⌥⌘Space / pill / sidebar panel
        └─> src/main/meeting/session.ts        start, stop, discard, state
              ├─ spawn native/macos-meeting-audio   ── writes BOTH wav files itself
              ├─ src/main/recorderWindow.ts         ── the pill
              └─ on stop:
                   ├─ src/main/asr/sherpaServer.ts  ── offline WS server + Parakeet TDT
                   ├─ src/main/meeting/transcript.ts ── TS port of MeetingTranscript.swift
                   └─ writes meeting.json + note.md, inserts the recordings row
```

### One helper writes both channels straight to disk

The instinct is to pipe PCM into Node and let a renderer do the mic via `getUserMedia`.\
 For meetings that is the wrong call:

* A meeting runs 60+ minutes. A hidden renderer needs `backgroundThrottling: false` and is

still one crash, close, or OS suspension away from losing an unrepeatable recording.

* Piping an hour of PCM through Node buys nothing — nothing inspects it mid-flight.

So `native/macos-meeting-audio.swift` (~250 lines) captures **both** channels and writes\
 `audio.m4a` and `audio-system.m4a` itself, printing JSON status lines on stdout\
 (`{"level":…}` for the pill's meter, `{"error":…}` for permissions). Electron spawns,\
 watches, and signals stop.

This is mostly a **port, not new code** — it is `SystemAudioCapture.swift` (163 lines,\
 ScreenCaptureKit) plus `MicCapture.swift`'s `AVAudioEngine` tap plus\
 `MeetingWriter.swift`'s AAC writer, collapsed into one file with no AppKit, no socket, no\
 status item, no HUD. Roughly 480 lines of Swift become ~250, and the surviving 250 is a\
 plain stdio process rather than an app.

Files land in the existing capture directory shape\
 (`<vault>/YYYY-MM-DDTHH-mm-ssZ-xxxx/`) that `src/main/storage.ts:111-123`\
 (`CAPTURE_DIR`, `isCaptureNote`) already understands. No storage migration.

### Transcription is batch, after the meeting

No latency requirement here, so this uses the **offline** sherpa-onnx WS server with\
 `parakeet-tdt-0.6b-v3` (680 MB, downloaded on first meeting) — the same model quality you\
 have today, and none of the streaming-model compromises from the dictation plan. Live\
 in-meeting transcription is a later addition; the two audio files are the source of truth\
 either way, so nothing here forecloses it.

***

## Phases

### Phase 1 — hand the menu bar back to Electron

* `agent/Sources/NoteatoAgent/AppDelegate.swift`: delete `setUpStatusItem()` and every

menu item, the meeting hotkey and its transient `Esc`/`⌘Esc` registrations, and the\
 sidebar/library hotkey registrations. Keep `FnKeyMonitor`, mic, dictation, HUD,\
 injection. The agent becomes `LSUIElement` with no visible surface at all.

* `agent/Sources/AgentCore/HotkeyManager.swift`: drop the Carbon `RegisterEventHotKey`

block, keep `FnKeyMonitor`.

* Delete `SystemAudioCapture.swift`, `MeetingWriter.swift`, `MeetingTranscript.swift`,

`MeetingProbe`, and `Tests/AgentCoreTests/MeetingTests.swift` (its assertions get ported\
 in Phase 4, not lost).

* `src/main/index.ts`: delete `syncTrayOwnership()` (`:158-181`) and its 4 s fallback

timer; the tray is unconditionally Electron's. Keep the agent client for `hudDidShow`/\
 `quit` coordination.

* `src/main/globalShortcuts.ts`: delete `setAgentConnected` and `agentOwnsShortcuts`.

Electron registers every accelerator, always. The class comment already anticipates this.

**Ship and use this on its own for a day.** If the tray and `⌘⌥S` behave with the agent\
 still running dictation, the risky coupling is gone before any audio work starts.

### Phase 2 — the trigger and the pill, with no audio behind them

Build the whole control surface against a stub session that just tracks state and a timer.

* `src/main/meeting/session.ts` — a state machine (`idle | recording | transcribing`),

`start()`, `stop()`, `discard()`, and change events.

* `src/main/tray.ts` — "Record meeting" / "End meeting" driven off session state.
* `MEETING_ACCELERATOR` in `src/shared/globalShortcuts.ts`, registered in

`GlobalShortcutManager`. `shortcutDisplay()` already renders it for the tray label.

* `src/main/recorderWindow.ts` + a `?recorder=1` branch in `src/renderer/src/App.tsx:32`

alongside the existing `?sidebar=1` — elapsed time, a level meter reusing\
 `src/renderer/src/components/Waveform.tsx`, Stop and Discard.

* Buttons in `TitleBar.tsx` and `SidebarModeWindow.tsx`.

Getting this right before audio exists means every start/stop edge case is debugged\
 without a 40-minute recording in the loop.

### Phase 3 — audio capture

* `native/macos-meeting-audio.swift` as described above, built by

`scripts/build-native.mjs` (`swiftc -O` + ad-hoc `codesign`) into `resources/bin/`,\
 shipped via `extraResources`.

* `src/main/meeting/audioProcess.ts` — spawn, parse stdout JSON lines, feed levels to the

pill, surface permission errors.

* **Screen Recording permission UX.** `CGPreflightScreenCaptureAccess()` is the silent

check; on denial, deep-link `x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture`\
 exactly as `AppDelegate.explainScreenRecording()` does. This prompt now names **Noteato**,\
 not NoteatoAgent — and macOS requires a **restart of the app** after granting it. Say so\
 in the UI; this is the single most likely place a user gets stuck, and it is why the\
 feature has never run.

* Mic permission also now attributes to Noteato.app. `NSMicrophoneUsageDescription` is

already in `electron-builder.yml`; add `NSAudioCaptureUsageDescription`.

### Phase 4 — transcription and the merge

* `scripts/download-sherpa-onnx.mjs` — extract `sherpa-onnx-offline-websocket-server` plus

`*.dylib` from the k2-fsa release into `resources/bin/`. **Ad-hoc re-sign**\
 `libonnxruntime`: upstream ships an invalid arm64 signature and dyld SIGKILLs the load.\
 Copy `adhocSign` from OpenWhispr `scripts/download-sherpa-onnx.js:67`.

* Parakeet TDT downloads on first meeting into `app.getPath('userData')/models/`, with

progress in the pill and a settings entry. 680 MB is a real onboarding cost — it should\
 start downloading when the user first opens meeting settings, not when they hit Stop on\
 a recording they need transcribed now.

* `src/main/asr/sherpaServer.ts` — spawn on demand, free port, readiness off stderr, WS

client, idle shutdown, PID file so a crashed Electron leaves no orphan. Port\
 OpenWhispr `src/helpers/parakeetWsServer.js` and `sidecarPidFile.js`.

* `src/main/meeting/transcript.ts` — TS port of `MeetingTranscript.swift` (145 lines):

`merge(mine:theirs:)` interleaving by shared-origin timestamps, `segments(pauseSeconds: 0.9)`,\
 `markdown()` rendering `**Name** · m:ss`. Speakers stay channel-derived `me`/`them`,\
 no diarization.

* **Port `agent/Tests/AgentCoreTests/MeetingTests.swift` (146 lines) to vitest in the same

commit.** It is pure data transformation, so the port is mechanical, and it is the one\
 genuinely well-tested piece of the Swift package. Losing that coverage would be the real\
 cost of this migration.

### Phase 5 — surface it in the library

* `src/main/db.ts` — `recordings` table at `user_version` 3: note path, capture dir,

duration, transcript status, created at.

* `serializeNoteFile` preserves unknown frontmatter keys (see above).
* `NoteEditor.tsx:1117` — `hasRecording` stops being a hardcoded `false` and reads from a

new `notes:getRecording` IPC channel. The tab, its panel (`:1306-1320`), and the styling\
 already exist.

* Render the merged transcript in the existing `note-transcription-surface`.
* Summarisation reuses `src/main/ai.ts` (`completeAi`/`streamAi`) with a new action in

`src/renderer/src/ai/noteActions.ts`, writing into the note body. No new provider work.

***

## Verification

1. **Phase 1** — with the agent running, confirm the Noteato tray icon appears and `⌘⌥S`

toggles the sidebar. Confirm Fn dictation still works. This is the regression risk.

1. **Phase 2** — start/stop from tray, shortcut, pill, and title bar. Kill the app

mid-"recording" and confirm it comes back to `idle`, not a stuck state.

1. **Phase 3** — the decisive test, and the one that has never been run: grant Screen

Recording, restart, join a real call, record 5 minutes. Confirm **both** `audio.m4a`\
 and `audio-system.m4a` are non-empty and that the system file contains the other\
 party, not your own mic bleeding through. Then run it for a full hour and confirm\
 nothing drifts, throttles, or truncates.

1. **Phase 4** — `npm run test` with the ported merge tests. Transcribe the 5-minute

recording and eyeball the `**Me** · 0:04` output for correct speaker attribution and\
 plausible timings.

1. **Phase 5** — open the note, confirm the Transcript tab is enabled and renders, edit

the note body, save, and confirm the recording link survives (this is the frontmatter\
 bug's regression test).

1. **Packaged** — `npm run build:mac:arm64`, launch from `/Applications`, confirm the

permission prompts name Noteato and that the helper is found at its `extraResources`\
 path rather than the dev path.

***

## Explicitly out of scope

* All dictation work. The agent keeps Fn, mic, FluidAudio/Parakeet, the HUD, and text

injection exactly as they are.

* The streaming ASR model swap from `electron-first-plan.md` — meetings are batch, so

Parakeet TDT stays.

* Deleting `agent/`, `agentClient.ts`, `agentLauncher.ts`, or the socket protocol.
* Live in-meeting transcription, diarization beyond the two channels, and calendar

integration.

## Open items

* **Meeting detection.** OpenWhispr auto-detects calls (`meetingProcessDetector.js`,

`meetingDetectionEngine.js`) and offers to record. Worth considering once manual\
 recording is proven — but manual first, or you are debugging detection and capture at\
 the same time.

* **Echo.** `excludesCurrentProcessAudio` keeps Noteato out of the system tap, but if the

user is on speakers their mic picks up the other party too, so both channels contain\
 them. OpenWhispr ships a whole C++ AEC helper for this. Start by measuring how bad it\
 actually is on headphones vs speakers before deciding it is a problem worth solving.

* **What happens on quit mid-recording.** `app.quit()` during a recording must stop the

helper and commit, not orphan a half-written m4a. `will-quit` already exists at\
 `src/main/index.ts:762`.
