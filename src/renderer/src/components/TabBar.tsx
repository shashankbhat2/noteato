import { useRef, useState } from 'react'
import {
  IconChevronLeft as ChevronLeft,
  IconChevronRight as ChevronRight,
  IconLayoutSidebar as PanelLeft,
  IconPin as Pin,
  IconPlus as Plus,
  IconSettings as Settings,
  IconSparkles as Sparkles,
  IconX as X
} from '@tabler/icons-react'
import type { Tab } from '../tabs'
import ShortcutsHelp from './ShortcutsHelp'
import ContextMenu, { type MenuItem } from './ContextMenu'

const DOUBLE_CLICK_MS = 400

interface Props {
  tabs: Tab[]
  activeTabId: string | null
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onTogglePin: (id: string) => void
  onCloseOthers: (id: string) => void
  onCloseRight: (id: string) => void
  onCloseAll: () => void
  onNewNote: () => void
  agentAvailable: boolean
  agentPanelOpen: boolean
  onToggleAgentPanel: () => void
  onOpenSettings: () => void
}

export default function TabBar({
  tabs,
  activeTabId,
  sidebarCollapsed,
  onToggleSidebar,
  onSelect,
  onClose,
  onTogglePin,
  onCloseOthers,
  onCloseRight,
  onCloseAll,
  onNewNote,
  agentAvailable,
  agentPanelOpen,
  onToggleAgentPanel,
  onOpenSettings
}: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const activeIdx = tabs.findIndex((t) => t.id === activeTabId)

  const openTabMenu = (e: React.MouseEvent, tab: Tab): void => {
    e.preventDefault()
    e.stopPropagation()
    const idx = tabs.findIndex((t) => t.id === tab.id)
    const hasRight = tabs.slice(idx + 1).some((t) => !t.pinned)
    const hasOthers = tabs.some((t) => t.id !== tab.id && !t.pinned)
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: tab.pinned ? 'Unpin tab' : 'Pin tab', onClick: () => onTogglePin(tab.id) },
        { separator: true, label: '' },
        { label: 'Close tab', onClick: () => onClose(tab.id) },
        ...(hasOthers
          ? [{ label: 'Close other tabs', onClick: () => onCloseOthers(tab.id) }]
          : []),
        ...(hasRight
          ? [{ label: 'Close tabs to the right', onClick: () => onCloseRight(tab.id) }]
          : []),
        { label: 'Close all tabs', onClick: onCloseAll }
      ]
    })
  }
  // Standard DOM dblclick doesn't fire reliably on -webkit-app-region: drag
  // areas — macOS intercepts mouse handling there for window dragging before
  // it reaches Chromium's normal event dispatch. mousedown still fires
  // (it has to, for the OS to tell a click from a drag start), so detect the
  // double-click ourselves from mousedown timing instead.
  const lastMouseDown = useRef(0)
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement
    if (target.closest('button, .tab')) return
    const now = Date.now()
    if (now - lastMouseDown.current < DOUBLE_CLICK_MS) {
      lastMouseDown.current = 0
      window.api.app.toggleMaximize()
    } else {
      lastMouseDown.current = now
    }
  }

  return (
    <div className="tab-bar" onMouseDown={handleMouseDown}>
      <div className={sidebarCollapsed ? 'titlebar-sidebar collapsed' : 'titlebar-sidebar'}>
        <span className="app-title">{document.title}</span>
        <button
          className="sidebar-toggle-btn"
          onClick={onToggleSidebar}
          title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
        >
          <PanelLeft size={15} />
        </button>
      </div>
      <div className="tab-nav">
        <button
          className="tab-bar-icon-btn"
          disabled={activeIdx <= 0}
          onClick={() => onSelect(tabs[activeIdx - 1].id)}
          title="Previous tab"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          className="tab-bar-icon-btn"
          disabled={activeIdx === -1 || activeIdx >= tabs.length - 1}
          onClick={() => onSelect(tabs[activeIdx + 1].id)}
          title="Next tab"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="tab-strip">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={tab.id === activeTabId ? 'tab active' : 'tab'}
            onClick={() => onSelect(tab.id)}
            onContextMenu={(e) => openTabMenu(e, tab)}
          >
            {tab.pinned && <Pin size={11} className="tab-pin-icon" />}
            <span className="tab-title">{tab.title || 'Untitled'}</span>
            {!tab.pinned && (
              <button
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(tab.id)
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>
        ))}
        <button className="tab-new" onClick={onNewNote} title="New note">
          <Plus size={15} />
        </button>
      </div>
      <div className="tab-bar-actions">
        {agentAvailable && (
          <button
            className={agentPanelOpen ? 'tab-bar-icon-btn active' : 'tab-bar-icon-btn'}
            onClick={onToggleAgentPanel}
            title={agentPanelOpen ? 'Hide agent panel' : 'Show agent panel'}
          >
            <Sparkles size={15} />
          </button>
        )}
        <ShortcutsHelp />
        <button className="tab-bar-icon-btn" onClick={onOpenSettings} title="Settings">
          <Settings size={16} />
        </button>
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
