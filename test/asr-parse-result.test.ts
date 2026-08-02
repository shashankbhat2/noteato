import { describe, expect, it } from 'vitest'
import { parseAsrResult, wordsFromTokens } from '../src/main/asr/parseResult'

// The fixtures below are real responses captured from
// sherpa-onnx-offline-websocket-server v1.13.4 running parakeet-tdt-0.6b-v3.

describe('parseAsrResult', () => {
  it('reads text out of the JSON the server actually sends', () => {
    const raw =
      '{"lang": "", "emotion": "", "event": "", "text": "So, I\'m not", ' +
      '"timestamps": [0.16, 19.36, 19.36, 19.36, 19.36, 19.36], ' +
      '"durations": [0.16, 0.00, 0.00, 0.00, 0.00, 0.00], ' +
      '"tokens":[" So", ",", " I", "\'", "m", " not"], "words": []}'

    expect(parseAsrResult(raw).text).toBe("So, I'm not")
  })

  it('handles a silent channel without inventing text', () => {
    const raw = '{"text": "", "timestamps": [], "tokens":[], "words": []}'
    const result = parseAsrResult(raw)

    expect(result.text).toBe('')
    expect(result.words).toEqual([])
  })

  // Older builds replied with the bare transcript; treat that as the text
  // rather than as a parse failure.
  it('falls back to the raw body when it is not JSON', () => {
    expect(parseAsrResult('hello there').text).toBe('hello there')
  })

  it('survives an empty response', () => {
    expect(parseAsrResult('   ')).toEqual({ text: '', words: [] })
  })
})

describe('wordsFromTokens', () => {
  it('joins sub-word pieces into words at the leading-space boundary', () => {
    const words = wordsFromTokens(
      [' So', ',', ' I', "'", 'm', ' not'],
      [0.16, 0.32, 0.48, 0.52, 0.56, 0.72]
    )

    expect(words.map((w) => w.word)).toEqual(['So,', "I'm", 'not'])
  })

  it('times each word from its first and last piece', () => {
    const [first, second] = wordsFromTokens(
      [' hello', ' the', 're'],
      [0.1, 0.5, 0.8]
    )

    expect(first).toEqual({ word: 'hello', start: 0.1, end: 0.1 })
    // "there" spans both of its pieces, which is what makes pause detection
    // between words meaningful.
    expect(second).toEqual({ word: 'there', start: 0.5, end: 0.8 })
  })

  it('ignores tokens with no matching timestamp rather than emitting NaN', () => {
    const words = wordsFromTokens([' one', ' two'], [0.5])

    expect(words).toHaveLength(2)
    expect(words.every((w) => Number.isFinite(w.start) && Number.isFinite(w.end))).toBe(true)
  })

  it('returns nothing for an empty token list', () => {
    expect(wordsFromTokens([], [])).toEqual([])
  })
})
