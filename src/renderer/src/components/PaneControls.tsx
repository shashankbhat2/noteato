import {
  IconChevronLeft as ChevronLeft,
  IconChevronRight as ChevronRight,
  IconPin as Pin,
  IconPinnedFilled as PinnedFilled,
  IconX as X
} from '@tabler/icons-react'

interface Props {
  /** This pane's position in the row, and how many panes there are. */
  index: number
  count: number
  onMove: (from: number, to: number) => void
  onClose: () => void
  /** False for the lone empty pane, where close belongs to the window. */
  canClose: boolean
  /** Pinned panes keep their note when you open something from the sidebar. */
  pinned: boolean
  onTogglePin: () => void
}

/**
 * The only chrome a pane has. With no tab strip there is nowhere else to
 * rearrange or close a pane from, so these ride along in the pane's own top
 * corner.
 *
 * Close is always offered — with one pane it returns to the centred new-note
 * action. The move arrows appear only once there is a second pane to trade
 * places with.
 */
export default function PaneControls({
  index,
  count,
  onMove,
  onClose,
  canClose,
  pinned,
  onTogglePin
}: Props) {
  if (count < 2 && !canClose) return null
  return (
    <div className="pane-controls">
      <button
        className={pinned ? 'pane-control-btn active' : 'pane-control-btn'}
        onClick={onTogglePin}
        title={pinned ? 'Unpin — the sidebar can open notes here again' : 'Keep this note here'}
      >
        {pinned ? <PinnedFilled size={14} /> : <Pin size={14} />}
      </button>
      {count > 1 && (
        <>
          <button
            className="pane-control-btn"
            disabled={index === 0}
            onClick={() => onMove(index, index - 1)}
            title="Move pane left"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            className="pane-control-btn"
            disabled={index === count - 1}
            onClick={() => onMove(index, index + 1)}
            title="Move pane right"
          >
            <ChevronRight size={14} />
          </button>
        </>
      )}
      {canClose && (
        <button
          className="pane-control-btn pane-close-btn"
          onClick={onClose}
          title={count > 1 ? 'Close pane' : 'Close'}
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}
