import { useEffect, useMemo, useState } from 'react'
import {
  IconBell as Bell,
  IconChevronDown as ChevronDown,
  IconDots as Dots,
  IconFileDescription as TemplateIcon,
  IconLink as Link,
  IconPlus as Plus,
  IconSearch as Search,
  IconStar as Star,
  IconStarFilled as StarFilled,
  IconTrash as Trash
} from '@tabler/icons-react'
import type { NoteSummary } from '../../../shared/types'
import type { NoteTemplate } from '../../../shared/noteTemplates'
import appPackage from '../../../../package.json'
import { REMINDER_PRESETS } from '../reminderPresets'
import ContextMenu, { type MenuItem } from './ContextMenu'
import ReminderPopover from './ReminderPopover'

const REVEAL_LABEL =
  window.electron.process.platform === 'darwin' ? 'Reveal in Finder' : 'Show in folder'

const MODIFIER_HINT = window.electron.process.platform === 'darwin' ? '⌘' : 'Ctrl'

/** Coarse and short — the row is a way back to a note, not a changelog. */
function relativeTime(iso: string): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''
  const minutes = Math.floor((Date.now() - then.getTime()) / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

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
  onOpenImport: () => void
  onSearch: () => void
  onCreateNote: () => void
  onCreateMeeting: () => void
  onCreateFromTemplate: (template: NoteTemplate, kind: 'note' | 'meeting') => Promise<void>
  onDeleteTemplate: (template: NoteTemplate) => void
  onOpenSettings: () => void
  onOpenStorageLocation: () => void
  onOpenHelp: () => void
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
  onOpenImport,
  onSearch,
  onCreateNote,
  onCreateMeeting,
  onCreateFromTemplate,
  onDeleteTemplate,
  onOpenSettings,
  onOpenStorageLocation,
  onOpenHelp
}: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [reminderPopover, setReminderPopover] = useState<{
    note: NoteSummary
    x: number
    y: number
  } | null>(null)
  const [renaming, setRenaming] = useState<{ note: NoteSummary; initial: string } | null>(null)
  const [editValue, setEditValue] = useState('')
  const [utilityMenu, setUtilityMenu] = useState<{ x: number; y: number } | null>(null)
  const [version, setVersion] = useState(appPackage.version)
  const [templates, setTemplates] = useState<NoteTemplate[]>([])
  const [creatingTemplateId, setCreatingTemplateId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.app.getVersion().then((value) => {
      if (!cancelled) setVersion(value)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      void window.api.templates.list().then((next) => {
        if (!cancelled) setTemplates(next)
      })
    }
    load()
    window.addEventListener('noteato:templates-changed', load)
    return () => {
      cancelled = true
      window.removeEventListener('noteato:templates-changed', load)
    }
  }, [])

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

  const createFromTemplate = (template: NoteTemplate, kind: 'note' | 'meeting'): void => {
    if (creatingTemplateId) return
    setCreatingTemplateId(template.id)
    void onCreateFromTemplate(template, kind).finally(() => setCreatingTemplateId(null))
  }

  const openTemplateMenu = (event: React.MouseEvent, template: NoteTemplate): void => {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    setMenu({
      x: rect.right - 190,
      y: rect.bottom + 5,
      items: [
        { label: 'Create note', onClick: () => createFromTemplate(template, 'note') },
        { label: 'Create meeting', onClick: () => createFromTemplate(template, 'meeting') },
        { separator: true, label: '' },
        {
          label: 'Delete',
          danger: true,
          onClick: () => onDeleteTemplate(template)
        }
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
            {note.reminderAt && <Bell size={11} className="note-reminder-icon" />}
            {note.external && <Link size={11} className="note-linked-icon" />}
            <span className="note-title-text">{note.title || 'Untitled'}</span>
          </div>
          <div className="note-item-meta">{relativeTime(note.updatedAt)}</div>
        </div>
        {/* Favourite is state, so it stays visible when set; everything else is
            an action and waits for hover or a right-click. */}
        <div className="note-item-actions">
          <button
            className={note.pinned ? 'row-icon-btn favourite on' : 'row-icon-btn favourite'}
            title={note.pinned ? 'Remove from favourites' : 'Add to favourites'}
            onClick={(e) => {
              e.stopPropagation()
              onTogglePin(note)
            }}
          >
            {note.pinned ? <StarFilled size={13} /> : <Star size={13} />}
          </button>
          <button
            className="row-icon-btn"
            title="More…"
            onClick={(e) => {
              e.stopPropagation()
              openNoteMenu(e, note)
            }}
          >
            <Dots size={14} />
          </button>
        </div>
      </li>
    )
  }

  return (
    <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
      {/* The two things the sidebar is for, named rather than drawn as glyphs
          you have to hover to identify — and carried by one control cut in two
          rather than two widgets sitting on the panel. */}
      <div className="sidebar-head">
        <div className="sidebar-omni">
          <button className="sidebar-search" onClick={onSearch}>
            <Search size={15} />
            <span>Search notes…</span>
            <kbd>{MODIFIER_HINT}K</kbd>
          </button>
          <button
            className="sidebar-new"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              setMenu({
                x: rect.right - 174,
                y: rect.bottom + 5,
                items: [
                  { label: 'New note', onClick: onCreateNote },
                  { label: 'New meeting', onClick: onCreateMeeting }
                ]
              })
            }}
            title="Create new"
          >
            <Plus size={15} />
            <span>New</span>
            <ChevronDown size={11} className="sidebar-new-chevron" />
          </button>
        </div>
      </div>

      <div className="sidebar-scroll">
        {templates.length > 0 && (
          <>
            <h2 className="sidebar-group-title">Templates</h2>
            <ul className="note-list sidebar-template-list">
              {templates.map((template) => (
                <li key={template.id} className="sidebar-template-item">
                  <div className="sidebar-template-copy">
                    <TemplateIcon size={13} />
                    <span>{template.name}</span>
                    {creatingTemplateId === template.id && <small>Creating…</small>}
                  </div>
                  <button
                    type="button"
                    className="row-icon-btn sidebar-template-menu"
                    title={`${template.name} actions`}
                    aria-label={`${template.name} actions`}
                    onClick={(event) => openTemplateMenu(event, template)}
                  >
                    <Dots size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
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
            {(pinned.length > 0 || templates.length > 0) && (
              <h2 className="sidebar-group-title">Notes</h2>
            )}
            <ul className="note-list">{rest.map(renderNote)}</ul>
          </>
        )}
      </div>

      {/* Utilities: reachable, but not competing with the library above them. */}
      <div className="sidebar-foot">
        {version && <span className="sidebar-version">v{version}</span>}
        <div className="sidebar-foot-actions">
          <button
            className="sidebar-foot-btn icon-only"
            title={`Trash${trashCount > 0 ? ` (${trashCount})` : ''}`}
            aria-label={`Trash${trashCount > 0 ? `, ${trashCount} items` : ''}`}
            onClick={onOpenTrash}
          >
            <Trash size={15} />
            {trashCount > 0 && <span className="sidebar-trash-dot" aria-hidden="true" />}
          </button>
          <button
            className="sidebar-foot-btn icon-only"
            title="More…"
            aria-label="More"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              setUtilityMenu({ x: rect.left, y: rect.top })
            }}
          >
            <Dots size={15} />
          </button>
        </div>
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
      {utilityMenu && (
        <ContextMenu
          x={utilityMenu.x}
          y={utilityMenu.y}
          items={[
            { label: 'Import…', onClick: onOpenImport },
            { separator: true, label: '' },
            { label: 'Storage location…', onClick: onOpenStorageLocation },
            { label: 'Settings…', onClick: onOpenSettings },
            { separator: true, label: '' },
            { label: 'Keyboard shortcuts', onClick: onOpenHelp }
          ]}
          onClose={() => setUtilityMenu(null)}
        />
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
