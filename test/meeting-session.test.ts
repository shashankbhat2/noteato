import { describe, expect, it, vi } from 'vitest'
import { MeetingSession } from '../src/main/meeting/session'

describe('MeetingSession', () => {
  it('starts idle', () => {
    const session = new MeetingSession()
    expect(session.getState()).toEqual({ phase: 'idle', startedAt: null })
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
    expect(session.getState()).toEqual({ phase: 'idle', startedAt: null })
  })

  it('discard returns to idle', () => {
    const session = new MeetingSession()
    session.start()
    expect(session.discard()).toBe(true)
    expect(session.getState()).toEqual({ phase: 'idle', startedAt: null })
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
    expect(listener).toHaveBeenLastCalledWith({ phase: 'idle', startedAt: null })

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
