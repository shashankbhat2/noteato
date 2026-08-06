import { describe, expect, it, vi } from 'vitest'
import { MeetingAudioProcess, type AudioError } from '../src/main/meeting/audioProcess'

describe('meeting audio helper protocol', () => {
  it('surfaces a warning without settling the live recording as an error', () => {
    const onWarning = vi.fn<(warning: AudioError) => void>()
    const onError = vi.fn<(error: AudioError) => void>()
    const process = new MeetingAudioProcess({
      onReady: vi.fn(),
      onLevels: vi.fn(),
      onWarning,
      onError,
      onDone: vi.fn()
    })
    const consume = (
      process as unknown as { consume: (chunk: string) => void }
    ).consume.bind(process)

    consume(
      '{"type":"warning","code":"screen_recording_denied","message":"microphone only"}\n'
    )
    consume('{"type":"error","code":"microphone_failed","message":"input failed"}\n')

    expect(onWarning).toHaveBeenCalledWith({
      code: 'screen_recording_denied',
      message: 'microphone only'
    })
    expect(onError).toHaveBeenCalledWith({
      code: 'microphone_failed',
      message: 'input failed'
    })
  })
})
