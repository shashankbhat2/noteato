import { useRef, useState } from 'react'
import type { BlockNoteEditor } from '@blocknote/core'

interface DeepgramMessage {
  is_final?: boolean
  channel?: {
    alternatives?: { transcript?: string }[]
  }
}

export function useDictation(editor: BlockNoteEditor): {
  isRecording: boolean
  error: string | null
  toggle: () => void
} {
  const [isRecording, setIsRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const stop = (): void => {
    recorderRef.current?.stop()
    recorderRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    wsRef.current?.close()
    wsRef.current = null
    setIsRecording(false)
  }

  const start = async (): Promise<void> => {
    setError(null)
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
      if (transcript && msg.is_final) {
        editor.insertInlineContent([{ type: 'text', text: `${transcript} `, styles: {} }])
      }
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

  return { isRecording, error, toggle }
}
