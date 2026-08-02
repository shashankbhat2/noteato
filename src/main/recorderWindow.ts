import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { BrowserWindow, screen } from 'electron'
import type { MeetingState } from '../shared/types'

const WIDTH = 268
const HEIGHT = 56
/** Clear of the Dock without floating oddly high on a screen with none. */
const BOTTOM_MARGIN = 96

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

  show(state: MeetingState): void {
    const win = this.ensureWindow()
    this.send(state)
    if (!win.isVisible()) win.showInactive()
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

  destroy(): void {
    const win = this.window
    if (!win || win.isDestroyed()) return
    this.window = null
    win.destroy()
  }

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window

    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const win = new BrowserWindow({
      x: Math.round(workArea.x + (workArea.width - WIDTH) / 2),
      y: workArea.y + workArea.height - HEIGHT - BOTTOM_MARGIN,
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false,
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
    win.on('closed', () => {
      if (this.window === win) this.window = null
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?recorder=1`)
    } else {
      void win.loadFile(join(__dirname, '../renderer/index.html'), { search: 'recorder=1' })
    }

    return win
  }
}
