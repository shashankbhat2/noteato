import { globalShortcut } from 'electron'
import type { Settings } from '../shared/types'
import { SIDEBAR_MODE_ACCELERATOR } from '../shared/globalShortcuts'

/**
 * Electron's registration of the product's global shortcuts.
 *
 * This used to stand down whenever NoteatoAgent was connected, since two
 * processes racing to register the same accelerator is a bug that only shows up
 * on someone else's machine. The agent is gone, so this is now the single
 * registrar unconditionally.
 */
export class GlobalShortcutManager {
  constructor(private toggleSidebar: () => void) {}

  sync(settings: Settings): void {
    globalShortcut.unregister(SIDEBAR_MODE_ACCELERATOR)
    if (settings.sidebarModeEnabled) {
      globalShortcut.register(SIDEBAR_MODE_ACCELERATOR, this.toggleSidebar)
    }
  }

  destroy(): void {
    globalShortcut.unregister(SIDEBAR_MODE_ACCELERATOR)
  }
}
