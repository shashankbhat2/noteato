import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export const MIC_FILE = 'audio.m4a'
export const SYSTEM_FILE = 'audio-system.m4a'

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
  micPath: string
  systemPath: string
}

export function createCaptureDir(vault: string, now = new Date()): CapturePaths {
  const dir = join(vault, captureDirName(now))
  mkdirSync(dir, { recursive: true })
  return {
    dir,
    micPath: join(dir, MIC_FILE),
    systemPath: join(dir, SYSTEM_FILE)
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
