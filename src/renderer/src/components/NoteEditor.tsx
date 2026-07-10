import { useEffect, useMemo, useRef, useState } from 'react'
import { BlockNoteEditor, type Block } from '@blocknote/core'
import { BlockNoteView } from '@blocknote/mantine'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import { FoldHorizontal, UnfoldHorizontal } from 'lucide-react'
import type { Note } from '../../../shared/types'
import { useTheme } from '../theme'
import { getNoteatoTheme } from '../blocknoteTheme'
import { FONT_STACKS } from '../fonts'
import DictationPanel from './DictationPanel'
import SelectionAiToolbar from './SelectionAiToolbar'
import AskNotePanel from './AskNotePanel'

interface Props {
  filename: string
  onSaved: (note: Note) => void
}

const SAVE_DEBOUNCE_MS = 600

export default function NoteEditor({ filename, onSaved }: Props) {
  const { theme, fontFamily, zenMode, aiSelectionActions, aiAskNote } = useTheme()
  const [note, setNote] = useState<Note | null>(null)
  const [title, setTitle] = useState('')
  const [fullWidth, setFullWidth] = useState(false)
  const [initialBlocks, setInitialBlocks] = useState<Block[] | 'loading'>('loading')
  const [aiError, setAiError] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (!aiError) return
    const timer = setTimeout(() => setAiError(null), 4500)
    return () => clearTimeout(timer)
  }, [aiError])

  useEffect(() => {
    let cancelled = false
    setInitialBlocks('loading')

    window.api.notes.read(filename).then(async (loaded) => {
      if (cancelled) return
      setNote(loaded)
      setTitle(loaded.title)
      setFullWidth(loaded.fullWidth)

      const scratch = BlockNoteEditor.create()
      const blocks = loaded.body.trim()
        ? await scratch.tryParseMarkdownToBlocks(loaded.body)
        : scratch.document
      if (!cancelled) setInitialBlocks(blocks)
    })

    return () => {
      cancelled = true
    }
  }, [filename])

  const editor = useMemo(() => {
    if (initialBlocks === 'loading') return undefined
    return BlockNoteEditor.create({ initialContent: initialBlocks })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBlocks])

  const persist = async (nextTitle: string, nextFullWidth: boolean): Promise<void> => {
    if (!editor || !note) return
    const markdown = await editor.blocksToMarkdownLossy(editor.document)
    const saved = await window.api.notes.save(note.filename, {
      title: nextTitle,
      body: markdown,
      tags: note.tags,
      fullWidth: nextFullWidth
    })
    setNote(saved)
    onSaved(saved)
  }

  const scheduleSave = (nextTitle = title): void => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => persist(nextTitle, fullWidth), SAVE_DEBOUNCE_MS)
  }

  const toggleFullWidth = (): void => {
    const next = !fullWidth
    setFullWidth(next)
    persist(title, next)
  }

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  if (!editor || !note) return <div className="empty-state">Loading…</div>

  return (
    <div className={fullWidth ? 'note-editor full-width' : 'note-editor'}>
      <div className="note-editor-header">
        <input
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
              editor.focus()
            }
          }}
        />
        {aiAskNote && !zenMode && <AskNotePanel editor={editor} noteTitle={title} />}
        <button
          className={fullWidth ? 'icon-toggle-btn active' : 'icon-toggle-btn'}
          onClick={toggleFullWidth}
          title={fullWidth ? 'Use narrow width' : 'Use full width'}
        >
          {fullWidth ? <FoldHorizontal size={15} /> : <UnfoldHorizontal size={15} />}
        </button>
      </div>
      <BlockNoteView
        editor={editor}
        onChange={() => scheduleSave()}
        theme={getNoteatoTheme(theme, FONT_STACKS[fontFamily])}
        formattingToolbar={!aiSelectionActions}
      >
        {aiSelectionActions && <SelectionAiToolbar editor={editor} onError={setAiError} />}
      </BlockNoteView>
      <DictationPanel editor={editor} />
      {aiError && <div className="ai-error-toast">{aiError}</div>}
    </div>
  )
}
