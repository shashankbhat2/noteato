import { describe, expect, it } from 'vitest'
import {
  chronological,
  displayName,
  meetingMarkdown,
  mergeTranscripts,
  segmentsFrom,
  type Transcript,
  type TranscriptWord
} from '../src/shared/meetingTranscript'

// Ported from the removed Swift suite (agent/Tests/AgentCoreTests/MeetingTests.swift).
// The merge is pure data transformation, so the assertions carry over intact —
// losing this coverage would have been the real cost of dropping the Swift package.

function words(pairs: [string, number, number][]): TranscriptWord[] {
  return pairs.map(([word, start, end]) => ({ word, start, end }))
}

function channel(
  text: string,
  pairs: [string, number, number][],
  durationSeconds = 10
): Transcript {
  return { version: 1, engine: 'test', durationSeconds, text, words: words(pairs) }
}

describe('meeting transcript', () => {
  // The design in one test: attribution comes from which device the audio
  // arrived on, so it is exact rather than inferred.
  it('attributes each side by the channel it came from', () => {
    const meeting = mergeTranscripts(
      channel('hello there', [
        ['hello', 0.0, 0.4],
        ['there', 0.4, 0.8]
      ]),
      channel('hi yes', [
        ['hi', 1.5, 1.8],
        ['yes', 1.8, 2.1]
      ]),
      'test'
    )

    expect(meeting.segments.filter((s) => s.speaker === 'me')).toHaveLength(1)
    expect(meeting.segments.filter((s) => s.speaker === 'them')).toHaveLength(1)
    expect(chronological(meeting)[0].speaker).toBe('me')
    expect(chronological(meeting).at(-1)?.speaker).toBe('them')
  })

  it('reconstructs the order of an exchange from shared timestamps', () => {
    // Both channels started at the same instant, so sorting on start time
    // rebuilds the conversation.
    const meeting = mergeTranscripts(
      channel('first third', [
        ['first', 0.0, 0.5],
        ['third', 4.0, 4.5]
      ]),
      channel('second', [['second', 2.0, 2.5]]),
      'test'
    )

    expect(chronological(meeting).map((s) => s.text)).toEqual(['first', 'second', 'third'])
  })

  it('keeps overlapping speech rather than smoothing it away', () => {
    // People talk over each other. That is information about the meeting, not
    // noise to be resolved.
    const meeting = mergeTranscripts(
      channel('as I was saying', [
        ['as', 1.0, 1.2],
        ['I', 1.2, 1.4],
        ['was', 1.4, 1.6],
        ['saying', 1.6, 2.0]
      ]),
      channel('sorry go ahead', [
        ['sorry', 1.3, 1.6],
        ['go', 1.6, 1.8],
        ['ahead', 1.8, 2.1]
      ]),
      'test'
    )

    expect(meeting.segments).toHaveLength(2)
    const me = meeting.segments.find((s) => s.speaker === 'me')!
    const them = meeting.segments.find((s) => s.speaker === 'them')!
    expect(them.start).toBeLessThan(me.end)
  })

  it('breaks a channel into utterances at pauses', () => {
    const segments = segmentsFrom(
      channel('one two three four', [
        ['one', 0.0, 0.3],
        ['two', 0.3, 0.6],
        ['three', 3.0, 3.3],
        ['four', 3.3, 3.6]
      ]),
      'me'
    )

    expect(segments).toHaveLength(2)
    expect(segments[0].text).toBe('one two')
    expect(segments[1].text).toBe('three four')
  })

  it('keeps text that arrived without timings', () => {
    const segments = segmentsFrom(
      { version: 1, engine: 'test', durationSeconds: 3, text: 'short clip', words: [] },
      'me'
    )

    expect(segments).toHaveLength(1)
    expect(segments[0].text).toBe('short clip')
  })

  it('drops a channel that heard nothing', () => {
    // A meeting where nobody else spoke must not produce an empty "Them" block.
    const meeting = mergeTranscripts(
      channel('just me', [
        ['just', 0, 0.3],
        ['me', 0.3, 0.6]
      ]),
      { version: 1, engine: 'test', durationSeconds: 5, text: '', words: [] },
      'test'
    )

    expect(meeting.segments.every((s) => s.speaker === 'me')).toBe(true)
  })

  it('renaming a side sticks, and only that side', () => {
    const meeting = mergeTranscripts(
      channel('hello', [['hello', 0, 0.4]]),
      channel('hi', [['hi', 1, 1.3]]),
      'test'
    )
    for (const segment of meeting.segments) {
      if (segment.speaker === 'them') segment.label = 'Priya'
    }

    expect(displayName(chronological(meeting).at(-1)!)).toBe('Priya')
    expect(displayName(chronological(meeting)[0])).toBe('Me')
  })

  it('renders markdown with timestamps that point into the audio', () => {
    const text = meetingMarkdown(
      mergeTranscripts(
        channel('hello there', [
          ['hello', 0, 0.4],
          ['there', 0.4, 0.9]
        ]),
        // Past a minute, so the mm:ss formatting is doing real work.
        channel('hi', [['hi', 75, 75.4]]),
        'test'
      )
    )

    expect(text).toContain('**Me** · 0:00')
    expect(text).toContain('**Them** · 1:15')
    expect(text).toContain('hello there')
  })

  it('round-trips through JSON', () => {
    const meeting = mergeTranscripts(
      channel('hello', [['hello', 0, 0.4]]),
      channel('hi', [['hi', 1, 1.3]]),
      'test'
    )

    expect(JSON.parse(JSON.stringify(meeting))).toEqual(meeting)
  })
})
