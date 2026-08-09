import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseByteRange, recordingMediaResponse } from '../src/main/recordingMediaResponse'

describe('recording media byte ranges', () => {
  let root: string | null = null

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
    root = null
  })

  it('parses bounded, open-ended, and suffix ranges', () => {
    expect(parseByteRange('bytes=2-5', 10)).toEqual({ start: 2, end: 5 })
    expect(parseByteRange('bytes=7-', 10)).toEqual({ start: 7, end: 9 })
    expect(parseByteRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 })
    expect(parseByteRange('bytes=12-', 10)).toBeNull()
  })

  it('returns a partial response Chromium can use to scrub', async () => {
    root = mkdtempSync(join(tmpdir(), 'noteato-media-'))
    const file = join(root, 'audio.m4a')
    writeFileSync(file, '0123456789')

    const response = recordingMediaResponse(
      file,
      new Request('https://audio.local', { headers: { Range: 'bytes=2-5' } })
    )

    expect(response.status).toBe(206)
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(response.headers.get('content-length')).toBe('4')
    expect(await response.text()).toBe('2345')
  })
})
