import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import type { SearchResult } from '../../../shared/types'

interface Props {
  onClose: () => void
  onSelect: (result: SearchResult) => void
}

function highlight(text: string, query: string): ReactNode {
  const q = query.trim()
  if (!q) return text
  const lower = text.toLowerCase()
  const needle = q.toLowerCase()
  const out: ReactNode[] = []
  let from = 0
  let key = 0
  while (true) {
    const i = lower.indexOf(needle, from)
    if (i === -1) break
    if (i > from) out.push(text.slice(from, i))
    out.push(<mark key={key++}>{text.slice(i, i + q.length)}</mark>)
    from = i + q.length
  }
  out.push(text.slice(from))
  return out
}

export default function SearchModal({ onClose, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults([])
      return
    }
    const t = setTimeout(() => {
      window.api.notes.search(q).then((r) => {
        setResults(r)
        setActive(0)
      })
    }, 150)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    listRef.current
      ?.querySelector('.search-result.active')
      ?.scrollIntoView({ block: 'nearest' })
  }, [active, results])

  const choose = (r?: SearchResult): void => {
    if (!r) return
    onSelect(r)
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
      choose(results[active])
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="modal-overlay search-overlay" onClick={onClose}>
      <div className="modal search-modal" onClick={(e) => e.stopPropagation()}>
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
        {query.trim() && (
          <div className="search-results" ref={listRef}>
            {results.length === 0 ? (
              <div className="search-empty">No matches</div>
            ) : (
              results.map((r, i) => (
                <div
                  key={r.id}
                  className={i === active ? 'search-result active' : 'search-result'}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(r)}
                >
                  <div className="search-result-head">
                    <span className="search-result-title">{r.title || 'Untitled'}</span>
                    {r.folder && <span className="search-result-folder">{r.folder}</span>}
                  </div>
                  <div className="search-result-snippet">{highlight(r.snippet, query)}</div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
