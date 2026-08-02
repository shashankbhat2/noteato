import type { TranscriptWord } from '../../shared/meetingTranscript'

export interface AsrResult {
  text: string
  words: TranscriptWord[]
}

/**
 * Parse what sherpa-onnx's offline server sends back.
 *
 * It replies with a JSON object, not the bare text the docs' examples imply.
 * Older builds did send plain text, so a non-JSON body is treated as the
 * transcript rather than an error.
 */
export function parseAsrResult(raw: string): AsrResult {
  const trimmed = raw.trim()
  if (!trimmed) return { text: '', words: [] }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { text: trimmed, words: [] }
  }
  if (typeof parsed !== 'object' || parsed === null) return { text: trimmed, words: [] }

  const record = parsed as Record<string, unknown>
  const text = typeof record['text'] === 'string' ? record['text'].trim() : ''
  const tokens = Array.isArray(record['tokens']) ? (record['tokens'] as unknown[]) : []
  const timestamps = Array.isArray(record['timestamps'])
    ? (record['timestamps'] as unknown[])
    : []

  return { text, words: wordsFromTokens(tokens, timestamps) }
}

/**
 * Assemble sub-word tokens into timed words.
 *
 * The model emits SentencePiece-style pieces where a leading space marks the
 * start of a new word (`" So"`, `","`, `" I"`, `"'"`, `"m"`). Joining on that
 * boundary is what turns per-token timings into per-word ones — and word
 * timings are what let `segmentsFrom` break a channel at real pauses instead of
 * collapsing it into one block.
 */
export function wordsFromTokens(tokens: unknown[], timestamps: unknown[]): TranscriptWord[] {
  const words: TranscriptWord[] = []
  let current = ''
  let start = 0
  let end = 0

  const flush = (): void => {
    const word = current.trim()
    if (word) words.push({ word, start, end })
    current = ''
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (typeof token !== 'string' || token === '') continue
    const at = Number(timestamps[index])
    const time = Number.isFinite(at) ? at : end

    if (token.startsWith(' ') && current !== '') flush()
    if (current === '') start = time
    current += token
    end = time
  }
  flush()

  return words
}
