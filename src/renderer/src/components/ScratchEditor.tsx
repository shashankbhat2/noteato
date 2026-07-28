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
import type { ScratchNote } from '../../../shared/types'
import { useTheme } from '../theme'
import { getNoteatoTheme } from '../blocknoteTheme'
import { FONT_STACKS } from '../fonts'
import { linkifyBlocks } from '../linkify'
import { ensureTitleBlock, enforceTitleBlock, titleFromMarkdown } from '../titleBlock'
import {
  createNoteatoEditor,
  type NoteatoBlock,
  type NoteatoEditor
} from '../noteLink'
import { formatReminderAt } from '../reminderPresets'
import ReminderPopover from './ReminderPopover'

const SAVE_DEBOUNCE_MS = 450

interface Props {
  note: ScratchNote
  onSaved: (note: ScratchNote) => void
}

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

/** Compact editor for a SQLite-backed scratch note (sidebar mode, quick note). */
export default function ScratchEditor({ note: summary, onSaved }: Props) {
  const { resolvedTheme, fontFamily } = useTheme()
  const [note, setNote] = useState<ScratchNote | null>(null)
  const [initialBlocks, setInitialBlocks] = useState<NoteatoBlock[] | null>(null)
  const [reminderPopover, setReminderPopover] = useState<{ x: number; y: number } | null>(null)
  const noteRef = useRef<ScratchNote | null>(null)
  const editorRef = useRef<NoteatoEditor | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const saveChain = useRef<Promise<void>>(Promise.resolve())
  const reminderButtonRef = useRef<HTMLButtonElement>(null)
  const persistRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    let cancelled = false
    void window.api.scratch.read(summary.id).then(async (loaded) => {
      if (cancelled || !loaded) return
      noteRef.current = loaded
      setNote(loaded)
      const scratch = createNoteatoEditor()
      const blocks = loaded.body.trim()
        ? linkifyBlocks(await scratch.tryParseMarkdownToBlocks(loaded.body))
        : scratch.document
      // The first block is the title (see titleBlock.ts).
      if (!cancelled) setInitialBlocks(ensureTitleBlock(blocks, loaded.title))
    })
    return () => {
      cancelled = true
    }
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
    const nextTitle = titleFromMarkdown(body) || 'Untitled'
    saveChain.current = saveChain.current
      .then(async () => {
        const base = noteRef.current
        if (!base) return
        const saved = await window.api.scratch.save(base.id, { title: nextTitle, body })
        if (!saved) return
        noteRef.current = saved
        setNote(saved)
        onSaved(saved)
      })
      .catch(() => {
        /* save failed — the next edit retries */
      })
    await saveChain.current
  }
  persistRef.current = persist

  const scheduleSave = (): void => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void persistRef.current(), SAVE_DEBOUNCE_MS)
  }

  // Re-assert "first block is the title H1" once the change has settled — see
  // enforceTitleBlock. Deferred so the fix-up never dispatches from inside the
  // transaction that triggered it.
  const titleFixQueued = useRef(false)
  const handleChange = (): void => {
    scheduleSave()
    if (titleFixQueued.current) return
    titleFixQueued.current = true
    queueMicrotask(() => {
      titleFixQueued.current = false
      if (editorRef.current) enforceTitleBlock(editorRef.current)
    })
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
    }
  }, [])

  // Reminder fired (or the note changed) in the main process / another window.
  useEffect(() => {
    return window.api.scratch.subscribeChanged((change) => {
      if (change.kind !== 'upsert' || change.note.id !== summary.id) return
      const base = noteRef.current
      if (!base) return
      // Only adopt metadata here; body edits from elsewhere remount via the
      // parent's revision key.
      const updated = { ...base, pinned: change.note.pinned, reminderAt: change.note.reminderAt }
      noteRef.current = updated
      setNote(updated)
    })
  }, [summary.id])

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
    const result = await window.api.scratch.setReminder(base.id, reminderAt)
    if (!result) return
    noteRef.current = result
    setNote(result)
    onSaved(result)
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
          onChange={handleChange}
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
