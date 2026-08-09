import type { AiProvider } from './types'
import { meetingMarkdown, type MeetingTranscript } from './meetingTranscript'

export const MEETING_NOTES_FILE = 'meeting-notes.md'
export const MEETING_NOTES_TEMPLATE_FILE = '.meeting-notes-template'

/** This background synthesis always uses the lowest-cost model per provider. */
export const CHEAPEST_MEETING_MODELS: Record<Exclude<AiProvider, 'none'>, string> = {
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-5.6-luna',
  xai: 'grok-build-0.1'
}

export type MeetingNotesTemplateId = 'standard' | 'actions' | 'oneOnOne' | 'standup'

export interface MeetingNotesTemplate {
  id: MeetingNotesTemplateId
  label: string
  description: string
  sections: string
}

export const DEFAULT_MEETING_NOTES_TEMPLATE: MeetingNotesTemplateId = 'standard'

export const MEETING_NOTES_TEMPLATES: readonly MeetingNotesTemplate[] = [
  {
    id: 'standard',
    label: 'General',
    description: 'Balanced summary, decisions and next steps',
    sections: '## Summary\n## Decisions\n## Action items\n## Discussion\n## Open questions'
  },
  {
    id: 'actions',
    label: 'Action plan',
    description: 'Commitments, owners, dates and blockers first',
    sections: '## Outcomes\n## Action items\n## Owners and dates\n## Blockers\n## Follow-ups'
  },
  {
    id: 'oneOnOne',
    label: '1:1',
    description: 'Updates, feedback and support',
    sections: '## Check-in\n## Updates\n## Feedback\n## Support needed\n## Commitments'
  },
  {
    id: 'standup',
    label: 'Stand-up',
    description: 'Progress, plans and blockers',
    sections: '## Progress\n## Next\n## Blockers\n## Follow-ups'
  }
] as const

export function isMeetingNotesTemplate(value: string): value is MeetingNotesTemplateId {
  return MEETING_NOTES_TEMPLATES.some((template) => template.id === value)
}

export type MeetingNotesStatus =
  | 'waiting'
  | 'generating'
  | 'ready'
  | 'failed'
  | 'unconfigured'

export interface MeetingNotesState {
  noteId: string
  template: MeetingNotesTemplateId
  status: MeetingNotesStatus
  /** Complete saved Markdown, or the partial stream while generating. */
  content: string
  error?: string
}

export function meetingNotesRequest(
  title: string,
  noteMarkdown: string,
  transcript: MeetingTranscript,
  templateId: MeetingNotesTemplateId = DEFAULT_MEETING_NOTES_TEMPLATE,
  currentMeetingNotes = ''
): { system: string; prompt: string } {
  const template =
    MEETING_NOTES_TEMPLATES.find((candidate) => candidate.id === templateId) ??
    MEETING_NOTES_TEMPLATES[0]
  const sections = template.sections
  return {
    system:
      'You are an exacting meeting-notes editor. Produce useful, concise Markdown from ' +
      'a time-linked transcript and the user’s own notes. Preserve deliberate edits in ' +
      'the current meeting-notes draft and treat user-authored text as higher priority ' +
      'than transcription wording. Never invent ' +
      'facts, owners, dates, decisions, or action items. Return Markdown only, with no ' +
      'code fence or commentary. Use only level-2 and level-3 Markdown headings (`##` and ' +
      '`###`). Never emit a level-1 (`#`) heading.',
    prompt: `Create the canonical meeting notes for “${title}”.

Use the “${template.label}” template below. Omit sections that have no real content:
${sections}

Use only H2 and H3 headings. Do not add a title heading, and normalize any H1 from the
current draft to H2.

Keep concrete names, numbers, dates and commitments. Make action items checkboxes and
include an owner or due date only when the sources explicitly provide one. Reconcile
rough personal notes with the transcript instead of repeating either source verbatim.

--- CURRENT MEETING NOTES (preserve and update) ---
${currentMeetingNotes.trim() || '(No existing meeting notes yet.)'}

--- USER NOTES (note.md) ---
${noteMarkdown.trim() || '(No personal notes yet.)'}

--- TRANSCRIPT (meeting.json) ---
${meetingMarkdown(transcript).trim() || '(No spoken content.)'}`
  }
}

/** Models occasionally wrap an otherwise correct document in a Markdown fence. */
export function cleanMeetingNotes(markdown: string): string {
  const trimmed = markdown.trim()
  const fenced = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed)
  return `${(fenced?.[1] ?? trimmed).trim()}\n`
}
