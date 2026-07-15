import { globalShortcut } from 'electron'
import type { Settings } from '../shared/types'
import {
  QUICK_NOTE_ACCELERATOR,
  SIDEBAR_MODE_ACCELERATOR
} from '../shared/globalShortcuts'

export class GlobalShortcutManager {
  constructor(
    private showQuickNote: () => void,
    private toggleSidebar: () => void
  ) {}

  sync(settings: Settings): void {
    globalShortcut.unregister(QUICK_NOTE_ACCELERATOR)
    globalShortcut.unregister(SIDEBAR_MODE_ACCELERATOR)

    if (settings.quickNoteShortcutEnabled) {
      globalShortcut.register(QUICK_NOTE_ACCELERATOR, this.showQuickNote)
    }
    if (settings.sidebarModeEnabled) {
      globalShortcut.register(SIDEBAR_MODE_ACCELERATOR, this.toggleSidebar)
    }
  }

  destroy(): void {
    globalShortcut.unregister(QUICK_NOTE_ACCELERATOR)
    globalShortcut.unregister(SIDEBAR_MODE_ACCELERATOR)
  }
}
