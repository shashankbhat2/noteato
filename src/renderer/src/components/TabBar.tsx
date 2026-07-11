import { useRef } from 'react'
import { PanelLeft, Plus, Settings, Sparkles, X } from 'lucide-react'
import type { Tab } from '../tabs'
import ShortcutsHelp from './ShortcutsHelp'

const DOUBLE_CLICK_MS = 400

interface Props {
  tabs: Tab[]
  activeTabId: string | null
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  onSelect: (id: string) => void
  onClose: (id: string) => void
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
  onNewNote,
  agentAvailable,
  agentPanelOpen,
  onToggleAgentPanel,
  onOpenSettings
}: Props) {
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
      <div className="tab-strip">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={tab.id === activeTabId ? 'tab active' : 'tab'}
            onClick={() => onSelect(tab.id)}
          >
            <span className="tab-title">{tab.title || 'Untitled'}</span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation()
                onClose(tab.id)
              }}
            >
              <X size={13} />
            </button>
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
    </div>
  )
}
