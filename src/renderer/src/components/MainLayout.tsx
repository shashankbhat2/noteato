import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import type { BlockNoteEditor } from '@blocknote/core'
import type { DeletedEntry, Note, NoteSummary } from '../../../shared/types'
import type { Tab } from '../tabs'
import { useTheme } from '../theme'
import { linkifyBlocks } from '../linkify'
import Sidebar from './Sidebar'
import TabBar from './TabBar'
import AgentPanel from './AgentPanel'
import NoteEditor from './NoteEditor'
import SettingsModal from './SettingsModal'
import ConfirmDialog from './ConfirmDialog'
import SearchModal from './SearchModal'

const UNDO_TOAST_MS = 7000
const SIDEBAR_COLLAPSED_KEY = 'noteato:sidebarCollapsed'
const AGENT_PANEL_OPEN_KEY = 'noteato:agentPanelOpen'

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
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmState>(null)
  const [undoState, setUndoState] = useState<(DeletedEntry & { label: string }) | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
  )
  const [agentPanelOpen, setAgentPanelOpen] = useState(
    () => localStorage.getItem(AGENT_PANEL_OPEN_KEY) !== 'false'
  )
  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Active BlockNote editors keyed by tab id, so menu Undo/Redo can reach the
  // focused note's own history.
  const editorsRef = useRef(new Map<string, BlockNoteEditor>())

  const registerEditor = (id: string, editor: BlockNoteEditor | null): void => {
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
      // Most recently updated note first (see NoteStore.list) — open it instead
      // of landing on the empty "New note" state when notes exist.
      if (list.length > 0) openNoteTab(list[0])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (selectedFolder && !folders.includes(selectedFolder)) setSelectedFolder(null)
  }, [folders, selectedFolder])

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

  const handleTogglePin = async (note: NoteSummary): Promise<void> => {
    await window.api.notes.setPinned(note.path, !note.pinned)
    await refresh()
  }

  const requestDeleteNote = (note: NoteSummary): void => setConfirm({ kind: 'note', note })
  const requestDeleteFolder = (path: string): void => setConfirm({ kind: 'folder', path })

  const showUndo = (token: DeletedEntry, label: string): void => {
    if (undoTimer.current) clearTimeout(undoTimer.current)
    setUndoState({ ...token, label })
    undoTimer.current = setTimeout(() => setUndoState(null), UNDO_TOAST_MS)
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
        updatedAt: saved.updatedAt
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
        case 'open-settings':
          h.setSettingsOpen(true)
          break
        case 'search':
          h.setSearchOpen(true)
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
            onTogglePin={handleTogglePin}
            onMoveNote={handleMoveNote}
            onMoveFolder={handleMoveFolder}
            onCreateSticky={handleCreateSticky}
            onImport={handleImport}
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
            getMarkdown={getAgentMarkdown}
            applyMarkdown={applyAgentMarkdown}
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
    </div>
  )
}
