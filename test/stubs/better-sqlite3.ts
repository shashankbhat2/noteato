/**
 * A minimal stand-in for better-sqlite3 under Vitest.
 *
 * The real module is a native addon compiled against Electron's ABI (see the
 * `electron-builder install-app-deps` postinstall), so it cannot load in plain
 * Node. Rather than skip every test that touches NoteStore, this implements the
 * handful of statements the store actually issues.
 *
 * It is deliberately not a SQL engine: it matches on the statement text the
 * code under test uses. A new query in NoteStore will fail loudly here rather
 * than silently returning nothing — which is the behaviour worth having, since
 * a fake that quietly answers everything would let a broken query pass.
 */

interface OpenedFileRow {
  path: string
  kind: 'file' | 'folder'
  pinned: number
  reminder_at: string | null
  added_at: string
}

interface TrashRow {
  trash_name: string
  original_path: string
  is_folder: number
  title: string
  deleted_at: string
}

class Statement {
  constructor(
    private db: FakeDatabase,
    private sql: string
  ) {}

  private normalized(): string {
    return this.sql.replace(/\s+/g, ' ').trim()
  }

  all(...params: unknown[]): unknown[] {
    const sql = this.normalized()
    if (sql.startsWith('SELECT * FROM opened_files')) return [...this.db.openedFiles]
    if (sql.startsWith('SELECT * FROM trash_entries')) {
      return [...this.db.trash].sort((a, b) => (a.deleted_at < b.deleted_at ? 1 : -1))
    }
    throw new Error(`better-sqlite3 stub: unhandled all() for ${sql} (${params.length} params)`)
  }

  get(...params: unknown[]): unknown {
    const sql = this.normalized()
    if (sql.startsWith('SELECT value FROM kv WHERE key = ?')) {
      const value = this.db.kv.get(String(params[0]))
      return value === undefined ? undefined : { value }
    }
    if (sql.startsWith('SELECT * FROM opened_files WHERE path = ?')) {
      return this.db.openedFiles.find((row) => row.path === params[0])
    }
    throw new Error(`better-sqlite3 stub: unhandled get() for ${sql}`)
  }

  run(...params: unknown[]): { changes: number } {
    const sql = this.normalized()

    if (sql.startsWith('INSERT INTO kv')) {
      this.db.kv.set(String(params[0]), String(params[1]))
      return { changes: 1 }
    }
    if (sql.startsWith('INSERT OR REPLACE INTO trash_entries')) {
      const [trash_name, original_path, is_folder, title, deleted_at] = params
      this.db.trash = this.db.trash.filter((row) => row.trash_name !== trash_name)
      this.db.trash.push({
        trash_name: String(trash_name),
        original_path: String(original_path),
        is_folder: Number(is_folder),
        title: String(title),
        deleted_at: String(deleted_at)
      })
      return { changes: 1 }
    }
    if (sql.startsWith('DELETE FROM trash_entries WHERE trash_name = ?')) {
      this.db.trash = this.db.trash.filter((row) => row.trash_name !== params[0])
      return { changes: 1 }
    }
    if (sql.startsWith('DELETE FROM trash_entries')) {
      this.db.trash = []
      return { changes: 1 }
    }
    if (sql.startsWith('INSERT OR IGNORE INTO opened_files')) {
      const path = String(params[0])
      if (!this.db.openedFiles.some((row) => row.path === path)) {
        // The two INSERT OR IGNORE forms differ: one carries pin/reminder, the
        // other only a timestamp.
        const withMeta = params.length >= 4
        this.db.openedFiles.push({
          path,
          kind: sql.includes("'folder'") ? 'folder' : 'file',
          pinned: withMeta ? Number(params[1]) : 0,
          reminder_at: withMeta ? ((params[2] as string | null) ?? null) : null,
          added_at: String(params[withMeta ? 3 : 1])
        })
      }
      return { changes: 1 }
    }
    if (sql.startsWith('INSERT INTO opened_files')) {
      this.db.openedFiles.push({
        path: String(params[0]),
        kind: 'file',
        pinned: Number(params[1]),
        reminder_at: (params[2] as string | null) ?? null,
        added_at: String(params[3])
      })
      return { changes: 1 }
    }
    if (sql.startsWith('UPDATE opened_files SET pinned = ?')) {
      const row = this.db.openedFiles.find((entry) => entry.path === params[1])
      if (row) row.pinned = Number(params[0])
      return { changes: row ? 1 : 0 }
    }
    if (sql.startsWith('UPDATE opened_files SET reminder_at = ?')) {
      const row = this.db.openedFiles.find((entry) => entry.path === params[1])
      if (row) row.reminder_at = (params[0] as string | null) ?? null
      return { changes: row ? 1 : 0 }
    }
    if (sql.startsWith("DELETE FROM opened_files WHERE path LIKE ? || '/%'")) {
      const prefix = `${String(params[0])}/`
      this.db.openedFiles = this.db.openedFiles.filter((row) => !row.path.startsWith(prefix))
      return { changes: 1 }
    }
    if (sql.startsWith('DELETE FROM opened_files WHERE path = ?')) {
      this.db.openedFiles = this.db.openedFiles.filter((row) => row.path !== params[0])
      return { changes: 1 }
    }
    throw new Error(`better-sqlite3 stub: unhandled run() for ${sql}`)
  }
}

class FakeDatabase {
  kv = new Map<string, string>()
  openedFiles: OpenedFileRow[] = []
  trash: TrashRow[] = []

  prepare(sql: string): Statement {
    return new Statement(this, sql)
  }

  exec(): void {
    /* schema creation — the fake's tables are just fields */
  }

  pragma(): unknown {
    return 0
  }

  transaction<T extends (...args: never[]) => unknown>(fn: T): T {
    // No rollback: these tests assert on outcomes, not on atomicity.
    return fn
  }

  close(): void {
    /* nothing to release */
  }
}

export default FakeDatabase
