import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { IconSearch as Search, IconTag as Tag } from '@tabler/icons-react'
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

/** Mirrors the main process's tag matching: separators don't count. */
function tagKey(tag: string): string {
  return tag.toLowerCase().replace(/[\s-]+/g, '')
}

/**
 * The trailing `#tag` / `tag:` fragment being typed, if any. Only the last
 * token can be completed — earlier ones are already-applied filters.
 */
function tagFragment(query: string): string | null {
  if (/\s$/.test(query)) return null
  const last = query.trim().split(/\s+/).pop() ?? ''
  const match = /^(?:tag:|#)(.*)$/i.exec(last)
  return match ? match[1].toLowerCase() : null
}

/** The free text of the query, with `#tag` filters removed — what to highlight. */
function plainText(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter((token) => !/^(?:tag:|#)/i.test(token))
    .join(' ')
}

export default function SearchModal({ onClose, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [allTags, setAllTags] = useState<string[]>([])
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    void window.api.notes.list().then((notes) => {
      const seen = new Map<string, string>()
      for (const note of notes) {
        for (const tag of note.tags) {
          if (!seen.has(tag.toLowerCase())) seen.set(tag.toLowerCase(), tag)
        }
      }
      setAllTags([...seen.values()].sort((a, b) => a.localeCompare(b)))
    })
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
    listRef.current?.querySelector('.search-result.active')?.scrollIntoView({ block: 'nearest' })
  }, [active, results])

  const fragment = tagFragment(query)
  const text = plainText(query)
  // Every `#tag` term with something after the "#" — including the one still
  // being typed, which the main process already treats as a filter.
  const filters = useMemo(
    () =>
      query
        .trim()
        .split(/\s+/)
        .map((token) => /^(?:tag:|#)(.+)$/i.exec(token)?.[1])
        .filter((t): t is string => Boolean(t))
        .map(tagKey),
    [query]
  )
  // A bare "#" is a request for the tag list, not a search — nothing to run yet.
  const searchable = text !== '' || filters.length > 0

  const tagMatches = useMemo(() => {
    if (fragment === null) return []
    const needle = tagKey(fragment)
    // Tags already spelled out in full are filters, not completions.
    const applied = new Set(filters)
    return allTags
      .filter((t) => !applied.has(tagKey(t)) && tagKey(t).includes(needle))
      .slice(0, 6)
  }, [allTags, filters, fragment])

  /** Replaces the fragment being typed with a finished `#tag ` filter. */
  const completeTag = (tag: string): void => {
    const tokens = query.trim().split(/\s+/)
    if (fragment !== null) tokens.pop()
    setQuery(`${[...tokens, `#${tag.replace(/\s+/g, '-')}`].join(' ')} `)
    inputRef.current?.focus()
  }

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
    } else if (e.key === 'Tab' && tagMatches.length > 0) {
      // Tab completes the tag being typed; arrows stay with the results below.
      e.preventDefault()
      completeTag(tagMatches[0])
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results.length === 0 && tagMatches.length > 0) completeTag(tagMatches[0])
      else choose(results[active])
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
            placeholder="Search notes, or #tag to filter…"
          />
        </div>
        {tagMatches.length > 0 && (
          <div className="search-tag-row">
            <span className="search-tag-row-label">Tags</span>
            {tagMatches.map((tag, i) => (
              <button
                key={tag}
                className="search-tag-option"
                onClick={() => completeTag(tag)}
                title={i === 0 ? 'Tab to complete' : undefined}
              >
                <Tag size={11} />
                {tag}
              </button>
            ))}
          </div>
        )}
        {searchable && (
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
                  {r.snippet && (
                    <div className="search-result-snippet">{highlight(r.snippet, text)}</div>
                  )}
                  {r.tags.length > 0 && (
                    <div className="search-result-tags">
                      {r.tags.map((tag) => (
                        <button
                          key={tag}
                          className={
                            r.matchedTags.includes(tag.toLowerCase())
                              ? 'search-result-tag matched'
                              : 'search-result-tag'
                          }
                          title={`Filter by “${tag}”`}
                          onClick={(e) => {
                            e.stopPropagation()
                            completeTag(tag)
                          }}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
