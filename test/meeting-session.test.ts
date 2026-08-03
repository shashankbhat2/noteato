import { describe, expect, it, vi } from 'vitest'
import { MeetingSession } from '../src/main/meeting/session'

describe('MeetingSession', () => {
  it('starts idle', () => {
    const session = new MeetingSession()
    expect(session.getState()).toEqual({ phase: 'idle', startedAt: null, noteId: null })
    expect(session.isRecording()).toBe(false)
  })

  it('records startedAt when recording begins', () => {
    const session = new MeetingSession()
    const before = Date.now()
    expect(session.start()).toBe(true)

    const { phase, startedAt } = session.getState()
    expect(phase).toBe('recording')
    expect(startedAt).not.toBeNull()
    expect(startedAt!).toBeGreaterThanOrEqual(before)
    expect(session.isRecording()).toBe(true)
  })

  // The tray item, the accelerator and two buttons all reach start(). Whichever
  // arrives second must not restart the clock and lose the elapsed time.
  it('ignores a second start and keeps the original startedAt', () => {
    const session = new MeetingSession()
    session.start()
    const first = session.getState().startedAt

    expect(session.start()).toBe(false)
    expect(session.getState().startedAt).toBe(first)
  })

  it('stop returns to idle and clears startedAt', () => {
    const session = new MeetingSession()
    session.start()
    expect(session.stop()).toBe(true)
    expect(session.getState()).toEqual({ phase: 'idle', startedAt: null, noteId: null })
  })

  it('discard returns to idle', () => {
    const session = new MeetingSession()
    session.start()
    expect(session.discard()).toBe(true)
    expect(session.getState()).toEqual({ phase: 'idle', startedAt: null, noteId: null })
  })

  it('stop and discard are no-ops when idle', () => {
    const session = new MeetingSession()
    expect(session.stop()).toBe(false)
    expect(session.discard()).toBe(false)
    expect(session.getState().phase).toBe('idle')
  })

  it('toggle starts from idle and stops from recording', () => {
    const session = new MeetingSession()
    session.toggle()
    expect(session.getState().phase).toBe('recording')
    session.toggle()
    expect(session.getState().phase).toBe('idle')
  })

  describe('transcribing', () => {
    it('passes through transcribing on the way back to idle', () => {
      const session = new MeetingSession()
      session.start('note-a')

      expect(session.beginTranscribing()).toBe(true)
      expect(session.getState().phase).toBe('transcribing')
      // The note is still needed: transcription has to know where to put itself.
      expect(session.getState().noteId).toBe('note-a')

      expect(session.finishTranscribing()).toBe(true)
      expect(session.getState()).toEqual({ phase: 'idle', startedAt: null, noteId: null })
    })

    // Transcription can take minutes on a long meeting. Starting a second
    // recording on top of one still being processed would contend for the
    // microphone and race two writes into the same note.
    it('refuses a new recording while transcribing', () => {
      const session = new MeetingSession()
      session.start()
      session.beginTranscribing()

      expect(session.start()).toBe(false)
      expect(session.toggle()).toBe(false)
      expect(session.getState().phase).toBe('transcribing')
    })

    it('ignores transcribing transitions from the wrong phase', () => {
      const session = new MeetingSession()

      expect(session.beginTranscribing()).toBe(false)
      expect(session.finishTranscribing()).toBe(false)
      expect(session.getState().phase).toBe('idle')
    })

    it('cannot be stopped or discarded mid-transcription', () => {
      const session = new MeetingSession()
      session.start()
      session.beginTranscribing()

      expect(session.stop()).toBe(false)
      expect(session.discard()).toBe(false)
      expect(session.getState().phase).toBe('transcribing')
    })
  })

  describe('per note', () => {
    it('attaches the recording to the note that started it', () => {
      const session = new MeetingSession()
      session.start('note-a')

      expect(session.getState().noteId).toBe('note-a')
      expect(session.isRecordingNote('note-a')).toBe(true)
      expect(session.isRecordingNote('note-b')).toBe(false)
    })

    it('leaves noteId null when started from the tray or accelerator', () => {
      const session = new MeetingSession()
      session.start()
      expect(session.getState().noteId).toBeNull()
    })

    // Note B's button must not be able to end note A's recording: from note B
    // the recording is invisible, so it would read as the button doing nothing
    // while a recording silently died.
    it('refuses a toggle carrying a different note', () => {
      const session = new MeetingSession()
      session.start('note-a')

      expect(session.toggle('note-b')).toBe(false)
      expect(session.isRecordingNote('note-a')).toBe(true)
    })

    it('stops when the owning note toggles', () => {
      const session = new MeetingSession()
      session.start('note-a')

      expect(session.toggle('note-a')).toBe(true)
      expect(session.getState().phase).toBe('idle')
    })

    // The tray and the accelerator carry no note, so they stop whatever runs.
    it('stops a note-owned recording from an untargeted toggle', () => {
      const session = new MeetingSession()
      session.start('note-a')

      expect(session.toggle()).toBe(true)
      expect(session.getState().phase).toBe('idle')
    })

    it('clears noteId on stop and on discard', () => {
      const session = new MeetingSession()
      session.start('note-a')
      session.stop()
      expect(session.getState().noteId).toBeNull()

      session.start('note-b')
      session.discard()
      expect(session.getState().noteId).toBeNull()
    })
  })

  it('notifies subscribers on every transition, and not on rejected ones', () => {
    const session = new MeetingSession()
    const listener = vi.fn()
    session.subscribe(listener)

    session.start()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'recording' }))

    // Rejected — the surfaces are already showing 'recording', so an event here
    // would be a redundant tray rebuild and a pill re-render for nothing.
    session.start()
    expect(listener).toHaveBeenCalledTimes(1)

    session.stop()
    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenLastCalledWith({ phase: 'idle', startedAt: null, noteId: null })

    session.stop()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('stops notifying after unsubscribe', () => {
    const session = new MeetingSession()
    const listener = vi.fn()
    const unsubscribe = session.subscribe(listener)

    unsubscribe()
    session.start()
    expect(listener).not.toHaveBeenCalled()
  })
})
