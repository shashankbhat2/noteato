import { useEffect, useRef, useState } from 'react'
import { Keyboard } from 'lucide-react'

const SHORTCUTS: [string, string][] = [
  ['⌘T', 'New note'],
  ['⌘K', 'Search notes'],
  ['⌘⇧N', 'New sticky note'],
  ['⌘O', 'Import markdown'],
  ['⌘W', 'Close tab'],
  ['⌘\\', 'Toggle sidebar'],
  ['⌘.', 'Toggle zen mode'],
  ['⌘,', 'Settings'],
  ['↵', 'In title: jump to note body']
]

export default function ShortcutsHelp() {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div className="shortcuts-help" ref={containerRef}>
      {open && (
        <div className="shortcuts-popup">
          <h3>Shortcuts</h3>
          <ul>
            {SHORTCUTS.map(([key, label]) => (
              <li key={label}>
                <span>{label}</span>
                <kbd>{key}</kbd>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button
        className="shortcuts-toggle-btn"
        onClick={() => setOpen((v) => !v)}
        title="Keyboard shortcuts"
      >
        <Keyboard size={16} />
      </button>
    </div>
  )
}
