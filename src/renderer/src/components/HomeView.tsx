import { useEffect, useRef, useState } from 'react'
import {
  IconArrowUp as ArrowUp,
  IconDots as Dots,
  IconFileText as FileText,
  IconHistory as History,
  IconLoader2 as Loader2,
  IconMessagePlus as MessagePlus,
  IconMicrophone as Microphone,
  IconPlus as Plus,
  IconSparkles as Sparkles,
  IconTrash as Trash
} from '@tabler/icons-react'
import type { HomeChatMessage, HomeChatThread, HomeChatThreadSummary } from '../../../shared/homeChat'
import type { Note, Settings } from '../../../shared/types'
import type { NoteTemplate } from '../../../shared/noteTemplates'
import {
  HOME_AGENT_INSTRUCTIONS,
  parseNewNoteOutput,
  parseTemplateOutput,
  visibleAgentMessage
} from '../../../shared/noteTemplates'
import { aiErrorMessage } from '../../../shared/aiError'
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
import { aiStream, isAiConfigured } from '../ai/client'
import MarkdownText from './MarkdownText'
import ContextMenu from './ContextMenu'
import ConfirmDialog from './ConfirmDialog'

interface Props {
  onCreateNote: () => Promise<void>
  onCreateMeeting: () => Promise<void>
  onOpenNote: (note: Note) => Promise<void>
}

function id(): string {
  return crypto.randomUUID()
}

function message(role: HomeChatMessage['role'], content: string): HomeChatMessage {
  return { id: id(), role, content, createdAt: new Date().toISOString() }
}

function threadTitle(prompt: string): string {
  const flat = prompt.replace(/\s+/g, ' ').trim()
  return flat.length > 52 ? `${flat.slice(0, 51)}…` : flat || 'New chat'
}

export default function HomeView({ onCreateNote, onCreateMeeting, onOpenNote }: Props) {
  const [templates, setTemplates] = useState<NoteTemplate[]>([])
  const [history, setHistory] = useState<HomeChatThreadSummary[]>([])
  const [thread, setThread] = useState<HomeChatThread | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [streamed, setStreamed] = useState('')
  const [activity, setActivity] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [selectedModel, setSelectedModel] = useState(AUTO_AI_MODEL_ID)
  const [creatingTemplateId, setCreatingTemplateId] = useState<string | null>(null)
  const [templateMenu, setTemplateMenu] = useState<{
    x: number
    y: number
    template: NoteTemplate
  } | null>(null)
  const [templateToDelete, setTemplateToDelete] = useState<NoteTemplate | null>(null)
  const cancelRef = useRef<(() => void) | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const loadTemplates = (): void => {
    void window.api.templates.list().then(setTemplates)
  }
  const loadHistory = (): void => {
    void window.api.homeChat.list().then(setHistory)
  }

  useEffect(() => {
    loadTemplates()
    loadHistory()
    void window.api.settings.get().then((next) => {
      setSettings(next)
      setSelectedModel(normalizeAiModelChoice(next.aiModel))
    })
    const templatesChanged = (): void => loadTemplates()
    const settingsChanged = (): void => {
      void window.api.settings.get().then((next) => {
        setSettings(next)
        setSelectedModel(normalizeAiModelChoice(next.aiModel))
      })
    }
    window.addEventListener('noteato:templates-changed', templatesChanged)
    window.addEventListener('noteato:ai-settings-changed', settingsChanged)
    return () => {
      cancelRef.current?.()
      window.removeEventListener('noteato:templates-changed', templatesChanged)
      window.removeEventListener('noteato:ai-settings-changed', settingsChanged)
    }
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [thread?.messages, streamed, activity])

  const resolvedModel = resolveAiModelChoice(
    selectedModel,
    settings?.aiProvider,
    settings ?? undefined
  )
  const chatEnabled = settings ? isAiConfigured(settings, resolvedModel.provider) : false
  const active = Boolean(thread?.messages.length || pending || historyOpen)

  const saveThread = async (next: HomeChatThread): Promise<void> => {
    setThread(next)
    await window.api.homeChat.save(next)
    loadHistory()
  }

  const chooseModel = async (choice: string): Promise<void> => {
    if (!settings) return
    const selected = resolveAiModelChoice(choice, settings.aiProvider, settings)
    setSelectedModel(selected.choice)
    const next = await window.api.settings.set({
      aiProvider: selected.provider,
      aiModel: selected.choice
    })
    setSettings(next)
    window.dispatchEvent(new Event('noteato:ai-settings-changed'))
  }

  const send = async (): Promise<void> => {
    const prompt = draft.trim()
    if (!prompt || pending || !settings || !chatEnabled) return
    const now = new Date().toISOString()
    const base: HomeChatThread = thread ?? {
      id: id(),
      title: threadTitle(prompt),
      messages: [],
      createdAt: now,
      updatedAt: now
    }
    const withUser = {
      ...base,
      messages: [...base.messages, message('user', prompt)],
      updatedAt: now
    }
    setDraft('')
    setHistoryOpen(false)
    setError(null)
    setPending(true)
    setStreamed('')
    setActivity('Thinking')
    await saveThread(withUser)

    let raw = ''
    try {
      const conversation = withUser.messages
        .map((item) => `${item.role.toUpperCase()}: ${item.content}`)
        .join('\n\n')
      const final = await aiStream(
        settings,
        {
          system: HOME_AGENT_INSTRUCTIONS,
          prompt: conversation,
          maxTokens: 4096,
          provider: resolvedModel.provider,
          model: resolvedModel.model
        },
        (delta) => {
          raw += delta
          const template = parseTemplateOutput(raw)
          const note = parseNewNoteOutput(raw)
          setStreamed(visibleAgentMessage(raw))
          setActivity(
            template.hasTemplateMarker
              ? 'Preparing the template'
              : note.hasNoteMarker
                ? 'Preparing the note'
                : 'Thinking'
          )
        },
        (cancel) => {
          cancelRef.current = cancel
        }
      )
      raw = final || raw
      const parsedTemplate = parseTemplateOutput(raw)
      const parsedNote = parseNewNoteOutput(raw)
      if (parsedTemplate.hasTemplateMarker && !parsedTemplate.draft) {
        throw new Error('The model stopped before it finished the template. Try again.')
      }
      if (parsedNote.hasNoteMarker && !parsedNote.note) {
        throw new Error('The model stopped before it finished the note. Try again.')
      }

      let result = visibleAgentMessage(raw)
      if (parsedTemplate.draft) {
        setActivity(`Saving “${parsedTemplate.draft.name}”`)
        const created = await window.api.templates.create(parsedTemplate.draft)
        loadTemplates()
        window.dispatchEvent(new Event('noteato:templates-changed'))
        result = `${result}\n\nTemplate created: **${created.name}**`.trim()
      } else if (parsedNote.note) {
        setActivity(`Creating “${parsedNote.note.title}”`)
        const created = await window.api.notes.create(parsedNote.note.title)
        const saved = await window.api.notes.save(created.id, {
          title: parsedNote.note.title,
          body: parsedNote.note.markdown
        })
        result = `${result}\n\nNote created: **${saved.title}**`.trim()
        await onOpenNote(saved)
      }
      if (!result) throw new Error('The model returned an empty response.')
      const completed: HomeChatThread = {
        ...withUser,
        messages: [...withUser.messages, message('assistant', result)],
        updatedAt: new Date().toISOString()
      }
      await saveThread(completed)
      setStreamed('')
      setActivity('')
    } catch (cause) {
      const detail = aiErrorMessage(cause)
      setError(detail)
      const failed: HomeChatThread = {
        ...withUser,
        messages: [...withUser.messages, message('assistant', `Couldn’t complete that. ${detail}`)],
        updatedAt: new Date().toISOString()
      }
      await saveThread(failed)
      setStreamed('')
      setActivity('')
    } finally {
      cancelRef.current = null
      setPending(false)
    }
  }

  const openThread = async (summary: HomeChatThreadSummary): Promise<void> => {
    const found = await window.api.homeChat.read(summary.id)
    if (!found) return
    setThread(found)
    setHistoryOpen(false)
    setError(null)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const newChat = (): void => {
    cancelRef.current?.()
    setThread(null)
    setHistoryOpen(false)
    setDraft('')
    setStreamed('')
    setActivity('')
    setError(null)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const createFromTemplate = async (
    template: NoteTemplate,
    kind: 'note' | 'meeting'
  ): Promise<void> => {
    setError(null)
    setCreatingTemplateId(template.id)
    try {
      const note =
        kind === 'meeting'
          ? await window.api.templates.createMeeting(template.id)
          : await window.api.templates.createNote(template.id)
      if (!note) return
      await onOpenNote(note)
    } catch (cause) {
      setError(aiErrorMessage(cause))
    } finally {
      setCreatingTemplateId(null)
    }
  }

  return (
    <section className={active ? 'home-view active' : 'home-view'}>
      <div className="home-conversation" ref={scrollRef}>
        {historyOpen ? (
          <div className="home-history">
            <div className="home-section-heading">
              <div>
                <span>History</span>
                <strong>Previous chats</strong>
              </div>
              <button type="button" onClick={newChat} title="New chat">
                <MessagePlus size={16} />
              </button>
            </div>
            {history.length === 0 ? (
              <div className="home-history-empty">No conversations yet.</div>
            ) : (
              <div className="home-history-list">
                {history.map((item) => (
                  <div className="home-history-row" key={item.id}>
                    <button type="button" onClick={() => void openThread(item)}>
                      <strong>{item.title}</strong>
                      <span>{item.preview || 'Empty conversation'}</span>
                    </button>
                    <button
                      type="button"
                      className="home-row-delete"
                      title="Delete chat"
                      onClick={async () => {
                        await window.api.homeChat.delete(item.id)
                        if (thread?.id === item.id) setThread(null)
                        loadHistory()
                      }}
                    >
                      <Trash size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : thread?.messages.length || pending ? (
          <div className="home-chat-thread">
            {thread?.messages.map((item) => (
              <div key={item.id} className={`home-chat-turn ${item.role}`}>
                {item.role === 'assistant' ? <MarkdownText text={item.content} /> : item.content}
              </div>
            ))}
            {pending && (
              <div className="home-chat-turn assistant streaming" aria-live="polite">
                {streamed && <MarkdownText text={streamed} />}
                <div className="home-agent-activity">
                  <Loader2 size={12} className="spin" />
                  <span>{activity}</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="home-intro">
            <Sparkles size={18} />
            <h1>What do you want to create?</h1>
          </div>
        )}
      </div>

      <div className="home-dock">
        <div className="home-composer note-chat-composer-field">
          <button
            type="button"
            className={historyOpen ? 'note-chat-tool-btn active' : 'note-chat-tool-btn'}
            aria-label="Chat history"
            title="Chat history"
            onClick={() => setHistoryOpen((open) => !open)}
          >
            <History size={15} />
          </button>
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            disabled={!chatEnabled}
            placeholder={chatEnabled ? 'Ask Noteato…' : 'Add an AI key in Settings'}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
          />
          <select
            className="note-chat-model-select"
            aria-label="AI model"
            value={selectedModel}
            disabled={pending || !settings}
            onChange={(event) => void chooseModel(event.target.value)}
          >
            <option
              value={AUTO_AI_MODEL_ID}
              disabled={!settings || availableAiProviders(settings).length === 0}
            >
              Auto
            </option>
            {AI_PROVIDER_ORDER.map((provider) => (
              <optgroup
                key={provider}
                label={AI_PROVIDER_LABELS[provider]}
                disabled={!settings || !hasAiProviderKey(settings, provider)}
              >
                {listedAiModels(provider).map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {pending ? (
            <button
              type="button"
              className="note-chat-send-btn"
              onClick={() => cancelRef.current?.()}
              title="Stop"
            >
              <span className="home-stop-mark" />
            </button>
          ) : (
            <button
              type="button"
              className="note-chat-send-btn"
              disabled={!draft.trim() || !chatEnabled}
              onClick={() => void send()}
              title="Send"
            >
              <ArrowUp size={14} />
            </button>
          )}
        </div>

        <div className="home-quick-actions">
          <button type="button" onClick={() => void onCreateNote()}>
            <Plus size={14} />
            <span>New note</span>
          </button>
          <button type="button" onClick={() => void onCreateMeeting()}>
            <Microphone size={14} />
            <span>New meeting</span>
          </button>
          {active && (
            <button type="button" onClick={newChat}>
              <MessagePlus size={14} />
              <span>New chat</span>
            </button>
          )}
        </div>
        {error && <div className="home-chat-error">{error}</div>}
      </div>

      {!active && templates.length > 0 && (
        <div className="home-templates">
          <div className="home-template-label">Templates</div>
          <div className="home-template-grid">
            {templates.map((template) => (
              <div className="home-template-card" key={template.id}>
                <div className="home-template-card-copy">
                  <FileText size={15} />
                  <span>
                    <strong>{template.name}</strong>
                    <small>
                      {creatingTemplateId === template.id
                        ? 'Creating…'
                        : template.description || template.titlePattern}
                    </small>
                  </span>
                </div>
                <button
                  type="button"
                  className="home-template-menu"
                  title={`${template.name} actions`}
                  aria-label={`${template.name} actions`}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    setTemplateMenu({
                      x: rect.right - 190,
                      y: rect.bottom + 5,
                      template
                    })
                  }}
                >
                  <Dots size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {templateMenu && (
        <ContextMenu
          x={templateMenu.x}
          y={templateMenu.y}
          items={[
            {
              label: 'Create note',
              onClick: () => void createFromTemplate(templateMenu.template, 'note')
            },
            {
              label: 'Create meeting',
              onClick: () => void createFromTemplate(templateMenu.template, 'meeting')
            },
            { separator: true, label: '' },
            {
              label: 'Delete',
              danger: true,
              onClick: () => setTemplateToDelete(templateMenu.template)
            }
          ]}
          onClose={() => setTemplateMenu(null)}
        />
      )}
      {templateToDelete && (
        <ConfirmDialog
          title="Delete template?"
          message={`“${templateToDelete.name}” will be permanently deleted. Notes already created from it will not be affected.`}
          confirmLabel="Delete template"
          danger
          onCancel={() => setTemplateToDelete(null)}
          onConfirm={() => {
            const template = templateToDelete
            setTemplateToDelete(null)
            void window.api.templates
              .delete(template.id)
              .then(() => {
                loadTemplates()
                window.dispatchEvent(new Event('noteato:templates-changed'))
              })
              .catch((cause) => setError(aiErrorMessage(cause)))
          }}
        />
      )}
    </section>
  )
}
