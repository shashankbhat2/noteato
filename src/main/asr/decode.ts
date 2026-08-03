import { execFile } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** What the model expects. Resampling here rather than in the recorder keeps
 *  the archived audio at full quality. */
export const ASR_SAMPLE_RATE = 16_000

/**
 * Decode a recording to the mono 16 kHz float32 the recogniser wants.
 *
 * `afconvert` ships with macOS, so this costs nothing in the bundle — an
 * ffmpeg-static dependency would have added tens of megabytes to do a job
 * CoreAudio already does natively.
 */
export async function decodeForAsr(audioPath: string): Promise<Float32Array> {
  const wavPath = join(tmpdir(), `noteato-asr-${randomUUID()}.wav`)
  try {
    await run('/usr/bin/afconvert', [
      '-f',
      'WAVE',
      '-d',
      `LEI16@${ASR_SAMPLE_RATE}`,
      '-c',
      '1',
      audioPath,
      wavPath
    ])
    return wavToFloat32(await readFile(wavPath))
  } finally {
    await rm(wavPath, { force: true })
  }
}

/**
 * Minimal RIFF reader: walk the chunk list to find `data` rather than assuming
 * a 44-byte header, because afconvert emits a LIST/INFO chunk ahead of it and
 * a fixed offset would decode metadata as audio.
 */
export function wavToFloat32(buffer: Buffer): Float32Array {
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('not a RIFF file')
  }

  let offset = 12
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const body = offset + 8

    if (id === 'data') {
      const end = Math.min(body + size, buffer.length)
      const count = Math.floor((end - body) / 2)
      const samples = new Float32Array(count)
      for (let index = 0; index < count; index += 1) {
        samples[index] = buffer.readInt16LE(body + index * 2) / 32768
      }
      return samples
    }
    // Chunks are word-aligned: an odd size is followed by a pad byte.
    offset = body + size + (size % 2)
  }

  throw new Error('RIFF file has no data chunk')
}
