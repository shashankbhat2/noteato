import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
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
import {
  MEETING_NOTES_TEMPLATES,
  type MeetingNotesState,
  type MeetingNotesTemplateId
} from '../../../shared/meetingNotes'
import { useTheme } from '../theme'
import { FONT_STACKS } from '../fonts'
import { getNoteatoTheme } from '../blocknoteTheme'
import { createNoteatoEditor, type NoteatoBlock } from '../noteLink'
import { BlockMenuButton } from './BlockDragMenu'

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
  { markdown: string; onSave: (markdown: string) => Promise<boolean> }
>(function MeetingNotesDocument({ markdown, onSave }, ref) {
  const { resolvedTheme, fontFamily } = useTheme()
  const [blocks, setBlocks] = useState<NoteatoBlock[] | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const dirty = useRef(false)
  const editVersion = useRef(0)
  const saving = useRef(false)

  useEffect(() => {
    const scratch = createNoteatoEditor()
    setBlocks(scratch.tryParseMarkdownToBlocks(markdown))
    dirty.current = false
    editVersion.current = 0
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
        sideMenu={false}
        onChange={() => {
          dirty.current = true
          editVersion.current += 1
          if (saveTimer.current) clearTimeout(saveTimer.current)
          saveTimer.current = setTimeout(() => void persist(), 600)
        }}
      >
        <SideMenuController
          sideMenu={MeetingNotesSideMenu}
          floatingUIOptions={{ useFloatingOptions: { placement: 'right-start' } }}
        />
      </BlockNoteView>
    </div>
  )
})

interface Props {
  state: MeetingNotesState
  onRetry: () => void
  onOpenSettings: () => void
  onSave: (markdown: string) => Promise<boolean>
  onSelectTemplate: (template: MeetingNotesTemplateId) => Promise<void>
}

export default function MeetingNotesView({
  state,
  onRetry,
  onOpenSettings,
  onSave,
  onSelectTemplate
}: Props) {
  const documentRef = useRef<MeetingNotesDocumentHandle>(null)
  const [selecting, setSelecting] = useState<MeetingNotesTemplateId | null>(null)

  const selectTemplate = async (template: MeetingNotesTemplateId): Promise<void> => {
    if (template === state.template || selecting) return
    setSelecting(template)
    try {
      await documentRef.current?.flush()
      await onSelectTemplate(template)
    } finally {
      setSelecting(null)
    }
  }

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
        <div className="meeting-notes-generation-head">
          <span className="meeting-notes-progress-dot" aria-hidden="true" />
          <strong>Preparing meeting notes</strong>
        </div>
        {state.content ? (
          <pre className="meeting-notes-stream">
            {state.content}
            <span className="meeting-notes-caret" />
          </pre>
        ) : (
          <div className="meeting-notes-simple-loader" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        )}
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
          <MeetingNotesDocument ref={documentRef} markdown={state.content} onSave={onSave} />
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

  return (
    <div className="meeting-notes-workspace">
      <div className="meeting-notes-templates" aria-label="Meeting notes template">
        <span>Template</span>
        <div>
          {MEETING_NOTES_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              className={state.template === template.id ? 'active' : ''}
              disabled={state.status === 'generating' || selecting !== null}
              title={template.description}
              onClick={() => void selectTemplate(template.id)}
            >
              {selecting === template.id ? 'Applying…' : template.label}
            </button>
          ))}
        </div>
      </div>
      {content}
    </div>
  )
}
