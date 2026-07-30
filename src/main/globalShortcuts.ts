import { globalShortcut } from 'electron'
import type { Settings } from '../shared/types'
import { SIDEBAR_MODE_ACCELERATOR } from '../shared/globalShortcuts'

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
