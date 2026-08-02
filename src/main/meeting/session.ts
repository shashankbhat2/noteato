import type { MeetingState } from '../../shared/types'

const IDLE: MeetingState = { phase: 'idle', startedAt: null, noteId: null }

/**
 * The lifecycle of one meeting recording.
 *
 * Phase 2 deliberately has no audio behind it. Every start/stop/discard edge —
 * from the tray, the accelerator, the pill and the note's own record button —
 * is debugged here first, so that when capture lands the only new failure mode
 * is capture itself rather than capture plus a control surface nobody
 * exercised.
 *
 * A recording belongs to a note. Starting from a note's toolbar attaches it to
 * that note; starting from the tray or the accelerator leaves `noteId` null,
 * which commits to a new note instead — that is the ordinary case, because a
 * meeting starts while you are looking at Zoom rather than at Noteato.
 *
 * Exactly one recording runs at a time. You are only ever in one meeting, and
 * two concurrent captures would contend for the same microphone.
 *
 * State is in-memory on purpose. A recording cannot outlive the process that
 * owns the capture, so a killed app coming back `idle` is the correct answer
 * rather than a gap: persisting `recording` across a restart would only let the
 * app claim to be recording something it is not.
 */
export class MeetingSession {
  private state: MeetingState = IDLE
  private listeners = new Set<(state: MeetingState) => void>()

  getState(): MeetingState {
    return this.state
  }

  isRecording(): boolean {
    return this.state.phase === 'recording'
  }

  /** True when this specific note is the one being recorded. */
  isRecordingNote(noteId: string): boolean {
    return this.state.phase === 'recording' && this.state.noteId === noteId
  }

  /**
   * Begin recording, optionally into an existing note. Returns false when a
   * recording is already in flight — including one belonging to another note,
   * which the caller should surface rather than silently swallow.
   */
  start(noteId: string | null = null): boolean {
    if (this.state.phase !== 'idle') return false
    this.set({ phase: 'recording', startedAt: Date.now(), noteId })
    return true
  }

  /** End the recording and keep it. */
  stop(): boolean {
    if (this.state.phase !== 'recording') return false
    this.set(IDLE)
    return true
  }

  /**
   * The audio is closed and transcription has begun.
   *
   * A distinct phase rather than an early return to idle: transcription takes
   * real time on a long meeting, and a UI that claimed to be finished while the
   * note was still filling in would be lying. It also keeps a second recording
   * from starting on top of one still being processed.
   */
  beginTranscribing(): boolean {
    if (this.state.phase !== 'recording') return false
    this.set({ ...this.state, phase: 'transcribing' })
    return true
  }

  /** Transcription finished, succeeded or not — either way the session is over. */
  finishTranscribing(): boolean {
    if (this.state.phase !== 'transcribing') return false
    this.set(IDLE)
    return true
  }

  /** End the recording and throw it away. */
  discard(): boolean {
    if (this.state.phase !== 'recording') return false
    this.set(IDLE)
    return true
  }

  /**
   * What every control does: one button, both ways.
   *
   * A toggle carrying a different note than the one recording is refused rather
   * than treated as "stop". Note B's button must not be able to end note A's
   * recording — from note B the recording is invisible, so that would read as
   * the button doing nothing while a recording silently died.
   */
  toggle(noteId: string | null = null): boolean {
    if (this.state.phase === 'recording') {
      if (noteId !== null && noteId !== this.state.noteId) return false
      return this.stop()
    }
    if (this.state.phase === 'idle') return this.start(noteId)
    // Mid-transcription a toggle is meaningless — dropping it is kinder than
    // queueing a start the user will have forgotten asking for.
    return false
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
