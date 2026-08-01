# Benchmarks

The §10 performance budget from the revamp brief, as runnable measurements. These are acceptance
criteria, not aspirations — the point of keeping them in the repo is that a number nobody can
reproduce is a number nobody defends.

```
npm run bench            # all three
npm run bench:panel      # hotkey → HUD          budget 80 ms
npm run bench:search     # search, 5k notes      budget 150 ms
npm run bench:memory     # Electron idle floor   budget 150 MB
```

Add `-- --json` for machine-readable output, `-- --gate` to exit non-zero on a budget miss.

## Baselines on the Phase 0 reference machine

Apple M2, macOS 26.5. Recorded 2026-08-01, before any revamp code landed.

| Benchmark | Measured | Budget | |
|---|---|---|---|
| `bench:panel` — native NSPanel, cold | 23–33 ms | 80 ms | pass, ~3× headroom |
| `bench:panel` — warm p95 | 2–7 ms | 80 ms | pass |
| `bench:panel` — resident | 32.5 MB | 150 MB | pass |
| `bench:search` — 5,000 notes, median | **197.7 ms** | 150 ms | **fail** |
| `bench:memory` — Electron floor | **319.6 MB** | 150 MB | **fail** |
| `bench:memory` — window ready-to-show | 305 ms | — | |

Two of these fail against budget today. That is the finding, not a broken harness:

- **Search** has no index. `NoteStore.search()` reads, parses and `stat`s every file via `list()`,
  then re-reads each candidate. Phase 4 replaces it; this number is the baseline that rewrite is
  measured against.
- **Electron's floor** is why the agent is native. 319.6 MB is a *trivial* document in one window —
  the real renderer is strictly heavier. No Electron configuration reaches the 150 MB agent budget,
  which is the measurement the §2 process split rests on.

## Notes on each

**`bench:panel`** lives in the Swift package (`agent/Sources/PanelBench`) rather than here, so that
Phase 1 can point it at the agent's real HUD type instead of the replica it measures today. It gates
on the *cold* path — the slower of the two, and the one a user hits on the first capture after
launch. It does not measure hotkey dispatch itself; `RegisterEventHotKey` delivery was well under a
millisecond in the Phase 0 audit, so the panel is the term that matters. Revisit if that stops
holding.

**`bench:search`** generates a deterministic corpus from a fixed seed, so a number measured today is
comparable to one measured after Phase 4. Implementations are pluggable
(`bench/search/implementations/`): `current.mjs` is a faithful port of today's algorithm and should
**not** be optimised — Phase 4 adds a sibling and compares. Default bodies are ~240 words, which is a
*typed* note; real voice notes carry word-level transcripts and run far longer, so the default is the
optimistic reading. `--body-words` shows what the index will actually face.

**`bench:memory`** runs under Electron rather than node, and samples `app.getAppMetrics()` after a
3-second settle. A reading taken mid-startup flatters the number.

## Using these in CI

Today CI runs all three **for information only** — see `.github/workflows/ci.yml`. Nothing gates yet,
for the obvious reason: two of the three budgets are currently missed, so a gate switched on now
would make `main` permanently red and get deleted within the week.

Gates switch on as each budget becomes achievable, and that is the phase's proof:

| Benchmark | Gate switches on | Why not sooner |
|---|---|---|
| `bench:panel` | **Phase 1**, repointed at the real HUD | Measures a replica until the agent exists |
| `bench:search` | **Phase 4**, against the new engine | Fails at 197.7 ms today by design |
| `bench:memory` | never as a hard gate | Reports the Electron floor; the agent's own RSS is what Phase 1 asserts |

Two rules worth keeping when they do switch on. **Gate only what is CPU-bound and deterministic,
report everything else** — shared `macos-latest` runners are noisy, and `bench:panel` additionally
depends on a window server whose behaviour on hosted runners is not something to bet a red build on.
And **gate on a median of N runs, publishing the raw number as an artifact**, so drift is visible
before it trips the gate rather than as a surprise. A gate that goes red for reasons nobody can act
on protects nothing.
