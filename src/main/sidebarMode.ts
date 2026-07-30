import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { BrowserWindow, nativeTheme, screen, systemPreferences } from 'electron'
import type Database from 'better-sqlite3'
import type { Settings, SidebarModeState } from '../shared/types'
import { SqlKvStore } from './db'

interface SidebarWindowState {
  width: number
}

const MIN_WIDTH = 340
const MAX_WIDTH = 460
const DEFAULT_WIDTH = 392
const LIGHT_BG = '#ededed'
const DARK_BG = '#1a1a1a'

// --- Reveal/dismiss motion ---------------------------------------------------
// The panel slides in from its edge as it fades up. A short slide rather than
// the full width: moving a whole window that far every time reads as sluggish
// and costs a compositor pass per frame, where 26px is enough to say "this came
// from the edge".
const SLIDE_PX = 26
const ENTER_MS = 170
const EXIT_MS = 130
const FRAME_MS = 16

/**
 * Blur within this long of showing is ignored. The reveal focuses the window,
 * and the focus change itself can bounce a blur back before the panel has
 * settled — without this, a hover reveal could dismiss itself on sight.
 */
const BLUR_GRACE_MS = 300

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

/** Respect the OS setting — a window that flies in is exactly what it turns off. */
function reducedMotion(): boolean {
  try {
    return systemPreferences.getAnimationSettings().prefersReducedMotion
  } catch {
    return false
  }
}

/**
 * Owns the compact edge window. Note content deliberately remains in NoteStore;
 * this store only remembers a presentation preference that does not belong in
 * user-facing Markdown.
 */
export class SidebarModeManager {
  private window: BrowserWindow | null = null
  private destroying = false
  private stateStore: SqlKvStore<SidebarWindowState>
  private animation: ReturnType<typeof setInterval> | null = null
  private shownAt = 0

  constructor(
    db: Database.Database,
    private getSettings: () => Settings
  ) {
    this.stateStore = new SqlKvStore<SidebarWindowState>(db, 'sidebar-window-state', {
      width: DEFAULT_WIDTH
    })
  }

  getWindow(): BrowserWindow | null {
    return this.window
  }

  getState(): SidebarModeState {
    const settings = this.getSettings()
    return {
      enabled: settings.sidebarModeEnabled,
      pinned: settings.sidebarPinned,
      visible: this.isVisible()
    }
  }

  isVisible(): boolean {
    return Boolean(this.window && !this.window.isDestroyed() && this.window.isVisible())
  }

  /** Re-dock after the edge preference changed. No-op if the window isn't up. */
  applyEdge(): void {
    if (!this.window || this.window.isDestroyed()) return
    this.snapToEdge(this.window)
  }

  setEnabled(enabled: boolean): void {
    if (enabled) this.show()
    else this.destroy()
  }

  show(): void {
    if (!this.getSettings().sidebarModeEnabled) return
    const win = this.ensureWindow()
    this.stopAnimation()
    this.snapToEdge(win)
    this.applyPinned(win, this.getSettings().sidebarPinned)

    this.shownAt = Date.now()
    if (reducedMotion()) {
      win.setOpacity(1)
      win.show()
      win.focus()
      return
    }

    const docked = win.getBounds()
    const inward = this.getSettings().sidebarEdge === 'left' ? -SLIDE_PX : SLIDE_PX
    win.setOpacity(0)
    win.setBounds({ ...docked, x: docked.x + inward })
    win.show()
    win.focus()

    this.animate(ENTER_MS, (t) => {
      win.setOpacity(t)
      win.setBounds({ ...docked, x: Math.round(docked.x + inward * (1 - t)) })
    })
  }

  toggle(): void {
    if (this.isVisible()) this.hide()
    else this.show()
  }

  hide(): void {
    const win = this.window
    if (!win || win.isDestroyed() || !win.isVisible()) return
    this.stopAnimation()
    if (reducedMotion()) {
      win.hide()
      return
    }

    const docked = win.getBounds()
    const outward = this.getSettings().sidebarEdge === 'left' ? -SLIDE_PX : SLIDE_PX

    this.animate(
      EXIT_MS,
      (t) => {
        win.setOpacity(1 - t)
        win.setBounds({ ...docked, x: Math.round(docked.x + outward * t) })
      },
      () => {
        win.hide()
        // Reset for the next reveal — a hidden window left at 0 opacity would
        // come back invisible if anything ever showed it without animating.
        win.setOpacity(1)
        win.setBounds(docked)
      }
    )
  }

  /**
   * Run `step` from 0→1 over `ms`, then `done`. Only one animation is ever in
   * flight; starting another cancels the first mid-way, which is what makes
   * rapid toggling land somewhere sane instead of queueing up.
   */
  private animate(ms: number, step: (t: number) => void, done?: () => void): void {
    const started = Date.now()
    this.animation = setInterval(() => {
      const win = this.window
      if (!win || win.isDestroyed()) {
        this.stopAnimation()
        return
      }
      const t = Math.min(1, (Date.now() - started) / ms)
      step(easeOutCubic(t))
      if (t >= 1) {
        this.stopAnimation()
        done?.()
      }
    }, FRAME_MS)
  }

  private stopAnimation(): void {
    if (this.animation) clearInterval(this.animation)
    this.animation = null
  }

  setPinned(pinned: boolean): void {
    if (!this.window || this.window.isDestroyed()) return
    this.applyPinned(this.window, pinned)
    this.window.webContents.send('sidebar:state-changed', this.getState())
  }

  destroy(): void {
    this.stopAnimation()
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
      x: this.edgeX(display.workArea, width),
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
      // A non-activating macOS panel: opening the sidebar never activates
      // Noteato, so closing it hands focus straight back to whatever app was
      // active — instead of surfacing the main window.
      ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
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

    // Clicking or focusing anything outside puts the panel away, which is what
    // makes hover-reveal a peek rather than a window you have to keep tidying
    // up after. Guarded so the reveal's own focus change can't dismiss it, and
    // so the exit animation's own bookkeeping doesn't re-enter this.
    win.on('blur', () => {
      if (win.isDestroyed() || !win.isVisible()) return
      if (this.animation || Date.now() - this.shownAt < BLUR_GRACE_MS) return
      this.hide()
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?sidebar=1`)
    } else {
      void win.loadFile(join(__dirname, '../renderer/index.html'), { search: 'sidebar=1' })
    }

    return win
  }

  /**
   * The panel always floats above other apps — that is the whole point of a
   * dockable side panel, and a hover reveal that opened *behind* the window you
   * were looking at would be useless. `pinned` therefore only decides whether
   * it follows you across Spaces and over fullscreen apps.
   */
  private applyPinned(win: BrowserWindow, pinned: boolean): void {
    win.setAlwaysOnTop(true, 'floating')
    win.setVisibleOnAllWorkspaces(pinned, { visibleOnFullScreen: true })
  }

  /** Left edge of the panel for the configured screen edge. */
  private edgeX(workArea: Electron.Rectangle, width: number): number {
    return this.getSettings().sidebarEdge === 'left'
      ? workArea.x
      : workArea.x + workArea.width - width
  }

  private snapToEdge(win: BrowserWindow): void {
    const display = screen.getDisplayNearestPoint({
      x: win.getBounds().x + Math.floor(win.getBounds().width / 2),
      y: win.getBounds().y + Math.floor(win.getBounds().height / 2)
    })
    const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, win.getBounds().width))
    win.setBounds({
      x: this.edgeX(display.workArea, width),
      y: display.workArea.y,
      width,
      height: display.workArea.height
    })
  }
}
