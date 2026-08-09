import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  IconAlertCircle as AlertCircle,
  IconArrowLeft as ArrowLeft,
  IconCalendarEvent as CalendarEvent,
  IconCheck as Check,
  IconCheckbox as Checkbox,
  IconCircleDot as CircleDot,
  IconExternalLink as ExternalLink,
  IconFileText as FileText,
  IconLoader2 as Loader2,
  IconMail as Mail,
  IconPlugConnected as Plug,
  IconProgress as ProgressIcon,
  IconSend as Send,
  IconSparkles as Sparkles,
  IconSquare as Square,
  IconTransfer as Transfer,
  IconX as X
} from '@tabler/icons-react'
import type {
  DelegateContext,
  DelegateSuggestion,
  DelegateSuggestionsResult,
  McpExecutionProgress,
  McpExecutionResult
} from '../../../shared/mcp'
import type { NoteatoBlock, NoteatoEditor } from '../noteLink'
import MarkdownText from './MarkdownText'

const POPUP_WIDTH = 370

function RecipeIcon({ icon }: { icon: string }) {
  if (icon === 'checklist') return <Checkbox size={13} />
  if (icon === 'document') return <FileText size={13} />
  if (icon === 'mail') return <Mail size={13} />
  if (icon === 'send') return <Send size={13} />
  if (icon === 'calendar') return <CalendarEvent size={13} />
  if (icon === 'issue') return <CircleDot size={13} />
  if (icon === 'status') return <ProgressIcon size={13} />
  return <Sparkles size={13} />
}

interface Props {
  editor: NoteatoEditor
  blocks: NoteatoBlock[]
  selectedText: string
  position: { x: number; y: number } | null
  noteId: string
  noteTitle: string
  tab: DelegateContext['tab']
  onError: (message: string) => void
  onClose: () => void
}

export default function DelegatePopup({
  editor,
  blocks,
  selectedText,
  position,
  noteId,
  noteTitle,
  tab,
  onError,
  onClose
}: Props) {
  const [stage, setStage] = useState<'loading' | 'suggestions' | 'review' | 'running' | 'result'>(
    'loading'
  )
  const [data, setData] = useState<DelegateSuggestionsResult | null>(null)
  const [selected, setSelected] = useState<DelegateSuggestion | null>(null)
  const [argumentsValue, setArgumentsValue] = useState<Record<string, unknown>>({})
  const [progress, setProgress] = useState<McpExecutionProgress | null>(null)
  const [result, setResult] = useState<McpExecutionResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [measuredHeight, setMeasuredHeight] = useState(330)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async (): Promise<void> => {
      try {
        const blockMarkdown = await editor.blocksToMarkdownLossy(blocks)
        const markdown = selectedText.trim() || blockMarkdown
        const next = await window.api.mcp.suggest({ noteId, noteTitle, tab, markdown })
        if (cancelled) return
        setData(next)
        setStage('suggestions')
      } catch (cause) {
        if (cancelled) return
        const message = cause instanceof Error ? cause.message : 'Could not prepare a handoff.'
        setError(message)
        setStage('suggestions')
      }
    })()
    return () => {
      cancelled = true
      cancelRef.current?.()
    }
  }, [blocks, editor, noteId, noteTitle, selectedText, tab])

  useEffect(() => {
    const handlePointer = (event: MouseEvent): void => {
      if (stage === 'running') return
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) onClose()
    }
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && stage !== 'running') onClose()
    }
    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose, stage])

  useLayoutEffect(() => {
    const element = wrapperRef.current
    if (!element) return
    const observer = new ResizeObserver(() => setMeasuredHeight(element.offsetHeight))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const left = position
    ? Math.min(Math.max(position.x, 12), window.innerWidth - POPUP_WIDTH - 12)
    : Math.max(12, (window.innerWidth - POPUP_WIDTH) / 2)
  const top = position
    ? Math.max(12, Math.min(position.y + 8, window.innerHeight - measuredHeight - 12))
    : 110

  const review = (suggestion: DelegateSuggestion): void => {
    setSelected(suggestion)
    setArgumentsValue(suggestion.arguments)
    setError(null)
    setStage('review')
  }

  const execute = async (): Promise<void> => {
    if (!selected) return
    setStage('running')
    setError(null)
    setProgress({ status: 'connecting', message: `Connecting to ${selected.connectionName}` })
    try {
      const completed = await window.api.mcp.execute(
        {
          connectionId: selected.connectionId,
          toolName: selected.toolName,
          arguments: argumentsValue
        },
        setProgress,
        (cancel) => {
          cancelRef.current = cancel
        }
      )
      setResult(completed)
      setStage('result')
      if (completed.isError) setError(completed.text)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The handoff failed.'
      setError(message)
      onError(message)
      setStage('review')
    } finally {
      cancelRef.current = null
    }
  }

  const argumentProperties = selected?.inputSchema.properties
  const fields =
    argumentProperties && typeof argumentProperties === 'object' && !Array.isArray(argumentProperties)
      ? Object.entries(argumentProperties as Record<string, unknown>)
      : []
  const required = new Set(
    Array.isArray(selected?.inputSchema.required)
      ? selected.inputSchema.required.filter((item): item is string => typeof item === 'string')
      : []
  )

  const updateArgument = (name: string, value: unknown): void => {
    setArgumentsValue((current) => {
      if (value === undefined) {
        const next = { ...current }
        delete next[name]
        return next
      }
      return { ...current, [name]: value }
    })
  }

  const argumentField = (name: string, rawSchema: unknown): React.ReactNode => {
    const schema =
      rawSchema && typeof rawSchema === 'object' && !Array.isArray(rawSchema)
        ? (rawSchema as Record<string, unknown>)
        : {}
    const label =
      typeof schema.title === 'string'
        ? schema.title
        : name.replace(/[_-]+/g, ' ').replace(/^./, (letter) => letter.toUpperCase())
    const description = typeof schema.description === 'string' ? schema.description : ''
    const value = argumentsValue[name]
    const options = Array.isArray(schema.enum) ? schema.enum : null
    const type = typeof schema.type === 'string' ? schema.type : 'string'

    return (
      <label className="delegate-argument-field" key={name}>
        <span>{label}{required.has(name) ? <i>Required</i> : null}</span>
        {options ? (
          <select
            value={value === undefined ? '' : String(value)}
            onChange={(event) => {
              const option = options.find((item) => String(item) === event.target.value)
              updateArgument(name, event.target.value === '' ? undefined : option)
            }}
          >
            <option value="">Choose…</option>
            {options.map((option) => (
              <option key={String(option)} value={String(option)}>{String(option)}</option>
            ))}
          </select>
        ) : type === 'boolean' ? (
          <button
            type="button"
            className={value === true ? 'delegate-boolean on' : 'delegate-boolean'}
            role="switch"
            aria-checked={value === true}
            onClick={() => updateArgument(name, value !== true)}
          >
            <span /> {value === true ? 'Yes' : 'No'}
          </button>
        ) : type === 'number' || type === 'integer' ? (
          <input
            type="number"
            value={typeof value === 'number' ? value : ''}
            onChange={(event) =>
              updateArgument(
                name,
                event.target.value === '' ? undefined : Number(event.target.value)
              )
            }
          />
        ) : type === 'object' || type === 'array' ? (
          <textarea
            rows={4}
            spellCheck={false}
            value={typeof value === 'string' ? value : JSON.stringify(value ?? (type === 'array' ? [] : {}), null, 2)}
            onChange={(event) => {
              try {
                updateArgument(name, JSON.parse(event.target.value))
                setError(null)
              } catch {
                updateArgument(name, event.target.value)
                setError(`${label} must be valid JSON.`)
              }
            }}
          />
        ) : (
          <textarea
            rows={description.length > 80 || String(value ?? '').length > 90 ? 3 : 1}
            value={String(value ?? '')}
            onChange={(event) => updateArgument(name, event.target.value)}
          />
        )}
        {description && <small>{description}</small>}
      </label>
    )
  }

  return (
    <div
      className={`delegate-popup ${stage}`}
      ref={wrapperRef}
      style={{ left, top, width: POPUP_WIDTH }}
      role="dialog"
      aria-label="Delegate selection"
      aria-busy={stage === 'loading' || stage === 'running'}
    >
      <header className="delegate-popup-header">
        <span className="delegate-popup-mark"><Transfer size={14} /></span>
        <div>
          <strong>Handoff</strong>
          <span>{tab}</span>
        </div>
        <button type="button" onClick={onClose} title="Close" disabled={stage === 'running'}>
          <X size={14} />
        </button>
      </header>

      {stage === 'loading' && (
        <div className="delegate-popup-loading">
          <Loader2 size={16} className="spin" />
          <div><strong>Finding actions</strong><span>Reading the selection and connected apps</span></div>
        </div>
      )}

      {stage === 'suggestions' && (
        <div className="delegate-popup-body">
          {data?.connections.length ? (
            <div className="delegate-app-strip" aria-label="Connected apps">
              {data.connections.map((connection) => (
                <span key={connection.id} title={connection.error || connection.status}>
                  <i className={connection.status} />
                  {connection.name}
                </span>
              ))}
            </div>
          ) : null}
          {error ? (
            <div className="delegate-popup-empty error"><AlertCircle size={15} /><span>{error}</span></div>
          ) : data?.suggestions.length ? (
            <div className="delegate-suggestions">
              <span className="delegate-section-label">Actions for this selection</span>
              {data.suggestions.map((suggestion) => (
                <button type="button" key={suggestion.id} onClick={() => review(suggestion)}>
                  <span className="delegate-app-icon"><RecipeIcon icon={suggestion.recipeIcon} /></span>
                  <span>
                    <strong>{suggestion.title}</strong>
                    <small>
                      {suggestion.recipeTitle} in {suggestion.connectionName}
                      {suggestion.reason ? ` · ${suggestion.reason}` : ''}
                    </small>
                  </span>
                  <ExternalLink size={13} />
                </button>
              ))}
            </div>
          ) : (
            <div className="delegate-popup-empty">
              <Plug size={16} />
              <strong>No handoff suggested</strong>
              <span>{data?.unavailableReason || 'No connected tool matches this selection.'}</span>
              <button type="button" onClick={() => void window.api.app.openSettings('apps')}>
                Open Apps settings
              </button>
            </div>
          )}
        </div>
      )}

      {stage === 'review' && selected && (
        <div className="delegate-popup-body review">
          <button type="button" className="delegate-back" onClick={() => setStage('suggestions')}>
            <ArrowLeft size={13} /> Suggestions
          </button>
          <div className="delegate-review-title">
            <span className="delegate-app-icon"><RecipeIcon icon={selected.recipeIcon} /></span>
            <div>
              <strong>{selected.title}</strong>
              <span>{selected.recipeTitle} in {selected.connectionName}</span>
            </div>
          </div>
          {selected.destructive && (
            <div className="delegate-risk"><AlertCircle size={13} /> This app marks the action as destructive.</div>
          )}
          <div className="delegate-arguments">
            <span>Review details · {selected.toolName}</span>
            {fields.length ? (
              <div className="delegate-argument-fields">
                {fields.map(([name, schema]) => argumentField(name, schema))}
              </div>
            ) : (
              <div className="delegate-no-arguments">This action does not need any details.</div>
            )}
          </div>
          {error && <div className="delegate-inline-error">{error}</div>}
          <button type="button" className="delegate-confirm" onClick={() => void execute()}>
            <Transfer size={14} /> Hand off to {selected.connectionName}
          </button>
          <small className="delegate-consent">Nothing is sent until you press this button.</small>
        </div>
      )}

      {stage === 'running' && (
        <div className="delegate-popup-running">
          <Loader2 size={16} className="spin" />
          <div><strong>{progress?.message || 'Running handoff'}</strong><span>{selected?.connectionName}</span></div>
          <button type="button" onClick={() => cancelRef.current?.()} title="Stop">
            <Square size={11} fill="currentColor" />
          </button>
        </div>
      )}

      {stage === 'result' && result && (
        <div className="delegate-popup-body result">
          <div className={result.isError ? 'delegate-result-head error' : 'delegate-result-head'}>
            {result.isError ? <AlertCircle size={14} /> : <Check size={14} />}
            <div><strong>{result.isError ? 'App reported an error' : 'Handoff complete'}</strong><span>{result.connectionName}</span></div>
          </div>
          <div className="delegate-result-content"><MarkdownText text={result.text} /></div>
          <button type="button" className="delegate-result-done" onClick={onClose}>Done</button>
        </div>
      )}
    </div>
  )
}
