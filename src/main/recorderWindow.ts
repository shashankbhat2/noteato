import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { BrowserWindow, screen } from 'electron'
import type Database from 'better-sqlite3'
import type { MeetingState } from '../shared/types'
import { SqlKvStore } from './db'

/**
 * A narrow vertical column: it parks against a screen edge without covering the
 * app being recorded. Sized to its contents — dot, rotated timer, two buttons —
 * rather than left with slack, since every pixel here sits over someone's work.
 */
const WIDTH = 54
const HEIGHT = 120
/** Clear of the edge so the pill reads as floating rather than half off-screen. */
const EDGE_MARGIN = 16

interface RecorderWindowState {
  /** null until the pill has been dragged; it then opens where it was left. */
  x: number | null
  y: number | null
}

/**
 * The recording indicator: a small pill above everything, on every Space.
 *
 * It is not decoration. Recording starts from the tray or an accelerator while
 * the user is in another app, so without a persistent indicator the only
 * evidence a meeting is being recorded lives in a menu nobody has open. It also
 * carries Stop and Discard, because the fastest route to ending a recording
 * should not be hunting for the menu bar.
 *
 * `focusable: false` plus the macOS panel type is what makes it safe to show
 * over a call: it never takes key focus, so typing in Zoom keeps going to Zoom.
 * Clicks still land on its buttons.
 */
export class RecorderWindow {
  private window: BrowserWindow | null = null
  private stateStore: SqlKvStore<RecorderWindowState>

  constructor(db: Database.Database) {
    this.stateStore = new SqlKvStore<RecorderWindowState>(db, 'recorder-window-state', {
      x: null,
      y: null
    })
  }

  show(state: MeetingState): void {
    const win = this.ensureWindow()
    this.send(state)
    if (!win.isVisible()) {
      // Displays can have changed while it sat hidden between recordings.
      this.handleDisplayChange()
      win.showInactive()
    }
  }

  hide(): void {
    const win = this.window
    if (!win || win.isDestroyed()) return
    win.hide()
  }

  /** Push state so the pill renders the phase and derives its own elapsed time. */
  send(state: MeetingState): void {
    const win = this.window
    if (!win || win.isDestroyed()) return
    win.webContents.send('meeting:state-changed', state)
  }

  /**
   * Levels go only to the pill, at ~10 Hz. Broadcasting them to every window
   * would wake the main renderer ten times a second to animate something it
   * does not show.
   */
  sendLevels(levels: { mic: number; system: number }): void {
    const win = this.window
    if (!win || win.isDestroyed() || !win.isVisible()) return
    win.webContents.send('meeting:levels', levels)
  }

  destroy(): void {
    const win = this.window
    if (!win || win.isDestroyed()) return
    this.window = null
    win.destroy()
  }

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window

    const win = new BrowserWindow({
      ...this.openAt(),
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false
      }
    })

    this.window = win
    // Above fullscreen apps and on every Space: a call is usually one or both.
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    screen.on('display-removed', this.handleDisplayChange)
    screen.on('display-added', this.handleDisplayChange)
    screen.on('display-metrics-changed', this.handleDisplayChange)

    win.on('closed', () => {
      screen.removeListener('display-removed', this.handleDisplayChange)
      screen.removeListener('display-added', this.handleDisplayChange)
      screen.removeListener('display-metrics-changed', this.handleDisplayChange)
      if (this.window === win) this.window = null
    })
    win.on('moved', () => {
      if (win.isDestroyed()) return
      const [x, y] = win.getPosition()
      this.stateStore.write({ x, y })
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?recorder=1`)
    } else {
      void win.loadFile(join(__dirname, '../renderer/index.html'), { search: 'recorder=1' })
    }

    return win
  }

  /**
   * Where to open: wherever it was last dragged, or against the left edge of
   * the screen the pointer is on — which is the screen the user is working on,
   * and on a multi-monitor desk is rarely the primary one.
   */
  private openAt(): { x: number; y: number } {
    const saved = this.stateStore.read()
    if (saved.x !== null && saved.y !== null) return this.clamp(saved.x, saved.y)

    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    return {
      x: workArea.x + EDGE_MARGIN,
      y: Math.round(workArea.y + (workArea.height - HEIGHT) / 2)
    }
  }

  /**
   * Pull a position back onto a display that actually exists.
   *
   * `getDisplayNearestPoint` answers for the closest display even when the
   * point is far outside every one of them, which is exactly the case after a
   * monitor is unplugged — so clamping to that display's work area is what
   * rescues a pill stranded in coordinates nobody can reach.
   */
  private clamp(x: number, y: number): { x: number; y: number } {
    const { workArea } = screen.getDisplayNearestPoint({ x, y })
    return {
      x: Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - WIDTH),
      y: Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - HEIGHT)
    }
  }

  /**
   * Displays changed under a live pill — unplugged, rearranged, or resolution
   * switched. Without this the pill can be left addressing coordinates that no
   * longer belong to any screen, i.e. invisible mid-recording.
   */
  private handleDisplayChange = (): void => {
    const win = this.window
    if (!win || win.isDestroyed()) return
    const [x, y] = win.getPosition()
    const next = this.clamp(x, y)
    if (next.x === x && next.y === y) return
    win.setPosition(next.x, next.y)
    this.stateStore.write(next)
  }
}
