import type { NoteMeta } from '../shared/types'

const FM_DELIM = '---'

export function parseNoteFile(raw: string): { meta: Partial<NoteMeta>; body: string } {
  if (!raw.startsWith(FM_DELIM)) return { meta: {}, body: raw }

  const end = raw.indexOf(`\n${FM_DELIM}`, FM_DELIM.length)
  if (end === -1) return { meta: {}, body: raw }

  const fmBlock = raw.slice(FM_DELIM.length, end).trim()
  const body = raw.slice(end + FM_DELIM.length + 1).replace(/^\n/, '')

  const meta: Partial<NoteMeta> = {}
  for (const line of fmBlock.split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (key === 'tags') {
      meta.tags = value
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    } else if (key === 'fullWidth') {
      meta.fullWidth = value === 'true'
    } else {
      ;(meta as Record<string, string>)[key] = value.replace(/^"|"$/g, '')
    }
  }

  return { meta, body }
}

export function serializeNoteFile(meta: NoteMeta, body: string): string {
  const fm = [
    FM_DELIM,
    `id: ${meta.id}`,
    `title: "${meta.title.replace(/"/g, '\\"')}"`,
    `createdAt: ${meta.createdAt}`,
    `updatedAt: ${meta.updatedAt}`,
    `tags: [${meta.tags.join(', ')}]`,
    `fullWidth: ${meta.fullWidth}`,
    FM_DELIM
  ].join('\n')

  return `${fm}\n\n${body}`
}
