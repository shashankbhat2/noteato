import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { BrowserWindow, screen } from 'electron'
import type { Note } from '../shared/types'
import type { NoteStore } from './storage'

const QUICK_NOTE_WIDTH = 540
const QUICK_NOTE_HEIGHT = 500

/** Owns the centered, one-note capture window opened by the global shortcut. */
export class QuickNoteManager {
  private window: BrowserWindow | null = null
  private closeTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private noteStore: NoteStore,
    private onCreated: (note: Note) => void
  ) {}

  getWindow(): BrowserWindow | null {
    return this.window
  }

  showNew(): void {
    if (this.window && !this.window.isDestroyed()) {
      if (this.window.isVisible()) {
        this.window.focus()
        return
      }
      this.destroy()
    }

    const note = this.noteStore.create('Quick note')
    this.onCreated(note)
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const x = Math.round(display.workArea.x + (display.workArea.width - QUICK_NOTE_WIDTH) / 2)
    const y = Math.round(display.workArea.y + (display.workArea.height - QUICK_NOTE_HEIGHT) / 2)
    const win = new BrowserWindow({
      x,
      y,
      width: QUICK_NOTE_WIDTH,
      height: QUICK_NOTE_HEIGHT,
      minWidth: QUICK_NOTE_WIDTH,
      minHeight: QUICK_NOTE_HEIGHT,
      maxWidth: QUICK_NOTE_WIDTH,
      maxHeight: QUICK_NOTE_HEIGHT,
      frame: false,
      transparent: true,
      show: false,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: true,
      roundedCorners: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false
      }
    })

    this.window = win
    win.setAlwaysOnTop(true, 'floating')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.on('closed', () => {
      if (this.window === win) this.window = null
    })
    win.on('ready-to-show', () => {
      win.show()
      win.focus()
    })

    const query = `quickNote=${encodeURIComponent(note.id)}`
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${query}`)
    } else {
      void win.loadFile(join(__dirname, '../renderer/index.html'), { search: query })
    }
  }

  close(): void {
    const win = this.window
    if (!win || win.isDestroyed()) return
    win.hide()
    if (this.closeTimer) clearTimeout(this.closeTimer)
    // Let the editor's blur-triggered save cross the preload bridge before the
    // renderer is torn down. A later shortcut press destroys this window first.
    this.closeTimer = setTimeout(() => {
      if (!win.isDestroyed()) win.destroy()
      if (this.window === win) this.window = null
    }, 600)
  }

  destroy(): void {
    if (this.closeTimer) clearTimeout(this.closeTimer)
    this.closeTimer = undefined
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = null
  }
}
