import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { app, BrowserWindow, nativeTheme, screen } from 'electron'
import type { Settings, SidebarModeState } from '../shared/types'
import { JsonStore } from './jsonStore'

interface SidebarWindowState {
  width: number
}

const MIN_WIDTH = 340
const MAX_WIDTH = 460
const DEFAULT_WIDTH = 392
const LIGHT_BG = '#f7f5f1'
const DARK_BG = '#1b191d'

/**
 * Owns the compact edge window. Note content deliberately remains in NoteStore;
 * this store only remembers a presentation preference that does not belong in
 * user-facing Markdown.
 */
export class SidebarModeManager {
  private window: BrowserWindow | null = null
  private destroying = false
  private stateStore = new JsonStore<SidebarWindowState>(
    join(app.getPath('userData'), 'sidebar-window-state.json'),
    { width: DEFAULT_WIDTH }
  )

  constructor(private getSettings: () => Settings) {}

  getWindow(): BrowserWindow | null {
    return this.window
  }

  getState(): SidebarModeState {
    const settings = this.getSettings()
    return {
      enabled: settings.sidebarModeEnabled,
      pinned: settings.sidebarPinned,
      visible: Boolean(this.window && !this.window.isDestroyed() && this.window.isVisible())
    }
  }

  setEnabled(enabled: boolean): void {
    if (enabled) this.show()
    else this.destroy()
  }

  show(): void {
    if (!this.getSettings().sidebarModeEnabled) return
    const win = this.ensureWindow()
    this.snapToEdge(win)
    this.applyPinned(win, this.getSettings().sidebarPinned)
    win.show()
    win.focus()
  }

  toggle(): void {
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) this.hide()
    else this.show()
  }

  hide(): void {
    if (this.window && !this.window.isDestroyed()) this.window.hide()
  }

  setPinned(pinned: boolean): void {
    if (!this.window || this.window.isDestroyed()) return
    this.applyPinned(this.window, pinned)
    this.window.webContents.send('sidebar:state-changed', this.getState())
  }

  destroy(): void {
    const win = this.window
    if (!win || win.isDestroyed()) return
    this.destroying = true
    win.destroy()
    this.destroying = false
    this.window = null
  }

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window

    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, this.stateStore.read().width))
    const win = new BrowserWindow({
      x: display.workArea.x + display.workArea.width - width,
      y: display.workArea.y,
      width,
      height: display.workArea.height,
      minWidth: MIN_WIDTH,
      maxWidth: MAX_WIDTH,
      minHeight: 360,
      frame: false,
      show: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      resizable: true,
      skipTaskbar: true,
      hasShadow: true,
      backgroundColor: nativeTheme.shouldUseDarkColors ? DARK_BG : LIGHT_BG,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false
      }
    })

    this.window = win
    this.applyPinned(win, this.getSettings().sidebarPinned)

    win.on('close', (event) => {
      if (this.destroying) return
      event.preventDefault()
      win.hide()
    })
    win.on('closed', () => {
      if (this.window === win) this.window = null
    })
    win.on('resize', () => {
      if (win.isDestroyed()) return
      const [nextWidth] = win.getSize()
      this.stateStore.write({ width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, nextWidth)) })
    })
    win.on('show', () => win.webContents.send('sidebar:state-changed', this.getState()))
    win.on('hide', () => win.webContents.send('sidebar:state-changed', this.getState()))

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?sidebar=1`)
    } else {
      void win.loadFile(join(__dirname, '../renderer/index.html'), { search: 'sidebar=1' })
    }

    return win
  }

  private applyPinned(win: BrowserWindow, pinned: boolean): void {
    win.setAlwaysOnTop(pinned, 'floating')
    win.setVisibleOnAllWorkspaces(pinned, { visibleOnFullScreen: true })
  }

  private snapToEdge(win: BrowserWindow): void {
    const display = screen.getDisplayNearestPoint({
      x: win.getBounds().x + Math.floor(win.getBounds().width / 2),
      y: win.getBounds().y + Math.floor(win.getBounds().height / 2)
    })
    const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, win.getBounds().width))
    win.setBounds({
      x: display.workArea.x + display.workArea.width - width,
      y: display.workArea.y,
      width,
      height: display.workArea.height
    })
  }
}
