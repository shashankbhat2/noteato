import { useEffect, useMemo, useRef, useState } from 'react'
import { filterSuggestionItems } from '@blocknote/core'
import { BlockNoteView } from '@blocknote/mantine'
import {
  SuggestionMenuController,
  getDefaultReactSlashMenuItems
} from '@blocknote/react'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import {
  IconBell as Bell,
  IconBold as Bold,
  IconCheckbox as Checkbox,
  IconItalic as Italic,
  IconList as List
} from '@tabler/icons-react'
import type { Note, NoteSummary } from '../../../shared/types'
import { useTheme } from '../theme'
import { getNoteatoTheme } from '../blocknoteTheme'
import { FONT_STACKS } from '../fonts'
import { linkifyBlocks } from '../linkify'
import {
  createNoteatoEditor,
  type NoteatoBlock,
  type NoteatoEditor
} from '../noteLink'
import { formatReminderAt } from '../reminderPresets'
import ReminderPopover from './ReminderPopover'

const SAVE_DEBOUNCE_MS = 450

interface Props {
  note: NoteSummary
  onSaved: (note: Note) => void
}

type SaveStatus = 'idle' | 'saving' | 'saved'

function compactSlashItems(editor: NoteatoEditor, query: string) {
  const allowed = getDefaultReactSlashMenuItems(editor).filter((item) => {
    const label = item.title.toLowerCase()
    return (
      label === 'text' ||
      label === 'paragraph' ||
      label.includes('heading 1') ||
      label.includes('heading 2') ||
      label.includes('bullet') ||
      label.includes('numbered') ||
      label.includes('check') ||
      label.includes('quote')
    )
  })
  return filterSuggestionItems(allowed, query)
}

export default function SidebarModeEditor({ note: summary, onSaved }: Props) {
  const { resolvedTheme, fontFamily } = useTheme()
  const [note, setNote] = useState<Note | null>(null)
  const [title, setTitle] = useState(summary.title)
  const [initialBlocks, setInitialBlocks] = useState<NoteatoBlock[] | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [reminderPopover, setReminderPopover] = useState<{ x: number; y: number } | null>(null)
  const noteRef = useRef<Note | null>(null)
  const titleRef = useRef(summary.title)
  const editorRef = useRef<NoteatoEditor | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const savedStatusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const saveChain = useRef<Promise<void>>(Promise.resolve())
  const reminderButtonRef = useRef<HTMLButtonElement>(null)
  const persistRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    let cancelled = false
    void window.api.notes.read(summary.path).then(async (loaded) => {
      if (cancelled) return
      noteRef.current = loaded
      titleRef.current = loaded.title
      setNote(loaded)
      setTitle(loaded.title)
      const scratch = createNoteatoEditor()
      const blocks = loaded.body.trim()
        ? linkifyBlocks(await scratch.tryParseMarkdownToBlocks(loaded.body))
        : scratch.document
      if (!cancelled) setInitialBlocks(blocks)
    })
    return () => {
      cancelled = true
    }
    // The parent keys this component by note id, so a title-driven path rename
    // updates the list without tearing down the editor and moving the caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary.id])

  const editor = useMemo(() => {
    if (!initialBlocks) return null
    return createNoteatoEditor(initialBlocks)
  }, [initialBlocks])

  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  const persist = async (): Promise<void> => {
    const activeEditor = editorRef.current
    if (!activeEditor || !noteRef.current) return
    const body = await activeEditor.blocksToMarkdownLossy(activeEditor.document)
    const nextTitle = titleRef.current.trim() || 'Untitled'
    setSaveStatus('saving')
    saveChain.current = saveChain.current
      .then(async () => {
        const base = noteRef.current
        if (!base) return
        const saved = await window.api.notes.save(base.path, {
          title: nextTitle,
          body,
          tags: base.tags,
          fullWidth: base.fullWidth
        })
        noteRef.current = saved
        setNote(saved)
        onSaved(saved)
        setSaveStatus('saved')
        if (savedStatusTimer.current) clearTimeout(savedStatusTimer.current)
        savedStatusTimer.current = setTimeout(() => setSaveStatus('idle'), 1200)
      })
      .catch(() => setSaveStatus('idle'))
    await saveChain.current
  }
  persistRef.current = persist

  const scheduleSave = (): void => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void persistRef.current(), SAVE_DEBOUNCE_MS)
  }

  useEffect(() => {
    const flushOnWindowBlur = (): void => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      void persistRef.current()
    }
    window.addEventListener('blur', flushOnWindowBlur)
    return () => window.removeEventListener('blur', flushOnWindowBlur)
  }, [])

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (savedStatusTimer.current) clearTimeout(savedStatusTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!note) return
    return window.api.reminders.subscribeFired((fired) => {
      if (fired.id !== note.id) return
      const updated = { ...noteRef.current!, reminderAt: null }
      noteRef.current = updated
      setNote(updated)
      onSaved(updated)
    })
  }, [note?.id, onSaved])

  const setBlockType = (type: 'bulletListItem' | 'checkListItem'): void => {
    if (!editor) return
    try {
      const block = editor.getTextCursorPosition().block
      editor.updateBlock(block, {
        type: block.type === type ? 'paragraph' : type
      } as Parameters<NoteatoEditor['updateBlock']>[1])
      scheduleSave()
    } catch {
      /* no text cursor yet */
    }
  }

  const handleSetReminder = async (reminderAt: string | null): Promise<void> => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    await persist()
    const base = noteRef.current
    if (!base) return
    const result = await window.api.notes.setReminder(base.path, reminderAt)
    if (!result) return
    const updated: Note = { ...base, ...result, body: base.body }
    noteRef.current = updated
    setNote(updated)
    onSaved(updated)
    setReminderPopover(null)
  }

  if (!editor || !note) {
    return <div className="sidebar-mode-loading">Opening note…</div>
  }

  return (
    <div
      className="sidebar-mode-editor"
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        if (saveTimer.current) clearTimeout(saveTimer.current)
        void persistRef.current()
      }}
    >
      <div className="sidebar-editor-meta">
        <span className="sidebar-editor-path">{note.folder || 'Notes'}</span>
        <span className={`sidebar-save-state ${saveStatus}`}>
          {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : ''}
        </span>
      </div>

      <input
        className="sidebar-editor-title"
        value={title}
        placeholder="Untitled"
        onChange={(event) => {
          setTitle(event.target.value)
          titleRef.current = event.target.value
          scheduleSave()
        }}
        onBlur={() => void persist()}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          editor.focus()
        }}
      />

      <div
        className="sidebar-editor-formatting"
        aria-label="Formatting tools"
        onMouseDown={(event) => {
          // Keep BlockNote's selection alive while a compact toolbar button is
          // pressed; the click still fires, but focus never leaves the editor.
          if ((event.target as HTMLElement).closest('button')) event.preventDefault()
        }}
      >
        <button title="Bold" onClick={() => editor.toggleStyles({ bold: true })}>
          <Bold size={15} />
        </button>
        <button title="Italic" onClick={() => editor.toggleStyles({ italic: true })}>
          <Italic size={15} />
        </button>
        <span className="sidebar-format-divider" />
        <button title="Bulleted list" onClick={() => setBlockType('bulletListItem')}>
          <List size={15} />
        </button>
        <button title="Checklist" onClick={() => setBlockType('checkListItem')}>
          <Checkbox size={15} />
        </button>
        <span className="sidebar-format-spacer" />
        <button
          ref={reminderButtonRef}
          className={note.reminderAt ? 'active' : undefined}
          title={note.reminderAt ? formatReminderAt(note.reminderAt) : 'Set reminder'}
          onClick={() => {
            if (reminderPopover) {
              setReminderPopover(null)
              return
            }
            const rect = reminderButtonRef.current?.getBoundingClientRect()
            setReminderPopover(
              rect ? { x: rect.right - 240, y: rect.bottom + 6 } : { x: 120, y: 120 }
            )
          }}
        >
          <Bell size={15} />
        </button>
      </div>

      <div className="sidebar-editor-canvas">
        <BlockNoteView
          editor={editor}
          onChange={scheduleSave}
          theme={getNoteatoTheme(resolvedTheme, FONT_STACKS[fontFamily])}
          formattingToolbar={false}
          sideMenu={false}
          slashMenu={false}
        >
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={async (query) => compactSlashItems(editor, query)}
          />
        </BlockNoteView>
      </div>

      {reminderPopover && (
        <ReminderPopover
          position={reminderPopover}
          value={note.reminderAt}
          onSet={(iso) => void handleSetReminder(iso)}
          onClear={() => void handleSetReminder(null)}
          onClose={() => setReminderPopover(null)}
        />
      )}
    </div>
  )
}
