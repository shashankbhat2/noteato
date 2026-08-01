import { useEffect, useRef, useState } from 'react'
import { IconPlus as Plus, IconTag as Tag, IconX as X } from '@tabler/icons-react'

interface Props {
  tags: string[]
  /** Every tag already used in the library, offered as completions. */
  suggestions: string[]
  onChange: (tags: string[]) => void
  /** Linked files aren't written by Noteato, so their tags are read-only. */
  readOnly?: boolean
}

/**
 * Tags are stored in the note's frontmatter as `tags: [a, b]`, so commas and
 * brackets can't survive a round trip — strip them along with a leading "#"
 * people habitually type.
 */
export function normalizeTag(raw: string): string {
  return raw
    .replace(/[,[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^#+/, '')
    .trim()
    .slice(0, 40)
}

export default function TagBar({ tags, suggestions, onChange, readOnly }: Props) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [hovering, setHovering] = useState(false)
  const [expanded, setExpanded] = useState(false)
  // Which completion the arrow keys have landed on; -1 means "use what I typed".
  const [highlighted, setHighlighted] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  useEffect(() => {
    if (!expanded) return
    const close = (event: PointerEvent): void => {
      if (!barRef.current?.contains(event.target as Node)) setExpanded(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [expanded])

  const add = (raw: string): void => {
    const tag = normalizeTag(raw)
    setDraft('')
    setHighlighted(-1)
    setAdding(false)
    if (!tag) return
    // Tags are case-insensitively unique; the first spelling entered wins.
    if (tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return
    onChange([...tags, tag])
  }

  const remove = (tag: string): void => onChange(tags.filter((t) => t !== tag))

  const unused = suggestions.filter((s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase()))
  // Completions for what's typed so far. An empty draft offers the whole
  // library, which is how someone reuses a tag they can't quite remember.
  const query = normalizeTag(draft).toLowerCase()
  const matches = (query ? unused.filter((s) => s.toLowerCase().includes(query)) : unused).slice(
    0,
    8
  )

  // Nothing to show and nothing to add — stay out of the way entirely.
  if (readOnly && tags.length === 0) return null

  const visibleTags = tags.slice(0, 3)
  const hiddenCount = Math.max(0, tags.length - visibleTags.length)
  const showAllTags = hiddenCount > 0 && (hovering || expanded)

  return (
    <div
      ref={barRef}
      className="note-tags-bar"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <span className="note-tags-icon" title="Tags">
        <Tag size={13} />
      </span>
      {visibleTags.map((tag) => (
        <span key={tag} className="note-tag-chip">
          {tag}
          {!readOnly && (
            <button className="note-tag-remove" title={`Remove “${tag}”`} onClick={() => remove(tag)}>
              <X size={11} />
            </button>
          )}
        </span>
      ))}
      {hiddenCount > 0 && (
        <button
          className="note-tag-overflow-btn"
          aria-expanded={showAllTags}
          onClick={() => setExpanded((value) => !value)}
        >
          +{hiddenCount}
        </button>
      )}
      {!readOnly &&
        (adding ? (
          <div className="note-tag-entry">
            <input
              ref={inputRef}
              className="note-tag-input"
              placeholder="Tag name"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                setHighlighted(-1)
              }}
              // Suggestions commit on mousedown, before this fires.
              onBlur={() => add(draft)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault()
                  add(highlighted >= 0 ? matches[highlighted] : draft)
                } else if (e.key === 'ArrowDown' && matches.length > 0) {
                  e.preventDefault()
                  setHighlighted((h) => (h + 1 >= matches.length ? -1 : h + 1))
                } else if (e.key === 'ArrowUp' && matches.length > 0) {
                  e.preventDefault()
                  setHighlighted((h) => (h <= -1 ? matches.length - 1 : h - 1))
                } else if (e.key === 'Tab' && matches.length > 0) {
                  e.preventDefault()
                  add(matches[Math.max(highlighted, 0)])
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setDraft('')
                  setHighlighted(-1)
                  setAdding(false)
                }
              }}
            />
            {matches.length > 0 && (
              <div className="note-tag-suggestions">
                {matches.map((s, i) => (
                  <button
                    key={s}
                    className={i === highlighted ? 'note-tag-suggestion active' : 'note-tag-suggestion'}
                    // Fires before the input's blur, so the pick isn't lost.
                    onMouseDown={(e) => {
                      e.preventDefault()
                      add(s)
                    }}
                    onMouseEnter={() => setHighlighted(i)}
                  >
                    <Tag size={11} />
                    <span>{s}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button className="note-tag-add" onClick={() => setAdding(true)}>
            <Plus size={11} />
            <span>{tags.length === 0 ? 'Add tags' : 'Add'}</span>
          </button>
        ))}
      {showAllTags && (
        <div className="note-tags-popover" role="group" aria-label="All note tags">
          <span className="note-tags-popover-label">All tags</span>
          <div className="note-tags-popover-list">
            {tags.map((tag) => (
              <span key={tag} className="note-tag-chip">
                {tag}
                {!readOnly && (
                  <button
                    className="note-tag-remove"
                    title={`Remove “${tag}”`}
                    onClick={() => remove(tag)}
                  >
                    <X size={11} />
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
