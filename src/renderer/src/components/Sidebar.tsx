import { useEffect, useMemo, useState } from 'react'
import {
  IconBell as Bell,
  IconHome as Home,
  IconLink as Link,
  IconStar as Star,
  IconDownload as Download,
  IconPlus as Plus,
  IconSearch as Search,
  IconTrash as Trash2,
  IconX as X
} from '@tabler/icons-react'
import type { NoteSummary } from '../../../shared/types'
import { REMINDER_PRESETS } from '../reminderPresets'
import ContextMenu, { type MenuItem } from './ContextMenu'
import ReminderPopover from './ReminderPopover'

const REVEAL_LABEL =
  window.electron.process.platform === 'darwin' ? 'Reveal in Finder' : 'Show in folder'

const MODIFIER_HINT = window.electron.process.platform === 'darwin' ? '⌘' : 'Ctrl'

interface Props {
  notes: NoteSummary[]
  trashCount: number
  activeNoteId: string | null
  collapsed: boolean
  /** `inNewPane` is a ⌘/Ctrl-click: open beside what's already showing. */
  onSelect: (note: NoteSummary, inNewPane: boolean) => void
  onDeleteNote: (note: NoteSummary) => void
  onRemoveNote: (note: NoteSummary) => void
  onRenameNote: (note: NoteSummary, title: string) => void
  onTogglePin: (note: NoteSummary) => void
  onSetReminder: (note: NoteSummary, reminderAt: string | null) => void
  onCopyPath: (note: NoteSummary) => void
  onRevealInFinder: (note: NoteSummary) => void
  onRemoveLinkedFolder: (rootPath: string) => void
  /** Dragging a note onto the working area's edge opens it in a new pane. */
  onNoteDragStart: (note: NoteSummary) => void
  onNoteDragEnd: () => void
  onOpenTrash: () => void
  onOpenHome: () => void
  onOpenImport: () => void
  onSearch: () => void
  onCreateNote: () => void
}

export default function Sidebar({
  notes,
  trashCount,
  activeNoteId,
  collapsed,
  onSelect,
  onDeleteNote,
  onRemoveNote,
  onRenameNote,
  onTogglePin,
  onSetReminder,
  onCopyPath,
  onRevealInFinder,
  onRemoveLinkedFolder,
  onNoteDragStart,
  onNoteDragEnd,
  onOpenTrash,
  onOpenHome,
  onOpenImport,
  onSearch,
  onCreateNote
}: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [reminderPopover, setReminderPopover] = useState<{
    note: NoteSummary
    x: number
    y: number
  } | null>(null)
  const [renaming, setRenaming] = useState<{ note: NoteSummary; initial: string } | null>(null)
  const [editValue, setEditValue] = useState('')

  // One flat list, pinned notes first — the only grouping left, and it earns
  // its place by keeping the notes you always want at the top where they are.
  const [pinned, rest] = useMemo(() => {
    const byRecency = [...notes].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    return [byRecency.filter((n) => n.pinned), byRecency.filter((n) => !n.pinned)]
  }, [notes])

  // A note being renamed can be deleted from elsewhere (sidebar mode, an
  // external edit) while the input is open.
  useEffect(() => {
    if (renaming && !notes.some((n) => n.id === renaming.note.id)) setRenaming(null)
  }, [notes, renaming])

  const commitRename = (): void => {
    const value = editValue.trim()
    if (renaming && value && value !== renaming.initial) onRenameNote(renaming.note, value)
    setRenaming(null)
  }

  const startRename = (note: NoteSummary): void => {
    setEditValue(note.title || 'Untitled')
    setRenaming({ note, initial: note.title || 'Untitled' })
  }

  const remindMeSubmenu = (note: NoteSummary, x: number, y: number): MenuItem[] => {
    const items: MenuItem[] = REMINDER_PRESETS.map((preset) => ({
      label: preset.label,
      onClick: () => onSetReminder(note, preset.at())
    }))
    items.push({ label: 'Custom…', onClick: () => setReminderPopover({ note, x, y }) })
    if (note.reminderAt) {
      items.push({ separator: true, label: '' })
      items.push({ label: 'Clear reminder', onClick: () => onSetReminder(note, null) })
    }
    return items
  }

  const openNoteMenu = (e: React.MouseEvent, note: NoteSummary): void => {
    e.preventDefault()
    e.stopPropagation()
    const x = e.clientX
    const y = e.clientY
    setMenu({
      x,
      y,
      items: [
        { label: 'Open in new pane', onClick: () => onSelect(note, true) },
        { separator: true, label: '' },
        { label: note.pinned ? 'Remove from favourites' : 'Add to favourites', onClick: () => onTogglePin(note) },
        { label: 'Remind me', submenu: remindMeSubmenu(note, x, y) },
        { label: note.external ? 'Rename title' : 'Rename', onClick: () => startRename(note) },
        { separator: true, label: '' },
        { label: 'Copy path', onClick: () => onCopyPath(note) },
        { label: REVEAL_LABEL, onClick: () => onRevealInFinder(note) },
        { separator: true, label: '' },
        // A note surfaced by walking a linked folder has no link of its own —
        // offer to unlink the whole folder instead.
        note.external
          ? note.fromFolder && note.externalRoot
            ? {
                label: 'Remove folder from Noteato',
                onClick: () => onRemoveLinkedFolder(note.externalRoot!)
              }
            : { label: 'Remove from Noteato', onClick: () => onRemoveNote(note) }
          : { label: 'Delete', danger: true, onClick: () => onDeleteNote(note) }
      ]
    })
  }

  const renderNote = (note: NoteSummary): React.ReactNode => {
    if (renaming?.note.id === note.id) {
      return (
        <li key={note.id} className="note-item">
          <input
            className="note-rename-input"
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              else if (e.key === 'Escape') setRenaming(null)
            }}
          />
        </li>
      )
    }
    return (
      <li
        key={note.id}
        className={note.id === activeNoteId ? 'note-item active' : 'note-item'}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', note.id)
          onNoteDragStart(note)
        }}
        onDragEnd={onNoteDragEnd}
        onClick={(e) => onSelect(note, e.metaKey || e.ctrlKey)}
        onDoubleClick={(e) => {
          e.stopPropagation()
          startRename(note)
        }}
        onContextMenu={(e) => openNoteMenu(e, note)}
        title={`${note.title || 'Untitled'} · ${MODIFIER_HINT}-click to open in a new pane`}
      >
        <div className="note-item-main">
          <div className="note-title">
            {note.pinned && <Star size={11} className="note-pin-icon" />}
            {note.reminderAt && <Bell size={11} className="note-reminder-icon" />}
            {note.external && <Link size={11} className="note-linked-icon" />}
            {note.title || 'Untitled'}
          </div>
        </div>
        <div className="note-item-actions">
          <button
            className="row-icon-btn"
            title={note.pinned ? 'Remove from favourites' : 'Add to favourites'}
            onClick={(e) => {
              e.stopPropagation()
              onTogglePin(note)
            }}
          >
            <Star size={13} />
          </button>
          {/* Folder-sourced notes have no link of their own; unlink via the
              context menu instead. */}
          {!(note.external && note.fromFolder) && (
            <button
              className={note.external ? 'row-icon-btn' : 'row-icon-btn danger'}
              title={note.external ? 'Remove from Noteato' : 'Delete'}
              onClick={(e) => {
                e.stopPropagation()
                if (note.external) onRemoveNote(note)
                else onDeleteNote(note)
              }}
            >
              {note.external ? <X size={13} /> : <Trash2 size={13} />}
            </button>
          )}
        </div>
      </li>
    )
  }

  return (
    <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
      {/* What you do *to* the library, above the library itself. */}
      <nav className="sidebar-rail">
        <button className="sidebar-rail-btn" onClick={onOpenHome} title="Home">
          <Home size={17} />
        </button>
        <button
          className="sidebar-rail-btn"
          onClick={onSearch}
          title={`Search notes · ${MODIFIER_HINT}K`}
        >
          <Search size={17} />
        </button>
        <button
          className="sidebar-rail-btn"
          onClick={onCreateNote}
          title={`New note · ${MODIFIER_HINT}T`}
        >
          <Plus size={17} />
        </button>
        <button className="sidebar-rail-btn" onClick={onOpenImport} title="Import">
          <Download size={17} />
        </button>
        <button className="sidebar-rail-btn" onClick={onOpenTrash} title="Trash">
          <Trash2 size={17} />
          {trashCount > 0 && <span className="sidebar-trash-dot" />}
        </button>
      </nav>

      <div className="sidebar-scroll">
        {notes.length === 0 && <p className="sidebar-empty">No notes yet.</p>}
        {/* Two groups, and only when there is something to tell apart — an
            unpinned library shouldn't carry a "Notes" heading over its only
            list. */}
        {pinned.length > 0 && (
          <>
            <h2 className="sidebar-group-title">Favourites</h2>
            <ul className="note-list">{pinned.map(renderNote)}</ul>
          </>
        )}
        {rest.length > 0 && (
          <>
            {pinned.length > 0 && <h2 className="sidebar-group-title">Notes</h2>}
            <ul className="note-list">{rest.map(renderNote)}</ul>
          </>
        )}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
      {reminderPopover && (
        <ReminderPopover
          position={{ x: reminderPopover.x, y: reminderPopover.y }}
          value={reminderPopover.note.reminderAt}
          onSet={(iso) => {
            onSetReminder(reminderPopover.note, iso)
            setReminderPopover(null)
          }}
          onClear={() => {
            onSetReminder(reminderPopover.note, null)
            setReminderPopover(null)
          }}
          onClose={() => setReminderPopover(null)}
        />
      )}
    </aside>
  )
}
