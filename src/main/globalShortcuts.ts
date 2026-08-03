import { globalShortcut } from 'electron'
import type { Settings } from '../shared/types'
import { MEETING_ACCELERATOR, SIDEBAR_MODE_ACCELERATOR } from '../shared/globalShortcuts'

/**
 * Electron's registration of the product's global shortcuts.
 *
 * This used to stand down whenever NoteatoAgent was connected, since two
 * processes racing to register the same accelerator is a bug that only shows up
 * on someone else's machine. The agent is gone, so this is now the single
 * registrar unconditionally.
 */
export class GlobalShortcutManager {
  constructor(
    private toggleSidebar: () => void,
    private toggleMeeting: () => void
  ) {}

  sync(settings: Settings): void {
    globalShortcut.unregister(SIDEBAR_MODE_ACCELERATOR)
    if (settings.sidebarModeEnabled) {
      globalShortcut.register(SIDEBAR_MODE_ACCELERATOR, this.toggleSidebar)
    }

    // Unconditional: recording is the one thing you start from inside another
    // app, so it must not depend on a panel preference to be reachable.
    globalShortcut.unregister(MEETING_ACCELERATOR)
    globalShortcut.register(MEETING_ACCELERATOR, this.toggleMeeting)
  }

  destroy(): void {
    globalShortcut.unregister(SIDEBAR_MODE_ACCELERATOR)
    globalShortcut.unregister(MEETING_ACCELERATOR)
  }
}
