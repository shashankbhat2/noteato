export type NoteAssistantTab = 'Note' | 'Transcript' | 'Meeting notes'

const SEARCH_STOP_WORDS = new Set([
  'about', 'also', 'and', 'are', 'been', 'can', 'could', 'did', 'does', 'for', 'from',
  'have', 'help', 'how', 'into', 'just', 'not', 'note', 'notes', 'our', 'please',
  'should', 'tell', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they',
  'this', 'was', 'were', 'what', 'when', 'where', 'which', 'who', 'why', 'will',
  'with', 'would', 'write', 'you', 'your'
])

/** Compact lexical queries for Noteato's local full-text note search. */
export function noteSearchQueries(question: string): string[] {
  const tokens = question.match(/#[\p{L}\p{N}_-]+|[\p{L}\p{N}][\p{L}\p{N}'_-]*/gu) ?? []
  const queries: string[] = []
  for (const token of tokens) {
    const normalized = token.toLowerCase()
    const isShortAcronym = token.length >= 2 && token === token.toUpperCase()
    if (
      (!normalized.startsWith('#') && normalized.length < 3 && !isShortAcronym) ||
      SEARCH_STOP_WORDS.has(normalized) ||
      queries.includes(normalized)
    ) {
      continue
    }
    queries.push(normalized)
    if (queries.length === 6) break
  }
  return queries
}

export function noteAssistantPrompt(context: {
  activeTab: NoteAssistantTab
  noteMarkdown: string
  transcriptMarkdown: string
  meetingNotesMarkdown: string
  relatedNotesMarkdown?: string
  conversation: string
}): string {
  return `ACTIVE TAB: ${context.activeTab}

--- NOTE TAB (the only target for <noteato-edit>) ---
${context.noteMarkdown}

--- TRANSCRIPT TAB (read-only context) ---
${context.transcriptMarkdown}

--- MEETING NOTES TAB (read-only context for this chat) ---
${context.meetingNotesMarkdown}

--- RELATED NOTES FROM LOCAL LIBRARY SEARCH (read-only, secondary context) ---
${context.relatedNotesMarkdown?.trim() || '(No related notes found.)'}

--- CONVERSATION ---
${context.conversation}`
}
