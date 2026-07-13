import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BlockNoteView } from '@blocknote/mantine'
import {
  SideMenu,
  SideMenuController,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  type DefaultReactSuggestionItem
} from '@blocknote/react'
import { filterSuggestionItems } from '@blocknote/core'
import { SideMenuExtension } from '@blocknote/core/extensions'
import { TextSelection } from '@tiptap/pm/state'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import {
  IconArrowsMaximize as UnfoldHorizontal,
  IconArrowsMinimize as FoldHorizontal,
  IconBell as Bell,
  IconCode as Code,
  IconFilePlus as FilePlus,
  IconFileText as FileText
} from '@tabler/icons-react'
import type { Note } from '../../../shared/types'
import { useTheme } from '../theme'
import { getNoteatoTheme } from '../blocknoteTheme'
import { FONT_STACKS } from '../fonts'
import { linkifyBlocks } from '../linkify'
import { formatReminderAt } from '../reminderPresets'
import {
  createNoteatoEditor,
  emitOpenNoteLink,
  type NoteatoBlock,
  type NoteatoEditor
} from '../noteLink'
import DictationPanel from './DictationPanel'
import FindReplaceBar from './FindReplaceBar'
import SelectionAiToolbar from './SelectionAiToolbar'
import SelectionAiPopup from './SelectionAiPopup'
import BlockDragMenu, { stripIds } from './BlockDragMenu'
import ContextMenu, { type MenuItem } from './ContextMenu'
import ReminderPopover from './ReminderPopover'

interface Props {
  path: string
  onSaved: (note: Note) => void
  onEditorReady?: (editor: NoteatoEditor | null) => void
}

interface AiPopupState {
  blocks: NoteatoBlock[]
  position: { x: number; y: number } | null
}

const SAVE_DEBOUNCE_MS = 600

// Blocks whose main content is editable prose — right-clicking these gets the
// text context menu (spelling, look up, search, cut/copy/paste); anything else
// (images, tables, files, dividers…) gets the block menu instead.
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

// Plain text of a block's inline content (mention chips contribute their title).
function inlineContentText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((item: Record<string, unknown>) => {
      if (item?.type === 'text') return String(item.text ?? '')
      if (item?.type === 'link') return inlineContentText(item.content)
      if (item?.type === 'noteLink') {
        return String((item.props as Record<string, unknown> | undefined)?.title ?? '')
      }
      return ''
    })
    .join('')
}

function isEmptyTextBlock(block: NoteatoBlock): boolean {
  const { content, children } = block as unknown as { content?: unknown; children?: unknown[] }
  return (
    Array.isArray(content) && content.length === 0 && (!children || children.length === 0)
  )
}

// Width of inline content in ProseMirror positions: text counts per character,
// link marks are transparent (their text counts), mention chips are one atom.
function inlineContentPmLength(content: unknown[]): number {
  let length = 0
  for (const item of content as Array<Record<string, unknown>>) {
    if (item?.type === 'text') length += String(item.text ?? '').length
    else if (item?.type === 'link') {
      length += inlineContentPmLength(Array.isArray(item.content) ? item.content : [])
    } else length += 1
  }
  return length
}

async function noteLinkItems(
  editor: NoteatoEditor,
  currentNoteId: string,
  query: string
): Promise<DefaultReactSuggestionItem[]> {
  const all = await window.api.notes.list()
  const q = query.trim().toLowerCase()
  return all
    .filter((n) => n.id !== currentNoteId)
    .filter(
      (n) =>
        !q ||
        (n.title || 'Untitled').toLowerCase().includes(q) ||
        n.path.toLowerCase().includes(q)
    )
    .slice(0, 8)
    .map((n) => ({
      title: n.title || 'Untitled',
      subtext: n.folder || undefined,
      icon: <FileText size={14} />,
      onItemClick: () => {
        editor.insertInlineContent([
          { type: 'noteLink', props: { noteId: n.id, title: n.title || 'Untitled' } },
          ' '
        ])
      }
    }))
}

// The sibling group (top-level or a nested children array) containing a block.
function findSiblingGroup(blocks: NoteatoBlock[], id: string): NoteatoBlock[] | null {
  for (const block of blocks) {
    if (block.id === id) return blocks
    const children = (block as unknown as { children?: NoteatoBlock[] }).children
    if (children && children.length > 0) {
      const found = findSiblingGroup(children, id)
      if (found) return found
    }
  }
  return null
}

// Slash menu: the default block items plus "New page" — creates a sibling
// note in the same folder, drops a mention chip at the cursor and opens it.
function slashMenuItems(
  editor: NoteatoEditor,
  note: Note,
  query: string
): DefaultReactSuggestionItem[] {
  const newPage: DefaultReactSuggestionItem = {
    title: 'New page',
    subtext: 'Create a page linked from here',
    aliases: ['page', 'subpage', 'newpage', 'create'],
    group: 'Pages',
    icon: <FilePlus size={18} />,
    onItemClick: () => {
      void (async () => {
        const created = await window.api.notes.create('Untitled', note.folder)
        editor.insertInlineContent([
          { type: 'noteLink', props: { noteId: created.id, title: created.title || 'Untitled' } },
          ' '
        ])
        emitOpenNoteLink(created.id)
      })()
    }
  }
  return filterSuggestionItems([...getDefaultReactSlashMenuItems(editor), newPage], query)
}

export default function NoteEditor({ path, onSaved, onEditorReady }: Props) {
  const { resolvedTheme, fontFamily, aiSelectionActions } = useTheme()
  const [note, setNote] = useState<Note | null>(null)
  const [title, setTitle] = useState('')
  const [fullWidth, setFullWidth] = useState(false)
  const [initialBlocks, setInitialBlocks] = useState<NoteatoBlock[] | 'loading'>('loading')
  const [markdownMode, setMarkdownMode] = useState(false)
  const [markdownText, setMarkdownText] = useState('')
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiPopup, setAiPopup] = useState<AiPopupState | null>(null)
  const [reminderPopover, setReminderPopover] = useState<{ x: number; y: number } | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findFocusTick, setFindFocusTick] = useState(0)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const rootRef = useRef<HTMLDivElement>(null)
  const pendingTitleCaret = useRef<number | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const reminderBtnRef = useRef<HTMLButtonElement>(null)
  const aiStreamingRef = useRef(false)
  const onEditorReadyRef = useRef(onEditorReady)
  onEditorReadyRef.current = onEditorReady

  useEffect(() => {
    if (!aiError) return
    const timer = setTimeout(() => setAiError(null), 4500)
    return () => clearTimeout(timer)
  }, [aiError])

  useEffect(() => {
    let cancelled = false
    setInitialBlocks('loading')
    setMarkdownMode(false)

    window.api.notes.read(path).then(async (loaded) => {
      if (cancelled) return
      setNote(loaded)
      setTitle(loaded.title)
      setFullWidth(loaded.fullWidth)

      const scratch = createNoteatoEditor()
      const blocks = loaded.body.trim()
        ? linkifyBlocks(await scratch.tryParseMarkdownToBlocks(loaded.body))
        : scratch.document
      if (!cancelled) setInitialBlocks(blocks)
    })

    return () => {
      cancelled = true
    }
  }, [path])

  const editor = useMemo(() => {
    if (initialBlocks === 'loading') return undefined
    return createNoteatoEditor(initialBlocks)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBlocks])

  // Expose the active editor so the app menu's Undo/Redo can drive its history.
  useEffect(() => {
    onEditorReadyRef.current?.(editor ?? null)
    return () => onEditorReadyRef.current?.(null)
  }, [editor])

  // Right-click menu inside the note body. The main process forwards the
  // context-menu event (it alone sees the OS spellchecker's suggestions);
  // text blocks get spelling + lookup + clipboard actions, other blocks get
  // the block menu. Hidden tabs' editors ignore the event — elementFromPoint
  // only ever hits the visible one.
  useEffect(() => {
    if (!editor) return
    return window.api.app.onContextMenu((params) => {
      const root = rootRef.current
      const target = document.elementFromPoint(params.x, params.y) as HTMLElement | null
      if (!root || !target || !root.contains(target) || !target.closest('.bn-editor')) return

      const blockId = target.closest<HTMLElement>('[data-node-type="blockOuter"]')?.dataset.id
      const block = blockId ? editor.getBlock(blockId) : undefined
      const items =
        block && !TEXT_BLOCK_TYPES.has(block.type)
          ? blockMenuItems(block)
          : textMenuItems(params)
      if (items.length > 0) setCtxMenu({ x: params.x, y: params.y, items })
    })
  }, [editor])

  // ⌘F routes here via the app menu; only the visible tab's editor reacts.
  useEffect(() => {
    const onFind = (): void => {
      if (!rootRef.current || rootRef.current.offsetParent === null) return
      setFindOpen(true)
      setFindFocusTick((t) => t + 1)
    }
    window.addEventListener('noteato:find', onFind)
    return () => window.removeEventListener('noteato:find', onFind)
  }, [])

  const blockMenuItems = (block: NoteatoBlock): MenuItem[] => [
    {
      label: 'Duplicate',
      onClick: () => {
        editor?.insertBlocks(
          [stripIds(block)] as Parameters<NoteatoEditor['insertBlocks']>[0],
          block.id,
          'after'
        )
      }
    },
    { separator: true, label: '' },
    { label: 'Delete', danger: true, onClick: () => editor?.removeBlocks([block]) }
  ]

  const textMenuItems = (
    params: Parameters<Parameters<typeof window.api.app.onContextMenu>[0]>[0]
  ): MenuItem[] => {
    const items: MenuItem[] = []
    if (params.misspelledWord) {
      const suggestions = params.dictionarySuggestions.slice(0, 5)
      for (const suggestion of suggestions) {
        items.push({
          label: suggestion,
          onClick: () => void window.api.app.replaceMisspelling(suggestion)
        })
      }
      if (suggestions.length === 0) items.push({ label: 'No guesses found' })
      items.push({
        label: 'Add to dictionary',
        onClick: () => void window.api.app.addToDictionary(params.misspelledWord)
      })
      items.push({ separator: true, label: '' })
    }
    const selection = params.selectionText.trim()
    if (selection) {
      const short = selection.length > 30 ? `${selection.slice(0, 30)}…` : selection
      if (window.electron.process.platform === 'darwin') {
        items.push({
          label: `Look Up “${short}”`,
          onClick: () => void window.api.app.lookUpSelection()
        })
      }
      items.push({
        label: 'Search with Google',
        onClick: () => void window.api.app.searchGoogle(selection)
      })
      items.push({ separator: true, label: '' })
    }
    if (selection && params.editFlags.canCut) {
      items.push({ label: 'Cut', onClick: () => void window.api.app.cut() })
    }
    if (selection && params.editFlags.canCopy) {
      items.push({ label: 'Copy', onClick: () => void window.api.app.copy() })
    }
    if (params.editFlags.canPaste) {
      items.push({ label: 'Paste', onClick: () => void window.api.app.paste() })
    }
    while (items.length > 0 && items[items.length - 1].separator) items.pop()
    return items
  }

  const save = async (
    markdown: string,
    nextTitle: string,
    nextFullWidth: boolean
  ): Promise<Note | undefined> => {
    if (!note) return undefined
    const saved = await window.api.notes.save(note.path, {
      title: nextTitle,
      body: markdown,
      tags: note.tags,
      fullWidth: nextFullWidth
    })
    setNote(saved)
    onSaved(saved)
    return saved
  }

  const currentMarkdown = async (): Promise<string> => {
    if (markdownMode) return markdownText
    return editor ? editor.blocksToMarkdownLossy(editor.document) : ''
  }

  const persist = async (nextTitle: string, nextFullWidth: boolean): Promise<Note | undefined> => {
    return save(await currentMarkdown(), nextTitle, nextFullWidth)
  }

  const scheduleSave = (nextTitle = title): void => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => persist(nextTitle, fullWidth), SAVE_DEBOUNCE_MS)
  }

  const handleAiStreamingChange = (streaming: boolean): void => {
    aiStreamingRef.current = streaming
    if (streaming) {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    } else {
      scheduleSave()
    }
  }

  const handleMarkdownChange = (value: string): void => {
    setMarkdownText(value)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => save(value, title, fullWidth), SAVE_DEBOUNCE_MS)
  }

  const toggleFullWidth = (): void => {
    const next = !fullWidth
    setFullWidth(next)
    persist(title, next)
  }

  // Live-clears the bell icon if this note's reminder fires while its tab is open.
  useEffect(() => {
    if (!note) return
    return window.api.reminders.subscribeFired((fired) => {
      if (fired.id !== note.id) return
      setNote((prev) => (prev ? { ...prev, reminderAt: fired.reminderAt } : prev))
    })
  }, [note?.id])

  const handleSetReminder = async (reminderAt: string | null): Promise<void> => {
    if (!note) return
    // A pending debounced autosave (e.g. a title edit) can still be in flight
    // and about to rename this note's file — flush it first and use its
    // result, not the pre-flush `note` closure, so the reminder is written
    // against the current path rather than one about to go stale.
    let base = note
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = undefined
      const flushed = await persist(title, fullWidth)
      if (flushed) base = flushed
    }
    let result
    try {
      result = await window.api.notes.setReminder(base.path, reminderAt)
    } catch {
      return
    }
    if (!result) return
    const updated = { ...base, reminderAt: result.reminderAt }
    setNote(updated)
    onSaved(updated)
    setReminderPopover(null)
  }

  const toggleMarkdownMode = async (): Promise<void> => {
    if (!editor) return
    if (!markdownMode) {
      setMarkdownText(await editor.blocksToMarkdownLossy(editor.document))
      setMarkdownMode(true)
    } else {
      // Re-parse the edited markdown back into blocks for the rich editor.
      const parsed = await editor.tryParseMarkdownToBlocks(markdownText)
      const blocks = parsed.length ? linkifyBlocks(parsed) : [{ type: 'paragraph' as const }]
      editor.replaceBlocks(editor.document, blocks)
      setMarkdownMode(false)
      save(markdownText, title, fullWidth)
    }
  }

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  const focusTitleAtEnd = (): void => {
    const input = titleRef.current
    if (input) {
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
    }
  }

  // After a first line bounces into the title, land the caret at the seam
  // between the old title and the pulled-up text (once React commits it).
  useLayoutEffect(() => {
    if (pendingTitleCaret.current === null) return
    const caret = pendingTitleCaret.current
    pendingTitleCaret.current = null
    const input = titleRef.current
    if (input) {
      input.focus()
      input.setSelectionRange(caret, caret)
    }
  }, [title])

  // Dragging a heading takes its whole section along: select from the heading
  // through every following sibling until the next heading or divider, so
  // BlockNote's drag logic (which drags the selection when the dragged block
  // is inside one) moves the unit together — including into toggle lists.
  const selectHeadingSection = (block: NoteatoBlock): void => {
    if (!editor || block.type !== 'heading') return
    const siblings = findSiblingGroup(editor.document as NoteatoBlock[], block.id)
    if (!siblings) return
    const start = siblings.findIndex((b) => b.id === block.id)
    if (start === -1) return
    let end = start
    for (let i = start + 1; i < siblings.length; i++) {
      const type = siblings[i].type
      if (type === 'heading' || type === 'divider') break
      end = i
    }
    if (end === start) return
    try {
      editor.setSelection(block.id, siblings[end].id)
    } catch {
      /* selection couldn't span the section — fall back to single-block drag */
    }
  }

  // Fires before the drag handle's own dragstart (capture phase): when the
  // hovered block is a heading, widen the selection to its section first so
  // BlockNote drags the whole unit.
  const handleDragStartCapture = (event: React.DragEvent): void => {
    if (!editor) return
    if (!(event.target as HTMLElement).closest?.('.bn-side-menu')) return
    try {
      const sideMenu = editor.getExtension(SideMenuExtension)
      const block = (sideMenu?.store?.state as { block?: NoteatoBlock } | undefined)?.block
      if (block) selectHeadingSection(block)
    } catch {
      /* side menu extension unavailable — plain single-block drag */
    }
  }

  // Merge a block's inline content into the end of the previous block and put
  // the caret at the seam — the direct merge BlockNote only does for
  // paragraphs, generalized so formatted blocks skip the convert-to-paragraph
  // step. The merged text adopts the previous block's type.
  const mergeIntoPreviousBlock = (block: NoteatoBlock, prev: NoteatoBlock): boolean => {
    if (!editor) return false
    const blockContent = (block as unknown as { content?: unknown }).content
    const prevContent = (prev as unknown as { content?: unknown }).content
    const blockChildren = (block as unknown as { children?: unknown[] }).children
    if (!Array.isArray(blockContent) || !Array.isArray(prevContent)) return false
    if (blockChildren && blockChildren.length > 0) return false
    if (prev.type === 'codeBlock') return false

    const seamOffset = inlineContentPmLength(prevContent)
    editor.updateBlock(prev, {
      content: [...prevContent, ...blockContent]
    } as Parameters<NoteatoEditor['updateBlock']>[1])
    editor.removeBlocks([block])

    const view = editor.prosemirrorView
    let seamPos: number | null = null
    view.state.doc.descendants((node, pos) => {
      if (seamPos !== null) return false
      if ((node.attrs as { id?: string } | undefined)?.id === prev.id) {
        // pos is before the block container; +1 enters it, +1 enters the
        // content node, then the original content's width lands on the seam.
        seamPos = pos + 2 + seamOffset
        return false
      }
      return true
    })
    if (seamPos !== null) {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, seamPos)))
    }
    return true
  }

  // Backspace at the start of the first (paragraph) block bounces the line
  // into the title: its text is appended to the title, the block is removed,
  // and the caret sits at the seam — the inverse of Enter in the title.
  const bounceFirstLineIntoTitle = (firstBlock: NoteatoBlock): void => {
    if (!editor) return
    const { children } = firstBlock as unknown as { children?: unknown[] }
    if (children && children.length > 0) {
      // Nested children would be deleted along with the block — just move the
      // caret up instead.
      focusTitleAtEnd()
      return
    }
    const text = inlineContentText((firstBlock as unknown as { content?: unknown }).content)
    if (editor.document.length > 1) {
      editor.removeBlocks([firstBlock])
    } else if (text) {
      editor.replaceBlocks([firstBlock], [{ type: 'paragraph' }])
    }
    if (text) {
      const next = title + text
      pendingTitleCaret.current = title.length
      setTitle(next)
      scheduleSave(next)
    } else {
      focusTitleAtEnd()
    }
  }

  // Arrow-up from the top line of the first block, or backspace at the very
  // start of it, moves the caret into the title — mirroring how Enter/down
  // in the title drops into the content.
  const handleEditorKeyDown = (event: React.KeyboardEvent): void => {
    if (!editor) return
    if (!(event.target as HTMLElement).closest?.('.bn-editor')) return

    if (event.key === 'ArrowUp') {
      try {
        const firstBlock = editor.document[0]
        const cursorBlock = editor.getTextCursorPosition().block
        if (
          !firstBlock ||
          cursorBlock.id !== firstBlock.id ||
          !editor.prosemirrorView.endOfTextblock('up')
        ) {
          return
        }
      } catch {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      focusTitleAtEnd()
      return
    }

    if (event.key === 'Backspace') {
      try {
        const view = editor.prosemirrorView
        if (!view.state.selection.empty || !view.endOfTextblock('backward')) return
        const cursor = editor.getTextCursorPosition()
        const isFormatted =
          cursor.block.type !== 'paragraph' &&
          cursor.block.type !== 'codeBlock' &&
          TEXT_BLOCK_TYPES.has(cursor.block.type)

        // Backspace at the start of a formatted block (heading, list, quote…)
        // never strips its formatting (BlockNote's default first step).
        // Instead: an empty block above is deleted, a block with content is
        // merged into directly, and a nested first child is un-nested.
        if (isFormatted) {
          if (cursor.prevBlock && isEmptyTextBlock(cursor.prevBlock)) {
            event.preventDefault()
            event.stopPropagation()
            editor.removeBlocks([cursor.prevBlock])
            return
          }
          if (cursor.prevBlock && mergeIntoPreviousBlock(cursor.block, cursor.prevBlock)) {
            event.preventDefault()
            event.stopPropagation()
            return
          }
          if (!cursor.prevBlock && cursor.block.id !== editor.document[0]?.id) {
            // Nested, first in its group — lift one level, keeping the type.
            if (editor.canUnnestBlock()) {
              event.preventDefault()
              event.stopPropagation()
              editor.unnestBlock()
            }
            return
          }
        }

        // First block of the note: bounce the line into the title (works for
        // formatted blocks too — the title is plain text either way).
        const firstBlock = editor.document[0]
        if (!firstBlock || cursor.block.id !== firstBlock.id) return
        if (firstBlock.type !== 'paragraph' && !isFormatted) return
        event.preventDefault()
        event.stopPropagation()
        bounceFirstLineIntoTitle(firstBlock)
      } catch {
        return
      }
      return
    }

    // Forward-delete on an empty paragraph in front of a formatted block:
    // remove the empty line and leave the block's formatting alone (the
    // default merge would pull the block's text up into the paragraph).
    if (event.key === 'Delete') {
      try {
        const view = editor.prosemirrorView
        if (!view.state.selection.empty) return
        const cursor = editor.getTextCursorPosition()
        if (
          cursor.block.type !== 'paragraph' ||
          !isEmptyTextBlock(cursor.block) ||
          !cursor.nextBlock ||
          cursor.nextBlock.type === 'paragraph'
        ) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        const next = cursor.nextBlock
        editor.removeBlocks([cursor.block])
        editor.setTextCursorPosition(next, 'start')
      } catch {
        return
      }
    }
  }

  // Runs after ProseMirror's own keydown handlers (bubble phase): any Tab it
  // left unhandled inside the editor — e.g. with several blocks selected —
  // indents/outdents instead of falling through to the browser's focus move.
  const handleEditorKeyDownBubble = (event: React.KeyboardEvent): void => {
    if (!editor || event.key !== 'Tab' || event.defaultPrevented) return
    if (!(event.target as HTMLElement).closest?.('.bn-editor')) return
    event.preventDefault()
    try {
      if (event.shiftKey) editor.unnestBlock()
      else editor.nestBlock()
    } catch {
      // Nothing to nest — swallowing the event still keeps focus in the editor.
    }
  }

  if (!editor || !note) return <div className="empty-state">Loading…</div>

  const segments = note.path.split('/')
  const fileLabel = segments[segments.length - 1].replace(/\.md$/, '')
  const folderSegments = segments.slice(0, -1)
  const reminderAt = note.reminderAt

  return (
    <div
      ref={rootRef}
      className={fullWidth ? 'note-editor full-width' : 'note-editor'}
      onKeyDownCapture={handleEditorKeyDown}
      onKeyDown={handleEditorKeyDownBubble}
      onDragStartCapture={handleDragStartCapture}
    >
      <div className="note-editor-toolbar">
        <div className="note-breadcrumb" title={note.path}>
          {folderSegments.map((seg, i) => (
            <span key={i} className="breadcrumb-seg">
              {seg}
              <span className="breadcrumb-sep">/</span>
            </span>
          ))}
          <span className="breadcrumb-file">{fileLabel}</span>
        </div>
        <div className="toolbar-actions">
          {!markdownMode && <DictationPanel editor={editor} />}
          <button
            ref={reminderBtnRef}
            className={reminderAt ? 'icon-toggle-btn active' : 'icon-toggle-btn'}
            onClick={() => {
              if (reminderPopover) {
                setReminderPopover(null)
                return
              }
              const rect = reminderBtnRef.current?.getBoundingClientRect()
              setReminderPopover(rect ? { x: rect.left, y: rect.bottom + 6 } : { x: 0, y: 80 })
            }}
            title={reminderAt ? `Reminder: ${formatReminderAt(reminderAt)}` : 'Set reminder'}
          >
            <Bell size={15} />
          </button>
          <button
            className={fullWidth ? 'icon-toggle-btn active' : 'icon-toggle-btn'}
            onClick={toggleFullWidth}
            title={fullWidth ? 'Use narrow width' : 'Use full width'}
          >
            {fullWidth ? <FoldHorizontal size={15} /> : <UnfoldHorizontal size={15} />}
          </button>
          <button
            className={markdownMode ? 'icon-toggle-btn active' : 'icon-toggle-btn'}
            onClick={toggleMarkdownMode}
            title={markdownMode ? 'Switch to rich editor' : 'Edit as plain markdown'}
          >
            <Code size={15} />
          </button>
        </div>
      </div>

      <div className="note-editor-header">
        <input
          ref={titleRef}
          className="note-title-input"
          value={title}
          placeholder="Untitled"
          onChange={(e) => {
            setTitle(e.target.value)
            scheduleSave(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (!markdownMode) editor.focus()
            } else if (e.key === 'ArrowDown' && !markdownMode) {
              e.preventDefault()
              const firstBlock = editor.document[0]
              editor.focus()
              if (firstBlock) editor.setTextCursorPosition(firstBlock.id, 'start')
            }
          }}
        />
      </div>

      {findOpen && !markdownMode && (
        <FindReplaceBar
          editor={editor}
          focusTick={findFocusTick}
          onClose={() => setFindOpen(false)}
        />
      )}

      {markdownMode ? (
        <textarea
          className="note-markdown-textarea"
          value={markdownText}
          spellCheck={false}
          placeholder="# Write markdown…"
          onChange={(e) => handleMarkdownChange(e.target.value)}
        />
      ) : (
        <>
          <BlockNoteView
            editor={editor}
            onChange={() => {
              if (!aiStreamingRef.current) scheduleSave()
            }}
            theme={getNoteatoTheme(resolvedTheme, FONT_STACKS[fontFamily])}
            formattingToolbar={false}
            sideMenu={false}
            slashMenu={false}
          >
            <SelectionAiToolbar editor={editor} aiActions={aiSelectionActions} onOpen={setAiPopup} />
            <SuggestionMenuController
              triggerCharacter="/"
              getItems={async (query) => slashMenuItems(editor, note, query)}
            />
            <SuggestionMenuController
              triggerCharacter="@"
              getItems={(query) => noteLinkItems(editor, note.id, query)}
            />
            <SideMenuController
              sideMenu={(props) => <SideMenu {...props} dragHandleMenu={BlockDragMenu} />}
            />
          </BlockNoteView>
          {aiPopup && (
            <SelectionAiPopup
              editor={editor}
              blocks={aiPopup.blocks}
              position={aiPopup.position}
              onError={setAiError}
              onStreamingChange={handleAiStreamingChange}
              onClose={() => setAiPopup(null)}
            />
          )}
        </>
      )}
      {aiError && <div className="ai-error-toast">{aiError}</div>}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenu.items}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {reminderPopover && (
        <ReminderPopover
          position={reminderPopover}
          value={reminderAt}
          onSet={(iso) => void handleSetReminder(iso)}
          onClear={() => void handleSetReminder(null)}
          onClose={() => setReminderPopover(null)}
        />
      )}
    </div>
  )
}
