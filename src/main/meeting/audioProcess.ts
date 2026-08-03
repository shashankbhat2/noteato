import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'

const run = promisify(execFile)

/** Peak levels, 0–1, roughly ten times a second. */
export interface AudioLevels {
  mic: number
  system: number
}

export interface AudioResult {
  seconds: number
  /** False when Screen Recording produced nothing — "them" was never heard. */
  systemCaptured: boolean
}

export type AudioErrorCode =
  | 'helper_missing'
  | 'screen_recording_denied'
  | 'no_microphone'
  | 'microphone_failed'
  | 'system_audio_failed'
  | 'unsupported_os'
  | 'bad_arguments'
  | 'write_failed'
  | 'transcribe_failed'
  | 'crashed'

export interface AudioError {
  code: AudioErrorCode
  message: string
}

interface Handlers {
  onReady: () => void
  onLevels: (levels: AudioLevels) => void
  onError: (error: AudioError) => void
  onDone: (result: AudioResult) => void
}

/**
 * Resolution order mirrors the packaged layout first, so a stale dev build
 * cannot shadow the shipped helper in a released app.
 */
export function helperPath(): string | null {
  const candidates = [
    join(process.resourcesPath ?? '', 'bin', 'macos-meeting-audio'),
    join(app.getAppPath(), 'resources', 'bin', 'macos-meeting-audio')
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

/** Build a concatenated recording at `outputPath`; callers atomically install it. */
export async function appendMeetingAudio(
  existingPath: string,
  additionPath: string,
  outputPath: string
): Promise<void> {
  const binary = helperPath()
  if (!binary) throw new Error('the meeting audio helper is not installed')
  await run(binary, ['--append', existingPath, additionPath, outputPath])
}

/**
 * One meeting recording, as a child process.
 *
 * The helper writes two hidden working tracks and one mixed recording; this
 * class only starts it, relays its line protocol, and stops it. Nothing here
 * touches audio data — which is the point, because an hour of PCM through Node
 * would buy nothing and risk everything.
 */
export class MeetingAudioProcess {
  private child: ChildProcess | null = null
  private buffer = ''
  private settled = false

  constructor(private handlers: Handlers) {}

  start(micPath: string, systemPath: string, outputPath: string): boolean {
    const binary = helperPath()
    if (!binary) {
      this.fail('helper_missing', 'the meeting audio helper is not installed')
      return false
    }

    const child = spawn(
      binary,
      ['--mic', micPath, '--system', systemPath, '--output', outputPath],
      {
        stdio: ['pipe', 'pipe', 'pipe']
      }
    )
    this.child = child

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => this.consume(chunk))

    // The helper reports permission and device failures as one JSON line here.
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => this.consume(chunk))

    child.on('error', (error) => this.fail('crashed', error.message))
    child.on('exit', (code) => {
      this.child = null
      // A non-zero exit that reported nothing is still a failed recording; say
      // so rather than letting the UI sit in `recording` forever.
      if (!this.settled && code !== 0) {
        this.fail('crashed', `meeting audio helper exited with code ${code}`)
      }
    })

    return true
  }

  /**
   * Ask the helper to flush and close its files. Closing stdin is the stop
   * signal; the caller should wait for `onDone` rather than assume the m4a is
   * complete, because the moov atom is written during shutdown.
   */
  stop(): void {
    this.child?.stdin?.end()
  }

  /** Last resort: the process is going away and the files may be unplayable. */
  kill(): void {
    this.child?.kill('SIGTERM')
    this.child = null
  }

  isRunning(): boolean {
    return this.child !== null
  }

  private consume(chunk: string): void {
    this.buffer += chunk
    const lines = this.buffer.split('\n')
    // A partial trailing line is normal — hold it until its newline arrives.
    this.buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      let message: Record<string, unknown>
      try {
        message = JSON.parse(trimmed)
      } catch {
        // Anything the helper did not frame as JSON is a crash log, not a
        // protocol message. Keep it visible without letting it derail parsing.
        console.warn('[meeting-audio]', trimmed)
        continue
      }

      switch (message['type']) {
        case 'ready':
          this.handlers.onReady()
          break
        case 'level':
          this.handlers.onLevels({
            mic: Number(message['mic']) || 0,
            system: Number(message['system']) || 0
          })
          break
        case 'done':
          this.settled = true
          this.handlers.onDone({
            seconds: Number(message['seconds']) || 0,
            systemCaptured: message['systemCaptured'] === true
          })
          break
        case 'error':
          this.fail(
            (message['code'] as AudioErrorCode) ?? 'crashed',
            String(message['message'] ?? 'unknown error')
          )
          break
        default:
          break
      }
    }
  }

  private fail(code: AudioErrorCode, message: string): void {
    if (this.settled) return
    this.settled = true
    this.handlers.onError({ code, message })
  }
}
