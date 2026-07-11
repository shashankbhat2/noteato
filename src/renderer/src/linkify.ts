import { NOTE_LINK_PREFIX } from './noteLink'

// Post-parse fixups for freshly parsed markdown blocks:
//
// 1. BlockNote's markdown exporter writes a link whose text equals its href as
//    a bare URL (no `[](...)` syntax), and its markdown parser only recognizes
//    explicit `[text](url)` links. So a typed or pasted URL — where BlockNote's
//    autolink made text === href — round-trips through the saved markdown as
//    plain text. This re-detects bare URLs and restores the link mark.
//
// 2. Note mentions are stored as `[Title](#note/<id>)` links; the parser yields
//    plain link inline content, which this converts back into atomic noteLink
//    mention chips.
//
// The on-disk markdown stays the source of truth in both cases.

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

function toNoteMention(link: Record<string, unknown>): Record<string, unknown> {
  const href = String(link.href ?? '')
  const content = Array.isArray(link.content) ? link.content : []
  const title = content
    .map((c) => (typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : ''))
    .join('')
  return {
    type: 'noteLink',
    props: { noteId: href.slice(NOTE_LINK_PREFIX.length), title: title || 'Untitled' }
  }
}

// Mutates and returns the given blocks with bare URLs converted to link marks
// and stored note links converted to noteLink mentions. Generic so it accepts
// blocks from any schema (default or the custom noteato schema).
export function linkifyBlocks<B>(blocks: B[]): B[] {
  for (const block of blocks as unknown as Array<Record<string, unknown>>) {
    // Skip code blocks — a URL in code is intentionally literal text.
    if (block.type !== 'codeBlock' && Array.isArray(block.content)) {
      block.content = block.content.flatMap((c: Record<string, unknown>) => {
        if (c?.type === 'link' && String(c.href ?? '').startsWith(NOTE_LINK_PREFIX)) {
          return [toNoteMention(c)]
        }
        const styles = c?.styles as Record<string, unknown> | undefined
        return c?.type === 'text' && !styles?.code ? linkifyText(c as unknown as TextInline) : [c]
      })
    }
    const children = block.children as unknown[] | undefined
    if (Array.isArray(children) && children.length) linkifyBlocks(children)
  }
  return blocks
}
