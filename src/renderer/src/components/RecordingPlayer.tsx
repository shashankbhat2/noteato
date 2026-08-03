import { useCallback, useEffect, useRef, useState } from 'react'
import {
  IconPlayerPauseFilled as Pause,
  IconPlayerPlayFilled as Play,
  IconRewindBackward15 as Back15,
  IconRewindForward15 as Forward15
} from '@tabler/icons-react'
import type { NoteRecording } from '../../../shared/types'
import { elapsedLabel } from '../../../shared/elapsed'
import { recordingMediaUrl } from '../../../shared/recordingMedia'

const SKIP_SECONDS = 15
const SPEEDS = [1, 1.25, 1.5, 2] as const

interface Props {
  recording: NoteRecording
  /** Drives the transcript's highlight of the segment being played. */
  onPosition?: (seconds: number) => void
  /** Hands the transcript a way to seek, so clicking a timestamp jumps here. */
  registerSeek?: (seek: (seconds: number) => void) => void
}

/**
 * Transport for a note's recording, above its transcript.
 *
 * New meetings expose one mixed recording. The optional follower remains for
 * captures made by older builds, where microphone and system audio were stored
 * separately and must still play as one timeline.
 */
export default function RecordingPlayer({ recording, onPosition, registerSeek }: Props) {
  const micRef = useRef<HTMLAudioElement>(null)
  const systemRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(recording.durationSeconds)
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1)
  const [failed, setFailed] = useState(false)

  /**
   * Two independent media elements drift. Nudging the follower whenever it is
   * more than a beat out keeps them together without fighting the decoder on
   * every frame, which a hard assignment each tick would do.
   */
  const resync = useCallback((force = false) => {
    const mic = micRef.current
    const system = systemRef.current
    if (!mic || !system) return
    if (force || Math.abs(system.currentTime - mic.currentTime) > 0.25) {
      system.currentTime = mic.currentTime
    }
  }, [])

  const toggle = useCallback(() => {
    const mic = micRef.current
    const system = systemRef.current
    if (!mic) return

    if (mic.paused) {
      resync(true)
      void mic.play().catch(() => setFailed(true))
      void system?.play().catch(() => {
        /* no system track, or it failed — the mic track still plays */
      })
    } else {
      mic.pause()
      system?.pause()
    }
  }, [resync])

  const seekTo = useCallback(
    (seconds: number) => {
      const mic = micRef.current
      if (!mic) return
      mic.currentTime = Math.min(Math.max(0, seconds), duration || mic.duration || 0)
      resync(true)
      setPosition(mic.currentTime)
      onPosition?.(mic.currentTime)
      // Clicking a transcript timestamp means "play from here", not "move the
      // cursor and wait" — so a paused player starts.
      if (mic.paused) void mic.play().catch(() => setFailed(true))
      if (systemRef.current?.paused) void systemRef.current.play().catch(() => {})
    },
    [duration, onPosition, resync]
  )

  useEffect(() => {
    const mic = micRef.current
    if (!mic) return

    const onTime = (): void => {
      setPosition(mic.currentTime)
      onPosition?.(mic.currentTime)
      resync()
    }
    const onLoaded = (): void => {
      // The stored duration comes from the recorder; the decoded file is the
      // authority once it is available.
      if (Number.isFinite(mic.duration) && mic.duration > 0) setDuration(mic.duration)
    }
    const onPlay = (): void => setPlaying(true)
    const onPause = (): void => setPlaying(false)
    const onEnded = (): void => {
      setPlaying(false)
      systemRef.current?.pause()
    }
    const onError = (): void => setFailed(true)

    mic.addEventListener('timeupdate', onTime)
    mic.addEventListener('loadedmetadata', onLoaded)
    mic.addEventListener('play', onPlay)
    mic.addEventListener('pause', onPause)
    mic.addEventListener('ended', onEnded)
    mic.addEventListener('error', onError)
    return () => {
      mic.removeEventListener('timeupdate', onTime)
      mic.removeEventListener('loadedmetadata', onLoaded)
      mic.removeEventListener('play', onPlay)
      mic.removeEventListener('pause', onPause)
      mic.removeEventListener('ended', onEnded)
      mic.removeEventListener('error', onError)
    }
  }, [onPosition, resync])

  useEffect(() => {
    setFailed(false)
    setPlaying(false)
    setPosition(0)
    setDuration(recording.durationSeconds)
    micRef.current?.load()
    systemRef.current?.load()
  }, [recording.noteId, recording.durationSeconds])

  useEffect(() => registerSeek?.(seekTo), [registerSeek, seekTo])

  useEffect(() => {
    if (micRef.current) micRef.current.playbackRate = speed
    if (systemRef.current) systemRef.current.playbackRate = speed
  }, [speed])

  // Switching notes mid-playback must not leave audio running from a note that
  // is no longer on screen.
  useEffect(() => {
    return () => {
      micRef.current?.pause()
      systemRef.current?.pause()
    }
  }, [])

  const progressPercent =
    duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0

  return (
    <div className="recording-player" role="group" aria-label="Recording playback">
      <audio
        ref={micRef}
        src={recordingMediaUrl(recording.noteId, 'mic', recording.durationSeconds)}
        preload="metadata"
      />
      {recording.systemPath && (
        <audio
          ref={systemRef}
          src={recordingMediaUrl(recording.noteId, 'system', recording.durationSeconds)}
          preload="metadata"
        />
      )}

      {failed ? (
        <span className="recording-player-error">This recording could not be played.</span>
      ) : (
        <>
          <button
            type="button"
            className="recording-player-btn"
            onClick={() => seekTo(position - SKIP_SECONDS)}
            aria-label={`Back ${SKIP_SECONDS} seconds`}
            title={`Back ${SKIP_SECONDS}s`}
          >
            <Back15 size={18} />
          </button>
          <button
            type="button"
            className="recording-player-btn primary"
            onClick={toggle}
            aria-label={playing ? 'Pause' : 'Play'}
            title={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button
            type="button"
            className="recording-player-btn"
            onClick={() => seekTo(position + SKIP_SECONDS)}
            aria-label={`Forward ${SKIP_SECONDS} seconds`}
            title={`Forward ${SKIP_SECONDS}s`}
          >
            <Forward15 size={18} />
          </button>

          <input
            type="range"
            className="recording-player-scrub"
            min={0}
            max={Math.max(1, duration)}
            step={0.1}
            value={Math.min(position, duration)}
            style={{
              background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${progressPercent}%, var(--subtleBorder) ${progressPercent}%, var(--subtleBorder) 100%)`
            }}
            onChange={(event) => seekTo(Number(event.target.value))}
            aria-label="Seek"
          />

          <span className="recording-player-time">
            {elapsedLabel(0, position * 1000)}
            <span className="recording-player-total"> / {elapsedLabel(0, duration * 1000)}</span>
          </span>

          <button
            type="button"
            className="recording-player-speed"
            onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}
            aria-label={`Playback speed ${speed}x`}
            title="Playback speed"
          >
            {speed}×
          </button>
        </>
      )}
    </div>
  )
}
