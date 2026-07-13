import { useEffect, useRef, useState } from 'react'
import {
  IconChevronDown as ChevronDown,
  IconChevronUp as ChevronUp,
  IconX as X
} from '@tabler/icons-react'
import { searchPluginKey, type SearchState } from '../editorExtensions'
import type { NoteatoEditor } from '../noteLink'

interface Props {
  editor: NoteatoEditor
  /** Bumped by the parent to refocus the find input while already open. */
  focusTick: number
  onClose: () => void
}

export default function FindReplaceBar({ editor, focusTick, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [count, setCount] = useState(0)
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Pin to the editor pane's top-right corner, tracking sidebar/agent-panel
  // toggles and window resizes so the bar always stays inside the pane.
  useEffect(() => {
    const pane = document.querySelector('.editor-pane')
    if (!pane) return
    const update = (): void => {
      const rect = pane.getBoundingClientRect()
      setPos({ top: rect.top + 10, right: Math.max(10, window.innerWidth - rect.right + 16) })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(pane)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  const readState = (): SearchState | undefined =>
    searchPluginKey.getState(editor.prosemirrorView.state)

  const syncFromPlugin = (): void => {
    const state = readState()
    setCount(state?.matches.length ?? 0)
    setActive(state?.active ?? 0)
    requestAnimationFrame(() => {
      document
        .querySelector('.noteato-search-match.active')
        ?.scrollIntoView({ block: 'center', behavior: 'auto' })
    })
  }

  const dispatchSearch = (nextQuery: string, nextActive = 0): void => {
    const view = editor.prosemirrorView
    view.dispatch(
      view.state.tr.setMeta(searchPluginKey, { query: nextQuery, active: nextActive })
    )
    syncFromPlugin()
  }

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusTick])

  // Seed with the editor's current selection, like native find bars.
  useEffect(() => {
    const view = editor.prosemirrorView
    const { from, to } = view.state.selection
    const selected = from === to ? '' : view.state.doc.textBetween(from, to, ' ', '￼').trim()
    if (selected && selected.length <= 80) {
      setQuery(selected)
      dispatchSearch(selected)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Edits to the note (typing, AI changes) recompute matches in the plugin;
  // mirror them into the bar.
  useEffect(() => {
    return editor.onChange(() => syncFromPlugin()) ?? undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  // Clear highlights when the bar goes away.
  useEffect(() => {
    return () => {
      const view = editor.prosemirrorView
      view.dispatch(view.state.tr.setMeta(searchPluginKey, { query: '', active: 0 }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const step = (delta: number): void => {
    if (count === 0) return
    dispatchSearch(query, (active + delta + count) % count)
  }

  const replaceOne = (): void => {
    const state = readState()
    const match = state?.matches[state.active]
    if (!match) return
    const view = editor.prosemirrorView
    view.dispatch(view.state.tr.insertText(replaceText, match.from, match.to))
    syncFromPlugin()
  }

  const replaceAll = (): void => {
    const state = readState()
    if (!state || state.matches.length === 0) return
    const view = editor.prosemirrorView
    let tr = view.state.tr
    // Back to front, so earlier positions stay valid without mapping.
    for (const match of [...state.matches].reverse()) {
      tr = tr.insertText(replaceText, match.from, match.to)
    }
    view.dispatch(tr)
    syncFromPlugin()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      step(e.shiftKey ? -1 : 1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      editor.focus()
    }
  }

  if (!pos) return null
  return (
    <div className="find-bar" style={{ top: pos.top, right: pos.right }}>
        <div className="find-bar-row">
          <input
            ref={inputRef}
            value={query}
            placeholder="Find"
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value)
              dispatchSearch(e.target.value)
            }}
            onKeyDown={onKeyDown}
          />
          <span className="find-bar-count">{query ? `${count ? active + 1 : 0}/${count}` : ''}</span>
          <button title="Previous match (⇧↩)" onClick={() => step(-1)} disabled={count === 0}>
            <ChevronUp size={13} />
          </button>
          <button title="Next match (↩)" onClick={() => step(1)} disabled={count === 0}>
            <ChevronDown size={13} />
          </button>
          <button
            title="Close (Esc)"
            onClick={() => {
              onClose()
              editor.focus()
            }}
          >
            <X size={13} />
          </button>
        </div>
        <div className="find-bar-row">
          <input
            value={replaceText}
            placeholder="Replace with"
            spellCheck={false}
            onChange={(e) => setReplaceText(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button className="find-bar-text-btn" onClick={replaceOne} disabled={count === 0}>
            Replace
          </button>
          <button className="find-bar-text-btn" onClick={replaceAll} disabled={count === 0}>
            All
          </button>
        </div>
    </div>
  )
}
