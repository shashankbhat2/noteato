import { describe, expect, it } from 'vitest'
import { noteAssistantPrompt, noteSearchQueries } from '../src/shared/noteAssistantContext'

describe('note assistant context', () => {
  it('includes every note tab and identifies the active one', () => {
    const prompt = noteAssistantPrompt({
      activeTab: 'Transcript',
      noteMarkdown: '# Launch\n\nPersonal note',
      transcriptMarkdown: '**Them** · 0:12\n\nShip Friday',
      meetingNotesMarkdown: '## Decision\n\nShip Friday',
      relatedNotesMarkdown: '### Launch risks\n\nVendor approval is pending.',
      conversation: 'USER: What did we decide?'
    })

    expect(prompt).toContain('ACTIVE TAB: Transcript')
    expect(prompt).toContain('NOTE TAB')
    expect(prompt).toContain('Personal note')
    expect(prompt).toContain('TRANSCRIPT TAB')
    expect(prompt).toContain('Ship Friday')
    expect(prompt).toContain('MEETING NOTES TAB')
    expect(prompt).toContain('RELATED NOTES FROM LOCAL LIBRARY SEARCH')
    expect(prompt).toContain('Vendor approval is pending.')
    expect(prompt).toContain('CONVERSATION')
  })

  it('builds focused, deduplicated local note search queries', () => {
    expect(noteSearchQueries('What did we decide about the API launch launch #backend?')).toEqual([
      'decide',
      'api',
      'launch',
      '#backend'
    ])
  })
})
