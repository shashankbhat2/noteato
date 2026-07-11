import { randomUUID } from 'crypto'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { dirname, isAbsolute, join, relative } from 'path'
import { app } from 'electron'
import type {
  DeletedEntry,
  Note,
  NoteMeta,
  NoteSummary,
  SaveOptions,
  SearchResult
} from '../shared/types'
import { parseNoteFile, serializeNoteFile } from './frontmatter'

function slugify(title: string): string {
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

  constructor(notesDir?: string) {
    this.notesDir = notesDir ?? join(app.getPath('documents'), 'Noteato')
    if (!existsSync(this.notesDir)) mkdirSync(this.notesDir, { recursive: true })
    this.trashDir = join(app.getPath('userData'), 'trash')
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

  private toSummary(relPath: string): NoteSummary | null {
    const raw = readFileSync(this.resolveWithin(relPath), 'utf-8')
    const { meta, body } = parseNoteFile(raw)
    if (!meta.id) return null
    return {
      id: meta.id,
      title: meta.title ?? baseName(relPath).replace(/\.md$/, ''),
      createdAt: meta.createdAt ?? '',
      updatedAt: meta.updatedAt ?? '',
      tags: meta.tags ?? [],
      fullWidth: meta.fullWidth ?? false,
      pinned: meta.pinned ?? false,
      path: relPath,
      folder: folderOf(relPath),
      excerpt: body.trim().slice(0, 160)
    }
  }

  list(): NoteSummary[] {
    const paths: string[] = []
    this.walkNotes(this.notesDir, '', paths)
    const summaries = paths
      .map((p) => this.toSummary(p))
      .filter((s): s is NoteSummary => s !== null)
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
    const raw = readFileSync(this.resolveWithin(relPath), 'utf-8')
    const { meta, body } = parseNoteFile(raw)
    return {
      id: meta.id ?? randomUUID(),
      title: meta.title ?? baseName(relPath).replace(/\.md$/, ''),
      createdAt: meta.createdAt ?? new Date().toISOString(),
      updatedAt: meta.updatedAt ?? new Date().toISOString(),
      tags: meta.tags ?? [],
      fullWidth: meta.fullWidth ?? false,
      pinned: meta.pinned ?? false,
      path: relPath,
      folder: folderOf(relPath),
      excerpt: body.trim().slice(0, 160),
      body
    }
  }

  create(title = 'Untitled', folder = ''): Note {
    const now = new Date().toISOString()
    const id = randomUUID()
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
      pinned: false
    }
    writeFileSync(this.resolveWithin(path), serializeNoteFile(meta, ''), 'utf-8')

    return { ...meta, path, folder, excerpt: '', body: '' }
  }

  save(relPath: string, options: SaveOptions): Note {
    const existing = this.read(relPath)
    const meta: NoteMeta = {
      id: existing.id,
      title: options.title,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
      tags: options.tags ?? existing.tags,
      fullWidth: options.fullWidth ?? existing.fullWidth,
      pinned: existing.pinned
    }

    // Title-driven renames stay inside the note's current folder.
    const folder = folderOf(relPath)
    let targetPath = relPath
    const desiredName = `${slugify(options.title)}.md`
    const desiredPath = folder ? `${folder}/${desiredName}` : desiredName
    if (desiredPath !== relPath && !existsSync(this.resolveWithin(desiredPath))) {
      renameSync(this.resolveWithin(relPath), this.resolveWithin(desiredPath))
      targetPath = desiredPath
    }

    writeFileSync(this.resolveWithin(targetPath), serializeNoteFile(meta, options.body), 'utf-8')
    return {
      ...meta,
      path: targetPath,
      folder: folderOf(targetPath),
      excerpt: options.body.trim().slice(0, 160),
      body: options.body
    }
  }

  // Toggle pin without bumping updatedAt, so pinning never reorders the list.
  setPinned(relPath: string, pinned: boolean): NoteSummary | null {
    const full = this.resolveWithin(relPath)
    const raw = readFileSync(full, 'utf-8')
    const { meta, body } = parseNoteFile(raw)
    const next: NoteMeta = {
      id: meta.id ?? randomUUID(),
      title: meta.title ?? baseName(relPath).replace(/\.md$/, ''),
      createdAt: meta.createdAt ?? new Date().toISOString(),
      updatedAt: meta.updatedAt ?? new Date().toISOString(),
      tags: meta.tags ?? [],
      fullWidth: meta.fullWidth ?? false,
      pinned
    }
    writeFileSync(full, serializeNoteFile(next, body), 'utf-8')
    return this.toSummary(relPath)
  }

  importMarkdown(filename: string, rawContent: string): Note {
    const { body: stripped } = parseNoteFile(rawContent)
    const headingMatch = stripped.match(/^#\s+(.+?)\s*$/m)
    let title: string
    let body: string

    if (headingMatch && stripped.trimStart().startsWith(headingMatch[0])) {
      title = headingMatch[1].trim()
      body = stripped
        .slice(stripped.indexOf(headingMatch[0]) + headingMatch[0].length)
        .replace(/^\s*\n/, '')
    } else {
      title = filename.replace(/\.(md|markdown)$/i, '')
      body = stripped
    }

    const created = this.create(title)
    return this.save(created.path, { title, body, tags: [], fullWidth: false })
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

  private moveToTrash(relPath: string, isFolder: boolean): DeletedEntry {
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
    return { trashName, originalPath: relPath, isFolder }
  }

  delete(relPath: string): DeletedEntry {
    return this.moveToTrash(relPath, false)
  }

  deleteFolder(relPath: string): DeletedEntry {
    return this.moveToTrash(relPath, true)
  }

  restore(trashName: string, originalPath: string, isFolder: boolean): NoteSummary | null {
    const from = join(this.trashDir, trashName)
    if (!existsSync(from)) return null

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
    const q = query.trim().toLowerCase()
    if (!q) return []

    const paths: string[] = []
    this.walkNotes(this.notesDir, '', paths)

    const scored: (SearchResult & { score: number })[] = []
    for (const path of paths) {
      let raw: string
      try {
        raw = readFileSync(this.resolveWithin(path), 'utf-8')
      } catch {
        continue
      }
      const { meta, body } = parseNoteFile(raw)
      if (!meta.id) continue

      const title = meta.title ?? baseName(path).replace(/\.md$/, '')
      const titleHit = title.toLowerCase().includes(q)
      const hay = body.toLowerCase()
      const firstIdx = hay.indexOf(q)
      if (!titleHit && firstIdx === -1) continue

      let count = 0
      let from = 0
      while (true) {
        const i = hay.indexOf(q, from)
        if (i === -1) break
        count += 1
        from = i + q.length
      }

      const snippet =
        firstIdx !== -1 ? makeSnippet(body, firstIdx, q.length) : body.trim().slice(0, 120)
      scored.push({
        id: meta.id,
        path,
        title,
        folder: folderOf(path),
        snippet,
        score: (titleHit ? 1000 : 0) + count
      })
    }

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, 50).map(({ score: _score, ...r }) => r)
  }
}
