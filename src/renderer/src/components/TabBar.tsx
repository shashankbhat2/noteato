import { useRef, useState } from 'react'
import {
  IconChevronDown as ChevronDown,
  IconChevronLeft as ChevronLeft,
  IconChevronRight as ChevronRight,
  IconLayoutSidebar as PanelLeft,
  IconPin as Pin,
  IconPlus as Plus,
  IconX as X
} from '@tabler/icons-react'
import type { Tab } from '../tabs'
import ContextMenu, { type MenuItem } from './ContextMenu'

const DOUBLE_CLICK_MS = 400

const REVEAL_LABEL =
  window.electron.process.platform === 'darwin' ? 'Reveal in Finder' : 'Show in folder'

/** Menu labels quote a note's title, and a title can be a whole sentence. */
function shortTitle(title: string): string {
  const name = title || 'Untitled'
  return name.length > 26 ? `${name.slice(0, 25).trimEnd()}…` : name
}

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
  /* Resolved by note id, not Tab.path — that one can go stale after a rename. */
  onCopyPath: (id: string) => void
  onRevealInFinder: (id: string) => void
  onNewNote: () => void
  /** Dragging a tab onto the editor area opens it in a split — see MainLayout. */
  onTabDragStart: (id: string) => void
  onTabDragEnd: () => void
  /** Dropping a tab inside the strip reorders it. `targetId` null = the end. */
  onMoveTab: (draggedId: string, targetId: string | null, side: 'before' | 'after') => void
  /** The tab each pane is showing, left to right — one entry means no split. */
  paneTabIds: string[]
  onSplit: (id: string, side: 'left' | 'right') => void
  onSeparatePanes: () => void
  onClosePane: (index: number) => void
  onReversePanes: () => void
  onFocusPane: (id: string) => void
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
  onCopyPath,
  onRevealInFinder,
  onNewNote,
  onTabDragStart,
  onTabDragEnd,
  onMoveTab,
  paneTabIds,
  onSplit,
  onSeparatePanes,
  onClosePane,
  onReversePanes,
  onFocusPane
}: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  // Reordering state. The dragged id is tracked locally too because
  // dataTransfer's payload is unreadable during dragover — only on drop.
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{
    id: string | null
    side: 'before' | 'after'
  } | null>(null)
  const activeIdx = tabs.findIndex((t) => t.id === activeTabId)

  const endDrag = (): void => {
    setDraggingId(null)
    setDropTarget(null)
    onTabDragEnd()
  }

  const beginDrag = (e: React.DragEvent, id: string): void => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
    setDraggingId(id)
    onTabDragStart(id)
  }

  // Which half of the hovered element the pointer is on decides whether the
  // dragged tab lands before or after it.
  const sideOf = (e: React.DragEvent<HTMLElement>): 'before' | 'after' => {
    const rect = e.currentTarget.getBoundingClientRect()
    return e.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
  }

  const dragOverTarget = (e: React.DragEvent<HTMLElement>, id: string | null): void => {
    if (!draggingId) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    const side = id === null ? 'after' : sideOf(e)
    setDropTarget((prev) => (prev?.id === id && prev.side === side ? prev : { id, side }))
  }

  const dropOnTarget = (e: React.DragEvent<HTMLElement>, id: string | null): void => {
    e.preventDefault()
    e.stopPropagation()
    const dragged = e.dataTransfer.getData('text/plain') || draggingId
    const side = dropTarget?.id === id ? dropTarget.side : id === null ? 'after' : sideOf(e)
    if (dragged) onMoveTab(dragged, id, side)
    endDrag()
  }

  /** Insertion-line class for a drop target, or '' when it isn't the one. */
  const dropClass = (id: string): string => {
    if (!dropTarget || !draggingId) return ''
    // A drop past the last tab draws its line on that tab's trailing edge,
    // where the tab will actually land — not out at the strip's far end.
    if (dropTarget.id === null) {
      return id === lastStripId && id !== draggingId ? ' drop-after' : ''
    }
    if (dropTarget.id !== id || id === draggingId) return ''
    return dropTarget.side === 'before' ? ' drop-before' : ' drop-after'
  }

  const openTabMenu = (e: React.MouseEvent, tab: Tab): void => {
    e.preventDefault()
    e.stopPropagation()
    const idx = tabs.findIndex((t) => t.id === tab.id)
    const hasRight = tabs.slice(idx + 1).some((t) => !t.pinned)
    const hasOthers = tabs.some((t) => t.id !== tab.id && !t.pinned)
    const inPane = paneTabIds.length > 1 && paneTabIds.includes(tab.id)
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: tab.pinned ? 'Unpin tab' : 'Pin tab', onClick: () => onTogglePin(tab.id) },
        ...(tabs.length > 1
          ? [
              { separator: true, label: '' },
              ...(inPane
                ? [{ label: 'Close split view', onClick: onSeparatePanes }]
                : [
                    { label: 'Split left', onClick: () => onSplit(tab.id, 'left') },
                    { label: 'Split right', onClick: () => onSplit(tab.id, 'right') }
                  ])
            ]
          : []),
        // Home and Trash are views, not files — they have no path to act on.
        ...(tab.path
          ? [
              { separator: true, label: '' },
              { label: 'Copy path', onClick: () => onCopyPath(tab.id) },
              { label: REVEAL_LABEL, onClick: () => onRevealInFinder(tab.id) }
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
      className={
        (tab.id === activeTabId ? 'tab active' : 'tab') +
        (tab.id === draggingId ? ' dragging' : '') +
        dropClass(tab.id)
      }
      draggable
      onDragStart={(e) => beginDrag(e, tab.id)}
      onDragEnd={endDrag}
      onDragOver={(e) => dragOverTarget(e, tab.id)}
      onDrop={(e) => dropOnTarget(e, tab.id)}
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
          <X size={12} />
        </button>
      )}
    </div>
  )

  // The panes collapse into a single tab, ordered to match what's on screen.
  const paneTabs = ((): Tab[] => {
    if (paneTabIds.length < 2) return []
    const found = paneTabIds
      .map((id) => tabs.find((t) => t.id === id))
      .filter((t): t is Tab => t !== undefined)
    return found.length === paneTabIds.length ? found : []
  })()

  // Id of the strip's trailing element — the combined tab when a pane's tab
  // sits last, otherwise the last tab itself.
  const lastStripId = ((): string | null => {
    const last = tabs[tabs.length - 1]
    if (!last) return null
    if (paneTabs.some((t) => t.id === last.id)) return paneTabs[0].id
    return last.id
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
            { label: 'Separate views', onClick: onSeparatePanes },
            { separator: true, label: '' },
            // One entry per pane, named after what it holds, since with three
            // panes "left" and "right" no longer say which one you mean.
            ...paneTabs.map((tab, index) => ({
              label: `Close “${shortTitle(tab.title)}”`,
              onClick: () => onClosePane(index)
            })),
            { separator: true, label: '' },
            { label: 'Reverse views', onClick: onReversePanes }
          ]
        }
      ]
    })
  }

  // The group renders as one tab, so a drop on it lands outside the group. Its
  // members are contiguous in `tabs` but in an order the visual one doesn't
  // necessarily match (the pane order decides that), so resolve the edge
  // against the array rather than against `group`.
  const dropOnSplit = (e: React.DragEvent<HTMLElement>, group: Tab[]): void => {
    e.preventDefault()
    e.stopPropagation()
    const dragged = e.dataTransfer.getData('text/plain') || draggingId
    if (!dragged) {
      endDrag()
      return
    }
    const side = dropTarget?.id === group[0].id ? dropTarget.side : sideOf(e)
    const inGroup = (t: Tab): boolean => group.some((m) => m.id === t.id)
    const edge = side === 'before' ? tabs.find(inGroup) : [...tabs].reverse().find(inGroup)
    if (edge) onMoveTab(dragged, edge.id, side)
    endDrag()
  }

  const renderSplitTab = (group: Tab[]): React.ReactNode => (
    <div
      className={`tab tab-split${dropClass(group[0].id)}`}
      key={`split-${group.map((t) => t.id).join('-')}`}
      onDragOver={(e) => dragOverTarget(e, group[0].id)}
      onDrop={(e) => dropOnSplit(e, group)}
    >
      {group.map((tab, index) => (
        <div key={tab.id} className="tab-split-cell">
          {index > 0 && <span className="tab-split-divider" />}
          <div
            className={tab.id === activeTabId ? 'tab-split-half focused' : 'tab-split-half'}
            title={tab.title || 'Untitled'}
            onClick={() => onFocusPane(tab.id)}
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
              <X size={12} />
            </button>
          </div>
        </div>
      ))}
      <button className="tab-split-menu" title="Arrange split view" onClick={openSplitMenu}>
        <ChevronDown size={12} />
      </button>
    </div>
  )

  const renderStrip = (): React.ReactNode[] => {
    const out: React.ReactNode[] = []
    const consumed = new Set(paneTabs.map((t) => t.id))
    let splitPlaced = false
    for (const tab of tabs) {
      if (consumed.has(tab.id)) {
        // The combined tab takes the position of whichever member comes first.
        if (!splitPlaced) {
          out.push(renderSplitTab(paneTabs))
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
      {/* Dropping past the last tab (on the strip's own padding or the "+"
          button) moves the dragged tab to the end of its group. */}
      <div
        className={draggingId ? 'tab-strip reordering' : 'tab-strip'}
        onDragOver={(e) => dragOverTarget(e, null)}
        onDrop={(e) => dropOnTarget(e, null)}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
          setDropTarget(null)
        }}
      >
        {renderStrip()}
        <button className="tab-new" onClick={onNewNote} title="New note">
          <Plus size={14} />
        </button>
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
