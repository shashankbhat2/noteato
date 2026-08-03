#!/usr/bin/env node
// Compiles the macOS helper binaries into resources/bin/, where
// electron-builder's extraResources picks them up.
//
// These are single-file `swiftc` scripts, not a Swift package: they are dumb
// pipes Electron spawns, so they need no bundle, no Info.plist and no build
// system beyond one compiler invocation each.
//
// Ad-hoc signing is not optional. An unsigned binary is killed by the OS on
// first use of a TCC-guarded API, which for these means the microphone and
// ScreenCaptureKit — i.e. everything they do.

import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = join(root, 'native')
const outDir = join(root, 'resources', 'bin')

if (process.platform !== 'darwin') {
  console.log('build-native: not macOS, nothing to build')
  process.exit(0)
}

const sources = readdirSync(sourceDir).filter((name) => name.endsWith('.swift'))
if (sources.length === 0) {
  console.error('build-native: no .swift sources in native/')
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })

for (const source of sources) {
  const name = source.replace(/\.swift$/, '')
  const output = join(outDir, name)

  execFileSync(
    'swiftc',
    [
      '-O',
      // Matches electron-builder's macOS deployment floor; ScreenCaptureKit
      // audio capture needs 13.
      '-target',
      'arm64-apple-macos13.0',
      join(sourceDir, source),
      '-o',
      output
    ],
    { stdio: 'inherit' }
  )

  execFileSync('codesign', ['--force', '--sign', '-', output], { stdio: 'inherit' })
  console.log(`build-native: built ${name}`)
}
