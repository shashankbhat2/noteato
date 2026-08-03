import { useEffect, useRef, useState } from 'react'
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
 * A compact dash rail that expands into a section card on hover. It stays
 * pinned to the note surface's own scroller and never reflows the document.
 */
export default function NoteOutline({ editor }: { editor: NoteatoEditor }) {
  const [headings, setHeadings] = useState<Heading[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const recompute = (): void => setHeadings(collectHeadings(editor.document as NoteatoBlock[]))
    recompute()

    let unsubscribe: (() => void) | undefined
    try {
      // Editing fires this constantly; the panel only needs to settle, not
      // track every keystroke.
      unsubscribe = editor.onChange(() => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(recompute, RECOMPUTE_DEBOUNCE_MS)
      }) as (() => void) | undefined
    } catch {
      /* editor build without a change subscription — the panel stays static */
    }
    return () => {
      if (timer) clearTimeout(timer)
      unsubscribe?.()
    }
  }, [editor])

  // Highlight whichever heading the reader is currently under. Observing the
  // headings themselves is cheaper and steadier than measuring on every scroll.
  useEffect(() => {
    if (headings.length === 0) return undefined
    const elements = headings
      .map((h) =>
        document.querySelector<HTMLElement>(
          `[data-node-type="blockOuter"][data-id="${CSS.escape(h.id)}"]`
        )
      )
      .filter((el): el is HTMLElement => el !== null)
    if (elements.length === 0) return undefined

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (visible) setActiveId(visible.target.getAttribute('data-id'))
      },
      // A band near the top: the heading you are "in" is the one just above the
      // reading position, not whatever happens to be centred.
      {
        root: ref.current?.closest('.note-writing-surface') ?? null,
        rootMargin: '-10% 0px -70% 0px',
        threshold: 0
      }
    )
    for (const el of elements) observer.observe(el)
    return () => observer.disconnect()
  }, [headings])

  const jumpTo = (id: string): void => {
    ref.current
      ?.closest('.note-editor-shell')
      ?.querySelector<HTMLElement>(`[data-node-type="blockOuter"][data-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActiveId(id)
  }

  return (
    <aside className="note-outline" ref={ref} aria-label="Outline">
      <nav className="note-outline-body">
        {headings.length === 0 ? (
          <div className="note-outline-empty">
            <span>No sections yet</span>
            <i />
          </div>
        ) : (
          headings.map((heading) => (
            <button
              key={heading.id}
              className={
                heading.id === activeId ? 'note-outline-item active' : 'note-outline-item'
              }
              data-level={heading.level}
              onClick={() => jumpTo(heading.id)}
              title={heading.text}
            >
              <span className="note-outline-label">{heading.text}</span>
              <span className="note-outline-dash" />
            </button>
          ))
        )}
      </nav>
    </aside>
  )
}
