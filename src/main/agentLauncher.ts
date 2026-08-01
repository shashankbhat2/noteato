import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

/**
 * Starts the bundled NoteatoAgent if it isn't already running.
 *
 * **This is a bridge, not the design.** The agent is meant to be resident and
 * independent — registered as a login item so it survives the library being
 * closed, which is the whole point of §2. That registration wants a signed
 * bundle to be meaningful, so it is sequenced with the signing track. Until
 * then, launching from here is what makes a packaged build usable at all:
 * otherwise the agent sits in Contents/Resources and nothing ever runs it.
 *
 * The consequence to be aware of: an agent started this way is a child of the
 * library, so quitting Noteato takes it down. That inverts the intended
 * relationship, and it is why this is temporary rather than the answer.
 */
export function agentBinaryPath(): string | null {
  // Packaged: Noteato.app/Contents/Resources/NoteatoAgent
  const packaged = join(process.resourcesPath ?? '', 'NoteatoAgent')
  if (existsSync(packaged)) return packaged

  // Development: whatever `npm run build:agent` produced.
  const dev = join(app.getAppPath(), 'resources', 'NoteatoAgent')
  return existsSync(dev) ? dev : null
}

/**
 * Launch the agent, detached, if `alreadyRunning` is false.
 *
 * Detached so that it at least outlives an Electron crash, even though a clean
 * quit still ends it. Returns whether a launch was attempted.
 */
export function launchAgentIfNeeded(alreadyRunning: boolean): boolean {
  if (alreadyRunning) return false
  const binary = agentBinaryPath()
  if (!binary) return false

  try {
    const child = spawn(binary, [], {
      detached: true,
      stdio: 'ignore'
    })
    // Let the parent exit without waiting on it.
    child.unref()
    return true
  } catch {
    // An agent that will not start is not a reason for the library to fail to
    // open — the app works without it, just without global capture.
    return false
  }
}
