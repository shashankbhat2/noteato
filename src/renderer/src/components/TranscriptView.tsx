import { IconTrash as Trash } from '@tabler/icons-react'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from 'react'
import type { MeetingTranscript } from '../../../shared/meetingTranscript'
import { displayName, timestamp } from '../../../shared/meetingTranscript'

interface Props {
  transcript: MeetingTranscript
  /** Marks the segment being played at its left edge and lets a click seek to it. */
  playheadSeconds?: number
  onSeek?: (seconds: number) => void
  onChange?: (sourceIndex: number, text: string) => void
  onDelete?: (sourceIndex: number) => void
  onCommit?: () => void
}

const DELETE_DISTANCE = 92
const FLICK_DISTANCE = 28
const FLICK_VELOCITY = -0.55
const DELETE_EXIT_MS = 180

interface DragState {
  pointerId: number
  startX: number
  startY: number
  lastX: number
  lastAt: number
  velocity: number
  x: number
  active: boolean
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

function TranscriptSegment({
  segment,
  sourceIndex,
  active,
  onSeek,
  onChange,
  onDelete,
  onCommit
}: {
  segment: MeetingTranscript['segments'][number]
  sourceIndex: number
  active: boolean
  onSeek?: (seconds: number) => void
  onChange?: (sourceIndex: number, text: string) => void
  onDelete?: (sourceIndex: number) => void
  onCommit?: () => void
}) {
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [armed, setArmed] = useState(false)
  const [exiting, setExiting] = useState(false)
  const dragRef = useRef<DragState | null>(null)
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current)
    },
    []
  )

  const deleteBlock = (): void => {
    if (!onDelete || exiting) return
    setDragging(false)
    setArmed(true)
    setExiting(true)
    setDragX(-Math.max(window.innerWidth, 480))
    deleteTimerRef.current = setTimeout(() => onDelete(sourceIndex), DELETE_EXIT_MS)
  }

  const resetDrag = (): void => {
    dragRef.current = null
    setDragging(false)
    setArmed(false)
    setDragX(0)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!onDelete || exiting || event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('textarea, button')) return

    const now = performance.now()
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastAt: now,
      velocity: 0,
      x: 0,
      active: false
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    const rawX = event.clientX - drag.startX
    const rawY = event.clientY - drag.startY
    if (!drag.active) {
      if (Math.abs(rawX) < 5 && Math.abs(rawY) < 5) return
      if (Math.abs(rawY) > Math.abs(rawX) || rawX > 0) {
        resetDrag()
        return
      }
      drag.active = true
      setDragging(true)
    }

    event.preventDefault()
    const now = performance.now()
    const elapsed = Math.max(1, now - drag.lastAt)
    drag.velocity = (event.clientX - drag.lastX) / elapsed
    drag.lastX = event.clientX
    drag.lastAt = now
    drag.x = Math.min(0, rawX)
    setDragX(drag.x)
    setArmed(drag.x <= -DELETE_DISTANCE)
  }

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    const shouldDelete =
      drag.x <= -DELETE_DISTANCE ||
      (drag.x <= -FLICK_DISTANCE && drag.velocity <= FLICK_VELOCITY)
    if (shouldDelete) deleteBlock()
    else resetDrag()
  }

  const dragProgress = Math.min(1, Math.abs(dragX) / DELETE_DISTANCE)
  const style = {
    '--transcript-drag-x': `${dragX}px`,
    '--transcript-delete-progress': dragProgress
  } as CSSProperties
  const shellClass = [
    'transcript-segment-shell',
    dragging ? 'dragging' : '',
    armed ? 'delete-armed' : '',
    exiting ? 'deleting' : ''
  ]
    .filter(Boolean)
    .join(' ')
  const segmentClass = [
    'transcript-segment',
    segment.speaker,
    active ? 'active' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={shellClass} style={style}>
      <div className="transcript-delete-rail" aria-hidden="true">
        <Trash size={15} stroke={1.8} />
        <span>{armed ? 'Release to delete' : 'Delete'}</span>
      </div>
      <div
        className={segmentClass}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={resetDrag}
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
          {onDelete && (
            <button
              type="button"
              className="transcript-delete-button"
              onClick={deleteBlock}
              title="Delete transcript block"
              aria-label={`Delete ${displayName(segment)} transcript block at ${timestamp(segment.start)}`}
            >
              <Trash size={14} stroke={1.7} />
            </button>
          )}
        </div>
        <TranscriptText
          value={segment.text}
          label={displayName(segment)}
          onChange={(text) => onChange?.(sourceIndex, text)}
          onCommit={onCommit}
        />
      </div>
    </div>
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
  onDelete,
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
          <TranscriptSegment
            key={`${segment.speaker}-${segment.start}-${sourceIndex}`}
            segment={segment}
            sourceIndex={sourceIndex}
            active={active}
            onSeek={onSeek}
            onChange={onChange}
            onDelete={onDelete}
            onCommit={onCommit}
          />
        )
      })}
    </div>
  )
}
