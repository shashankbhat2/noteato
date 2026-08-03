/**
 * m:ss up to an hour, then h:mm:ss — meetings routinely run past both.
 *
 * Shared by the pill and the note header so the two can never disagree about
 * how long the same recording has been running.
 */
export function elapsedLabel(startedAt: number, now: number): string {
  const total = Math.max(0, Math.floor((now - startedAt) / 1000))
  const seconds = String(total % 60).padStart(2, '0')
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`
}
