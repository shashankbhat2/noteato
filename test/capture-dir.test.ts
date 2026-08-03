import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AUDIO_FILE,
  createCaptureDir,
  MIC_TEMP_FILE,
  removeCaptureAudio,
  removeCaptureDir,
  removeCaptureInputs,
  SYSTEM_TEMP_FILE
} from '../src/main/meeting/captureDir'

describe('meeting capture directory', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) removeCaptureDir(root)
  })

  const makeCapture = () => {
    const root = mkdtempSync(join(tmpdir(), 'noteato-capture-dir-'))
    roots.push(root)
    return createCaptureDir(root, new Date('2026-08-02T08:21:45.000Z'))
  }

  it('uses one visible audio file and two hidden transcription inputs', () => {
    const capture = makeCapture()

    expect(basename(capture.audioPath)).toBe(AUDIO_FILE)
    expect(basename(capture.micPath)).toBe(MIC_TEMP_FILE)
    expect(basename(capture.systemPath)).toBe(SYSTEM_TEMP_FILE)
    expect(basename(capture.micPath).startsWith('.')).toBe(true)
    expect(basename(capture.systemPath).startsWith('.')).toBe(true)
  })

  it('removes working tracks after transcription but keeps the final recording', () => {
    const capture = makeCapture()
    for (const path of [capture.audioPath, capture.micPath, capture.systemPath]) {
      writeFileSync(path, 'audio')
    }

    removeCaptureInputs(capture.dir)

    expect(existsSync(capture.audioPath)).toBe(true)
    expect(existsSync(capture.micPath)).toBe(false)
    expect(existsSync(capture.systemPath)).toBe(false)
  })

  it('can discard audio without deleting a prepared meeting note', () => {
    const capture = makeCapture()
    const notePath = join(capture.dir, 'note.md')
    for (const path of [capture.audioPath, capture.micPath, capture.systemPath, notePath]) {
      writeFileSync(path, path === notePath ? 'note' : 'audio')
    }

    removeCaptureAudio(capture.dir)

    expect(existsSync(notePath)).toBe(true)
    expect(existsSync(capture.audioPath)).toBe(false)
    expect(existsSync(capture.micPath)).toBe(false)
    expect(existsSync(capture.systemPath)).toBe(false)
  })
})
