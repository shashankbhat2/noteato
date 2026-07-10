import { randomUUID } from 'crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { Note, NoteMeta, NoteSummary, SaveOptions } from '../shared/types'
import { parseNoteFile, serializeNoteFile } from './frontmatter'

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  return slug || 'untitled'
}

export class NoteStore {
  private notesDir: string

  constructor(notesDir?: string) {
    this.notesDir = notesDir ?? join(app.getPath('documents'), 'Noteato')
    if (!existsSync(this.notesDir)) mkdirSync(this.notesDir, { recursive: true })
  }

  getNotesDir(): string {
    return this.notesDir
  }

  setNotesDir(newDir: string): void {
    if (newDir === this.notesDir) return
    if (!existsSync(newDir)) mkdirSync(newDir, { recursive: true })

    const files = existsSync(this.notesDir)
      ? readdirSync(this.notesDir).filter((f) => f.endsWith('.md'))
      : []

    for (const file of files) {
      const from = join(this.notesDir, file)
      const to = join(newDir, file)
      if (existsSync(to)) continue
      try {
        renameSync(from, to)
      } catch {
        copyFileSync(from, to)
        unlinkSync(from)
      }
    }

    this.notesDir = newDir
  }

  private pathFor(filename: string): string {
    return join(this.notesDir, filename)
  }

  private toSummary(filename: string): NoteSummary | null {
    const raw = readFileSync(this.pathFor(filename), 'utf-8')
    const { meta, body } = parseNoteFile(raw)
    if (!meta.id) return null
    return {
      id: meta.id,
      title: meta.title ?? filename.replace(/\.md$/, ''),
      createdAt: meta.createdAt ?? '',
      updatedAt: meta.updatedAt ?? '',
      tags: meta.tags ?? [],
      fullWidth: meta.fullWidth ?? false,
      filename,
      excerpt: body.trim().slice(0, 160)
    }
  }

  list(): NoteSummary[] {
    const files = readdirSync(this.notesDir).filter((f) => f.endsWith('.md'))
    const summaries = files
      .map((f) => this.toSummary(f))
      .filter((s): s is NoteSummary => s !== null)
    summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    return summaries
  }

  read(filename: string): Note {
    const raw = readFileSync(this.pathFor(filename), 'utf-8')
    const { meta, body } = parseNoteFile(raw)
    return {
      id: meta.id ?? randomUUID(),
      title: meta.title ?? filename.replace(/\.md$/, ''),
      createdAt: meta.createdAt ?? new Date().toISOString(),
      updatedAt: meta.updatedAt ?? new Date().toISOString(),
      tags: meta.tags ?? [],
      fullWidth: meta.fullWidth ?? false,
      filename,
      excerpt: body.trim().slice(0, 160),
      body
    }
  }

  create(title = 'Untitled'): Note {
    const now = new Date().toISOString()
    const id = randomUUID()
    let filename = `${slugify(title)}.md`
    let counter = 1
    while (existsSync(this.pathFor(filename))) {
      filename = `${slugify(title)}-${counter}.md`
      counter += 1
    }

    const meta: NoteMeta = {
      id,
      title,
      createdAt: now,
      updatedAt: now,
      tags: [],
      fullWidth: false
    }
    writeFileSync(this.pathFor(filename), serializeNoteFile(meta, ''), 'utf-8')

    return { ...meta, filename, excerpt: '', body: '' }
  }

  save(filename: string, options: SaveOptions): Note {
    const existing = this.read(filename)
    const meta: NoteMeta = {
      id: existing.id,
      title: options.title,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
      tags: options.tags ?? existing.tags,
      fullWidth: options.fullWidth ?? existing.fullWidth
    }

    let targetFilename = filename
    const desiredFilename = `${slugify(options.title)}.md`
    if (desiredFilename !== filename && !existsSync(this.pathFor(desiredFilename))) {
      renameSync(this.pathFor(filename), this.pathFor(desiredFilename))
      targetFilename = desiredFilename
    }

    writeFileSync(this.pathFor(targetFilename), serializeNoteFile(meta, options.body), 'utf-8')
    return {
      ...meta,
      filename: targetFilename,
      excerpt: options.body.trim().slice(0, 160),
      body: options.body
    }
  }

  importMarkdown(filename: string, rawContent: string): Note {
    const { body: stripped } = parseNoteFile(rawContent)
    const headingMatch = stripped.match(/^#\s+(.+?)\s*$/m)
    let title: string
    let body: string

    if (headingMatch && stripped.trimStart().startsWith(headingMatch[0])) {
      title = headingMatch[1].trim()
      body = stripped.slice(stripped.indexOf(headingMatch[0]) + headingMatch[0].length).replace(/^\s*\n/, '')
    } else {
      title = filename.replace(/\.(md|markdown)$/i, '')
      body = stripped
    }

    const created = this.create(title)
    return this.save(created.filename, { title, body, tags: [], fullWidth: false })
  }

  delete(filename: string): void {
    rmSync(this.pathFor(filename), { force: true })
  }
}
