export type NativeActionCategory = 'Write' | 'Organize' | 'Extract'

export type NativeActionId =
  | 'draft-email'
  | 'write-follow-up'
  | 'create-todos'
  | 'create-agenda'
  | 'extract-decisions'

export interface NativeActionDefinition {
  id: NativeActionId
  category: NativeActionCategory
  label: string
  description: string
  runningLabel: string
  system: string
}

const MARKDOWN_ONLY =
  'Return the finished artifact as Markdown only. Do not describe your process and do not claim to have sent, scheduled, or changed anything.'

/**
 * Noteato-native actions are deliberately static. They are dependable entry
 * points into the same note assistant, not model-invented tools or side
 * effects. The optional text the user typed is included as extra direction.
 */
export const NATIVE_ACTIONS: readonly NativeActionDefinition[] = [
  {
    id: 'draft-email',
    category: 'Write',
    label: 'Draft email',
    description: 'Turn the note into a clear email',
    runningLabel: 'Drafting the email',
    system: `Draft a concise, ready-to-send email using the supplied note context. Include a useful subject line, greeting, body, and sign-off. Preserve names, dates, decisions, and links exactly. If a recipient or tone is supplied in the user's extra direction, follow it. ${MARKDOWN_ONLY}`
  },
  {
    id: 'write-follow-up',
    category: 'Write',
    label: 'Write follow-up',
    description: 'Prepare a short follow-up message',
    runningLabel: 'Writing the follow-up',
    system: `Write a brief follow-up message from the supplied note context. Make the ask, owner, and timing explicit without inventing missing facts. Preserve names, dates, and links exactly. ${MARKDOWN_ONLY}`
  },
  {
    id: 'create-todos',
    category: 'Organize',
    label: 'Create to-do list',
    description: 'Extract concrete next steps',
    runningLabel: 'Creating the to-do list',
    system: `Create a Markdown checklist from the supplied note context. Include only actionable tasks. Keep owners and due dates inline when they are present, and mark uncertain ownership or timing as unspecified instead of guessing. ${MARKDOWN_ONLY}`
  },
  {
    id: 'create-agenda',
    category: 'Organize',
    label: 'Create agenda',
    description: 'Shape the note into a meeting agenda',
    runningLabel: 'Creating the agenda',
    system: `Create a compact meeting agenda from the supplied note context. Use H2 and H3 headings only, include objectives and discussion points, and end with decisions or next steps to capture. Do not use an H1. ${MARKDOWN_ONLY}`
  },
  {
    id: 'extract-decisions',
    category: 'Extract',
    label: 'Decisions & owners',
    description: 'Pull out decisions, owners, and dates',
    runningLabel: 'Extracting decisions and owners',
    system: `Extract confirmed decisions, owners, commitments, and dates from the supplied note context. Separate confirmed items from open questions. Do not infer an owner or decision that is not explicitly supported. ${MARKDOWN_ONLY}`
  }
]

export const NATIVE_ACTION_CATEGORIES: readonly NativeActionCategory[] = [
  'Write',
  'Organize',
  'Extract'
]

export function nativeActionDefinition(id: string): NativeActionDefinition | null {
  return NATIVE_ACTIONS.find((action) => action.id === id) ?? null
}
