import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Enough of the `electron` module for main-process code to be imported under
 * Vitest. Anything a test actually depends on should be asserted through the
 * module under test, not through this stub — if a test needs more than a path
 * here, it probably wants an integration test instead.
 */
export const app = {
  getPath: (name: string): string => join(tmpdir(), 'noteato-test', name),
  getLocale: (): string => 'en-GB'
}
