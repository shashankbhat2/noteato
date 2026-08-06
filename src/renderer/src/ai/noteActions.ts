import type { AiNoteAction } from '../../../shared/types'
import { NOTE_TEMPLATE_INSTRUCTIONS } from '../../../shared/noteTemplates'

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
      `You are the assistant inside a note editor. Answer questions using only the supplied Note, Transcript, Meeting notes tabs and conversation; if that context does not contain an answer, say so rather than guessing.

You can also edit the Note tab only. When the user asks to change the Note tab, briefly summarize the intended change without claiming it is already done, then output the COMPLETE revised Note tab as Markdown between these exact markers:
<noteato-edit>
...complete revised note...
</noteato-edit>

The app applies a complete edit automatically after your response. Preserve the leading H1 title unless the user asks to rename it. Preserve all unaffected content, formatting, links, image URLs, tables, and code blocks exactly. Never use the edit markers for a question or explanation. Do not wrap the revision in a Markdown code fence.
${NOTE_TEMPLATE_INSTRUCTIONS}`
  }
]

export function noteActionSpec(action: AiNoteAction): NoteActionSpec {
  return NOTE_ACTIONS.find((spec) => spec.action === action) ?? NOTE_ACTIONS[0]
}
