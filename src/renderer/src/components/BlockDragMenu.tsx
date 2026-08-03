import type { ReactNode } from 'react'
import { SideMenuExtension } from '@blocknote/core/extensions'
import {
  DragHandleMenu,
  useBlockNoteEditor,
  useComponentsContext,
  useExtension,
  useExtensionState
} from '@blocknote/react'
import {
  IconBlockquote as TextQuote,
  IconCode as Code,
  IconCopyPlus as CopyPlus,
  IconDotsVertical as DotsVertical,
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
    </>
  )
}

// Deep-copy a block without ids so the editor assigns fresh ones on insert.
export function stripIds(block: NoteatoBlock): Record<string, unknown> {
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

// Notion-style vertical block menu: turn-into rows for the block type, then the
// common block actions.
export default function BlockDragMenu() {
  return (
    <DragHandleMenu>
      <TurnIntoItems />
      <DuplicateBlockItem />
      <DeleteBlockItem />
    </DragHandleMenu>
  )
}

/**
 * The gutter button that opens that menu.
 *
 * BlockNote's own DragHandleButton hard-codes `draggable` and starts a block
 * drag on dragstart; blocks here are moved by editing, not by dragging, so this
 * is the same button without the drag — and with a menu glyph rather than the
 * grip, which would promise a drag that never happens.
 */
export function BlockMenuButton() {
  const Components = useComponentsContext()!
  const editor = useBlockNoteEditor()
  const sideMenu = useExtension(SideMenuExtension, { editor })
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block
  })
  if (block === undefined) return null

  return (
    <Components.Generic.Menu.Root
      onOpenChange={(open: boolean) => {
        // Keeps the gutter menu pinned to this block while its menu is open.
        if (open) sideMenu.freezeMenu()
        else sideMenu.unfreezeMenu()
      }}
      position="left"
    >
      <Components.Generic.Menu.Trigger>
        <Components.SideMenu.Button
          label="Block options"
          draggable={false}
          className="bn-button"
          icon={<DotsVertical size={17} />}
        />
      </Components.Generic.Menu.Trigger>
      <BlockDragMenu />
    </Components.Generic.Menu.Root>
  )
}
