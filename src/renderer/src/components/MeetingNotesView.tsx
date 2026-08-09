import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentProps,
  type ReactNode
} from 'react'
import { BlockNoteView } from '@blocknote/mantine'
import { SideMenu, SideMenuController } from '@blocknote/react'
import {
  IconFileDescription as FileDescription,
  IconRefresh as Refresh,
  IconSparkles as Sparkles
} from '@tabler/icons-react'
import { type MeetingNotesState } from '../../../shared/meetingNotes'
import { useTheme } from '../theme'
import { FONT_STACKS } from '../fonts'
import { getNoteatoTheme } from '../blocknoteTheme'
import { createNoteatoEditor, type NoteatoBlock } from '../noteLink'
import { BlockMenuButton } from './BlockDragMenu'
import MarkdownText from './MarkdownText'
import SelectionAiToolbar, { type SelectionOpenPayload } from './SelectionAiToolbar'
import DelegatePopup from './DelegatePopup'

function MeetingNotesSideMenu(props: ComponentProps<typeof SideMenu>) {
  return (
    <SideMenu {...props}>
      <BlockMenuButton />
    </SideMenu>
  )
}

interface MeetingNotesDocumentHandle {
  flush: () => Promise<void>
}

const MeetingNotesDocument = forwardRef<
  MeetingNotesDocumentHandle,
  {
    noteId: string
    noteTitle: string
    markdown: string
    onSave: (markdown: string) => Promise<boolean>
    onError: (message: string) => void
  }
>(function MeetingNotesDocument({ noteId, noteTitle, markdown, onSave, onError }, ref) {
  const { resolvedTheme, fontFamily } = useTheme()
  const [blocks, setBlocks] = useState<NoteatoBlock[] | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const dirty = useRef(false)
  const editVersion = useRef(0)
  const saving = useRef(false)
  const [delegatePopup, setDelegatePopup] = useState<SelectionOpenPayload | null>(null)

  useEffect(() => {
    const scratch = createNoteatoEditor()
    setBlocks(scratch.tryParseMarkdownToBlocks(markdown))
    dirty.current = false
    editVersion.current = 0
    setDelegatePopup(null)
  }, [markdown])

  const editor = useMemo(() => (blocks ? createNoteatoEditor(blocks) : null), [blocks])

  const persist = async (): Promise<void> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = undefined
    }
    if (!editor || !dirty.current) return
    if (saving.current) {
      saveTimer.current = setTimeout(() => void persist(), 150)
      return
    }
    saving.current = true
    const version = editVersion.current
    try {
      const next = await editor.blocksToMarkdownLossy(editor.document)
      if (!(await onSave(next))) throw new Error('Meeting notes are unavailable.')
      if (editVersion.current === version) {
        dirty.current = false
      }
    } catch {
      // Keep the document dirty so the next edit or unmount retries the save.
    } finally {
      saving.current = false
      if (dirty.current && editVersion.current !== version) {
        saveTimer.current = setTimeout(() => void persist(), 150)
      }
    }
  }

  const flush = async (): Promise<void> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = undefined
    }
    while (saving.current) {
      await new Promise((resolve) => window.setTimeout(resolve, 20))
    }
    await persist()
    while (saving.current) {
      await new Promise((resolve) => window.setTimeout(resolve, 20))
    }
    if (dirty.current) await persist()
  }

  useImperativeHandle(ref, () => ({ flush }), [editor, onSave])

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (dirty.current) void persist()
    }
  }, [editor])

  if (!editor) return <div className="meeting-notes-document-loading" />

  return (
    <div className="meeting-notes-document">
      <BlockNoteView
        editor={editor}
        editable
        theme={getNoteatoTheme(resolvedTheme, FONT_STACKS[fontFamily])}
        formattingToolbar={false}
        sideMenu={false}
        onChange={() => {
          dirty.current = true
          editVersion.current += 1
          if (saveTimer.current) clearTimeout(saveTimer.current)
          saveTimer.current = setTimeout(() => void persist(), 600)
        }}
      >
        <SelectionAiToolbar
          editor={editor}
          aiActions={false}
          onDelegate={setDelegatePopup}
        />
        <SideMenuController
          sideMenu={MeetingNotesSideMenu}
          floatingUIOptions={{ useFloatingOptions: { placement: 'right-start' } }}
        />
      </BlockNoteView>
      {delegatePopup && (
        <DelegatePopup
          editor={editor}
          blocks={delegatePopup.blocks}
          selectedText={delegatePopup.selectedText}
          position={delegatePopup.position}
          noteId={noteId}
          noteTitle={noteTitle}
          tab="Meeting notes"
          onError={onError}
          onClose={() => setDelegatePopup(null)}
        />
      )}
    </div>
  )
})

/**
 * Keeps a glass generation edge attached to the measured end of the live
 * document. ResizeObserver catches both streamed lines and wrapping changes,
 * so the panel glides down instead of jumping between fixed loader states.
 */
function MeetingNotesStream({ markdown }: { markdown: string }) {
  const contentRef = useRef<HTMLDivElement>(null)
  const edgeRef = useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = useState(0)

  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content) return
    const measure = (): void => setContentHeight(Math.ceil(content.getBoundingClientRect().height))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const edge = edgeRef.current
    const scroller = edge?.closest(
      '.note-writing-surface, .note-meeting-notes-surface'
    ) as HTMLElement | null
    if (!edge || !scroller || contentHeight === 0) return
    const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    if (distanceFromBottom < 140) edge.scrollIntoView({ block: 'nearest' })
  }, [contentHeight])

  return (
    <div
      className="meeting-notes-stream-stage"
      style={{ '--meeting-notes-stream-height': `${contentHeight}px` } as CSSProperties}
    >
      <div className="meeting-notes-stream-document" ref={contentRef}>
        {markdown ? <MarkdownText text={markdown} /> : null}
      </div>
      <div className="meeting-notes-glass-loader" ref={edgeRef}>
        <Sparkles size={14} aria-hidden="true" />
        <strong>Enhancing</strong>
      </div>
    </div>
  )
}

interface Props {
  noteId: string
  noteTitle: string
  state: MeetingNotesState
  onRetry: () => void
  onOpenSettings: () => void
  onSave: (markdown: string) => Promise<boolean>
  onError: (message: string) => void
}

export interface MeetingNotesViewHandle {
  flush: () => Promise<void>
}

const MeetingNotesView = forwardRef<MeetingNotesViewHandle, Props>(function MeetingNotesView(
  { noteId, noteTitle, state, onRetry, onOpenSettings, onSave, onError },
  ref
) {
  const documentRef = useRef<MeetingNotesDocumentHandle>(null)

  useImperativeHandle(ref, () => ({
    flush: async () => {
      await documentRef.current?.flush()
    }
  }))

  let content: ReactNode
  if (state.status === 'waiting') {
    content = (
      <div className="note-transcription-empty meeting-notes-empty">
        <FileDescription size={19} />
        <strong>Meeting notes are waiting</strong>
        <span>They’ll prepare automatically as soon as a recording is transcribed.</span>
      </div>
    )
  } else if (state.status === 'unconfigured') {
    content = (
      <div className="note-transcription-empty meeting-notes-empty">
        <Sparkles size={19} />
        <strong>Connect an AI provider</strong>
        <span>Meeting notes use the lowest-cost model from your selected provider.</span>
        <button type="button" onClick={onOpenSettings}>
          Open settings
        </button>
      </div>
    )
  } else if (state.status === 'generating') {
    content = (
      <div className="meeting-notes-generating" aria-live="polite" aria-busy="true">
        <MeetingNotesStream markdown={state.content} />
      </div>
    )
  } else {
    content = (
      <div className="meeting-notes-ready">
        {state.status === 'failed' && (
          <p className="meeting-notes-error">
            <span>
              {state.error || 'Meeting notes could not be updated. The last saved version is safe.'}
            </span>
            <button type="button" onClick={onRetry} title="Try generating meeting notes again">
              <Refresh size={13} />
              Retry
            </button>
          </p>
        )}
        {state.content ? (
          <MeetingNotesDocument
            ref={documentRef}
            noteId={noteId}
            noteTitle={noteTitle}
            markdown={state.content}
            onSave={onSave}
            onError={onError}
          />
        ) : (
          <div className="note-transcription-empty meeting-notes-empty">
            <strong>Meeting notes could not be prepared</strong>
            <button type="button" onClick={onRetry}>
              Try again
            </button>
          </div>
        )}
      </div>
    )
  }

  return <div className="meeting-notes-workspace">{content}</div>
})

export default MeetingNotesView
