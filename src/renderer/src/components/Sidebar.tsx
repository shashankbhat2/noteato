import { useEffect, useMemo, useState } from 'react'
import {
  IconBell as Bell,
  IconChevronDown as ChevronDown,
  IconChevronRight as ChevronRight,
  IconFolderPlus as FolderPlus,
  IconNote as StickyNote,
  IconPin as Pin,
  IconPlus as Plus,
  IconSearch as Search,
  IconTrash as Trash2,
  IconUpload as Upload,
  IconX as X
} from '@tabler/icons-react'
import type { NoteSummary } from '../../../shared/types'
import { REMINDER_PRESETS } from '../reminderPresets'
import { buildTree, type FolderNode } from '../tree'
import ContextMenu, { type MenuItem } from './ContextMenu'
import ReminderPopover from './ReminderPopover'

const EXPANDED_KEY = 'noteato:expandedFolders'

interface Props {
  notes: NoteSummary[]
  folders: string[]
  activeNoteId: string | null
  selectedFolder: string | null
  collapsed: boolean
  onSelect: (note: NoteSummary) => void
  onSelectFolder: (path: string | null) => void
  onCreateNote: (folder: string) => void
  onCreateFolder: (parent: string, name: string) => void
  onRenameFolder: (path: string, name: string) => void
  onDeleteFolder: (path: string) => void
  onDeleteNote: (note: NoteSummary) => void
  onRemoveNote: (note: NoteSummary) => void
  onRenameNote: (note: NoteSummary, title: string) => void
  onTogglePin: (note: NoteSummary) => void
  onSetReminder: (note: NoteSummary, reminderAt: string | null) => void
  onMoveNote: (path: string, targetFolder: string) => void
  onMoveFolder: (path: string, targetParent: string) => void
  onCreateSticky: () => void
  onImport: () => void
  onImportNotion: () => void
  onSearch: () => void
}

interface DragPayload {
  type: 'note' | 'folder'
  path: string
}

type Editing =
  | { mode: 'new-folder'; parent: string }
  | { mode: 'rename-folder'; path: string; initial: string }
  | { mode: 'rename-note'; note: NoteSummary; initial: string }
  | null

export default function Sidebar({
  notes,
  folders,
  activeNoteId,
  selectedFolder,
  collapsed,
  onSelect,
  onSelectFolder,
  onCreateNote,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onDeleteNote,
  onRemoveNote,
  onRenameNote,
  onTogglePin,
  onSetReminder,
  onMoveNote,
  onMoveFolder,
  onCreateSticky,
  onImport,
  onImportNotion,
  onSearch
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]'))
    } catch {
      return new Set<string>()
    }
  })
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [reminderPopover, setReminderPopover] = useState<{
    note: NoteSummary
    x: number
    y: number
  } | null>(null)
  const [editing, setEditing] = useState<Editing>(null)
  const [editValue, setEditValue] = useState('')
  const [dragOver, setDragOver] = useState<string | null>(null)

  const tree = useMemo(
    () => buildTree(notes.filter((note) => !note.external), folders),
    [notes, folders]
  )
  const linkedFolders = useMemo(() => {
    const groups = new Map<string, NoteSummary[]>()
    for (const note of notes) {
      if (!note.external) continue
      const group = groups.get(note.folder) ?? []
      group.push(note)
      groups.set(note.folder, group)
    }
    return [...groups.entries()]
      .map(([path, linkedNotes]) => ({
        path,
        name: path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path,
        notes: linkedNotes.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [notes])
  const pinned = useMemo(
    () =>
      notes
        .filter((n) => n.pinned)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [notes]
  )
  const folderPaths = useMemo(() => folders.slice().sort((a, b) => a.localeCompare(b)), [folders])

  const persistExpanded = (next: Set<string>): void => {
    setExpanded(next)
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]))
  }

  const expand = (path: string): void => {
    if (!path || expanded.has(path)) return
    const next = new Set(expanded)
    // Expand the folder and all its ancestors.
    let p = path
    while (p) {
      next.add(p)
      const i = p.lastIndexOf('/')
      p = i === -1 ? '' : p.slice(0, i)
    }
    persistExpanded(next)
  }

  const toggle = (path: string): void => {
    const next = new Set(expanded)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    persistExpanded(next)
  }

  // Reveal the active note by expanding its ancestor folders.
  useEffect(() => {
    const active = notes.find((n) => n.id === activeNoteId)
    if (active?.folder) expand(active.external ? `linked:${active.folder}` : active.folder)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNoteId])

  const startNewFolder = (parent: string): void => {
    expand(parent)
    setEditValue('')
    setEditing({ mode: 'new-folder', parent })
  }

  const startRename = (path: string): void => {
    setEditValue(path.slice(path.lastIndexOf('/') + 1))
    setEditing({ mode: 'rename-folder', path, initial: path.slice(path.lastIndexOf('/') + 1) })
  }

  const startRenameNote = (note: NoteSummary): void => {
    setEditValue(note.title || 'Untitled')
    setEditing({ mode: 'rename-note', note, initial: note.title || 'Untitled' })
  }

  const commitEdit = (): void => {
    const value = editValue.trim()
    if (editing && value) {
      if (editing.mode === 'new-folder') onCreateFolder(editing.parent, value)
      else if (editing.mode === 'rename-folder') {
        if (value !== editing.initial) onRenameFolder(editing.path, value)
      } else if (value !== editing.initial) onRenameNote(editing.note, value)
    }
    setEditing(null)
  }

  // --- Drag and drop -------------------------------------------------------

  const onDragStart = (e: React.DragEvent, payload: DragPayload): void => {
    e.dataTransfer.setData('text/plain', JSON.stringify(payload))
    e.dataTransfer.effectAllowed = 'move'
  }

  const readPayload = (e: React.DragEvent): DragPayload | null => {
    try {
      return JSON.parse(e.dataTransfer.getData('text/plain')) as DragPayload
    } catch {
      return null
    }
  }

  const dropInto = (e: React.DragEvent, targetFolder: string): void => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(null)
    const payload = readPayload(e)
    if (!payload) return
    if (payload.type === 'note') {
      onMoveNote(payload.path, targetFolder)
    } else {
      // Reject dropping a folder into itself, its own descendant, or the parent
      // it already sits in.
      const slash = payload.path.lastIndexOf('/')
      const parent = slash === -1 ? '' : payload.path.slice(0, slash)
      if (
        targetFolder === payload.path ||
        targetFolder.startsWith(`${payload.path}/`) ||
        targetFolder === parent
      ) {
        return
      }
      onMoveFolder(payload.path, targetFolder)
    }
  }

  // --- Rendering -----------------------------------------------------------

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
    const items: MenuItem[] = note.external
      ? [
          { label: note.pinned ? 'Unpin' : 'Pin', onClick: () => onTogglePin(note) },
          { label: 'Remind me', submenu: remindMeSubmenu(note, x, y) },
          { label: 'Rename title', onClick: () => startRenameNote(note) },
          { separator: true, label: '' },
          { label: 'Remove from Noteato', onClick: () => onRemoveNote(note) }
        ]
      : [
          { label: note.pinned ? 'Unpin' : 'Pin', onClick: () => onTogglePin(note) },
          { label: 'Remind me', submenu: remindMeSubmenu(note, x, y) },
          { label: 'Rename', onClick: () => startRenameNote(note) },
          { label: 'Move to', submenu: moveNoteSubmenu(note) },
          { separator: true, label: '' },
          { label: 'Delete', danger: true, onClick: () => onDeleteNote(note) }
        ]
    setMenu({
      x,
      y,
      items
    })
  }

  const moveNoteSubmenu = (note: NoteSummary): MenuItem[] => {
    const items: MenuItem[] = []
    if (note.folder !== '') items.push({ label: '(Root)', onClick: () => onMoveNote(note.path, '') })
    for (const f of folderPaths) {
      if (f !== note.folder) items.push({ label: f, onClick: () => onMoveNote(note.path, f) })
    }
    if (items.length === 0) items.push({ label: 'No other folders' })
    return items
  }

  const openFolderMenu = (e: React.MouseEvent, path: string): void => {
    e.preventDefault()
    e.stopPropagation()
    onSelectFolder(path)
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'New note here', onClick: () => onCreateNote(path) },
        { label: 'New subfolder', onClick: () => startNewFolder(path) },
        { label: 'Rename', onClick: () => startRename(path) },
        { separator: true, label: '' },
        { label: 'Delete folder', danger: true, onClick: () => onDeleteFolder(path) }
      ]
    })
  }

  const renderNote = (note: NoteSummary, depth: number): React.ReactNode => {
    const isRenaming = editing?.mode === 'rename-note' && editing.note.id === note.id
    if (isRenaming) {
      return (
        <li key={note.id} className="note-item" style={{ paddingLeft: 10 + depth * 14 }}>
          <input
            className="folder-rename-input"
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit()
              else if (e.key === 'Escape') setEditing(null)
            }}
          />
        </li>
      )
    }
    return (
    <li
      key={note.id}
      className={note.id === activeNoteId ? 'note-item active' : 'note-item'}
      style={{ paddingLeft: 10 + depth * 14 }}
      draggable={!note.external}
      onDragStart={(e) => {
        if (!note.external) onDragStart(e, { type: 'note', path: note.path })
      }}
      onClick={() => onSelect(note)}
      onDoubleClick={(e) => {
        e.stopPropagation()
        startRenameNote(note)
      }}
      onContextMenu={(e) => openNoteMenu(e, note)}
    >
      <div className="note-item-main">
        <div className="note-title">
          {note.pinned && <Pin size={11} className="note-pin-icon" />}
          {note.reminderAt && <Bell size={11} className="note-reminder-icon" />}
          {note.title || 'Untitled'}
        </div>
      </div>
      <div className="note-item-actions">
        <button
          className="row-icon-btn"
          title={note.pinned ? 'Unpin' : 'Pin'}
          onClick={(e) => {
            e.stopPropagation()
            onTogglePin(note)
          }}
        >
          <Pin size={13} />
        </button>
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
      </div>
    </li>
    )
  }

  const renderFolder = (node: FolderNode, depth: number): React.ReactNode => {
    const isOpen = expanded.has(node.path)
    const isEditingThis = editing?.mode === 'rename-folder' && editing.path === node.path
    const rowClass = [
      'folder-row',
      selectedFolder === node.path ? 'selected' : '',
      dragOver === node.path ? 'drop-target' : ''
    ]
      .filter(Boolean)
      .join(' ')
    return (
      <li key={node.path} className="folder-item">
        <div
          className={rowClass}
          style={{ paddingLeft: 8 + depth * 14 }}
          draggable={!isEditingThis}
          onDragStart={(e) => onDragStart(e, { type: 'folder', path: node.path })}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(node.path)
          }}
          onDragLeave={() => setDragOver((p) => (p === node.path ? null : p))}
          onDrop={(e) => dropInto(e, node.path)}
          onClick={() => {
            if (isEditingThis) return
            onSelectFolder(node.path)
            toggle(node.path)
          }}
          onDoubleClick={(e) => {
            if (isEditingThis) return
            e.stopPropagation()
            startRename(node.path)
          }}
          onContextMenu={(e) => openFolderMenu(e, node.path)}
        >
          <span className="folder-chevron">
            {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
          {isEditingThis ? (
            <input
              className="folder-rename-input"
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit()
                else if (e.key === 'Escape') setEditing(null)
              }}
            />
          ) : (
            <span className="folder-name">{node.name}</span>
          )}
        </div>
        {isOpen && (
          <ul className="tree-children">
            {node.folders.map((child) => renderFolder(child, depth + 1))}
            {editing?.mode === 'new-folder' && editing.parent === node.path &&
              renderNewFolderInput(depth + 1)}
            {node.notes.map((note) => renderNote(note, depth + 1))}
          </ul>
        )}
      </li>
    )
  }

  const renderLinkedFolder = (group: (typeof linkedFolders)[number]): React.ReactNode => {
    const key = `linked:${group.path}`
    const isOpen = expanded.has(key)
    return (
      <li key={group.path} className="folder-item">
        <div
          className="folder-row linked"
          title={group.path}
          onClick={() => toggle(key)}
        >
          <span className="folder-chevron">
            {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
          <span className="folder-name">{group.name}</span>
        </div>
        {isOpen && (
          <ul className="tree-children">
            {group.notes.map((note) => renderNote(note, 1))}
          </ul>
        )}
      </li>
    )
  }

  const renderNewFolderInput = (depth: number): React.ReactNode => (
    <li className="folder-item">
      <div className="folder-row" style={{ paddingLeft: 8 + depth * 14 }}>
        <span className="folder-chevron">
          <ChevronRight size={13} />
        </span>
        <input
          className="folder-rename-input"
          autoFocus
          placeholder="Folder name"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit()
            else if (e.key === 'Escape') setEditing(null)
          }}
        />
      </div>
    </li>
  )

  return (
    <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
      <div className="sidebar-actions">
        <button
          className="sidebar-icon-btn"
          onClick={() => onCreateNote(selectedFolder ?? '')}
          title={selectedFolder ? `New note in ${selectedFolder}` : 'New note'}
        >
          <Plus size={17} />
        </button>
        <button className="sidebar-icon-btn" onClick={() => startNewFolder('')} title="New folder">
          <FolderPlus size={16} />
        </button>
        <button className="sidebar-icon-btn" onClick={onSearch} title="Search notes (⌘K)">
          <Search size={15} />
        </button>
        <button className="sidebar-icon-btn" onClick={onCreateSticky} title="New sticky note">
          <StickyNote size={16} />
        </button>
        <button
          className="sidebar-icon-btn"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            setMenu({
              x: rect.left,
              y: rect.bottom + 4,
              items: [
                { label: 'From Markdown…', onClick: onImport },
                { label: 'From Notion…', onClick: onImportNotion }
              ]
            })
          }}
          title="Import notes"
        >
          <Upload size={15} />
        </button>
      </div>

      <div
        className={dragOver === '' ? 'sidebar-scroll drop-root' : 'sidebar-scroll'}
        onClick={(e) => {
          if (e.target === e.currentTarget) onSelectFolder(null)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver('')
        }}
        onDragLeave={() => setDragOver((p) => (p === '' ? null : p))}
        onDrop={(e) => dropInto(e, '')}
      >
        {pinned.length > 0 && (
          <>
            <div className="sidebar-section-label">Pinned</div>
            <ul className="note-list">{pinned.map((note) => renderNote(note, 0))}</ul>
          </>
        )}

        {linkedFolders.length > 0 && (
          <>
            <div className="sidebar-section-label">Linked</div>
            <ul className="note-list">{linkedFolders.map(renderLinkedFolder)}</ul>
          </>
        )}

        <ul className="note-list tree-root">
          {tree.folders.map((child) => renderFolder(child, 0))}
          {editing?.mode === 'new-folder' && editing.parent === '' && renderNewFolderInput(0)}
          {tree.notes.map((note) => renderNote(note, 0))}
        </ul>
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
