import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BlockNoteView } from '@blocknote/mantine'
import {
  DragHandleButton,
  SideMenu,
  SideMenuController,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  type DefaultReactSuggestionItem,
  useBlockNoteEditor,
  useExtensionState
} from '@blocknote/react'
import { filterSuggestionItems } from '@blocknote/core'
import { SideMenuExtension, insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions'
import { TextSelection } from '@tiptap/pm/state'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import {
  IconCalendar as Calendar,
  IconDots as Dots,
  IconFilePlus as FilePlus,
  IconFileText as FileText,
  IconMicrophone as Microphone,
  IconPhoto as Photo,
  IconSparkle as Sparkle,
  IconStar as Star,
  IconStarFilled as StarFilled
} from '@tabler/icons-react'
import type { Note } from '../../../shared/types'
import { useTheme } from '../theme'
import { getNoteatoTheme } from '../blocknoteTheme'
import { FONT_STACKS } from '../fonts'
import { linkifyBlocks } from '../linkify'
import { imagesForMarkdown, restoreImageWidths } from '../../../shared/imagePersistence'
import {
  ensureTitleBlock,
  enforceTitleBlock,
  titleFromBlocks,
  titleFromMarkdown
} from '../titleBlock'
import {
  createNoteatoEditor,
  emitOpenNoteLink,
  type NoteatoBlock,
  type NoteatoEditor
} from '../noteLink'
import FindReplaceBar from './FindReplaceBar'
import SelectionAiToolbar from './SelectionAiToolbar'
import SelectionAiPopup from './SelectionAiPopup'
import BlockDragMenu, { stripIds } from './BlockDragMenu'
import ContextMenu, { type MenuItem } from './ContextMenu'
import ReminderPopover from './ReminderPopover'
import NoteOutline from './NoteOutline'
import NoteAiPanel from './NoteAiPanel'
import TagBar from './TagBar'

interface Props {
  /** Identity, not location — a rename must not look like a different note. */
  noteId: string
  onSaved: (note: Note) => void
  onEditorReady?: (editor: NoteatoEditor | null) => void
  /**
   * The pane's own move/close controls, rendered at the end of this toolbar.
   * A note has no other chrome to hang them off, and they're empty when only
   * one pane is open.
   */
  paneControls?: React.ReactNode
}

interface AiPopupState {
  blocks: NoteatoBlock[]
  position: { x: number; y: number } | null
}

type NoteSurface = 'note' | 'transcription' | 'chat'

const SAVE_DEBOUNCE_MS = 600

const REVEAL_LABEL =
  window.electron.process.platform === 'darwin' ? 'Reveal in Finder' : 'Show in folder'

function dateInputValue(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function noteDateLabel(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Set date'
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

function createdAtWithDate(iso: string, value: string): string | null {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  const next = new Date(iso)
  if (Number.isNaN(next.getTime())) return null
  next.setFullYear(year, month - 1, day)
  return next.toISOString()
}

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
  query: string,
  onImagePickerStateChange: (picking: boolean) => void,
  onImageInserted: () => void
): DefaultReactSuggestionItem[] {
  const newPage: DefaultReactSuggestionItem = {
    title: 'New page',
    aliases: ['page', 'subpage', 'newpage', 'create'],
    size: 'small',
    icon: <FilePlus size={14} />,
    onItemClick: () => {
      void (async () => {
        const created = await window.api.notes.create('Untitled')
        editor.insertInlineContent([
          { type: 'noteLink', props: { noteId: created.id, title: created.title || 'Untitled' } },
          ' '
        ])
        emitOpenNoteLink(created.id)
      })()
    }
  }
  const imageTitle = editor.dictionary.slash_menu.image.title
  const hiddenMediaTitles = new Set([
    editor.dictionary.slash_menu.audio.title,
    editor.dictionary.slash_menu.video.title,
    editor.dictionary.slash_menu.file.title
  ])
  const localImage: DefaultReactSuggestionItem = {
    title: imageTitle,
    aliases: ['image', 'photo', 'picture', 'media'],
    icon: <Photo size={14} />,
    size: 'small',
    onItemClick: () => {
      onImagePickerStateChange(true)
      // Create the block while the editor still owns focus. Native dialogs can
      // move the text selection, but the returned path can always update this
      // concrete block id.
      const imageBlock = insertOrUpdateBlockForSlashMenu(editor, { type: 'image' })
      const restoreParagraph = (): void => {
        const block = editor.getBlock(imageBlock.id)
        if (block?.type === 'image' && !block.props.url) {
          editor.updateBlock(imageBlock.id, { type: 'paragraph' })
        }
      }
      void window.api.images
        .chooseLocal()
        .then((linked) => {
          if (!linked || !editor.getBlock(imageBlock.id)) {
            restoreParagraph()
            onImagePickerStateChange(false)
            return
          }
          editor.updateBlock(imageBlock.id, {
            type: 'image',
            props: { name: linked.name, url: linked.url }
          })
          onImagePickerStateChange(false)
          onImageInserted()
        })
        .catch((error) => {
          restoreParagraph()
          onImagePickerStateChange(false)
          console.error('Unable to link local image', error)
        })
    }
  }
  const blockTypes = getDefaultReactSlashMenuItems(editor)
    .filter((item) => item.title !== imageTitle && !hiddenMediaTitles.has(item.title))
    .map((item) => ({
      ...item,
      group: undefined,
      subtext: undefined,
      badge: undefined,
      size: 'small' as const
    }))
  return filterSuggestionItems([...blockTypes, localImage, newPage], query)
}

/** The first H1 is the note title, not a movable content block. */
function NoteSideMenu(props: React.ComponentProps<typeof SideMenu>) {
  const editor = useBlockNoteEditor() as unknown as NoteatoEditor
  const hoveredBlock = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block
  }) as NoteatoBlock | undefined
  const firstBlock = editor.document[0]
  const isTitle =
    hoveredBlock?.id === firstBlock?.id &&
    firstBlock.type === 'heading' &&
    Number((firstBlock.props as { level?: number }).level) === 1

  if (isTitle) return null
  return (
    <SideMenu {...props}>
      <DragHandleButton dragHandleMenu={BlockDragMenu} />
    </SideMenu>
  )
}

export default function NoteEditor({ noteId, onSaved, onEditorReady, paneControls }: Props) {
  const { resolvedTheme, fontFamily, aiSelectionActions } = useTheme()
  const [note, setNote] = useState<Note | null>(null)
  const [headerTitle, setHeaderTitle] = useState('Untitled')
  const [fullWidth, setFullWidth] = useState(false)
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([])
  const [initialBlocks, setInitialBlocks] = useState<NoteatoBlock[] | 'loading'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiPopup, setAiPopup] = useState<AiPopupState | null>(null)
  const [reminderPopover, setReminderPopover] = useState<{ x: number; y: number } | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findFocusTick, setFindFocusTick] = useState(0)
  const [activeSurface, setActiveSurface] = useState<NoteSurface>('note')
  const [outlineVisible, setOutlineVisible] = useState(false)
  const [isSwitchingNote, setIsSwitchingNote] = useState(false)

  useEffect(() => {
    setActiveSurface('note')
    setOutlineVisible(false)
  }, [noteId])
  const overflowBtnRef = useRef<HTMLButtonElement>(null)
  // The overflow menu is built at click time from these, not from the render
  // closure that happened to create the handler.
  const reminderAtRef = useRef<string | null>(null)
  const fullWidthRef = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Tags change through their own save; a body autosave scheduled before that
  // must not write the pre-edit list back, so saves read the tags from here
  // rather than from whichever `note` their closure captured.
  const tagsRef = useRef<string[]>([])
  // Whether this pane is already showing a note, so a switch can keep the old
  // editor mounted while the next one loads.
  const hasLoadedRef = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const metadataRef = useRef<HTMLDivElement>(null)
  const reminderBtnRef = useRef<HTMLButtonElement>(null)
  const aiStreamingRef = useRef(false)
  // Native pickers blur the app. Do not persist the temporary empty image
  // block or the cleared slash query while the picker owns focus.
  const imagePickingRef = useRef(false)
  // True while an on-disk change is being applied to the editor — those
  // programmatic block swaps must not trigger a save of their own.
  const applyingExternalRef = useRef(false)
  const switchSettleFrameRef = useRef<number | null>(null)
  const onEditorReadyRef = useRef(onEditorReady)
  onEditorReadyRef.current = onEditorReady

  useEffect(() => {
    if (!aiError) return
    const timer = setTimeout(() => setAiError(null), 4500)
    return () => clearTimeout(timer)
  }, [aiError])

  useEffect(() => {
    let cancelled = false
    // Keep the current editor mounted while the replacement note is read and
    // parsed. Clearing it here made the entire document shell collapse into a
    // centred loading message on every sidebar click, then expand again.
    const replacingVisibleNote = hasLoadedRef.current
    if (replacingVisibleNote) setIsSwitchingNote(true)
    else setInitialBlocks('loading')
    setLoadError(null)

    const load = async (): Promise<void> => {
      const loaded = await window.api.notes.read(noteId)
      if (cancelled) return

      const scratch = createNoteatoEditor()
      const blocks = loaded.body.trim()
        ? restoreImageWidths(linkifyBlocks(await scratch.tryParseMarkdownToBlocks(loaded.body)))
        : scratch.document
      // The first block is the title; notes from before the title lived in the
      // body (or created empty) get their stored title prepended as an H1.
      // Externally linked files are shown exactly as they are on disk — no
      // title block is ever injected into someone else's markdown.
      if (!cancelled) {
        // Commit every piece of note-specific layout together. React batches
        // these updates, so title metadata, width and editor content change in
        // one paint instead of walking through several intermediate layouts.
        hasLoadedRef.current = true
        tagsRef.current = loaded.tags
        setNote(loaded)
        setHeaderTitle(loaded.title || 'Untitled')
        setFullWidth(loaded.fullWidth)
        setInitialBlocks(loaded.external ? blocks : ensureTitleBlock(blocks, loaded.title))

        if (switchSettleFrameRef.current !== null) {
          cancelAnimationFrame(switchSettleFrameRef.current)
        }
        switchSettleFrameRef.current = requestAnimationFrame(() => {
          switchSettleFrameRef.current = null
          if (!cancelled) setIsSwitchingNote(false)
        })
      }
    }

    // Without this the pane would sit on "Loading…" forever — a read that
    // rejects (moved or unlinked file) never resolves `initialBlocks`, and
    // there'd be nothing on screen to say so or to try again from.
    void load().catch((err: unknown) => {
      if (cancelled) return
      setIsSwitchingNote(false)
      setLoadError(err instanceof Error ? err.message : String(err))
    })

    return () => {
      cancelled = true
      if (switchSettleFrameRef.current !== null) {
        cancelAnimationFrame(switchSettleFrameRef.current)
        switchSettleFrameRef.current = null
      }
    }
  }, [noteId, loadAttempt])

  const editor = useMemo(() => {
    if (initialBlocks === 'loading') return undefined
    return createNoteatoEditor(initialBlocks)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBlocks])

  // The date is a sibling of BlockNote so it cannot become editable document
  // content. Measure the live H1 and place it below the title; the first block
  // reserves enough space to keep the body comfortably below the badge.
  useLayoutEffect(() => {
    const container = rootRef.current?.querySelector<HTMLElement>('.note-editor')
    const metadata = metadataRef.current
    if (!container || !metadata || !editor) return

    const observed = new Set<Element>()
    const resizeObserver = new ResizeObserver(() => sync())
    const observe = (element: Element): void => {
      if (observed.has(element)) return
      observed.add(element)
      resizeObserver.observe(element)
    }
    const sync = (): void => {
      const title = container.querySelector<HTMLElement>(
        '.bn-editor > .bn-block-group > .bn-block-outer:first-child h1'
      )
      if (!title) return
      observe(title)
      observe(metadata)
      const containerRect = container.getBoundingClientRect()
      const titleRect = title.getBoundingClientRect()
      if (titleRect.width === 0) return
      const metadataHeight = metadata.getBoundingClientRect().height
      container.style.setProperty(
        '--note-metadata-top',
        `${Math.max(0, titleRect.bottom - containerRect.top + 18)}px`
      )
      container.style.setProperty('--note-metadata-space', `${metadataHeight + 34}px`)
    }
    const mutationObserver = new MutationObserver(sync)
    mutationObserver.observe(container, { childList: true, subtree: true })
    window.addEventListener('resize', sync)
    sync()

    return () => {
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      window.removeEventListener('resize', sync)
      container.style.removeProperty('--note-metadata-top')
      container.style.removeProperty('--note-metadata-space')
    }
  }, [editor, note?.id])

  // Expose the active editor so the app menu's Undo/Redo can drive its history.
  useEffect(() => {
    // Capture the callback that registered this exact editor. During a note
    // switch the parent callback starts pointing at the next note before the
    // next editor exists; using the live ref in cleanup would unregister the
    // new id and leave the old editor in the map.
    const registeredCallback = onEditorReadyRef.current
    registeredCallback?.(editor ?? null)
    return () => registeredCallback?.(null)
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

  // The title is the body's leading `# …` line.
  const save = async (
    markdown: string,
    nextFullWidth: boolean,
    nextCreatedAt?: string
  ): Promise<Note | undefined> => {
    if (!note) return undefined
    const saved = await window.api.notes.save(noteId, {
      title: titleFromMarkdown(markdown) || 'Untitled',
      body: markdown,
      tags: tagsRef.current,
      createdAt: nextCreatedAt,
      fullWidth: nextFullWidth
    })
    setNote(saved)
    setHeaderTitle(saved.title || 'Untitled')
    tagsRef.current = saved.tags
    onSaved(saved)
    return saved
  }

  const currentMarkdown = async (): Promise<string> => {
    return editor ? editor.blocksToMarkdownLossy(imagesForMarkdown(editor.document)) : ''
  }

  const persist = async (nextFullWidth: boolean): Promise<Note | undefined> => {
    return save(await currentMarkdown(), nextFullWidth)
  }

  const scheduleSave = (): void => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => persist(fullWidth), SAVE_DEBOUNCE_MS)
  }

  // Re-assert "first block is the title H1" after a change settles. Deferred to
  // a microtask so the fix-up transaction never dispatches from inside the one
  // that triggered it; the flag collapses the burst of changes a single edit
  // can produce into one pass.
  const titleFixQueued = useRef(false)
  const scheduleTitleFix = (): void => {
    if (titleFixQueued.current) return
    titleFixQueued.current = true
    queueMicrotask(() => {
      titleFixQueued.current = false
      if (editor) enforceTitleBlock(editor)
    })
  }

  // A second renderer (sidebar mode) can open the same Markdown note. Flush
  // this editor as soon as its window yields focus so the next renderer reads
  // the latest body instead of racing a pending debounce.
  useEffect(() => {
    const flushOnWindowBlur = (): void => {
      if (!rootRef.current || rootRef.current.offsetParent === null) return
      if (imagePickingRef.current) return
      if (saveTimer.current) clearTimeout(saveTimer.current)
      void persist(fullWidth)
    }
    window.addEventListener('blur', flushOnWindowBlur)
    return () => window.removeEventListener('blur', flushOnWindowBlur)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullWidth, editor, note])

  const handleAiStreamingChange = (streaming: boolean): void => {
    aiStreamingRef.current = streaming
    if (streaming) {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    } else {
      scheduleSave()
    }
  }

  /**
   * Everything the header used to show as a permanent glyph. These are real
   * actions, but occasional ones — a row of icons for each is the header
   * competing with the document it frames.
   */
  const openOverflowMenu = (): void => {
    const rect = overflowBtnRef.current?.getBoundingClientRect()
    const x = rect ? rect.right - 210 : 0
    const y = rect ? rect.bottom + 6 : 80
    setCtxMenu({
      x,
      y,
      items: [
        {
          label: reminderAtRef.current ? 'Change reminder…' : 'Set reminder…',
          onClick: () => setReminderPopover({ x, y })
        },
        ...(reminderAtRef.current
          ? [{ label: 'Clear reminder', onClick: () => void handleSetReminder(null) }]
          : []),
        { separator: true, label: '' },
        {
          label: fullWidthRef.current ? 'Use narrow width' : 'Use full width',
          onClick: () => toggleFullWidth()
        },
        {
          label: outlineVisible ? 'Hide outline' : 'Show outline',
          onClick: () => setOutlineVisible((visible) => !visible)
        },
        {
          label: 'Find in note…',
          onClick: () => {
            setFindOpen(true)
            setFindFocusTick((t) => t + 1)
          }
        },
        { separator: true, label: '' },
        { label: 'Copy path', onClick: () => void window.api.notes.copyPath(noteId) },
        { label: REVEAL_LABEL, onClick: () => void window.api.notes.revealInFinder(noteId) }
      ]
    })
  }

  const toggleFullWidth = (): void => {
    const next = !fullWidth
    setFullWidth(next)
    persist(next)
  }

  // Externally linked notes always reflect the latest on-disk content: when
  // the file watcher reports a change, swap in the new blocks — unless local
  // edits are pending (an armed debounce means this editor is the source of
  // truth right now and will overwrite shortly anyway).
  useEffect(() => {
    if (!editor || !note?.external) return
    const { id } = note
    return window.api.notes.subscribeChanged((change) => {
      if (change.kind !== 'upsert' || change.note.id !== id) return
      if (saveTimer.current) return
      void (async () => {
        let latest: Note
        try {
          latest = await window.api.notes.read(id)
        } catch {
          return
        }
        const current = await editor.blocksToMarkdownLossy(imagesForMarkdown(editor.document))
        if (latest.body.trim() === current.trim()) {
          setNote((prev) => (prev ? { ...prev, updatedAt: latest.updatedAt } : prev))
          return
        }
        const scratch = createNoteatoEditor()
        const blocks = latest.body.trim()
          ? restoreImageWidths(linkifyBlocks(await scratch.tryParseMarkdownToBlocks(latest.body)))
          : scratch.document
        applyingExternalRef.current = true
        try {
          editor.replaceBlocks(editor.document, blocks)
        } finally {
          applyingExternalRef.current = false
        }
        setNote(latest)
        setHeaderTitle(latest.title || 'Untitled')
      })()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, note?.id, note?.external])

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
      const flushed = await persist(fullWidth)
      if (flushed) base = flushed
    }
    let result
    try {
      result = await window.api.notes.setReminder(noteId, reminderAt)
    } catch {
      return
    }
    if (!result) return
    const updated = { ...base, reminderAt: result.reminderAt }
    setNote(updated)
    onSaved(updated)
    setReminderPopover(null)
  }

  // Same flush-first dance as the reminder: a pending autosave may be about to
  // rename the file, so pin against the post-flush path.
  const handleTogglePin = async (): Promise<void> => {
    if (!note) return
    let base = note
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = undefined
      const flushed = await persist(fullWidth)
      if (flushed) base = flushed
    }
    let result
    try {
      result = await window.api.notes.setPinned(noteId, !base.pinned)
    } catch {
      return
    }
    if (!result) return
    const updated = { ...base, pinned: result.pinned }
    setNote(updated)
    onSaved(updated)
  }


  // Tags already in use across the library, offered as completions. Refreshed
  // whenever the tag bar could be about to be used (note switch, tag edit).
  const refreshTagSuggestions = async (): Promise<void> => {
    const all = await window.api.notes.list()
    const seen = new Map<string, string>()
    for (const summary of all) {
      for (const tag of summary.tags) {
        if (!seen.has(tag.toLowerCase())) seen.set(tag.toLowerCase(), tag)
      }
    }
    setTagSuggestions([...seen.values()].sort((a, b) => a.localeCompare(b)))
  }

  useEffect(() => {
    void refreshTagSuggestions()
  }, [noteId])

  // Tags ride along with a normal save, so this uses the same flush-first dance
  // as pin/reminder: a pending autosave may be about to rename the file.
  const handleSetTags = async (tags: string[]): Promise<void> => {
    if (!note) return
    tagsRef.current = tags
    setNote((prev) => (prev ? { ...prev, tags } : prev))
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = undefined
    }
    await persist(fullWidth)
    void refreshTagSuggestions()
  }

  const handleSetDate = async (value: string): Promise<void> => {
    if (!note || note.external) return
    const createdAt = createdAtWithDate(note.createdAt, value)
    if (!createdAt) return
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = undefined
    }
    await save(await currentMarkdown(), fullWidth, createdAt)
  }

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

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
    const target = event.target as HTMLElement
    const image = target.closest?.('[data-content-type="image"] .bn-visual-media')
    if (image) {
      const blockId = image.closest<HTMLElement>('[data-node-type="blockOuter"]')?.dataset.id
      const block = blockId ? editor.getBlock(blockId) : undefined
      if (block?.type === 'image') {
        editor.getExtension(SideMenuExtension)?.blockDragStart(event, block)
      }
      return
    }
    if (!target.closest?.('.bn-side-menu')) return
    try {
      const sideMenu = editor.getExtension(SideMenuExtension)
      const block = (sideMenu?.store?.state as { block?: NoteatoBlock } | undefined)?.block
      if (block) selectHeadingSection(block)
    } catch {
      /* side menu extension unavailable — plain single-block drag */
    }
  }

  const handleImagePointerDownCapture = (event: React.PointerEvent): void => {
    const image = (event.target as HTMLElement).closest?.<HTMLImageElement>(
      '[data-content-type="image"] .bn-visual-media'
    )
    if (image) image.draggable = true
  }

  const handleDragEndCapture = (event: React.DragEvent): void => {
    if (!editor) return
    if (!(event.target as HTMLElement).closest?.('[data-content-type="image"] .bn-visual-media')) {
      return
    }
    editor.getExtension(SideMenuExtension)?.blockDragEnd()
  }

  const handleDropCapture = (event: React.DragEvent): void => {
    if (
      !editor ||
      event.dataTransfer.types.includes('blocknote/html') ||
      event.dataTransfer.files.length === 0
    ) {
      return
    }
    const imageFiles = Array.from(event.dataTransfer.files).filter(
      (file) =>
        file.type.startsWith('image/') ||
        /\.(?:avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i.test(file.name)
    )
    if (imageFiles.length === 0) return

    event.preventDefault()
    event.stopPropagation()
    try {
      const linked = imageFiles
        .map((file) => window.api.images.linkDropped(file))
        .filter((value): value is { name: string; url: string } => value !== null)
      if (linked.length === 0) throw new Error('Dropped images did not expose local paths')

      const hit = document.elementFromPoint(event.clientX, event.clientY)
      const blockId = hit?.closest<HTMLElement>('[data-node-type="blockOuter"]')?.dataset.id
      const anchor = (blockId ? editor.getBlock(blockId) : undefined) ?? editor.document.at(-1)
      if (!anchor) return
      const rect = hit?.closest<HTMLElement>('[data-node-type="blockOuter"]')?.getBoundingClientRect()
      let placement: 'before' | 'after' = rect && event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
      if (anchor.id === editor.document[0]?.id) placement = 'after'

      editor.insertBlocks(
        linked.map(({ name, url }) => ({ type: 'image', props: { name, url } })),
        anchor,
        placement
      )
    } catch (error) {
      console.error('Unable to link dropped image', error)
      setAiError('Could not add the dropped image.')
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

  // Custom backspace/delete behavior for formatted blocks (the title H1 is a
  // normal block now, so there is no special-casing for the first line).
  const handleEditorKeyDown = (event: React.KeyboardEvent): void => {
    if (!editor) return
    if (!(event.target as HTMLElement).closest?.('.bn-editor')) return

    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'o') {
      event.preventDefault()
      event.stopPropagation()
      setOutlineVisible((visible) => !visible)
      return
    }

    if (event.key === 'Backspace') {
      try {
        const view = editor.prosemirrorView
        if (!view.state.selection.empty || !view.endOfTextblock('backward')) return
        const cursor = editor.getTextCursorPosition()
        // The title is permanently an H1. BlockNote normally demotes a heading
        // when Backspace is pressed at its start; restoring it on the next
        // transaction caused the visible paragraph/H1 flicker.
        if (cursor.block.id === editor.document[0]?.id) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
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

  if (loadError) {
    return (
      <div className="empty-state">
        <span>This note couldn’t be opened.</span>
        <span className="empty-state-detail">{loadError}</span>
        <button
          className="empty-state-btn"
          onClick={() => {
            hasLoadedRef.current = false
            setLoadAttempt((n) => n + 1)
          }}
        >
          Try again
        </button>
      </div>
    )
  }

  if (!editor || !note) return <div className="empty-state">Loading…</div>

  // Only the parent, never the whole path. The full location stays reachable
  // through Copy path / Reveal in Finder in the overflow menu — a filesystem
  // breadcrumb over every document is IDE furniture, not writing furniture.
  const segments = note.path.split('/')
  const parentLabel = note.external
    ? segments[segments.length - 2] || ''
    : segments.length > 1
      ? segments[segments.length - 2]
      : ''
  const reminderAt = note.reminderAt
  // Phase 2 will attach recording metadata to notes. Until then there is no
  // honest source of truth for a transcript, so the tab is present but locked.
  const hasRecording = false
  reminderAtRef.current = reminderAt
  fullWidthRef.current = fullWidth

  return (
    <div
      ref={rootRef}
      className={isSwitchingNote ? 'note-editor-shell switching-note' : 'note-editor-shell'}
      aria-busy={isSwitchingNote}
      onKeyDownCapture={handleEditorKeyDown}
      onKeyDown={handleEditorKeyDownBubble}
      onPointerDownCapture={handleImagePointerDownCapture}
      onDragStartCapture={handleDragStartCapture}
      onDragEndCapture={handleDragEndCapture}
      onDropCapture={handleDropCapture}
    >
      {/* Spans the card and stays put while the note scrolls beneath it. */}
      <div className="note-editor-toolbar">
        <div className="note-toolbar-leading">
          <span className="note-header-title" title={headerTitle}>
            {headerTitle}
          </span>
          {parentLabel && (
            <span className="note-location" title={note.path}>
              {parentLabel}
            </span>
          )}
        </div>
        <div className="toolbar-actions">
          <button
            className={
              note.pinned
                ? 'icon-toggle-btn note-favourite-btn active'
                : 'icon-toggle-btn note-favourite-btn'
            }
            onClick={() => void handleTogglePin()}
            title={note.pinned ? 'Remove from favourites' : 'Add to favourites'}
          >
            {note.pinned ? <StarFilled size={15} /> : <Star size={15} />}
          </button>
          <button
            ref={overflowBtnRef}
            className="icon-toggle-btn note-more-btn"
            onClick={openOverflowMenu}
            title="More…"
          >
            <Dots size={15} />
          </button>
          {paneControls}
        </div>
      </div>

      <div
        className={
          activeSurface === 'note' ? 'note-writing-surface active' : 'note-writing-surface'
        }
      >
        {outlineVisible && <NoteOutline editor={editor} />}

        <div className={fullWidth ? 'note-editor full-width' : 'note-editor'}>
          {findOpen && (
            <FindReplaceBar
              editor={editor}
              focusTick={findFocusTick}
              onClose={() => setFindOpen(false)}
            />
          )}

          {/* Tags sit above the title but remain outside contentEditable. */}
          <div className="note-title-tags">
            <TagBar
              tags={note.tags}
              suggestions={tagSuggestions}
              readOnly={note.external}
              onChange={(tags) => void handleSetTags(tags)}
            />
          </div>

          {/* The date stays below the title as a quiet document attribute. */}
          <div ref={metadataRef} className="note-metadata-row">
            <label
              className={note.external ? 'note-date-badge read-only' : 'note-date-badge'}
              title={note.external ? 'Date from linked file' : 'Change note date'}
            >
              <Calendar size={12} />
              <span>{noteDateLabel(note.createdAt)}</span>
              {!note.external && (
                <input
                  type="date"
                  aria-label="Note date"
                  value={dateInputValue(note.createdAt)}
                  onChange={(event) => void handleSetDate(event.target.value)}
                />
              )}
            </label>
          </div>

          <BlockNoteView
            editor={editor}
            onChange={() => {
              if (applyingExternalRef.current) return
              if (imagePickingRef.current) return
              // Linked files are shown exactly as they are on disk — a title
              // heading is never forced into someone else's markdown.
              if (!note.external) {
                scheduleTitleFix()
                // `scheduleTitleFix` runs first, so this reads the stable
                // leading H1 even when Backspace briefly tries to merge it.
                queueMicrotask(() => {
                  setHeaderTitle(titleFromBlocks(editor.document) || 'Untitled')
                })
              }
              if (!aiStreamingRef.current) scheduleSave()
            }}
            theme={getNoteatoTheme(resolvedTheme, FONT_STACKS[fontFamily])}
            formattingToolbar={false}
            sideMenu={false}
            slashMenu={false}
          >
            <SelectionAiToolbar
              editor={editor}
              aiActions={aiSelectionActions}
              onOpen={setAiPopup}
            />
            <SuggestionMenuController
              triggerCharacter="/"
              getItems={async (query) =>
                slashMenuItems(
                  editor,
                  note,
                  query,
                  (picking) => {
                    imagePickingRef.current = picking
                    if (picking && saveTimer.current) {
                      clearTimeout(saveTimer.current)
                      saveTimer.current = undefined
                    }
                  },
                  scheduleSave
                )
              }
            />
            <SuggestionMenuController
              triggerCharacter="@"
              getItems={(query) => noteLinkItems(editor, note.id, query)}
            />
            <SideMenuController
              sideMenu={NoteSideMenu}
              floatingUIOptions={{ useFloatingOptions: { placement: 'right-start' } }}
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
        </div>
      </div>

      <div className={activeSurface === 'chat' ? 'note-chat-slot active' : 'note-chat-slot'}>
        <NoteAiPanel
          subject={{ id: note.id, title: note.title, external: note.external }}
          editor={editor}
          active={activeSurface === 'chat'}
          onError={setAiError}
          onEditApplied={() => setActiveSurface('note')}
        />
      </div>

      <div
        className="note-surface-tabs note-surface-tabs-floating"
        role="tablist"
        aria-label="Note surfaces"
      >
        <button
          role="tab"
          aria-selected={activeSurface === 'note'}
          className={activeSurface === 'note' ? 'active' : ''}
          title="Note"
          onClick={() => setActiveSurface('note')}
        >
          <FileText size={13} />
          <span>Note</span>
        </button>
        <button
          role="tab"
          aria-selected={activeSurface === 'chat'}
          className={activeSurface === 'chat' ? 'active' : ''}
          title="Chat"
          onClick={() => setActiveSurface('chat')}
        >
          <Sparkle size={13} />
          <span>Chat</span>
        </button>
        <button
          role="tab"
          aria-selected={activeSurface === 'transcription'}
          className={activeSurface === 'transcription' ? 'active' : ''}
          disabled={!hasRecording}
          title="Transcription becomes available when this note has a recording"
        >
          <Microphone size={13} />
          <span>Transcription</span>
        </button>
      </div>

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
