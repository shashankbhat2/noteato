import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  mergeTranscripts,
  type MeetingTranscript,
  type Transcript
} from '../../shared/meetingTranscript'
import { ASR_SAMPLE_RATE, decodeForAsr } from '../asr/decode'
import { MODEL_ENGINE, ensureModel } from '../asr/model'
import type { SherpaServer } from '../asr/sherpaServer'
import {
  AUDIO_FILE,
  LEGACY_SYSTEM_FILE,
  MIC_TEMP_FILE,
  SYSTEM_TEMP_FILE
} from './captureDir'

export const MEETING_FILE = 'meeting.json'

/**
 * Transcribe one channel.
 *
 * The server returns per-token timestamps, which parseAsrResult assembles into
 * word timings — so `segmentsFrom` can break this channel at real pauses rather
 * than collapsing it into a single block.
 */
async function transcribeChannel(
  server: SherpaServer,
  audioPath: string
): Promise<Transcript> {
  const samples = await decodeForAsr(audioPath)
  const { text, words } = await server.transcribe(samples, ASR_SAMPLE_RATE)
  return {
    version: 1,
    engine: MODEL_ENGINE,
    durationSeconds: samples.length / ASR_SAMPLE_RATE,
    text,
    words
  }
}

const EMPTY: Transcript = {
  version: 1,
  engine: MODEL_ENGINE,
  durationSeconds: 0,
  text: '',
  words: []
}

/**
 * Transcribe a capture's two channels and write `meeting.json` beside the audio.
 *
 * The transcript lives with its audio rather than in the database: it is
 * derived data the user can inspect, delete or back up along with the recording
 * it came from, and the database only needs to know that it exists.
 */
export async function transcribeCapture(
  server: SherpaServer,
  captureDir: string,
  onProgress?: (received: number, total: number) => void
): Promise<MeetingTranscript> {
  await ensureModel(onProgress)

  const micTemp = join(captureDir, MIC_TEMP_FILE)
  const systemTemp = join(captureDir, SYSTEM_TEMP_FILE)
  const micPath = existsSync(micTemp) ? micTemp : join(captureDir, AUDIO_FILE)
  const legacySystem = join(captureDir, LEGACY_SYSTEM_FILE)
  const systemPath = existsSync(systemTemp) ? systemTemp : legacySystem

  // Sequential on purpose: two decodes plus two inferences in parallel contend
  // for the same cores and finish no sooner, but double peak memory.
  const mine = existsSync(micPath) ? await transcribeChannel(server, micPath) : EMPTY
  const theirs = existsSync(systemPath) ? await transcribeChannel(server, systemPath) : EMPTY

  const meeting = mergeTranscripts(mine, theirs, MODEL_ENGINE)
  await writeFile(join(captureDir, MEETING_FILE), JSON.stringify(meeting, null, 2), 'utf-8')
  return meeting
}
