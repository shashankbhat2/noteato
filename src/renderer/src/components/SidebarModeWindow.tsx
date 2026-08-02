import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  IconBell as Bell,
  IconClock as Clock,
  IconMicrophone as Microphone,
  IconNotes as Notes,
  IconPin as Pin,
  IconPinned as Pinned,
  IconPlayerStopFilled as Stop,
  IconPlus as Plus,
  IconSearch as Search,
  IconSettings as SettingsIcon,
  IconX as X
} from '@tabler/icons-react'
import type { MeetingState, ScratchNote, SidebarModeState } from '../../../shared/types'
import ScratchEditor from './ScratchEditor'
import ScratchSearchModal from './ScratchSearchModal'
import SidebarSettingsPopover from './SidebarSettingsPopover'

type SidebarTab = 'notes' | 'reminders'

const TAB_STORAGE_KEY = 'noteato:sidebarModeTab'
const ACTIVE_NOTE_STORAGE_KEY = 'noteato:sidebarModeActiveNote'
const OPEN_TABS_STORAGE_KEY = 'noteato:sidebarModeOpenTabs'

function readOpenIds(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(OPEN_TABS_STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

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

export default function SidebarModeWindow() {
  const [tab, setTab] = useState<SidebarTab>(readInitialTab)
  const [notes, setNotes] = useState<ScratchNote[]>([])
  const [activeId, setActiveId] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_NOTE_STORAGE_KEY) || null
  )
  const activeIdRef = useRef(activeId)
  const [openIds, setOpenIds] = useState<string[]>(readOpenIds)
  const [editorRevision, setEditorRevision] = useState(0)
  const [windowState, setWindowState] = useState<SidebarModeState>({
    enabled: true,
    pinned: true,
    visible: true
  })
  const [loading, setLoading] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [meeting, setMeeting] = useState<MeetingState>({ phase: 'idle', startedAt: null })

  useEffect(() => {
    void window.api.meeting.getState().then(setMeeting)
    return window.api.meeting.subscribeState(setMeeting)
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    const list = await window.api.scratch.list()
    setNotes(list)
    setLoading(false)
  }, [])

  const openNote = useCallback((id: string): void => {
    setActiveId(id)
    activeIdRef.current = id
    localStorage.setItem(ACTIVE_NOTE_STORAGE_KEY, id)
    // Opening a note it doesn't have a tab for adds one at the end, the way a
    // browser does — closing a tab is not the same as deleting the note, so
    // the strip is a working set rather than the whole library.
    setOpenIds((current) => (current.includes(id) ? current : [...current, id]))
  }, [])

  /** Take a note off the strip. The note itself is untouched. */
  const closeTab = (id: string): void => {
    setOpenIds((current) => {
      const next = current.filter((openId) => openId !== id)
      if (activeIdRef.current === id) {
        const at = current.indexOf(id)
        const heir = next[Math.min(at, next.length - 1)] ?? null
        activeIdRef.current = heir
        setActiveId(heir)
        if (heir) localStorage.setItem(ACTIVE_NOTE_STORAGE_KEY, heir)
        else localStorage.removeItem(ACTIVE_NOTE_STORAGE_KEY)
      }
      return next
    })
  }

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

  // In the order they were opened, dropping any whose note has since gone.
  const tabNotes = useMemo(
    () =>
      openIds
        .map((id) => notes.find((note) => note.id === id))
        .filter((note): note is ScratchNote => note !== undefined),
    [openIds, notes]
  )
  const reminders = useMemo(
    () =>
      notes
        .filter((note) => note.reminderAt)
        .sort((a, b) => a.reminderAt!.localeCompare(b.reminderAt!)),
    [notes]
  )
  const activeNote = activeId ? notes.find((note) => note.id === activeId) ?? null : null

  useEffect(() => {
    localStorage.setItem(OPEN_TABS_STORAGE_KEY, JSON.stringify(openIds))
  }, [openIds])

  // Drop tabs whose note was deleted elsewhere (the main window, a reminder),
  // and seed the strip with the most recent note on a first run so the panel
  // opens on something to write in rather than an empty frame.
  useEffect(() => {
    if (loading) return
    setOpenIds((current) => {
      const live = current.filter((id) => notes.some((note) => note.id === id))
      if (live.length > 0) return live.length === current.length ? current : live
      return notes.length > 0 ? [notes[0].id] : current
    })
  }, [loading, notes])

  // The active note always has a tab; land on one when the selection is gone.
  useEffect(() => {
    if (loading || tab !== 'notes' || tabNotes.length === 0) return
    if (activeId && tabNotes.some((note) => note.id === activeId)) return
    openNote(tabNotes[0].id)
  }, [loading, tab, tabNotes, activeId, openNote])

  const chooseTab = (next: SidebarTab): void => {
    setTab(next)
    localStorage.setItem(TAB_STORAGE_KEY, next)
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
    // Take the tab first, so the effects that reconcile the strip and the
    // selection see a note that is already gone rather than racing the list.
    closeTab(id)
    setNotes((current) => current.filter((note) => note.id !== id))
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
        <nav className="sidebar-mode-tabs" aria-label="Sidebar views">
          <button
            className={tab === 'notes' ? 'active' : undefined}
            onClick={() => chooseTab('notes')}
          >
            Notes
          </button>
          <button
            className={tab === 'reminders' ? 'active' : undefined}
            onClick={() => chooseTab('reminders')}
          >
            Reminders
            {reminders.length > 0 && (
              <span className="sidebar-tab-count">{reminders.length}</span>
            )}
          </button>
        </nav>
        <div className="sidebar-mode-window-actions">
          {/* This panel is built to be used while another app has focus, which
              is exactly when a meeting starts — so recording belongs here. */}
          <button
            className={meeting.phase === 'recording' ? 'recording' : undefined}
            onClick={() => void window.api.meeting.toggle()}
            disabled={meeting.phase === 'transcribing'}
            aria-pressed={meeting.phase === 'recording'}
            title={meeting.phase === 'recording' ? 'End meeting' : 'Record meeting'}
          >
            {meeting.phase === 'recording' ? <Stop size={13} /> : <Microphone size={14} />}
          </button>
          {/* Search opens the same find-a-note modal the main window uses,
              rather than sitting in the header taking width from the tabs. */}
          <button onClick={() => setSearchOpen(true)} title="Search notes">
            <Search size={14} />
          </button>
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

      {tab === 'notes' ? (
        <>
          {/* The note list and the open note are one screen: every note is a
              tab, and the strip scrolls sideways rather than wrapping, so
              adding the tenth note never costs the editor any height. */}
          <div className="sidebar-mode-tabstrip">
            <div className="sidebar-tabs-scroll">
              {tabNotes.map((note) => (
                <div
                  key={note.id}
                  className={note.id === activeId ? 'sidebar-note-tab active' : 'sidebar-note-tab'}
                  role="button"
                  tabIndex={0}
                  title={note.title || 'Untitled'}
                  onClick={() => openNote(note.id)}
                >
                  {note.pinned && <Pinned size={10} className="sidebar-note-tab-pin" />}
                  {note.reminderAt && <Bell size={10} className="sidebar-note-tab-bell" />}
                  <span>{note.title || 'Untitled'}</span>
                  <button
                    className="sidebar-note-tab-close"
                    title="Close tab"
                    onClick={(event) => {
                      event.stopPropagation()
                      closeTab(note.id)
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
            <button className="sidebar-tab-new" onClick={() => void createNote()} title="New note">
              <Plus size={15} />
            </button>
          </div>

          {loading ? (
            <div className="sidebar-mode-loading">Gathering your notes…</div>
          ) : activeNote ? (
            <ScratchEditor
              key={`${activeNote.id}:${editorRevision}`}
              note={activeNote}
              onSaved={handleSaved}
              onDelete={() => void deleteNote(activeNote.id)}
            />
          ) : (
            <div className="sidebar-mode-empty">
              <Notes size={20} />
              <strong>{notes.length > 0 ? 'Nothing open' : 'A quiet place for a quick thought'}</strong>
              <span>
                {notes.length > 0
                  ? 'Search to reopen a note, or start a new one.'
                  : 'Create a note without leaving what you are doing.'}
              </span>
              <button onClick={() => void createNote()}>New note</button>
            </div>
          )}
        </>
      ) : (
        <>
          <main className="sidebar-mode-content">
            {reminders.length === 0 ? (
              <div className="sidebar-mode-empty">
                <Bell size={20} />
                <strong>Nothing waiting on you</strong>
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
                      onClick={() => {
                        chooseTab('notes')
                        openNote(note.id)
                      }}
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

      {searchOpen && (
        <ScratchSearchModal
          notes={notes}
          onPick={(id) => {
            chooseTab('notes')
            openNote(id)
          }}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </div>
  )
}
