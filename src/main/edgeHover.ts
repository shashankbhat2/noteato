import { screen } from 'electron'
import type { ScreenEdge } from '../shared/types'

/**
 * How often the pointer is sampled. Electron has no global mouse-move event, so
 * an edge trigger has to poll — this is frequent enough to catch a deliberate
 * flick into the edge and cheap enough to leave running.
 */
const POLL_MS = 120

/** How close to the edge counts as touching it, in px. */
const EDGE_BAND_PX = 2

export interface EdgeHoverConfig {
  enabled: boolean
  edge: ScreenEdge
  delayMs: number
}

/**
 * Reveals the compact notes panel when the pointer rests against a screen edge.
 *
 * Only a sustained rest counts: the pointer has to sit in the edge band for the
 * configured delay without leaving it, so merely throwing the cursor across the
 * screen — or reaching for a window control in the corner — doesn't summon the
 * panel. Nothing here hides it again; that stays with the global shortcut and
 * the panel's own close button, so the panel can't vanish mid-sentence.
 */
export class EdgeHoverWatcher {
  private timer: ReturnType<typeof setInterval> | null = null
  /** When the current uninterrupted rest at the edge began, or 0 for none. */
  private restingSince = 0

  constructor(
    private getConfig: () => EdgeHoverConfig,
    private isRevealed: () => boolean,
    private reveal: () => void
  ) {}

  /** Start or stop polling to match the current settings. */
  sync(): void {
    if (this.getConfig().enabled) this.start()
    else this.stop()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.restingSince = 0
  }

  private start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), POLL_MS)
  }

  private tick(): void {
    // Already open: nothing to reveal, and the pointer is very likely inside
    // the panel — which sits on the edge it would otherwise be triggering.
    if (this.isRevealed()) {
      this.restingSince = 0
      return
    }

    const point = screen.getCursorScreenPoint()
    // Full bounds rather than workArea: the edge the panel docks to is the
    // physical screen edge, which is where the pointer actually stops.
    const { bounds } = screen.getDisplayNearestPoint(point)
    const atEdge =
      this.getConfig().edge === 'left'
        ? point.x <= bounds.x + EDGE_BAND_PX
        : point.x >= bounds.x + bounds.width - 1 - EDGE_BAND_PX

    if (!atEdge || point.y < bounds.y || point.y > bounds.y + bounds.height) {
      this.restingSince = 0
      return
    }

    const now = Date.now()
    if (this.restingSince === 0) {
      this.restingSince = now
      return
    }
    if (now - this.restingSince >= this.getConfig().delayMs) {
      this.restingSince = 0
      this.reveal()
    }
  }
}
