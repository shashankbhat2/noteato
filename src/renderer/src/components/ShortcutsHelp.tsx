import { useEffect, useRef } from 'react'
import { SIDEBAR_MODE_ACCELERATOR, shortcutDisplay } from '../../../shared/globalShortcuts'

const APP_SHORTCUTS: [string, string][] = [
  ['⌘N', 'New note'],
  ['⌘K', 'Search notes'],
  ['⌘⇧F', 'Find in note'],
  ['⌘⇧O', 'Toggle outline'],
  ['⌘/', 'Toggle sidebar'],
  ['⌘O', 'Open markdown'],
  ['⌘W', 'Close pane'],
  ['⌘,', 'Settings'],
  ['↵', 'In title: jump to note body']
]

/**
 * A controlled sheet rather than a button with its own popup: the shortcut
 * reference is reached from the sidebar's utility menu now, so the trigger and
 * the panel no longer live together.
 */
export default function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const platform = window.electron.process.platform
  const shortcuts: [string, string][] = [
    [shortcutDisplay(SIDEBAR_MODE_ACCELERATOR, platform), 'Sidebar notes (global)'],
    ...APP_SHORTCUTS
  ]

  useEffect(() => {
    const handleClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  return (
    <div className="shortcuts-sheet" ref={ref}>
      <h3>Keyboard shortcuts</h3>
      <ul>
        {shortcuts.map(([key, label]) => (
          <li key={label}>
            <span>{label}</span>
            <kbd>{key}</kbd>
          </li>
        ))}
      </ul>
    </div>
  )
}
