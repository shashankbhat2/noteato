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
    } else if (key === 'pinned') {
      meta.pinned = value === 'true'
    } else if (key === 'reminderAt') {
      meta.reminderAt = value ? value : null
    } else {
      ;(meta as Record<string, string>)[key] = value.replace(/^"|"$/g, '')
    }
  }

  return { meta, body }
}

// The title lives in the body as its leading `# …` line (the editor's first
// block). These helpers keep frontmatter titles and that line in sync.

/** Text of the body's leading `# …` line, or null if the body has none. */
export function leadingH1(body: string): string | null {
  const trimmed = body.replace(/^\s+/, '')
  if (!trimmed.startsWith('# ')) return null
  const newline = trimmed.indexOf('\n')
  const text = (newline === -1 ? trimmed.slice(2) : trimmed.slice(2, newline)).trim()
  return text || null
}

/** Body without its leading `# …` title line — for excerpts and search snippets. */
export function stripLeadingH1(body: string): string {
  const trimmed = body.replace(/^\s+/, '')
  if (!trimmed.startsWith('# ')) return body
  const newline = trimmed.indexOf('\n')
  return newline === -1 ? '' : trimmed.slice(newline + 1).replace(/^\s+/, '')
}

/**
 * Rewrite the body's leading H1 to match a title set outside the editor
 * (sidebar rename). Bodies without a leading H1 are left alone — the editor
 * prepends the title block from frontmatter on next load instead.
 */
export function replaceLeadingH1(body: string, title: string): string {
  const trimmed = body.replace(/^\s+/, '')
  if (!trimmed.startsWith('# ')) return body
  const newline = trimmed.indexOf('\n')
  const current = (newline === -1 ? trimmed.slice(2) : trimmed.slice(2, newline)).trim()
  if (current === title) return body
  // An empty title block titles the note "Untitled" — don't write that
  // placeholder into the document as literal text.
  if (!current && title === 'Untitled') return body
  const rest = newline === -1 ? '' : trimmed.slice(newline)
  return `# ${title}${rest}`
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
    `pinned: ${meta.pinned}`,
    `reminderAt: ${meta.reminderAt ?? ''}`,
    FM_DELIM
  ].join('\n')

  return `${fm}\n\n${body}`
}
