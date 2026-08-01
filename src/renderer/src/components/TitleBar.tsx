import { useRef } from 'react'
import { IconLayoutSidebar as PanelLeft, IconSettings as Settings } from '@tabler/icons-react'

const DOUBLE_CLICK_MS = 400

interface Props {
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  onOpenSettings: () => void
}

/**
 * The sidebar's window drag region. Global controls stay beside the traffic
 * lights while anything that acts on a note remains in that note's own header.
 */
export default function TitleBar({
  sidebarCollapsed,
  onToggleSidebar,
  onOpenSettings
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
    <div
      className={sidebarCollapsed ? 'title-bar collapsed' : 'title-bar'}
      onMouseDown={handleMouseDown}
    >
      <div className="title-bar-actions">
        <button
          className="title-bar-btn"
          onClick={onOpenSettings}
          title={`Settings · ${isMac ? '⌘,' : 'Ctrl+,'}`}
        >
          <Settings size={16} />
        </button>
        <button
          className="title-bar-btn"
          onClick={onToggleSidebar}
          title={`${sidebarCollapsed ? 'Show' : 'Hide'} sidebar · ${isMac ? '⌘\\' : 'Ctrl+\\'}`}
        >
          <PanelLeft size={16} />
        </button>
      </div>
    </div>
  )
}
