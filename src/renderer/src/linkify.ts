import type { Block } from '@blocknote/core'

// BlockNote's markdown exporter writes a link whose text equals its href as a
// bare URL (no `[](...)` syntax), and its markdown parser only recognizes
// explicit `[text](url)` links. So a typed or pasted URL — where BlockNote's
// autolink made text === href — round-trips through the saved markdown as plain
// text and is no longer highlighted as a link when the note is reopened.
//
// This re-detects bare URLs in freshly parsed blocks and restores the link mark,
// keeping the on-disk markdown as the source of truth.

const URL_REGEX = /(?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,!?;:'"’”]/gi

interface TextInline {
  type: 'text'
  text: string
  styles: Record<string, unknown>
}

function linkifyText(item: TextInline): unknown[] {
  const { text, styles } = item
  const out: unknown[] = []
  let last = 0
  for (const match of text.matchAll(URL_REGEX)) {
    const url = match[0]
    const start = match.index ?? 0
    if (start > last) out.push({ type: 'text', text: text.slice(last, start), styles })
    const href = /^www\./i.test(url) ? `https://${url}` : url
    out.push({ type: 'link', href, content: [{ type: 'text', text: url, styles }] })
    last = start + url.length
  }
  if (out.length === 0) return [item]
  if (last < text.length) out.push({ type: 'text', text: text.slice(last), styles })
  return out
}

// Mutates and returns the given blocks with bare URLs converted to link marks.
export function linkifyBlocks(blocks: Block[]): Block[] {
  for (const block of blocks as unknown as Array<Record<string, unknown>>) {
    // Skip code blocks — a URL in code is intentionally literal text.
    if (block.type !== 'codeBlock' && Array.isArray(block.content)) {
      block.content = block.content.flatMap((c: Record<string, unknown>) => {
        const styles = c?.styles as Record<string, unknown> | undefined
        return c?.type === 'text' && !styles?.code ? linkifyText(c as unknown as TextInline) : [c]
      })
    }
    const children = block.children as Block[] | undefined
    if (Array.isArray(children) && children.length) linkifyBlocks(children)
  }
  return blocks
}
