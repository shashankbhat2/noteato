import { useEffect, useState } from 'react'
import { IconPlayerStopFilled as Stop, IconTrash as Trash } from '@tabler/icons-react'
import type { MeetingLevels, MeetingState } from '../../../shared/types'
import { elapsedLabel } from '../../../shared/elapsed'

/**
 * The always-on-top recording indicator. Its own window (see RecorderWindow),
 * so it survives the main window being closed — which is the normal case, since
 * recording is started from the tray or the accelerator while another app has
 * focus.
 */
export default function RecorderPill() {
  const [state, setState] = useState<MeetingState>({
    phase: 'idle',
    startedAt: null,
    noteId: null
  })
  const [now, setNow] = useState(() => Date.now())
  const [levels, setLevels] = useState<MeetingLevels>({ mic: 0, system: 0 })

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

  // The dot doubles as a level meter: it is the only signal that the microphone
  // is actually hearing something, and a recording that captured silence is
  // worth finding out about during the meeting rather than after it.
  useEffect(() => window.api.meeting.subscribeLevels(setLevels), [])

  if (state.phase === 'idle') return null

  const transcribing = state.phase === 'transcribing'

  return (
    <div className="recorder-pill">
      <span
        className={transcribing ? 'recorder-pill-dot transcribing' : 'recorder-pill-dot'}
        aria-hidden="true"
        style={
          transcribing
            ? undefined
            : // Loudest of the two channels, lightly compressed so ordinary
              // speech visibly moves it rather than only clipping does.
              { transform: `scale(${1 + Math.min(1, Math.max(levels.mic, levels.system) * 2.2) * 0.5})` }
        }
      />
      <span className="recorder-pill-time">
        {transcribing
          ? '···'
          : state.startedAt !== null
            ? elapsedLabel(state.startedAt, now)
            : ''}
      </span>

      {!transcribing && (
        <div className="recorder-pill-actions">
          <button
            type="button"
            className="recorder-pill-btn stop"
            onClick={() => void window.api.meeting.stop()}
            aria-label="Stop and keep recording"
            title="Stop and keep"
          >
            <Stop size={16} />
          </button>
          <button
            type="button"
            className="recorder-pill-btn discard"
            onClick={() => void window.api.meeting.discard()}
            aria-label="Discard recording"
            title="Discard recording"
          >
            <Trash size={17} />
          </button>
        </div>
      )}
    </div>
  )
}
