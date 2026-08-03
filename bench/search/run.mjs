#!/usr/bin/env node
// §10 gate: "Search first results, 5k notes — under 150 ms".
//
//   node bench/search/run.mjs [--notes 5000] [--impl current] [--body-words 240]
//                             [--budget 150] [--gate] [--json]
//
// --gate exits non-zero when the median exceeds the budget. Left off by
// default so the benchmark can be run for information without failing a shell.
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeCorpus } from './corpus.mjs'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : argv[i + 1]
}
const has = (name) => argv.includes(`--${name}`)

const notes = Number(flag('notes', 5000))
const bodyWords = Number(flag('body-words', 240))
const budgetMs = Number(flag('budget', 150))
const implName = flag('impl', 'current')

const QUERIES = ['parakeet', 'invoice', 'latency', 'roadmap', 'client', 'escalation', 'renewal']

const impl = await import(`./implementations/${implName}.mjs`)
const dir = mkdtempSync(join(tmpdir(), 'noteato-bench-'))

try {
  writeCorpus(dir, { count: notes, bodyWords })
  const index = impl.createIndex(dir)

  // Warm the page cache first. This measures the algorithm rather than cold
  // disk I/O — the friendlier of the two readings, and the one a user with the
  // app already open would actually see.
  impl.search(dir, 'warmup', index)

  const samples = []
  for (const q of QUERIES) {
    const t = performance.now()
    const hits = impl.search(dir, q, index)
    samples.push({ query: q, ms: Number((performance.now() - t).toFixed(1)), hits: hits.length })
  }

  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const result = {
    metric: 'search-first-results',
    implementation: impl.name,
    notes,
    bodyWords,
    budgetMs,
    medianMs: median,
    maxMs: sorted[sorted.length - 1],
    samples,
    withinBudget: median <= budgetMs
  }

  if (has('json')) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(`search · ${impl.name} · ${notes} notes (${bodyWords}-word bodies)`)
    for (const s of samples) console.log(`  ${s.query.padEnd(12)} ${String(s.ms).padStart(7)} ms  (${s.hits} hits)`)
    console.log(`  ${'median'.padEnd(12)} ${String(median).padStart(7)} ms   budget ${budgetMs} ms — ${result.withinBudget ? 'PASS' : 'FAIL'}`)
  }

  if (has('gate') && !result.withinBudget) {
    console.error(`\nFAIL: median ${median} ms exceeds the ${budgetMs} ms budget (§10).`)
    process.exit(1)
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
