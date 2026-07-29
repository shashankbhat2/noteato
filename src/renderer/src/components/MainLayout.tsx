import { Fragment, useEffect, useRef, useState } from 'react'
import type { DeletedEntry, Note, NoteSummary, TrashEntry } from '../../../shared/types'
import type { Tab } from '../tabs'
import { useTheme } from '../theme'
import { linkifyBlocks } from '../linkify'
import { OPEN_NOTE_LINK_EVENT, type NoteatoEditor } from '../noteLink'
import Sidebar from './Sidebar'
import TabBar from './TabBar'
import TrashView from './TrashView'
import HomeView from './HomeView'
import AgentPanel from './AgentPanel'
import NoteEditor from './NoteEditor'
import SettingsModal from './SettingsModal'
import ConfirmDialog from './ConfirmDialog'
import SearchModal from './SearchModal'
import ImportNotionModal from './ImportNotionModal'
import NewTabModal from './NewTabModal'
import ImportModal from './ImportModal'
import ShortcutsHelp from './ShortcutsHelp'

const UNDO_TOAST_MS = 7000
const SIDEBAR_COLLAPSED_KEY = 'noteato:sidebarCollapsed'
const OPEN_TABS_KEY = 'noteato:openTabs'
// Sentinel tab id for the Trash view; never collides with note UUIDs and is
// deliberately dropped on session restore (readStoredTabs resolves ids
// against the note list).
const TRASH_TAB_ID = '__trash__'
const HOME_TAB_ID = '__home__'
// The assistant is a view like any other, so it rides in a pane through the
// same tab machinery rather than owning a rail of its own.
const ASSISTANT_TAB_ID = '__assistant__'
const RECENT_NOTES_KEY = 'noteato:recentNotes'
const RECENT_NOTES_MAX = 8
// Two notes and the assistant is the useful ceiling; past that the panes are
// too narrow to write in.
const MAX_PANES = 3
// Narrowest a pane can be dragged, in px — below this the note body has no room.
const PANE_MIN_PX = 220

// Last session's open tabs, stored by note id (paths can go stale between
// sessions — they're re-resolved against the current note list on restore).
interface StoredTabs {
  ids: string[]
  pinnedIds: string[]
  activeId: string | null
}

function readStoredTabs(): StoredTabs | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(OPEN_TABS_KEY) ?? 'null')
    if (!parsed || !Array.isArray(parsed.ids)) return null
    return {
      ids: parsed.ids.filter((id: unknown): id is string => typeof id === 'string'),
      pinnedIds: Array.isArray(parsed.pinnedIds)
        ? parsed.pinnedIds.filter((id: unknown): id is string => typeof id === 'string')
        : [],
      activeId: typeof parsed.activeId === 'string' ? parsed.activeId : null
    }
  } catch {
    return null
  }
}

type ConfirmState =
  | { kind: 'note'; note: NoteSummary }
  | { kind: 'folder'; path: string }
  | { kind: 'purge'; entry: TrashEntry }
  | { kind: 'empty-trash' }
  | null

interface OpenTarget {
  id: string
  path: string
  title: string
}

/** What a pane holds: a tab id, or null for the pane that hosts the tab strip. */
type PaneSlot = string | null

function folderName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export default function MainLayout() {
  const { zenMode, setZenMode, aiAgentEnabled } = useTheme()
  const [notes, setNotes] = useState<NoteSummary[]>([])
  const [folders, setFolders] = useState<string[]>([])
  const [trash, setTrash] = useState<TrashEntry[]>([])
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  // The pane row. One pane hosts the tab strip and shows `activeTabId` (it also
  // keeps every other tab mounted but hidden, which is what preserves an
  // editor's history and scroll when you switch tabs); each entry in
  // `extraPanes` is a further pane pinned to one specific tab. `primaryAt` is
  // where the strip's pane sits among them, so a pane can be opened on either
  // side without the others moving.
  const [extraPanes, setExtraPanes] = useState<string[]>([])
  const [primaryAt, setPrimaryAt] = useState(0)
  const [paneRatios, setPaneRatios] = useState<number[]>([1])
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null)
  const [dropSide, setDropSide] = useState<'left' | 'right' | null>(null)
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [recentIds, setRecentIds] = useState<string[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(RECENT_NOTES_KEY) ?? '[]')
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [newTabOpen, setNewTabOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmState>(null)
  const [undoState, setUndoState] = useState<(DeletedEntry & { label: string }) | null>(null)
  const [notionImportStatus, setNotionImportStatus] = useState<string | null>(null)
  const [notionGuideOpen, setNotionGuideOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
  )
  const editorAreaRef = useRef<HTMLDivElement>(null)

  // The panes as they sit on screen, left→right.
  const paneRow: PaneSlot[] = [
    ...extraPanes.slice(0, primaryAt),
    null,
    ...extraPanes.slice(primaryAt)
  ]
  // The tab each pane is showing, in the same order — what the strip groups
  // into one combined tab.
  const paneTabIds = [
    ...new Set(paneRow.map((slot) => slot ?? activeTabId).filter((id): id is string => id !== null))
  ]
  const ratios =
    paneRatios.length === paneRow.length
      ? paneRatios
      : Array<number>(paneRow.length).fill(1 / paneRow.length)

  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const notionStatusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Active BlockNote editors keyed by tab id, so menu Undo/Redo can reach the
  // focused note's own history.
  const editorsRef = useRef(new Map<string, NoteatoEditor>())

  const registerEditor = (id: string, editor: NoteatoEditor | null): void => {
    if (editor) editorsRef.current.set(id, editor)
    else editorsRef.current.delete(id)
  }

  const getAgentMarkdown = async (noteId: string): Promise<string | null> => {
    const editor = editorsRef.current.get(noteId)
    return editor ? editor.blocksToMarkdownLossy(editor.document) : null
  }

  const applyAgentMarkdown = async (noteId: string, markdown: string): Promise<string[]> => {
    const editor = editorsRef.current.get(noteId)
    if (!editor || !markdown.trim()) return []
    const parsed = linkifyBlocks(await editor.tryParseMarkdownToBlocks(markdown))
    if (parsed.length === 0) return []
    const { insertedBlocks } = editor.replaceBlocks(editor.document, parsed)
    const ids = insertedBlocks.map((block) => block.id)
    window.requestAnimationFrame(() => {
      for (const id of ids) {
        const element = document.querySelector<HTMLElement>(
          `[data-node-type="blockOuter"][data-id="${CSS.escape(id)}"]`
        )
        if (element) element.dataset.agentChanged = 'true'
      }
      window.setTimeout(() => {
        for (const id of ids) {
          const element = document.querySelector<HTMLElement>(
            `[data-node-type="blockOuter"][data-id="${CSS.escape(id)}"]`
          )
          if (element) delete element.dataset.agentChanged
        }
      }, 2600)
    })
    return ids
  }

  const toggleSidebar = (): void => {
    setSidebarCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next))
      return next
    })
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
    const hidden = zenMode || sidebarCollapsed
    document.documentElement.style.setProperty(
      '--sidebar-w',
      hidden ? '0px' : 'var(--sidebar-expanded-w)'
    )
  }, [zenMode, sidebarCollapsed])

  // Reload notes + folders. Reconciles open tabs' titles by id (not paths — see
  // move handlers, which re-point paths deliberately).
  const refresh = async (): Promise<NoteSummary[]> => {
    const [list, folderList, trashList] = await Promise.all([
      window.api.notes.list(),
      window.api.notes.listFolders(),
      window.api.notes.listTrash()
    ])
    setNotes(list)
    setFolders(folderList)
    setTrash(trashList)
    setTabs((prev) =>
      prev.map((t) => {
        const n = list.find((x) => x.id === t.id)
        return n ? { ...t, title: n.title } : t
      })
    )
    return list
  }

  useEffect(() => {
    refresh().then((list) => {
      // Reopen everything from the last session (dropping notes that no
      // longer exist); fall back to the most recently updated note.
      const stored = readStoredTabs()
      const restored = (stored?.ids ?? [])
        .map((id) => {
          // The assistant carries no file, so it can't be resolved against the
          // note list the way every other restorable tab is.
          if (id === ASSISTANT_TAB_ID) return { id, path: '', title: 'Assistant' }
          const n = list.find((note) => note.id === id)
          return n ? { id: n.id, path: n.path, title: n.title } : null
        })
        .filter((t): t is Tab => t !== null)
        .map((t) => ({ ...t, pinned: stored?.pinnedIds.includes(t.id) || undefined }))
      if (restored.length > 0) {
        setTabs(restored)
        const active =
          stored?.activeId && restored.some((t) => t.id === stored.activeId)
            ? stored.activeId
            : restored[restored.length - 1].id
        setActiveTabId(active)
      } else {
        openHomeTab()
      }
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

  // Apply targeted changes from the compact renderer. Hidden editors are
  // repointed to the changed path, which makes them reload the shared Markdown
  // before the main window is used again; changes originating here keep the
  // focused editor mounted and preserve its caret/history.
  useEffect(() => {
    return window.api.notes.subscribeChanged((change) => {
      if (change.kind === 'refresh') {
        void refresh()
        return
      }
      if (change.kind === 'remove') {
        setNotes((current) => current.filter((note) => note.id !== change.id))
        setTabs((current) => {
          const next = current.filter((tab) => tab.id !== change.id)
          setActiveTabId((active) =>
            active === change.id ? (next[next.length - 1]?.id ?? null) : active
          )
          return next
        })
        return
      }
      setNotes((current) => {
        const index = current.findIndex((note) => note.id === change.note.id)
        if (index === -1) return [change.note, ...current]
        const next = [...current]
        next[index] = { ...next[index], ...change.note }
        return next
      })
      setTabs((current) =>
        current.map((tab) =>
          tab.id === change.note.id
            ? { ...tab, path: change.note.path, title: change.note.title }
            : tab
        )
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist the open tab set (skipped until the initial restore has run, so
  // a fast quit right after launch can't wipe the previous session).
  const tabsRestored = useRef(false)
  useEffect(() => {
    if (!tabsRestored.current) {
      tabsRestored.current = tabs.length > 0 || activeTabId !== null
      if (!tabsRestored.current) return
    }
    const stored: StoredTabs = {
      ids: tabs.map((t) => t.id),
      pinnedIds: tabs.filter((t) => t.pinned).map((t) => t.id),
      activeId: activeTabId
    }
    localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(stored))
  }, [tabs, activeTabId])

  useEffect(() => {
    if (selectedFolder && !folders.includes(selectedFolder)) setSelectedFolder(null)
  }, [folders, selectedFolder])

  // Resolve a note mention clicked inside the editor. Refresh once if the id
  // isn't in the current list (the target may be new or just moved).
  const handleOpenNoteLink = async (noteId: string): Promise<void> => {
    const found =
      notes.find((n) => n.id === noteId) ?? (await refresh()).find((n) => n.id === noteId)
    if (found) openNoteTab(found)
  }

  useEffect(() => {
    const onOpenLink = (event: Event): void => {
      void handleOpenNoteLink((event as CustomEvent<string>).detail)
    }
    window.addEventListener(OPEN_NOTE_LINK_EVENT, onOpenLink)
    return () => window.removeEventListener(OPEN_NOTE_LINK_EVENT, onOpenLink)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes])

  // Markdown files opened via the OS ("Open With" / double-click) are linked
  // in place by the main process; collect any queued before this window was ready, then
  // listen for opens while running.
  useEffect(() => {
    window.api.notes.takeExternalOpens().then(async (opened) => {
      if (opened.length === 0) return
      await refresh()
      opened.forEach(openNoteTab)
    })
    return window.api.notes.subscribeExternalOpen(async (note) => {
      await refresh()
      openNoteTab(note)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    const unsubOpen = window.api.reminders.subscribeOpen((note) => openNoteTab(note))
    return () => {
      unsubFired()
      unsubOpen()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Create a note at an agent-chosen relative path ("Folder/Title.md"). The
  // filename becomes the title; missing folders are created by NoteStore.
  const handleAgentCreateNote = async (relPath: string, markdown: string): Promise<Note | null> => {
    const segments = relPath
      .replace(/\\/g, '/')
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean)
    if (segments.length === 0 || segments.some((s) => s === '..' || s === '.')) return null
    const title = segments.pop()!.replace(/\.md$/i, '').trim() || 'Untitled'
    const created = await window.api.notes.create(title, segments.join('/'))
    const saved = await window.api.notes.save(created.path, { title, body: markdown })
    await refresh()
    return saved
  }

  const openNoteTab = (note: OpenTarget): void => {
    setTabs((prev) => {
      if (prev.some((t) => t.id === note.id)) return prev
      return [...prev, { id: note.id, path: note.path, title: note.title }]
    })
    // Already showing in a pane of its own: focus that pane instead of also
    // making it the strip's tab, which would mount the note twice.
    if (extraPanes.includes(note.id)) {
      focusPaneTab(note.id)
      return
    }
    setActiveTabId(note.id)
  }

  const openTrashTab = (): void => {
    setTabs((prev) => {
      if (prev.some((t) => t.id === TRASH_TAB_ID)) return prev
      return [...prev, { id: TRASH_TAB_ID, path: '', title: 'Trash' }]
    })
    setActiveTabId(TRASH_TAB_ID)
  }

  const openHomeTab = (): void => {
    setTabs((prev) => {
      if (prev.some((t) => t.id === HOME_TAB_ID)) return prev
      // Home leads the strip, like a browser start page.
      return [{ id: HOME_TAB_ID, path: '', title: 'Home' }, ...prev]
    })
    setActiveTabId(HOME_TAB_ID)
  }

  /**
   * The assistant opens into the pane beside whatever is focused, which is
   * where it used to live permanently — but from here it is an ordinary tab,
   * so it can be moved to the other half, un-split into a full pane, or
   * closed like anything else.
   */
  const toggleAssistantPane = (): void => {
    if (tabs.some((t) => t.id === ASSISTANT_TAB_ID)) {
      closeTab(ASSISTANT_TAB_ID)
      return
    }
    addNoteToSplit({ id: ASSISTANT_TAB_ID, path: '', title: 'Assistant' })
  }

  // Feeds the Home view's Recent cards; special tabs don't count.
  useEffect(() => {
    if (!activeTabId || activeTabId.startsWith('__')) return
    setRecentIds((prev) => {
      const next = [activeTabId, ...prev.filter((id) => id !== activeTabId)].slice(
        0,
        RECENT_NOTES_MAX
      )
      localStorage.setItem(RECENT_NOTES_KEY, JSON.stringify(next))
      return next
    })
  }, [activeTabId])

  /** Commit a new row, resetting the widths only when the pane count changed. */
  const setPaneRow = (row: PaneSlot[]): void => {
    const at = row.indexOf(null)
    setPrimaryAt(at === -1 ? 0 : at)
    setExtraPanes(row.filter((slot): slot is string => slot !== null))
    setPaneRatios((prev) =>
      prev.length === row.length ? prev : Array<number>(row.length).fill(1 / row.length)
    )
  }

  /**
   * Keep the panes' tabs adjacent in the strip, in the order they appear on
   * screen, so the group renders as one contiguous combined tab.
   */
  const regroupStrip = (row: PaneSlot[], activeId: string | null): void => {
    const ids = row.map((slot) => slot ?? activeId).filter((id): id is string => id !== null)
    if (ids.length < 2) return
    setTabs((prev) => {
      const members = ids
        .map((id) => prev.find((t) => t.id === id))
        .filter((t): t is Tab => t !== undefined)
      if (members.length !== ids.length) return prev
      const rest = prev.filter((t) => !ids.includes(t.id))
      const firstAt = prev.findIndex((t) => ids.includes(t.id))
      const insertAt = prev.slice(0, firstAt).filter((t) => !ids.includes(t.id)).length
      return [...rest.slice(0, insertAt), ...members, ...rest.slice(insertAt)]
    })
  }

  /**
   * Put `id` in a pane at one end of the row. Over the cap, the pane furthest
   * from that end gives way — never the one hosting the tab strip, which has
   * nowhere else to go.
   */
  const withPane = (row: PaneSlot[], id: string, end: 'start' | 'end'): PaneSlot[] => {
    const rest = row.filter((slot) => slot !== id)
    const next = end === 'start' ? [id, ...rest] : [...rest, id]
    while (next.length > MAX_PANES) {
      const far = end === 'start' ? next.length - 1 : 0
      next.splice(next[far] === null ? (end === 'start' ? far - 1 : 1) : far, 1)
    }
    return next
  }

  const closeTab = (id: string): void => {
    const row = paneRow.filter((slot) => slot !== id)
    if (row.length !== paneRow.length) setPaneRow(row)
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id)
      const next = prev.filter((t) => t.id !== id)
      if (activeTabId === id) {
        // The strip's pane can't adopt a tab another pane is already showing.
        const free = next.filter((t) => !extraPanes.includes(t.id))
        const fallback = free[Math.min(idx, free.length - 1)] ?? free[0] ?? null
        setActiveTabId(fallback ? fallback.id : null)
      }
      return next
    })
  }

  const selectTab = (id: string): void => {
    // A tab pinned into its own pane is focused there rather than pulled into
    // the strip's pane, which would leave that pane empty.
    if (extraPanes.includes(id)) {
      focusPaneTab(id)
      return
    }
    setActiveTabId(id)
  }

  /**
   * Focus the pane showing `id`. The strip moves to that pane and the tab it
   * was showing takes over the one just vacated, so nothing shifts on screen.
   */
  const focusPaneTab = (id: string): void => {
    if (id === activeTabId || !activeTabId) return
    if (!extraPanes.includes(id)) {
      setActiveTabId(id)
      return
    }
    setPaneRow(paneRow.map((slot) => (slot === id ? null : slot === null ? activeTabId : slot)))
    setActiveTabId(id)
  }

  /** Close one pane and its tab; the remaining panes share out its width. */
  const closePaneAt = (index: number): void => {
    if (paneRow.length < 2 || index < 0 || index >= paneRow.length) return
    const slot = paneRow[index]
    const closingId = slot ?? activeTabId
    if (!closingId) return
    const row = paneRow.filter((_, i) => i !== index)
    if (slot === null) {
      // The strip's pane is the one closing, so a survivor has to take it over.
      const heir = row[0]
      setActiveTabId(heir ?? null)
      setPaneRow(row.map((s) => (s === heir ? null : s)))
    } else {
      setPaneRow(row)
    }
    setTabs((prev) => prev.filter((tab) => tab.id !== closingId))
  }

  /** Collapse back to a single pane; the other tabs stay open in the strip. */
  const separatePanes = (): void => setPaneRow([null])

  /** Mirror the row without changing which pane is focused. */
  const reversePanes = (): void => {
    const row = [...paneRow].reverse()
    setPaneRow(row)
    setPaneRatios((prev) => [...prev].reverse())
    regroupStrip(row, activeTabId)
  }

  /** Drop a dragged tab onto one edge of the editor area to open a pane there. */
  const openSplit = (id: string, side: 'left' | 'right'): void => {
    if (tabs.length < 2) return
    let active = activeTabId
    if (active === id) {
      // The strip's pane has to move to some other tab, since `id` is leaving
      // it for a pane of its own.
      active = tabs.find((t) => t.id !== id && !extraPanes.includes(t.id))?.id ?? null
      if (!active) return
      setActiveTabId(active)
    }
    const row = withPane(paneRow, id, side === 'left' ? 'start' : 'end')
    setPaneRow(row)
    regroupStrip(row, active)
  }

  // A tab's stored path is its bootstrap value and can lag behind a rename, so
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

  /**
   * Open a note in a pane of its own on the right, adding the tab first if it
   * isn't open yet. `openSplit` can't do this — it needs the target to already
   * be in `tabs`, and freshly-set state isn't readable yet — so the tab is
   * inserted and the pane is opened in one pass.
   */
  const addNoteToSplit = (note: OpenTarget): void => {
    const partnerId =
      activeTabId && activeTabId !== note.id
        ? activeTabId
        : tabs.find((t) => t.id !== note.id && !extraPanes.includes(t.id))?.id ?? null
    // Nothing to sit beside — just open it normally.
    if (!partnerId) {
      openNoteTab(note)
      return
    }
    setTabs((prev) =>
      prev.some((t) => t.id === note.id)
        ? prev
        : [...prev, { id: note.id, path: note.path, title: note.title }]
    )
    const row = withPane(paneRow, note.id, 'end')
    setPaneRow(row)
    setActiveTabId(partnerId)
    regroupStrip(row, partnerId)
  }

  /**
   * Reorder the strip by dropping a tab onto another one (or onto the empty
   * space after the last, where `targetId` is null).
   *
   * Two invariants the strip already relies on are preserved here: pinned tabs
   * lead the strip, so a drag reorders within its own group rather than across
   * it; and the two halves of a split stay adjacent, since they render as one
   * combined tab — a drop aimed between them snaps to the nearer outside edge.
   */
  const moveTab = (draggedId: string, targetId: string | null, side: 'before' | 'after'): void => {
    if (draggedId === targetId) return
    setTabs((prev) => {
      const moved = prev.find((t) => t.id === draggedId)
      if (!moved) return prev
      const rest = prev.filter((t) => t.id !== draggedId)
      // Where the unpinned group starts once the dragged tab is out of the way.
      const pinCount = rest.filter((t) => t.pinned).length

      let index: number
      if (targetId === null) {
        index = moved.pinned ? pinCount : rest.length
      } else {
        const target = rest.findIndex((t) => t.id === targetId)
        if (target === -1) return prev
        index = side === 'before' ? target : target + 1
      }

      // The panes' tabs render as one combined tab, so a drop landing strictly
      // inside their span would tear it apart — snap to the nearer outside edge.
      if (paneTabIds.length > 1 && !paneTabIds.includes(draggedId)) {
        const spots = paneTabIds.map((id) => rest.findIndex((t) => t.id === id))
        if (spots.every((i) => i !== -1)) {
          const lo = Math.min(...spots)
          const hi = Math.max(...spots)
          if (index > lo && index <= hi) index = index - lo <= hi + 1 - index ? lo : hi + 1
        }
      }

      const lower = moved.pinned ? 0 : pinCount
      const upper = moved.pinned ? pinCount : rest.length
      index = Math.min(Math.max(index, lower), upper)

      const next = [...rest]
      next.splice(index, 0, moved)
      return next
    })
  }

  // --- Tab context-menu actions (Chrome-style; pinned tabs survive bulk closes)

  const toggleTabPin = (id: string): void => {
    setTabs((prev) => {
      const next = prev.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t))
      return [...next.filter((t) => t.pinned), ...next.filter((t) => !t.pinned)]
    })
  }

  const closeOtherTabs = (id: string): void => {
    setTabs(tabs.filter((t) => t.id === id || t.pinned))
    setActiveTabId(id)
  }

  const closeTabsToRight = (id: string): void => {
    const idx = tabs.findIndex((t) => t.id === id)
    if (idx === -1) return
    const next = tabs.filter((t, i) => i <= idx || t.pinned)
    setTabs(next)
    if (activeTabId && !next.some((t) => t.id === activeTabId)) setActiveTabId(id)
  }

  const closeAllTabs = (): void => {
    const next = tabs.filter((t) => t.pinned)
    setTabs(next)
    if (activeTabId && !next.some((t) => t.id === activeTabId)) {
      setActiveTabId(next.length ? next[next.length - 1].id : null)
    }
  }

  const handleCreate = async (folder = '', title = 'Untitled'): Promise<void> => {
    const note = await window.api.notes.create(title, folder)
    await refresh()
    openNoteTab(note)
  }

  const handleCreateInSelectedFolder = (title?: string): Promise<void> =>
    handleCreate(
      selectedFolder && folders.includes(selectedFolder) ? selectedFolder : '',
      title || 'Untitled'
    )

  const handleCreateFolder = async (parent: string, name: string): Promise<void> => {
    const safe = name.replace(/[/\\]/g, '').trim()
    if (!safe) return
    await window.api.notes.createFolder(parent ? `${parent}/${safe}` : safe)
    await refresh()
  }

  // Re-point any open tabs whose note path changed (after a move/rename).
  const repointTabs = (list: NoteSummary[]): void => {
    setTabs((prev) =>
      prev.map((t) => {
        const n = list.find((x) => x.id === t.id)
        return n && n.path !== t.path ? { ...t, path: n.path } : t
      })
    )
  }

  const handleRenameFolder = async (path: string, name: string): Promise<void> => {
    try {
      await window.api.notes.renameFolder(path, name)
    } catch {
      /* name clash — leave as-is */
    }
    repointTabs(await refresh())
  }

  const handleMoveNote = async (path: string, targetFolder: string): Promise<void> => {
    const moved = await window.api.notes.moveNote(path, targetFolder)
    const list = await refresh()
    if (moved) {
      setTabs((prev) =>
        prev.map((t) => (t.id === moved.id ? { ...t, path: moved.path, title: moved.title } : t))
      )
    } else {
      repointTabs(list)
    }
  }

  const handleMoveFolder = async (path: string, targetParent: string): Promise<void> => {
    try {
      await window.api.notes.moveFolder(path, targetParent)
    } catch {
      /* invalid target — ignore */
    }
    repointTabs(await refresh())
  }

  // Rename from the sidebar. Saving with a new title also slug-renames the
  // file, so re-point the open tab (if any) to the new path.
  const handleRenameNote = async (note: NoteSummary, title: string): Promise<void> => {
    const full = await window.api.notes.read(note.path)
    const saved = await window.api.notes.save(note.path, {
      title,
      body: full.body,
      tags: full.tags,
      fullWidth: full.fullWidth
    })
    await refresh()
    setTabs((prev) =>
      prev.map((t) => (t.id === saved.id ? { ...t, path: saved.path, title: saved.title } : t))
    )
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
  const requestDeleteFolder = (path: string): void => setConfirm({ kind: 'folder', path })

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
    if (c.kind === 'note') {
      const token = await window.api.notes.delete(c.note.path)
      closeTab(c.note.id)
      await refresh()
      showUndo(token, `Deleted “${c.note.title || 'Untitled'}”`)
    } else {
      // Close every open tab whose note lives inside the folder being deleted.
      const affected = notes.filter(
        (n) => n.folder === c.path || n.folder.startsWith(`${c.path}/`)
      )
      const token = await window.api.notes.deleteFolder(c.path)
      affected.forEach((n) => closeTab(n.id))
      await refresh()
      showUndo(token, `Deleted folder “${folderName(c.path)}”`)
    }
  }

  const handleRestoreTrash = async (entry: TrashEntry): Promise<void> => {
    const restored = await window.api.notes.restore(
      entry.trashName,
      entry.originalPath,
      entry.isFolder
    )
    await refresh()
    if (restored) openNoteTab(restored)
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
    if (restored) openNoteTab(restored)
  }

  const handleCreateSticky = async (): Promise<void> => {
    await window.api.sticky.create()
  }

  const handleImport = async (): Promise<void> => {
    const imported = await window.api.notes.import()
    if (imported.length === 0) return
    await refresh()
    imported.forEach(openNoteTab)
  }

  // Linking a folder can surface many notes — refresh the sidebar without
  // opening a tab for each.
  const handleOpenFolder = async (): Promise<void> => {
    await window.api.notes.openFolder()
    await refresh()
  }

  // A Notion export can produce far more notes than the plain-markdown import
  // above, so this deliberately doesn't open every imported note as a tab —
  // it just refreshes the sidebar (folders included) and reports a summary.
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
    closeTab(note.id)
    await refresh()
  }

  // Unlink a whole registered folder; close any tabs showing notes from it.
  const handleRemoveLinkedFolder = async (rootPath: string): Promise<void> => {
    const affected = notes.filter((n) => n.externalRoot === rootPath)
    await window.api.notes.removeExternal(rootPath)
    affected.forEach((n) => closeTab(n.id))
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
        tags: saved.tags
      }
      return next
    })
    // Editing a title renames the file, so the tab has to follow it. A tab that
    // kept its bootstrap path would load the wrong (gone) file the next time its
    // editor is mounted from scratch — which is exactly what moving a tab into
    // split view does. NoteEditor ignores a path change that just reflects the
    // rename of the note it is already showing, so this can't disturb an edit.
    setTabs((prev) =>
      prev.map((t) => (t.id === saved.id ? { ...t, title: saved.title, path: saved.path } : t))
    )
  }

  const latest = useRef({
    handleCreate,
    handleCreateInSelectedFolder,
    handleCreateSticky,
    handleImport,
    handleOpenFolder,
    setNotionGuideOpen,
    closeTab,
    toggleSidebar,
    setSettingsOpen,
    setSearchOpen,
    zenMode,
    setZenMode,
    activeTabId
  })
  latest.current = {
    handleCreate,
    handleCreateInSelectedFolder,
    handleCreateSticky,
    handleImport,
    handleOpenFolder,
    setNotionGuideOpen,
    closeTab,
    toggleSidebar,
    setSettingsOpen,
    setSearchOpen,
    zenMode,
    setZenMode,
    activeTabId
  }

  useEffect(() => {
    const unsubscribe = window.api.shortcuts.subscribe((action) => {
      const h = latest.current
      switch (action) {
        case 'new-note':
          h.handleCreateInSelectedFolder()
          break
        case 'new-sticky':
          h.handleCreateSticky()
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
        case 'toggle-zen':
          h.setZenMode(!h.zenMode)
          break
        case 'undo':
        case 'redo': {
          // Let native inputs (title, modals, popups) keep their own undo stack;
          // otherwise drive the focused note editor's history.
          const el = document.activeElement
          if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
            document.execCommand(action)
          } else {
            const ed = h.activeTabId ? editorsRef.current.get(h.activeTabId) : undefined
            if (action === 'undo') ed?.undo()
            else ed?.redo()
          }
          break
        }
        case 'close-tab':
          if (h.activeTabId) h.closeTab(h.activeTabId)
          else window.api.app.closeWindow()
          break
      }
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current)
      if (notionStatusTimer.current) clearTimeout(notionStatusTimer.current)
    }
  }, [])

  const assistantOpen = tabs.some((tab) => tab.id === ASSISTANT_TAB_ID)

  /**
   * The notes the assistant is working on: whatever else is on screen. The
   * focused pane's note is the subject, and a second note pane rides along as
   * read-only context. With nothing beside it there is no subject — better
   * than guessing at a note the user can't see.
   */
  const assistantContext = (): { note: Tab | null; splitNote: Tab | null } => {
    const others = paneTabIds
      .filter((id) => id !== ASSISTANT_TAB_ID && !id.startsWith('__'))
      .map((id) => tabs.find((tab) => tab.id === id))
      .filter((tab): tab is Tab => tab !== undefined)
    // Whichever of them is focused leads; otherwise take them left to right.
    const lead = others.find((tab) => tab.id === activeTabId) ?? others[0] ?? null
    return { note: lead, splitNote: others.find((tab) => tab.id !== lead?.id) ?? null }
  }

  // Tabs that render a built-in view instead of a note editor.
  const renderSpecialTab = (tab: Tab): React.ReactNode | null => {
    if (tab.id === ASSISTANT_TAB_ID) {
      const { note, splitNote } = assistantContext()
      return (
        <AgentPanel
          note={note}
          splitNote={splitNote}
          notes={notes}
          getMarkdown={getAgentMarkdown}
          applyMarkdown={applyAgentMarkdown}
          createNote={handleAgentCreateNote}
          onOpenNote={openNoteTab}
        />
      )
    }
    if (tab.id === TRASH_TAB_ID) {
      return (
        <TrashView
          trash={trash}
          onRestore={(entry) => void handleRestoreTrash(entry)}
          onPurge={(entry) => setConfirm({ kind: 'purge', entry })}
          onEmpty={() => setConfirm({ kind: 'empty-trash' })}
        />
      )
    }
    if (tab.id === HOME_TAB_ID) {
      return (
        <HomeView
          notes={notes}
          recentIds={recentIds}
          onOpenNote={openNoteTab}
          onSetReminder={(note, reminderAt) => void handleSetReminder(note, reminderAt)}
        />
      )
    }
    return null
  }

  /**
   * The assistant manages its own scrolling and needs a bounded height, unlike
   * a note, which grows the pane and lets the pane scroll.
   */
  const paneClass = (id: string | null, extra = ''): string =>
    `editor-pane${extra ? ` ${extra}` : ''}${id === ASSISTANT_TAB_ID ? ' fills-pane' : ''}`

  // A note's shell has to span the pane even when the note is short, so the
  // dictation button docks to the pane's bottom rather than to the end of the
  // text. A flex column is what makes `flex: 1` on the shell resolve — a
  // percentage height can't, since the wrapper's own height is auto.
  const paneBodyStyle = (id: string): React.CSSProperties =>
    id === ASSISTANT_TAB_ID
      ? { height: '100%' }
      : { display: 'flex', flexDirection: 'column', minHeight: '100%' }

  /** A pane pinned to one tab. The pane hosting the tab strip is rendered inline. */
  const renderPinnedPane = (id: string, index: number, flex: number): React.ReactNode => {
    const tab = tabs.find((t) => t.id === id)
    if (!tab) return null
    return (
      <main className={paneClass(tab.id, 'split-pane')} style={{ flex: `${flex} 1 0%` }}>
        <div style={paneBodyStyle(tab.id)}>
          {renderSpecialTab(tab) ?? (
            <NoteEditor
              path={tab.path}
              onSaved={handleNoteSaved}
              onEditorReady={(editor) => registerEditor(tab.id, editor)}
              onCloseSplit={() => closePaneAt(index)}
            />
          )}
        </div>
      </main>
    )
  }

  return (
    <div className={zenMode ? 'app-shell zen' : 'app-shell'}>
      {!zenMode && (
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={toggleSidebar}
          onSelect={selectTab}
          onClose={closeTab}
          onTogglePin={toggleTabPin}
          onCloseOthers={closeOtherTabs}
          onCloseRight={closeTabsToRight}
          onCloseAll={closeAllTabs}
          onMoveTab={moveTab}
          onCopyPath={(id) => void copyNotePath(id)}
          onRevealInFinder={(id) => void revealNote(id)}
          onNewNote={() => setNewTabOpen(true)}
          onTabDragStart={setDraggingTabId}
          onTabDragEnd={() => {
            setDraggingTabId(null)
            setDropSide(null)
          }}
          paneTabIds={paneTabIds}
          onSplit={openSplit}
          onSeparatePanes={separatePanes}
          onClosePane={closePaneAt}
          onReversePanes={reversePanes}
          onFocusPane={focusPaneTab}
        />
      )}
      <div className={sidebarCollapsed ? 'app-body sidebar-collapsed' : 'app-body'}>
        {!zenMode && (
          <Sidebar
            notes={notes}
            folders={folders}
            trashCount={trash.length}
            activeNoteId={activeTabId}
            selectedFolder={selectedFolder}
            collapsed={sidebarCollapsed}
            onSelect={(note) => {
              setSelectedFolder(null)
              openNoteTab(note)
            }}
            onSelectFolder={setSelectedFolder}
            onCreateNote={(folder) => handleCreate(folder)}
            onCreateFolder={handleCreateFolder}
            onRenameFolder={handleRenameFolder}
            onDeleteFolder={requestDeleteFolder}
            onDeleteNote={requestDeleteNote}
            onRemoveNote={(note) => void handleRemoveExternal(note)}
            onRenameNote={(note, title) => void handleRenameNote(note, title)}
            onTogglePin={handleTogglePin}
            onAddToSplit={addNoteToSplit}
            canSplit={tabs.length > 0}
            onSetReminder={(note, reminderAt) => void handleSetReminder(note, reminderAt)}
            onMoveNote={handleMoveNote}
            onMoveFolder={handleMoveFolder}
            onCreateSticky={handleCreateSticky}
            onImport={handleImport}
            onOpenFolder={() => void handleOpenFolder()}
            onRemoveLinkedFolder={(path) => void handleRemoveLinkedFolder(path)}
            onImportNotion={() => setNotionGuideOpen(true)}
            onSearch={() => setSearchOpen(true)}
            onOpenTrash={openTrashTab}
            onOpenHome={openHomeTab}
            onOpenAssistant={toggleAssistantPane}
            assistantOpen={assistantOpen}
            assistantAvailable={aiAgentEnabled}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenImport={() => setImportOpen(true)}
          />
        )}
        <div className="editor-area" ref={editorAreaRef}>
          {/* Panes left to right, with a draggable seam between each pair. The
              keys matter: they let a pane keep its editors when the row is
              reordered or another pane opens beside it. */}
          {paneRow.map((slot, index) => (
            <Fragment key={slot ?? '__strip__'}>
              {index > 0 && (
                <div
                  className="pane-resizer"
                  onPointerDown={(e) => startPaneResize(e, index - 1)}
                />
              )}
              {slot !== null ? (
                renderPinnedPane(slot, index, ratios[index])
              ) : (
                <main className={paneClass(activeTabId)} style={{ flex: `${ratios[index]} 1 0%` }}>
                  {/* All tabs closed: Home takes over rather than an empty state. */}
                  {tabs.length === 0 && (
                    <HomeView
                      notes={notes}
                      recentIds={recentIds}
                      onOpenNote={openNoteTab}
                      onSetReminder={(note, reminderAt) =>
                        void handleSetReminder(note, reminderAt)
                      }
                    />
                  )}
                  {/* Tabs pinned into their own pane are mounted there, so skip
                      them here — one note must never have two live editors. */}
                  {tabs
                    .filter((tab) => !extraPanes.includes(tab.id))
                    .map((tab) => (
                      <div
                        key={tab.id}
                        // minHeight, not height: a sticky child only stays stuck
                        // within its parent's box, so this must grow with the
                        // note's content.
                        style={
                          tab.id === activeTabId ? paneBodyStyle(tab.id) : { display: 'none' }
                        }
                      >
                        {renderSpecialTab(tab) ?? (
                          <NoteEditor
                            path={tab.path}
                            onSaved={handleNoteSaved}
                            onEditorReady={(editor) => registerEditor(tab.id, editor)}
                          />
                        )}
                      </div>
                    ))}
                </main>
              )}
            </Fragment>
          ))}

          {/* Floats over the working area's bottom-left corner, clear of the
              dictation button at each pane's bottom-right. */}
          <div className="editor-area-shortcuts">
            <ShortcutsHelp />
          </div>

          {/* Drop targets appear only while a tab is being dragged. */}
          {draggingTabId && tabs.length > 1 && (
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
                    const id = e.dataTransfer.getData('text/plain') || draggingTabId
                    if (id) openSplit(id, side)
                    setDropSide(null)
                    setDraggingTabId(null)
                  }}
                >
                  <span className="split-dropzone-hint">Split {side}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
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
      {newTabOpen && (
        <NewTabModal
          notes={notes}
          recentIds={recentIds}
          onOpen={openNoteTab}
          onCreate={(title) => void handleCreateInSelectedFolder(title)}
          onClose={() => setNewTabOpen(false)}
        />
      )}
      {searchOpen && (
        <SearchModal
          onClose={() => setSearchOpen(false)}
          onSelect={(r) => openNoteTab({ id: r.id, path: r.path, title: r.title })}
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
              : confirm.kind === 'folder'
                ? 'Delete folder?'
                : confirm.kind === 'purge'
                  ? 'Delete forever?'
                  : 'Empty trash?'
          }
          message={
            confirm.kind === 'note'
              ? `“${confirm.note.title || 'Untitled'}” will be moved to the trash.`
              : confirm.kind === 'folder'
                ? `“${folderName(confirm.path)}” and everything inside it will be moved to the trash.`
                : confirm.kind === 'purge'
                  ? `“${confirm.entry.title || 'Untitled'}” will be permanently deleted. This cannot be undone.`
                  : 'Everything in the trash will be permanently deleted. This cannot be undone.'
          }
          confirmLabel={confirm.kind === 'note' || confirm.kind === 'folder' ? 'Delete' : 'Delete forever'}
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
