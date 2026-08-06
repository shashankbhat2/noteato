import type { MeetingState } from '../../shared/types'
import { MeetingSession } from './session'
import { MeetingAudioProcess, type AudioError, type AudioLevels } from './audioProcess'
import {
  createCaptureDir,
  removeCaptureAudio,
  removeCaptureDir,
  type CapturePaths
} from './captureDir'

export interface MeetingRecording {
  /** Absolute path to the capture directory holding the audio. */
  dir: string
  seconds: number
  /** False when no system audio arrived — the far side was never recorded. */
  systemCaptured: boolean
  noteId: string | null
  /** Epoch ms the recording began, for naming a note it was not started from. */
  startedAt: number
}

interface Options {
  /** Read lazily: the vault can be moved between recordings. */
  getVault: () => string
  onStateChange: (state: MeetingState) => void
  onLevels: (levels: AudioLevels) => void
  onError: (error: AudioError) => void
  onCommitted: (recording: MeetingRecording) => void | Promise<void>
}

/**
 * Ties the meeting state machine to the audio helper and the capture directory.
 *
 * `MeetingSession` stays pure and unit-tested; every side effect lives here, so
 * the transition rules can be reasoned about without a filesystem or a child
 * process in the way.
 */
export class MeetingRecorder {
  private session = new MeetingSession()
  private audio: MeetingAudioProcess | null = null
  private capture: CapturePaths | null = null
  private preserveCaptureDir = false
  private discarding = false

  constructor(private options: Options) {
    this.session.subscribe((state) => this.options.onStateChange(state))
  }

  getState(): MeetingState {
    return this.session.getState()
  }

  isRecording(): boolean {
    return this.session.isRecording()
  }

  start(noteId: string | null = null, preparedCapture?: CapturePaths): boolean {
    if (!this.session.start(noteId)) return false

    let capture: CapturePaths
    try {
      capture = preparedCapture ?? createCaptureDir(this.options.getVault())
    } catch (error) {
      this.session.discard()
      this.options.onError({
        code: 'write_failed',
        message: `could not create the capture folder: ${String(error)}`
      })
      return false
    }
    this.capture = capture
    // A prepared capture already owns note.md. Failed or discarded audio must
    // never take that note with it; an ordinary note's separate capture folder
    // can still be removed wholesale.
    this.preserveCaptureDir = preparedCapture !== undefined
    this.discarding = false

    const audio = new MeetingAudioProcess({
      onReady: () => {},
      onLevels: (levels) => this.options.onLevels(levels),
      // Warnings describe a degraded but live recording (normally mic-only).
      // Surface them without running the destructive error cleanup below.
      onWarning: (warning) => this.options.onError(warning),
      onDone: (result) => {
        // Read before the phase change clears them.
        const { noteId, startedAt } = this.session.getState()
        this.audio = null
        const dir = this.capture?.dir
        const preserveCaptureDir = this.preserveCaptureDir
        this.capture = null
        this.preserveCaptureDir = false

        if (this.discarding || !dir) {
          if (dir) {
            if (preserveCaptureDir) removeCaptureAudio(dir)
            else removeCaptureDir(dir)
          }
          this.discarding = false
          this.session.stop()
          return
        }

        // Stay in `transcribing` for the whole of onCommitted: it creates the
        // note, stores the row and runs transcription, and the pill should say
        // so rather than disappearing while the note is still filling in.
        this.session.beginTranscribing()
        void Promise.resolve(
          this.options.onCommitted({
            dir,
            noteId,
            startedAt: startedAt ?? Date.now(),
            ...result
          })
        )
          .catch((error) => {
            this.options.onError({
              code: 'transcribe_failed',
              message: error instanceof Error ? error.message : String(error)
            })
          })
          .finally(() => this.session.finishTranscribing())
      },
      onError: (error) => {
        this.audio = null
        // A new-meeting capture already contains its note. Preserve that note
        // if permissions or a device fail, while removing partial audio.
        if (this.capture) {
          if (this.preserveCaptureDir) removeCaptureAudio(this.capture.dir)
          else removeCaptureDir(this.capture.dir)
        }
        this.capture = null
        this.preserveCaptureDir = false
        this.session.discard()
        this.options.onError(error)
      }
    })

    if (!audio.start(capture.micPath, capture.systemPath, capture.audioPath)) {
      // start() already reported through onError, which reset the session.
      return false
    }
    this.audio = audio
    return true
  }

  /**
   * Stop and keep. The session stays in `recording` until the helper confirms
   * it has closed its files — the m4a moov atom is written during shutdown, so
   * reporting success earlier would be claiming a playable file that is not.
   */
  stop(): boolean {
    if (!this.session.isRecording()) return false
    if (!this.audio) return this.session.stop()
    this.audio.stop()
    return true
  }

  /** Stop and throw the audio away. */
  discard(): boolean {
    if (!this.session.isRecording()) return false
    this.discarding = true
    if (!this.audio) {
      if (this.capture) {
        if (this.preserveCaptureDir) removeCaptureAudio(this.capture.dir)
        else removeCaptureDir(this.capture.dir)
      }
      this.capture = null
      this.preserveCaptureDir = false
      this.discarding = false
      return this.session.discard()
    }
    this.audio.stop()
    return true
  }

  toggle(noteId: string | null = null): boolean {
    const state = this.session.getState()
    if (state.phase === 'recording') {
      if (noteId !== null && noteId !== state.noteId) return false
      return this.stop()
    }
    if (state.phase === 'idle') return this.start(noteId)
    return false
  }

  isRecordingNote(noteId: string): boolean {
    return this.session.isRecordingNote(noteId)
  }

  /**
   * Quitting mid-recording. Stop the helper so it closes its files, rather than
   * killing it and leaving an hour of audio unplayable.
   */
  shutdown(): void {
    this.audio?.stop()
  }
}
