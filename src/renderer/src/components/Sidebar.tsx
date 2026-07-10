import { Plus, StickyNote, Trash2, Upload } from 'lucide-react'
import type { NoteSummary } from '../../../shared/types'

interface Props {
  notes: NoteSummary[]
  activeNoteId: string | null
  collapsed: boolean
  onSelect: (filename: string) => void
  onCreate: () => void
  onDelete: (filename: string) => void
  onCreateSticky: () => void
  onImport: () => void
}

export default function Sidebar({
  notes,
  activeNoteId,
  collapsed,
  onSelect,
  onCreate,
  onDelete,
  onCreateSticky,
  onImport
}: Props) {
  return (
    <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
      <div className="sidebar-actions">
        <button className="sidebar-action-btn" onClick={onCreate}>
          <Plus size={14} />
          <span>New note</span>
        </button>
        <button className="sidebar-icon-btn" onClick={onCreateSticky} title="New sticky note">
          <StickyNote size={16} />
        </button>
        <button className="sidebar-icon-btn" onClick={onImport} title="Import markdown files">
          <Upload size={15} />
        </button>
      </div>
      <ul className="note-list">
        {notes.map((note) => (
          <li
            key={note.id}
            className={note.id === activeNoteId ? 'active' : ''}
            onClick={() => onSelect(note.filename)}
          >
            <div className="note-title">{note.title || 'Untitled'}</div>
            <div className="note-excerpt">{note.excerpt}</div>
            <button
              className="delete-btn"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(note.filename)
              }}
            >
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
