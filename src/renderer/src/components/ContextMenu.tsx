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

interface Point {
  x: number
  y: number
}

// Safe triangle: while the pointer travels from where it left the submenu's
// parent row (apex) toward the submenu, it sweeps the triangle formed by the
// apex and the submenu's two near corners — hovering sibling rows on the way
// must not switch (and close) the submenu.
function inSafeTriangle(p: Point, apex: Point, submenu: DOMRect): boolean {
  // Near edge is the one facing the apex.
  const nearX = apex.x <= submenu.left ? submenu.left : submenu.right
  const a = apex
  const b = { x: nearX, y: submenu.top }
  const c = { x: nearX, y: submenu.bottom }
  const sign = (p1: Point, p2: Point, p3: Point): number =>
    (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y)
  const d1 = sign(p, a, b)
  const d2 = sign(p, b, c)
  const d3 = sign(p, c, a)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const submenuRef = useRef<HTMLDivElement | null>(null)
  // Pointer position while inside the row that owns the open submenu.
  const apexRef = useRef<Point | null>(null)
  const switchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
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

  useEffect(() => {
    return () => {
      if (switchTimer.current) clearTimeout(switchTimer.current)
    }
  }, [])

  const clearSwitchTimer = (): void => {
    if (switchTimer.current) {
      clearTimeout(switchTimer.current)
      switchTimer.current = undefined
    }
  }

  const hoverItem = (index: number, hasSubmenu: boolean, e: React.MouseEvent): void => {
    clearSwitchTimer()
    if (openSub === index) return
    const next = hasSubmenu ? index : null
    if (openSub !== null && submenuRef.current && apexRef.current) {
      const cursor = { x: e.clientX, y: e.clientY }
      if (inSafeTriangle(cursor, apexRef.current, submenuRef.current.getBoundingClientRect())) {
        // Heading toward the open submenu — hold the switch; entering the
        // submenu cancels it, stalling on this row commits it.
        switchTimer.current = setTimeout(() => setOpenSub(next), 350)
        return
      }
    }
    setOpenSub(next)
  }

  const renderItems = (list: MenuItem[], depth = 0): React.ReactNode =>
    list.map((item, i) => {
      if (item.separator) return <div key={i} className="context-menu-sep" />
      const isSubmenuParent = depth === 0 && Boolean(item.submenu)
      return (
        <div
          key={i}
          className={item.danger ? 'context-menu-item danger' : 'context-menu-item'}
          onMouseEnter={(e) => {
            if (depth === 0) hoverItem(i, Boolean(item.submenu), e)
          }}
          onMouseMove={(e) => {
            if (isSubmenuParent && openSub === i) {
              apexRef.current = { x: e.clientX, y: e.clientY }
            }
          }}
          onClick={() => {
            if (item.submenu) return
            item.onClick?.()
            onClose()
          }}
        >
          <span>{item.label}</span>
          {item.submenu && <span className="context-menu-caret">›</span>}
          {item.submenu && openSub === i && (
            <div
              className="context-menu context-submenu"
              ref={submenuRef}
              onMouseEnter={clearSwitchTimer}
            >
              {renderItems(item.submenu, depth + 1)}
            </div>
          )}
        </div>
      )
    })

  return (
    <div
      className="context-menu"
      ref={ref}
      style={{ left: pos.x, top: pos.y }}
      // Keep focus (and any text selection) where it was — cut/copy/paste and
      // spelling actions in the editor menu act on the focused editable.
      onMouseDown={(e) => e.preventDefault()}
    >
      {renderItems(items)}
    </div>
  )
}
