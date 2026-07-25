import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import { SqlKvStore } from './db'

export interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized: boolean
}

const DEFAULTS: WindowState = { width: 1100, height: 720, isMaximized: false }

export function createWindowStateStore(db: Database.Database): SqlKvStore<WindowState> {
  return new SqlKvStore<WindowState>(db, 'window-state', DEFAULTS)
}

/** Persists bounds while restored, and just the maximized flag while maximized,
 * so the "restore" size isn't clobbered by the full-screen bounds. */
export function trackWindowState(win: BrowserWindow, store: SqlKvStore<WindowState>): void {
  let saveTimer: ReturnType<typeof setTimeout> | undefined

  const saveBounds = (): void => {
    if (win.isDestroyed() || win.isMaximized()) return
    const { width, height, x, y } = win.getBounds()
    store.write({ ...store.read(), width, height, x, y, isMaximized: false })
  }

  const scheduleSaveBounds = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(saveBounds, 400)
  }

  win.on('resize', scheduleSaveBounds)
  win.on('move', scheduleSaveBounds)
  win.on('maximize', () => store.write({ ...store.read(), isMaximized: true }))
  win.on('unmaximize', saveBounds)
  win.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer)
    if (!win.isMaximized()) saveBounds()
  })
}
