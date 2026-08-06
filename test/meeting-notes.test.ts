import { describe, expect, it } from 'vitest'
import {
  CHEAPEST_MEETING_MODELS,
  cleanMeetingNotes,
  MEETING_NOTES_TEMPLATES,
  meetingNotesRequest
} from '../src/shared/meetingNotes'
import type { MeetingTranscript } from '../src/shared/meetingTranscript'

const transcript: MeetingTranscript = {
  version: 1,
  engine: 'test',
  durationSeconds: 8,
  segments: [
    { speaker: 'me', start: 0, end: 1, text: 'Ship it Friday' },
    { speaker: 'them', start: 2, end: 3, text: 'I will send the draft' }
  ]
}

describe('derived meeting notes', () => {
  it('uses the cheapest explicit model for each configured provider', () => {
    expect(CHEAPEST_MEETING_MODELS.openai).toBe('gpt-5.6-luna')
    expect(CHEAPEST_MEETING_MODELS.anthropic).toContain('haiku')
    expect(CHEAPEST_MEETING_MODELS.xai).toBe('grok-build-0.1')
  })

  it('supplies both note.md and the time-linked transcript as context', () => {
    const request = meetingNotesRequest('Launch review', '# Launch review\n\nKeep scope small.', transcript)

    expect(request.prompt).toContain('USER NOTES (note.md)')
    expect(request.prompt).toContain('Keep scope small.')
    expect(request.prompt).toContain('TRANSCRIPT (meeting.json)')
    expect(request.prompt).toContain('Ship it Friday')
    expect(request.prompt).toContain('**Them** · 0:02')
  })

  it('removes a model-added Markdown fence before saving', () => {
    expect(cleanMeetingNotes('```markdown\n# Notes\n\nDone.\n```')).toBe('# Notes\n\nDone.\n')
  })

  it('offers distinct structures for the meeting-note templates', () => {
    expect(MEETING_NOTES_TEMPLATES.map((template) => template.id)).toEqual([
      'standard',
      'actions',
      'oneOnOne',
      'standup'
    ])
    expect(meetingNotesRequest('Weekly', '', transcript, 'standup').prompt).toContain(
      '## Blockers'
    )
    expect(meetingNotesRequest('Weekly', '', transcript, 'oneOnOne').prompt).toContain(
      '## Feedback'
    )
  })

  it('carries editable meeting-note content into the next recording update', () => {
    const request = meetingNotesRequest(
      'Weekly',
      '',
      transcript,
      'standard',
      '## Decisions\n\nKeep this deliberate edit.'
    )
    expect(request.prompt).toContain('CURRENT MEETING NOTES (preserve and update)')
    expect(request.prompt).toContain('Keep this deliberate edit.')
  })
})
