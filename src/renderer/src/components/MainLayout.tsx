import { useEffect, useRef, useState } from 'react'
import { IconPlus as Plus } from '@tabler/icons-react'
import type { DeletedEntry, Note, NoteSummary } from '../../../shared/types'
import type { Tab } from '../tabs'
import { useTheme } from '../theme'
import { linkifyBlocks } from '../linkify'
import { OPEN_NOTE_LINK_EVENT, type NoteatoEditor } from '../noteLink'
import Sidebar from './Sidebar'
import TabBar from './TabBar'
import AgentPanel from './AgentPanel'
import NoteEditor from './NoteEditor'
import SettingsModal from './SettingsModal'
import ConfirmDialog from './ConfirmDialog'
import SearchModal from './SearchModal'
import ImportNotionModal from './ImportNotionModal'

const UNDO_TOAST_MS = 7000
const SIDEBAR_COLLAPSED_KEY = 'noteato:sidebarCollapsed'
const AGENT_PANEL_OPEN_KEY = 'noteato:agentPanelOpen'
const OPEN_TABS_KEY = 'noteato:openTabs'
const RECENT_NOTES_KEY = 'noteato:recentNotes'
const RECENT_NOTES_MAX = 8

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
  | null

interface OpenTarget {
  id: string
  path: string
  title: string
}

function folderName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export default function MainLayout() {
  const { zenMode, setZenMode, aiAgentEnabled } = useTheme()
  const [notes, setNotes] = useState<NoteSummary[]>([])
  const [folders, setFolders] = useState<string[]>([])
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [recentIds, setRecentIds] = useState<string[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(RECENT_NOTES_KEY) ?? '[]')
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmState>(null)
  const [undoState, setUndoState] = useState<(DeletedEntry & { label: string }) | null>(null)
  const [notionImportStatus, setNotionImportStatus] = useState<string | null>(null)
  const [notionGuideOpen, setNotionGuideOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
  )
  const [agentPanelOpen, setAgentPanelOpen] = useState(
    () => localStorage.getItem(AGENT_PANEL_OPEN_KEY) !== 'false'
  )
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

  const toggleAgentPanel = (): void => {
    setAgentPanelOpen((open) => {
      const next = !open
      localStorage.setItem(AGENT_PANEL_OPEN_KEY, String(next))
      return next
    })
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
    const [list, folderList] = await Promise.all([
      window.api.notes.list(),
      window.api.notes.listFolders()
    ])
    setNotes(list)
    setFolders(folderList)
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
        .map((id) => list.find((n) => n.id === id))
        .filter((n): n is NoteSummary => Boolean(n))
        .map((n) => ({
          id: n.id,
          path: n.path,
          title: n.title,
          pinned: stored?.pinnedIds.includes(n.id) || undefined
        }))
      if (restored.length > 0) {
        setTabs(restored)
        const active =
          stored?.activeId && restored.some((t) => t.id === stored.activeId)
            ? stored.activeId
            : restored[restored.length - 1].id
        setActiveTabId(active)
      } else if (list.length > 0) {
        // Most recently updated note first (see NoteStore.list).
        openNoteTab(list[0])
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Most-recently-viewed notes, newest first — feeds the sidebar's Recent
  // section. Every activation counts, whether from the sidebar, a tab click,
  // a mention, or a restored session.
  useEffect(() => {
    if (!activeTabId) return
    setRecentIds((prev) => {
      const next = [activeTabId, ...prev.filter((id) => id !== activeTabId)].slice(
        0,
        RECENT_NOTES_MAX
      )
      localStorage.setItem(RECENT_NOTES_KEY, JSON.stringify(next))
      return next
    })
  }, [activeTabId])

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
    setActiveTabId(note.id)
  }

  const closeTab = (id: string): void => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id)
      const next = prev.filter((t) => t.id !== id)
      if (activeTabId === id) {
        const fallback = next[idx - 1] ?? next[0] ?? null
        setActiveTabId(fallback ? fallback.id : null)
      }
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

  const handleCreate = async (folder = ''): Promise<void> => {
    const note = await window.api.notes.create('Untitled', folder)
    await refresh()
    openNoteTab(note)
  }

  const handleCreateInSelectedFolder = (): Promise<void> =>
    handleCreate(selectedFolder && folders.includes(selectedFolder) ? selectedFolder : '')

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
        reminderAt: saved.reminderAt
      }
      return next
    })
    // Tab.path intentionally stays pinned to its bootstrap value — NoteEditor only
    // uses it to load initial content and tracks the current (possibly renamed)
    // path itself. Updating it here would re-trigger that load effect mid-edit.
    setTabs((prev) => prev.map((t) => (t.id === saved.id ? { ...t, title: saved.title } : t)))
  }

  const latest = useRef({
    handleCreate,
    handleCreateInSelectedFolder,
    handleCreateSticky,
    handleImport,
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

  return (
    <div className="app-shell">
      {!zenMode && (
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={toggleSidebar}
          onSelect={setActiveTabId}
          onClose={closeTab}
          onTogglePin={toggleTabPin}
          onCloseOthers={closeOtherTabs}
          onCloseRight={closeTabsToRight}
          onCloseAll={closeAllTabs}
          onNewNote={() => void handleCreateInSelectedFolder()}
          agentAvailable={aiAgentEnabled}
          agentPanelOpen={agentPanelOpen}
          onToggleAgentPanel={toggleAgentPanel}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}
      <div className={sidebarCollapsed ? 'app-body sidebar-collapsed' : 'app-body'}>
        {!zenMode && (
          <Sidebar
            notes={notes}
            folders={folders}
            recentIds={recentIds}
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
            onSetReminder={(note, reminderAt) => void handleSetReminder(note, reminderAt)}
            onMoveNote={handleMoveNote}
            onMoveFolder={handleMoveFolder}
            onCreateSticky={handleCreateSticky}
            onImport={handleImport}
            onImportNotion={() => setNotionGuideOpen(true)}
            onSearch={() => setSearchOpen(true)}
          />
        )}
        <main className="editor-pane">
          {tabs.length === 0 && (
            <div className="empty-state">
              <button
                className="empty-state-btn"
                onClick={() => void handleCreateInSelectedFolder()}
              >
                <Plus size={18} />
                <span>New note</span>
              </button>
              <p className="empty-state-hint">⌘T for a new note · ⌘K to search</p>
            </div>
          )}
          {tabs.map((tab) => (
            <div
              key={tab.id}
              style={{ display: tab.id === activeTabId ? 'block' : 'none', height: '100%' }}
            >
              <NoteEditor
                path={tab.path}
                onSaved={handleNoteSaved}
                onEditorReady={(editor) => registerEditor(tab.id, editor)}
              />
            </div>
          ))}
        </main>
        {!zenMode && aiAgentEnabled && agentPanelOpen && (
          <AgentPanel
            note={tabs.find((tab) => tab.id === activeTabId) ?? null}
            notes={notes}
            getMarkdown={getAgentMarkdown}
            applyMarkdown={applyAgentMarkdown}
            createNote={handleAgentCreateNote}
            onOpenNote={openNoteTab}
          />
        )}
      </div>
      {settingsOpen && (
        <SettingsModal onClose={() => setSettingsOpen(false)} onNotesDirChanged={refresh} />
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
          title={confirm.kind === 'note' ? 'Delete note?' : 'Delete folder?'}
          message={
            confirm.kind === 'note'
              ? `“${confirm.note.title || 'Untitled'}” will be moved to the trash. You can undo this right after.`
              : `“${folderName(confirm.path)}” and everything inside it will be moved to the trash. You can undo this right after.`
          }
          confirmLabel="Delete"
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
