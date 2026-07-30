import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  IconBell as Bell,
  IconChevronLeft as ChevronLeft,
  IconClock as Clock,
  IconFileText as FileText,
  IconNotes as Notes,
  IconPin as Pin,
  IconPinned as Pinned,
  IconPlus as Plus,
  IconSearch as Search,
  IconSettings as SettingsIcon,
  IconTrash as Trash,
  IconX as X
} from '@tabler/icons-react'
import type { ScratchNote, SidebarModeState } from '../../../shared/types'
import noteatoIcon from '../../../../build/icon.png'
import ScratchEditor from './ScratchEditor'
import SidebarSettingsPopover from './SidebarSettingsPopover'

type SidebarTab = 'notes' | 'reminders'

const TAB_STORAGE_KEY = 'noteato:sidebarModeTab'
const ACTIVE_NOTE_STORAGE_KEY = 'noteato:sidebarModeActiveNote'

function readInitialTab(): SidebarTab {
  return localStorage.getItem(TAB_STORAGE_KEY) === 'reminders' ? 'reminders' : 'notes'
}

function formatReminderTime(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  const sameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (sameDay(date, now)) return `Today, ${time}`
  if (sameDay(date, tomorrow)) return `Tomorrow, ${time}`
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function noteMatches(note: ScratchNote, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return `${note.title} ${note.excerpt}`.toLowerCase().includes(needle)
}

function NoteRow({
  note,
  onOpen,
  onDelete
}: {
  note: ScratchNote
  onOpen: () => void
  onDelete: () => void
}) {
  return (
    <div className="sidebar-note-row" role="button" tabIndex={0} onClick={onOpen}>
      <span className="sidebar-note-glyph">
        <FileText size={14} />
      </span>
      <span className="sidebar-note-copy">
        <span className="sidebar-note-title">{note.title || 'Untitled'}</span>
        <span className="sidebar-note-excerpt">{note.excerpt || 'Empty note'}</span>
      </span>
      {note.reminderAt && (
        <span className="sidebar-note-reminder" title={formatReminderTime(note.reminderAt)}>
          <Bell size={11} />
        </span>
      )}
      <button
        className="sidebar-note-delete"
        title="Delete note"
        onClick={(event) => {
          event.stopPropagation()
          onDelete()
        }}
      >
        <Trash size={12} />
      </button>
    </div>
  )
}

export default function SidebarModeWindow() {
  const [tab, setTab] = useState<SidebarTab>(readInitialTab)
  const [notes, setNotes] = useState<ScratchNote[]>([])
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_NOTE_STORAGE_KEY) || null
  )
  const activeIdRef = useRef(activeId)
  const [editorRevision, setEditorRevision] = useState(0)
  const [windowState, setWindowState] = useState<SidebarModeState>({
    enabled: true,
    pinned: true,
    visible: true
  })
  const [loading, setLoading] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    const list = await window.api.scratch.list()
    setNotes(list)
    setLoading(false)
  }, [])

  const openNote = useCallback((id: string): void => {
    setActiveId(id)
    activeIdRef.current = id
    localStorage.setItem(ACTIVE_NOTE_STORAGE_KEY, id)
  }, [])

  useEffect(() => {
    void refresh()
    void window.api.sidebar.getState().then(setWindowState)
    const unsubscribeState = window.api.sidebar.subscribeState(setWindowState)
    const unsubscribeNotes = window.api.scratch.subscribeChanged((change) => {
      if (change.kind === 'remove') {
        setNotes((current) => current.filter((note) => note.id !== change.id))
        if (activeIdRef.current === change.id) {
          activeIdRef.current = null
          setActiveId(null)
          localStorage.removeItem(ACTIVE_NOTE_STORAGE_KEY)
        }
        return
      }
      setNotes((current) => {
        const next = current.filter((note) => note.id !== change.note.id)
        next.unshift(change.note)
        return next
      })
      if (activeIdRef.current === change.note.id) {
        setEditorRevision((revision) => revision + 1)
      }
    })
    // A scratch-note reminder notification was clicked — land on that note.
    const unsubscribeOpen = window.api.scratch.subscribeOpen((id) => {
      setTab('notes')
      localStorage.setItem(TAB_STORAGE_KEY, 'notes')
      openNote(id)
    })
    const refreshOnFocus = (): void => void refresh()
    window.addEventListener('focus', refreshOnFocus)
    return () => {
      unsubscribeState()
      unsubscribeNotes()
      unsubscribeOpen()
      window.removeEventListener('focus', refreshOnFocus)
    }
  }, [refresh, openNote])

  const filteredNotes = useMemo(
    () => notes.filter((note) => noteMatches(note, query)),
    [notes, query]
  )
  const pinnedNotes = filteredNotes.filter((note) => note.pinned)
  const unpinnedNotes = filteredNotes.filter((note) => !note.pinned)
  const reminders = filteredNotes
    .filter((note) => note.reminderAt)
    .sort((a, b) => a.reminderAt!.localeCompare(b.reminderAt!))
  const activeNote = activeId ? notes.find((note) => note.id === activeId) ?? null : null

  const chooseTab = (next: SidebarTab): void => {
    setTab(next)
    setQuery('')
    setActiveId(null)
    activeIdRef.current = null
    localStorage.setItem(TAB_STORAGE_KEY, next)
    localStorage.removeItem(ACTIVE_NOTE_STORAGE_KEY)
  }

  const closeEditor = (): void => {
    setActiveId(null)
    activeIdRef.current = null
    localStorage.removeItem(ACTIVE_NOTE_STORAGE_KEY)
  }

  const createNote = async (): Promise<void> => {
    const created = await window.api.scratch.create()
    setNotes((current) => [created, ...current])
    setTab('notes')
    localStorage.setItem(TAB_STORAGE_KEY, 'notes')
    openNote(created.id)
  }

  const deleteNote = async (id: string): Promise<void> => {
    await window.api.scratch.delete(id)
    setNotes((current) => current.filter((note) => note.id !== id))
    if (activeIdRef.current === id) closeEditor()
  }

  const handleSaved = useCallback((saved: ScratchNote): void => {
    setNotes((current) => {
      const next = current.filter((note) => note.id !== saved.id)
      next.unshift(saved)
      return next
    })
  }, [])

  const togglePinned = async (): Promise<void> => {
    const next = await window.api.sidebar.setPinned(!windowState.pinned)
    setWindowState(next)
  }

  return (
    <div className="sidebar-mode-shell">
      <header className="sidebar-mode-titlebar">
        <div className="sidebar-mode-brand" aria-label="Noteato">
          <img src={noteatoIcon} alt="" className="compact-noteato-icon" />
        </div>
        <nav className="sidebar-mode-tabs" aria-label="Sidebar views">
          <button className={tab === 'notes' ? 'active' : undefined} onClick={() => chooseTab('notes')}>
            Notes
          </button>
          <button
            className={tab === 'reminders' ? 'active' : undefined}
            onClick={() => chooseTab('reminders')}
          >
            Reminders
            {notes.some((note) => note.reminderAt) && (
              <span className="sidebar-tab-count">
                {notes.filter((note) => note.reminderAt).length}
              </span>
            )}
          </button>
        </nav>
        <div className="sidebar-mode-window-actions">
          <button
            className={settingsOpen ? 'active' : undefined}
            onClick={() => setSettingsOpen((open) => !open)}
            title="Sidebar settings"
          >
            <SettingsIcon size={14} />
          </button>
          <button
            className={windowState.pinned ? 'active' : undefined}
            onClick={() => void togglePinned()}
            title={
              windowState.pinned ? 'Stop following across Spaces' : 'Show on every Space'
            }
          >
            {windowState.pinned ? <Pinned size={14} /> : <Pin size={14} />}
          </button>
          <button onClick={() => void window.api.sidebar.close()} title="Close sidebar">
            <X size={15} />
          </button>
        </div>
        {settingsOpen && <SidebarSettingsPopover onClose={() => setSettingsOpen(false)} />}
      </header>

      {activeNote ? (
        <>
          <div className="sidebar-mode-contextbar">
            <button className="sidebar-context-back" onClick={closeEditor}>
              <ChevronLeft size={15} />
              <span>{tab === 'reminders' ? 'Reminders' : 'Notes'}</span>
            </button>
            {activeNote.reminderAt && (
              <span className="sidebar-context-reminder">
                <Clock size={12} />
                {formatReminderTime(activeNote.reminderAt)}
              </span>
            )}
          </div>
          <ScratchEditor
            key={`${activeNote.id}:${editorRevision}`}
            note={activeNote}
            onSaved={handleSaved}
          />
        </>
      ) : (
        <>
          <div className="sidebar-mode-searchbar">
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tab === 'notes' ? 'Search notes' : 'Search reminders'}
              aria-label={tab === 'notes' ? 'Search notes' : 'Search reminders'}
            />
            <button onClick={() => void createNote()} title="New note">
              <Plus size={15} />
            </button>
          </div>

          <main className="sidebar-mode-content">
            {loading ? (
              <div className="sidebar-mode-loading">Gathering your notes…</div>
            ) : tab === 'notes' ? (
              filteredNotes.length === 0 ? (
                <div className="sidebar-mode-empty">
                  <Notes size={20} />
                  <strong>{query ? 'No matching notes' : 'A quiet place for a quick thought'}</strong>
                  <span>{query ? 'Try a different search.' : 'Create a note without leaving what you are doing.'}</span>
                  {!query && <button onClick={() => void createNote()}>New note</button>}
                </div>
              ) : (
                <div className="sidebar-mode-list">
                  {pinnedNotes.length > 0 && (
                    <section className="sidebar-mode-section">
                      <div className="sidebar-section-label">
                        <span>Favourites</span>
                        <Pinned size={11} />
                      </div>
                      {pinnedNotes.map((note) => (
                        <NoteRow
                          key={note.id}
                          note={note}
                          onOpen={() => openNote(note.id)}
                          onDelete={() => void deleteNote(note.id)}
                        />
                      ))}
                    </section>
                  )}
                  {unpinnedNotes.length > 0 && (
                    <section className="sidebar-mode-section">
                      <div className="sidebar-section-label">
                        <span>Notes</span>
                        <Notes size={11} />
                      </div>
                      {unpinnedNotes.map((note) => (
                        <NoteRow
                          key={note.id}
                          note={note}
                          onOpen={() => openNote(note.id)}
                          onDelete={() => void deleteNote(note.id)}
                        />
                      ))}
                    </section>
                  )}
                </div>
              )
            ) : reminders.length === 0 ? (
              <div className="sidebar-mode-empty">
                <Bell size={20} />
                <strong>{query ? 'No matching reminders' : 'Nothing waiting on you'}</strong>
                <span>Reminders attached to your notes will gather here.</span>
              </div>
            ) : (
              <div className="sidebar-mode-list sidebar-reminder-list">
                <section className="sidebar-mode-section">
                  <div className="sidebar-section-label">
                    <span>Upcoming</span>
                    <span>{reminders.length}</span>
                  </div>
                  {reminders.map((note) => (
                    <button
                      className="sidebar-reminder-row"
                      key={note.id}
                      onClick={() => openNote(note.id)}
                    >
                      <span className="sidebar-reminder-rail" />
                      <span className="sidebar-note-copy">
                        <span className="sidebar-note-title">{note.title || 'Untitled'}</span>
                        <span className="sidebar-reminder-time">
                          <Clock size={11} />
                          {formatReminderTime(note.reminderAt!)}
                        </span>
                        {note.excerpt && <span className="sidebar-note-excerpt">{note.excerpt}</span>}
                      </span>
                    </button>
                  ))}
                </section>
              </div>
            )}
          </main>
        </>
      )}
    </div>
  )
}
