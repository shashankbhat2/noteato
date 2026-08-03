export type NoteAssistantTab = 'Note' | 'Transcript' | 'Meeting notes'

export function noteAssistantPrompt(context: {
  activeTab: NoteAssistantTab
  noteMarkdown: string
  transcriptMarkdown: string
  meetingNotesMarkdown: string
  conversation: string
}): string {
  return `ACTIVE TAB: ${context.activeTab}

--- NOTE TAB (the only target for <noteato-edit>) ---
${context.noteMarkdown}

--- TRANSCRIPT TAB (read-only context) ---
${context.transcriptMarkdown}

--- MEETING NOTES TAB (read-only context for this chat) ---
${context.meetingNotesMarkdown}

--- CONVERSATION ---
${context.conversation}`
}
