import type { MeetingState } from '../../shared/types'

/**
 * The lifecycle of one meeting recording.
 *
 * Phase 2 deliberately has no audio behind it. Every start/stop/discard edge —
 * from the tray, the accelerator, the pill and the in-window buttons — is
 * debugged here first, so that when capture lands the only new failure mode is
 * capture itself rather than capture plus a control surface nobody exercised.
 *
 * State is in-memory on purpose. A recording cannot outlive the process that
 * owns the capture, so a killed app coming back `idle` is the correct answer
 * rather than a gap: persisting `recording` across a restart would only let the
 * app claim to be recording something it is not.
 */
export class MeetingSession {
  private state: MeetingState = { phase: 'idle', startedAt: null }
  private listeners = new Set<(state: MeetingState) => void>()

  getState(): MeetingState {
    return this.state
  }

  isRecording(): boolean {
    return this.state.phase === 'recording'
  }

  /** Returns false when a recording is already in flight. */
  start(): boolean {
    if (this.state.phase !== 'idle') return false
    this.set({ phase: 'recording', startedAt: Date.now() })
    return true
  }

  /**
   * End the recording and keep it. Goes straight back to `idle` until there is
   * something to transcribe; the `transcribing` hop belongs to the phase that
   * earns it.
   */
  stop(): boolean {
    if (this.state.phase !== 'recording') return false
    this.set({ phase: 'idle', startedAt: null })
    return true
  }

  /** End the recording and throw it away. */
  discard(): boolean {
    if (this.state.phase !== 'recording') return false
    this.set({ phase: 'idle', startedAt: null })
    return true
  }

  /** What the tray item and the in-window buttons do: one control, both ways. */
  toggle(): void {
    if (this.state.phase === 'recording') this.stop()
    else if (this.state.phase === 'idle') this.start()
    // Mid-transcription a toggle is meaningless — dropping it is kinder than
    // queueing a start the user will have forgotten asking for.
  }

  subscribe(listener: (state: MeetingState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private set(next: MeetingState): void {
    this.state = next
    for (const listener of this.listeners) listener(next)
  }
}
