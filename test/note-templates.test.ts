import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NoteStore } from '../src/main/storage'
import { TemplateStore } from '../src/main/templateStore'
import {
  parseNewNoteOutput,
  parseTemplateOutput,
  resolveTemplateVariables,
  visibleAgentMessage
} from '../src/shared/noteTemplates'

describe('AI note templates', () => {
  it('separates a complete template artifact from the visible message', () => {
    const output = `I’ll preserve the recurring standup structure.
<noteato-template>
<name>Daily standup</name>
<description>Yesterday, today and blockers</description>
<title>Standup — {{date}}</title>
<content>
# Standup — {{date}}

## Yesterday
-

## Today
-

## Blockers
-
</content>
</noteato-template>`

    expect(parseTemplateOutput(output)).toEqual({
      message: 'I’ll preserve the recurring standup structure.',
      hasTemplateMarker: true,
      draft: {
        name: 'Daily standup',
        description: 'Yesterday, today and blockers',
        titlePattern: 'Standup — {{date}}',
        markdown:
          '# Standup — {{date}}\n\n## Yesterday\n-\n\n## Today\n-\n\n## Blockers\n-'
      }
    })
  })

  it('does not expose a partial streamed artifact', () => {
    const output = 'I’ll create that.\n<noteato-template>\n<name>Daily standup</name>'
    expect(parseTemplateOutput(output)).toEqual({
      message: 'I’ll create that.',
      draft: null,
      hasTemplateMarker: true
    })
    expect(visibleAgentMessage(output)).toBe('I’ll create that.')
  })

  it('parses a Home-created note artifact', () => {
    expect(
      parseNewNoteOutput(
        'I’ll create the plan.\n<noteato-note>\n<title>Launch plan</title>\n<content># Launch plan\n\n## Tasks</content>\n</noteato-note>'
      )
    ).toEqual({
      message: 'I’ll create the plan.',
      hasNoteMarker: true,
      note: { title: 'Launch plan', markdown: '# Launch plan\n\n## Tasks' }
    })
  })

  it('resolves supported variables without touching unknown placeholders', () => {
    const now = new Date(2026, 7, 6, 17, 43)
    const resolved = resolveTemplateVariables(
      '{{weekday}} · {{month}} · {{year}} · {{time}} · {{unknown}}',
      now
    )
    expect(resolved).toContain('2026')
    expect(resolved).not.toContain('{{weekday}}')
    expect(resolved).not.toContain('{{month}}')
    expect(resolved).not.toContain('{{time}}')
    expect(resolved).toContain('{{unknown}}')
  })
})

describe('template storage', () => {
  const directories: string[] = []

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('stores portable Markdown and instantiates an independent note', () => {
    const directory = mkdtempSync(join(tmpdir(), 'noteato-templates-'))
    directories.push(directory)
    const create = vi.fn((title: string) => ({ id: 'new-note', title }))
    const save = vi.fn((_id: string, options: { title: string; body: string }) => ({
      id: 'new-note',
      ...options
    }))
    const notes = { create, save } as unknown as NoteStore
    const store = new TemplateStore(notes, () => directory)
    const created = store.create({
      name: 'Daily standup',
      description: 'Yesterday, today and blockers',
      titlePattern: 'Standup — {{year}}',
      markdown: '# Standup — {{year}}\n\n## Today\n-',
      sourceNoteId: 'source-note'
    })

    expect(store.list()).toEqual([created])
    store.instantiate(created.id, new Date(2026, 7, 6, 17, 43))
    expect(create).toHaveBeenCalledWith('Standup — 2026')
    expect(save).toHaveBeenCalledWith('new-note', {
      title: 'Standup — 2026',
      body: '# Standup — 2026\n\n## Today\n-'
    })

    expect(store.delete(created.id)).toBe(true)
    expect(store.list()).toEqual([])
  })
})
