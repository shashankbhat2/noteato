import { randomUUID } from 'crypto'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { app, BrowserWindow, screen } from 'electron'
import type { StickyNoteData } from '../shared/types'
import { JsonStore } from './jsonStore'

const COLORS = ['#eee3c8', '#e8d4c9', '#d8e0d0', '#d3dde2', '#e0d8e2']

export class StickyManager {
  private store: JsonStore<{ notes: StickyNoteData[] }>
  private windows = new Map<string, BrowserWindow>()

  constructor() {
    this.store = new JsonStore(join(app.getPath('userData'), 'stickies.json'), { notes: [] })
  }

  openAll(): void {
    for (const note of this.store.read().notes) {
      this.openWindow(note)
    }
  }

  list(): StickyNoteData[] {
    return this.store.read().notes
  }

  create(): StickyNoteData {
    const cursor = screen.getCursorScreenPoint()
    const note: StickyNoteData = {
      id: randomUUID(),
      x: cursor.x,
      y: cursor.y,
      width: 260,
      height: 260,
      content: '',
      color: COLORS[Math.floor(Math.random() * COLORS.length)]
    }
    const data = this.store.read()
    data.notes.push(note)
    this.store.write(data)
    this.openWindow(note)
    return note
  }

  update(id: string, patch: Partial<StickyNoteData>): void {
    const data = this.store.read()
    const idx = data.notes.findIndex((n) => n.id === id)
    if (idx === -1) return
    data.notes[idx] = { ...data.notes[idx], ...patch }
    this.store.write(data)
  }

  close(id: string): void {
    const data = this.store.read()
    data.notes = data.notes.filter((n) => n.id !== id)
    this.store.write(data)
    this.windows.get(id)?.close()
    this.windows.delete(id)
  }

  private openWindow(note: StickyNoteData): void {
    const win = new BrowserWindow({
      x: note.x,
      y: note.y,
      width: note.width,
      height: note.height,
      frame: false,
      resizable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      backgroundColor: note.color,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false
      }
    })

    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    const move = (): void => {
      const [x, y] = win.getPosition()
      const [width, height] = win.getSize()
      this.update(note.id, { x, y, width, height })
    }
    win.on('moved', move)
    win.on('resized', move)
    win.on('closed', () => this.windows.delete(note.id))

    const query = `sticky=${note.id}`
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${query}`)
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'), { search: query })
    }

    this.windows.set(note.id, win)
  }
}
