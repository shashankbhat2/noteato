import { describe, expect, it } from 'vitest'
import {
  parseRecordingMediaUrl,
  recordingMediaUrl
} from '../src/shared/recordingMedia'

describe('recording media URLs', () => {
  it('round-trips note ids without exposing a file path', () => {
    const url = recordingMediaUrl('note / with spaces', 'mic', 42)
    expect(url).not.toContain('/Users/')
    expect(parseRecordingMediaUrl(url)).toEqual({
      noteId: 'note / with spaces',
      track: 'mic'
    })
  })

  it('rejects unknown hosts, tracks, and malformed URLs', () => {
    expect(parseRecordingMediaUrl('noteato-recording://other/id/mic')).toBeNull()
    expect(parseRecordingMediaUrl('noteato-recording://audio/id/video')).toBeNull()
    expect(parseRecordingMediaUrl('not a url')).toBeNull()
  })
})
