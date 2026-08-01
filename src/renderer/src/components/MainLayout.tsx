import { Fragment, useEffect, useRef, useState } from 'react'
import type { DeletedEntry, Note, NoteSummary, TrashEntry } from '../../../shared/types'
import {
  MAX_PANES,
  PANE_MIN_PX,
  makePane,
  sameView,
  type Pane,
  type PaneView
} from '../panes'
import ShortcutsHelp from './ShortcutsHelp'
import { linkifyBlocks } from '../linkify'
import { OPEN_NOTE_LINK_EVENT, type NoteatoEditor } from '../noteLink'
import Sidebar from './Sidebar'
import TitleBar from './TitleBar'
import PaneControls from './PaneControls'
import TrashView from './TrashView'
import HomeView from './HomeView'
import NoteEditor from './NoteEditor'
import SettingsModal from './SettingsModal'
import ConfirmDialog from './ConfirmDialog'
import SearchModal from './SearchModal'
import ImportNotionModal from './ImportNotionModal'
import ImportModal from './ImportModal'

const UNDO_TOAST_MS = 7000
const SIDEBAR_COLLAPSED_KEY = 'noteato:sidebarCollapsed'
const OPEN_PANES_KEY = 'noteato:panes'
const RECENT_NOTES_KEY = 'noteato:recentNotes'
const RECENT_NOTES_MAX = 8

// Last session's panes, stored by note id — paths can go stale between
// sessions, so they're re-resolved against the current note list on restore.
interface StoredPane {
  view: PaneView
  pinned?: boolean
}

interface StoredPanes {
  panes: StoredPane[]
  focusedIndex: number
}

function readStoredPanes(): StoredPanes | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(OPEN_PANES_KEY) ?? 'null')
    if (!parsed || !Array.isArray(parsed.panes)) return null
    const panes = parsed.panes.filter(
      (entry: unknown): entry is StoredPane =>
        typeof entry === 'object' &&
        entry !== null &&
        ['note', 'home', 'trash'].includes((entry as StoredPane).view?.kind)
    )
    return {
      panes,
      focusedIndex: typeof parsed.focusedIndex === 'number' ? parsed.focusedIndex : 0
    }
  } catch {
    return null
  }
}

type ConfirmState =
  | { kind: 'note'; note: NoteSummary }
  | { kind: 'purge'; entry: TrashEntry }
  | { kind: 'empty-trash' }
  | null

interface OpenTarget {
  id: string
  path: string
  title: string
}

const noteView = (note: OpenTarget): PaneView => ({
  kind: 'note',
  id: note.id,
  path: note.path,
  title: note.title
})

export default function MainLayout() {
  const [notes, setNotes] = useState<NoteSummary[]>([])
  const [trash, setTrash] = useState<TrashEntry[]>([])
  // The working area, left to right. Always at least one pane: closing the
  // last one falls back to Home rather than leaving an empty shell.
  const [panes, setPanes] = useState<Pane[]>(() => [makePane({ kind: 'home' })])
  const [focusedKey, setFocusedKey] = useState<string>('')
  const [paneRatios, setPaneRatios] = useState<number[]>([1])
  const [dropSide, setDropSide] = useState<'left' | 'right' | null>(null)
  /** Id of the note pane focused most recently — feeds Home's Recent cards. */
  const [lastNoteId, setLastNoteId] = useState<string | null>(null)
  const [draggingNote, setDraggingNote] = useState<NoteSummary | null>(null)
  const [recentIds, setRecentIds] = useState<string[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(RECENT_NOTES_KEY) ?? '[]')
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmState>(null)
  const [undoState, setUndoState] = useState<(DeletedEntry & { label: string }) | null>(null)
  const [notionImportStatus, setNotionImportStatus] = useState<string | null>(null)
  const [notionGuideOpen, setNotionGuideOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
  )
  const editorAreaRef = useRef<HTMLDivElement>(null)

  const focusedIndex = Math.max(
    0,
    panes.findIndex((pane) => pane.key === focusedKey)
  )
  const focusedPane = panes[focusedIndex]
  const ratios =
    paneRatios.length === panes.length ? paneRatios : Array<number>(panes.length).fill(1 / panes.length)

  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const notionStatusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Active BlockNote editors keyed by note id, so menu Undo/Redo can reach the
  // focused note's own history.
  const editorsRef = useRef(new Map<string, NoteatoEditor>())

  const registerEditor = (id: string, editor: NoteatoEditor | null): void => {
    if (editor) editorsRef.current.set(id, editor)
    else editorsRef.current.delete(id)
  }



  const toggleSidebar = (): void => {
    setSidebarCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next))
      return next
    })
  }

  // --- Panes ---------------------------------------------------------------

  /** Reset the widths whenever the pane count changed; otherwise keep them. */
  const commitPanes = (next: Pane[]): void => {
    setPanes(next)
    setPaneRatios((prev) =>
      prev.length === next.length ? prev : Array<number>(next.length).fill(1 / next.length)
    )
  }

  /**
   * Show `view` in the focused pane — unless another pane is already showing
   * it, in which case that pane is focused instead. Mounting one note twice
   * would give it two live editors racing each other's saves.
   *
   * A pinned pane never gives up its note: the nearest unpinned pane takes the
   * view instead, and if every pane is pinned a new one opens beside them.
   */
  const openInFocused = (view: PaneView): void => {
    const existing = panes.find((pane) => sameView(pane.view, view))
    if (existing) {
      setFocusedKey(existing.key)
      return
    }
    const focused = panes[focusedIndex]
    const target = focused?.pinned ? panes.find((pane) => !pane.pinned) : focused
    if (!target) {
      openInNewPane(view)
      return
    }
    setPanes((prev) => prev.map((pane) => (pane.key === target.key ? { ...pane, view } : pane)))
    setFocusedKey(target.key)
  }

  /** Hold this pane's note in place, or release it. */
  const togglePanePin = (key: string): void => {
    setPanes((prev) =>
      prev.map((pane) => (pane.key === key ? { ...pane, pinned: !pane.pinned } : pane))
    )
  }

  /**
   * Open `view` in a pane of its own, just right of the focused one. At the
   * cap the last pane gives way, so the new pane always appears where the
   * user was looking.
   */
  const openInNewPane = (view: PaneView): void => {
    const existing = panes.find((pane) => sameView(pane.view, view))
    if (existing) {
      setFocusedKey(existing.key)
      return
    }
    const pane = makePane(view)
    const next = [...panes]
    next.splice(focusedIndex + 1, 0, pane)
    if (next.length > MAX_PANES) {
      // Something has to give at the cap, and it must never be a pinned pane —
      // pinning is a promise that nothing replaces what's there. The last
      // unpinned pane goes; if they're all pinned, the new pane doesn't open.
      const evict = next.map((p, i) => ({ p, i })).filter(({ p }) => !p.pinned && p !== pane).pop()
      if (!evict) return
      next.splice(evict.i, 1)
    }
    commitPanes(next)
    setFocusedKey(pane.key)
  }

  const closePane = (key: string): void => {
    const index = panes.findIndex((pane) => pane.key === key)
    if (index === -1) return
    if (panes.length === 1) {
      // Nothing left to fall back to — Home takes the pane over.
      const home = makePane({ kind: 'home' })
      commitPanes([home])
      setFocusedKey(home.key)
      return
    }
    const next = panes.filter((pane) => pane.key !== key)
    commitPanes(next)
    if (key === focusedKey) {
      setFocusedKey(next[Math.min(index, next.length - 1)].key)
    }
  }

  /** Slide one pane along the row, carrying its width with it. */
  const movePane = (from: number, to: number): void => {
    if (to < 0 || to >= panes.length || from === to) return
    const next = [...panes]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setPanes(next)
    setPaneRatios((prev) => {
      if (prev.length !== panes.length) return prev
      const widths = [...prev]
      const [w] = widths.splice(from, 1)
      widths.splice(to, 0, w)
      return widths
    })
  }

  /** Close every pane showing `noteId` — used when its note goes away. */
  const closeNotePanes = (noteId: string): void => {
    const doomed = panes.filter((pane) => pane.view.kind === 'note' && pane.view.id === noteId)
    for (const pane of doomed) closePane(pane.key)
  }

  /**
   * Drag the seam between panes `index` and `index + 1`. Only that pair
   * changes width — the panes beyond the seam stay exactly where they are,
   * which is what makes repeated adjustments predictable.
   */
  const startPaneResize = (e: React.PointerEvent, index: number): void => {
    e.preventDefault()
    const area = editorAreaRef.current
    if (!area) return
    const widths = [...area.querySelectorAll('.editor-pane')].map(
      (pane) => pane.getBoundingClientRect().width
    )
    const total = widths.reduce((sum, w) => sum + w, 0)
    if (total === 0 || index + 1 >= widths.length) return
    const startX = e.clientX
    const pair = widths[index] + widths[index + 1]

    const move = (ev: PointerEvent): void => {
      const delta = ev.clientX - startX
      const first = Math.min(pair - PANE_MIN_PX, Math.max(PANE_MIN_PX, widths[index] + delta))
      const next = widths.map((w) => w / total)
      next[index] = first / total
      next[index + 1] = (pair - first) / total
      setPaneRatios(next)
    }
    const stop = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      document.body.classList.remove('resizing-panes')
    }
    document.body.classList.add('resizing-panes')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--sidebar-w',
      sidebarCollapsed ? '0px' : 'var(--sidebar-expanded-w)'
    )
  }, [sidebarCollapsed])

  // Reload notes + trash. Reconciles open panes' titles and paths by id.
  const refresh = async (): Promise<NoteSummary[]> => {
    const [list, trashList] = await Promise.all([
      window.api.notes.list(),
      window.api.notes.listTrash()
    ])
    setNotes(list)
    setTrash(trashList)
    repointPanes(list)
    return list
  }

  /**
   * Re-point open note panes after a rename changed their path or title. Notes
   * missing from `list` are left alone: this is also called with a single
   * changed note, where everything else being absent means nothing.
   */
  const repointPanes = (list: NoteSummary[]): void => {
    setPanes((prev) =>
      prev.map((pane) => {
        const view = pane.view
        if (view.kind !== 'note') return pane
        const found = list.find((note) => note.id === view.id)
        if (!found || (found.path === view.path && found.title === view.title)) return pane
        return { ...pane, view: { ...view, path: found.path, title: found.title } }
      })
    )
  }

  useEffect(() => {
    refresh().then((list) => {
      // Reopen last session's panes, dropping notes that no longer exist.
      const stored = readStoredPanes()
      const restored = (stored?.panes ?? [])
        .map((entry) => {
          if (entry.view.kind !== 'note') return entry
          const found = list.find((note) => note.id === (entry.view as { id: string }).id)
          return found ? { ...entry, view: noteView(found) } : null
        })
        .filter((entry): entry is StoredPane => entry !== null)
        .slice(0, MAX_PANES)
        .map((entry) => ({ ...makePane(entry.view), pinned: entry.pinned }))
      const next = restored.length > 0 ? restored : [makePane({ kind: 'home' })]
      commitPanes(next)
      const at = stored?.focusedIndex ?? 0
      setFocusedKey(next[Math.min(Math.max(at, 0), next.length - 1)].key)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sidebar mode writes through the same Markdown store in another renderer.
  // Refresh summaries whenever the main window regains focus so notes created,
  // renamed, or reminded there appear without restarting Noteato. This stays
  // off the autosave hot path and therefore scales with the existing file store.
  useEffect(() => {
    const refreshOnFocus = (): void => void refresh()
    window.addEventListener('focus', refreshOnFocus)
    return () => window.removeEventListener('focus', refreshOnFocus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Apply targeted changes from the compact renderer. Panes are repointed to
  // the changed path, which makes them reload the shared Markdown before the
  // main window is used again; changes originating here keep the focused
  // editor mounted and preserve its caret/history.
  useEffect(() => {
    return window.api.notes.subscribeChanged((change) => {
      if (change.kind === 'refresh') {
        void refresh()
        return
      }
      if (change.kind === 'remove') {
        setNotes((current) => current.filter((note) => note.id !== change.id))
        closeNotePanes(change.id)
        return
      }
      setNotes((current) => {
        const index = current.findIndex((note) => note.id === change.note.id)
        if (index === -1) return [change.note, ...current]
        const next = [...current]
        next[index] = { ...next[index], ...change.note }
        return next
      })
      repointPanes([change.note])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panes, focusedKey])

  // Persist the pane row (skipped until the initial restore has run, so a fast
  // quit right after launch can't wipe the previous session).
  const panesRestored = useRef(false)
  useEffect(() => {
    if (!panesRestored.current) {
      panesRestored.current = focusedKey !== ''
      if (!panesRestored.current) return
    }
    const stored: StoredPanes = {
      panes: panes.map((pane) => ({ view: pane.view, pinned: pane.pinned })),
      focusedIndex
    }
    localStorage.setItem(OPEN_PANES_KEY, JSON.stringify(stored))
  }, [panes, focusedKey, focusedIndex])

  // Resolve a note mention clicked inside the editor. Refresh once if the id
  // isn't in the current list (the target may be new or just moved).
  const handleOpenNoteLink = async (noteId: string): Promise<void> => {
    const found =
      notes.find((n) => n.id === noteId) ?? (await refresh()).find((n) => n.id === noteId)
    if (found) openInFocused(noteView(found))
  }

  useEffect(() => {
    const onOpenLink = (event: Event): void => {
      void handleOpenNoteLink((event as CustomEvent<string>).detail)
    }
    window.addEventListener(OPEN_NOTE_LINK_EVENT, onOpenLink)
    return () => window.removeEventListener(OPEN_NOTE_LINK_EVENT, onOpenLink)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, panes, focusedKey])

  // Markdown files opened via the OS ("Open With" / double-click) are linked
  // in place by the main process; collect any queued before this window was
  // ready, then listen for opens while running.
  useEffect(() => {
    window.api.notes.takeExternalOpens().then(async (opened) => {
      if (opened.length === 0) return
      await refresh()
      const last = opened[opened.length - 1]
      if (last) openInFocused(noteView(last))
    })
    return window.api.notes.subscribeExternalOpen(async (note) => {
      await refresh()
      openInFocused(noteView(note))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panes, focusedKey])

  // Reminders that fired before this window was ready (app was closed when
  // one was due) arrive via takeFired(); ones that fire while running arrive
  // live via subscribeFired(). Clicking a notification opens its note.
  useEffect(() => {
    const applyFired = (fired: NoteSummary[]): void => {
      if (fired.length === 0) return
      setNotes((prev) =>
        prev.map((n) => {
          const f = fired.find((x) => x.id === n.id)
          return f ? { ...n, reminderAt: f.reminderAt } : n
        })
      )
    }
    window.api.reminders.takeFired().then(applyFired)
    const unsubFired = window.api.reminders.subscribeFired((note) => applyFired([note]))
    const unsubOpen = window.api.reminders.subscribeOpen((note) => openInFocused(noteView(note)))
    return () => {
      unsubFired()
      unsubOpen()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panes, focusedKey])

  // Create a note the agent asked for. The library is flat, so all it picks is
  // a title.

  // Feeds the Home view's Recent cards.
  useEffect(() => {
    if (focusedPane?.view.kind !== 'note') return
    const id = focusedPane.view.id
    setLastNoteId(id)
    setRecentIds((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, RECENT_NOTES_MAX)
      localStorage.setItem(RECENT_NOTES_KEY, JSON.stringify(next))
      return next
    })
  }, [focusedPane])

  // A pane's stored path is its bootstrap value and can lag behind a rename, so
  // OS-level actions resolve the note's current path by id — refreshing once if
  // the local list is the stale one.
  const notePathOf = async (id: string): Promise<string | null> => {
    const known = notes.find((n) => n.id === id)
    if (known) return known.path
    return (await refresh()).find((n) => n.id === id)?.path ?? null
  }

  // The main process rejects paths it can no longer resolve (a linked file
  // unlinked or deleted since the list was built) — nothing useful to report.
  const copyNotePath = async (id: string): Promise<void> => {
    const path = await notePathOf(id)
    if (path) await window.api.notes.copyPath(path).catch(() => {})
  }

  const revealNote = async (id: string): Promise<void> => {
    const path = await notePathOf(id)
    if (path) await window.api.notes.revealInFinder(path).catch(() => {})
  }

  const handleCreate = async (title = 'Untitled'): Promise<void> => {
    const note = await window.api.notes.create(title)
    await refresh()
    openInFocused(noteView(note))
  }

  // Rename from the sidebar. Saving with a new title also slug-renames the
  // file, so re-point the open pane (if any) to the new path.
  const handleRenameNote = async (note: NoteSummary, title: string): Promise<void> => {
    const full = await window.api.notes.read(note.path)
    const saved = await window.api.notes.save(note.path, {
      title,
      body: full.body,
      tags: full.tags,
      fullWidth: full.fullWidth
    })
    repointPanes(await refresh())
    repointPanes([saved])
  }

  const handleTogglePin = async (note: NoteSummary): Promise<void> => {
    await window.api.notes.setPinned(note.path, !note.pinned)
    await refresh()
  }

  const handleSetReminder = async (note: NoteSummary, reminderAt: string | null): Promise<void> => {
    const updated = await window.api.notes.setReminder(note.path, reminderAt)
    if (!updated) return
    setNotes((prev) =>
      prev.map((n) => (n.id === updated.id ? { ...n, reminderAt: updated.reminderAt } : n))
    )
  }

  const requestDeleteNote = (note: NoteSummary): void => setConfirm({ kind: 'note', note })

  const showUndo = (token: DeletedEntry, label: string): void => {
    if (undoTimer.current) clearTimeout(undoTimer.current)
    setUndoState({ ...token, label })
    undoTimer.current = setTimeout(() => setUndoState(null), UNDO_TOAST_MS)
  }

  const showNotionStatus = (message: string): void => {
    if (notionStatusTimer.current) clearTimeout(notionStatusTimer.current)
    setNotionImportStatus(message)
    notionStatusTimer.current = setTimeout(() => setNotionImportStatus(null), UNDO_TOAST_MS)
  }

  const performDelete = async (): Promise<void> => {
    const c = confirm
    if (!c) return
    setConfirm(null)
    if (c.kind === 'purge') {
      await window.api.notes.purgeTrash(c.entry.trashName)
      await refresh()
      return
    }
    if (c.kind === 'empty-trash') {
      await window.api.notes.emptyTrash()
      await refresh()
      return
    }
    const token = await window.api.notes.delete(c.note.path)
    closeNotePanes(c.note.id)
    await refresh()
    showUndo(token, `Deleted “${c.note.title || 'Untitled'}”`)
  }

  const handleRestoreTrash = async (entry: TrashEntry): Promise<void> => {
    const restored = await window.api.notes.restore(
      entry.trashName,
      entry.originalPath,
      entry.isFolder
    )
    await refresh()
    if (restored) openInFocused(noteView(restored))
  }

  const handleUndoDelete = async (): Promise<void> => {
    if (!undoState) return
    if (undoTimer.current) clearTimeout(undoTimer.current)
    const restored = await window.api.notes.restore(
      undoState.trashName,
      undoState.originalPath,
      undoState.isFolder
    )
    setUndoState(null)
    await refresh()
    if (restored) openInFocused(noteView(restored))
  }

  const handleImport = async (): Promise<void> => {
    const imported = await window.api.notes.import()
    if (imported.length === 0) return
    await refresh()
    const last = imported[imported.length - 1]
    if (last) openInFocused(noteView(last))
  }

  // Linking a folder can surface many notes — refresh the sidebar without
  // opening a pane for each.
  const handleOpenFolder = async (): Promise<void> => {
    await window.api.notes.openFolder()
    await refresh()
  }

  // A Notion export can produce far more notes than the plain-markdown import
  // above, so this deliberately doesn't open any of them — it just refreshes
  // the sidebar and reports a summary.
  const handleImportNotion = async (): Promise<void> => {
    const result = await window.api.notes.importNotion()
    if (!result) return
    await refresh()
    const count = result.created.length
    const summary =
      count === 0
        ? 'No notes were imported.'
        : `Imported ${count} note${count === 1 ? '' : 's'} from Notion.`
    showNotionStatus(
      result.skipped.length > 0 ? `${summary} ${result.skipped.length} skipped.` : summary
    )
  }

  const handleRemoveExternal = async (note: NoteSummary): Promise<void> => {
    if (!note.external) return
    await window.api.notes.removeExternal(note.path)
    closeNotePanes(note.id)
    await refresh()
  }

  // Unlink a whole registered folder; close any panes showing notes from it.
  const handleRemoveLinkedFolder = async (rootPath: string): Promise<void> => {
    const affected = notes.filter((n) => n.externalRoot === rootPath)
    await window.api.notes.removeExternal(rootPath)
    affected.forEach((n) => closeNotePanes(n.id))
    await refresh()
  }

  const handleNoteSaved = (saved: Note): void => {
    setNotes((prev) => {
      const idx = prev.findIndex((n) => n.id === saved.id)
      if (idx === -1) return prev
      const next = [...prev]
      next[idx] = {
        ...next[idx],
        title: saved.title,
        path: saved.path,
        folder: saved.folder,
        excerpt: saved.excerpt,
        updatedAt: saved.updatedAt,
        reminderAt: saved.reminderAt,
        // Favouriting from the note's own header comes back through here. The
        // main process deliberately excludes the sender from its change
        // broadcast, so this is the only route by which the sidebar learns the
        // note moved into or out of Favourites.
        pinned: saved.pinned,
        tags: saved.tags
      }
      return next
    })
    // Editing a title renames the file, so the pane has to follow it. A pane
    // that kept its bootstrap path would load the wrong (gone) file the next
    // time its editor is mounted from scratch — which is exactly what moving a
    // pane along the row does. NoteEditor ignores a path change that just
    // reflects the rename of the note it is already showing, so this can't
    // disturb an edit.
    repointPanes([saved])
  }

  const latest = useRef({
    handleCreate,
    handleImport,
    handleOpenFolder,
    setNotionGuideOpen,
    closePane,
    toggleSidebar,
    setSettingsOpen,
    setSearchOpen,
    focusedKey,
    focusedPane
  })
  latest.current = {
    handleCreate,
    handleImport,
    handleOpenFolder,
    setNotionGuideOpen,
    closePane,
    toggleSidebar,
    setSettingsOpen,
    setSearchOpen,
    focusedKey,
    focusedPane
  }

  useEffect(() => {
    const unsubscribe = window.api.shortcuts.subscribe((action) => {
      const h = latest.current
      switch (action) {
        case 'new-note':
          h.handleCreate()
          break
        case 'import-markdown':
          h.handleImport()
          break
        case 'open-folder':
          h.handleOpenFolder()
          break
        case 'import-notion':
          h.setNotionGuideOpen(true)
          break
        case 'open-settings':
          h.setSettingsOpen(true)
          break
        case 'search':
          h.setSearchOpen(true)
          break
        case 'find':
          // Handled by the visible note editor's find bar.
          window.dispatchEvent(new CustomEvent('noteato:find'))
          break
        case 'toggle-sidebar':
          h.toggleSidebar()
          break
        case 'undo':
        case 'redo': {
          // Let native inputs (title, modals, popups) keep their own undo stack;
          // otherwise drive the focused note editor's history.
          const el = document.activeElement
          if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
            document.execCommand(action)
          } else {
            const view = h.focusedPane?.view
            const ed = view?.kind === 'note' ? editorsRef.current.get(view.id) : undefined
            if (action === 'undo') ed?.undo()
            else ed?.redo()
          }
          break
        }
        case 'close-pane': {
          // ⌘W closes the pane, or puts the last note away by falling back to
          // Home. Pressed on a lone Home pane there is nothing left to close,
          // so it takes its usual meaning and closes the window.
          const only = panesRef.current.length === 1
          if (only && panesRef.current[0].view.kind === 'home') window.api.app.closeWindow()
          else h.closePane(h.focusedKey)
          break
        }
      }
    })
    return unsubscribe
  }, [])

  // Read inside the shortcut handler, which is registered once.
  const panesRef = useRef(panes)
  panesRef.current = panes

  useEffect(() => {
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current)
      if (notionStatusTimer.current) clearTimeout(notionStatusTimer.current)
    }
  }, [])

  const renderPaneBody = (pane: Pane, index: number): React.ReactNode => {
    const view = pane.view
    const controls = (
      <PaneControls
        index={index}
        count={panes.length}
        onMove={movePane}
        onClose={() => closePane(pane.key)}
        canClose={panes.length > 1 || view.kind !== 'home'}
        pinned={Boolean(pane.pinned)}
        onTogglePin={() => togglePanePin(pane.key)}
      />
    )
    switch (view.kind) {
      case 'note':
        return (
          <NoteEditor
            path={view.path}
            onSaved={handleNoteSaved}
            onEditorReady={(editor) => registerEditor(view.id, editor)}
            paneControls={controls}
          />
        )
      case 'trash':
        return (
          <TrashView
            trash={trash}
            onRestore={(entry) => void handleRestoreTrash(entry)}
            onPurge={(entry) => setConfirm({ kind: 'purge', entry })}
            onEmpty={() => setConfirm({ kind: 'empty-trash' })}
            paneControls={controls}
          />
        )
      case 'home':
        return (
          <HomeView
            notes={notes}
            recentIds={recentIds}
            onOpenNote={(target) => openInFocused(noteView(target))}
            onSetReminder={(note, reminderAt) => void handleSetReminder(note, reminderAt)}
            paneControls={controls}
          />
        )
    }
  }

  return (
    <div className="app-shell">
      <TitleBar
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div className={sidebarCollapsed ? 'app-body sidebar-collapsed' : 'app-body'}>
        <Sidebar
          notes={notes}
          trashCount={trash.length}
          activeNoteId={focusedPane?.view.kind === 'note' ? focusedPane.view.id : null}
          collapsed={sidebarCollapsed}
          onSelect={(note, inNewPane) =>
            inNewPane ? openInNewPane(noteView(note)) : openInFocused(noteView(note))
          }
          onDeleteNote={requestDeleteNote}
          onRemoveNote={(note) => void handleRemoveExternal(note)}
          onRenameNote={(note, title) => void handleRenameNote(note, title)}
          onTogglePin={handleTogglePin}
          onSetReminder={(note, reminderAt) => void handleSetReminder(note, reminderAt)}
          onCopyPath={(note) => void copyNotePath(note.id)}
          onRevealInFinder={(note) => void revealNote(note.id)}
          onRemoveLinkedFolder={(path) => void handleRemoveLinkedFolder(path)}
          onNoteDragStart={setDraggingNote}
          onNoteDragEnd={() => {
            setDraggingNote(null)
            setDropSide(null)
          }}
          onOpenTrash={() => openInFocused({ kind: 'trash' })}
          onOpenImport={() => setImportOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenStorageLocation={() => {
            void window.api.notes.chooseFolder().then((dir) => {
              if (dir) void refresh()
            })
          }}
          onOpenHelp={() => setHelpOpen(true)}
          onSearch={() => setSearchOpen(true)}
          onCreateNote={() => void handleCreate()}
        />
        <div className="editor-area" ref={editorAreaRef}>
          {/* Panes left to right, with a draggable seam between each pair. The
              keys matter: they let a pane keep its editor when the row is
              reordered or another pane opens beside it. */}
          {panes.map((pane, index) => (
            <Fragment key={pane.key}>
              {index > 0 && (
                <div
                  className="pane-resizer"
                  onPointerDown={(e) => startPaneResize(e, index - 1)}
                />
              )}
              <main
                className={
                  'editor-pane' +
                  (pane.key === focusedKey && panes.length > 1 ? ' focused' : '')
                }
                style={{ flex: `${ratios[index]} 1 0%` }}
                onFocusCapture={() => setFocusedKey(pane.key)}
                onMouseDown={() => setFocusedKey(pane.key)}
              >
                {/* A note's shell spans the pane so its Note / Transcription /
                    Chat surfaces all switch inside the same stable frame. */}
                <div className="pane-content">
                  {renderPaneBody(pane, index)}
                </div>
              </main>
            </Fragment>
          ))}

          {/* Drop targets appear only while a note is dragged out of the sidebar. */}
          {draggingNote && panes.length < MAX_PANES && (
            <div className="split-dropzones">
              {(['left', 'right'] as const).map((side) => (
                <div
                  key={side}
                  className={
                    dropSide === side ? `split-dropzone ${side} over` : `split-dropzone ${side}`
                  }
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    setDropSide(side)
                  }}
                  onDragLeave={() => setDropSide((s) => (s === side ? null : s))}
                  onDrop={(e) => {
                    e.preventDefault()
                    const note = draggingNote
                    setDropSide(null)
                    setDraggingNote(null)
                    if (!note) return
                    const pane = makePane(noteView(note))
                    const next = side === 'left' ? [pane, ...panes] : [...panes, pane]
                    commitPanes(next)
                    setFocusedKey(pane.key)
                  }}
                >
                  <span className="split-dropzone-hint">Open {side}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}
      {settingsOpen && (
        <SettingsModal onClose={() => setSettingsOpen(false)} onNotesDirChanged={refresh} />
      )}
      {importOpen && (
        <ImportModal
          onImportMarkdown={() => void handleImport()}
          onImportNotion={() => setNotionGuideOpen(true)}
          onClose={() => setImportOpen(false)}
        />
      )}
      {searchOpen && (
        <SearchModal
          onClose={() => setSearchOpen(false)}
          onSelect={(r) => openInFocused({ kind: 'note', id: r.id, path: r.path, title: r.title })}
        />
      )}
      {notionGuideOpen && (
        <ImportNotionModal
          onClose={() => setNotionGuideOpen(false)}
          onImport={() => {
            setNotionGuideOpen(false)
            void handleImportNotion()
          }}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={
            confirm.kind === 'note'
              ? 'Delete note?'
              : confirm.kind === 'purge'
                ? 'Delete forever?'
                : 'Empty trash?'
          }
          message={
            confirm.kind === 'note'
              ? `“${confirm.note.title || 'Untitled'}” will be moved to the trash.`
              : confirm.kind === 'purge'
                ? `“${confirm.entry.title || 'Untitled'}” will be permanently deleted. This cannot be undone.`
                : 'Everything in the trash will be permanently deleted. This cannot be undone.'
          }
          confirmLabel={confirm.kind === 'note' ? 'Delete' : 'Delete forever'}
          danger
          onConfirm={performDelete}
          onCancel={() => setConfirm(null)}
        />
      )}
      {undoState && (
        <div className="undo-toast">
          <span>{undoState.label}</span>
          <button onClick={handleUndoDelete}>Undo</button>
        </div>
      )}
      {notionImportStatus && (
        <div className="undo-toast">
          <span>{notionImportStatus}</span>
        </div>
      )}
    </div>
  )
}
