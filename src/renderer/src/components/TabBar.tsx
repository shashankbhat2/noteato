import { useRef, useState } from 'react'
import {
  IconChevronDown as ChevronDown,
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
  /** Dragging a tab onto the editor area opens it in a split — see MainLayout. */
  onTabDragStart: (id: string) => void
  onTabDragEnd: () => void
  splitTabId: string | null
  splitSide: 'left' | 'right'
  onSplit: (id: string, side: 'left' | 'right') => void
  onCloseSplit: () => void
  onCloseSplitView: (side: 'left' | 'right') => void
  onReverseSplit: () => void
  onFocusSplitHalf: (id: string) => void
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
  onTabDragStart,
  onTabDragEnd,
  splitTabId,
  splitSide,
  onSplit,
  onCloseSplit,
  onCloseSplitView,
  onReverseSplit,
  onFocusSplitHalf,
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
    const isSplit = splitTabId === tab.id
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: tab.pinned ? 'Unpin tab' : 'Pin tab', onClick: () => onTogglePin(tab.id) },
        ...(tabs.length > 1
          ? [
              { separator: true, label: '' },
              ...(isSplit
                ? [{ label: 'Close split view', onClick: onCloseSplit }]
                : [
                    { label: 'Split left', onClick: () => onSplit(tab.id, 'left') },
                    { label: 'Split right', onClick: () => onSplit(tab.id, 'right') }
                  ])
            ]
          : []),
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

  const renderTab = (tab: Tab): React.ReactNode => (
    <div
      key={tab.id}
      className={tab.id === activeTabId ? 'tab active' : 'tab'}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', tab.id)
        onTabDragStart(tab.id)
      }}
      onDragEnd={onTabDragEnd}
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
  )

  // A split collapses its two notes into a single tab, ordered to match the
  // panes on screen.
  const splitPair = ((): [Tab, Tab] | null => {
    if (!splitTabId) return null
    const split = tabs.find((t) => t.id === splitTabId)
    const primary = tabs.find((t) => t.id === activeTabId)
    if (!split || !primary || split.id === primary.id) return null
    return splitSide === 'left' ? [split, primary] : [primary, split]
  })()

  const openSplitMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: 'Arrange Split View',
          submenu: [
            { label: 'Separate views', onClick: onCloseSplit },
            { separator: true, label: '' },
            { label: 'Close left view', onClick: () => onCloseSplitView('left') },
            { label: 'Close right view', onClick: () => onCloseSplitView('right') },
            { separator: true, label: '' },
            { label: 'Reverse views', onClick: onReverseSplit }
          ]
        }
      ]
    })
  }

  const renderSplitTab = (pair: [Tab, Tab]): React.ReactNode => (
    <div className="tab tab-split" key={`split-${pair[0].id}-${pair[1].id}`}>
      {pair.map((tab, index) => (
        <div key={tab.id} className="tab-split-cell">
          {index > 0 && <span className="tab-split-divider" />}
          <div
            className={tab.id === activeTabId ? 'tab-split-half focused' : 'tab-split-half'}
            title={tab.title || 'Untitled'}
            onClick={() => onFocusSplitHalf(tab.id)}
            onContextMenu={openSplitMenu}
          >
            <span className="tab-title">{tab.title || 'Untitled'}</span>
            <button
              className="tab-close"
              title="Close"
              onClick={(e) => {
                e.stopPropagation()
                onClose(tab.id)
              }}
            >
              <X size={13} />
            </button>
          </div>
        </div>
      ))}
      <button className="tab-split-menu" title="Arrange split view" onClick={openSplitMenu}>
        <ChevronDown size={13} />
      </button>
    </div>
  )

  const renderStrip = (): React.ReactNode[] => {
    const out: React.ReactNode[] = []
    const consumed = new Set(splitPair ? [splitPair[0].id, splitPair[1].id] : [])
    let splitPlaced = false
    for (const tab of tabs) {
      if (consumed.has(tab.id)) {
        // The combined tab takes the position of whichever half comes first.
        if (!splitPlaced && splitPair) {
          out.push(renderSplitTab(splitPair))
          splitPlaced = true
        }
        continue
      }
      out.push(renderTab(tab))
    }
    return out
  }

  return (
    <div className="tab-bar" onMouseDown={handleMouseDown}>
      {/* Spans the sidebar's column: the toggle sits by the traffic lights and
          the tab nav is pushed to the sidebar's trailing edge, so the tab strip
          can start flush with the note card below it. */}
      <div className={sidebarCollapsed ? 'titlebar-sidebar collapsed' : 'titlebar-sidebar'}>
        <button
          className="sidebar-toggle-btn"
          onClick={onToggleSidebar}
          title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
        >
          <PanelLeft size={15} />
        </button>
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
      </div>
      <div className="tab-strip">
        {renderStrip()}
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
