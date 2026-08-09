import { createReadStream, statSync } from 'node:fs'
import { Readable } from 'node:stream'

export interface ByteRange {
  start: number
  end: number
}

/** Parse the single byte range Chromium's audio element uses while seeking. */
export function parseByteRange(value: string, size: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim())
  if (!match || size <= 0 || (!match[1] && !match[2])) return null

  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null
    return { start: Math.max(0, size - suffixLength), end: size - 1 }
  }

  const start = Number(match[1])
  const requestedEnd = match[2] ? Number(match[2]) : size - 1
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return null
  }

  return { start, end: Math.min(requestedEnd, size - 1) }
}

/**
 * Serve a local recording with real HTTP byte-range semantics. Forwarding a
 * Range header to file:// is platform-dependent; explicit 206 responses make
 * long M4A recordings seekable in Chromium without loading them into memory.
 */
export function recordingMediaResponse(filePath: string, request: Request): Response {
  let size: number
  try {
    size = statSync(filePath).size
  } catch {
    return new Response(null, { status: 404 })
  }

  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Content-Type': 'audio/mp4'
  })
  const rangeHeader = request.headers.get('range')

  if (rangeHeader) {
    const range = parseByteRange(rangeHeader, size)
    if (!range) {
      headers.set('Content-Range', `bytes */${size}`)
      return new Response(null, { status: 416, headers })
    }

    const length = range.end - range.start + 1
    headers.set('Content-Length', String(length))
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
    if (request.method === 'HEAD') return new Response(null, { status: 206, headers })

    const stream = Readable.toWeb(createReadStream(filePath, range)) as unknown as BodyInit
    return new Response(stream, { status: 206, headers })
  }

  headers.set('Content-Length', String(size))
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers })
  const stream = Readable.toWeb(createReadStream(filePath)) as unknown as BodyInit
  return new Response(stream, { status: 200, headers })
}
