import { randomUUID } from 'crypto'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { BrowserWindow, screen } from 'electron'
import type Database from 'better-sqlite3'
import type { StickyNoteData } from '../shared/types'

const COLORS = ['#eee3c8', '#e8d4c9', '#d8e0d0', '#d3dde2', '#e0d8e2']

export class StickyManager {
  private windows = new Map<string, BrowserWindow>()

  constructor(private db: Database.Database) {}

  openAll(): void {
    for (const note of this.list()) {
      this.openWindow(note)
    }
  }

  list(): StickyNoteData[] {
    return this.db.prepare('SELECT * FROM stickies').all() as StickyNoteData[]
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
    this.db
      .prepare(
        'INSERT INTO stickies (id, x, y, width, height, content, color) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(note.id, note.x, note.y, note.width, note.height, note.content, note.color)
    this.openWindow(note)
    return note
  }

  update(id: string, patch: Partial<StickyNoteData>): void {
    const existing = this.db.prepare('SELECT * FROM stickies WHERE id = ?').get(id) as
      | StickyNoteData
      | undefined
    if (!existing) return
    const next = { ...existing, ...patch }
    this.db
      .prepare(
        'UPDATE stickies SET x = ?, y = ?, width = ?, height = ?, content = ?, color = ? WHERE id = ?'
      )
      .run(next.x, next.y, next.width, next.height, next.content, next.color, id)
  }

  close(id: string): void {
    this.db.prepare('DELETE FROM stickies WHERE id = ?').run(id)
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
