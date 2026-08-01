import { useEffect, useRef, useState } from 'react'
import {
  IconArrowUp as ArrowUp,
  IconCheck as Check,
  IconCopy as Copy,
  IconCornerDownLeft as Insert,
  IconLoader2 as Loader2,
  IconMicrophone as Mic,
  IconSparkles as Sparkles,
  IconSquare as Square,
  IconX as X
} from '@tabler/icons-react'
import type { AiNoteAction, Settings } from '../../../shared/types'
import type { NoteatoEditor } from '../noteLink'
import { AiNotConfiguredError, aiStream } from '../ai/client'
import { NOTE_ACTIONS, noteActionSpec } from '../ai/noteActions'
import { useDictation } from '../dictation/useDictation'
import MarkdownText from './MarkdownText'
import Waveform from './Waveform'

export interface AiPanelSubject {
  id: string
  title: string
}

interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/**
 * One panel for the whole layout, not one per pane.
 *
 * Its subject is whichever note pane has focus, so moving between panes moves
 * the context with you — and the panel says which note it is on, because a
 * surface that silently changes what it acts on is worse than one you have to
 * point at. Enhance produces a result you insert; Ask is a conversation about
 * the note and stays one, threaded per note so switching back returns you to
 * where you left off.
 *
 * Actions on a *selection* are not here: those stay in the selection bubble
 * menu, where the text being acted on is already in front of you.
 */
export default function NoteAiPanel({
  subject,
  getEditor,
  aiEnabled,
  onError
}: {
  subject: AiPanelSubject | null
  getEditor: () => NoteatoEditor | null
  aiEnabled: boolean
  onError: (message: string) => void
}) {
  const [mode, setMode] = useState<'none' | 'enhance' | 'chat'>('none')
  const [input, setInput] = useState('')
  // Threads are per note, so moving between panes swaps the conversation
  // rather than carrying one note's questions into another's context.
  const [threads, setThreads] = useState<Record<string, ChatTurn[]>>({})
  const [result, setResult] = useState<{ action: AiNoteAction; text: string } | null>(null)
  const [pending, setPending] = useState(false)
  const [copied, setCopied] = useState(false)

  const { isRecording, error: dictationError, analyser, toggle } = useDictation(getEditor())
  const cancelRef = useRef<(() => void) | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const thread = subject ? (threads[subject.id] ?? []) : []

  useEffect(() => {
    if (dictationError) onError(dictationError)
  }, [dictationError, onError])

  useEffect(() => {
    if (mode === 'chat') inputRef.current?.focus()
  }, [mode])

  useEffect(() => {
    const el = scrollRef.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 70) el.scrollTop = el.scrollHeight
  }, [thread.length, result, pending])

  // A result belongs to the note it ran against. Changing subject closes it
  // rather than leaving output attached to a note it did not come from.
  useEffect(() => {
    setResult(null)
    setMode((current) => (current === 'enhance' ? 'none' : current))
  }, [subject?.id])

  useEffect(() => () => cancelRef.current?.(), [])

  const noteText = (): string => {
    const editor = getEditor()
    if (!editor) return ''
    return editor.document
      .map((block) => {
        const content = (block as { content?: unknown }).content
        if (!Array.isArray(content)) return ''
        return content
          .map((piece) =>
            piece && typeof piece === 'object' && 'text' in piece ? String(piece.text ?? '') : ''
          )
          .join('')
      })
      .filter(Boolean)
      .join('\n')
  }

  const stream = async (
    system: string,
    prompt: string,
    onText: (text: string) => void
  ): Promise<string | null> => {
    const settings: Settings = await window.api.settings.get()
    setPending(true)
    let streamed = ''
    try {
      const final = await aiStream(
        settings,
        { system, prompt, maxTokens: 4096 },
        (delta) => {
          streamed += delta
          onText(streamed)
        },
        (cancel) => {
          cancelRef.current = cancel
        }
      )
      return (final || streamed).trim()
    } catch (e) {
      onError(
        e instanceof AiNotConfiguredError
          ? e.message
          : 'That request failed. Check your provider settings and try again.'
      )
      return null
    } finally {
      cancelRef.current = null
      setPending(false)
    }
  }

  const runEnhance = async (action: AiNoteAction): Promise<void> => {
    const content = noteText()
    if (!content.trim()) {
      onError('There is nothing in this note to work on yet.')
      return
    }
    setMode('none')
    setResult({ action, text: '' })
    setCopied(false)
    const final = await stream(noteActionSpec(action).system, content, (text) =>
      setResult({ action, text })
    )
    if (final === null) setResult(null)
    else setResult({ action, text: final })
  }

  const send = async (): Promise<void> => {
    const question = input.trim()
    if (!question || !subject || pending) return
    const content = noteText()
    setInput('')

    const history = [...thread, { role: 'user' as const, content: question }]
    setThreads((prev) => ({ ...prev, [subject.id]: history }))

    const transcript = history
      .map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`)
      .join('\n\n')
    const prompt = `Note "${subject.title}":\n\n${content}\n\n---\n\n${transcript}`

    let live = ''
    const final = await stream(noteActionSpec('ask').system, prompt, (text) => {
      live = text
      setThreads((prev) => ({
        ...prev,
        [subject.id]: [...history, { role: 'assistant', content: text }]
      }))
    })
    setThreads((prev) => ({
      ...prev,
      [subject.id]: [...history, { role: 'assistant', content: final ?? live }]
    }))
  }

  const insertResult = async (): Promise<void> => {
    const editor = getEditor()
    if (!editor || !result?.text) return
    const parsed = await editor.tryParseMarkdownToBlocks(result.text)
    if (parsed.length === 0) return
    const blocks = editor.document
    editor.insertBlocks(parsed, blocks[blocks.length - 1], 'after')
    setResult(null)
  }

  const hasNote = subject !== null
  const showAi = aiEnabled && hasNote

  return (
    <div className="note-ai-panel">
      {/* Enhance output: one result, with somewhere to put it. */}
      {result && (
        <section className="note-ai-surface">
          <header className="note-ai-surface-head">
            <span>{noteActionSpec(result.action).label}</span>
            <span className="note-ai-subject">{subject?.title}</span>
            <button className="note-ai-icon-btn" onClick={() => setResult(null)} title="Dismiss">
              <X size={13} />
            </button>
          </header>
          <div className="note-ai-surface-body" ref={scrollRef}>
            {result.text ? <MarkdownText text={result.text} /> : <Loader2 size={15} className="spin" />}
          </div>
          {result.text && (
            <footer className="note-ai-surface-actions">
              {pending ? (
                <button className="note-ai-btn" onClick={() => cancelRef.current?.()}>
                  <Square size={11} fill="currentColor" /> Stop
                </button>
              ) : (
                <>
                  <button
                    className="note-ai-btn"
                    onClick={() => {
                      void navigator.clipboard.writeText(result.text)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 1500)
                    }}
                  >
                    {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
                  </button>
                  <button className="note-ai-btn primary" onClick={() => void insertResult()}>
                    <Insert size={12} /> Insert
                  </button>
                </>
              )}
            </footer>
          )}
        </section>
      )}

      {/* Ask: a conversation about the focused note. */}
      {mode === 'chat' && (
        <section className="note-ai-surface chat">
          <header className="note-ai-surface-head">
            <span>Ask</span>
            <span className="note-ai-subject">{subject?.title}</span>
            <button className="note-ai-icon-btn" onClick={() => setMode('none')} title="Close">
              <X size={13} />
            </button>
          </header>
          <div className="note-ai-surface-body" ref={scrollRef}>
            {thread.length === 0 && (
              <div className="note-ai-hint">Ask anything about this note.</div>
            )}
            {thread.map((turn, i) => (
              <div key={i} className={`note-ai-turn ${turn.role}`}>
                {turn.role === 'assistant' ? <MarkdownText text={turn.content} /> : turn.content}
              </div>
            ))}
            {pending && thread[thread.length - 1]?.role === 'user' && (
              <Loader2 size={15} className="spin" />
            )}
          </div>
          <footer className="note-ai-chat-composer">
            <input
              ref={inputRef}
              value={input}
              placeholder="Ask about this note…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void send()
                if (e.key === 'Escape') setMode('none')
              }}
            />
            {pending ? (
              <button className="note-ai-send" onClick={() => cancelRef.current?.()} title="Stop">
                <Square size={11} fill="currentColor" />
              </button>
            ) : (
              <button
                className="note-ai-send"
                onClick={() => void send()}
                disabled={!input.trim()}
                title="Send"
              >
                <ArrowUp size={14} />
              </button>
            )}
          </footer>
        </section>
      )}

      {mode === 'enhance' && (
        <section className="note-ai-menu">
          {NOTE_ACTIONS.filter((s) => s.action !== 'ask').map((s) => (
            <button
              key={s.action}
              className="note-ai-menu-item"
              onClick={() => void runEnhance(s.action)}
            >
              {s.label}
            </button>
          ))}
        </section>
      )}

      <div className={isRecording ? 'note-ai-pill recording' : 'note-ai-pill'}>
        <button
          className="note-ai-action"
          onClick={toggle}
          disabled={!hasNote && !isRecording}
          title={
            isRecording
              ? 'Stop dictation'
              : hasNote
                ? `Dictate into ${subject.title}`
                : 'Open a note to dictate into'
          }
        >
          {isRecording ? <Square size={11} fill="currentColor" /> : <Mic size={14} />}
        </button>

        {isRecording ? (
          <Waveform analyser={analyser} active={isRecording} />
        ) : (
          showAi && (
            <>
              <span className="note-ai-sep" aria-hidden />
              <button
                className={mode === 'enhance' ? 'note-ai-action active' : 'note-ai-action'}
                onClick={() => setMode(mode === 'enhance' ? 'none' : 'enhance')}
                title={`Enhance ${subject.title}`}
              >
                <Sparkles size={13} />
                <span>Enhance</span>
              </button>
              <button
                className={mode === 'chat' ? 'note-ai-action active' : 'note-ai-action'}
                onClick={() => setMode(mode === 'chat' ? 'none' : 'chat')}
                title={`Ask about ${subject.title}`}
              >
                Ask
              </button>
              {/* Which note everything here acts on. */}
              <span className="note-ai-pill-subject" title={subject.title}>
                {subject.title || 'Untitled'}
              </span>
            </>
          )
        )}
      </div>
    </div>
  )
}
