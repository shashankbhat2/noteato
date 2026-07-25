import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import type { ScratchNote, ScratchSaveOptions } from '../shared/types'
import { stripLeadingH1 } from './frontmatter'

interface ScratchRow {
  id: string
  title: string
  body: string
  pinned: number
  reminder_at: string | null
  created_at: string
  updated_at: string
}

function toNote(row: ScratchRow): ScratchNote {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    pinned: row.pinned === 1,
    reminderAt: row.reminder_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    excerpt: stripLeadingH1(row.body).trim().slice(0, 160)
  }
}

/** SQLite-backed store for quick notes / sidebar-mode notes. */
export class ScratchStore {
  constructor(private db: Database.Database) {}

  list(): ScratchNote[] {
    const rows = this.db
      .prepare('SELECT * FROM scratch_notes ORDER BY updated_at DESC')
      .all() as ScratchRow[]
    return rows.map(toNote)
  }

  read(id: string): ScratchNote | null {
    const row = this.db.prepare('SELECT * FROM scratch_notes WHERE id = ?').get(id) as
      | ScratchRow
      | undefined
    return row ? toNote(row) : null
  }

  create(): ScratchNote {
    const now = new Date().toISOString()
    const note: ScratchRow = {
      id: randomUUID(),
      title: 'Untitled',
      body: '',
      pinned: 0,
      reminder_at: null,
      created_at: now,
      updated_at: now
    }
    this.db
      .prepare(
        'INSERT INTO scratch_notes (id, title, body, pinned, reminder_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(note.id, note.title, note.body, note.pinned, note.reminder_at, now, now)
    return toNote(note)
  }

  save(id: string, options: ScratchSaveOptions): ScratchNote | null {
    this.db
      .prepare('UPDATE scratch_notes SET title = ?, body = ?, updated_at = ? WHERE id = ?')
      .run(options.title, options.body, new Date().toISOString(), id)
    return this.read(id)
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM scratch_notes WHERE id = ?').run(id).changes > 0
  }

  // Pin/reminder deliberately leave updated_at alone so neither reorders the
  // recency-sorted list (mirrors NoteStore.setPinned / setReminder).
  setPinned(id: string, pinned: boolean): ScratchNote | null {
    this.db.prepare('UPDATE scratch_notes SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id)
    return this.read(id)
  }

  setReminder(id: string, reminderAt: string | null): ScratchNote | null {
    this.db.prepare('UPDATE scratch_notes SET reminder_at = ? WHERE id = ?').run(reminderAt, id)
    return this.read(id)
  }
}
