/**
 * A meeting's transcript: two channels, each attributed by where it came from.
 *
 * Ported from the removed Swift AgentCore/MeetingTranscript.swift, whose unit
 * tests came with it (test/meeting-transcript.test.ts). Shared rather than
 * main-only because the renderer reads the same shape to draw the transcript.
 */

/**
 * Speaker labels are `me` and `them` and nothing else.
 *
 * That is the whole design: the microphone is you and the system audio is the
 * other side, so attribution is a fact about which device the samples arrived
 * on rather than an inference from how a voice sounds. It cannot drift, cannot
 * be fooled by two similar voices, and needs no threshold anyone has to tune.
 */
export type Speaker = 'me' | 'them'

export interface TranscriptWord {
  word: string
  start: number
  end: number
}

/** The single-channel transcript of one audio file. */
export interface Transcript {
  version: number
  /** Which engine produced this — a cloud-transcribed note has to say so. */
  engine: string
  language?: string
  durationSeconds: number
  text: string
  /**
   * Word-level timings are the point of this file, not a detail of it: a
   * summary can only carry a timestamp range if the words underneath it have
   * timestamps. Storing only flat text would make that impossible to add later
   * without re-transcribing everything.
   */
  words: TranscriptWord[]
}

export interface MeetingSegment {
  speaker: Speaker
  /**
   * What the user renamed this side to, if they did. Undefined means the
   * default name is used — renaming is the user's act, not the model's guess.
   */
  label?: string
  start: number
  end: number
  text: string
}

export interface MeetingTranscript {
  version: number
  engine: string
  durationSeconds: number
  segments: MeetingSegment[]
}

export const DEFAULT_PAUSE_SECONDS = 0.9

export function displayName(
  segment: MeetingSegment,
  myName = 'Me',
  theirName = 'Them'
): string {
  return segment.label ?? (segment.speaker === 'me' ? myName : theirName)
}

/** Segments in the order they were said, regardless of which side said them. */
export function chronological(transcript: MeetingTranscript): MeetingSegment[] {
  return [...transcript.segments].sort((a, b) => a.start - b.start)
}

/**
 * Group a word stream into utterances, breaking on a pause.
 *
 * A transcript of individual words is unreadable, and a single block per
 * channel loses the exchange. A gap is the honest boundary: it is where the
 * person actually stopped talking.
 */
export function segmentsFrom(
  transcript: Transcript,
  speaker: Speaker,
  pauseSeconds: number = DEFAULT_PAUSE_SECONDS
): MeetingSegment[] {
  if (transcript.words.length === 0) {
    // No timings (a very short clip, or an engine that gave none) — keep the
    // text rather than dropping it on the floor.
    const text = transcript.text.trim()
    if (!text) return []
    return [{ speaker, start: 0, end: transcript.durationSeconds, text }]
  }

  const out: MeetingSegment[] = []
  let current: TranscriptWord[] = []

  const flush = (): void => {
    const first = current[0]
    const last = current[current.length - 1]
    if (!first || !last) return
    out.push({
      speaker,
      start: first.start,
      end: last.end,
      text: current.map((w) => w.word).join(' ')
    })
    current = []
  }

  for (const word of transcript.words) {
    const previous = current[current.length - 1]
    if (previous && word.start - previous.end >= pauseSeconds) flush()
    current.push(word)
  }
  flush()
  return out
}

/**
 * Interleave two single-channel transcripts into one conversation.
 *
 * Both channels were recorded simultaneously from the same instant, so their
 * timestamps share an origin and sorting on `start` reconstructs the exchange —
 * including the overlaps, which are real and worth keeping rather than
 * smoothing away.
 */
export function mergeTranscripts(
  mine: Transcript,
  theirs: Transcript,
  engine: string,
  pauseSeconds: number = DEFAULT_PAUSE_SECONDS
): MeetingTranscript {
  const segments = [
    ...segmentsFrom(mine, 'me', pauseSeconds),
    ...segmentsFrom(theirs, 'them', pauseSeconds)
  ].sort((a, b) => a.start - b.start)

  return {
    version: 1,
    engine,
    durationSeconds: Math.max(mine.durationSeconds, theirs.durationSeconds),
    segments
  }
}

export function timestamp(seconds: number): string {
  const total = Math.round(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * Markdown for the note body: who said what, in order, with timestamps that
 * point back into the audio.
 */
export function meetingMarkdown(
  transcript: MeetingTranscript,
  myName = 'Me',
  theirName = 'Them'
): string {
  return chronological(transcript)
    .map(
      (segment) =>
        `**${displayName(segment, myName, theirName)}** · ${timestamp(segment.start)}\n\n` +
        `${segment.text}\n`
    )
    .join('\n')
}

/**
 * Replace only editable prose while preserving attribution and every audio
 * timestamp. The renderer sends text by source index so a chronological view
 * can be rearranged without making timing metadata editable over IPC.
 */
export function applyTranscriptEdits(
  transcript: MeetingTranscript,
  texts: readonly string[]
): MeetingTranscript {
  if (texts.length !== transcript.segments.length) {
    throw new Error('Transcript changed while it was being edited. Reload and try again.')
  }
  return {
    ...transcript,
    segments: transcript.segments.map((segment, index) => ({
      ...segment,
      text: String(texts[index] ?? '')
    }))
  }
}

/**
 * Remove one utterance while preserving edits made to every surviving block.
 * The renderer supplies the full pre-delete text list so deleting a block also
 * flushes any edits that were still waiting for the autosave debounce.
 */
export function deleteTranscriptSegment(
  transcript: MeetingTranscript,
  sourceIndex: number,
  texts: readonly string[]
): MeetingTranscript {
  if (
    !Number.isSafeInteger(sourceIndex) ||
    sourceIndex < 0 ||
    sourceIndex >= transcript.segments.length
  ) {
    throw new Error('Transcript block is no longer available. Reload and try again.')
  }
  const edited = applyTranscriptEdits(transcript, texts)
  return {
    ...edited,
    segments: edited.segments.filter((_, index) => index !== sourceIndex)
  }
}

/**
 * Add a later recording to an existing transcript without disturbing edits to
 * the earlier material. The second capture starts at zero, so every timestamp
 * is shifted by the duration already present in the playable audio.
 */
export function appendMeetingTranscript(
  existing: MeetingTranscript,
  addition: MeetingTranscript,
  offsetSeconds: number = existing.durationSeconds
): MeetingTranscript {
  const offset = Math.max(0, offsetSeconds)
  return {
    ...existing,
    version: Math.max(existing.version, addition.version),
    durationSeconds: Math.max(existing.durationSeconds, offset) + addition.durationSeconds,
    segments: [
      ...existing.segments,
      ...addition.segments.map((segment) => ({
        ...segment,
        start: segment.start + offset,
        end: segment.end + offset
      }))
    ]
  }
}
