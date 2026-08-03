# Benchmarks

The §10 performance budget from the revamp brief, as runnable measurements. These are acceptance
criteria, not aspirations — the point of keeping them in the repo is that a number nobody can
reproduce is a number nobody defends.

```
npm run bench            # both §10 gates
npm run bench:search     # search, 5k notes      budget 150 ms
npm run bench:memory     # Electron idle floor   budget 150 MB
```

Add `-- --json` for machine-readable output, `-- --gate` to exit non-zero on a budget miss.

> `bench:panel` (hotkey → HUD) and `bench:asr` (transcription RTF) lived in the Swift package and
> went with it when the agent was removed. Both budgets still apply to whatever replaces them —
> see `docs/revamp/meeting-notes-plan.md` — but there is nothing to measure until that lands, and a
> benchmark against a deleted implementation is worse than no benchmark.

## Baselines on the Phase 0 reference machine

Apple M2, macOS 26.5. Recorded 2026-08-01, before any revamp code landed.

| Benchmark | Measured | Budget | |
|---|---|---|---|
| `bench:search` — 5,000 notes, median | **197.7 ms** | 150 ms | **fail** |
| `bench:memory` — Electron floor | **319.6 MB** | 150 MB | **fail** |
| `bench:memory` — window ready-to-show | 305 ms | — | |

Both fail against budget today. That is the finding, not a broken harness:

- **Search** has no index. `NoteStore.search()` reads, parses and `stat`s every file via `list()`,
  then re-reads each candidate. This number is the baseline any rewrite is measured against.
- **Electron's floor.** 319.6 MB is a *trivial* document in one window — the real renderer is
  strictly heavier. This was the measurement the native process split rested on; with the agent
  removed, 150 MB is no longer a budget any single-process design can meet, and the number needs
  restating against what the app actually is rather than carried forward unexamined.

## Notes on each

**`bench:search`** generates a deterministic corpus from a fixed seed, so a number measured today is
comparable to one measured after Phase 4. Implementations are pluggable
(`bench/search/implementations/`): `current.mjs` is a faithful port of today's algorithm and should
**not** be optimised — Phase 4 adds a sibling and compares. Default bodies are ~240 words, which is a
*typed* note; real voice notes carry word-level transcripts and run far longer, so the default is the
optimistic reading. `--body-words` shows what the index will actually face.

**`bench:memory`** runs under Electron rather than node, and samples `app.getAppMetrics()` after a
3-second settle. A reading taken mid-startup flatters the number.

## Using these in CI

Today CI runs both **for information only** — see `.github/workflows/ci.yml`. Nothing gates yet,
for the obvious reason: both budgets are currently missed, so a gate switched on now would make
`main` permanently red and get deleted within the week.

Two rules worth keeping when they do switch on. **Gate only what is CPU-bound and deterministic,
report everything else** — shared `macos-latest` runners are noisy. And **gate on a median of N
runs, publishing the raw number as an artifact**, so drift is visible before it trips the gate
rather than as a surprise. A gate that goes red for reasons nobody can act on protects nothing.

## On-device ASR — measured 2026-08-01

Historical. FluidAudio (Parakeet TDT v3) on the M2 reference machine, before the agent was removed.
Kept because it is the bar any replacement has to clear, and because the two findings below still
hold for a Node-side implementation.

| | Measured | Budget | |
|---|---|---|---|
| Realtime factor, 5.7 s real speech | **0.02** (57×) | < 0.3 | pass |
| Realtime factor, 206 s real speech | **0.01** (196×) | < 0.3 | pass |
| Warm model load | **0.13 s** | — | |
| Cold first run (incl. download) | **18.4 s** | — | one time |
| Peak RSS while transcribing | **133 MB** | — | see below |
| Model cache on disk | **461 MB** | — | not in the DMG |
| Word-level timings | yes | required by §9 | |

Accuracy on a known sentence was word-perfect, with `ten` rendered as `10` — inverse text
normalization doing its job, and the right call for a note.

**Two findings that shape the design, not just the score:**

- **Peak memory is ~133 MB and does not scale with audio length** (206 s cost barely more than
  30 s). The conclusion outlives the agent: transcription belongs in a helper process that exits
  when it is done, so the resident app stays lean by construction rather than by remembering to
  unload. Note this cuts against keeping an ASR server warm for latency — that trade is a real one
  to make deliberately, not by default.
- **461 MB of model is a real first-run download.** §6 asks for it to be fetched rather than
  bundled, which keeps the DMG small, but this is large enough to warrant a visible progress state
  and an honest word before it starts. §9 also wants the app complete offline afterwards, so the
  failure path when HuggingFace is unreachable needs to be legible rather than a silent hang.
