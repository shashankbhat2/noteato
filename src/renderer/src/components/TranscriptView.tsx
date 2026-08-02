import type { MeetingTranscript } from '../../../shared/meetingTranscript'
import { chronological, displayName, timestamp } from '../../../shared/meetingTranscript'

interface Props {
  transcript: MeetingTranscript
  /** Highlights the segment being played and lets a click seek to it. */
  playheadSeconds?: number
  onSeek?: (seconds: number) => void
}

/**
 * The meeting as a conversation.
 *
 * Speakers are the two capture channels — your microphone and the system audio
 * — so attribution is a fact about where the samples came from rather than an
 * inference about how a voice sounds.
 */
export default function TranscriptView({ transcript, playheadSeconds, onSeek }: Props) {
  const segments = chronological(transcript)

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
      {segments.map((segment, index) => {
        const active =
          playheadSeconds !== undefined &&
          playheadSeconds >= segment.start &&
          playheadSeconds < segment.end

        return (
          <div
            key={`${segment.speaker}-${segment.start}-${index}`}
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
            <p className="transcript-text">{segment.text}</p>
          </div>
        )
      })}
    </div>
  )
}
