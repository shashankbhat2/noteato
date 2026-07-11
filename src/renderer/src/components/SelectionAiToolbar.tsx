import {
  FormattingToolbar,
  FormattingToolbarController,
  getFormattingToolbarItems,
  useComponentsContext
} from '@blocknote/react'
import type { Block, BlockNoteEditor } from '@blocknote/core'
import { Sparkles } from 'lucide-react'

interface OpenPayload {
  blocks: Block[]
  position: { x: number; y: number } | null
}

function EnhanceButton({
  editor,
  onOpen
}: {
  editor: BlockNoteEditor
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
  editor: BlockNoteEditor
  onOpen: (payload: OpenPayload) => void
}

export default function SelectionAiToolbar({ editor, onOpen }: Props) {
  return (
    <FormattingToolbarController
      formattingToolbar={() => (
        <FormattingToolbar>
          {getFormattingToolbarItems()}
          <EnhanceButton editor={editor} onOpen={onOpen} />
        </FormattingToolbar>
      )}
    />
  )
}
