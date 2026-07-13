import type { ReactNode } from 'react'

// Minimal markdown renderer for assistant chat bubbles: headings, lists,
// quotes, code fences, and inline bold/italic/code/strike/links. Builds React
// elements directly (no HTML injection), so untrusted model output is safe.

const INLINE_PATTERN =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(~~[^~\n]+~~)|\[([^\]\n]+)\]\(([^)\s]+)\)/g

function isSafeLink(href: string): boolean {
  try {
    const { protocol } = new URL(href)
    return protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:'
  } catch {
    return false
  }
}

function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const start = match.index ?? 0
    if (start > last) out.push(text.slice(last, start))
    const key = `${keyBase}-${i++}`
    const [full, code, bold2, bold1, italic2, italic1, strike, linkText, linkHref] = match
    if (code) out.push(<code key={key}>{code.slice(1, -1)}</code>)
    else if (bold2 || bold1) {
      const inner = (bold2 ?? bold1).slice(2, -2)
      out.push(<strong key={key}>{renderInline(inner, key)}</strong>)
    } else if (italic2 || italic1) {
      const inner = (italic2 ?? italic1).slice(1, -1)
      out.push(<em key={key}>{renderInline(inner, key)}</em>)
    } else if (strike) {
      out.push(<s key={key}>{renderInline(strike.slice(2, -2), key)}</s>)
    } else if (linkText && linkHref) {
      out.push(isSafeLink(linkHref) ? (
        <a
          key={key}
          href={linkHref}
          onClick={(e) => {
            e.preventDefault()
            // Routed through the window-open handler, which opens externally.
            window.open(linkHref)
          }}
        >
          {renderInline(linkText, key)}
        </a>
      ) : renderInline(linkText, key))
    } else {
      out.push(full)
    }
    last = start + full.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

interface ListGroup {
  ordered: boolean
  items: string[]
}

export default function MarkdownText({ text }: { text: string }) {
  const lines = text.split('\n')
  const blocks: ReactNode[] = []
  let list: ListGroup | null = null
  let fence: string[] | null = null
  let paragraph: string[] = []

  const flushList = (): void => {
    if (!list) return
    const items = list.items.map((item, i) => <li key={i}>{renderInline(item, `li${i}`)}</li>)
    blocks.push(
      list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>
    )
    list = null
  }

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return
    const key = blocks.length
    blocks.push(
      <p key={key}>
        {paragraph.flatMap((line, i) => [
          ...(i > 0 ? [<br key={`br${i}`} />] : []),
          ...renderInline(line, `p${key}-${i}`)
        ])}
      </p>
    )
    paragraph = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (fence) {
      if (/^\s*```/.test(line)) {
        blocks.push(
          <pre key={blocks.length}>
            <code>{fence.join('\n')}</code>
          </pre>
        )
        fence = null
      } else {
        fence.push(rawLine)
      }
      continue
    }
    if (/^\s*```/.test(line)) {
      flushParagraph()
      flushList()
      fence = []
      continue
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      flushParagraph()
      flushList()
      const level = heading[1].length
      const Tag = (['h1', 'h2', 'h3', 'h4'] as const)[level - 1]
      blocks.push(<Tag key={blocks.length}>{renderInline(heading[2], `h${blocks.length}`)}</Tag>)
      continue
    }
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/)
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (bullet || numbered) {
      flushParagraph()
      const ordered = Boolean(numbered)
      if (list && list.ordered !== ordered) flushList()
      list = list ?? { ordered, items: [] }
      list.items.push((bullet ?? numbered)![1])
      continue
    }
    const quote = line.match(/^\s*>\s?(.*)$/)
    if (quote) {
      flushParagraph()
      flushList()
      blocks.push(
        <blockquote key={blocks.length}>
          {renderInline(quote[1], `q${blocks.length}`)}
        </blockquote>
      )
      continue
    }
    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }
    flushList()
    paragraph.push(line)
  }
  if (fence) {
    blocks.push(
      <pre key={blocks.length}>
        <code>{fence.join('\n')}</code>
      </pre>
    )
  }
  flushParagraph()
  flushList()

  return <div className="md-text">{blocks}</div>
}
