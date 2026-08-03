import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** The one user-facing recording left in a completed meeting folder. */
export const AUDIO_FILE = 'audio.m4a'
/** Hidden working tracks, retained only until speaker-aware transcription ends. */
export const MIC_TEMP_FILE = '.audio-mic.m4a'
export const SYSTEM_TEMP_FILE = '.audio-system.m4a'
/** Read-only compatibility with captures created before audio was consolidated. */
export const LEGACY_SYSTEM_FILE = 'audio-system.m4a'

/**
 * A capture's own directory: an ISO-ish timestamp plus a short random suffix.
 *
 * This shape is not new — it is what the removed Swift CaptureWriter wrote, and
 * `storage.ts` already recognises it (`CAPTURE_DIR`, `isCaptureNote`) so the
 * library does not treat a capture folder as an ordinary note folder. Keeping
 * it means existing captures on disk stay readable and no migration is needed.
 */
export function captureDirName(now = new Date()): string {
  const stamp = now.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-')
  const suffix = Math.random().toString(36).slice(2, 6)
  return `${stamp}-${suffix}`
}

export interface CapturePaths {
  dir: string
  audioPath: string
  micPath: string
  systemPath: string
}

export function createCaptureDir(vault: string, now = new Date()): CapturePaths {
  const dir = join(vault, captureDirName(now))
  mkdirSync(dir, { recursive: true })
  return {
    dir,
    audioPath: join(dir, AUDIO_FILE),
    micPath: join(dir, MIC_TEMP_FILE),
    systemPath: join(dir, SYSTEM_TEMP_FILE)
  }
}

/** Speaker-separated inputs are implementation details, not meeting artifacts. */
export function removeCaptureInputs(dir: string): void {
  for (const name of [MIC_TEMP_FILE, SYSTEM_TEMP_FILE]) {
    try {
      rmSync(join(dir, name), { force: true })
    } catch {
      /* already gone */
    }
  }
}

/** Remove a failed/discarded recording while preserving a prepared note.md. */
export function removeCaptureAudio(dir: string): void {
  for (const name of [AUDIO_FILE, MIC_TEMP_FILE, SYSTEM_TEMP_FILE, LEGACY_SYSTEM_FILE]) {
    try {
      rmSync(join(dir, name), { force: true })
    } catch {
      /* already gone */
    }
  }
}

/** Discarding a recording takes the audio with it — that is what discard means. */
export function removeCaptureDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* already gone, or never created */
  }
}
