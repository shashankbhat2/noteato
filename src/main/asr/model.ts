import { execFile } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { app } from 'electron'
import type { ModelStatus } from '../../shared/types'

const run = promisify(execFile)

/**
 * Parakeet TDT v3 — the same model the removed Swift agent ran through
 * FluidAudio, so transcription quality is unchanged by the migration.
 *
 * Offline (batch) rather than streaming, which suits meetings: there is no
 * latency requirement once the recording has stopped, and an offline model sees
 * the whole utterance rather than a 560 ms window.
 */
const MODEL_NAME = 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8'
const MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL_NAME}.tar.bz2`

export const MODEL_ENGINE = 'sherpa-onnx/parakeet-tdt-0.6b-v3-int8'

const REQUIRED_FILES = [
  'encoder.int8.onnx',
  'decoder.int8.onnx',
  'joiner.int8.onnx',
  'tokens.txt'
]

export interface ModelPaths {
  dir: string
  tokens: string
  encoder: string
  decoder: string
  joiner: string
}

export function modelDir(): string {
  return join(app.getPath('userData'), 'models', MODEL_NAME)
}

export function modelPaths(): ModelPaths {
  const dir = modelDir()
  return {
    dir,
    tokens: join(dir, 'tokens.txt'),
    encoder: join(dir, 'encoder.int8.onnx'),
    decoder: join(dir, 'decoder.int8.onnx'),
    joiner: join(dir, 'joiner.int8.onnx')
  }
}

/** Every required file present — a half-finished download must not count. */
export function isModelInstalled(): boolean {
  const dir = modelDir()
  return REQUIRED_FILES.every((name) => existsSync(join(dir, name)))
}

let inFlight: Promise<void> | null = null

/**
 * Last known status. Held here rather than derived on demand because a
 * download's progress and a failure's message exist nowhere on disk — an
 * interrupted download leaves the staging directory behind and nothing else.
 */
let status: ModelStatus | null = null
const listeners = new Set<(status: ModelStatus) => void>()

export function getModelStatus(): ModelStatus {
  // Resolved lazily so the first caller reflects a model installed by an
  // earlier run, and re-checked while absent in case one appeared since.
  if (!status || status.state === 'absent') {
    status = isModelInstalled() ? { state: 'installed' } : { state: 'absent' }
  }
  return status
}

export function onModelStatus(listener: (status: ModelStatus) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function setStatus(next: ModelStatus): void {
  status = next
  for (const listener of listeners) listener(next)
}

/**
 * Fetch and unpack the model into userData.
 *
 * Concurrent callers share one download: the tray, a note's button and a queued
 * transcription can all arrive at once, and three parallel 680 MB downloads
 * into the same directory would corrupt each other.
 */
export function ensureModel(): Promise<void> {
  if (isModelInstalled()) {
    setStatus({ state: 'installed' })
    return Promise.resolve()
  }
  if (inFlight) return inFlight

  // Announced before the first byte arrives: the request can take a moment to
  // open, and a toggle that appears to do nothing reads as broken.
  setStatus({ state: 'downloading', received: 0, total: 0 })

  inFlight = download((received, total) => setStatus({ state: 'downloading', received, total }))
    .then(() => {
      setStatus({ state: 'installed' })
    })
    .catch((error: unknown) => {
      setStatus({
        state: 'failed',
        message: error instanceof Error ? error.message : String(error)
      })
      throw error
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

async function download(onProgress?: (received: number, total: number) => void): Promise<void> {
  const parent = join(app.getPath('userData'), 'models')
  mkdirSync(parent, { recursive: true })

  // Staged outside the final directory so an interrupted download cannot leave
  // something that looks installed.
  const workDir = join(parent, `.tmp-${MODEL_NAME}`)
  rmSync(workDir, { recursive: true, force: true })
  mkdirSync(workDir, { recursive: true })
  const archivePath = join(workDir, 'model.tar.bz2')

  try {
    const response = await fetch(MODEL_URL, { redirect: 'follow' })
    if (!response.ok || !response.body) {
      throw new Error(`model download failed: ${response.status} ${response.statusText}`)
    }

    const total = Number(response.headers.get('content-length')) || 0
    let received = 0
    // fetch's ReadableStream and Node's stream/web types are structurally
    // incompatible in TS despite interoperating fine at runtime.
    const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
    if (onProgress) {
      source.on('data', (chunk: Buffer) => {
        received += chunk.length
        onProgress(received, total)
      })
    }
    await pipeline(source, createWriteStream(archivePath))

    await run('tar', ['-xjf', archivePath, '-C', workDir])

    // The archive unpacks into its own directory; find it rather than assuming.
    const { stdout } = await run('/bin/sh', [
      '-c',
      `find ${JSON.stringify(workDir)} -name tokens.txt -maxdepth 3 | head -1`
    ])
    const tokens = stdout.trim()
    if (!tokens) throw new Error('model archive did not contain tokens.txt')

    const unpacked = join(tokens, '..')
    const target = modelDir()
    rmSync(target, { recursive: true, force: true })
    await run('/bin/mv', [unpacked, target])

    if (!isModelInstalled()) throw new Error('model archive was missing required files')
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}
