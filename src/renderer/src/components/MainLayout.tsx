import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import type { Note, NoteSummary } from '../../../shared/types'
import type { Tab } from '../tabs'
import Sidebar from './Sidebar'
import TabBar from './TabBar'
import NoteEditor from './NoteEditor'
import SettingsTab from './SettingsTab'

const SIDEBAR_COLLAPSED_KEY = 'noat:sidebarCollapsed'

export default function MainLayout() {
  const [notes, setNotes] = useState<NoteSummary[]>([])
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
  )

  const toggleSidebar = (): void => {
    setSidebarCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next))
      return next
    })
  }

  const refreshNotes = async (): Promise<void> => {
    const list = await window.api.notes.list()
    setNotes(list)
  }

  useEffect(() => {
    refreshNotes()
  }, [])

  const openNoteTab = (note: NoteSummary): void => {
    setTabs((prev) => {
      if (prev.some((t) => t.id === note.id)) return prev
      return [...prev, { kind: 'note', id: note.id, filename: note.filename, title: note.title }]
    })
    setActiveTabId(note.id)
  }

  const openSettingsTab = (): void => {
    setTabs((prev) =>
      prev.some((t) => t.id === 'settings') ? prev : [...prev, { kind: 'settings', id: 'settings' }]
    )
    setActiveTabId('settings')
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

  const handleCreate = async (): Promise<void> => {
    const note = await window.api.notes.create('Untitled')
    await refreshNotes()
    openNoteTab(note)
  }

  const handleDelete = async (filename: string): Promise<void> => {
    const note = notes.find((n) => n.filename === filename)
    await window.api.notes.delete(filename)
    if (note) closeTab(note.id)
    await refreshNotes()
  }

  const handleCreateSticky = async (): Promise<void> => {
    await window.api.sticky.create()
  }

  const handleImport = async (): Promise<void> => {
    const imported = await window.api.notes.import()
    if (imported.length === 0) return
    await refreshNotes()
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
        filename: saved.filename,
        excerpt: saved.excerpt,
        updatedAt: saved.updatedAt
      }
      return next
    })
    // Tab.filename intentionally stays pinned to its bootstrap value — NoteEditor
    // only uses it once to load initial content, and tracks the current (possibly
    // renamed) filename itself. Updating it here would re-trigger that load effect
    // mid-edit and reset the editor.
    setTabs((prev) =>
      prev.map((t) => (t.kind === 'note' && t.id === saved.id ? { ...t, title: saved.title } : t))
    )
  }

  const latest = useRef({
    handleCreate,
    handleCreateSticky,
    handleImport,
    openSettingsTab,
    closeTab,
    toggleSidebar,
    activeTabId
  })
  latest.current = {
    handleCreate,
    handleCreateSticky,
    handleImport,
    openSettingsTab,
    closeTab,
    toggleSidebar,
    activeTabId
  }

  useEffect(() => {
    const unsubscribe = window.api.shortcuts.subscribe((action) => {
      const h = latest.current
      switch (action) {
        case 'new-note':
          h.handleCreate()
          break
        case 'new-sticky':
          h.handleCreateSticky()
          break
        case 'import-markdown':
          h.handleImport()
          break
        case 'open-settings':
          h.openSettingsTab()
          break
        case 'toggle-sidebar':
          h.toggleSidebar()
          break
        case 'close-tab':
          if (h.activeTabId) h.closeTab(h.activeTabId)
          else window.api.app.closeWindow()
          break
      }
    })
    return unsubscribe
  }, [])

  return (
    <div className="app-shell">
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
        onSelect={setActiveTabId}
        onClose={closeTab}
        onNewNote={handleCreate}
        onOpenSettings={openSettingsTab}
      />
      <div className="app-body">
        <Sidebar
          notes={notes}
          activeNoteId={tabs.find((t) => t.id === activeTabId && t.kind === 'note')?.id ?? null}
          collapsed={sidebarCollapsed}
          onSelect={(filename) => {
            const note = notes.find((n) => n.filename === filename)
            if (note) openNoteTab(note)
          }}
          onCreate={handleCreate}
          onDelete={handleDelete}
          onCreateSticky={handleCreateSticky}
          onImport={handleImport}
        />
        <main className="editor-pane">
          {tabs.length === 0 && (
            <div className="empty-state">
              <button className="empty-state-btn" onClick={handleCreate}>
                <Plus size={18} />
                <span>New note</span>
              </button>
              <p className="empty-state-hint">⌘T for a new note · ⌘⇧N for a sticky note</p>
            </div>
          )}
          {tabs.map((tab) => (
            <div
              key={tab.id}
              style={{ display: tab.id === activeTabId ? 'block' : 'none', height: '100%' }}
            >
              {tab.kind === 'settings' ? (
                <SettingsTab onNotesDirChanged={refreshNotes} />
              ) : (
                <NoteEditor filename={tab.filename} onSaved={handleNoteSaved} />
              )}
            </div>
          ))}
        </main>
      </div>
    </div>
  )
}
