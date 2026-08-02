import { useEffect, useState } from 'react'
import { IconPlayerStopFilled as Stop, IconTrash as Trash } from '@tabler/icons-react'
import type { MeetingState } from '../../../shared/types'

/** m:ss up to an hour, then h:mm:ss — meetings routinely run past both. */
function elapsedLabel(startedAt: number, now: number): string {
  const total = Math.max(0, Math.floor((now - startedAt) / 1000))
  const seconds = String(total % 60).padStart(2, '0')
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`
}

/**
 * The always-on-top recording indicator. Its own window (see RecorderWindow),
 * so it survives the main window being closed — which is the normal case, since
 * recording is started from the tray or the accelerator while another app has
 * focus.
 */
export default function RecorderPill() {
  const [state, setState] = useState<MeetingState>({ phase: 'idle', startedAt: null })
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    void window.api.meeting.getState().then(setState)
    return window.api.meeting.subscribeState(setState)
  }, [])

  // Elapsed time is derived from startedAt rather than counted up, so a slow
  // or throttled tick shows the right duration instead of a drifting one.
  useEffect(() => {
    if (state.phase !== 'recording') return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [state.phase])

  if (state.phase === 'idle') return null

  const transcribing = state.phase === 'transcribing'

  return (
    <div className="recorder-pill">
      <span
        className={transcribing ? 'recorder-pill-dot transcribing' : 'recorder-pill-dot'}
        aria-hidden="true"
      />
      <span className="recorder-pill-label">
        {transcribing ? 'Transcribing…' : 'Recording'}
      </span>
      <span className="recorder-pill-time">
        {state.startedAt !== null && !transcribing ? elapsedLabel(state.startedAt, now) : ''}
      </span>

      {!transcribing && (
        <div className="recorder-pill-actions">
          <button
            type="button"
            className="recorder-pill-btn discard"
            onClick={() => void window.api.meeting.discard()}
            aria-label="Discard recording"
            title="Discard recording"
          >
            <Trash size={15} />
          </button>
          <button
            type="button"
            className="recorder-pill-btn stop"
            onClick={() => void window.api.meeting.stop()}
            aria-label="Stop and keep recording"
            title="Stop and keep"
          >
            <Stop size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
