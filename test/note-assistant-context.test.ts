import { describe, expect, it } from 'vitest'
import { noteAssistantPrompt } from '../src/shared/noteAssistantContext'

describe('note assistant context', () => {
  it('includes every note tab and identifies the active one', () => {
    const prompt = noteAssistantPrompt({
      activeTab: 'Transcript',
      noteMarkdown: '# Launch\n\nPersonal note',
      transcriptMarkdown: '**Them** · 0:12\n\nShip Friday',
      meetingNotesMarkdown: '## Decision\n\nShip Friday',
      conversation: 'USER: What did we decide?'
    })

    expect(prompt).toContain('ACTIVE TAB: Transcript')
    expect(prompt).toContain('NOTE TAB')
    expect(prompt).toContain('Personal note')
    expect(prompt).toContain('TRANSCRIPT TAB')
    expect(prompt).toContain('Ship Friday')
    expect(prompt).toContain('MEETING NOTES TAB')
    expect(prompt).toContain('CONVERSATION')
  })
})
