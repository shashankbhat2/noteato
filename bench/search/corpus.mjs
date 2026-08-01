import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

// Deterministic corpus: the same seed gives the same library, so a number
// measured today is comparable to one measured after Phase 4 rewires search.
function mulberry32(seed) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const WORDS =
  'launch roadmap deepgram invoice standup migration parakeet retrieval embedding transcript quarterly vendor pricing hiring latency budget onboarding archive meeting client proposal handoff renewal escalation'.split(
    ' '
  )

/**
 * Writes `count` notes in the current on-disk format (frontmatter + markdown).
 *
 * `bodyWords` defaults to 240 — roughly 1.5 KB, which is a *typed* note. Real
 * voice notes carry word-level transcripts and run far longer, so a number
 * measured at the default is the optimistic reading. Pass a larger value to see
 * what Phase 4's index has to survive.
 */
export function writeCorpus(dir, { count = 5000, bodyWords = 240, seed = 42 } = {}) {
  const rand = mulberry32(seed)
  const pick = () => WORDS[Math.floor(rand() * WORDS.length)]

  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })

  for (let i = 0; i < count; i++) {
    const now = new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString()
    const words = Array.from({ length: bodyWords }, pick)
    const sentences = []
    for (let w = 0; w < words.length; w += 6) sentences.push(words.slice(w, w + 6).join(' '))
    const body = `# Note ${i}\n\n${sentences.join('. ')}.\n`
    const fm =
      `---\nid: ${randomUUID()}\ntitle: "Note ${i}"\ncreatedAt: ${now}\nupdatedAt: ${now}\n` +
      `tags: []\nfullWidth: false\npinned: false\nreminderAt: \n---\n\n`
    writeFileSync(join(dir, `note-${i}.md`), fm + body, 'utf-8')
  }
  return dir
}
