import type { ModelStatus } from '../../../shared/types'
import { MODEL_DOWNLOAD_MB } from '../../../shared/asrModel'

/**
 * Shared between the onboarding card and Settings, which show the same one
 * download from two places and must never disagree about how far along it is.
 */

const MB = 1024 * 1024

function mb(bytes: number): number {
  return Math.round(bytes / MB)
}

/** A sentence for the status, in the user's terms rather than the model's. */
export function modelStatusLabel(status: ModelStatus): string {
  switch (status.state) {
    case 'installed':
      return 'Ready to transcribe on this Mac.'
    case 'downloading':
      if (status.installing) return 'Installing the speech model on this Mac…'
      // The server does not always send a length; counting up alone still
      // shows movement, which is the point.
      return status.total
        ? `Downloading — ${mb(status.received)} MB of ${mb(status.total)} MB.`
        : `Downloading — ${mb(status.received)} MB so far.`
    case 'failed':
      return `Could not install the speech model: ${status.message}`
    default:
      return `Downloads once, about ${MODEL_DOWNLOAD_MB} MB. Runs entirely on your Mac.`
  }
}

/**
 * The bar. Indeterminate until a content length arrives, so it never sits at a
 * confident 0% during the seconds before the first chunk.
 */
export function ModelProgress({
  status
}: {
  status: Extract<ModelStatus, { state: 'downloading' }>
}) {
  const fraction = status.total ? Math.min(1, status.received / status.total) : null

  return (
    <div
      className="model-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={status.total || undefined}
      aria-valuenow={fraction === null ? undefined : status.received}
      aria-label="Downloading the speech model"
    >
      <div className={fraction === null ? 'model-progress-track waiting' : 'model-progress-track'}>
        <div
          className="model-progress-fill"
          style={fraction === null ? undefined : { width: `${fraction * 100}%` }}
        />
      </div>
      <span className="model-progress-count">
        {status.installing
          ? 'Installing…'
          : status.total
          ? `${mb(status.received)} MB of ${mb(status.total)} MB`
          : `${mb(status.received)} MB`}
      </span>
    </div>
  )
}
