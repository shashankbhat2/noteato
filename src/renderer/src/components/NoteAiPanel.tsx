import { useEffect, useRef, useState } from 'react'
import {
  IconAlertCircle as AlertCircle,
  IconArrowUp as ArrowUp,
  IconCheck as Check,
  IconChecklist as Checklist,
  IconGavel as Decisions,
  IconLoader2 as Loader2,
  IconLayoutSidebarRight as LayoutSidebarRight,
  IconLayoutSidebarRightCollapse as LayoutSidebarRightCollapse,
  IconMail as Mail,
  IconMicrophone as Microphone,
  IconSquare as Square,
  IconTrash as Trash,
  IconX as X
} from '@tabler/icons-react'
import type { Settings } from '../../../shared/types'
import { meetingMarkdown } from '../../../shared/meetingTranscript'
import {
  noteAssistantPrompt,
  noteSearchQueries,
  type NoteAssistantTab
} from '../../../shared/noteAssistantContext'
import { imagesForMarkdown, restoreImageWidths } from '../../../shared/imagePersistence'
import { parseChatOutput } from '../../../shared/chatEdits'
import { aiErrorMessage } from '../../../shared/aiError'
import {
  parseTemplateOutput,
  visibleAgentMessage
} from '../../../shared/noteTemplates'
import {
  AI_PROVIDER_LABELS,
  AI_PROVIDER_ORDER,
  AUTO_AI_MODEL_ID,
  availableAiProviders,
  hasAiProviderKey,
  listedAiModels,
  normalizeAiModelChoice,
  resolveAiModelChoice
} from '../../../shared/aiModels'
import type { NoteatoEditor } from '../noteLink'
import { aiStream, isAiConfigured } from '../ai/client'
import { noteActionSpec } from '../ai/noteActions'
import { linkifyBlocks } from '../linkify'
import { ensureTitleBlock } from '../titleBlock'
import { useSpeechToText } from '../dictation/useDictation'
import MarkdownText from './MarkdownText'
import {
  nativeActionDefinition,
  type NativeActionId
} from '../../../shared/nativeActions'

const CHAT_ACTION_IDS: readonly NativeActionId[] = [
  'draft-email',
  'create-todos',
  'extract-decisions'
]

function chatActionLabel(id: NativeActionId): string {
  if (id === 'draft-email') return 'Write an email'
  if (id === 'create-todos') return 'Make tasks'
  return 'Find decisions'
}

export interface AiPanelSubject {
  id: string
  title: string
  external?: boolean
}

interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
  events?: AgentEvent[]
}

type AgentEventKind = 'activity' | 'message' | 'action' | 'result' | 'error'
type AgentEventStatus = 'active' | 'done' | 'error'

interface AgentEvent {
  id: string
  kind: AgentEventKind
  text: string
  status?: AgentEventStatus
}

/**
 * The collapsible Chat drawer for one note. It remains mounted while closed so
 * its draft and thread survive, while selection-level AI stays beside the
 * selected text in the editor's bubble menu.
 */
export default function NoteAiPanel({
  subject,
  editor,
  active,
  activeTab,
  draft,
  onDraftChange,
  onOpen,
  onClose,
  docked,
  onToggleDock,
  onError,
  onEditApplied
}: {
  subject: AiPanelSubject
  editor: NoteatoEditor
  active: boolean
  activeTab: NoteAssistantTab
  draft: string
  onDraftChange: (value: string) => void
  onOpen: () => void
  onClose: () => void
  docked: boolean
  onToggleDock: () => void
  onError: (message: string) => void
  onEditApplied: () => void
}) {
  const [threads, setThreads] = useState<Record<string, ChatTurn[]>>({})
  const [pending, setPending] = useState(false)
  const [composerFocused, setComposerFocused] = useState(false)
  const [aiSettings, setAiSettings] = useState<Settings | null>(null)
  const [selectedModel, setSelectedModel] = useState(AUTO_AI_MODEL_ID)
  const cancelRef = useRef<(() => void) | null>(null)
  const sendLockRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const dictatedChunksRef = useRef<Array<{ start: number; text: string }>>([])

  const {
    isRecording,
    error: dictationError,
    toggle: toggleDictation
  } = useSpeechToText({
    onTranscript: (transcript) => {
      const textarea = inputRef.current
      const current = textarea?.value ?? ''
      const start = textarea?.selectionStart ?? current.length
      const end = textarea?.selectionEnd ?? start
      const prefix = start > 0 && !/\s/.test(current[start - 1]) ? ' ' : ''
      const suffix = end < current.length && /\s/.test(current[end]) ? '' : ' '
      const addition = `${prefix}${transcript.trim()}${suffix}`
      dictatedChunksRef.current.push({ start, text: addition })
      onDraftChange(`${current.slice(0, start)}${addition}${current.slice(end)}`)
      if (!active) onOpen()
      requestAnimationFrame(() => {
        const nextCaret = start + addition.length
        inputRef.current?.focus({ preventScroll: true })
        inputRef.current?.setSelectionRange(nextCaret, nextCaret)
      })
    },
    onUndo: () => {
      const chunk = dictatedChunksRef.current.pop()
      if (!chunk) return
      const current = inputRef.current?.value ?? draft
      if (current.slice(chunk.start, chunk.start + chunk.text.length) === chunk.text) {
        onDraftChange(
          `${current.slice(0, chunk.start)}${current.slice(chunk.start + chunk.text.length)}`
        )
      } else if (current.endsWith(chunk.text)) {
        onDraftChange(current.slice(0, -chunk.text.length))
      }
    }
  })

  const thread = threads[subject.id] ?? []

  useEffect(() => {
    // Keep keyboard focus ready without dragging the pane's outer scroller to
    // the composer and hiding the chat header.
    if (active) inputRef.current?.focus({ preventScroll: true })
  }, [active, subject.id])

  useEffect(() => {
    if (dictationError) onError(dictationError)
  }, [dictationError, onError])

  useEffect(() => {
    dictatedChunksRef.current = []
    setComposerFocused(false)
  }, [subject.id])

  useEffect(() => {
    if (!active && isRecording) toggleDictation()
  }, [active, isRecording, toggleDictation])

  useEffect(() => {
    const el = scrollRef.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 90) el.scrollTop = el.scrollHeight
  }, [thread, pending])

  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      void window.api.settings.get().then((settings) => {
        if (cancelled) return
        setAiSettings(settings)
        setSelectedModel(normalizeAiModelChoice(settings.aiModel))
      })
    }
    load()
    window.addEventListener('noteato:ai-settings-changed', load)
    return () => {
      cancelled = true
      window.removeEventListener('noteato:ai-settings-changed', load)
    }
  }, [active])

  useEffect(() => () => cancelRef.current?.(), [])

  const noteMarkdown = (): string =>
    editor.blocksToMarkdownLossy(imagesForMarkdown(editor.document))

  const searchRelatedNotes = async (question: string): Promise<string> => {
    const queries = noteSearchQueries(question)
    if (queries.length === 0) return ''

    const resultSets = await Promise.all(
      queries.map((query) => window.api.notes.search(query).catch(() => []))
    )
    const ranked = new Map<string, { score: number }>()
    resultSets.forEach((results, queryIndex) => {
      results.slice(0, 6).forEach((result, resultIndex) => {
        if (result.id === subject.id) return
        const score = (queries.length - queryIndex) * 10 + (6 - resultIndex)
        ranked.set(result.id, { score: (ranked.get(result.id)?.score ?? 0) + score })
      })
    })

    const ids = [...ranked.entries()]
      .sort((left, right) => right[1].score - left[1].score)
      .slice(0, 4)
      .map(([id]) => id)
    const notes = await Promise.all(
      ids.map((id) => window.api.notes.read(id).catch(() => null))
    )
    return notes
      .filter((note) => note !== null)
      .map((note) => `### ${note.title || 'Untitled'}\n\n${note.body.slice(0, 5000)}`)
      .join('\n\n')
  }

  const stream = async (
    system: string,
    prompt: string,
    onText: (text: string) => void
  ): Promise<string> => {
    const settings: Settings = await window.api.settings.get()
    const selected = resolveAiModelChoice(selectedModel, settings.aiProvider, settings)
    let streamed = ''
    try {
      const final = await aiStream(
        settings,
        {
          system,
          prompt,
          maxTokens: 4096,
          provider: selected.provider,
          model: selected.model
        },
        (delta) => {
          streamed += delta
          onText(streamed)
        },
        (cancel) => {
          cancelRef.current = cancel
        }
      )
      return (final || streamed).trim()
    } finally {
      cancelRef.current = null
    }
  }

  const runNativeAction = async (actionId: NativeActionId): Promise<void> => {
    const action = nativeActionDefinition(actionId)
    if (!action || pending || sendLockRef.current) return
    onOpen()
    if (!chatEnabled) return
    sendLockRef.current = true
    setPending(true)
    const extraDirection = draft.trim()
    const userContent = extraDirection
      ? `${action.label} — ${extraDirection}`
      : action.label
    const history = [...thread, { role: 'user' as const, content: userContent }]
    let events: AgentEvent[] = [
      {
        id: 'context',
        kind: 'activity',
        text: 'Reading the note, transcript, and meeting notes',
        status: 'active'
      }
    ]
    const showAssistant = (): void => {
      const message = events.find((event) => event.kind === 'message')?.text ?? ''
      setThreads((previous) => ({
        ...previous,
        [subject.id]: [
          ...history,
          {
            role: 'assistant',
            content: message,
            events: events.map((event) => ({ ...event }))
          }
        ]
      }))
    }
    const updateEvent = (id: string, update: Partial<AgentEvent>): void => {
      events = events.map((event) => (event.id === id ? { ...event, ...update } : event))
    }
    const updateMessage = (text: string): void => {
      const next = text.trim()
      if (!next) return
      const index = events.findIndex((event) => event.id === 'message')
      if (index === -1) events = [...events, { id: 'message', kind: 'message', text: next }]
      else updateEvent('message', { text: next })
    }
    showAssistant()

    try {
      let sourceMarkdown: string
      try {
        sourceMarkdown = noteMarkdown()
      } catch {
        throw new Error('Could not read the current note for this action.')
      }
      const [meetingTranscript, meetingNotesMarkdown] = await Promise.all([
        window.api.meeting.getTranscript(subject.id).catch(() => null),
        window.api.meeting.getNotesMarkdown(subject.id).catch(() => null)
      ])
      const transcriptMarkdown = meetingTranscript
        ? meetingMarkdown(meetingTranscript)
        : '(No transcript for this note.)'
      const preparedMeetingNotes =
        meetingNotesMarkdown?.trim() || '(No meeting notes for this note.)'

      if (isRecording) toggleDictation()
      dictatedChunksRef.current = []
      onDraftChange('')
      updateEvent('context', { status: 'done' })
      events = [
        ...events,
        {
          id: 'action',
          kind: 'action',
          text: action.runningLabel,
          status: 'active'
        }
      ]
      showAssistant()
      const prompt = noteAssistantPrompt({
        activeTab,
        noteMarkdown: sourceMarkdown,
        transcriptMarkdown,
        meetingNotesMarkdown: preparedMeetingNotes,
        conversation: extraDirection
          ? `USER EXTRA DIRECTION: ${extraDirection}`
          : 'USER EXTRA DIRECTION: None. Use the supplied note context.'
      })
      const final = await stream(action.system, prompt, (text) => {
        updateMessage(text)
        showAssistant()
      })
      if (!final.trim()) throw new Error(`${action.label} returned no content.`)
      updateMessage(final)
      updateEvent('action', { status: 'done' })
      events = [
        ...events,
        { id: 'done', kind: 'result', text: 'Done', status: 'done' }
      ]
      showAssistant()
    } catch (error) {
      const message = aiErrorMessage(error)
      events = events.map((event) =>
        event.status === 'active' ? { ...event, status: 'error' as const } : event
      )
      events = [
        ...events,
        { id: 'error', kind: 'error', text: message, status: 'error' }
      ]
      showAssistant()
      onError(message)
    } finally {
      sendLockRef.current = false
      setPending(false)
    }
  }
  const nativeActionRunnerRef = useRef(runNativeAction)
  nativeActionRunnerRef.current = runNativeAction

  const send = async (): Promise<void> => {
    const question = draft.trim()
    if (!question || pending || sendLockRef.current || !chatEnabled) return
    sendLockRef.current = true
    setPending(true)
    const history = [...thread, { role: 'user' as const, content: question }]
    let events: AgentEvent[] = [
      {
        id: 'context',
        kind: 'activity',
        text: 'Reading the note and conversation context',
        status: 'active'
      },
      {
        id: 'search',
        kind: 'activity',
        text: 'Searching related notes',
        status: 'active'
      }
    ]
    const showAssistant = (): void => {
      const conversationalContent =
        events.find((event) => event.kind === 'message')?.text ??
        events.find((event) => event.kind === 'error')?.text ??
        ''
      setThreads((previous) => ({
        ...previous,
        [subject.id]: [
          ...history,
          {
            role: 'assistant',
            content: conversationalContent,
            events: events.map((event) => ({ ...event }))
          }
        ]
      }))
    }
    const updateEvent = (id: string, update: Partial<AgentEvent>): void => {
      events = events.map((event) => (event.id === id ? { ...event, ...update } : event))
    }
    const appendEvent = (event: AgentEvent): void => {
      if (!events.some((current) => current.id === event.id)) events = [...events, event]
    }
    const updateMessage = (text: string): void => {
      const message = text.trim()
      if (!message) return
      if (events.some((event) => event.id === 'message')) {
        updateEvent('message', { text: message })
      } else {
        appendEvent({ id: 'message', kind: 'message', text: message })
      }
    }
    showAssistant()

    try {
      let sourceMarkdown: string
      try {
        sourceMarkdown = noteMarkdown()
      } catch {
        throw new Error('Could not read the current note for the assistant.')
      }

      const [meetingTranscript, meetingNotesMarkdown, relatedNotesMarkdown] = await Promise.all([
        window.api.meeting.getTranscript(subject.id).catch(() => null),
        window.api.meeting.getNotesMarkdown(subject.id).catch(() => null),
        searchRelatedNotes(question)
      ])
      const transcriptMarkdown = meetingTranscript
        ? meetingMarkdown(meetingTranscript)
        : '(No transcript for this note.)'
      const preparedMeetingNotes =
        meetingNotesMarkdown?.trim() || '(No meeting notes for this note.)'

      if (isRecording) toggleDictation()
      dictatedChunksRef.current = []
      onDraftChange('')

      updateEvent('context', { status: 'done' })
      updateEvent('search', {
        status: 'done',
        text: relatedNotesMarkdown ? 'Found related notes' : 'No related notes found'
      })
      appendEvent({
        id: 'thinking',
        kind: 'activity',
        text: `Thinking with ${activeModelLabel}`,
        status: 'active'
      })
      showAssistant()
      const transcript = history
        .map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`)
        .join('\n\n')
      const prompt = noteAssistantPrompt({
        activeTab,
        noteMarkdown: sourceMarkdown,
        transcriptMarkdown,
        meetingNotesMarkdown: preparedMeetingNotes,
        relatedNotesMarkdown,
        conversation: transcript
      })

      const final = await stream(noteActionSpec('ask').system, prompt, (text) => {
        const parsed = parseChatOutput(text)
        const parsedTemplate = parseTemplateOutput(text)
        updateEvent('thinking', { status: 'done' })
        updateMessage(visibleAgentMessage(text))
        if (parsedTemplate.hasTemplateMarker) {
          if (!visibleAgentMessage(text)) {
            updateMessage('I’ll turn this note into a reusable template.')
          }
          appendEvent({
            id: 'prepare-template',
            kind: 'action',
            text: 'Identifying the reusable structure',
            status: 'active'
          })
        } else if (parsed.hasEditMarker) {
          if (!parsed.message) updateMessage('I’ll make those changes to the note now.')
          appendEvent({
            id: 'prepare-edit',
            kind: 'action',
            text: 'Preparing the revised note',
            status: 'active'
          })
        }
        showAssistant()
      })
      const parsed = parseChatOutput(final)
      const parsedTemplate = parseTemplateOutput(final)
      if (parsedTemplate.hasTemplateMarker && !parsedTemplate.draft) {
        throw new Error('The model stopped before it finished the template. Try again.')
      }
      if (parsed.hasEditMarker && !parsed.proposedMarkdown) {
        throw new Error('The model stopped before it finished the note changes. Try a smaller change.')
      }
      if (parsedTemplate.draft) {
        updateEvent('thinking', { status: 'done' })
        updateMessage(
          parsedTemplate.message || `I’ll create “${parsedTemplate.draft.name}” from this note.`
        )
        if (events.some((event) => event.id === 'prepare-template')) {
          updateEvent('prepare-template', { status: 'done' })
        } else {
          appendEvent({
            id: 'prepare-template',
            kind: 'action',
            text: 'Identifying the reusable structure',
            status: 'done'
          })
        }
        appendEvent({
          id: 'save-template',
          kind: 'action',
          text: `Saving “${parsedTemplate.draft.name}”`,
          status: 'active'
        })
        showAssistant()
        const template = await window.api.templates.create({
          ...parsedTemplate.draft,
          sourceNoteId: subject.id
        })
        updateEvent('save-template', { status: 'done' })
        appendEvent({
          id: 'done',
          kind: 'result',
          text: `Template created: ${template.name}`,
          status: 'done'
        })
        window.dispatchEvent(new Event('noteato:templates-changed'))
        showAssistant()
      } else if (parsed.proposedMarkdown) {
        updateEvent('thinking', { status: 'done' })
        updateMessage(parsed.message || 'I’ll make those changes to the note now.')
        if (!events.some((event) => event.id === 'prepare-edit')) {
          appendEvent({
            id: 'prepare-edit',
            kind: 'action',
            text: 'Preparing the revised note',
            status: 'done'
          })
        } else {
          updateEvent('prepare-edit', { status: 'done' })
        }
        appendEvent({
          id: 'apply-edit',
          kind: 'action',
          text: 'Updating the note',
          status: 'active'
        })
        showAssistant()
        await applyProposedEdit(parsed.proposedMarkdown, sourceMarkdown)
        updateEvent('apply-edit', { status: 'done' })
        appendEvent({
          id: 'done',
          kind: 'result',
          text: 'Note updated',
          status: 'done'
        })
        showAssistant()
      } else {
        if (!parsed.message) throw new Error('The model returned an empty response.')
        updateEvent('thinking', { status: 'done' })
        updateMessage(parsed.message)
        appendEvent({
          id: 'done',
          kind: 'result',
          text: 'Done',
          status: 'done'
        })
        showAssistant()
      }
    } catch (error) {
      const message = aiErrorMessage(error)
      events = events.map((event) =>
        event.status === 'active' ? { ...event, status: 'error' as const } : event
      )
      appendEvent({
        id: 'error',
        kind: 'error',
        text: message,
        status: 'error'
      })
      showAssistant()
      onError(message)
    } finally {
      sendLockRef.current = false
      setPending(false)
    }
  }

  const applyProposedEdit = async (
    proposedMarkdown: string,
    sourceMarkdown: string
  ): Promise<void> => {
    const currentMarkdown = noteMarkdown()
    if (currentMarkdown.trim() !== sourceMarkdown.trim()) {
      throw new Error('The note changed while the edit was being prepared. Ask the assistant to try again.')
    }

    const parsed = restoreImageWidths(
      linkifyBlocks(await editor.tryParseMarkdownToBlocks(proposedMarkdown))
    )
    if (parsed.length === 0) {
      throw new Error('The model returned note changes with no editable content.')
    }
    const nextBlocks = subject.external ? parsed : ensureTitleBlock(parsed, subject.title)
    editor.replaceBlocks(
      editor.document.map((block) => block.id),
      nextBlocks
    )
    onEditApplied()
  }

  const resolvedModel = resolveAiModelChoice(
    selectedModel,
    aiSettings?.aiProvider,
    aiSettings ?? undefined
  )
  const chatEnabled = aiSettings ? isAiConfigured(aiSettings, resolvedModel.provider) : false
  const activeModelLabel = selectedModel === AUTO_AI_MODEL_ID ? 'Auto' : resolvedModel.label
  const canPeek = thread.length === 0 && draft.trim().length === 0
  const composerExpanded = active || (composerFocused && canPeek)
  const showQuickActions = composerExpanded && aiSettings && chatEnabled

  const chooseModel = async (choice: string): Promise<void> => {
    if (!aiSettings) return
    const selected = resolveAiModelChoice(choice, aiSettings.aiProvider, aiSettings)
    setSelectedModel(selected.choice)
    const next = await window.api.settings.set({
      aiProvider: selected.provider,
      aiModel: selected.choice
    })
    setAiSettings(next)
    window.dispatchEvent(new Event('noteato:ai-settings-changed'))
  }

  const clearChat = (): void => {
    if (pending) return
    setThreads((previous) => {
      const next = { ...previous }
      delete next[subject.id]
      return next
    })
    dictatedChunksRef.current = []
    onDraftChange('')
  }

  useEffect(() => {
    const handle = (event: Event): void => {
      const detail = (event as CustomEvent<{ noteId?: string; actionId?: string }>).detail
      if (detail?.noteId !== subject.id || !detail.actionId) return
      const action = nativeActionDefinition(detail.actionId)
      if (action) void nativeActionRunnerRef.current(action.id)
    }
    window.addEventListener('noteato:native-action', handle)
    return () => window.removeEventListener('noteato:native-action', handle)
  }, [subject.id])

  const nativeActionIcon = (id: NativeActionId): React.ReactNode => {
    if (id === 'draft-email') return <Mail size={14} />
    if (id === 'create-todos') return <Checklist size={14} />
    return <Decisions size={14} />
  }

  return (
    <section
      className="note-chat-surface"
      aria-label={`Chat about ${subject.title}`}
      onFocusCapture={() => setComposerFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setComposerFocused(false)
      }}
    >
      <header className="note-chat-header">
        <div className="note-chat-header-main">
          {docked && (
            <button
              type="button"
              className="note-chat-tool-btn note-chat-header-dock"
              aria-label="Return chat to floating panel"
              aria-pressed="true"
              onClick={onToggleDock}
              title="Return chat to floating panel"
            >
              <LayoutSidebarRightCollapse size={15} />
            </button>
          )}
          <strong>{subject.title || 'Untitled'}</strong>
        </div>
        <div className="note-chat-header-actions">
          <button
            type="button"
            className="note-chat-close"
            aria-label="Clear note chat"
            title="Clear chat"
            disabled={pending || (thread.length === 0 && draft.trim().length === 0)}
            onClick={clearChat}
          >
            <Trash size={14} />
          </button>
          <button
            type="button"
            className="note-chat-close"
            aria-label="Close chat"
            title="Close chat"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>
      </header>

      {docked && !active && (
        <button
          type="button"
          className="note-chat-collapsed-title"
          aria-label={`Reopen chat about ${subject.title || 'Untitled'}`}
          onClick={onOpen}
          title="Reopen chat on the right"
        >
          <span>Chat</span>
          <strong>{subject.title || 'Untitled'}</strong>
          <LayoutSidebarRight size={15} aria-hidden="true" />
        </button>
      )}

      <div className="note-chat-scroll" ref={scrollRef}>
        {!aiSettings ? (
          <div className="note-chat-empty">
            <Loader2 size={16} className="spin" />
          </div>
        ) : !chatEnabled ? (
          <div className="note-chat-empty">
            <strong>Add the selected provider’s API key to start chatting.</strong>
            <span>Configure OpenAI, Anthropic or xAI in Settings.</span>
          </div>
        ) : (
          <>
            {thread.map((turn, index) => (
              <div key={index} className={`note-chat-turn ${turn.role}`}>
                {turn.role === 'assistant' ? (
                  <div className="note-chat-agent-events" aria-live="polite">
                    {turn.events?.map((event) =>
                      event.kind === 'message' ? (
                        <div key={event.id} className="note-chat-agent-message">
                          <MarkdownText text={event.text} />
                        </div>
                      ) : (
                        <div
                          key={event.id}
                          className={`note-chat-agent-event ${event.kind} ${event.status ?? ''}`}
                          role={event.kind === 'error' ? 'alert' : undefined}
                        >
                          <span className="note-chat-agent-event-icon" aria-hidden="true">
                            {event.status === 'active' ? (
                              <Loader2 size={12} className="spin" />
                            ) : event.status === 'error' ? (
                              <AlertCircle size={12} />
                            ) : (
                              <Check size={12} />
                            )}
                          </span>
                          <span>{event.text}</span>
                        </div>
                      )
                    )}
                    {!turn.events && turn.content && <MarkdownText text={turn.content} />}
                  </div>
                ) : (
                  turn.content
                )}
              </div>
            ))}
          </>
        )}
      </div>

      <footer className="note-chat-composer">
        {showQuickActions && (
          <div className="note-chat-quick-actions" aria-label="Suggested chat actions">
            {CHAT_ACTION_IDS.map((id) => nativeActionDefinition(id)).map(
              (action) => action && (
                <button
                  type="button"
                  key={action.id}
                  disabled={pending}
                  title={action.description}
                  onClick={() => void runNativeAction(action.id)}
                >
                  {nativeActionIcon(action.id)}
                  <span>{chatActionLabel(action.id)}</span>
                </button>
              )
            )}
          </div>
        )}
        <div className="note-chat-composer-field">
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            disabled={!chatEnabled}
            aria-expanded={composerExpanded}
            placeholder="Ask about this note…"
            onFocus={() => {
              if (!active && (thread.length > 0 || draft.trim().length > 0)) onOpen()
            }}
            onChange={(event) => {
              const next = event.target.value
              onDraftChange(next)
              if (!active && next.length > 0) onOpen()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
          />
          <div className="note-chat-composer-controls">
            <div className="note-chat-composer-trailing">
              <select
                className="note-chat-model-select"
                aria-label="AI model"
                value={selectedModel}
                disabled={pending || !aiSettings}
                onChange={(event) => {
                  if (!active) onOpen()
                  void chooseModel(event.target.value)
                }}
              >
                <option
                  value={AUTO_AI_MODEL_ID}
                  disabled={!aiSettings || availableAiProviders(aiSettings).length === 0}
                >
                  Auto
                </option>
                {AI_PROVIDER_ORDER.map((provider) => (
                  <optgroup
                    key={provider}
                    label={AI_PROVIDER_LABELS[provider]}
                    disabled={!aiSettings || !hasAiProviderKey(aiSettings, provider)}
                  >
                    {listedAiModels(provider).map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {!docked && (
                <button
                  type="button"
                  className="note-chat-tool-btn"
                  aria-pressed="false"
                  onClick={onToggleDock}
                  title="Dock chat on the right"
                >
                  <LayoutSidebarRight size={15} />
                </button>
              )}
              <button
                className={
                  isRecording ? 'note-chat-tool-btn recording' : 'note-chat-tool-btn'
                }
                aria-pressed={isRecording}
                onClick={toggleDictation}
                title={isRecording ? 'Stop dictation' : 'Dictate into chat'}
              >
                {isRecording ? <Square size={11} fill="currentColor" /> : <Microphone size={15} />}
              </button>
              {pending ? (
                <button className="note-chat-send-btn" onClick={() => cancelRef.current?.()} title="Stop">
                  <Square size={11} fill="currentColor" />
                </button>
              ) : (
                <button
                  className="note-chat-send-btn"
                  onClick={() => {
                    if (!active) onOpen()
                    void send()
                  }}
                  disabled={!draft.trim() || !chatEnabled}
                  title="Send"
                >
                  <ArrowUp size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      </footer>
    </section>
  )
}
