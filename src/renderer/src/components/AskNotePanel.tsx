import { useEffect, useRef, useState } from 'react'
import { MessageCircleQuestion, Send, X } from 'lucide-react'
import type { BlockNoteEditor } from '@blocknote/core'
import { aiComplete } from '../ai/client'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface Props {
  editor: BlockNoteEditor
  noteTitle: string
}

export default function AskNotePanel({ editor, noteTitle }: Props) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [question, setQuestion] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages, pending])

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent): void => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const ask = async (): Promise<void> => {
    const q = question.trim()
    if (!q || pending) return
    setQuestion('')
    setError(null)
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: q }]
    setMessages(nextMessages)
    setPending(true)
    try {
      const settings = await window.api.settings.get()
      const noteMarkdown = await editor.blocksToMarkdownLossy(editor.document)
      const system = `You are answering questions about the user's note titled "${noteTitle || 'Untitled'}". Answer using only the note content below — if the answer isn't in the note, say so plainly. Be concise.\n\n--- NOTE CONTENT ---\n${noteMarkdown}`
      const history = nextMessages.map((m) => `${m.role === 'user' ? 'Q' : 'A'}: ${m.content}`).join('\n\n')
      const answer = await aiComplete(settings, { system, prompt: history, maxTokens: 800 })
      setMessages([...nextMessages, { role: 'assistant', content: answer.trim() }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI request failed.')
      setMessages(messages)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="ask-note" ref={wrapperRef}>
      <button
        className={open ? 'icon-toggle-btn active' : 'icon-toggle-btn'}
        onClick={() => setOpen(!open)}
        title="Ask about this note"
      >
        <MessageCircleQuestion size={15} />
      </button>
      {open && (
        <div className="ask-note-popup">
          <div className="ask-note-header">
            <h3>Ask about this note</h3>
            <button className="modal-close-btn" onClick={() => setOpen(false)} title="Close">
              <X size={14} />
            </button>
          </div>
          <div className="ask-note-messages" ref={listRef}>
            {messages.length === 0 && (
              <p className="ask-note-empty">Ask a question about this note&rsquo;s content.</p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'ask-note-msg user' : 'ask-note-msg assistant'}>
                {m.content}
              </div>
            ))}
            {pending && <div className="ask-note-msg assistant pending">Thinking…</div>}
          </div>
          {error && <div className="ask-note-error">{error}</div>}
          <div className="ask-note-input-row">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  ask()
                }
              }}
              placeholder="Ask a question…"
            />
            <button onClick={ask} disabled={pending || !question.trim()} title="Send">
              <Send size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
