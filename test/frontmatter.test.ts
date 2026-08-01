import { describe, expect, it } from 'vitest'
import {
  leadingH1,
  parseNoteFile,
  replaceLeadingH1,
  serializeNoteFile,
  stripLeadingH1
} from '../src/main/frontmatter'
import type { NoteMeta } from '../src/shared/types'

const meta = (patch: Partial<NoteMeta> = {}): NoteMeta => ({
  id: 'abc-123',
  title: 'Launch notes',
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T11:00:00.000Z',
  tags: [],
  fullWidth: false,
  pinned: false,
  reminderAt: null,
  ...patch
})

describe('parseNoteFile', () => {
  it('reads back the metadata serializeNoteFile wrote', () => {
    const original = meta({ tags: ['launch', 'q3'], pinned: true })
    const { meta: parsed } = parseNoteFile(serializeNoteFile(original, '# Launch notes\n\nBody.'))
    expect(parsed).toMatchObject({
      id: 'abc-123',
      title: 'Launch notes',
      tags: ['launch', 'q3'],
      pinned: true,
      fullWidth: false,
      reminderAt: null
    })
  })

  // KNOWN ASYMMETRY, pinned deliberately rather than fixed here.
  //
  // serializeNoteFile writes `---\n\n<body>`, but parseNoteFile strips only one
  // newline after the closing delimiter, so every parse gains a leading "\n".
  // Harmless today — stripLeadingH1 and the editor both tolerate leading
  // whitespace — but Phase 2 regenerates note.md from audio + transcript, where
  // serialize→parse fidelity stops being cosmetic. Fix it there, with the format
  // change, not during groundwork: today the correction would silently drop a
  // blank line from the top of every existing note on its next save.
  it('gains a leading newline on the body, which serialize did not put there', () => {
    const { body } = parseNoteFile(serializeNoteFile(meta(), '# Launch notes\n\nBody.'))
    expect(body).toBe('\n# Launch notes\n\nBody.')
    expect(body.trimStart()).toBe('# Launch notes\n\nBody.')
  })

  it('treats a file with no frontmatter as all body', () => {
    expect(parseNoteFile('# Just markdown\n')).toEqual({ meta: {}, body: '# Just markdown\n' })
  })

  it('treats an unterminated frontmatter block as all body', () => {
    const raw = '---\nid: abc\ntitle: "Nope"\n'
    expect(parseNoteFile(raw)).toEqual({ meta: {}, body: raw })
  })

  it('reads an empty reminderAt as null rather than an empty string', () => {
    // serializeNoteFile writes `reminderAt: ` for an unset reminder, and
    // ReminderScheduler distinguishes null from a falsy string.
    expect(parseNoteFile(serializeNoteFile(meta(), '')).meta.reminderAt).toBeNull()
  })

  it('round-trips a title containing a colon', () => {
    const original = meta({ title: 'Launch: the sequel' })
    const { meta: parsed } = parseNoteFile(serializeNoteFile(original, ''))
    expect(parsed.title).toBe('Launch: the sequel')
  })
})

describe('leadingH1 / stripLeadingH1', () => {
  it('finds the title line and strips it from the body', () => {
    expect(leadingH1('# Title\n\nrest')).toBe('Title')
    expect(stripLeadingH1('# Title\n\nrest')).toBe('rest')
  })

  it('returns null when the body does not open with an H1', () => {
    expect(leadingH1('Some text\n# Not the first line')).toBeNull()
    expect(leadingH1('## Heading two')).toBeNull()
  })

  it('treats an empty H1 as no title', () => {
    expect(leadingH1('# \n\nrest')).toBeNull()
  })

  it('leaves a body without a leading H1 untouched', () => {
    expect(stripLeadingH1('no heading here')).toBe('no heading here')
  })
})

describe('replaceLeadingH1', () => {
  it('rewrites the title line and keeps the rest of the body', () => {
    expect(replaceLeadingH1('# Old\n\nbody', 'New')).toBe('# New\n\nbody')
  })

  it('leaves a body with no leading H1 alone', () => {
    expect(replaceLeadingH1('body only', 'New')).toBe('body only')
  })

  it('does not write the "Untitled" placeholder into an empty title block', () => {
    expect(replaceLeadingH1('# \n\nbody', 'Untitled')).toBe('# \n\nbody')
  })

  it('is a no-op when the title already matches', () => {
    const body = '# Same\n\nbody'
    expect(replaceLeadingH1(body, 'Same')).toBe(body)
  })
})
