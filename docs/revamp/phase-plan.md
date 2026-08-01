# Noteato Revamp — Build Plan

Companion to [`phase-0-audit.md`](./phase-0-audit.md). **Live progress and local run instructions
are in [`STATUS.md`](./STATUS.md)** — this file is the plan, that one is the state.

Follows the brief's §12 phase structure, with three changes the audit forced:

1. **A groundwork phase (0.5) before Phase 1.** There is no test runner in the repo, so §10's CI
   gates have nothing to hang on. That has to exist before the first phase that claims a number.
2. **A new Phase 1.5: the identity migration, as a standalone refactor.** The audit's biggest hidden
   cost is that notes are keyed by *path* everywhere and `save()` renames files on title change.
   Doing that conversion at the same time as the on-disk format change would mix the largest renderer
   churn in the project with a new file layout. Split, it is two boring changes instead of one risky one.
3. **Signing moves off the critical path.** It gates the *release* of Phases 1–4, not the development
   of any phase (see audit §5a). Parallel track, start early for lead time, blocks nothing.

Sizes are relative effort, not calendar: **S** ≈ a sitting, **M** ≈ a few days, **L** ≈ a week-plus,
**XL** ≈ the thing that will slip.

---

## Decisions — resolved

**1. AI: one floating panel for the whole layout, following the focused note.** Not a deletion — a
reshape. The two chat surfaces (`AgentPanel` in a pane, and the second assistant in `HomeView`) are
gone. In their place, a single panel holding dictation and the note-level AI, whose subject is
whichever note pane has focus — and which names that note, because a surface acting on "the current
note" has to say which one.

- **Enhance** → the four whole-note actions, one result, Copy / Insert.
- **Ask** → a conversation about the focused note, threaded per note.
- **Selection actions stay in the bubble menu**, where the text being acted on is already visible.

It is load-bearing later, not cosmetic: **this panel is the surface §9's traceability requirement
lands on.** Summaries and action items carrying timestamp ranges back into the transcript need
somewhere to be invoked from and somewhere to render.

*Note on §11:* the brief rules out a chat surface outright. `Ask` is one, scoped and threaded per
note. Built as decided; flagged here so it stays a decision rather than becoming drift.

**2. Tags, scratch notes and the sidebar panel all stay.** They are shipped features with user data
on disk. This is an explicit, deliberate exception to §11's "no tag taxonomies" and to reading §4.2's
"one flat stream" as *the app has exactly one store*. Recorded here so the deviation is a decision
rather than a drift.

**3. Reminders — assumed kept**, following from (2): `ReminderScheduler` serves both notes and
scratch notes, and keeping the sidebar keeps the surface they appear on. The §4.3 `note.md`
front-matter therefore carries `reminderAt` alongside `tags` and `pinned`. Correct this if the
intent was narrower; nothing else in the plan depends on it.

### What (2) changes downstream

- **Phase 2:** the new `note.md` front-matter must carry `tags`, `pinned`, `fullWidth`, `reminderAt`.
  The hand-rolled `key: value` parser survives Phase 2 intact — it only has to be replaced in Phase 4,
  when §9's timestamp ranges introduce nesting it can't express.
- **Phase 4 — the one with teeth:** if scratch notes persist as a separate store, **retrieval has to
  index them too.** Otherwise the app ships the exact gap the product exists to close — a thing you
  captured, that search cannot find, because it landed in the other store. Non-negotiable if (2)
  holds; see the Phase 4 section.
- **Phase 1:** the sidebar keeps `⌘⌥S`, so the agent owns at least two global hotkeys from day one
  (capture + sidebar), and dictation later. `GlobalShortcutManager` is *deleted* in Phase 1, not
  merely bypassed — the agent becomes the single owner of every global shortcut.

---

## Parallel track — Apple Developer Program

No code dependency. Gates the release of Phases 1–4 only. Start now because enrollment has a lead
time; nothing waits on it. Deliverables when it lands: Developer ID cert, re-enable
`electron-builder.signed.yml.disabled` and `release-signed.yml.disabled`, `hardenedRuntime: true`,
notarization in the release workflow. See audit §5a for why this matters more than it looks
(TCC re-prompting on every update).

---

## Phase 0.5 — Groundwork and the AI panel · M — ✅ DONE

Two independent pieces. Both are pre-agent work in the existing codebase, and both should land
before Phase 1.5, which is easier once (B) has removed a pane type.

### A. Test and benchmark groundwork · S — ✅ done

Nothing here is a feature. All of it is a prerequisite for measuring anything.

- Vitest for the TS side; a `test` script; `npm test` in CI.
- A Swift package skeleton at `agent/` with swift-testing wired, built in CI.
- Port the three audit harnesses into the repo as real benchmarks:
  `bench/panel-latency` (Swift), `bench/search` (the 5k-note corpus generator), `bench/memory`.
  These become the §10 gates; they already exist as throwaway scripts and produced the audit numbers.
- Archive `plan.md`, `roadmap.md`, `tldraw-integration.md` → `docs/archive/`. They describe folders,
  iCloud sync and a hosted AI proxy; `roadmap.md` Phase 1 is literally the thing §11 forbids.

### B. The AI panel · M — ✅ done (shipped as one floating panel, not a bar — see STATUS.md)

- `NoteAiPanel`, mounted once in `MainLayout`: dictation + Enhance + Ask, floating over the layout.
- Subject = the focused note pane; a non-note pane leaves it null and the panel says so.
- `ai/client.ts` and the `ai:stream` IPC channel are reused unchanged.
- Removed the assistant as a *pane type* (`AgentPanel` in `panes.ts`) and the `HomeView` assistant.
- Collapsed three AI settings flags to one; dropped `ss/assistant.png`.

**Sequencing note** — (B) landed before Phase 1.5, so `panes.ts` has one fewer case for the identity
refactor to carry.

**Proof** — verified in the running app: one panel, subject follows focus across panes, Ask opens a
composer with no insert affordance, bubble menu intact. Tests and benchmarks green.

**Risk** — CI runs on shared `macos-latest` runners, where absolute timings are noisy. Recommend the
gate assert the §10 ceiling (80 ms / 150 ms) on a **median of N runs**, and publish the raw number as
a build artifact so drift is visible before it trips the gate. A hard fail on a single noisy sample
will make the build flaky, and a flaky perf gate gets disabled within a month.

---

## Phase 1 — Agent skeleton · M — ✅ DONE (29 ms cold, 46.7 MB, 0.0% CPU)

Prove the process model and the latency. No audio.

**Work**

- `agent/` SPM executable `NoteatoAgent`: `LSUIElement`, `NSStatusItem`, no Dock presence.
- Hotkey via `RegisterEventHotKey` — deliberately *not* `CGEventTap`, which would require
  Accessibility permission this phase hasn't earned yet.
- The HUD: borderless `.nonactivatingPanel` `NSPanel`, 420×90, `.statusBar` level,
  `[.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]`. Empty content — this phase measures the
  panel, not the waveform.
- IPC server: Unix socket at `~/Library/Application Support/Noteato/agent.sock`, 4-byte big-endian
  length prefix + UTF-8 JSON. Message set for this phase: `hello`, `openLibrary`, `ping`.
- Electron client: replace `GlobalShortcutManager` with an agent client. Agent launches Electron
  lazily on `openLibrary`.
- Feature flag `NOTEATO_AGENT=1` — both paths coexist until Phase 3 (see brief §2's migration path).

**Proof** — against §10: hotkey→HUD visible p95 **< 80 ms**; agent idle RSS **< 150 MB**; agent idle
CPU **< 1 %**. The audit's probe measured 23 ms cold / 1.6 ms warm and 33 MB resident for exactly
this panel, so the budget has roughly 3.5× headroom. If Phase 1 misses it, something is wrong with
the implementation, not the target.

**The one real decision this phase forces — bundle layout.** The brief doesn't cover it. Today
`Noteato.app`'s main executable *is* Electron, so "agent is resident, Electron is lazy" inverts the
bundle. Three options; I recommend the third:

| | |
|---|---|
| Two separate `.app` bundles | Two signatures, two updaters, two things in `/Applications`. No. |
| Agent as the bundle's main executable | Matches the brief most literally, but electron-builder has no supported way to produce it — `afterPack` surgery, and the release pipeline becomes bespoke. |
| **Agent as an embedded helper** in `Contents/Resources`, registered as an `SMAppService` login item | One bundle, one signature, existing release pipeline intact. Residency comes from the login item, not from being `argv[0]`. Double-clicking the app opens the library, which is what users expect anyway. |

**Also** — packaging a Swift binary into the DMG needs `extraResources` plus a `scripts/build-agent.sh`,
and `npm run dev` needs to build and launch the agent alongside `electron-vite dev`. Small, but it is
real work that's easy to leave until it blocks someone.

**Watch** — `runtimeSettings()` currently forces the tray and the only global shortcut off until
`onboardingCompleted`. An always-resident agent inverts that assumption; check the first-run flow at
the start of this phase, not the end.

**Shortcut ownership** — the sidebar panel is staying, so `⌘⌥S` stays with it and the agent owns two
global hotkeys from day one, three once dictation lands. `GlobalShortcutManager` is deleted here, not
bypassed: Electron's `globalShortcut` stops being used entirely and the agent becomes the single
registrar. Two processes racing to register the same accelerator is a bug that only shows up on
someone else's machine.

---

## Phase 1.5 — Identity migration · L — ⬜ NEXT

A pure refactor. No new features, no on-disk change, no user-visible difference. This exists purely
to keep Phase 2 from becoming an XL.

**Work**

- `NoteStore` gains an id→path index in SQLite, rebuilt on scan.
- The IPC surface moves from `notes.read(path)` to `notes.read(id)` — ~15 of the ~55 channels.
- Renderer follows: `panes.ts`, `MainLayout`, `Sidebar`, `SearchModal`, `NoteEditor`, preload types.
- `save()` stops treating a rename as an identity change.

**Proof** — the app behaves identically; typecheck and tests green; a test asserts that renaming a
note preserves every open pane's reference to it (the bug this refactor is really about).

**Why it's L** — it touches nearly every renderer file. Nothing about it is hard; there is just a lot
of it, and it is the single easiest thing in this plan to under-scope. The audit flagged it as the
largest piece of Phase 2; pulling it out is what makes Phase 2 estimable.

---

## Phase 2 — Capture path · L

**Work**

- `AVAudioEngine` mic tap, continuously installed.
- Ring buffer: fixed allocation, no per-frame heap churn. At 48 kHz mono Float32, 15 s is **2.9 MB** —
  irrelevant against the 150 MB budget, so size it for the max and never reallocate.
- Menu bar indicator with honest states: listening / paused / recording. §3 is explicit that a user
  must never be unsure whether the mic is hot — this is the part that decides whether the feature
  reads as magic or as spyware.
- "Pause listening" kill switch; auto-pause on screen lock (`com.apple.screenIsLocked` via
  `DistributedNotificationCenter`). Buffer discarded on pause, quit, and every commit. Never written.
- Pre-roll length setting, 0–15 s, default 10, where **0 genuinely closes the stream** rather than
  buffering and discarding.
- HUD gets its waveform + elapsed timer. `Esc` / hotkey commits, `Cmd+Esc` discards.
- Commit path: write the §4.3 note directory, AAC-encode to `audio.m4a`.
- Migration: flat `<slug>.md` → `<timestamp>-<hash>/` directories. Reconcile-on-launch for notes
  deleted in Finder.

**Proof** — a test plays a known tone, fires the hotkey *after* the tone ends, and asserts the tone is
present in the committed audio. That single test is the whole feature. Plus: buffer is empty after
pause/quit/commit; `0` setting leaves no open input stream.

**Risk** — the migration is destructive and runs against people's real notes. It needs the same
treatment `flattenLibrary()` already got: a full restorable copy before touching anything, and a
one-time flag so it can't re-fire. That precedent is in `storage.ts:142` and should be followed exactly.

---

## Phase 3 — On-device ASR · L

**Work**

- Benchmark harness first, engines second. Fixed corpus, and report **RTF, WER, first-token latency,
  peak memory, model download size** — the brief is explicit that the choice is latency-per-accuracy,
  not WER alone.
- Candidates: `whisper.cpp` with `large-v3-turbo` (Swift-package bindings exist), and Parakeet via a
  Swift/CoreML path.
- **A constraint the brief doesn't mention:** the well-known Parakeet MLX path is Python. Embedding a
  Python runtime in a menu-bar process that must stay under 150 MB resident does not work. Parakeet
  stays a candidate only via a Swift-native or CoreML route; if no such route holds up under
  benchmarking, whisper.cpp wins by default and that should be recorded as the reason.
- Streaming partials into the HUD for dictation; batch pass for voice notes.
- Model downloaded on first run, not bundled.
- **Delete the Electron capture path here.** `useDictation.ts`, `DictationPanel.tsx`, `Waveform.tsx`,
  `deepgramApiKey`, the CSP entry, the README lines. The brief is explicit: two capture paths must not
  ship. Deepgram returns as a labelled per-note "re-transcribe with cloud model" action — which now
  has an obvious home: it is a named action in the Phase 0.5 bar.

**Proof** — transcription RTF **< 0.3×** on this M2; the feature flag from Phase 1 is removed, not
merely defaulted.

---

## Phase 4 — Retrieval · L

This is a fix, not an enhancement. The audit measured the current search at **190 ms median on 5,000
notes with a warm cache** — already over the 150 ms budget, with 1.5 KB bodies and no transcripts.

**Work**

- Replace `NoteStore.search()` entirely. It calls `list()`, which reads, parses and `stat`s every
  file, then re-reads each candidate. There is nothing to optimise; it needs an index.
- SQLite FTS5 for BM25 + a vector index, reciprocal-rank fused.
- Embeddings generated at commit time, on-device (Core ML or MLX-Swift).
- **The index lives in the agent, not in Electron.** The agent owns embedding generation, it is the
  resident process, and HUD search must be fast with Electron closed. Electron queries it over IPC.
  This follows from §2 but is worth stating because it's the natural place to get it wrong.
- **Index `scratch_notes` as well as the markdown library.** This follows from the decision to keep
  scratch notes, and it is the requirement most likely to be missed, because the two stores have
  always been deliberately separate. If retrieval covers only one of them, the app ships a thing you
  captured that search cannot find — the precise failure the product exists to prevent. Tags feed the
  same index as filters, since they're staying too.
- Type-to-search in the HUD — same hotkey, no second surface.
- Result → open the note, seek audio to the matched moment, play. §5 calls this the core interaction
  of the app; it should be the thing that gets polished, not the thing that gets finished last.

**Proof** — first results **< 150 ms** at 5,000 notes, using the Phase 0.5 benchmark corpus so the
number is directly comparable to the 190 ms baseline. A separate assertion that a scratch note and a
voice note matching the same query both appear in one ranked list.

---

## Ship: Phases 1–4

The revamp release. **Requires the signing track to have landed** — see audit §5a. Everything below
follows after.

---

## Phase 5 — Dictation mode · M

The first feature that needs **Accessibility** permission, and per the brief's own strategic note,
the one that makes the agent a daily habit. Treat it as a headline feature.

**Work** — separate hotkey; press-and-hold and toggle; streaming injection via `AXUIElement` with a
pasteboard fallback that **restores the previous pasteboard contents**; verbatim-leaning cleanup only.
Compatibility pass across Slack, Mail, Safari, Chrome, Terminal, iTerm, VS Code — the Electron and
terminal cases are where AX injection usually breaks.

**Proof** — a recorded compatibility matrix, not a claim.

---

## Phase 6 — Meeting mode · L

The first feature that needs **Screen Recording** permission.

**Work** — ScreenCaptureKit dual-stream (mic = A, system = B); two-way diarization from channel
separation only, shipped perfectly rather than N-speaker shipped adequately; renameable speaker
labels persisted per note; timestamp-linked summaries; retained replayable audio. Detection prompt
only behind explicit opt-in, never auto-record.

**Verify early, don't plan around it** — macOS 15 introduced periodic re-authorization prompts for
screen capture. I don't know the current 26.x behaviour or whether signing changes it. Check this in
the first days of this phase; it affects the UX design, not just the plumbing.

---

## Phase 7 — Tier gating · M

Local/cloud split per §9, licence check, settings, pricing copy. The rule that makes it honest:
**the one-time app must be genuinely complete offline.** Add the "no user content is used for model
training, on any tier" line to Settings and the pricing page.

---

## §10 acceptance criteria — where each is proven

| Metric | Budget | Proven in | Baseline today |
|---|---|---|---|
| Hotkey → HUD visible | < 80 ms | Phase 1, CI gate | 283 ms cold (Electron) |
| Hotkey → recording | 0 ms | Phase 2, tone test | path doesn't exist |
| Agent idle memory | < 150 MB | Phase 1, CI | 411 MB (whole app) |
| Agent idle CPU | < 1 % | Phase 1 | — |
| Search, 5k notes | < 150 ms | Phase 4, CI gate | **190 ms** |
| Transcription RTF | < 0.3× | Phase 3 | ~510 ms TLS before audio |
| Library cold open | < 1.5 s | Phase 4 | **3.11 s** |

Two of these are already missed by the current build (search, cold open) and one is unmeasurable
because the path doesn't exist. Worth knowing before anyone treats §10 as a regression suite.

---

## Ordering rationale, in one paragraph

Phase 0.5 exists because you cannot gate on numbers you cannot measure. Phase 1.5 exists because the
identity migration is the one piece large enough to swallow a phase, and it is far safer as a
no-op refactor than as a passenger on a format change. Phase 3 deletes the Electron capture path
rather than deferring it, because the brief is right that two capture paths is how this app gets
slow. Phase 4 is sequenced last of the ship-blocking four because it depends on commit-time
embeddings from Phase 2 and transcripts from Phase 3 — but it is also the phase that carries the
actual differentiator, so it should not be the one that gets compressed if the schedule slips.
Compress Phase 7 instead.
