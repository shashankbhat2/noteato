import { execFile } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'

const run = promisify(execFile)

/**
 * Builds up to 1.2.x shipped NoteatoAgent.app as a login item. It registered
 * the Fn tap and its own menu-bar icon, so an upgrade that merely replaces
 * Noteato.app leaves a helper running that this process cannot talk to and the
 * user cannot explain: a second icon, and a dead Fn key.
 *
 * Best-effort by design — every failure here means "there was nothing to clean
 * up", which is the normal case on a fresh install.
 */
export async function removeStaleAgent(): Promise<void> {
  if (process.platform !== 'darwin') return

  // -f matches the full argv, so this cannot catch Noteato.app itself.
  try {
    await run('/usr/bin/pkill', ['-f', 'NoteatoAgent.app/Contents/MacOS/NoteatoAgent'])
  } catch {
    /* no such process */
  }

  // The agent wrote its socket to a capitalised "Noteato" directory while
  // Electron's userData is lowercase "noteato". On a default case-insensitive
  // APFS volume those are the same directory as settings.json and noteato.db,
  // so this must stay a targeted unlink of the socket and never a directory
  // remove — on a case-sensitive volume it is a separate, near-empty directory
  // and the same call is still correct.
  try {
    await rm(join(app.getPath('appData'), 'Noteato', 'agent.sock'), { force: true })
  } catch {
    /* never existed */
  }
}
