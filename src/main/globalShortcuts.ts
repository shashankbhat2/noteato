import { globalShortcut } from 'electron'
import type { Settings } from '../shared/types'
import { SIDEBAR_MODE_ACCELERATOR } from '../shared/globalShortcuts'

/**
 * Electron's registration of the sidebar accelerator.
 *
 * Ownership is exclusive at runtime: when NoteatoAgent is connected it is the
 * single registrar for every global shortcut in the product and this class
 * stands down. Two processes racing to register the same accelerator is a bug
 * that only shows up on someone else's machine.
 *
 * This exists at all so the library still works when the agent binary is
 * missing — a developer who has not built the Swift package should not find
 * their hotkeys gone. It goes away with the Electron capture path in Phase 3.
 */
export class GlobalShortcutManager {
  private agentOwnsShortcuts = false

  constructor(private toggleSidebar: () => void) {}

  /** Called when the agent connects or drops; re-syncs registration either way. */
  setAgentConnected(connected: boolean, settings: Settings): void {
    if (this.agentOwnsShortcuts === connected) return
    this.agentOwnsShortcuts = connected
    this.sync(settings)
  }

  sync(settings: Settings): void {
    globalShortcut.unregister(SIDEBAR_MODE_ACCELERATOR)
    if (this.agentOwnsShortcuts) return
    if (settings.sidebarModeEnabled) {
      globalShortcut.register(SIDEBAR_MODE_ACCELERATOR, this.toggleSidebar)
    }
  }

  destroy(): void {
    globalShortcut.unregister(SIDEBAR_MODE_ACCELERATOR)
  }
}
