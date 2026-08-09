import {
  BasicTextStyleButton,
  FormattingToolbar,
  FormattingToolbarController,
  blockTypeSelectItems,
  getFormattingToolbarItems,
  useComponentsContext
} from '@blocknote/react'
import { IconHeartHandshake as Handshake, IconSparkle as AiSpark } from '@tabler/icons-react'
import { RiCodeBoxLine } from 'react-icons/ri'
import type { NoteatoBlock, NoteatoEditor } from '../noteLink'

export interface SelectionOpenPayload {
  blocks: NoteatoBlock[]
  selectedText: string
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
  onOpen: (payload: SelectionOpenPayload) => void
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

    onOpen({
      blocks,
      selectedText: editor.getSelectedText(),
      position: rect ? { x: rect.left, y: rect.bottom } : null
    })
  }

  return (
    <components.FormattingToolbar.Button
      className="selection-bubble-action"
      label="Enhance"
      mainTooltip="Enhance"
      onClick={open}
    >
      <span className="selection-bubble-action-content">
        <AiSpark size={16} aria-hidden="true" />
        <span>Enhance</span>
      </span>
    </components.FormattingToolbar.Button>
  )
}

function HandoffButton({
  editor,
  onOpen
}: {
  editor: NoteatoEditor
  onOpen: (payload: SelectionOpenPayload) => void
}) {
  const components = useComponentsContext()
  if (!components) return null

  const open = (): void => {
    const selection = editor.getSelection()
    const blocks = selection?.blocks ?? []
    if (blocks.length === 0) return
    const domSelection = window.getSelection()
    const rect =
      domSelection && domSelection.rangeCount > 0
        ? domSelection.getRangeAt(0).getBoundingClientRect()
        : null
    onOpen({
      blocks,
      selectedText: editor.getSelectedText(),
      position: rect ? { x: rect.left, y: rect.bottom } : null
    })
  }

  return (
    <components.FormattingToolbar.Button
      className="selection-bubble-action"
      label="Handoff"
      mainTooltip="Delegate with a connected app"
      onClick={open}
    >
      <span className="selection-bubble-action-content">
        <Handshake size={16} aria-hidden="true" />
        <span>Handoff</span>
      </span>
    </components.FormattingToolbar.Button>
  )
}

interface Props {
  editor: NoteatoEditor
  /** Show the AI Enhance button (the rest of the toolbar always renders). */
  aiActions: boolean
  onOpen?: (payload: SelectionOpenPayload) => void
  onDelegate: (payload: SelectionOpenPayload) => void
}

export default function SelectionAiToolbar({ editor, aiActions, onOpen, onDelegate }: Props) {
  return (
    <FormattingToolbarController
      formattingToolbar={() => {
        // The first H1 is the note title, not a normal content heading. Its
        // type is fixed by the document model, so it has no formatting bubble.
        const selected = editor.getSelection()?.blocks ?? []
        const target = selected.length ? selected : [editor.getTextCursorPosition().block]
        const titleId = editor.document[0]?.id
        if (target.some((block) => block.id === titleId)) return null
        // A divider (e.g. right after typing "---") has nothing to format.
        if (target.every((block) => block.type === 'divider')) return null
        const allText = target.every((block) => TEXT_BLOCK_TYPES.has(block.type))
        const turnIntoItems = [
          ...blockTypeSelectItems(editor.dictionary),
          { name: 'Code block', type: 'codeBlock', icon: RiCodeBoxLine }
        ]
        const [blockTypeItem, ...formattingItems] = getFormattingToolbarItems(turnIntoItems)
        return (
          <FormattingToolbar>
            <div className="selection-bubble-row selection-bubble-block-type">
              {blockTypeItem}
            </div>
            <div className="selection-bubble-row selection-bubble-formatting">
              {formattingItems}
              <BasicTextStyleButton basicTextStyle="code" key="codeStyleButton" />
            </div>
            {allText && (
              <div className="selection-bubble-row selection-bubble-actions">
                {aiActions && onOpen && <EnhanceButton editor={editor} onOpen={onOpen} />}
                <HandoffButton editor={editor} onOpen={onDelegate} />
              </div>
            )}
          </FormattingToolbar>
        )
      }}
    />
  )
}
