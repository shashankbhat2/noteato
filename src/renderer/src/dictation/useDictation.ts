import { useRef, useState } from 'react'
import type { BlockNoteEditor } from '@blocknote/core'

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

  const utteranceLogRef = useRef<Utterance[]>([])

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
    utteranceLogRef.current = []
    setIsRecording(false)
  }

  const start = async (): Promise<void> => {
    setError(null)
    const settings = await window.api.settings.get()
    if (!settings.deepgramApiKey) {
      setError('Add a Deepgram API key in Settings to use dictation.')
      return
    }
    utteranceLogRef.current = []

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
            // Block may no longer exist.
          }
        }
        return
      }

      const cursor = editor.getTextCursorPosition()
      utteranceLogRef.current.push({ blockId: cursor.block.id, contentBefore: cursor.block.content })

      editor.insertInlineContent([{ type: 'text', text: `${transcript} `, styles: {} }])
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
