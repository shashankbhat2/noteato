import { useEffect, useState } from 'react'
import { inlineContentText } from '../titleBlock'
import type { NoteatoBlock, NoteatoEditor } from '../noteLink'

interface Heading {
  id: string
  level: number
  text: string
}

const RECOMPUTE_DEBOUNCE_MS = 300

/** Headings in document order, skipping the leading H1 (that's the title). */
function collectHeadings(blocks: NoteatoBlock[]): Heading[] {
  const out: Heading[] = []
  blocks.forEach((block, index) => {
    if (block.type !== 'heading') return
    const level = Number((block.props as { level?: number }).level ?? 1)
    if (index === 0 && level === 1) return
    const text = inlineContentText((block as { content?: unknown }).content).trim()
    out.push({ id: block.id, level: Math.min(level, 3), text: text || 'Untitled section' })
  })
  return out
}

/**
 * Rail of tick marks down the right edge of a note — one per heading, indented
 * by level. Hovering expands it into a readable table of contents; clicking a
 * row scrolls that heading into view.
 */
export default function TableOfContents({ editor }: { editor: NoteatoEditor }) {
  const [headings, setHeadings] = useState<Heading[]>([])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const recompute = (): void => setHeadings(collectHeadings(editor.document as NoteatoBlock[]))
    recompute()

    let unsubscribe: (() => void) | undefined
    try {
      // Editing fires this constantly; the rail only needs to settle, not track
      // every keystroke.
      unsubscribe = editor.onChange(() => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(recompute, RECOMPUTE_DEBOUNCE_MS)
      }) as (() => void) | undefined
    } catch {
      /* editor build without a change subscription — the rail stays static */
    }
    return () => {
      if (timer) clearTimeout(timer)
      unsubscribe?.()
    }
  }, [editor])

  if (headings.length < 2) return null

  const jumpTo = (id: string): void => {
    const element = document.querySelector<HTMLElement>(
      `[data-node-type="blockOuter"][data-id="${CSS.escape(id)}"]`
    )
    element?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="note-toc-anchor">
      <nav className="note-toc" aria-label="Table of contents">
        {headings.map((heading) => (
          <button
            key={heading.id}
            className="toc-line"
            data-level={heading.level}
            title={heading.text}
            onClick={() => jumpTo(heading.id)}
          >
            <span className="toc-label">{heading.text}</span>
            <span className="toc-dash" />
          </button>
        ))}
      </nav>
    </div>
  )
}
