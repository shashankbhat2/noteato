import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  IconBell as Bell,
  IconChevronLeft as ChevronLeft,
  IconClock as Clock,
  IconFileText as FileText,
  IconFolder as Folder,
  IconNotes as Notes,
  IconPin as Pin,
  IconPinned as Pinned,
  IconPlus as Plus,
  IconSearch as Search,
  IconSettings as SettingsIcon,
  IconX as X
} from '@tabler/icons-react'
import type { Note, NoteSummary, SidebarModeState } from '../../../shared/types'
import noteatoIcon from '../../../../build/icon.png'
import SidebarModeEditor from './SidebarModeEditor'
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

function noteMatches(note: NoteSummary, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return `${note.title} ${note.folder} ${note.excerpt}`.toLowerCase().includes(needle)
}

function NoteRow({ note, onOpen }: { note: NoteSummary; onOpen: () => void }) {
  return (
    <button className="sidebar-note-row" onClick={onOpen}>
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
    </button>
  )
}

export default function SidebarModeWindow() {
  const [tab, setTab] = useState<SidebarTab>(readInitialTab)
  const [notes, setNotes] = useState<NoteSummary[]>([])
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
    const list = await window.api.notes.list()
    setNotes(list)
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
    void window.api.sidebar.getState().then(setWindowState)
    const unsubscribeState = window.api.sidebar.subscribeState(setWindowState)
    const unsubscribeReminder = window.api.reminders.subscribeFired((fired) => {
      setNotes((current) =>
        current.map((note) => (note.id === fired.id ? { ...note, reminderAt: null } : note))
      )
    })
    const unsubscribeNotes = window.api.notes.subscribeChanged((change) => {
      if (change.kind === 'refresh') {
        void refresh()
        return
      }
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
    const refreshOnFocus = (): void => void refresh()
    window.addEventListener('focus', refreshOnFocus)
    return () => {
      unsubscribeState()
      unsubscribeReminder()
      unsubscribeNotes()
      window.removeEventListener('focus', refreshOnFocus)
    }
  }, [refresh])

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

  const groupedNotes = useMemo(() => {
    const groups = new Map<string, NoteSummary[]>()
    for (const note of unpinnedNotes) {
      const label = note.folder || 'Loose notes'
      const group = groups.get(label) ?? []
      group.push(note)
      groups.set(label, group)
    }
    return [...groups.entries()].sort(([a], [b]) => {
      if (a === 'Loose notes') return -1
      if (b === 'Loose notes') return 1
      return a.localeCompare(b)
    })
  }, [unpinnedNotes])

  const chooseTab = (next: SidebarTab): void => {
    setTab(next)
    setQuery('')
    setActiveId(null)
    activeIdRef.current = null
    localStorage.setItem(TAB_STORAGE_KEY, next)
    localStorage.removeItem(ACTIVE_NOTE_STORAGE_KEY)
  }

  const openNote = (id: string): void => {
    setActiveId(id)
    activeIdRef.current = id
    localStorage.setItem(ACTIVE_NOTE_STORAGE_KEY, id)
  }

  const closeEditor = (): void => {
    setActiveId(null)
    activeIdRef.current = null
    localStorage.removeItem(ACTIVE_NOTE_STORAGE_KEY)
  }

  const createNote = async (): Promise<void> => {
    const created = await window.api.notes.create('Untitled')
    setNotes((current) => [created, ...current])
    setTab('notes')
    localStorage.setItem(TAB_STORAGE_KEY, 'notes')
    openNote(created.id)
  }

  const handleSaved = useCallback((saved: Note): void => {
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
            title={windowState.pinned ? 'Unpin sidebar' : 'Pin above other apps'}
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
          <SidebarModeEditor
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
                        <span>Pinned</span>
                        <Pinned size={11} />
                      </div>
                      {pinnedNotes.map((note) => (
                        <NoteRow key={note.id} note={note} onOpen={() => openNote(note.id)} />
                      ))}
                    </section>
                  )}
                  {groupedNotes.map(([folder, group]) => (
                    <section className="sidebar-mode-section" key={folder}>
                      <div className="sidebar-section-label">
                        <span>{folder}</span>
                        <Folder size={11} />
                      </div>
                      {group.map((note) => (
                        <NoteRow key={note.id} note={note} onOpen={() => openNote(note.id)} />
                      ))}
                    </section>
                  ))}
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
