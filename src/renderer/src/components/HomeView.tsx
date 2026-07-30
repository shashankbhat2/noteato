import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  IconArrowUp as ArrowUp,
  IconBell as Bell,
  IconBulb as Bulb,
  IconChevronDown as ChevronDown,
  IconChevronLeft as ChevronLeft,
  IconChevronRight as ChevronRight,
  IconFileText as FileText,
  IconGripVertical as Grip,
  IconListCheck as ListCheck,
  IconPencil as Pencil,
  IconPin as Pin,
  IconPlus as Plus,
  IconSparkle as Sparkles,
  IconSquare as Square,
  IconX as X
} from '@tabler/icons-react'
import type { NoteSummary, Settings } from '../../../shared/types'
import { aiStream } from '../ai/client'
import { CHEAP_AI_MODELS } from '../ai/models'
import MarkdownText from './MarkdownText'

const CHAT_KEY = 'noteato:homeChat'
const MODEL_KEY = 'noteato:homeModel'
const ORDER_KEY = 'noteato:homeOrder'

type SectionId = 'recent' | 'pinned' | 'reminders'

const DEFAULT_ORDER: SectionId[] = ['recent', 'pinned', 'reminders']

function readOrder(): SectionId[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(ORDER_KEY) ?? 'null')
    if (!Array.isArray(parsed)) return DEFAULT_ORDER
    const kept = parsed.filter((id): id is SectionId => DEFAULT_ORDER.includes(id))
    // Union with the defaults so a section added in a later version still
    // appears for people with a stored order.
    return [...kept, ...DEFAULT_ORDER.filter((id) => !kept.includes(id))]
  } catch {
    return DEFAULT_ORDER
  }
}
const MAX_STORED_MESSAGES = 40
const RECENT_CARD_LIMIT = 6

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface Props {
  notes: NoteSummary[]
  /** Most-recently-viewed note ids, newest first (tracked in MainLayout). */
  recentIds: string[]
  onOpenNote: (note: NoteSummary) => void
  onSetReminder: (note: NoteSummary, reminderAt: string | null) => void
  /** This pane's move/close controls; empty when only one pane is open. */
  paneControls?: React.ReactNode
}

interface ModelOption {
  id: string
  label: string
  provider: 'anthropic' | 'openai'
}

/**
 * Only models whose provider actually has a key on file — a picker that can
 * offer an unusable model is worse than no picker.
 */
function availableModels(settings: Settings): ModelOption[] {
  const out: ModelOption[] = []
  if (settings.anthropicApiKey.trim()) {
    for (const model of CHEAP_AI_MODELS.anthropic) out.push({ ...model, provider: 'anthropic' })
  }
  if (settings.openaiApiKey.trim()) {
    for (const model of CHEAP_AI_MODELS.openai) out.push({ ...model, provider: 'openai' })
  }
  return out
}

function readStoredChat(): ChatMessage[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHAT_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// Verb-flavoured greetings, bucketed by time of day; one is drawn at random
// each visit.
const GREETINGS: Record<'night' | 'morning' | 'afternoon' | 'evening', string[]> = {
  night: ['Burning the midnight oil', 'Thinking after dark', 'Chasing a late idea'],
  morning: ['Starting fresh', 'Sketching the day', 'Catching the morning light'],
  afternoon: ['Keeping the momentum', 'Digging in', 'Turning thoughts into pages'],
  evening: ['Winding down', 'Collecting the day', 'Writing into the evening']
}

function drawGreeting(): string {
  const hour = new Date().getHours()
  const bucket =
    hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'
  const pool = GREETINGS[bucket]
  return pool[Math.floor(Math.random() * pool.length)]
}

function timeOfDayLabel(): string {
  const hour = new Date().getHours()
  if (hour < 5) return 'Up late'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

// --- Assistant panel --------------------------------------------------------

const SUGGESTIONS: { icon: React.ReactNode; label: string }[] = [
  { icon: <Pencil size={15} />, label: 'Help me outline a note' },
  { icon: <Bulb size={15} />, label: 'Brainstorm ideas with me' },
  { icon: <ListCheck size={15} />, label: 'Plan my day' }
]

/**
 * Composer docked to the bottom of the Home container. Collapsed it is just
 * the input; focusing it expands the chat upward from the same anchor, over a
 * blurred backdrop. The dock stays mounted while collapsed, so a reply can
 * keep streaming in the background, and the thread itself lives in
 * localStorage so leaving Home parks the conversation.
 */
function AssistantDock({ settings }: { settings: Settings }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>(readStoredChat)
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [streamText, setStreamText] = useState('')
  const cancelRef = useRef<(() => void) | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const name = settings.userName.trim()

  const models = useMemo(() => availableModels(settings), [settings])
  const [modelId, setModelId] = useState<string>(() => localStorage.getItem(MODEL_KEY) ?? '')
  // A stored choice can outlive its key being removed — fall back rather than
  // sending a request that is guaranteed to fail.
  const activeModel = models.find((model) => model.id === modelId) ?? models[0] ?? null
  const configured = Boolean(activeModel)

  useEffect(() => {
    localStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)))
  }, [messages])

  useEffect(() => {
    const thread = threadRef.current
    if (thread) thread.scrollTop = thread.scrollHeight
  }, [messages, streamText, open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // Leaving Home mid-stream resolves the request with what has streamed so
  // far (see ai/client), rather than leaving it running headless. Collapsing
  // the dock does not cancel — the dock stays mounted and keeps streaming.
  useEffect(() => () => cancelRef.current?.(), [])

  const send = async (text?: string): Promise<void> => {
    const content = (text ?? input).trim()
    if (!content || pending || !activeModel) return
    setOpen(true)
    const userMessage: ChatMessage = { role: 'user', content }
    const history = [...messages, userMessage]
    setMessages(history)
    setInput('')
    setPending(true)
    setStreamText('')

    const transcript = history
      .slice(-12)
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join('\n\n')
    let streamed = ''
    try {
      const raw = await aiStream(
        settings,
        {
          system:
            'You are the Noteato home assistant: a concise, helpful general assistant inside a note-taking app. Answer in markdown. Keep replies short unless asked for depth.',
          prompt: transcript,
          maxTokens: 4096,
          provider: activeModel.provider,
          model: activeModel.id
        },
        (delta) => {
          streamed += delta
          setStreamText(streamed)
        },
        (cancel) => {
          cancelRef.current = cancel
        }
      )
      const reply = (raw || streamed).trim()
      if (reply) setMessages((prev) => [...prev, { role: 'assistant', content: reply }])
    } catch (error) {
      const partial = streamed.trim()
      const message =
        partial || (error instanceof Error ? error.message : 'Something went wrong — try again.')
      setMessages((prev) => [...prev, { role: 'assistant', content: message }])
    } finally {
      cancelRef.current = null
      setPending(false)
      setStreamText('')
    }
  }

  const empty = messages.length === 0 && !pending

  return (
    <>
      {open && <div className="home-ai-backdrop" onClick={() => setOpen(false)} />}
      <div className={open ? 'home-ai-dock open' : 'home-ai-dock'}>
        {open && (
          <div className="home-ai-expand">
            <header className="home-ai-head">
              <span className="home-ai-title">Assistant</span>
              <span className="home-ai-head-actions">
                {messages.length > 0 && (
                  <button title="New chat" onClick={() => setMessages([])}>
                    <Plus size={15} />
                  </button>
                )}
                <button title="Collapse" onClick={() => setOpen(false)}>
                  <ChevronDown size={15} />
                </button>
              </span>
            </header>

            {empty ? (
              <div className="home-ai-hero">
                <span className="home-ai-avatar">
                  <Sparkles size={22} />
                </span>
                <div className="home-ai-greet">
                  {timeOfDayLabel()}
                  {name ? `, ${name}` : ''}
                </div>
                <div className="home-ai-sub">What can I do for you?</div>
                <div className="home-ai-suggestions">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion.label}
                      className="home-ai-suggestion"
                      onClick={() => void send(suggestion.label)}
                      disabled={!configured}
                    >
                      <span className="home-ai-suggestion-icon">{suggestion.icon}</span>
                      <span>{suggestion.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="home-chat-thread home-ai-thread" ref={threadRef}>
                {messages.map((message, index) => (
                  <div key={index} className={`home-chat-msg ${message.role}`}>
                    <MarkdownText text={message.content} />
                  </div>
                ))}
                {pending && (
                  <div className="home-chat-msg assistant">
                    {streamText ? (
                      <MarkdownText text={streamText} />
                    ) : (
                      <span className="home-chat-thinking">Thinking…</span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="home-chat-inputwrap home-ai-inputwrap">
          <Sparkles size={16} className="home-chat-glyph" />
          <input
            ref={inputRef}
            value={input}
            placeholder={configured ? 'Do anything with AI…' : 'Add an API key in Settings'}
            disabled={!configured}
            onFocus={() => setOpen(true)}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !pending) void send()
            }}
          />
          {activeModel && models.length > 1 && (
            <select
              className="home-ai-model"
              value={activeModel.id}
              title="Model"
              onChange={(event) => {
                setModelId(event.target.value)
                localStorage.setItem(MODEL_KEY, event.target.value)
              }}
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          )}
          {pending ? (
            <button className="home-chat-send" title="Stop" onClick={() => cancelRef.current?.()}>
              <Square size={13} />
            </button>
          ) : (
            <button
              className="home-chat-send"
              title="Send"
              disabled={!input.trim() || !configured}
              onClick={() => void send()}
            >
              <ArrowUp size={15} />
            </button>
          )}
        </div>
      </div>
    </>
  )
}

// --- Calendar ---------------------------------------------------------------

// Half-hour slots from 6am to 11:30pm — the range reminders realistically
// land in, at the granularity people actually pick.
const TIME_SLOTS: string[] = (() => {
  const out: string[] = []
  for (let hour = 6; hour <= 23; hour += 1) {
    out.push(`${String(hour).padStart(2, '0')}:00`)
    out.push(`${String(hour).padStart(2, '0')}:30`)
  }
  return out
})()

const TIME_ANCHORS = [
  { label: 'Morning', value: '09:00' },
  { label: 'Noon', value: '12:00' },
  { label: 'Evening', value: '18:00' },
  { label: 'Night', value: '21:00' }
]

/** "09:00" → "9 AM", "14:30" → "2:30 PM". */
function formatSlot(slot: string): string {
  const [hour, minute] = slot.split(':').map(Number)
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const display = hour % 12 === 0 ? 12 : hour % 12
  return minute === 0 ? `${display} ${suffix}` : `${display}:${minute} ${suffix}`
}

function relativeDayLabel(date: Date, today: Date): string | null {
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  if (dayKey(date) === dayKey(today)) return 'Today'
  if (dayKey(date) === dayKey(tomorrow)) return 'Tomorrow'
  return null
}

/** Tight form for grid chips: "9a", "2:30p". */
function compactTime(iso: string): string {
  const date = new Date(iso)
  const hour = date.getHours()
  const minute = date.getMinutes()
  const display = hour % 12 === 0 ? 12 : hour % 12
  const suffix = hour >= 12 ? 'p' : 'a'
  return minute === 0 ? `${display}${suffix}` : `${display}:${String(minute).padStart(2, '0')}${suffix}`
}

/**
 * Horizontal rail of half-hour slots. The selection scrolls itself into view,
 * so jumping via an anchor moves the rail to that part of the day rather than
 * leaving the choice off-screen.
 */
function TimeRail({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const railRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const rail = railRef.current
    const selected = rail?.querySelector<HTMLElement>('[data-selected="true"]')
    if (!rail || !selected) return
    rail.scrollTo({
      left: selected.offsetLeft - rail.clientWidth / 2 + selected.clientWidth / 2,
      behavior: 'smooth'
    })
  }, [value])

  return (
    <div className="cal-time">
      <div className="cal-anchors">
        {TIME_ANCHORS.map((anchor) => (
          <button
            key={anchor.value}
            className={value === anchor.value ? 'active' : undefined}
            onClick={() => onChange(anchor.value)}
          >
            {anchor.label}
          </button>
        ))}
      </div>
      <div className="cal-rail" ref={railRef}>
        {TIME_SLOTS.map((slot) => (
          <button
            key={slot}
            data-selected={slot === value}
            className={slot === value ? 'cal-slot active' : 'cal-slot'}
            onClick={() => onChange(slot)}
          >
            {formatSlot(slot)}
          </button>
        ))}
      </div>
    </div>
  )
}

interface DayAnchor {
  date: Date
  left: number
  top: number
  bottom: number
}

function HomeCalendar({
  notes,
  onOpenNote,
  onSetReminder
}: Pick<Props, 'notes' | 'onOpenNote' | 'onSetReminder'>) {
  const today = new Date()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [anchor, setAnchor] = useState<DayAnchor | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [query, setQuery] = useState('')
  const [addTime, setAddTime] = useState('09:00')
  const [adding, setAdding] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  const remindersByDay = useMemo(() => {
    const map = new Map<string, NoteSummary[]>()
    for (const note of notes) {
      if (!note.reminderAt) continue
      const key = dayKey(new Date(note.reminderAt))
      map.set(key, [...(map.get(key) ?? []), note])
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.reminderAt!.localeCompare(b.reminderAt!))
    }
    return map
  }, [notes])

  const cells = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1)
    // Monday-first grid.
    const lead = (first.getDay() + 6) % 7
    const start = new Date(viewYear, viewMonth, 1 - lead)
    return Array.from({ length: 42 }, (_, i) => {
      const date = new Date(start)
      date.setDate(start.getDate() + i)
      return date
    })
  }, [viewYear, viewMonth])

  const close = (): void => {
    setAnchor(null)
    setPos(null)
    setAdding(false)
    setQuery('')
  }

  // Position from the popover's real size rather than a guessed constant, and
  // flip above the day when there isn't room below it.
  useLayoutEffect(() => {
    const element = popoverRef.current
    if (!anchor || !element) return
    const rect = element.getBoundingClientRect()
    const margin = 12
    let x = anchor.left
    let y = anchor.bottom + 6
    if (x + rect.width > window.innerWidth - margin) x = window.innerWidth - rect.width - margin
    if (y + rect.height > window.innerHeight - margin) {
      const above = anchor.top - rect.height - 6
      y = above >= margin ? above : Math.max(margin, window.innerHeight - rect.height - margin)
    }
    setPos({ x: Math.max(margin, x), y })
  }, [anchor, adding, query])

  useEffect(() => {
    if (!anchor) return
    const onDown = (event: MouseEvent): void => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) close()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchor])

  const moveMonth = (delta: number): void => {
    const next = new Date(viewYear, viewMonth + delta, 1)
    setViewYear(next.getFullYear())
    setViewMonth(next.getMonth())
    close()
  }

  const openDay = (date: Date, element: HTMLElement, startAdding = false): void => {
    const rect = element.getBoundingClientRect()
    setAnchor({ date: new Date(date), left: rect.left, top: rect.top, bottom: rect.bottom })
    setPos(null)
    setAdding(startAdding)
    setQuery('')
  }

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return notes
      .filter((note) => !needle || (note.title || 'Untitled').toLowerCase().includes(needle))
      .sort((a, b) => Number(Boolean(a.reminderAt)) - Number(Boolean(b.reminderAt)))
      .slice(0, 5)
  }, [notes, query])

  const addReminder = (note: NoteSummary): void => {
    if (!anchor) return
    const [hours, minutes] = addTime.split(':').map(Number)
    const at = new Date(anchor.date)
    at.setHours(hours || 0, minutes || 0, 0, 0)
    onSetReminder(note, at.toISOString())
    setAdding(false)
    setQuery('')
  }

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleString([], {
    month: 'long',
    year: 'numeric'
  })
  const dayReminders = anchor ? remindersByDay.get(dayKey(anchor.date)) ?? [] : []

  return (
    <div className="cal">
      <div className="cal-head">
        <h3 className="cal-month">{monthLabel}</h3>
        <div className="cal-nav">
          <button
            className="cal-today"
            onClick={() => {
              setViewYear(today.getFullYear())
              setViewMonth(today.getMonth())
              close()
            }}
          >
            Today
          </button>
          <button title="Previous month" onClick={() => moveMonth(-1)}>
            <ChevronLeft size={15} />
          </button>
          <button title="Next month" onClick={() => moveMonth(1)}>
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      <div className="cal-dow">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>

      <div className="cal-grid">
        {cells.map((date) => {
          const inMonth = date.getMonth() === viewMonth
          const isToday = dayKey(date) === dayKey(today)
          const list = remindersByDay.get(dayKey(date)) ?? []
          const shown = list.slice(0, 2)
          const overflow = list.length - shown.length
          return (
            <div
              key={date.toISOString()}
              className={[
                'cal-cell',
                inMonth ? '' : 'outside',
                anchor && dayKey(anchor.date) === dayKey(date) ? 'active' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={(event) => openDay(date, event.currentTarget)}
            >
              <div className="cal-cell-top">
                <span className={isToday ? 'cal-num today' : 'cal-num'}>{date.getDate()}</span>
                <button
                  className="cal-quick-add"
                  title="Add a reminder"
                  onClick={(event) => {
                    event.stopPropagation()
                    openDay(date, event.currentTarget.closest('.cal-cell') as HTMLElement, true)
                  }}
                >
                  <Plus size={12} />
                </button>
              </div>
              <div className="cal-events">
                {shown.map((note) => (
                  <button
                    key={note.id}
                    className="cal-chip"
                    title={`${formatSlot(
                      new Date(note.reminderAt!).toTimeString().slice(0, 5)
                    )} · ${note.title || 'Untitled'}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      onOpenNote(note)
                    }}
                  >
                    <span className="cal-chip-time">{compactTime(note.reminderAt!)}</span>
                    <span className="cal-chip-title">{note.title || 'Untitled'}</span>
                  </button>
                ))}
                {overflow > 0 && <span className="cal-more">{overflow} more</span>}
              </div>
            </div>
          )
        })}
      </div>

      {anchor && (
        <div
          className="cal-pop"
          ref={popoverRef}
          style={{
            left: pos?.x ?? anchor.left,
            top: pos?.y ?? anchor.bottom + 6,
            // Hidden for the single frame before measurement lands, so the
            // popover never visibly jumps into place.
            visibility: pos ? 'visible' : 'hidden'
          }}
        >
          <div className="cal-pop-head">
            <span className="cal-pop-date">
              {relativeDayLabel(anchor.date, today) ??
                anchor.date.toLocaleDateString([], {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric'
                })}
            </span>
            {!adding && (
              <button className="cal-pop-add" title="Add a reminder" onClick={() => setAdding(true)}>
                <Plus size={14} />
              </button>
            )}
          </div>

          {adding ? (
            <div className="cal-pop-composer">
              <TimeRail value={addTime} onChange={setAddTime} />
              <div className="cal-pick">
                <span className="cal-pick-label">Remind me about</span>
                <input
                  className="cal-search"
                  autoFocus
                  value={query}
                  placeholder="Search notes…"
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && results[0]) addReminder(results[0])
                  }}
                />
                <ul className="cal-results">
                  {results.length === 0 ? (
                    <li className="cal-noresult">No notes match.</li>
                  ) : (
                    results.map((note) => (
                      <li key={note.id}>
                        <button onClick={() => addReminder(note)}>
                          <FileText size={13} />
                          <span>{note.title || 'Untitled'}</span>
                          {note.reminderAt && <Bell size={11} className="cal-result-bell" />}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
              <button className="cal-pop-cancel" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </div>
          ) : dayReminders.length === 0 ? (
            <button className="cal-pop-empty" onClick={() => setAdding(true)}>
              <Plus size={14} />
              <span>Add a reminder</span>
            </button>
          ) : (
            <ul className="cal-pop-list">
              {dayReminders.map((note) => (
                <li key={note.id}>
                  <button className="cal-pop-item" onClick={() => onOpenNote(note)}>
                    <span className="cal-pop-time">
                      {formatSlot(new Date(note.reminderAt!).toTimeString().slice(0, 5))}
                    </span>
                    <span className="cal-pop-title">{note.title || 'Untitled'}</span>
                  </button>
                  <button
                    className="cal-pop-remove"
                    title="Remove reminder"
                    onClick={() => onSetReminder(note, null)}
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}


// --- Home -------------------------------------------------------------------

function NoteCard({
  note,
  onOpen
}: {
  note: NoteSummary
  onOpen: (note: NoteSummary) => void
}) {
  return (
    <button className="home-card" onClick={() => onOpen(note)} title={note.path}>
      <span className="home-card-glyph">
        {note.pinned ? <Pin size={13} /> : <FileText size={13} />}
      </span>
      <span className="home-card-title">{note.title || 'Untitled'}</span>
      <span className="home-card-excerpt">{note.excerpt || 'Empty note'}</span>
      <span className="home-card-meta">{note.folder || 'Notes'}</span>
    </button>
  )
}

export default function HomeView({
  notes,
  recentIds,
  onOpenNote,
  onSetReminder,
  paneControls
}: Props) {
  const [settings, setSettings] = useState<Settings | null>(null)
  // One phrase per visit, not per render.
  const [phrase] = useState(drawGreeting)
  const [order, setOrder] = useState<SectionId[]>(readOrder)
  // Pointer-driven reordering rather than HTML5 drag-and-drop: the list
  // reshuffles live under the cursor instead of waiting for a drop, which is
  // what makes it feel responsive.
  const [dragId, setDragId] = useState<SectionId | null>(null)
  const sectionRefs = useRef(new Map<SectionId, HTMLElement>())

  useEffect(() => {
    void window.api.settings.get().then(setSettings)
  }, [])

  const recents = useMemo(
    () =>
      recentIds
        .map((id) => notes.find((note) => note.id === id))
        .filter((note): note is NoteSummary => Boolean(note))
        .slice(0, RECENT_CARD_LIMIT),
    [recentIds, notes]
  )
  const pinned = useMemo(() => notes.filter((note) => note.pinned), [notes])

  const setAssistantEnabled = (enabled: boolean): void => {
    if (!settings) return
    setSettings({ ...settings, homeAssistantEnabled: enabled })
    void window.api.settings.set({ homeAssistantEnabled: enabled })
  }

  // While dragging, follow the pointer: work out which slot it is over from the
  // rendered midpoints and reorder immediately, so sections slide out of the
  // way as you move rather than only settling on release.
  useEffect(() => {
    if (!dragId) return

    const onMove = (event: PointerEvent): void => {
      const visible = order.filter((id) => sectionRefs.current.has(id))
      const midpoints = visible.map((id) => {
        const rect = sectionRefs.current.get(id)!.getBoundingClientRect()
        return rect.top + rect.height / 2
      })
      let target = midpoints.findIndex((mid) => event.clientY < mid)
      if (target === -1) target = visible.length - 1
      const current = visible.indexOf(dragId)
      if (target === current || current === -1) return

      setOrder((prev) => {
        const next = prev.filter((id) => id !== dragId)
        const anchor = visible[target]
        const at = next.indexOf(anchor)
        next.splice(target > current ? at + 1 : at, 0, dragId)
        return next
      })
    }

    const onUp = (): void => setDragId(null)

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    document.body.classList.add('is-reordering')
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.classList.remove('is-reordering')
    }
  }, [dragId, order])

  // Persist once the drag settles, not on every intermediate shuffle.
  useEffect(() => {
    if (dragId) return
    localStorage.setItem(ORDER_KEY, JSON.stringify(order))
  }, [dragId, order])

  const section = (id: SectionId, title: string, body: React.ReactNode): React.ReactNode => (
    <section
      key={id}
      ref={(element) => {
        if (element) sectionRefs.current.set(id, element)
        else sectionRefs.current.delete(id)
      }}
      className={dragId === id ? 'home-section dragging' : 'home-section'}
    >
      <div className="home-section-head">
        <span
          className="home-drag-handle"
          title="Drag to reorder"
          onPointerDown={(event) => {
            event.preventDefault()
            setDragId(id)
          }}
        >
          <Grip size={13} />
        </span>
        <h2>{title}</h2>
      </div>
      {body}
    </section>
  )

  const renderSection = (id: SectionId): React.ReactNode => {
    if (id === 'recent') {
      if (recents.length === 0) return null
      return section(
        'recent',
        'Recent',
        <div className="home-cards">
          {recents.map((note) => (
            <NoteCard key={note.id} note={note} onOpen={onOpenNote} />
          ))}
        </div>
      )
    }
    if (id === 'pinned') {
      if (pinned.length === 0) return null
      return section(
        'pinned',
        'Favourites',
        <div className="home-cards">
          {pinned.map((note) => (
            <NoteCard key={note.id} note={note} onOpen={onOpenNote} />
          ))}
        </div>
      )
    }
    return section(
      'reminders',
      'Reminders',
      <HomeCalendar notes={notes} onOpenNote={onOpenNote} onSetReminder={onSetReminder} />
    )
  }

  if (!settings) return <div className="home-view" />

  const name = settings.userName.trim()

  return (
    <div className="home-view">
      <header className="home-header">
        <h1 className="home-greeting">
          {phrase}
          {name && <span className="home-greeting-name">, {name}</span>}
        </h1>
        <div className="view-header-actions">
          <label className="home-assistant-toggle">
            <span>Assistant</span>
            <button
              className={settings.homeAssistantEnabled ? 'settings-switch on' : 'settings-switch'}
              role="switch"
              aria-checked={settings.homeAssistantEnabled}
              onClick={() => setAssistantEnabled(!settings.homeAssistantEnabled)}
            >
              <span className="settings-switch-knob" />
            </button>
          </label>
          {paneControls}
        </div>
      </header>

      {order.map(renderSection)}

      {/* Disabling the assistant removes the composer entirely, input included. */}
      {settings.homeAssistantEnabled && <AssistantDock settings={settings} />}
    </div>
  )
}
