import { useRef } from 'react'
import {
  IconLayoutSidebar as PanelLeft,
  IconPlus as Plus,
  IconSearch as Search
} from '@tabler/icons-react'
import ShortcutsHelp from './ShortcutsHelp'

const DOUBLE_CLICK_MS = 400

interface Props {
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  onSearch: () => void
  onNewNote: () => void
}

/**
 * The window's drag region, and the three actions that aren't about any one
 * note: show/hide the sidebar, search, and start a new note. They sit together
 * here rather than in the sidebar so they stay reachable when it's collapsed.
 */
export default function TitleBar({
  sidebarCollapsed,
  onToggleSidebar,
  onSearch,
  onNewNote
}: Props) {
  const isMac = window.electron.process.platform === 'darwin'

  // Standard DOM dblclick doesn't fire reliably on -webkit-app-region: drag
  // areas — macOS intercepts mouse handling there for window dragging before
  // it reaches Chromium's normal event dispatch. mousedown still fires
  // (it has to, for the OS to tell a click from a drag start), so detect the
  // double-click ourselves from mousedown timing instead.
  const lastMouseDown = useRef(0)
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    if ((e.target as HTMLElement).closest('button')) return
    const now = Date.now()
    if (now - lastMouseDown.current < DOUBLE_CLICK_MS) {
      lastMouseDown.current = 0
      window.api.app.toggleMaximize()
    } else {
      lastMouseDown.current = now
    }
  }

  return (
    <div className="title-bar" onMouseDown={handleMouseDown}>
      <div className="title-bar-actions">
        <button
          className="title-bar-btn"
          onClick={onToggleSidebar}
          title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
        >
          <PanelLeft size={16} />
        </button>
        <button
          className="title-bar-btn"
          onClick={onSearch}
          title={`Search notes · ${isMac ? '⌘K' : 'Ctrl+K'}`}
        >
          <Search size={16} />
        </button>
        <button
          className="title-bar-btn"
          onClick={onNewNote}
          title={`New note · ${isMac ? '⌘T' : 'Ctrl+T'}`}
        >
          <Plus size={16} />
        </button>
      </div>

      {/* The shortcut sheet is a reference, not an action on the note — it sits
          at the far end, away from the three things you actually reach for. */}
      <div className="title-bar-trailing">
        <ShortcutsHelp />
      </div>
    </div>
  )
}
