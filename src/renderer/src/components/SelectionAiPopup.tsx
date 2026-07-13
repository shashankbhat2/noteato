import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconAlignLeft as AlignLeft,
  IconArrowUp as ArrowUp,
  IconCheck as Check,
  IconCopy as Copy,
  IconListCheck as ListChecks,
  IconListDetails as ListPlus,
  IconLoader2 as Loader2,
  IconPencil as PenLine,
  IconSquare as Square,
  IconTextSpellcheck as SpellCheck,
  IconX as X
} from '@tabler/icons-react'
import { aiStream } from '../ai/client'
import type { NoteatoBlock, NoteatoEditor } from '../noteLink'

type SelectionAction = 'summarize' | 'improve' | 'extract' | 'proofread'

const ACTION_PROMPTS: Record<SelectionAction, string> = {
  summarize:
    'Summarize the following note content concisely, preserving the key facts. Respond with markdown only — no preamble, no explanation.',
  improve:
    'Improve the clarity, grammar, and flow of the following text without changing its meaning or removing information. Respond with markdown only — no preamble, no explanation.',
  extract:
    'Extract the key points from the following text as a concise markdown bullet list. Respond with markdown only — no preamble, no explanation.',
  proofread:
    'Proofread the following text: fix spelling, grammar, and punctuation without changing the meaning, tone, or formatting. Respond with the corrected text as markdown only — no preamble, no explanation.'
}

// replace rewrites the selection in place; append streams into a new block
// below it; overlay shows the result in this popup without touching the note
// until the user picks what to do with it.
type ApplyMode = 'replace' | 'append' | 'overlay'

const PRESETS: { action: SelectionAction; label: string; icon: ReactNode; mode: ApplyMode }[] = [
  { action: 'improve', label: 'Improve writing', icon: <PenLine size={15} />, mode: 'replace' },
  { action: 'proofread', label: 'Proofread', icon: <SpellCheck size={15} />, mode: 'overlay' },
  { action: 'summarize', label: 'Summarize', icon: <AlignLeft size={15} />, mode: 'overlay' },
  { action: 'extract', label: 'Extract key points', icon: <ListChecks size={15} />, mode: 'append' }
]

const POPUP_WIDTH = 320
const CHANGED_HIGHLIGHT_MS = 2400
const STREAM_RENDER_MS = 100

type BlockReference = string | { id: string }

function setBlockState(blocks: BlockReference[], state: 'pending' | 'changed' | null): void {
  for (const block of blocks) {
    const id = typeof block === 'string' ? block : block.id
    const element = document.querySelector<HTMLElement>(
      `[data-node-type="blockOuter"][data-id="${CSS.escape(id)}"]`
    )
    if (!element) continue
    if (state) element.dataset.enhanceState = state
    else delete element.dataset.enhanceState
  }
}

interface Props {
  editor: NoteatoEditor
  blocks: NoteatoBlock[]
  position: { x: number; y: number } | null
  onError: (message: string) => void
  onStreamingChange: (streaming: boolean) => void
  onClose: () => void
}

export default function SelectionAiPopup({
  editor,
  blocks,
  position,
  onError,
  onStreamingChange,
  onClose
}: Props) {
  const [instruction, setInstruction] = useState('')
  const [pending, setPending] = useState(false)
  const [overlay, setOverlay] = useState<{ text: string; done: boolean } | null>(null)
  const [copied, setCopied] = useState(false)
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const cancelStreamRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleClick = (e: MouseEvent): void => {
      if (!pending && wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKey = (e: KeyboardEvent): void => {
      if (!pending && e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose, pending])

  // Overlay mode: stream the result into a bubble inside this popup, leaving
  // the note untouched until the user copies/inserts/replaces.
  const runOverlay = async (system: string): Promise<void> => {
    if (pending) return
    setPending(true)
    setOverlay({ text: '', done: false })
    try {
      const settings = await window.api.settings.get()
      const markdown = await editor.blocksToMarkdownLossy(blocks)
      let streamed = ''
      const result = await aiStream(
        settings,
        { system, prompt: markdown, maxTokens: 1536 },
        (delta) => {
          streamed += delta
          setOverlay({ text: streamed, done: false })
        },
        (cancel) => {
          cancelStreamRef.current = cancel
        }
      )
      const text = (result || streamed).trim()
      if (!text) throw new Error('Enhancement returned no content.')
      setOverlay({ text, done: true })
    } catch (err) {
      setOverlay(null)
      onError(err instanceof Error ? err.message : 'Enhancement failed.')
    } finally {
      cancelStreamRef.current = null
      setPending(false)
    }
  }

  const insertOverlayResult = async (how: 'replace' | 'below'): Promise<void> => {
    if (!overlay?.text) return
    try {
      const parsed = await editor.tryParseMarkdownToBlocks(overlay.text)
      if (parsed.length === 0) return
      if (how === 'replace') {
        editor.replaceBlocks(
          blocks.map((block) => block.id),
          parsed
        )
      } else {
        editor.insertBlocks(parsed, blocks[blocks.length - 1].id, 'after')
      }
    } catch {
      onError('Could not apply the result to the note.')
      return
    }
    onClose()
  }

  const run = async (system: string, mode: ApplyMode = 'replace'): Promise<void> => {
    if (mode === 'overlay') return runOverlay(system)
    if (pending) return
    setPending(true)
    onStreamingChange(true)
    setBlockState(blocks, 'pending')
    // In append mode the result streams into a fresh block inserted after the
    // selection, leaving the selected content untouched.
    let currentBlockIds =
      mode === 'append'
        ? editor
            .insertBlocks([{ type: 'paragraph' }], blocks[blocks.length - 1].id, 'after')
            .map((block) => block.id)
        : blocks.map((block) => block.id)
    let streamedChange = false
    let renderedMarkdown = ''
    let renderTimer: number | undefined
    let renderChain = Promise.resolve()

    const queueRender = (markdown: string): void => {
      if (!markdown.trim() || markdown === renderedMarkdown) return
      renderChain = renderChain.then(async () => {
        if (markdown === renderedMarkdown) return
        try {
          const parsed = await editor.tryParseMarkdownToBlocks(markdown)
          if (parsed.length === 0) return
          const { insertedBlocks } = editor.replaceBlocks(currentBlockIds, parsed)
          currentBlockIds = insertedBlocks.map((block) => block.id)
          renderedMarkdown = markdown
          streamedChange = true
          setBlockState(insertedBlocks, 'pending')
        } catch {
          // A partial markdown token can be temporarily unparsable. The next
          // streamed snapshot retries with more complete content.
        }
      })
    }

    try {
      const settings = await window.api.settings.get()
      const markdown = await editor.blocksToMarkdownLossy(blocks)
      let streamedMarkdown = ''
      const result = await aiStream(
        settings,
        { system, prompt: markdown, maxTokens: 1536 },
        (delta) => {
          streamedMarkdown += delta
          if (renderTimer !== undefined) return
          renderTimer = window.setTimeout(() => {
            renderTimer = undefined
            queueRender(streamedMarkdown)
          }, STREAM_RENDER_MS)
        }
      )
      if (renderTimer !== undefined) window.clearTimeout(renderTimer)
      await renderChain

      if (!result.trim()) throw new Error('Enhancement returned no content.')
      if (renderedMarkdown !== result) {
        const finalBlocks = await editor.tryParseMarkdownToBlocks(result)
        if (finalBlocks.length === 0) throw new Error('Enhancement returned no editable content.')
        const replacement = editor.replaceBlocks(currentBlockIds, finalBlocks)
        currentBlockIds = replacement.insertedBlocks.map((block) => block.id)
        streamedChange = true
      }

      if (mode === 'append') setBlockState(blocks, null)
      setBlockState(currentBlockIds, 'changed')
      const changedBlockIds = [...currentBlockIds]
      window.setTimeout(() => setBlockState(changedBlockIds, null), CHANGED_HIGHLIGHT_MS)
    } catch (err) {
      if (renderTimer !== undefined) window.clearTimeout(renderTimer)
      await renderChain
      if (mode === 'append') {
        // The selection was never touched — just drop the appended blocks.
        try {
          editor.removeBlocks(currentBlockIds)
        } catch {
          /* already gone */
        }
        setBlockState(blocks, null)
      } else if (streamedChange) {
        const restored = editor.replaceBlocks(currentBlockIds, blocks)
        setBlockState(restored.insertedBlocks, null)
      } else {
        setBlockState(blocks, null)
      }
      onError(err instanceof Error ? err.message : 'Enhancement failed.')
    }
    onStreamingChange(false)
    onClose()
  }

  const runCustom = (): void => {
    const text = instruction.trim()
    if (!text) return
    run(
      `You are an AI writing assistant editing part of a note. Apply the user's instruction to the selected text and respond with markdown only — no preamble, no explanation, no code fences.\n\nInstruction: ${text}`
    )
  }

  // Anchor below the selection, clamped to the window using the popup's real
  // height — it grows while an overlay result streams in, so keep watching.
  useLayoutEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setMeasuredHeight(el.offsetHeight))
    observer.observe(el)
    return () => observer.disconnect()
  }, [overlay !== null])

  const height = measuredHeight ?? 240
  const left = position
    ? Math.min(Math.max(position.x, 12), window.innerWidth - POPUP_WIDTH - 12)
    : (window.innerWidth - POPUP_WIDTH) / 2
  const top = position
    ? Math.max(12, Math.min(position.y + 8, window.innerHeight - height - 12))
    : 120

  if (overlay) {
    return (
      <div
        className={pending ? 'ai-popup pending' : 'ai-popup'}
        ref={wrapperRef}
        style={{ left, top, width: POPUP_WIDTH }}
        aria-busy={pending}
      >
        <div className="ai-popup-result" aria-live="polite">
          {overlay.text || 'Working…'}
        </div>
        <div className="ai-popup-footer">
          {pending ? (
            <>
              <span className="ai-popup-hint">
                <Loader2 size={13} className="spin" /> Generating…
              </span>
              <button
                className="ai-popup-preset"
                onClick={() => cancelStreamRef.current?.()}
                title="Stop"
              >
                <Square size={11} fill="currentColor" />
                <span>Stop</span>
              </button>
            </>
          ) : (
            <div className="ai-popup-result-actions">
              <button
                className="ai-popup-preset"
                onClick={() => {
                  navigator.clipboard.writeText(overlay.text)
                  setCopied(true)
                }}
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
              <button className="ai-popup-preset" onClick={() => void insertOverlayResult('below')}>
                <ListPlus size={13} />
                <span>Insert below</span>
              </button>
              <button
                className="ai-popup-preset"
                onClick={() => void insertOverlayResult('replace')}
              >
                <PenLine size={13} />
                <span>Replace</span>
              </button>
              <button className="ai-popup-preset" onClick={onClose} title="Close">
                <X size={13} />
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className={pending ? 'ai-popup pending' : 'ai-popup'}
      ref={wrapperRef}
      style={{ left, top, width: POPUP_WIDTH }}
      aria-busy={pending}
    >
      <textarea
        ref={textareaRef}
        className="ai-popup-textarea"
        value={instruction}
        placeholder="Describe how to enhance the selection…"
        rows={2}
        disabled={pending}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            runCustom()
          }
        }}
      />
      <div className="ai-popup-presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.action}
            className="ai-popup-preset"
            disabled={pending}
            onClick={() => run(ACTION_PROMPTS[preset.action], preset.mode)}
          >
            {preset.icon}
            <span>{preset.label}</span>
          </button>
        ))}
      </div>
      <div className="ai-popup-footer">
        <span className="ai-popup-hint" aria-live="polite">
          {pending ? 'Enhancing selection…' : 'Enter to submit'}
        </span>
        <button
          className="ai-popup-submit"
          disabled={pending || !instruction.trim()}
          onClick={runCustom}
          title="Submit"
        >
          {pending ? <Loader2 size={15} className="spin" /> : <ArrowUp size={15} />}
        </button>
      </div>
    </div>
  )
}
