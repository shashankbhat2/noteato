import { useEffect, useRef, useState } from 'react'
import {
  IconArrowUp as ArrowUp,
  IconCheck as Check,
  IconChevronDown as ChevronDown,
  IconLoader2 as Loader2,
  IconMicrophone as Microphone,
  IconPencil as Pencil,
  IconSquare as Square
} from '@tabler/icons-react'
import type { Settings } from '../../../shared/types'
import { imagesForMarkdown, restoreImageWidths } from '../../../shared/imagePersistence'
import { parseChatOutput } from '../../../shared/chatEdits'
import type { NoteatoEditor } from '../noteLink'
import { AiNotConfiguredError, aiStream, isAiConfigured } from '../ai/client'
import { AI_MODELS, DEFAULT_CHAT_MODELS } from '../ai/models'
import { noteActionSpec } from '../ai/noteActions'
import { linkifyBlocks } from '../linkify'
import { ensureTitleBlock } from '../titleBlock'
import { useSpeechToText } from '../dictation/useDictation'
import MarkdownText from './MarkdownText'

export interface AiPanelSubject {
  id: string
  title: string
  external?: boolean
}

interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
  proposedMarkdown?: string
  sourceMarkdown?: string
  editApplied?: boolean
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
  onError,
  onEditApplied
}: {
  subject: AiPanelSubject
  editor: NoteatoEditor
  active: boolean
  onError: (message: string) => void
  onEditApplied: () => void
}) {
  const [input, setInput] = useState('')
  const [threads, setThreads] = useState<Record<string, ChatTurn[]>>({})
  const [pending, setPending] = useState(false)
  const [aiSettings, setAiSettings] = useState<Settings | null>(null)
  const [selectedModel, setSelectedModel] = useState('')
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [applyingEditIndex, setApplyingEditIndex] = useState<number | null>(null)
  const cancelRef = useRef<(() => void) | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const modelSelectRef = useRef<HTMLDivElement>(null)
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
      setInput(`${current.slice(0, start)}${addition}${current.slice(end)}`)
      requestAnimationFrame(() => {
        const nextCaret = start + addition.length
        inputRef.current?.focus({ preventScroll: true })
        inputRef.current?.setSelectionRange(nextCaret, nextCaret)
      })
    },
    onUndo: () => {
      const chunk = dictatedChunksRef.current.pop()
      if (!chunk) return
      setInput((current) => {
        if (current.slice(chunk.start, chunk.start + chunk.text.length) === chunk.text) {
          return `${current.slice(0, chunk.start)}${current.slice(chunk.start + chunk.text.length)}`
        }
        return current.endsWith(chunk.text) ? current.slice(0, -chunk.text.length) : current
      })
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
    setApplyingEditIndex(null)
  }, [subject.id])

  useEffect(() => {
    if (!modelMenuOpen) return
    const closeOnPointer = (event: PointerEvent): void => {
      if (!modelSelectRef.current?.contains(event.target as Node)) setModelMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setModelMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnPointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [modelMenuOpen])

  useEffect(() => {
    if (!active && isRecording) toggleDictation()
  }, [active, isRecording, toggleDictation])

  useEffect(() => {
    const el = scrollRef.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 90) el.scrollTop = el.scrollHeight
  }, [thread.length, pending])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    void window.api.settings.get().then((settings) => {
      if (cancelled) return
      setAiSettings(settings)
      const options = settings.aiProvider === 'none' ? [] : AI_MODELS[settings.aiProvider]
      setSelectedModel((current) => {
        if (options.some((option) => option.id === current)) return current
        if (options.some((option) => option.id === settings.aiModel)) return settings.aiModel
        return settings.aiProvider === 'none' ? '' : DEFAULT_CHAT_MODELS[settings.aiProvider]
      })
    })
    return () => {
      cancelled = true
    }
  }, [active])

  useEffect(() => () => cancelRef.current?.(), [])

  const noteMarkdown = (): string =>
    editor.blocksToMarkdownLossy(imagesForMarkdown(editor.document))

  const stream = async (
    system: string,
    prompt: string,
    onText: (text: string) => void
  ): Promise<string | null> => {
    const settings: Settings = await window.api.settings.get()
    const availableModels =
      settings.aiProvider === 'none' ? [] : AI_MODELS[settings.aiProvider].map((option) => option.id)
    const model = availableModels.includes(selectedModel) ? selectedModel : undefined
    setPending(true)
    let streamed = ''
    try {
      const final = await aiStream(
        settings,
        { system, prompt, maxTokens: 4096, model },
        (delta) => {
          streamed += delta
          onText(streamed)
        },
        (cancel) => {
          cancelRef.current = cancel
        }
      )
      return (final || streamed).trim()
    } catch (error) {
      onError(
        error instanceof AiNotConfiguredError
          ? error.message
          : 'That request failed. Check your provider settings and try again.'
      )
      return null
    } finally {
      cancelRef.current = null
      setPending(false)
    }
  }

  const send = async (): Promise<void> => {
    const question = input.trim()
    if (!question || pending || !chatEnabled) return

    let sourceMarkdown: string
    try {
      sourceMarkdown = noteMarkdown()
    } catch {
      onError('Could not read the current note for Chat.')
      return
    }

    if (isRecording) toggleDictation()
    dictatedChunksRef.current = []
    setInput('')

    const history = [...thread, { role: 'user' as const, content: question }]
    setThreads((previous) => ({ ...previous, [subject.id]: history }))
    const transcript = history
      .map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`)
      .join('\n\n')
    const prompt = `CURRENT NOTE — preserve this Markdown when proposing edits:\n\n${sourceMarkdown}\n\n--- CONVERSATION ---\n\n${transcript}`

    let live = ''
    const final = await stream(noteActionSpec('ask').system, prompt, (text) => {
      live = text
      const parsed = parseChatOutput(text)
      setThreads((previous) => ({
        ...previous,
        [subject.id]: [
          ...history,
          {
            role: 'assistant',
            content: parsed.message || 'Preparing an edit…',
            ...(parsed.proposedMarkdown
              ? { proposedMarkdown: parsed.proposedMarkdown, sourceMarkdown }
              : {})
          }
        ]
      }))
    })
    const parsed = parseChatOutput(final ?? live)
    if (parsed.hasEditMarker && !parsed.proposedMarkdown) {
      onError('The proposed edit was incomplete. Try asking for a smaller change.')
    }
    setThreads((previous) => ({
      ...previous,
      [subject.id]: [
        ...history,
        {
          role: 'assistant',
          content: parsed.message || 'I could not complete that response.',
          ...(parsed.proposedMarkdown
            ? { proposedMarkdown: parsed.proposedMarkdown, sourceMarkdown }
            : {})
        }
      ]
    }))
  }

  const applyProposedEdit = async (index: number, turn: ChatTurn): Promise<void> => {
    if (!turn.proposedMarkdown || applyingEditIndex !== null) return
    setApplyingEditIndex(index)
    try {
      const currentMarkdown = noteMarkdown()
      if (currentMarkdown.trim() !== turn.sourceMarkdown?.trim()) {
        throw new Error('The note changed after this edit was prepared. Ask Chat to update it again.')
      }

      const parsed = restoreImageWidths(
        linkifyBlocks(await editor.tryParseMarkdownToBlocks(turn.proposedMarkdown))
      )
      if (parsed.length === 0) throw new Error('The proposed edit did not contain editable content.')
      const nextBlocks = subject.external ? parsed : ensureTitleBlock(parsed, subject.title)
      editor.replaceBlocks(
        editor.document.map((block) => block.id),
        nextBlocks
      )
      setThreads((previous) => ({
        ...previous,
        [subject.id]: (previous[subject.id] ?? []).map((entry, entryIndex) =>
          entryIndex === index ? { ...entry, editApplied: true } : entry
        )
      }))
      onEditApplied()
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not apply that edit to the note.')
    } finally {
      setApplyingEditIndex(null)
    }
  }

  const modelOptions =
    aiSettings?.aiProvider && aiSettings.aiProvider !== 'none'
      ? AI_MODELS[aiSettings.aiProvider]
      : []
  const chatEnabled = aiSettings ? isAiConfigured(aiSettings) : false
  const selectedModelLabel =
    modelOptions.find((option) => option.id === selectedModel)?.label ?? 'Choose model'

  return (
    <section className="note-chat-surface" aria-label={`Chat about ${subject.title}`}>
      <header className="note-chat-header">
        <div>
          <span className="note-chat-kicker">Chat with note</span>
          <strong>{subject.title || 'Untitled'}</strong>
        </div>
      </header>

      <div className="note-chat-scroll" ref={scrollRef}>
        {!aiSettings ? (
          <div className="note-chat-empty">
            <Loader2 size={16} className="spin" />
          </div>
        ) : !chatEnabled ? (
          <div className="note-chat-empty">
            <strong>Connect an AI provider to chat with this note.</strong>
            <span>You can configure Anthropic or OpenAI in Settings.</span>
          </div>
        ) : (
          <>
            {thread.length === 0 && (
              <div className="note-chat-empty">
                <strong>Ask from the context of this note.</strong>
                <span>Questions and responses stay scoped to this note.</span>
              </div>
            )}
            {thread.map((turn, index) => (
              <div key={index} className={`note-chat-turn ${turn.role}`}>
                {turn.role === 'assistant' ? (
                  <>
                    <MarkdownText text={turn.content} />
                    {turn.proposedMarkdown && (
                      <div className="note-chat-edit-actions">
                        <button
                          type="button"
                          className={turn.editApplied ? 'applied' : undefined}
                          disabled={turn.editApplied || applyingEditIndex !== null}
                          onClick={() => void applyProposedEdit(index, turn)}
                        >
                          {turn.editApplied ? (
                            <Check size={13} />
                          ) : applyingEditIndex === index ? (
                            <Loader2 size={13} className="spin" />
                          ) : (
                            <Pencil size={13} />
                          )}
                          <span>
                            {turn.editApplied
                              ? 'Applied to note'
                              : applyingEditIndex === index
                                ? 'Applying…'
                                : 'Apply to note'}
                          </span>
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  turn.content
                )}
              </div>
            ))}
            {pending && thread[thread.length - 1]?.role === 'user' && (
              <Loader2 size={16} className="spin note-chat-loader" />
            )}
          </>
        )}
      </div>

      <footer className="note-chat-composer">
        <div className="note-chat-composer-field">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            disabled={!chatEnabled}
            placeholder="What would you like to know about this note?"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
          />
          <div className="note-chat-composer-controls">
            <div className="note-chat-composer-trailing">
              <div className="note-chat-model-select" ref={modelSelectRef}>
                <button
                  className="note-chat-model-trigger"
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={modelMenuOpen}
                  disabled={modelOptions.length === 0 || pending}
                  onClick={() => setModelMenuOpen((open) => !open)}
                >
                  <span>{modelOptions.length === 0 ? 'Set up AI' : selectedModelLabel}</span>
                  <ChevronDown size={12} />
                </button>
                {modelMenuOpen && modelOptions.length > 0 && (
                  <div className="note-chat-model-menu" role="listbox" aria-label="AI model">
                    {modelOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        role="option"
                        aria-selected={option.id === selectedModel}
                        onClick={() => {
                          setSelectedModel(option.id)
                          setModelMenuOpen(false)
                        }}
                      >
                        <span>{option.label}</span>
                        {option.id === selectedModel && <Check size={13} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
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
                  onClick={() => void send()}
                  disabled={!input.trim() || !chatEnabled}
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
