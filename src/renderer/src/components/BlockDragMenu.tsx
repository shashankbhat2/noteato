import type { ReactNode } from 'react'
import { SideMenuExtension } from '@blocknote/core/extensions'
import {
  DragHandleMenu,
  useBlockNoteEditor,
  useComponentsContext,
  useExtensionState
} from '@blocknote/react'
import {
  IconBlockquote as TextQuote,
  IconCode as Code,
  IconCopy as Copy,
  IconCopyPlus as CopyPlus,
  IconH1 as Heading1,
  IconH2 as Heading2,
  IconH3 as Heading3,
  IconList as List,
  IconListCheck as ListChecks,
  IconListNumbers as ListOrdered,
  IconPilcrow as Pilcrow,
  IconTrash as Trash2
} from '@tabler/icons-react'
import type { NoteatoBlock, NoteatoEditor } from '../noteLink'

interface TurnIntoOption {
  label: string
  icon: ReactNode
  type: string
  props?: Record<string, unknown>
}

const TURN_INTO_OPTIONS: TurnIntoOption[] = [
  { label: 'Text', icon: <Pilcrow size={14} />, type: 'paragraph' },
  { label: 'Heading 1', icon: <Heading1 size={14} />, type: 'heading', props: { level: 1 } },
  { label: 'Heading 2', icon: <Heading2 size={14} />, type: 'heading', props: { level: 2 } },
  { label: 'Heading 3', icon: <Heading3 size={14} />, type: 'heading', props: { level: 3 } },
  { label: 'Bulleted list', icon: <List size={14} />, type: 'bulletListItem' },
  { label: 'Numbered list', icon: <ListOrdered size={14} />, type: 'numberedListItem' },
  { label: 'Check list', icon: <ListChecks size={14} />, type: 'checkListItem' },
  { label: 'Quote', icon: <TextQuote size={14} />, type: 'quote' },
  { label: 'Code', icon: <Code size={14} />, type: 'codeBlock' }
]

// Block types whose content can sensibly become another text block type.
const CONVERTIBLE_TYPES = new Set([
  'paragraph',
  'heading',
  'quote',
  'bulletListItem',
  'numberedListItem',
  'checkListItem',
  'toggleListItem',
  'codeBlock'
])

function useHoveredBlock(): NoteatoBlock | undefined {
  const editor = useBlockNoteEditor()
  return useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block
  }) as NoteatoBlock | undefined
}

function isActive(block: NoteatoBlock, option: TurnIntoOption): boolean {
  if (block.type !== option.type) return false
  if (!option.props) return true
  return Object.entries(option.props).every(
    ([key, value]) => (block.props as Record<string, unknown>)[key] === value
  )
}

function TurnIntoItems() {
  const Components = useComponentsContext()!
  const editor = useBlockNoteEditor() as unknown as NoteatoEditor
  const block = useHoveredBlock()
  if (!block || !CONVERTIBLE_TYPES.has(block.type)) return null

  return (
    <>
      <Components.Generic.Menu.Label className="bn-menu-label">
        Turn into
      </Components.Generic.Menu.Label>
      {TURN_INTO_OPTIONS.map((option) => (
        <Components.Generic.Menu.Item
          key={option.label}
          className="bn-menu-item"
          icon={option.icon}
          checked={isActive(block, option)}
          onClick={() => {
            editor.updateBlock(block, {
              type: option.type,
              props: option.props ?? {}
            } as Parameters<NoteatoEditor['updateBlock']>[1])
          }}
        >
          {option.label}
        </Components.Generic.Menu.Item>
      ))}
      <Components.Generic.Menu.Divider className="bn-menu-divider" />
    </>
  )
}

function CopyBlockItem() {
  const Components = useComponentsContext()!
  const editor = useBlockNoteEditor() as unknown as NoteatoEditor
  const block = useHoveredBlock()
  if (!block) return null

  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      icon={<Copy size={14} />}
      onClick={() => {
        void (async () => {
          const markdown = await editor.blocksToMarkdownLossy([
            block
          ] as Parameters<NoteatoEditor['blocksToMarkdownLossy']>[0])
          await navigator.clipboard.writeText(markdown)
        })()
      }}
    >
      Copy
    </Components.Generic.Menu.Item>
  )
}

// Deep-copy a block without ids so the editor assigns fresh ones on insert.
function stripIds(block: NoteatoBlock): Record<string, unknown> {
  const { id: _id, children, ...rest } = block as NoteatoBlock & { children?: NoteatoBlock[] }
  return { ...rest, children: (children ?? []).map(stripIds) }
}

function DuplicateBlockItem() {
  const Components = useComponentsContext()!
  const editor = useBlockNoteEditor() as unknown as NoteatoEditor
  const block = useHoveredBlock()
  if (!block) return null

  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      icon={<CopyPlus size={14} />}
      onClick={() => {
        editor.insertBlocks(
          [stripIds(block)] as Parameters<NoteatoEditor['insertBlocks']>[0],
          block.id,
          'after'
        )
      }}
    >
      Duplicate
    </Components.Generic.Menu.Item>
  )
}

function DeleteBlockItem() {
  const Components = useComponentsContext()!
  const editor = useBlockNoteEditor() as unknown as NoteatoEditor
  const block = useHoveredBlock()
  if (!block) return null

  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item bn-menu-item-danger"
      icon={<Trash2 size={14} />}
      onClick={() => {
        // Match RemoveBlockItem: delete the whole selection when the hovered
        // block is part of it.
        const selected = editor.getSelection()?.blocks
        const toRemove =
          selected && selected.some((b) => b.id === block.id) ? selected : [block]
        editor.removeBlocks(toRemove)
      }}
    >
      Delete
    </Components.Generic.Menu.Item>
  )
}

// Notion-style vertical drag-handle menu: turn-into rows for the block type,
// then the common block actions.
export default function BlockDragMenu() {
  return (
    <DragHandleMenu>
      <TurnIntoItems />
      <CopyBlockItem />
      <DuplicateBlockItem />
      <DeleteBlockItem />
    </DragHandleMenu>
  )
}
