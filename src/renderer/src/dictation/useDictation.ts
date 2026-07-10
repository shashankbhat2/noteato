import { useRef, useState } from 'react'
import type { BlockNoteEditor } from '@blocknote/core'
import { aiComplete, isAiConfigured } from '../ai/client'

interface DeepgramMessage {
  is_final?: boolean
  channel?: {
    alternatives?: { transcript?: string }[]
  }
}

type BlockContent = ReturnType<BlockNoteEditor['getTextCursorPosition']>['block']['content']

interface Utterance {
  blockId: string
  contentBefore: BlockContent
}

// Said right after a mistake, these remove the previously dictated utterance
// instantly (no network round trip) instead of transcribing the command text.
const EDIT_COMMAND_PATTERNS = [
  /^(?:scratch|delete|strike)\s+(?:that|this|it)$/i,
  /^undo\s+(?:that|this|it|last|the last (?:sentence|line|bit|part))?$/i,
  /^never\s*mind$/i
]

const POLISH_DEBOUNCE_MS = 2500

const POLISH_SYSTEM_PROMPT = `You are cleaning up live dictated speech-to-text as it is spoken. Given raw transcript text, rewrite it into clean, well-formatted markdown:
- Remove filler words, false starts, and stutters/repeats (um, uh, like, you know).
- Fix punctuation and capitalization.
- If the speech implies a list, sequence ("first... second..."), or heading, format it as proper markdown.
- If the speaker corrects themselves mid-thought (e.g. "actually, scratch that, I meant X"), keep only the corrected version.
- Preserve the original meaning and all information — do not summarize, shorten, or add anything new.
- Respond with markdown only. No preamble, no explanation, no code fences.`

function isEditCommand(text: string): boolean {
  const trimmed = text.trim().replace(/[.!?,]+$/, '')
  return EDIT_COMMAND_PATTERNS.some((re) => re.test(trimmed))
}

export function useDictation(editor: BlockNoteEditor): {
  isRecording: boolean
  error: string | null
  analyser: AnalyserNode | null
  toggle: () => void
} {
  const [isRecording, setIsRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)

  const aiEnabledRef = useRef(false)
  const utteranceLogRef = useRef<Utterance[]>([])
  const checkpointBlockIdsRef = useRef<string[]>([])
  const polishTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const polishQueueRef = useRef<Promise<void>>(Promise.resolve())

  const runPolish = async (): Promise<void> => {
    const blockIds = Array.from(new Set(checkpointBlockIdsRef.current))
    checkpointBlockIdsRef.current = []
    if (blockIds.length === 0) return

    const blocks = blockIds
      .map((id) => editor.getBlock(id))
      .filter((b): b is NonNullable<typeof b> => Boolean(b))
    if (blocks.length === 0) return

    try {
      const settings = await window.api.settings.get()
      const raw = await editor.blocksToMarkdownLossy(blocks)
      if (!raw.trim()) return
      const polished = await aiComplete(settings, {
        system: POLISH_SYSTEM_PROMPT,
        prompt: raw,
        maxTokens: 1024
      })
      if (!polished.trim()) return
      const newBlocks = await editor.tryParseMarkdownToBlocks(polished)
      editor.replaceBlocks(blocks, newBlocks)
      const processed = new Set(blockIds)
      utteranceLogRef.current = utteranceLogRef.current.filter((u) => !processed.has(u.blockId))
    } catch {
      // Non-fatal — leave the raw dictated text as-is and keep listening.
    }
  }

  const schedulePolish = (): void => {
    if (!aiEnabledRef.current) return
    if (polishTimerRef.current) clearTimeout(polishTimerRef.current)
    polishTimerRef.current = setTimeout(() => {
      polishQueueRef.current = polishQueueRef.current.then(runPolish)
    }, POLISH_DEBOUNCE_MS)
  }

  const stop = (): void => {
    recorderRef.current?.stop()
    recorderRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    wsRef.current?.close()
    wsRef.current = null
    audioCtxRef.current?.close()
    audioCtxRef.current = null
    analyserRef.current = null
    if (polishTimerRef.current) clearTimeout(polishTimerRef.current)
    utteranceLogRef.current = []
    checkpointBlockIdsRef.current = []
    setIsRecording(false)
  }

  const start = async (): Promise<void> => {
    setError(null)
    const settings = await window.api.settings.get()
    if (!settings.deepgramApiKey) {
      setError('Add a Deepgram API key in Settings to use dictation.')
      return
    }
    aiEnabledRef.current = settings.aiDictationPolish && isAiConfigured(settings)
    utteranceLogRef.current = []
    checkpointBlockIdsRef.current = []

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError('Microphone permission denied.')
      return
    }
    streamRef.current = stream

    const audioCtx = new AudioContext()
    const source = audioCtx.createMediaStreamSource(stream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 128
    analyser.smoothingTimeConstant = 0.75
    source.connect(analyser)
    audioCtxRef.current = audioCtx
    analyserRef.current = analyser

    const params = new URLSearchParams({
      model: 'nova-3',
      smart_format: 'true',
      punctuate: 'true',
      interim_results: 'false'
    })
    const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, [
      'token',
      settings.deepgramApiKey
    ])
    wsRef.current = ws

    ws.onmessage = (event) => {
      const msg: DeepgramMessage = JSON.parse(event.data)
      const transcript = msg.channel?.alternatives?.[0]?.transcript
      if (!transcript || !msg.is_final) return

      if (isEditCommand(transcript)) {
        const last = utteranceLogRef.current.pop()
        if (last) {
          try {
            editor.updateBlock(last.blockId, { content: last.contentBefore })
          } catch {
            // Block may no longer exist (e.g. already restructured by a polish pass).
          }
        }
        return
      }

      const cursor = editor.getTextCursorPosition()
      utteranceLogRef.current.push({ blockId: cursor.block.id, contentBefore: cursor.block.content })
      checkpointBlockIdsRef.current.push(cursor.block.id)

      editor.insertInlineContent([{ type: 'text', text: `${transcript} `, styles: {} }])
      schedulePolish()
    }

    ws.onopen = () => {
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
          e.data.arrayBuffer().then((buf) => ws.send(buf))
        }
      }
      recorder.start(250)
      recorderRef.current = recorder
      setIsRecording(true)
    }

    ws.onerror = () => {
      setError('Deepgram connection error.')
      stop()
    }
    ws.onclose = () => setIsRecording(false)
  }

  const toggle = (): void => {
    if (isRecording) stop()
    else start()
  }

  return { isRecording, error, analyser: analyserRef.current, toggle }
}
