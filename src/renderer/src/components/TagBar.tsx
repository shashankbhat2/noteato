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
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  const commit = (): void => {
    const tag = normalizeTag(draft)
    setDraft('')
    setAdding(false)
    if (!tag) return
    // Tags are case-insensitively unique; the first spelling entered wins.
    if (tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return
    onChange([...tags, tag])
  }

  const remove = (tag: string): void => onChange(tags.filter((t) => t !== tag))

  const unused = suggestions.filter(
    (s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase())
  )

  // Nothing to show and nothing to add — stay out of the way entirely.
  if (readOnly && tags.length === 0) return null

  return (
    <div className="note-tags-bar">
      <span className="note-tags-icon" title="Tags">
        <Tag size={13} />
      </span>
      {tags.map((tag) => (
        <span key={tag} className="note-tag-chip">
          {tag}
          {!readOnly && (
            <button className="note-tag-remove" title={`Remove “${tag}”`} onClick={() => remove(tag)}>
              <X size={11} />
            </button>
          )}
        </span>
      ))}
      {!readOnly &&
        (adding ? (
          <>
            <input
              ref={inputRef}
              className="note-tag-input"
              list="noteato-tag-suggestions"
              placeholder="Tag name"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault()
                  commit()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setDraft('')
                  setAdding(false)
                }
              }}
            />
            <datalist id="noteato-tag-suggestions">
              {unused.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </>
        ) : (
          <button className="note-tag-add" onClick={() => setAdding(true)}>
            <Plus size={11} />
            <span>{tags.length === 0 ? 'Add tags' : 'Add'}</span>
          </button>
        ))}
    </div>
  )
}
