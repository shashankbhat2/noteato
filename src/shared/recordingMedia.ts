export const RECORDING_MEDIA_SCHEME = 'noteato-recording'

export type RecordingTrack = 'mic' | 'system'

export interface RecordingMediaTarget {
  noteId: string
  track: RecordingTrack
}

/** A renderer-safe URL: the main process resolves the id to a known recording. */
export function recordingMediaUrl(
  noteId: string,
  track: RecordingTrack,
  revision?: string | number
): string {
  const base = `${RECORDING_MEDIA_SCHEME}://audio/${encodeURIComponent(noteId)}/${track}`
  return revision === undefined ? base : `${base}?v=${encodeURIComponent(String(revision))}`
}

/** Rejects malformed URLs before they can reach the recording store. */
export function parseRecordingMediaUrl(value: string): RecordingMediaTarget | null {
  try {
    const url = new URL(value)
    if (url.protocol !== `${RECORDING_MEDIA_SCHEME}:` || url.hostname !== 'audio') return null
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length !== 2) return null
    const noteId = decodeURIComponent(parts[0])
    const track = parts[1]
    if (!noteId || (track !== 'mic' && track !== 'system')) return null
    return { noteId, track }
  } catch {
    return null
  }
}
