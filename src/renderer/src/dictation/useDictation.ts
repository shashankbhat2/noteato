import { useEffect, useRef, useState } from 'react'
import type { NoteatoEditor } from '../noteLink'

interface DeepgramMessage {
  is_final?: boolean
  channel?: {
    alternatives?: { transcript?: string }[]
  }
}

type BlockContent = ReturnType<NoteatoEditor['getTextCursorPosition']>['block']['content']

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

function isEditCommand(text: string): boolean {
  const trimmed = text.trim().replace(/[.!?,]+$/, '')
  return EDIT_COMMAND_PATTERNS.some((re) => re.test(trimmed))
}

interface SpeechToTextOptions {
  onTranscript: (text: string) => void
  onUndo?: () => void
  enabled?: boolean
  unavailableMessage?: string
}

export interface SpeechToTextState {
  isRecording: boolean
  error: string | null
  analyser: AnalyserNode | null
  toggle: () => void
}

/** Deepgram streaming STT with a destination supplied by the caller. */
export function useSpeechToText({
  onTranscript,
  onUndo,
  enabled = true,
  unavailableMessage = 'Voice input is not available here.'
}: SpeechToTextOptions): SpeechToTextState {
  const [isRecording, setIsRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const onTranscriptRef = useRef(onTranscript)
  const onUndoRef = useRef(onUndo)
  onTranscriptRef.current = onTranscript
  onUndoRef.current = onUndo

  const stop = (): void => {
    recorderRef.current?.stop()
    recorderRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    wsRef.current?.close()
    wsRef.current = null
    void audioCtxRef.current?.close()
    audioCtxRef.current = null
    analyserRef.current = null
    setIsRecording(false)
  }

  useEffect(
    () => () => {
      recorderRef.current?.stop()
      streamRef.current?.getTracks().forEach((track) => track.stop())
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.onerror = null
        wsRef.current.close()
      }
      void audioCtxRef.current?.close()
    },
    []
  )

  const start = async (): Promise<void> => {
    setError(null)
    if (!enabled) {
      setError(unavailableMessage)
      return
    }
    const settings = await window.api.settings.get()
    if (!settings.deepgramApiKey) {
      setError('Add a Deepgram API key in Settings to use dictation.')
      return
    }

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
      if (isEditCommand(transcript)) onUndoRef.current?.()
      else onTranscriptRef.current(transcript)
    }

    ws.onopen = () => {
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
          void event.data.arrayBuffer().then((buffer) => ws.send(buffer))
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
    ws.onclose = () => {
      if (wsRef.current === ws) stop()
    }
  }

  const toggle = (): void => {
    if (isRecording) stop()
    else void start()
  }

  return { isRecording, error, analyser: analyserRef.current, toggle }
}

/**
 * `editor` may be null — with one dictation control for the whole layout, there
 * is nothing to dictate into until a note pane has focus. The editor is read at
 * start(), so a recording keeps writing into the note it began in even if focus
 * moves away mid-sentence.
 */
export function useDictation(editor: NoteatoEditor | null): {
  isRecording: boolean
  error: string | null
  analyser: AnalyserNode | null
  toggle: () => void
} {
  const utteranceLogRef = useRef<Utterance[]>([])
  return useSpeechToText({
    enabled: editor !== null,
    unavailableMessage: 'Open a note to dictate into first.',
    onTranscript: (transcript) => {
      if (!editor) return
      const cursor = editor.getTextCursorPosition()
      utteranceLogRef.current.push({ blockId: cursor.block.id, contentBefore: cursor.block.content })
      editor.insertInlineContent([{ type: 'text', text: `${transcript} `, styles: {} }])
      // Keep the block receiving dictation in view as the note grows.
      document
        .querySelector(`[data-node-type="blockOuter"][data-id="${CSS.escape(cursor.block.id)}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    },
    onUndo: () => {
      if (!editor) return
      const last = utteranceLogRef.current.pop()
      if (last) {
        try {
          editor.updateBlock(last.blockId, { content: last.contentBefore })
        } catch {
          // Block may no longer exist.
        }
      }
    }
  })
}
