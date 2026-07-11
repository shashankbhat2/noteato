import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem {
  label: string
  onClick?: () => void
  danger?: boolean
  separator?: boolean
  submenu?: MenuItem[]
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [openSub, setOpenSub] = useState<number | null>(null)

  // Keep the menu inside the viewport.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    let nx = x
    let ny = y
    if (x + rect.width > window.innerWidth - 8) nx = window.innerWidth - rect.width - 8
    if (y + rect.height > window.innerHeight - 8) ny = window.innerHeight - rect.height - 8
    setPos({ x: Math.max(8, nx), y: Math.max(8, ny) })
  }, [x, y])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const renderItems = (list: MenuItem[]): React.ReactNode =>
    list.map((item, i) => {
      if (item.separator) return <div key={i} className="context-menu-sep" />
      return (
        <div
          key={i}
          className={item.danger ? 'context-menu-item danger' : 'context-menu-item'}
          onMouseEnter={() => setOpenSub(item.submenu ? i : null)}
          onClick={() => {
            if (item.submenu) return
            item.onClick?.()
            onClose()
          }}
        >
          <span>{item.label}</span>
          {item.submenu && <span className="context-menu-caret">›</span>}
          {item.submenu && openSub === i && (
            <div className="context-menu context-submenu">{renderItems(item.submenu)}</div>
          )}
        </div>
      )
    })

  return (
    <div className="context-menu" ref={ref} style={{ left: pos.x, top: pos.y }}>
      {renderItems(items)}
    </div>
  )
}
