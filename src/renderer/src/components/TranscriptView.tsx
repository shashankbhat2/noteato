import { useEffect, useLayoutEffect, useRef } from 'react'
import type { MeetingTranscript } from '../../../shared/meetingTranscript'
import { displayName, timestamp } from '../../../shared/meetingTranscript'

interface Props {
  transcript: MeetingTranscript
  /** Marks the segment being played at its left edge and lets a click seek to it. */
  playheadSeconds?: number
  onSeek?: (seconds: number) => void
  onChange?: (sourceIndex: number, text: string) => void
  onCommit?: () => void
}

function TranscriptText({
  value,
  label,
  onChange,
  onCommit
}: {
  value: string
  label: string
  onChange: (text: string) => void
  onCommit?: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const resize = (): void => {
    const element = ref.current
    if (!element) return
    element.style.height = '0px'
    element.style.height = `${element.scrollHeight}px`
  }

  useLayoutEffect(() => {
    resize()
  }, [value])

  useEffect(() => {
    const element = ref.current
    if (!element) return
    let width = element.clientWidth
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return
      width = element.clientWidth
      resize()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <textarea
      ref={ref}
      className="transcript-text"
      value={value}
      rows={1}
      spellCheck
      aria-label={`${label} transcript text`}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onCommit}
    />
  )
}

/**
 * The meeting as a conversation.
 *
 * Speakers are the two capture channels — your microphone and the system audio
 * — so attribution is a fact about where the samples came from rather than an
 * inference about how a voice sounds.
 */
export default function TranscriptView({
  transcript,
  playheadSeconds,
  onSeek,
  onChange,
  onCommit
}: Props) {
  const segments = transcript.segments
    .map((segment, sourceIndex) => ({ segment, sourceIndex }))
    .sort((a, b) => a.segment.start - b.segment.start)

  if (segments.length === 0) {
    return (
      <div className="note-transcription-empty">
        <strong>Nothing was said</strong>
        <span>This recording contained no speech either side could make out.</span>
      </div>
    )
  }

  return (
    <div className="transcript-view">
      {segments.map(({ segment, sourceIndex }) => {
        const active =
          playheadSeconds !== undefined &&
          playheadSeconds >= segment.start &&
          playheadSeconds < segment.end

        return (
          <div
            key={`${segment.speaker}-${segment.start}-${sourceIndex}`}
            className={
              active
                ? `transcript-segment ${segment.speaker} active`
                : `transcript-segment ${segment.speaker}`
            }
          >
            <div className="transcript-segment-head">
              <span className="transcript-speaker">{displayName(segment)}</span>
              <button
                type="button"
                className="transcript-stamp"
                onClick={() => onSeek?.(segment.start)}
                title="Play from here"
              >
                {timestamp(segment.start)}
              </button>
            </div>
            <TranscriptText
              value={segment.text}
              label={displayName(segment)}
              onChange={(text) => onChange?.(sourceIndex, text)}
              onCommit={onCommit}
            />
          </div>
        )
      })}
    </div>
  )
}
