import type { NoteatoBlock, NoteatoEditor } from './noteLink'

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
 * Title for a note with no title block: the first line that has any text,
 * whatever kind of block it came from.
 *
 * Scratch notes don't carry a mandatory H1 — you open one to jot something,
 * not to name a document — so their title is only ever a label for the tab,
 * derived from whatever you actually wrote. Markdown's line-level syntax is
 * stripped so a note that happens to start with a bullet or a heading reads as
 * its text rather than its punctuation.
 */
export function titleFromFirstLine(markdown: string): string {
  for (const raw of markdown.split('\n')) {
    const line = raw
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/^\s*[-*+]\s+(\[[ xX]\]\s+)?/, '')
      .replace(/^\s*\d+\.\s+/, '')
      .replace(/^\s*>\s?/, '')
      .trim()
    if (line) return line.slice(0, 80)
  }
  return ''
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

// Blocks whose inline content can simply be re-typed as the title heading. A
// first block of any other kind (image, table, code, divider…) keeps its own
// type and gets an empty H1 inserted above it instead — retyping those would
// lose their content.
const TITLE_CONVERTIBLE_TYPES = new Set([
  'paragraph',
  'heading',
  'quote',
  'bulletListItem',
  'numberedListItem',
  'checkListItem',
  'toggleListItem'
])

/**
 * Keep the live document's first block a single level-1 heading — the note's
 * title. The title is a normal block, so anything can demote it (the slash
 * menu, a markdown shortcut, backspacing it away, pasting an image on top);
 * this snaps it back after every change so every note has exactly one H1 in
 * the title slot. A convertible first block is retyped in place, which keeps
 * its text and the caret; anything else gets an empty title above it.
 *
 * Returns true when the document was changed.
 */
export function enforceTitleBlock(editor: NoteatoEditor): boolean {
  try {
    const first = editor.document[0] as NoteatoBlock | undefined
    if (!first || isTitleBlock(first)) return false

    if (TITLE_CONVERTIBLE_TYPES.has(first.type)) {
      editor.updateBlock(first, { type: 'heading', props: { level: 1 } } as Parameters<
        NoteatoEditor['updateBlock']
      >[1])
    } else {
      editor.insertBlocks(
        [{ type: 'heading', props: { level: 1 }, content: [] }] as Parameters<
          NoteatoEditor['insertBlocks']
        >[0],
        first,
        'before'
      )
    }
    return true
  } catch {
    // Editor torn down, or the document was mid-transaction — the next change
    // re-runs this.
    return false
  }
}
