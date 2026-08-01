import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

// A faithful port of NoteStore.list() + NoteStore.search() as they stand in
// src/main/storage.ts. Ported rather than imported because NoteStore needs
// `electron` and a better-sqlite3 handle built against Electron's ABI.
//
// PHASE 4: do not "fix" this file. It is the baseline the rewrite is measured
// against. Add the new engine as a sibling implementation instead.

function parseNoteFile(raw) {
  if (!raw.startsWith('---')) return { meta: {}, body: raw }
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return { meta: {}, body: raw }
  const meta = {}
  for (const line of raw.slice(3, end).trim().split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (key === 'tags') {
      meta.tags = value.replace(/^\[|\]$/g, '').split(',').map((t) => t.trim()).filter(Boolean)
    } else meta[key] = value.replace(/^"|"$/g, '')
  }
  return { meta, body: raw.slice(end + 4).replace(/^\n/, '') }
}

// list() reads, parses and stats every file in the library on every call.
function list(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || !entry.name.endsWith('.md')) continue
    const full = join(dir, entry.name)
    const { meta, body } = parseNoteFile(readFileSync(full, 'utf-8'))
    if (!meta.id) continue
    const stats = statSync(full)
    out.push({
      id: meta.id,
      title: meta.title ?? entry.name,
      updatedAt: meta.updatedAt ?? stats.mtime.toISOString(),
      tags: meta.tags ?? [],
      path: entry.name,
      excerpt: body.trim().slice(0, 160)
    })
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  return out
}

export const name = 'current (NoteStore.search)'

export function createIndex() {
  // Deliberately nothing: the current implementation has no index. That is the
  // finding, not an omission in the harness.
  return null
}

export function search(dir, query) {
  const q = query.toLowerCase()
  const scored = []
  for (const summary of list(dir)) {
    const titleHit = summary.title.toLowerCase().includes(q)
    // The second full read of a file list() already read.
    const { body } = parseNoteFile(readFileSync(join(dir, summary.path), 'utf-8'))
    const hay = body.toLowerCase()
    if (!titleHit && !hay.includes(q)) continue
    let count = 0
    let from = 0
    for (;;) {
      const i = hay.indexOf(q, from)
      if (i === -1) break
      count++
      from = i + q.length
    }
    scored.push({ path: summary.path, score: (titleHit ? 1000 : 0) + count })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, 50)
}
