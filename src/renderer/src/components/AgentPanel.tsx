import { useEffect, useRef, useState } from 'react'
import { ArrowUp, FileText, Loader2, Sparkles, Square, SquarePen, X } from 'lucide-react'
import type { Note, NoteSummary, Settings } from '../../../shared/types'
import type { Tab } from '../tabs'
import { aiStream } from '../ai/client'
import { AGENT_MODELS, type AgentModelChoice } from '../ai/models'

const MODEL_KEY = 'noteato:agentModel'
const HISTORY_PREFIX = 'noteato:agentHistory:'
const MAX_STORED_MESSAGES = 40

interface CreatedNoteRef {
  id: string
  path: string
  title: string
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  edited?: boolean
  created?: CreatedNoteRef[]
}

interface Props {
  note: Tab | null
  notes: NoteSummary[]
  getMarkdown: (noteId: string) => Promise<string | null>
  applyMarkdown: (noteId: string, markdown: string) => Promise<string[]>
  createNote: (path: string, markdown: string) => Promise<Note | null>
  onOpenNote: (target: CreatedNoteRef) => void
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

function parseAgentResponse(raw: string): {
  reply: string
  edit: string | null
  creates: { path: string; content: string }[]
} {
  const reply = raw.match(/<reply>([\s\S]*?)<\/reply>/i)?.[1]?.trim()
  const edit = raw.match(/<note_edit>([\s\S]*?)<\/note_edit>/i)?.[1]?.trim() ?? null
  const creates: { path: string; content: string }[] = []
  for (const match of raw.matchAll(/<note_create\s+path="([^"]+)"\s*>([\s\S]*?)<\/note_create>/gi)) {
    creates.push({ path: match[1], content: match[2].trim() })
  }
  return {
    reply:
      reply ||
      raw
        .replace(/<note_edit>[\s\S]*?<\/note_edit>/gi, '')
        .replace(/<note_create[\s\S]*?<\/note_create>/gi, '')
        .trim(),
    edit,
    creates
  }
}

// Edits/creates stream before the reply and are applied only after the stream
// completes — suppress the reply text until then so the agent never claims a
// change that hasn't landed in the note yet.
function parseStreamingReply(raw: string): { content: string; working: boolean } {
  if (/<note_(edit|create)/i.test(raw)) return { content: '', working: true }
  const replyStart = raw.match(/<reply>([\s\S]*)/i)
  if (replyStart) {
    return { content: replyStart[1].split(/<\/reply>/i)[0].trimStart(), working: false }
  }
  return { content: raw.trimStart().startsWith('<') ? '' : raw, working: false }
}

export default function AgentPanel({
  note,
  notes,
  getMarkdown,
  applyMarkdown,
  createNote,
  onOpenNote
}: Props) {
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
  // Notes @-mentioned into the chat; their content is sent as extra context
  // with every message until removed.
  const [mentions, setMentions] = useState<NoteSummary[]>([])
  const [mentionMenu, setMentionMenu] = useState<{ start: number; query: string } | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [pending, setPending] = useState(false)
  const [streamingReply, setStreamingReply] = useState<{
    noteId: string
    content: string
    working?: boolean
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const cancelStreamRef = useRef<(() => void) | null>(null)
  const cancelledRef = useRef(false)

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
    setMentions([])
    setMentionMenu(null)
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
    setMentions([])
    setMentionMenu(null)
    setError(null)
    setStreamingReply(null)
    setHistory({ noteId: note.id, messages: [] })
  }

  // Track an in-progress "@query" token ending at the cursor. Valid when the @
  // starts the input or follows whitespace, and the query has no newline.
  const updateMentionMenu = (value: string, cursor: number): void => {
    const before = value.slice(0, cursor)
    const at = before.lastIndexOf('@')
    if (at === -1 || (at > 0 && !/\s/.test(before[at - 1]))) {
      setMentionMenu(null)
      return
    }
    const query = before.slice(at + 1)
    if (/[\n@]/.test(query) || query.length > 60) {
      setMentionMenu(null)
      return
    }
    setMentionMenu({ start: at, query })
    setMentionIndex(0)
  }

  const mentionCandidates = mentionMenu
    ? notes
        .filter((n) => n.id !== note?.id && !mentions.some((m) => m.id === n.id))
        .filter((n) => {
          const q = mentionMenu.query.trim().toLowerCase()
          return (
            !q ||
            (n.title || 'Untitled').toLowerCase().includes(q) ||
            n.path.toLowerCase().includes(q)
          )
        })
        .slice(0, 6)
    : []

  const pickMention = (picked: NoteSummary): void => {
    if (!mentionMenu) return
    const cursor = composerRef.current?.selectionStart ?? input.length
    const label = `@${picked.title || 'Untitled'} `
    setInput(input.slice(0, mentionMenu.start) + label + input.slice(cursor))
    setMentions((prev) => [...prev, picked])
    setMentionMenu(null)
    composerRef.current?.focus()
  }

  const stop = (): void => {
    cancelledRef.current = true
    cancelStreamRef.current?.()
  }

  const send = async (): Promise<void> => {
    const request = input.trim()
    if (!request || !note || pending) return

    setPending(true)
    cancelledRef.current = false
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

      // Mentioned notes ride along as read-only context. Resolve each mention's
      // current path by id first — the note may have been moved since it was
      // added — and skip any that no longer exist.
      const mentionSections: string[] = []
      for (const mention of mentions) {
        const current = notes.find((n) => n.id === mention.id) ?? mention
        if (current.id === note.id) continue
        try {
          const full = await window.api.notes.read(current.path)
          mentionSections.push(
            `MENTIONED NOTE (read-only)\nTitle: ${full.title || 'Untitled'}\nPath: ${full.path}\n\n${full.body}`
          )
        } catch {
          /* moved or deleted — skip */
        }
      }
      const folderList = await window.api.notes.listFolders()

      const recentHistory = [...currentMessages, userMessage]
        .slice(-12)
        .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
        .join('\n\n')
      let streamedRaw = ''
      const renderStream = (): void => {
        renderTimer = undefined
        setStreamingReply({ noteId: note.id, ...parseStreamingReply(streamedRaw) })
      }
      const raw = await aiStream(
        latestSettings,
        {
          provider: resolved.provider,
          model: resolved.model,
          maxTokens: 16384,
          system:
            'You are the Noteato note agent. Answer questions using the current note and any mentioned notes as context. When the user asks to change the current note, output the entire updated note as markdown inside <note_edit>...</note_edit>. When the user asks for new notes, output each one as <note_create path="Folder/Note title.md">markdown body</note_create> — the path is relative to the notes root, the file name (without .md) becomes the title, missing folders are created automatically, and you may emit several note_create tags. Existing folders are listed in the prompt. Emit all note_edit/note_create tags FIRST, then always end with a short conversational response inside <reply>...</reply> — never describe a change before its tag has been emitted. Only the current note can be edited; mentioned notes are read-only. Omit tags you do not need. Do not use code fences around any tag.',
          prompt: [
            `CURRENT NOTE\nTitle: ${note.title || 'Untitled'}\nPath: ${note.path}\n\n${markdown}`,
            ...mentionSections,
            `EXISTING FOLDERS\n${folderList.join('\n') || '(none — all notes live at the root)'}`,
            `RECENT CHAT\n${recentHistory}`
          ].join('\n\n')
        },
        (delta) => {
          streamedRaw += delta
          if (renderTimer === undefined) renderTimer = window.setTimeout(renderStream, 40)
        },
        (cancel) => {
          cancelStreamRef.current = cancel
        }
      )
      if (renderTimer !== undefined) window.clearTimeout(renderTimer)
      let assistantMessage: ChatMessage
      if (cancelledRef.current) {
        // Cancelled mid-stream: drop any partial edits/creates — never apply
        // half a document.
        assistantMessage = { id: messageId(), role: 'assistant', content: 'Stopped.' }
      } else {
        setStreamingReply({ noteId: note.id, ...parseStreamingReply(raw) })
        const parsed = parseAgentResponse(raw)
        let edited = false
        if (parsed.edit) {
          const changedIds = await applyMarkdown(note.id, parsed.edit)
          edited = changedIds.length > 0
        }
        const createdNotes: CreatedNoteRef[] = []
        for (const create of parsed.creates) {
          const created = await createNote(create.path, create.content)
          if (created) {
            createdNotes.push({ id: created.id, path: created.path, title: created.title })
          }
        }
        assistantMessage = {
          id: messageId(),
          role: 'assistant',
          content:
            parsed.reply ||
            (edited ? 'Updated the note.' : createdNotes.length ? 'Created the note.' : 'Done.'),
          edited,
          created: createdNotes.length ? createdNotes : undefined
        }
      }
      setHistory((current) => ({
        noteId: note.id,
        messages: [...(current.noteId === note.id ? current.messages : []), assistantMessage]
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The agent request failed.')
    } finally {
      if (renderTimer !== undefined) window.clearTimeout(renderTimer)
      cancelStreamRef.current = null
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
            {message.created?.map((created) => (
              <button
                key={created.id}
                className="agent-created-chip"
                title={created.path}
                onClick={() => onOpenNote(created)}
              >
                <FileText size={11} />
                <span>{created.title || 'Untitled'}</span>
              </button>
            ))}
          </div>
        ))}
        {pending && streamingReply && streamingReply.noteId === note?.id && (
          <div className="agent-message assistant pending">
            {streamingReply.content ? (
              <div>{streamingReply.content}</div>
            ) : (
              <>
                <Loader2 size={14} className="spin" />
                <span>{streamingReply.working ? 'Updating notes…' : 'Thinking…'}</span>
              </>
            )}
          </div>
        )}
        {error && <div className="agent-error">{error}</div>}
      </div>

      <div className="agent-composer">
        {mentionMenu && mentionCandidates.length > 0 && (
          <div className="agent-mention-menu">
            {mentionCandidates.map((candidate, index) => (
              <button
                key={candidate.id}
                className={
                  index === mentionIndex ? 'agent-mention-item active' : 'agent-mention-item'
                }
                title={candidate.path}
                onMouseEnter={() => setMentionIndex(index)}
                onMouseDown={(event) => {
                  // mousedown (not click) so the textarea keeps focus.
                  event.preventDefault()
                  pickMention(candidate)
                }}
              >
                <FileText size={12} />
                <span className="agent-mention-title">{candidate.title || 'Untitled'}</span>
                {candidate.folder && (
                  <span className="agent-mention-folder">{candidate.folder}</span>
                )}
              </button>
            ))}
          </div>
        )}
        <div className="agent-context-row">
          <div className="agent-context-badge" title={note?.path}>
            <FileText size={11} />
            <span>{note ? note.title || 'Untitled' : 'No note selected'}</span>
          </div>
          {mentions.map((mention) => (
            <div key={mention.id} className="agent-context-badge mention" title={mention.path}>
              <FileText size={11} />
              <span>{mention.title || 'Untitled'}</span>
              <button
                className="agent-context-remove"
                title="Remove from context"
                onClick={() => setMentions((prev) => prev.filter((m) => m.id !== mention.id))}
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
        <div className="agent-input-wrap">
          <textarea
            ref={composerRef}
            value={input}
            rows={1}
            placeholder="Ask about this note… @ adds others"
            disabled={!note || !configured || pending}
            onChange={(event) => {
              setInput(event.target.value)
              updateMentionMenu(event.target.value, event.target.selectionStart ?? 0)
              event.currentTarget.style.height = '44px'
              event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 112)}px`
            }}
            onBlur={() => setMentionMenu(null)}
            onKeyDown={(event) => {
              if (mentionMenu && mentionCandidates.length > 0) {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  const delta = event.key === 'ArrowDown' ? 1 : -1
                  setMentionIndex(
                    (i) => (i + delta + mentionCandidates.length) % mentionCandidates.length
                  )
                  return
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  event.preventDefault()
                  pickMention(mentionCandidates[mentionIndex])
                  return
                }
                if (event.key === 'Escape') {
                  setMentionMenu(null)
                  return
                }
              }
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
            {pending ? (
              <button className="agent-send-btn" onClick={stop} title="Stop">
                <Square size={11} fill="currentColor" />
              </button>
            ) : (
              <button
                className="agent-send-btn"
                onClick={() => void send()}
                disabled={!input.trim() || !note || !configured}
                title="Send"
              >
                <ArrowUp size={13} />
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}
