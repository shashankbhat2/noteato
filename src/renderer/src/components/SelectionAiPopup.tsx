import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Block, BlockNoteEditor } from '@blocknote/core'
import { AlignLeft, ArrowUp, ListChecks, Loader2, PenLine } from 'lucide-react'
import { aiStream } from '../ai/client'

type SelectionAction = 'summarize' | 'improve' | 'extract'

const ACTION_PROMPTS: Record<SelectionAction, string> = {
  summarize:
    'Summarize the following note content concisely, preserving the key facts. Respond with markdown only — no preamble, no explanation.',
  improve:
    'Improve the clarity, grammar, and flow of the following text without changing its meaning or removing information. Respond with markdown only — no preamble, no explanation.',
  extract:
    'Extract the key points from the following text as a concise markdown bullet list. Respond with markdown only — no preamble, no explanation.'
}

const PRESETS: { action: SelectionAction; label: string; icon: ReactNode }[] = [
  { action: 'improve', label: 'Improve writing', icon: <PenLine size={15} /> },
  { action: 'summarize', label: 'Summarize', icon: <AlignLeft size={15} /> },
  { action: 'extract', label: 'Extract key points', icon: <ListChecks size={15} /> }
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
  editor: BlockNoteEditor
  blocks: Block[]
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
  const wrapperRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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

  const run = async (system: string): Promise<void> => {
    if (pending) return
    setPending(true)
    onStreamingChange(true)
    setBlockState(blocks, 'pending')
    let currentBlockIds = blocks.map((block) => block.id)
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

      setBlockState(currentBlockIds, 'changed')
      const changedBlockIds = [...currentBlockIds]
      window.setTimeout(() => setBlockState(changedBlockIds, null), CHANGED_HIGHLIGHT_MS)
    } catch (err) {
      if (renderTimer !== undefined) window.clearTimeout(renderTimer)
      await renderChain
      if (streamedChange) {
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

  // Anchor below the selection, clamped to the viewport.
  const left = position
    ? Math.min(Math.max(position.x, 12), window.innerWidth - POPUP_WIDTH - 12)
    : (window.innerWidth - POPUP_WIDTH) / 2
  const top = position ? Math.min(position.y + 8, window.innerHeight - 240) : 120

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
            onClick={() => run(ACTION_PROMPTS[preset.action])}
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
