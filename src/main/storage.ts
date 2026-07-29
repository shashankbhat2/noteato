import { randomUUID } from 'crypto'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { dirname, isAbsolute, join, relative } from 'path'
import { app } from 'electron'
import type Database from 'better-sqlite3'
import type {
  DeletedEntry,
  Note,
  NoteMeta,
  NoteSummary,
  SaveOptions,
  SearchResult,
  TrashEntry
} from '../shared/types'
import {
  leadingH1,
  parseNoteFile,
  replaceLeadingH1,
  serializeNoteFile,
  stripLeadingH1
} from './frontmatter'

// A registered external file or folder (the opened_files table). Files opened
// from outside the notes dir are linked in place and never modified beyond
// explicit edits to their markdown body; pin/reminder metadata lives here.
interface OpenedFileRow {
  path: string
  kind: 'file' | 'folder'
  pinned: number
  reminder_at: string | null
  added_at: string
}

function replaceExternalBody(raw: string, body: string): string {
  if (!raw.startsWith('---')) return body
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return body
  return `${raw.slice(0, end + 4)}\n\n${body}`
}

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  return slug || 'untitled'
}

// Relative POSIX path helpers (identifiers are always "/"-separated).
function folderOf(relPath: string): string {
  const i = relPath.lastIndexOf('/')
  return i === -1 ? '' : relPath.slice(0, i)
}

function baseName(relPath: string): string {
  const i = relPath.lastIndexOf('/')
  return i === -1 ? relPath : relPath.slice(i + 1)
}

/**
 * Splits a search box query into tag filters and the leftover free text.
 * `#launch` and `tag:launch` mean the same thing; everything else is text.
 */
export function parseSearchQuery(raw: string): { tags: string[]; text: string } {
  const tags: string[] = []
  const words: string[] = []
  for (const token of raw.trim().split(/\s+/)) {
    const match = /^(?:tag:|#)(.+)$/i.exec(token)
    if (match) tags.push(tagKey(match[1]))
    else if (token) words.push(token)
  }
  return { tags, text: words.join(' ') }
}

/**
 * A tag term can't carry a space — it would split into two search tokens — so
 * "note taking" has to be typed as `#note-taking`. Comparing both sides with
 * separators dropped is what lets that find the tag it means.
 */
function tagKey(tag: string): string {
  return tag.toLowerCase().replace(/[\s-]+/g, '')
}

function makeSnippet(body: string, idx: number, len: number): string {
  const start = Math.max(0, idx - 40)
  const end = Math.min(body.length, idx + len + 80)
  let s = body.slice(start, end).replace(/\s+/g, ' ').trim()
  if (start > 0) s = `…${s}`
  if (end < body.length) s = `${s}…`
  return s
}

export class NoteStore {
  private notesDir: string
  // Deleted notes/folders are moved here (not permanently removed) so a delete
  // can be undone. Kept in userData rather than the notes folder to avoid
  // cluttering the user-facing markdown directory with trashed files.
  private trashDir: string

  constructor(
    private db: Database.Database,
    notesDir?: string
  ) {
    this.notesDir = notesDir ?? join(app.getPath('documents'), 'Noteato')
    if (!existsSync(this.notesDir)) mkdirSync(this.notesDir, { recursive: true })
    this.trashDir = join(app.getPath('userData'), 'trash')
  }

  // --- Registered external files/folders ------------------------------------

  private openedRows(): OpenedFileRow[] {
    return this.db.prepare('SELECT * FROM opened_files').all() as OpenedFileRow[]
  }

  private openedRow(path: string): OpenedFileRow | undefined {
    return this.db.prepare('SELECT * FROM opened_files WHERE path = ?').get(path) as
      | OpenedFileRow
      | undefined
  }

  // The registered entry that surfaces an absolute path: the exact entry, or
  // a registered folder containing it.
  private externalRootOf(fullPath: string): OpenedFileRow | null {
    const exact = this.openedRow(fullPath)
    if (exact) return exact
    for (const row of this.openedRows()) {
      if (row.kind === 'folder' && fullPath.startsWith(`${row.path}/`)) return row
    }
    return null
  }

  private upsertFileMeta(
    path: string,
    patch: { pinned?: boolean; reminderAt?: string | null }
  ): void {
    const existing = this.openedRow(path)
    if (existing) {
      if (patch.pinned !== undefined) {
        this.db
          .prepare('UPDATE opened_files SET pinned = ? WHERE path = ?')
          .run(patch.pinned ? 1 : 0, path)
      }
      if ('reminderAt' in patch) {
        this.db
          .prepare('UPDATE opened_files SET reminder_at = ? WHERE path = ?')
          .run(patch.reminderAt ?? null, path)
      }
      return
    }
    this.db
      .prepare(
        "INSERT INTO opened_files (path, kind, pinned, reminder_at, added_at) VALUES (?, 'file', ?, ?, ?)"
      )
      .run(path, patch.pinned ? 1 : 0, patch.reminderAt ?? null, new Date().toISOString())
  }

  /** Registered roots the file watcher should observe. */
  listOpenedRoots(): { path: string; kind: 'file' | 'folder' }[] {
    return this.openedRows().map(({ path, kind }) => ({ path, kind }))
  }

  getNotesDir(): string {
    return this.notesDir
  }

  setNotesDir(newDir: string): void {
    if (newDir === this.notesDir) return
    if (!existsSync(newDir)) mkdirSync(newDir, { recursive: true })

    // Move every top-level entry (files and subfolders) so the tree is preserved.
    const entries = existsSync(this.notesDir) ? readdirSync(this.notesDir) : []
    for (const name of entries) {
      if (name.startsWith('.')) continue
      const from = join(this.notesDir, name)
      const to = join(newDir, name)
      if (existsSync(to)) continue
      try {
        renameSync(from, to)
      } catch {
        cpSync(from, to, { recursive: true })
        rmSync(from, { recursive: true, force: true })
      }
    }

    this.notesDir = newDir
  }

  // Resolve a relative path under the notes dir, rejecting anything that escapes
  // it (e.g. via "..") — a guard applied to every path that crosses the IPC edge.
  private resolveWithin(relPath: string): string {
    const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '')
    const full = join(this.notesDir, normalized)
    const rel = relative(this.notesDir, full)
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`Path escapes notes directory: ${relPath}`)
    }
    return full
  }

  private resolveNotePath(notePath: string): string {
    if (!isAbsolute(notePath)) return this.resolveWithin(notePath)
    if (!this.externalRootOf(notePath)) {
      throw new Error('External note is not linked to Noteato.')
    }
    return notePath
  }

  /**
   * Absolute on-disk location of a note, for the OS-level actions (copy path,
   * reveal in Finder). Managed notes resolve under the notes dir; linked files
   * must still be registered, so this can't be used to probe the filesystem.
   */
  absolutePath(notePath: string): string {
    return this.resolveNotePath(notePath)
  }

  private walkNotes(dir: string, prefix: string, out: string[]): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        this.walkNotes(join(dir, entry.name), rel, out)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        out.push(rel)
      }
    }
  }

  private walkFolders(dir: string, prefix: string, out: string[]): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || !entry.isDirectory()) continue
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      out.push(rel)
      this.walkFolders(join(dir, entry.name), rel, out)
    }
  }

  // Summary of a managed (notes-dir) markdown file.
  private toSummary(relPath: string): NoteSummary | null {
    const full = this.resolveWithin(relPath)
    const raw = readFileSync(full, 'utf-8')
    const { meta, body } = parseNoteFile(raw)
    if (!meta.id) return null
    const stats = statSync(full)
    return {
      id: meta.id,
      title: meta.title ?? baseName(relPath).replace(/\.(md|markdown)$/i, ''),
      createdAt: meta.createdAt ?? stats.birthtime.toISOString(),
      updatedAt: meta.updatedAt ?? stats.mtime.toISOString(),
      tags: meta.tags ?? [],
      fullWidth: meta.fullWidth ?? false,
      pinned: meta.pinned ?? false,
      reminderAt: meta.reminderAt ?? null,
      path: relPath,
      folder: folderOf(relPath),
      excerpt: stripLeadingH1(body).trim().slice(0, 160),
      external: false
    }
  }

  // Summary of an externally linked file. The file itself is never written by
  // anything here: the id derives from the path, the title from the file's
  // leading H1 (falling back to any frontmatter title another tool put there,
  // then the filename), and pin/reminder metadata lives in opened_files.
  private externalSummary(fullPath: string, root: OpenedFileRow): NoteSummary | null {
    let raw: string
    let stats: ReturnType<typeof statSync>
    try {
      raw = readFileSync(fullPath, 'utf-8')
      stats = statSync(fullPath)
    } catch {
      return null
    }
    const { meta, body } = parseNoteFile(raw)
    const metaRow = fullPath === root.path ? root : this.openedRow(fullPath)
    return {
      id: `ext:${fullPath}`,
      title:
        leadingH1(body) ?? meta.title ?? baseName(fullPath).replace(/\.(md|markdown)$/i, ''),
      createdAt: stats.birthtime.toISOString(),
      updatedAt: stats.mtime.toISOString(),
      tags: meta.tags ?? [],
      fullWidth: false,
      pinned: (metaRow?.pinned ?? 0) === 1,
      reminderAt: metaRow?.reminder_at ?? null,
      path: fullPath,
      folder: dirname(fullPath),
      excerpt: stripLeadingH1(body).trim().slice(0, 160),
      external: true,
      externalRoot: root.path,
      fromFolder: root.kind === 'folder'
    }
  }

  private walkExternalDir(dir: string, out: string[]): void {
    let entries: import('fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) this.walkExternalDir(full, out)
      else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) out.push(full)
    }
  }

  list(): NoteSummary[] {
    const paths: string[] = []
    this.walkNotes(this.notesDir, '', paths)
    const summaries = paths
      .map((p) => this.toSummary(p))
      .filter((s): s is NoteSummary => s !== null)

    // Linked folders first, then standalone linked files that a folder didn't
    // already surface (a standalone entry may double as pin/reminder metadata
    // for a folder child).
    const seen = new Set<string>()
    const rows = this.openedRows()
    for (const row of rows) {
      if (row.kind !== 'folder' || !existsSync(row.path)) continue
      const files: string[] = []
      this.walkExternalDir(row.path, files)
      for (const file of files) {
        if (seen.has(file)) continue
        seen.add(file)
        const summary = this.externalSummary(file, row)
        if (summary) summaries.push(summary)
      }
    }
    for (const row of rows) {
      if (row.kind !== 'file' || seen.has(row.path) || !existsSync(row.path)) continue
      seen.add(row.path)
      const summary = this.externalSummary(row.path, row)
      if (summary) summaries.push(summary)
    }

    summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    return summaries
  }

  listFolders(): string[] {
    const out: string[] = []
    this.walkFolders(this.notesDir, '', out)
    out.sort((a, b) => a.localeCompare(b))
    return out
  }

  read(relPath: string): Note {
    if (isAbsolute(relPath)) {
      const root = this.externalRootOf(relPath)
      if (!root) throw new Error('External note is not linked to Noteato.')
      const summary = this.externalSummary(relPath, root)
      if (!summary) throw new Error('Linked file could not be read.')
      const { body } = parseNoteFile(readFileSync(relPath, 'utf-8'))
      return { ...summary, body }
    }

    const full = this.resolveWithin(relPath)
    const raw = readFileSync(full, 'utf-8')
    const { meta, body } = parseNoteFile(raw)
    const stats = statSync(full)
    return {
      id: meta.id ?? randomUUID(),
      title: meta.title ?? baseName(relPath).replace(/\.(md|markdown)$/i, ''),
      createdAt: meta.createdAt ?? stats.birthtime.toISOString(),
      updatedAt: meta.updatedAt ?? stats.mtime.toISOString(),
      tags: meta.tags ?? [],
      fullWidth: meta.fullWidth ?? false,
      pinned: meta.pinned ?? false,
      reminderAt: meta.reminderAt ?? null,
      path: relPath,
      folder: folderOf(relPath),
      excerpt: stripLeadingH1(body).trim().slice(0, 160),
      external: false,
      body
    }
  }

  openExternal(filePath: string): Note {
    const full = realpathSync(filePath)
    if (!/\.(md|markdown)$/i.test(full)) throw new Error('Only Markdown files can be opened.')

    const rel = relative(this.notesDir, full)
    if (!rel.startsWith('..') && !isAbsolute(rel)) {
      // Inside the managed library: adopt it into the frontmatter format the
      // library uses (this is Noteato's own directory).
      const managedPath = rel.replace(/\\/g, '/')
      const existing = this.toSummary(managedPath)
      if (existing) return this.read(managedPath)

      const raw = readFileSync(full, 'utf-8')
      const { body } = parseNoteFile(raw)
      const now = new Date().toISOString()
      const meta: NoteMeta = {
        id: randomUUID(),
        title: leadingH1(body) ?? baseName(managedPath).replace(/\.(md|markdown)$/i, ''),
        createdAt: now,
        updatedAt: now,
        tags: [],
        fullWidth: false,
        pinned: false,
        reminderAt: null
      }
      writeFileSync(full, serializeNoteFile(meta, body), 'utf-8')
      return this.read(managedPath)
    }

    // Outside the library: link in place, never write to the file.
    this.db
      .prepare("INSERT OR IGNORE INTO opened_files (path, kind, added_at) VALUES (?, 'file', ?)")
      .run(full, new Date().toISOString())
    return this.read(full)
  }

  /** Link a folder in place; its markdown files appear as external notes. */
  openExternalFolder(dirPath: string): NoteSummary[] {
    const full = realpathSync(dirPath)
    const rel = relative(this.notesDir, full)
    if (!rel.startsWith('..') && !isAbsolute(rel)) return []

    this.db
      .prepare("INSERT OR IGNORE INTO opened_files (path, kind, added_at) VALUES (?, 'folder', ?)")
      .run(full, new Date().toISOString())
    return this.list().filter((note) => note.externalRoot === full)
  }

  removeExternal(notePath: string): boolean {
    if (!isAbsolute(notePath)) return false
    const row = this.openedRow(notePath)
    if (!row) return false
    const remove = this.db.transaction(() => {
      this.db.prepare('DELETE FROM opened_files WHERE path = ?').run(notePath)
      // Removing a folder also drops pin/reminder metadata entries created
      // for its children, so they don't linger as standalone links.
      if (row.kind === 'folder') {
        this.db.prepare("DELETE FROM opened_files WHERE path LIKE ? || '/%'").run(notePath)
      }
    })
    remove()
    return true
  }

  create(title = 'Untitled', folder = '', id: string = randomUUID()): Note {
    const now = new Date().toISOString()
    const dir = folder ? this.resolveWithin(folder) : this.notesDir
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    let base = `${slugify(title)}.md`
    let counter = 1
    const relOf = (name: string): string => (folder ? `${folder}/${name}` : name)
    while (existsSync(this.resolveWithin(relOf(base)))) {
      base = `${slugify(title)}-${counter}.md`
      counter += 1
    }
    const path = relOf(base)

    const meta: NoteMeta = {
      id,
      title,
      createdAt: now,
      updatedAt: now,
      tags: [],
      fullWidth: false,
      pinned: false,
      reminderAt: null
    }
    writeFileSync(this.resolveWithin(path), serializeNoteFile(meta, ''), 'utf-8')

    return { ...meta, path, folder, excerpt: '', body: '' }
  }

  save(relPath: string, options: SaveOptions): Note {
    const existing = this.read(relPath)
    const external = isAbsolute(relPath)
    // A title set outside the editor (sidebar rename) rewrites the body's
    // leading title block; editor saves derive the title from that block, so
    // for them this is a no-op.
    const body = replaceLeadingH1(options.body, options.title)
    if (external) {
      if (!this.externalRootOf(relPath)) {
        throw new Error('External note is not linked to Noteato.')
      }
      // Replace only the markdown body; any frontmatter another tool keeps in
      // the file (and the file's identity on disk) is left untouched.
      const raw = readFileSync(relPath, 'utf-8')
      writeFileSync(relPath, replaceExternalBody(raw, body), 'utf-8')
      return this.read(relPath)
    }

    const meta: NoteMeta = {
      id: existing.id,
      title: options.title,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
      tags: options.tags ?? existing.tags,
      fullWidth: options.fullWidth ?? existing.fullWidth,
      pinned: existing.pinned,
      reminderAt: existing.reminderAt
    }

    // Title-driven renames stay inside the note's current folder.
    const folder = folderOf(relPath)
    let targetPath = relPath
    const desiredName = `${slugify(options.title)}.md`
    const desiredPath = folder ? `${folder}/${desiredName}` : desiredName
    if (desiredPath !== relPath && !existsSync(this.resolveWithin(desiredPath))) {
      renameSync(this.resolveNotePath(relPath), this.resolveWithin(desiredPath))
      targetPath = desiredPath
    }

    writeFileSync(this.resolveNotePath(targetPath), serializeNoteFile(meta, body), 'utf-8')
    return {
      ...meta,
      path: targetPath,
      folder: folderOf(targetPath),
      excerpt: stripLeadingH1(body).trim().slice(0, 160),
      body
    }
  }

  // Toggle pin without bumping updatedAt, so pinning never reorders the list.
  setPinned(relPath: string, pinned: boolean): NoteSummary | null {
    if (isAbsolute(relPath)) {
      const root = this.externalRootOf(relPath)
      if (!root) return null
      this.upsertFileMeta(relPath, { pinned })
      return this.externalSummary(relPath, root)
    }
    const full = this.resolveNotePath(relPath)
    const raw = readFileSync(full, 'utf-8')
    const { meta, body } = parseNoteFile(raw)
    const next: NoteMeta = {
      id: meta.id ?? randomUUID(),
      title: meta.title ?? baseName(relPath).replace(/\.md$/, ''),
      createdAt: meta.createdAt ?? new Date().toISOString(),
      updatedAt: meta.updatedAt ?? new Date().toISOString(),
      tags: meta.tags ?? [],
      fullWidth: meta.fullWidth ?? false,
      pinned,
      reminderAt: meta.reminderAt ?? null
    }
    writeFileSync(full, serializeNoteFile(next, body), 'utf-8')
    return this.toSummary(relPath)
  }

  // Set or clear a note's one-shot reminder without bumping updatedAt, mirroring
  // setPinned — reminders shouldn't reorder the recency-sorted sidebar list.
  setReminder(relPath: string, reminderAt: string | null): NoteSummary | null {
    if (isAbsolute(relPath)) {
      const root = this.externalRootOf(relPath)
      if (!root) return null
      this.upsertFileMeta(relPath, { reminderAt })
      return this.externalSummary(relPath, root)
    }
    const full = this.resolveNotePath(relPath)
    const raw = readFileSync(full, 'utf-8')
    const { meta, body } = parseNoteFile(raw)
    const next: NoteMeta = {
      id: meta.id ?? randomUUID(),
      title: meta.title ?? baseName(relPath).replace(/\.md$/, ''),
      createdAt: meta.createdAt ?? new Date().toISOString(),
      updatedAt: meta.updatedAt ?? new Date().toISOString(),
      tags: meta.tags ?? [],
      fullWidth: meta.fullWidth ?? false,
      pinned: meta.pinned ?? false,
      reminderAt
    }
    writeFileSync(full, serializeNoteFile(next, body), 'utf-8')
    return this.toSummary(relPath)
  }

  // --- Folder operations ---------------------------------------------------

  createFolder(relPath: string): void {
    const full = this.resolveWithin(relPath)
    if (!existsSync(full)) mkdirSync(full, { recursive: true })
  }

  renameFolder(relPath: string, newName: string): void {
    const parent = folderOf(relPath)
    const safe = newName.replace(/[/\\]/g, '').trim() || 'Untitled'
    const target = parent ? `${parent}/${safe}` : safe
    if (target === relPath) return
    if (existsSync(this.resolveWithin(target))) {
      throw new Error('A folder with that name already exists here.')
    }
    renameSync(this.resolveWithin(relPath), this.resolveWithin(target))
  }

  moveNote(relPath: string, targetFolder: string): NoteSummary | null {
    const b = baseName(relPath)
    const destDir = targetFolder ? this.resolveWithin(targetFolder) : this.notesDir
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })

    let name = b
    let counter = 1
    const relOf = (): string => (targetFolder ? `${targetFolder}/${name}` : name)
    while (existsSync(this.resolveWithin(relOf()))) {
      name = b.replace(/\.md$/, `-${counter}.md`)
      counter += 1
    }
    const target = relOf()
    if (target === relPath) return this.toSummary(relPath)
    renameSync(this.resolveWithin(relPath), this.resolveWithin(target))
    return this.toSummary(target)
  }

  moveFolder(relPath: string, targetParent: string): void {
    if (targetParent === relPath || targetParent.startsWith(`${relPath}/`)) {
      throw new Error('Cannot move a folder into itself.')
    }
    // Already lives directly under the target — nothing to do.
    if (folderOf(relPath) === targetParent) return
    const b = baseName(relPath)
    const destDir = targetParent ? this.resolveWithin(targetParent) : this.notesDir
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })

    let name = b
    let counter = 1
    const relOf = (): string => (targetParent ? `${targetParent}/${name}` : name)
    while (existsSync(this.resolveWithin(relOf()))) {
      name = `${b}-${counter}`
      counter += 1
    }
    renameSync(this.resolveWithin(relPath), this.resolveWithin(relOf()))
  }

  // --- Trash (undoable delete for notes and folders) -----------------------

  private moveToTrash(relPath: string, isFolder: boolean, title: string): DeletedEntry {
    if (!existsSync(this.trashDir)) mkdirSync(this.trashDir, { recursive: true })
    // Timestamp prefix so repeated deletes of the same name don't collide.
    const trashName = `${Date.now()}-${baseName(relPath)}`
    const from = this.resolveWithin(relPath)
    const to = join(this.trashDir, trashName)
    try {
      renameSync(from, to)
    } catch {
      if (isFolder) {
        cpSync(from, to, { recursive: true })
        rmSync(from, { recursive: true, force: true })
      } else {
        copyFileSync(from, to)
        unlinkSync(from)
      }
    }
    this.db
      .prepare(
        'INSERT OR REPLACE INTO trash_entries (trash_name, original_path, is_folder, title, deleted_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(trashName, relPath, isFolder ? 1 : 0, title, new Date().toISOString())
    return { trashName, originalPath: relPath, isFolder }
  }

  delete(relPath: string): DeletedEntry {
    if (isAbsolute(relPath)) throw new Error('Use Remove from Noteato for linked files.')
    let title = baseName(relPath).replace(/\.(md|markdown)$/i, '')
    try {
      title = this.read(relPath).title || title
    } catch {
      /* unreadable — keep the filename */
    }
    return this.moveToTrash(relPath, false, title)
  }

  deleteFolder(relPath: string): DeletedEntry {
    return this.moveToTrash(relPath, true, baseName(relPath))
  }

  listTrash(): TrashEntry[] {
    interface TrashRow {
      trash_name: string
      original_path: string
      is_folder: number
      title: string
      deleted_at: string
    }
    const rows = this.db
      .prepare('SELECT * FROM trash_entries ORDER BY deleted_at DESC')
      .all() as TrashRow[]
    const entries: TrashEntry[] = []
    const known = new Set<string>()
    for (const row of rows) {
      if (!existsSync(join(this.trashDir, row.trash_name))) {
        // The file vanished outside Noteato — drop the stale record.
        this.db.prepare('DELETE FROM trash_entries WHERE trash_name = ?').run(row.trash_name)
        continue
      }
      known.add(row.trash_name)
      entries.push({
        trashName: row.trash_name,
        originalPath: row.original_path,
        isFolder: row.is_folder === 1,
        title: row.title,
        deletedAt: row.deleted_at
      })
    }
    // Items trashed before metadata was recorded: recover what the
    // "<timestamp>-<name>" convention preserves.
    if (existsSync(this.trashDir)) {
      for (const entry of readdirSync(this.trashDir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || known.has(entry.name)) continue
        const match = /^(\d+)-(.+)$/.exec(entry.name)
        if (!match) continue
        entries.push({
          trashName: entry.name,
          originalPath: match[2],
          isFolder: entry.isDirectory(),
          title: match[2].replace(/\.(md|markdown)$/i, ''),
          deletedAt: new Date(Number(match[1])).toISOString()
        })
      }
      entries.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1))
    }
    return entries
  }

  /** Permanently delete a single trashed item. */
  purgeTrash(trashName: string): void {
    // The name comes over IPC — never let it traverse out of the trash dir.
    if (trashName.includes('/') || trashName.includes('\\') || trashName.startsWith('.')) {
      throw new Error('Invalid trash entry.')
    }
    rmSync(join(this.trashDir, trashName), { recursive: true, force: true })
    this.db.prepare('DELETE FROM trash_entries WHERE trash_name = ?').run(trashName)
  }

  /** Permanently delete everything in the trash. */
  emptyTrash(): void {
    if (existsSync(this.trashDir)) {
      for (const entry of readdirSync(this.trashDir)) {
        rmSync(join(this.trashDir, entry), { recursive: true, force: true })
      }
    }
    this.db.prepare('DELETE FROM trash_entries').run()
  }

  restore(trashName: string, originalPath: string, isFolder: boolean): NoteSummary | null {
    const from = join(this.trashDir, trashName)
    if (!existsSync(from)) return null
    this.db.prepare('DELETE FROM trash_entries WHERE trash_name = ?').run(trashName)

    // If something now occupies the original location, restore under a suffix.
    let target = originalPath
    let counter = 1
    if (isFolder) {
      while (existsSync(this.resolveWithin(target))) {
        target = `${originalPath}-${counter}`
        counter += 1
      }
    } else {
      const folder = folderOf(originalPath)
      const b = baseName(originalPath)
      while (existsSync(this.resolveWithin(target))) {
        const suffixed = b.replace(/\.md$/, `-${counter}.md`)
        target = folder ? `${folder}/${suffixed}` : suffixed
        counter += 1
      }
    }

    const to = this.resolveWithin(target)
    const parent = dirname(to)
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true })
    try {
      renameSync(from, to)
    } catch {
      if (isFolder) {
        cpSync(from, to, { recursive: true })
        rmSync(from, { recursive: true, force: true })
      } else {
        copyFileSync(from, to)
        unlinkSync(from)
      }
    }
    return isFolder ? null : this.toSummary(target)
  }

  // --- Full-text search ----------------------------------------------------

  search(query: string): SearchResult[] {
    const { tags: wanted, text } = parseSearchQuery(query)
    const q = text.toLowerCase()
    if (!q && wanted.length === 0) return []

    const scored: (SearchResult & { score: number; updatedAt: string })[] = []
    for (const summary of this.list()) {
      const noteTags = summary.tags.map((t) => t.toLowerCase())

      // Every `#tag` term narrows the result set, so a note has to carry all of
      // them. Prefix matching keeps a half-typed tag useful while it is typed.
      const matched = new Set<string>()
      const passesFilters = wanted.every((want) => {
        const hit = noteTags.find((t) => tagKey(t).startsWith(want))
        if (hit) matched.add(hit)
        return hit !== undefined
      })
      if (!passesFilters) continue

      const title = summary.title
      const titleHit = q ? title.toLowerCase().includes(q) : false
      // Free text matches tags too, so "launch" finds notes tagged "launch"
      // without anyone having to know the `#` syntax exists.
      const tagHits = q ? noteTags.filter((t) => t.includes(q)) : []
      for (const t of tagHits) matched.add(t)

      // Tag-only queries never need the file opened — the summary already
      // carries everything the result row shows.
      if (!q) {
        scored.push({
          id: summary.id,
          path: summary.path,
          title,
          folder: summary.folder,
          snippet: summary.excerpt,
          tags: summary.tags,
          matchedTags: [...matched],
          score: 0,
          updatedAt: summary.updatedAt
        })
        continue
      }

      let body: string
      try {
        body = this.read(summary.path).body
      } catch {
        continue
      }
      const hay = body.toLowerCase()
      const firstIdx = hay.indexOf(q)
      if (!titleHit && tagHits.length === 0 && firstIdx === -1) continue

      let count = 0
      let from = 0
      while (true) {
        const i = hay.indexOf(q, from)
        if (i === -1) break
        count += 1
        from = i + q.length
      }

      const snippet =
        firstIdx !== -1
          ? makeSnippet(body, firstIdx, q.length)
          : stripLeadingH1(body).trim().slice(0, 120)
      scored.push({
        id: summary.id,
        path: summary.path,
        title,
        folder: summary.folder,
        snippet,
        tags: summary.tags,
        matchedTags: [...matched],
        score: (titleHit ? 1000 : 0) + (tagHits.length > 0 ? 500 : 0) + count,
        updatedAt: summary.updatedAt
      })
    }

    scored.sort((a, b) => b.score - a.score || (a.updatedAt < b.updatedAt ? 1 : -1))
    return scored
      .slice(0, 50)
      .map(({ score: _score, updatedAt: _updatedAt, ...r }) => r)
  }
}
