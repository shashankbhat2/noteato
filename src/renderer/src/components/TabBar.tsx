import { PanelLeft, Plus, Settings, X } from 'lucide-react'
import type { Tab } from '../tabs'

interface Props {
  tabs: Tab[]
  activeTabId: string | null
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNewNote: () => void
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
  onOpenSettings
}: Props) {
  return (
    <div className="tab-bar">
      <div className="tab-bar-drag-spacer">
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
            <span className="tab-title">
              {tab.kind === 'settings' ? 'Settings' : tab.title || 'Untitled'}
            </span>
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
        <button className="tab-bar-icon-btn" onClick={onOpenSettings} title="Settings">
          <Settings size={16} />
        </button>
      </div>
    </div>
  )
}
