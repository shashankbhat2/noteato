import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import {
  findRequiredModelDirectory,
  modelArchiveValidationError
} from '../src/main/asr/model'

const REQUIRED = ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt']

describe('speech model archive discovery', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('finds a complete model inside the archive without relying on GNU find', () => {
    const root = mkdtempSync(join(tmpdir(), 'noteato-model-'))
    roots.push(root)
    const model = join(root, 'release-folder', 'model')
    mkdirSync(model, { recursive: true })
    for (const name of REQUIRED) writeFileSync(join(model, name), name)

    expect(findRequiredModelDirectory(root)).toBe(model)
  })

  it('rejects a directory containing only part of the model', () => {
    const root = mkdtempSync(join(tmpdir(), 'noteato-model-partial-'))
    roots.push(root)
    writeFileSync(join(root, 'tokens.txt'), 'tokens')

    expect(findRequiredModelDirectory(root)).toBeNull()
  })

  it('rejects incomplete or corrupted release archives before extraction', () => {
    const digest = '5793d0fd397c5778d2cf2126994d58e9d56b1be7c04d13c7a15bb1b4eafb16bf'
    expect(modelArchiveValidationError(487_170_054, digest)).toContain('incomplete')
    expect(modelArchiveValidationError(487_170_055, '0'.repeat(64))).toContain('integrity')
    expect(modelArchiveValidationError(487_170_055, digest)).toBeNull()
  })
})
