import type { AiNoteAction } from '../../../shared/types'

/**
 * The named actions the note's bottom bar offers. Shared by the bar (which
 * invokes them) and the AI window (which runs them), so the label a user reads
 * and the prompt that runs are never two separate lists drifting apart.
 */
export interface NoteActionSpec {
  action: AiNoteAction
  label: string
  /** Shown while it runs, and as the AI window's heading. */
  runningLabel: string
  system: string
}

const NO_PREAMBLE = 'Respond with markdown only — no preamble, no explanation.'

export const NOTE_ACTIONS: NoteActionSpec[] = [
  {
    action: 'summarize',
    label: 'Summarize',
    runningLabel: 'Summarizing',
    system: `Summarize the following note content concisely, preserving the key facts. ${NO_PREAMBLE}`
  },
  {
    action: 'extract',
    label: 'Key points',
    runningLabel: 'Extracting key points',
    system: `Extract the key points from the following text as a concise markdown bullet list. ${NO_PREAMBLE}`
  },
  {
    action: 'improve',
    label: 'Improve writing',
    runningLabel: 'Improving',
    system: `Improve the clarity, grammar, and flow of the following text without changing its meaning or removing information. ${NO_PREAMBLE}`
  },
  {
    action: 'proofread',
    label: 'Proofread',
    runningLabel: 'Proofreading',
    system: `Proofread the following text: fix spelling, grammar, and punctuation without changing the meaning, tone, or formatting. Respond with the corrected text as markdown only — no preamble, no explanation.`
  },
  {
    action: 'ask',
    label: 'Ask…',
    runningLabel: 'Answering',
    system:
      'Answer the question using only the note content provided. If the note does not contain the answer, say so plainly rather than guessing. Respond in markdown.'
  }
]

export function noteActionSpec(action: AiNoteAction): NoteActionSpec {
  return NOTE_ACTIONS.find((spec) => spec.action === action) ?? NOTE_ACTIONS[0]
}
