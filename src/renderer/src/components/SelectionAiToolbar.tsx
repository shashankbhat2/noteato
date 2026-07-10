import { useState, type ReactNode } from 'react'
import {
  FormattingToolbar,
  FormattingToolbarController,
  getFormattingToolbarItems,
  useComponentsContext
} from '@blocknote/react'
import type { BlockNoteEditor } from '@blocknote/core'
import { AlignLeft, ListChecks, Loader2, PenLine } from 'lucide-react'
import { aiComplete } from '../ai/client'

type SelectionAction = 'summarize' | 'improve' | 'extract'

const ACTION_PROMPTS: Record<SelectionAction, string> = {
  summarize:
    'Summarize the following note content concisely, preserving the key facts. Respond with markdown only — no preamble, no explanation.',
  improve:
    'Improve the clarity, grammar, and flow of the following text without changing its meaning or removing information. Respond with markdown only — no preamble, no explanation.',
  extract:
    'Extract the key points from the following text as a concise markdown bullet list. Respond with markdown only — no preamble, no explanation.'
}

const ACTION_LABELS: Record<SelectionAction, string> = {
  summarize: 'Summarize',
  improve: 'Improve writing',
  extract: 'Extract key points'
}

const ACTION_ICONS: Record<SelectionAction, ReactNode> = {
  summarize: <AlignLeft size={16} />,
  improve: <PenLine size={16} />,
  extract: <ListChecks size={16} />
}

const ACTIONS: SelectionAction[] = ['summarize', 'improve', 'extract']

function SelectionAiButtons({
  editor,
  onError
}: {
  editor: BlockNoteEditor
  onError: (message: string) => void
}) {
  const components = useComponentsContext()
  const [pending, setPending] = useState<SelectionAction | null>(null)

  if (!components) return null

  const run = async (action: SelectionAction): Promise<void> => {
    if (pending) return
    const selection = editor.getSelection()
    const blocks = selection?.blocks ?? []
    if (blocks.length === 0) return

    setPending(action)
    try {
      const settings = await window.api.settings.get()
      const markdown = await editor.blocksToMarkdownLossy(blocks)
      const result = await aiComplete(settings, {
        system: ACTION_PROMPTS[action],
        prompt: markdown,
        maxTokens: 1536
      })
      const newBlocks = await editor.tryParseMarkdownToBlocks(result)
      editor.replaceBlocks(blocks, newBlocks)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'AI request failed.')
    } finally {
      setPending(null)
    }
  }

  return (
    <>
      {ACTIONS.map((action) => (
        <components.FormattingToolbar.Button
          key={action}
          label={ACTION_LABELS[action]}
          mainTooltip={ACTION_LABELS[action]}
          icon={pending === action ? <Loader2 size={16} className="spin" /> : ACTION_ICONS[action]}
          isDisabled={pending !== null}
          onClick={() => run(action)}
          variant="compact"
        />
      ))}
    </>
  )
}

interface Props {
  editor: BlockNoteEditor
  onError: (message: string) => void
}

export default function SelectionAiToolbar({ editor, onError }: Props) {
  return (
    <FormattingToolbarController
      formattingToolbar={() => (
        <FormattingToolbar>
          {getFormattingToolbarItems()}
          <SelectionAiButtons editor={editor} onError={onError} />
        </FormattingToolbar>
      )}
    />
  )
}
