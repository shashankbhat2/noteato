import { useEffect, useMemo, useRef, useState } from 'react'
import { BlockNoteView } from '@blocknote/mantine'
import {
  SideMenu,
  SideMenuController,
  SuggestionMenuController,
  type DefaultReactSuggestionItem
} from '@blocknote/react'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import {
  IconArrowsMaximize as UnfoldHorizontal,
  IconArrowsMinimize as FoldHorizontal,
  IconBell as Bell,
  IconCode as Code,
  IconFileText as FileText
} from '@tabler/icons-react'
import type { Note } from '../../../shared/types'
import { useTheme } from '../theme'
import { getNoteatoTheme } from '../blocknoteTheme'
import { FONT_STACKS } from '../fonts'
import { linkifyBlocks } from '../linkify'
import { formatReminderAt } from '../reminderPresets'
import { createNoteatoEditor, type NoteatoBlock, type NoteatoEditor } from '../noteLink'
import DictationPanel from './DictationPanel'
import SelectionAiToolbar from './SelectionAiToolbar'
import SelectionAiPopup from './SelectionAiPopup'
import BlockDragMenu from './BlockDragMenu'
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
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
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
        const firstBlock = editor.document[0]
        // Only once the first block is already a plain paragraph — otherwise
        // this backspace is BlockNote's own "convert to paragraph" step
        // (heading/list/todo → paragraph), which a second backspace then
        // follows into the title.
        if (!firstBlock || firstBlock.type !== 'paragraph') return
        const cursorBlock = editor.getTextCursorPosition().block
        if (
          cursorBlock.id !== firstBlock.id ||
          !editor.prosemirrorView.state.selection.empty ||
          !editor.prosemirrorView.endOfTextblock('backward')
        ) {
          return
        }
      } catch {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      focusTitleAtEnd()
    }
  }

  if (!editor || !note) return <div className="empty-state">Loading…</div>

  const segments = note.path.split('/')
  const fileLabel = segments[segments.length - 1].replace(/\.md$/, '')
  const folderSegments = segments.slice(0, -1)
  const reminderAt = note.reminderAt

  return (
    <div
      className={fullWidth ? 'note-editor full-width' : 'note-editor'}
      onKeyDownCapture={handleEditorKeyDown}
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
            formattingToolbar={!aiSelectionActions}
            sideMenu={false}
          >
            {aiSelectionActions && <SelectionAiToolbar editor={editor} onOpen={setAiPopup} />}
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
