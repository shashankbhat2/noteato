import { useEffect, useMemo, useRef, useState } from 'react'
import { IconFilePlus as FilePlus, IconSearch as Search } from '@tabler/icons-react'
import type { NoteSummary } from '../../../shared/types'

interface Props {
  notes: NoteSummary[]
  /** Ids of the most recently opened notes, newest first — the default listing. */
  recentIds: string[]
  onOpen: (note: NoteSummary) => void
  /** Create a note; the typed query becomes its title when there is one. */
  onCreate: (title?: string) => void
  onClose: () => void
}

/**
 * What a new tab starts from: pick something already written, or make a new
 * note. Opening straight into an empty "Untitled" was only ever right for one
 * of those.
 */
export default function NewTabModal({ notes, recentIds, onOpen, onCreate, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q) {
      return notes
        .filter(
          (note) =>
            note.title.toLowerCase().includes(q) ||
            note.folder.toLowerCase().includes(q) ||
            note.tags.some((tag) => tag.toLowerCase().includes(q))
        )
        .slice(0, 60)
    }
    // No query: recents first, then the rest by last edit — the same order the
    // sidebar's Your Notes uses, so nothing jumps around.
    const byId = new Map(notes.map((note) => [note.id, note]))
    const recent = recentIds
      .map((id) => byId.get(id))
      .filter((note): note is NoteSummary => note !== undefined)
    const seen = new Set(recent.map((note) => note.id))
    const rest = notes
      .filter((note) => !seen.has(note.id))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    return [...recent, ...rest].slice(0, 60)
  }, [notes, recentIds, query])

  useEffect(() => {
    setActive(0)
  }, [query])

  useEffect(() => {
    listRef.current?.querySelector('.search-result.active')?.scrollIntoView({ block: 'nearest' })
  }, [active, results])

  const choose = (note?: NoteSummary): void => {
    if (!note) return
    onOpen(note)
    onClose()
  }

  const create = (): void => {
    onCreate(query.trim() || undefined)
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      // Nothing matched what you typed, so the obvious next move is to write it.
      if (results.length === 0) create()
      else choose(results[active])
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="modal-overlay search-overlay" onClick={onClose}>
      <div className="modal search-modal new-tab-modal" onClick={(e) => e.stopPropagation()}>
        <div className="search-input-row">
          <Search size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Open a note…"
          />
        </div>

        <button className="new-tab-create" onClick={create}>
          <FilePlus size={15} />
          <span>{query.trim() ? `New note “${query.trim()}”` : 'New note'}</span>
        </button>

        <div className="search-results" ref={listRef}>
          <div className="new-tab-section">{query.trim() ? 'Matches' : 'Your notes'}</div>
          {results.length === 0 ? (
            <div className="search-empty">No notes match</div>
          ) : (
            results.map((note, i) => (
              <div
                key={note.id}
                className={i === active ? 'search-result active' : 'search-result'}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(note)}
              >
                <div className="search-result-head">
                  <span className="search-result-title">{note.title || 'Untitled'}</span>
                  {note.folder && <span className="search-result-folder">{note.folder}</span>}
                </div>
                {note.excerpt && <div className="search-result-snippet">{note.excerpt}</div>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
