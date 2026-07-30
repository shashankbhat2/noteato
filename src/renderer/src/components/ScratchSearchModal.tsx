import { useEffect, useMemo, useRef, useState } from 'react'
import { IconSearch as Search } from '@tabler/icons-react'
import type { ScratchNote } from '../../../shared/types'

interface Props {
  notes: ScratchNote[]
  onPick: (id: string) => void
  onClose: () => void
}

/**
 * Find-a-note for the compact panel, in the same shape as the main window's
 * ⌘K modal. It filters the notes already in memory rather than going through
 * IPC — the panel holds the whole scratch list, which is small by design, so a
 * round trip would only add latency to every keystroke.
 */
export default function ScratchSearchModal({ notes, onPick, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matching = needle
      ? notes.filter((note) =>
          `${note.title} ${note.excerpt}`.toLowerCase().includes(needle)
        )
      : notes
    return matching.slice(0, 50)
  }, [notes, query])

  // A narrowing query can leave the cursor past the end of the list.
  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(results.length - 1, 0)))
  }, [results.length])

  const choose = (note: ScratchNote | undefined): void => {
    if (!note) return
    onPick(note.id)
    onClose()
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((a) => Math.min(a + 1, results.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(results[active])
    } else if (event.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="modal-overlay search-overlay" onClick={onClose}>
      <div className="modal search-modal scratch-search" onClick={(e) => e.stopPropagation()}>
        <div className="search-input-row">
          <Search size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search notes…"
          />
        </div>
        <div className="search-results">
          {results.length === 0 ? (
            <div className="search-empty">No matches</div>
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
