import { useEffect, useMemo, useRef, useState } from 'react'
import {
  IconBell as Bell,
  IconChevronDown as ChevronDown,
  IconChevronRight as ChevronRight,
  IconHome as Home,
  IconPin as Pin,
  IconPlus as Plus,
  IconSearch as Search,
  IconTag as Tag,
  IconDownload as Download,
  IconSettings as Settings,
  IconSparkles as Sparkles,
  IconTrash as Trash2,
  IconX as X
} from '@tabler/icons-react'
import type { NoteSummary } from '../../../shared/types'
import { REMINDER_PRESETS } from '../reminderPresets'
import { buildTree, type FolderNode } from '../tree'
import ContextMenu, { type MenuItem } from './ContextMenu'
import ReminderPopover from './ReminderPopover'

const EXPANDED_KEY = 'noteato:expandedFolders'
const SECTIONS_KEY = 'noteato:sidebarSections'

type SectionId = 'pinned' | 'tags' | 'notes' | 'import'

const DEFAULT_SECTIONS: Record<SectionId, boolean> = {
  pinned: true,
  tags: false,
  notes: true,
  import: false
}

const REVEAL_LABEL =
  window.electron.process.platform === 'darwin' ? 'Reveal in Finder' : 'Show in folder'

interface Props {
  notes: NoteSummary[]
  folders: string[]
  trashCount: number
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
  /** Open the note beside the one already showing (split view). */
  onAddToSplit: (note: NoteSummary) => void
  /** False when there's no other open note to split against. */
  canSplit: boolean
  onSetReminder: (note: NoteSummary, reminderAt: string | null) => void
  onMoveNote: (path: string, targetFolder: string) => void
  onMoveFolder: (path: string, targetParent: string) => void
  onCreateSticky: () => void
  onImport: () => void
  onOpenFolder: () => void
  onRemoveLinkedFolder: (rootPath: string) => void
  onImportNotion: () => void
  onSearch: () => void
  onOpenTrash: () => void
  onOpenHome: () => void
  /** The assistant is a view you open, like Home — see MainLayout's pane row. */
  onOpenAssistant: () => void
  /** Import is an errand, not a shelf — it opens as a modal. */
  onOpenImport: () => void
  assistantOpen: boolean
  assistantAvailable: boolean
  onOpenSettings: () => void
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

/**
 * Height-animated disclosure. The content stays mounted so it can animate in
 * both directions — the grid-rows 0fr→1fr trick gets a real height transition
 * without measuring anything in JS.
 */
function Collapsible({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div className={open ? 'collapsible open' : 'collapsible'} aria-hidden={!open}>
      <div className="collapsible-inner">{children}</div>
    </div>
  )
}

export default function Sidebar({
  notes,
  folders,
  trashCount,
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
  onAddToSplit,
  canSplit,
  onSetReminder,
  onMoveNote,
  onMoveFolder,
  onCreateSticky,
  onImport,
  onOpenFolder,
  onRemoveLinkedFolder,
  onImportNotion,
  onSearch,
  onOpenTrash,
  onOpenHome,
  onOpenAssistant,
  onOpenImport,
  assistantOpen,
  assistantAvailable,
  onOpenSettings
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]'))
    } catch {
      return new Set<string>()
    }
  })
  // Collapsible top-level sections (Pinned Notes / Your Notes / Import / Trash).
  const [sections, setSections] = useState<Record<SectionId, boolean>>(() => {
    try {
      return { ...DEFAULT_SECTIONS, ...JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '{}') }
    } catch {
      return { ...DEFAULT_SECTIONS }
    }
  })
  const toggleSection = (id: SectionId): void => {
    setSections((prev) => {
      const next = { ...prev, [id]: !prev[id] }
      localStorage.setItem(SECTIONS_KEY, JSON.stringify(next))
      return next
    })
  }
  const newSplitRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [reminderPopover, setReminderPopover] = useState<{
    note: NoteSummary
    x: number
    y: number
  } | null>(null)
  const [editing, setEditing] = useState<Editing>(null)
  const [editValue, setEditValue] = useState('')
  const [dragOver, setDragOver] = useState<string | null>(null)
  // While a tag is selected, "Your Notes" shows a flat list of its notes
  // instead of the folder tree.
  const [activeTag, setActiveTag] = useState<string | null>(null)

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
  // Tags are matched case-insensitively but displayed with the spelling of the
  // first note that used them.
  const tagCounts = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>()
    for (const note of notes) {
      for (const tag of note.tags) {
        const key = tag.toLowerCase()
        const entry = counts.get(key)
        if (entry) entry.count += 1
        else counts.set(key, { label: tag, count: 1 })
      }
    }
    return [...counts.entries()]
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  }, [notes])
  const taggedNotes = useMemo(() => {
    if (!activeTag) return []
    return notes
      .filter((note) => note.tags.some((tag) => tag.toLowerCase() === activeTag))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  }, [notes, activeTag])

  // A tag that disappeared (last note untagged or deleted) can't stay selected.
  useEffect(() => {
    if (activeTag && !tagCounts.some((t) => t.key === activeTag)) setActiveTag(null)
  }, [tagCounts, activeTag])

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

  // Reveal the active note by expanding its ancestor folders. Pinned notes
  // are already visible in the Pinned section, so leave their folder alone.
  useEffect(() => {
    const active = notes.find((n) => n.id === activeNoteId)
    if (active?.folder && !active.pinned) {
      expand(active.external ? `linked:${active.folder}` : active.folder)
    }
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

  // Actions every note has, wherever it lives on disk.
  const fileMenuItems = (note: NoteSummary): MenuItem[] => [
    ...(canSplit
      ? [{ label: 'Add to split view', onClick: () => onAddToSplit(note) }]
      : []),
    // A linked file can be unlinked (or gone) between the list and the click —
    // the main process rejects those, and there's nothing useful to report.
    {
      label: 'Copy path',
      onClick: () => void window.api.notes.copyPath(note.path).catch(() => {})
    },
    {
      label: REVEAL_LABEL,
      onClick: () => void window.api.notes.revealInFinder(note.path).catch(() => {})
    }
  ]

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
          ...fileMenuItems(note),
          { separator: true, label: '' },
          // A folder-sourced note has no link of its own — offer to unlink
          // the whole folder instead.
          note.fromFolder && note.externalRoot
            ? {
                label: 'Remove folder from Noteato',
                onClick: () => onRemoveLinkedFolder(note.externalRoot!)
              }
            : { label: 'Remove from Noteato', onClick: () => onRemoveNote(note) }
        ]
      : [
          { label: note.pinned ? 'Unpin' : 'Pin', onClick: () => onTogglePin(note) },
          { label: 'Remind me', submenu: remindMeSubmenu(note, x, y) },
          { label: 'Rename', onClick: () => startRenameNote(note) },
          { label: 'Move to', submenu: moveNoteSubmenu(note) },
          { separator: true, label: '' },
          ...fileMenuItems(note),
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

  const renderNote = (
    note: NoteSummary,
    depth: number,
    section: 'pinned' | 'tree' = 'tree'
  ): React.ReactNode => {
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
    // A note can appear in several sections (Pinned, its folder) — the active
    // state shows in exactly one: Pinned wins for pinned notes, the folder
    // tree otherwise.
    const isActive =
      note.id === activeNoteId &&
      (section === 'pinned' || (section === 'tree' && !note.pinned))
    // Hovering a note during a drag targets the note's own folder; pinned and
    // linked entries opt out (their location isn't a valid drop target).
    const droppable = section === 'tree' && !note.external
    return (
    <li
      key={note.id}
      className={isActive ? 'note-item active' : 'note-item'}
      style={{ paddingLeft: 10 + depth * 14 }}
      draggable={!note.external}
      onDragStart={(e) => {
        if (!note.external) onDragStart(e, { type: 'note', path: note.path })
      }}
      onDragOver={(e) => {
        e.stopPropagation()
        if (!droppable) return
        e.preventDefault()
        setDragOver(note.folder)
      }}
      onDragLeave={() => {
        if (droppable) setDragOver((p) => (p === note.folder ? null : p))
      }}
      onDrop={(e) => {
        e.stopPropagation()
        if (droppable) dropInto(e, note.folder)
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
        {/* Folder-sourced notes have no link of their own; unlink via the
            folder's context menu instead. */}
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
      // Drag targeting lives on the whole <li> — hovering anywhere inside the
      // folder (its row, its notes, the gaps between them) highlights and
      // drops into this folder; stopPropagation keeps ancestors from
      // re-targeting the drag to themselves.
      <li
        key={node.path}
        className="folder-item"
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setDragOver(node.path)
        }}
        onDragLeave={() => setDragOver((p) => (p === node.path ? null : p))}
        onDrop={(e) => dropInto(e, node.path)}
      >
        <div
          className={rowClass}
          style={{ paddingLeft: 8 + depth * 14 }}
          draggable={!isEditingThis}
          onDragStart={(e) => onDragStart(e, { type: 'folder', path: node.path })}
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
          <span className={isOpen ? 'folder-chevron open' : 'folder-chevron'}>
            <ChevronRight size={13} />
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
        <Collapsible open={isOpen}>
          <ul className="tree-children">
            {node.folders.map((child) => renderFolder(child, depth + 1))}
            {editing?.mode === 'new-folder' && editing.parent === node.path &&
              renderNewFolderInput(depth + 1)}
            {node.notes.map((note) => renderNote(note, depth + 1))}
          </ul>
        </Collapsible>
      </li>
    )
  }

  const renderLinkedFolder = (group: (typeof linkedFolders)[number]): React.ReactNode => {
    const key = `linked:${group.path}`
    const isOpen = expanded.has(key)
    // The registered root behind this group (folder link, or the files' own
    // links when they were opened individually).
    const folderRoot = group.notes.find((n) => n.fromFolder && n.externalRoot)?.externalRoot
    return (
      // Linked folders live outside the notes dir — not a valid drop target,
      // and hovering one shouldn't highlight the root either.
      <li key={group.path} className="folder-item" onDragOver={(e) => e.stopPropagation()}>
        <div
          className="folder-row linked"
          title={group.path}
          onClick={() => toggle(key)}
          onContextMenu={(e) => {
            if (!folderRoot) return
            e.preventDefault()
            e.stopPropagation()
            setMenu({
              x: e.clientX,
              y: e.clientY,
              items: [
                {
                  label: 'Remove folder from Noteato',
                  onClick: () => onRemoveLinkedFolder(folderRoot)
                }
              ]
            })
          }}
        >
          <span className={isOpen ? 'folder-chevron open' : 'folder-chevron'}>
            <ChevronRight size={13} />
          </span>
          <span className="folder-name">{group.name}</span>
        </div>
        <Collapsible open={isOpen}>
          <ul className="tree-children">
            {group.notes.map((note) => renderNote(note, 1))}
          </ul>
        </Collapsible>
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

  const sectionHeader = (id: SectionId, label: string, extra?: React.ReactNode): React.ReactNode => (
    <div
      className="sidebar-section-header"
      role="button"
      tabIndex={0}
      onClick={() => toggleSection(id)}
    >
      <span className={sections[id] ? 'section-chevron open' : 'section-chevron'}>
        <ChevronRight size={12} />
      </span>
      <span className="section-title">{label}</span>
      {extra && (
        <span className="section-extra" onClick={(e) => e.stopPropagation()}>
          {extra}
        </span>
      )}
    </div>
  )


  return (
    <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
      <button className="sidebar-search" onClick={onSearch}>
        <Search size={14} />
        <span>Search notes</span>
        <kbd>{window.electron.process.platform === 'darwin' ? '⌘K' : 'Ctrl+K'}</kbd>
      </button>

      {/* Split button: the body creates a note in the selected folder, the
          caret opens the rarer create/link actions. */}
      <div className="sidebar-new-split" ref={newSplitRef}>
        <button
          className="sidebar-new-note"
          data-tip={selectedFolder ? `New note in ${selectedFolder}` : undefined}
          onClick={() => onCreateNote(selectedFolder ?? '')}
        >
          <Plus size={16} />
          <span>New note</span>
        </button>
        <button
          className="sidebar-new-more"
          aria-label="More create options"
          onClick={() => {
            const rect = newSplitRef.current?.getBoundingClientRect()
            setMenu({
              x: rect ? rect.left : 12,
              y: rect ? rect.bottom + 4 : 80,
              items: [
                { label: 'New folder', onClick: () => startNewFolder('') },
                { label: 'New sticky note', onClick: onCreateSticky },
                { label: 'Open folder…', onClick: onOpenFolder }
              ]
            })
          }}
        >
          <ChevronDown size={14} />
        </button>
      </div>

      {/* Entry points that aren't notes: they live together under Home rather
          than scattered across the title bar and the foot of the tree. */}
      <div className="sidebar-entries">
        <button className="sidebar-home-row" onClick={onOpenHome}>
          <Home size={15} />
          <span>Home</span>
        </button>
        {assistantAvailable && (
          <button
            className={assistantOpen ? 'sidebar-home-row active' : 'sidebar-home-row'}
            onClick={onOpenAssistant}
          >
            <Sparkles size={15} />
            <span>Assistant</span>
          </button>
        )}
        <button className="sidebar-home-row" onClick={onOpenSettings}>
          <Settings size={15} />
          <span>Settings</span>
        </button>
        <button className="sidebar-home-row" onClick={onOpenImport}>
          <Download size={15} />
          <span>Import</span>
        </button>
        <button className="sidebar-home-row" onClick={onOpenTrash}>
          <Trash2 size={15} />
          <span>Trash</span>
          {trashCount > 0 && <span className="sidebar-trash-count">{trashCount}</span>}
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
          <section className="sidebar-section">
            {sectionHeader('pinned', 'Pinned Notes')}
            <Collapsible open={sections.pinned}>
              <ul className="note-list">{pinned.map((note) => renderNote(note, 0, 'pinned'))}</ul>
            </Collapsible>
          </section>
        )}

        {tagCounts.length > 0 && (
          <section className="sidebar-section">
            {sectionHeader('tags', 'Tags')}
            <Collapsible open={sections.tags}>
              <ul className="note-list">
                {tagCounts.map((tag) => (
                  <li key={tag.key}>
                    <button
                      className={
                        activeTag === tag.key ? 'sidebar-row-btn tag-row active' : 'sidebar-row-btn tag-row'
                      }
                      onClick={() => setActiveTag((prev) => (prev === tag.key ? null : tag.key))}
                    >
                      <span className="sidebar-row-icon">
                        <Tag size={14} />
                      </span>
                      <span className="sidebar-row-label">{tag.label}</span>
                      <span className="tag-count">{tag.count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Collapsible>
          </section>
        )}

        <section className="sidebar-section">
          {sectionHeader('notes', activeTag ? 'Tagged Notes' : 'Your Notes')}
          <Collapsible open={sections.notes}>
            {activeTag ? (
              <>
                <button className="tag-filter-clear" onClick={() => setActiveTag(null)}>
                  <Tag size={12} />
                  <span>
                    {tagCounts.find((t) => t.key === activeTag)?.label ?? activeTag}
                  </span>
                  <X size={12} />
                </button>
                <ul className="note-list">{taggedNotes.map((note) => renderNote(note, 0))}</ul>
              </>
            ) : (
              <>
                {linkedFolders.length > 0 && (
                  <ul className="note-list">{linkedFolders.map(renderLinkedFolder)}</ul>
                )}
                <ul className="note-list tree-root">
                  {tree.folders.map((child) => renderFolder(child, 0))}
                  {editing?.mode === 'new-folder' &&
                    editing.parent === '' &&
                    renderNewFolderInput(0)}
                  {tree.notes.map((note) => renderNote(note, 0))}
                </ul>
              </>
            )}
          </Collapsible>
        </section>


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
