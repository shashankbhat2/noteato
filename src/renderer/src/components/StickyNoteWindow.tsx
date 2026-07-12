import { useEffect, useRef, useState } from 'react'
import { IconX as X } from '@tabler/icons-react'
import type { StickyNoteData } from '../../../shared/types'

export default function StickyNoteWindow({ id }: { id: string }) {
  const [note, setNote] = useState<StickyNoteData | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    window.api.sticky.list().then((notes) => {
      setNote(notes.find((n) => n.id === id) ?? null)
    })
  }, [id])

  if (!note) return <div />

  const handleChange = (content: string): void => {
    setNote({ ...note, content })
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => window.api.sticky.update(id, { content }), 400)
  }

  return (
    <div className="sticky-note" style={{ backgroundColor: note.color }}>
      <div className="sticky-titlebar">
        <button className="sticky-close" onClick={() => window.api.sticky.close(id)}>
          <X size={13} />
        </button>
      </div>
      <textarea
        className="sticky-textarea"
        value={note.content}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Sticky note…"
        autoFocus
      />
    </div>
  )
}
