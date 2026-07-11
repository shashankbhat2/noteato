import { useEffect, useRef, useState } from 'react'
import { ArrowUp, FileText, Loader2, Sparkles, SquarePen } from 'lucide-react'
import type { Settings } from '../../../shared/types'
import type { Tab } from '../tabs'
import { aiStream } from '../ai/client'
import { AGENT_MODELS, type AgentModelChoice } from '../ai/models'

const MODEL_KEY = 'noteato:agentModel'
const HISTORY_PREFIX = 'noteato:agentHistory:'
const MAX_STORED_MESSAGES = 40

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  edited?: boolean
}

interface Props {
  note: Tab | null
  getMarkdown: (noteId: string) => Promise<string | null>
  applyMarkdown: (noteId: string, markdown: string) => Promise<string[]>
}

function readHistory(noteId: string): ChatMessage[] {
  try {
    return JSON.parse(localStorage.getItem(`${HISTORY_PREFIX}${noteId}`) ?? '[]')
  } catch {
    return []
  }
}

function messageId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

function resolveModel(
  choice: AgentModelChoice,
  settings: Settings
): { provider: 'openai' | 'anthropic'; model: string } | null {
  if (choice === 'auto') {
    if (settings.openaiApiKey.trim()) return { provider: 'openai', model: 'gpt-5.4-mini' }
    if (settings.anthropicApiKey.trim()) {
      return { provider: 'anthropic', model: 'claude-haiku-4-5' }
    }
    return null
  }
  if (choice.startsWith('gpt-')) {
    return settings.openaiApiKey.trim() ? { provider: 'openai', model: choice } : null
  }
  return settings.anthropicApiKey.trim() ? { provider: 'anthropic', model: choice } : null
}

function parseAgentResponse(raw: string): { reply: string; edit: string | null } {
  const reply = raw.match(/<reply>([\s\S]*?)<\/reply>/i)?.[1]?.trim()
  const edit = raw.match(/<note_edit>([\s\S]*?)<\/note_edit>/i)?.[1]?.trim() ?? null
  return {
    reply: reply || raw.replace(/<note_edit>[\s\S]*?<\/note_edit>/gi, '').trim(),
    edit
  }
}

function parseStreamingReply(raw: string): string {
  const replyStart = raw.match(/<reply>([\s\S]*)/i)
  if (replyStart) return replyStart[1].split(/<\/reply>/i)[0].trimStart()
  return raw.trimStart().startsWith('<') ? '' : raw
}

export default function AgentPanel({ note, getMarkdown, applyMarkdown }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [model, setModel] = useState<AgentModelChoice>(() => {
    const saved = localStorage.getItem(MODEL_KEY)
    return AGENT_MODELS.some((item) => item.id === saved) ? (saved as AgentModelChoice) : 'auto'
  })
  const [history, setHistory] = useState<{ noteId: string; messages: ChatMessage[] }>({
    noteId: '',
    messages: []
  })
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [streamingReply, setStreamingReply] = useState<{ noteId: string; content: string } | null>(
    null
  )
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const refresh = (): void => {
      window.api.settings.get().then(setSettings)
    }
    refresh()
    window.addEventListener('noteato:ai-settings-changed', refresh)
    return () => window.removeEventListener('noteato:ai-settings-changed', refresh)
  }, [])

  useEffect(() => {
    if (!note) {
      setHistory({ noteId: '', messages: [] })
      return
    }
    setHistory({ noteId: note.id, messages: readHistory(note.id) })
    setError(null)
  }, [note?.id])

  useEffect(() => {
    if (!settings || model === 'auto') return
    const unavailable = model.startsWith('gpt-')
      ? !settings.openaiApiKey.trim()
      : !settings.anthropicApiKey.trim()
    if (unavailable) {
      setModel('auto')
      localStorage.setItem(MODEL_KEY, 'auto')
    }
  }, [model, settings])

  useEffect(() => {
    if (!history.noteId) return
    localStorage.setItem(
      `${HISTORY_PREFIX}${history.noteId}`,
      JSON.stringify(history.messages.slice(-MAX_STORED_MESSAGES))
    )
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [history])

  useEffect(() => {
    if (!input && composerRef.current) composerRef.current.style.height = '44px'
  }, [input])

  useEffect(() => {
    if (streamingReply?.noteId !== note?.id) return
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [note?.id, streamingReply])

  const updateModel = (next: AgentModelChoice): void => {
    setModel(next)
    localStorage.setItem(MODEL_KEY, next)
  }

  const startNewChat = (): void => {
    if (!note) return
    setInput('')
    setError(null)
    setStreamingReply(null)
    setHistory({ noteId: note.id, messages: [] })
  }

  const send = async (): Promise<void> => {
    const request = input.trim()
    if (!request || !note || pending) return

    setPending(true)
    setError(null)
    setInput('')
    setStreamingReply({ noteId: note.id, content: '' })
    const currentMessages = history.noteId === note.id ? history.messages : []
    const userMessage: ChatMessage = { id: messageId(), role: 'user', content: request }
    setHistory({ noteId: note.id, messages: [...currentMessages, userMessage] })
    let renderTimer: number | undefined

    try {
      const latestSettings = await window.api.settings.get()
      setSettings(latestSettings)
      const resolved = resolveModel(model, latestSettings)
      if (!resolved) throw new Error('The selected model needs an API key in Settings.')
      const markdown = await getMarkdown(note.id)
      if (markdown === null) throw new Error('The active note is not ready yet.')

      const recentHistory = [...currentMessages, userMessage]
        .slice(-12)
        .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
        .join('\n\n')
      let streamedRaw = ''
      const renderStream = (): void => {
        renderTimer = undefined
        setStreamingReply({ noteId: note.id, content: parseStreamingReply(streamedRaw) })
      }
      const raw = await aiStream(
        latestSettings,
        {
          provider: resolved.provider,
          model: resolved.model,
          maxTokens: 16384,
          system:
            'You are the Noteato note agent. Answer questions using the current note as context. Always put the conversational response first, inside <reply>...</reply>. When the user asks to change the note, follow it with the entire updated note as markdown inside <note_edit>...</note_edit>. Omit <note_edit> when no edit is needed. Do not use code fences around either tag.',
          prompt: `CURRENT NOTE\nTitle: ${note.title || 'Untitled'}\nPath: ${note.path}\n\n${markdown}\n\nRECENT CHAT\n${recentHistory}`
        },
        (delta) => {
          streamedRaw += delta
          if (renderTimer === undefined) renderTimer = window.setTimeout(renderStream, 40)
        }
      )
      if (renderTimer !== undefined) window.clearTimeout(renderTimer)
      setStreamingReply({ noteId: note.id, content: parseStreamingReply(raw) })
      const parsed = parseAgentResponse(raw)
      let edited = false
      if (parsed.edit) {
        const changedIds = await applyMarkdown(note.id, parsed.edit)
        edited = changedIds.length > 0
      }
      const assistantMessage: ChatMessage = {
        id: messageId(),
        role: 'assistant',
        content: parsed.reply || (edited ? 'Updated the note.' : 'Done.'),
        edited
      }
      setHistory((current) => ({
        noteId: note.id,
        messages: [...(current.noteId === note.id ? current.messages : []), assistantMessage]
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The agent request failed.')
    } finally {
      if (renderTimer !== undefined) window.clearTimeout(renderTimer)
      setStreamingReply(null)
      setPending(false)
    }
  }

  const hasOpenAi = Boolean(settings?.openaiApiKey.trim())
  const hasAnthropic = Boolean(settings?.anthropicApiKey.trim())
  const configured = hasOpenAi || hasAnthropic
  const messages = history.noteId === note?.id ? history.messages : []

  return (
    <aside className="agent-panel">
      <div className="agent-header">
        <div className="agent-title">
          <Sparkles size={13} />
          <span>Agent</span>
        </div>
        <div className="agent-header-actions">
          <button
            className="agent-icon-btn"
            onClick={startNewChat}
            title="New chat"
            disabled={pending || messages.length === 0}
          >
            <SquarePen size={13} />
          </button>
        </div>
      </div>

      <div className="agent-messages" ref={scrollRef}>
        {!note && <div className="agent-empty">Open a note to start.</div>}
        {note && !configured && <div className="agent-empty">Add an API key in Settings.</div>}
        {messages.map((message) => (
          <div key={message.id} className={`agent-message ${message.role}`}>
            <div>{message.content}</div>
            {message.edited && <span className="agent-edit-label">Note updated</span>}
          </div>
        ))}
        {pending && streamingReply && streamingReply.noteId === note?.id && (
          <div className="agent-message assistant pending">
            {streamingReply.content ? (
              <div>{streamingReply.content}</div>
            ) : (
              <>
                <Loader2 size={14} className="spin" />
                <span>Thinking…</span>
              </>
            )}
          </div>
        )}
        {error && <div className="agent-error">{error}</div>}
      </div>

      <div className="agent-composer">
        <div className="agent-context-badge" title={note?.path}>
          <FileText size={11} />
          <span>{note ? note.title || 'Untitled' : 'No note selected'}</span>
        </div>
        <div className="agent-input-wrap">
          <textarea
            ref={composerRef}
            value={input}
            rows={1}
            placeholder="Ask about this note…"
            disabled={!note || !configured || pending}
            onChange={(event) => {
              setInput(event.target.value)
              event.currentTarget.style.height = '44px'
              event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 112)}px`
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
          />
          <div className="agent-composer-row">
            <select
              className="agent-model-select"
              value={model}
              onChange={(event) => updateModel(event.target.value as AgentModelChoice)}
              title="Agent model"
            >
              {AGENT_MODELS.map((item) => (
                <option
                  key={item.id}
                  value={item.id}
                  disabled={
                    item.provider === 'openai'
                      ? !hasOpenAi
                      : item.provider === 'anthropic'
                        ? !hasAnthropic
                        : !configured
                  }
                >
                  {item.id === 'auto'
                    ? hasOpenAi
                      ? 'Auto · GPT Mini'
                      : hasAnthropic
                        ? 'Auto · Haiku'
                        : 'Auto'
                    : item.label}
                </option>
              ))}
            </select>
            <button
              className="agent-send-btn"
              onClick={() => void send()}
              disabled={!input.trim() || !note || !configured || pending}
              title="Send"
            >
              <ArrowUp size={13} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}
