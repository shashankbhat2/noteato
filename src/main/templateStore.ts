import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { NoteTemplate, NoteTemplateDraft } from '../shared/noteTemplates'
import { resolveTemplateVariables } from '../shared/noteTemplates'
import type { Note } from '../shared/types'
import type { NoteStore } from './storage'

const TEMPLATE_DIR = join('.noteato', 'templates')

function encode(value: string): string {
  return JSON.stringify(value)
}

function decode(raw: string): NoteTemplate | null {
  const end = raw.indexOf('\n---', 3)
  if (!raw.startsWith('---\n') || end === -1) return null
  const header = raw.slice(4, end).split('\n')
  const values = new Map<string, string>()
  for (const line of header) {
    const colon = line.indexOf(':')
    if (colon < 1) continue
    const key = line.slice(0, colon).trim()
    const encoded = line.slice(colon + 1).trim()
    try {
      values.set(key, JSON.parse(encoded))
    } catch {
      values.set(key, encoded)
    }
  }
  const id = values.get('id')
  const name = values.get('name')
  const titlePattern = values.get('titlePattern')
  const createdAt = values.get('createdAt')
  const updatedAt = values.get('updatedAt')
  if (!id || !name || !titlePattern || !createdAt || !updatedAt) return null
  return {
    id,
    name,
    description: values.get('description') ?? '',
    titlePattern,
    sourceNoteId: values.get('sourceNoteId') || undefined,
    createdAt,
    updatedAt,
    markdown: raw.slice(end + 4).replace(/^\s*\n/, '').trim()
  }
}

function serialize(template: NoteTemplate): string {
  const fields = [
    ['id', template.id],
    ['name', template.name],
    ['description', template.description],
    ['titlePattern', template.titlePattern],
    ['sourceNoteId', template.sourceNoteId ?? ''],
    ['createdAt', template.createdAt],
    ['updatedAt', template.updatedAt]
  ]
  return `---\n${fields.map(([key, value]) => `${key}: ${encode(value)}`).join('\n')}\n---\n\n${template.markdown.trim()}\n`
}

export class TemplateStore {
  constructor(
    private notes: NoteStore,
    private getNotesDir: () => string
  ) {}

  private directory(): string {
    return join(this.getNotesDir(), TEMPLATE_DIR)
  }

  list(): NoteTemplate[] {
    const dir = this.directory()
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((name) => name.endsWith('.md'))
      .map((name) => decode(readFileSync(join(dir, name), 'utf-8')))
      .filter((template): template is NoteTemplate => template !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  read(id: string): NoteTemplate | null {
    return this.list().find((template) => template.id === id) ?? null
  }

  create(draft: NoteTemplateDraft): NoteTemplate {
    const now = new Date().toISOString()
    const template: NoteTemplate = {
      id: randomUUID(),
      name: draft.name.trim() || 'Untitled template',
      description: draft.description.trim(),
      titlePattern: draft.titlePattern.trim() || 'Untitled',
      markdown: draft.markdown.trim(),
      sourceNoteId: draft.sourceNoteId,
      createdAt: now,
      updatedAt: now
    }
    const dir = this.directory()
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${template.id}.md`), serialize(template), 'utf-8')
    return template
  }

  delete(id: string): boolean {
    const template = this.read(id)
    if (!template) return false
    rmSync(join(this.directory(), `${template.id}.md`), { force: true })
    return true
  }

  materialize(id: string, now = new Date()): { title: string; body: string } {
    const template = this.read(id)
    if (!template) throw new Error('Template no longer exists.')
    return {
      title: resolveTemplateVariables(template.titlePattern, now).trim() || template.name,
      body: resolveTemplateVariables(template.markdown, now)
    }
  }

  instantiate(id: string, now = new Date()): Note {
    const { title, body } = this.materialize(id, now)
    const created = this.notes.create(title)
    return this.notes.save(created.id, { title, body })
  }
}
