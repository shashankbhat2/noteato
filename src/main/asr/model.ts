import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync
} from 'node:fs'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
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
// Immutable metadata published by the upstream GitHub release. Checking both
// means a proxy, interrupted transfer, or poisoned cache is rejected before
// tar reports an opaque decompression failure.
const MODEL_ARCHIVE_BYTES = 487_170_055
const MODEL_ARCHIVE_SHA256 = '5793d0fd397c5778d2cf2126994d58e9d56b1be7c04d13c7a15bb1b4eafb16bf'
const DOWNLOAD_ATTEMPTS = 2

export const MODEL_ENGINE = 'sherpa-onnx/parakeet-tdt-0.6b-v3-int8'

const REQUIRED_FILES = [
  'encoder.int8.onnx',
  'decoder.int8.onnx',
  'joiner.int8.onnx',
  'tokens.txt'
]

/**
 * Locate the directory the release archive placed its model files in.
 *
 * This intentionally stays in Node instead of shelling out to `find`: the
 * previous command used GNU's `-maxdepth`, which macOS's BSD find rejects only
 * after the entire 680 MB archive has downloaded and unpacked.
 */
export function findRequiredModelDirectory(
  root: string,
  maxDepth = 4
): string | null {
  const visit = (directory: string, depth: number): string | null => {
    if (REQUIRED_FILES.every((name) => existsSync(join(directory, name)))) return directory
    if (depth >= maxDepth) return null

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const found = visit(join(directory, entry.name), depth + 1)
      if (found) return found
    }
    return null
  }

  return visit(root, 0)
}

export function modelArchiveValidationError(received: number, digest: string): string | null {
  if (received !== MODEL_ARCHIVE_BYTES) {
    return `incomplete speech model download (${received} of ${MODEL_ARCHIVE_BYTES} bytes)`
  }
  if (digest.toLowerCase() !== MODEL_ARCHIVE_SHA256) {
    return 'speech model download failed its integrity check'
  }
  return null
}

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

  inFlight = download(
    (received, total) => setStatus({ state: 'downloading', received, total }),
    (received, total) =>
      setStatus({ state: 'downloading', received, total, installing: true })
  )
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

async function download(
  onProgress?: (received: number, total: number) => void,
  onInstalling?: (received: number, total: number) => void
): Promise<void> {
  const parent = join(app.getPath('userData'), 'models')
  mkdirSync(parent, { recursive: true })

  // Staged outside the final directory so an interrupted download cannot leave
  // something that looks installed.
  const workDir = join(parent, `.tmp-${MODEL_NAME}`)
  rmSync(workDir, { recursive: true, force: true })
  mkdirSync(workDir, { recursive: true })
  const archivePath = join(workDir, 'model.tar.bz2')

  try {
    let received = 0
    let lastError: unknown
    for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
      rmSync(archivePath, { force: true })
      onProgress?.(0, MODEL_ARCHIVE_BYTES)
      try {
        received = await downloadVerifiedArchive(archivePath, onProgress)
        lastError = null
        break
      } catch (error) {
        lastError = error
        if (attempt === DOWNLOAD_ATTEMPTS) break
      }
    }
    if (lastError) {
      const message = lastError instanceof Error ? lastError.message : String(lastError)
      throw new Error(`${message}. The download was retried from a clean file.`)
    }

    onInstalling?.(received, MODEL_ARCHIVE_BYTES)
    await run('tar', ['-xjf', archivePath, '-C', workDir])

    // The archive unpacks into its own directory; find the complete model
    // rather than assuming a particular top-level archive name.
    const unpacked = findRequiredModelDirectory(workDir)
    if (!unpacked) throw new Error('model archive was missing required files')

    const target = modelDir()
    rmSync(target, { recursive: true, force: true })
    renameSync(unpacked, target)

    if (!isModelInstalled()) throw new Error('model archive was missing required files')
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

async function downloadVerifiedArchive(
  archivePath: string,
  onProgress?: (received: number, total: number) => void
): Promise<number> {
  const response = await fetch(MODEL_URL, {
    redirect: 'follow',
    cache: 'no-store',
    headers: {
      // The checksum describes the bytes in the release asset. Do not let an
      // intermediary transparently content-encode that byte stream.
      'Accept-Encoding': 'identity',
      'Cache-Control': 'no-cache'
    }
  })
  if (!response.ok || !response.body) {
    throw new Error(`model download failed: ${response.status} ${response.statusText}`)
  }

  const advertised = Number(response.headers.get('content-length')) || 0
  if (advertised && advertised !== MODEL_ARCHIVE_BYTES) {
    throw new Error(
      `speech model server returned an unexpected archive size (${advertised} bytes)`
    )
  }

  let received = 0
  const hash = createHash('sha256')
  const verifier = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length
      hash.update(chunk)
      onProgress?.(received, MODEL_ARCHIVE_BYTES)
      callback(null, chunk)
    }
  })
  // fetch's ReadableStream and Node's stream/web types are structurally
  // incompatible in TS despite interoperating fine at runtime.
  const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
  await pipeline(source, verifier, createWriteStream(archivePath))

  const validationError = modelArchiveValidationError(received, hash.digest('hex'))
  if (validationError) throw new Error(validationError)
  return received
}
