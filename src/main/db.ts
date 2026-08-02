import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import Database from 'better-sqlite3'

// The single app database. Holds everything that is Noteato's own state rather
// than the user's markdown library: scratch notes (quick note + sidebar mode),
// stickies, the registry of externally opened files, and window geometry.
// Settings stay in settings.json (read before the DB exists during onboarding).

let db: Database.Database | null = null

export function getAppDb(): Database.Database {
  if (db) return db
  db = new Database(join(app.getPath('userData'), 'noteato.db'))
  db.pragma('journal_mode = WAL')
  migrate(db)
  return db
}

function readJsonFile(name: string): unknown {
  const filePath = join(app.getPath('userData'), name)
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

function migrate(database: Database.Database): void {
  const version = database.pragma('user_version', { simple: true }) as number

  if (version < 2) {
    // Metadata for entries sitting in the trash directory, so the Trash view
    // can show titles and restore targets across sessions.
    database.exec(`
      CREATE TABLE IF NOT EXISTS trash_entries (
        trash_name TEXT PRIMARY KEY,
        original_path TEXT NOT NULL,
        is_folder INTEGER NOT NULL DEFAULT 0,
        title TEXT NOT NULL DEFAULT '',
        deleted_at TEXT NOT NULL
      );
    `)
  }

  if (version < 3) {
    // Which note a meeting recording belongs to, and where its audio lives.
    //
    // Deliberately not in the note's frontmatter: the vault is the user's plain
    // markdown, and audio paths and durations are Noteato's bookkeeping. (It
    // would not survive there anyway — serializeNoteFile writes a fixed key
    // allowlist, so any extra frontmatter is dropped on the note's first save.)
    database.exec(`
      CREATE TABLE IF NOT EXISTS recordings (
        note_id TEXT PRIMARY KEY,
        capture_dir TEXT NOT NULL,
        duration_seconds REAL NOT NULL DEFAULT 0,
        system_captured INTEGER NOT NULL DEFAULT 0,
        transcript_status TEXT NOT NULL DEFAULT 'none',
        created_at TEXT NOT NULL
      );
    `)
  }

  if (version >= 1) {
    if (version < 3) database.pragma('user_version = 3')
    return
  }

  const toV1 = database.transaction(() => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS scratch_notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        pinned INTEGER NOT NULL DEFAULT 0,
        reminder_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stickies (
        id TEXT PRIMARY KEY,
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS opened_files (
        path TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('file', 'folder')),
        pinned INTEGER NOT NULL DEFAULT 0,
        reminder_at TEXT,
        added_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)

    // One-time import of the JSON stores this DB replaces. The files are left
    // in place afterwards; nothing reads them again.
    const stickies = readJsonFile('stickies.json') as { notes?: unknown[] } | null
    if (Array.isArray(stickies?.notes)) {
      const insert = database.prepare(
        'INSERT OR IGNORE INTO stickies (id, x, y, width, height, content, color) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      for (const raw of stickies.notes) {
        const s = raw as Record<string, unknown>
        if (typeof s?.id !== 'string') continue
        insert.run(
          s.id,
          Math.round(Number(s.x) || 0),
          Math.round(Number(s.y) || 0),
          Math.round(Number(s.width) || 260),
          Math.round(Number(s.height) || 260),
          typeof s.content === 'string' ? s.content : '',
          typeof s.color === 'string' ? s.color : '#eee3c8'
        )
      }
    }

    const externalNotes = readJsonFile('external-notes.json')
    if (Array.isArray(externalNotes)) {
      const insert = database.prepare(
        "INSERT OR IGNORE INTO opened_files (path, kind, pinned, reminder_at, added_at) VALUES (?, 'file', ?, ?, ?)"
      )
      for (const raw of externalNotes) {
        const entry = raw as Record<string, unknown>
        if (typeof entry?.filePath !== 'string') continue
        insert.run(
          entry.filePath,
          entry.pinned ? 1 : 0,
          typeof entry.reminderAt === 'string' ? entry.reminderAt : null,
          typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString()
        )
      }
    }

    const insertKv = database.prepare('INSERT OR IGNORE INTO kv (key, value) VALUES (?, ?)')
    for (const [key, file] of [
      ['window-state', 'window-state.json'],
      ['sidebar-window-state', 'sidebar-window-state.json']
    ] as const) {
      const data = readJsonFile(file)
      if (data) insertKv.run(key, JSON.stringify(data))
    }

    database.pragma('user_version = 3')
  })
  toV1()
}

/** Drop-in replacement for JsonStore backed by the kv table. */
export class SqlKvStore<T> {
  private readStmt: Database.Statement
  private writeStmt: Database.Statement

  constructor(
    database: Database.Database,
    private key: string,
    private defaults: T
  ) {
    this.readStmt = database.prepare('SELECT value FROM kv WHERE key = ?')
    this.writeStmt = database.prepare(
      'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
  }

  read(): T {
    const row = this.readStmt.get(this.key) as { value: string } | undefined
    if (!row) return this.defaults
    try {
      return { ...this.defaults, ...JSON.parse(row.value) }
    } catch {
      return this.defaults
    }
  }

  write(data: T): void {
    this.writeStmt.run(this.key, JSON.stringify(data))
  }
}
