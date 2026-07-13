import {
  BasicTextStyleButton,
  FormattingToolbar,
  FormattingToolbarController,
  getFormattingToolbarItems,
  useComponentsContext
} from '@blocknote/react'
import { IconSparkles as Sparkles } from '@tabler/icons-react'
import type { NoteatoBlock, NoteatoEditor } from '../noteLink'

interface OpenPayload {
  blocks: NoteatoBlock[]
  position: { x: number; y: number } | null
}

// Enhance rewrites prose — only offer it when the whole selection is text.
const TEXT_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'quote',
  'bulletListItem',
  'numberedListItem',
  'checkListItem',
  'toggleListItem',
  'codeBlock'
])

function EnhanceButton({
  editor,
  onOpen
}: {
  editor: NoteatoEditor
  onOpen: (payload: OpenPayload) => void
}) {
  const components = useComponentsContext()
  if (!components) return null

  const open = (): void => {
    const selection = editor.getSelection()
    const blocks = selection?.blocks ?? []
    if (blocks.length === 0) return

    // Position the popup below the current text selection.
    const domSelection = window.getSelection()
    const rect =
      domSelection && domSelection.rangeCount > 0
        ? domSelection.getRangeAt(0).getBoundingClientRect()
        : null

    onOpen({ blocks, position: rect ? { x: rect.left, y: rect.bottom } : null })
  }

  return (
    <components.FormattingToolbar.Button
      label="Enhance"
      mainTooltip="Enhance"
      icon={<Sparkles size={16} />}
      onClick={open}
    />
  )
}

interface Props {
  editor: NoteatoEditor
  /** Show the AI Enhance button (the rest of the toolbar always renders). */
  aiActions: boolean
  onOpen: (payload: OpenPayload) => void
}

export default function SelectionAiToolbar({ editor, aiActions, onOpen }: Props) {
  return (
    <FormattingToolbarController
      formattingToolbar={() => {
        // Selecting a divider (e.g. right after typing "---") has nothing to
        // format or enhance — suppress the toolbar entirely.
        const selected = editor.getSelection()?.blocks ?? []
        const target = selected.length ? selected : [editor.getTextCursorPosition().block]
        if (target.every((block) => block.type === 'divider')) return null
        const allText = target.every((block) => TEXT_BLOCK_TYPES.has(block.type))
        return (
          <FormattingToolbar>
            {getFormattingToolbarItems()}
            <BasicTextStyleButton basicTextStyle="code" key="codeStyleButton" />
            {aiActions && allText && <EnhanceButton editor={editor} onOpen={onOpen} />}
          </FormattingToolbar>
        )
      }}
    />
  )
}
