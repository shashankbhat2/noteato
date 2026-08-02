#!/usr/bin/env node
// Fetches the prebuilt sherpa-onnx offline WebSocket server and its shared
// libraries into resources/bin/, where extraResources picks them up.
//
// A prebuilt binary rather than a Node addon on purpose: it means no second
// native module to rebuild against Electron's ABI alongside better-sqlite3, and
// the ASR process can be spawned and reaped independently of the app.
//
// The model itself is not downloaded here — it is ~680 MB and belongs in
// userData at first use, not in the DMG.

import { execFileSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { copyFile, rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = '1.13.4'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const binDir = join(root, 'resources', 'bin')
const marker = join(binDir, `.sherpa-onnx-${VERSION}`)

// macOS ships as one universal2 archive covering both architectures.
const ARCHIVE = `sherpa-onnx-v${VERSION}-osx-universal2-shared.tar.bz2`
const URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/v${VERSION}/${ARCHIVE}`
const WANTED_BINARY = 'sherpa-onnx-offline-websocket-server'

if (process.platform !== 'darwin') {
  console.log('download-sherpa-onnx: not macOS, skipping')
  process.exit(0)
}

if (existsSync(marker) && !process.argv.includes('--force')) {
  console.log(`download-sherpa-onnx: v${VERSION} already present`)
  process.exit(0)
}

mkdirSync(binDir, { recursive: true })
const workDir = join(binDir, `.tmp-sherpa-${process.pid}`)
mkdirSync(workDir, { recursive: true })

/**
 * Upstream ships an invalid arm64 signature on libonnxruntime; dyld SIGKILLs an
 * unsigned or badly-signed load, so everything extracted here is re-signed
 * ad-hoc. Without this the server dies instantly with no useful diagnostic.
 */
function adhocSign(path) {
  try {
    execFileSync('codesign', ['--force', '--sign', '-', path], { stdio: 'pipe' })
  } catch (error) {
    console.warn(`download-sherpa-onnx: could not sign ${path}: ${error.message}`)
  }
}

try {
  console.log(`download-sherpa-onnx: fetching ${ARCHIVE}`)
  const response = await fetch(URL, { redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`${response.status} ${response.statusText}`)
  }
  const archivePath = join(workDir, ARCHIVE)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archivePath))

  execFileSync('tar', ['-xjf', archivePath, '-C', workDir], { stdio: 'inherit' })

  const extracted = readdirSync(workDir).find((name) => name.startsWith('sherpa-onnx-v'))
  if (!extracted) throw new Error('archive did not contain the expected directory')
  const extractedDir = join(workDir, extracted)

  const serverSource = join(extractedDir, 'bin', WANTED_BINARY)
  if (!existsSync(serverSource)) throw new Error(`${WANTED_BINARY} missing from the archive`)
  const serverDest = join(binDir, WANTED_BINARY)
  await copyFile(serverSource, serverDest)
  adhocSign(serverDest)

  const libDir = join(extractedDir, 'lib')
  let libCount = 0
  for (const name of readdirSync(libDir)) {
    if (!name.endsWith('.dylib')) continue
    const dest = join(binDir, name)
    await copyFile(join(libDir, name), dest)
    adhocSign(dest)
    libCount += 1
  }

  await pipeline(Readable.from([VERSION]), createWriteStream(marker))
  console.log(`download-sherpa-onnx: installed ${WANTED_BINARY} and ${libCount} libraries`)
} finally {
  rmSync(workDir, { recursive: true, force: true })
}

await rm(join(binDir, ARCHIVE), { force: true })
