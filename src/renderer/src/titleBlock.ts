import type { NoteatoBlock } from './noteLink'

// The note's title is its first block: a level-1 heading. These helpers keep
// the "first H1 = title" convention in one place for every editor surface.

/** Plain text of a block's inline content (mention chips contribute their title). */
export function inlineContentText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((item: Record<string, unknown>) => {
      if (item?.type === 'text') return String(item.text ?? '')
      if (item?.type === 'link') return inlineContentText(item.content)
      if (item?.type === 'noteLink') {
        return String((item.props as Record<string, unknown> | undefined)?.title ?? '')
      }
      return ''
    })
    .join('')
}

function isTitleBlock(block: NoteatoBlock | undefined): boolean {
  if (!block || block.type !== 'heading') return false
  return (block.props as { level?: number }).level === 1
}

/** Title text derived from the document's leading H1, or '' if there is none. */
export function titleFromBlocks(blocks: NoteatoBlock[]): string {
  const first = blocks[0]
  if (!isTitleBlock(first)) return ''
  return inlineContentText((first as { content?: unknown }).content).trim()
}

/** Title derived from serialised markdown's leading `# …` line, used on save. */
export function titleFromMarkdown(markdown: string): string {
  const firstLine = markdown.replace(/^\s+/, '').split('\n', 1)[0] ?? ''
  return firstLine.startsWith('# ') ? firstLine.slice(2).trim() : ''
}

/**
 * Guarantee the document opens with a title block. Notes saved before the
 * title moved into the body (or created empty) get their frontmatter title
 * prepended as an H1 — written back to disk on the next save. A fallback of
 * "Untitled" becomes an empty H1 so the placeholder shows instead of literal
 * text the user has to delete.
 */
export function ensureTitleBlock(blocks: NoteatoBlock[], fallbackTitle: string): NoteatoBlock[] {
  if (isTitleBlock(blocks[0])) return blocks
  const text = fallbackTitle.trim()
  const heading = {
    type: 'heading',
    props: { level: 1 },
    content:
      text && text !== 'Untitled' ? [{ type: 'text', text, styles: {} }] : []
  } as unknown as NoteatoBlock
  return [heading, ...blocks]
}
