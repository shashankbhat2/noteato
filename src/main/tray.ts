import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { MEETING_ACCELERATOR, SIDEBAR_MODE_ACCELERATOR } from '../shared/globalShortcuts'

// A small render of the tray glyph, embedded inline so the tray works
// identically in dev and packaged builds without wiring a separate resource
// path through electron-builder's packaging config. Marked as a template
// image so macOS recolors it for light and dark menu bars.
const ICON_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAE0ElEQVR42uXbWahVVRgH8N85Xk1Ju5ZQkgWlkmRUZJEN0ERlRANlGNaDVg9FgwhFA0gWRLMV9FAJ9VAPBQ1QRAVZagMVJNWDCPpQhhUNFqZh3dLVw7fPdbu5w5nuOfec+4cN91zWXvv7/9da31rrW98qpZQmYCGOwQ7s1d0ooxeb8XoppbQYCW9id7utaxEm4XKUpJRWppQmpZRUnm5FnmPGeWWP6Pa7oVQq1VXpYKinvpFExZ7M5t3YUVbnmC/0lhLm4FRMbDfRGrC3XFSnWvI5HIQVWJM9K9AzQLlRgzzXnlpfLpA6Ao9jkegFcAvexac11jWggSONci2FCwYfhedxdY48TMWV9ZJvNaoWoGDwDDyLCwcpfi6mDVZPoa5jcT9uHNUC5DAVT2DBEGVmZ8T6yQ5A/HDch/dwL+a3Q4CqfEDO8PHCyS0a5pUpGaFPCu9XvnkZ7sEp2f/24uN2CDBsDygYv0Q4uWpwZiZYHjNE73kxRx6+w7pRKUAO87FS9fP8SWKWqOAcvIbbcGCh7AeZCC1fPA0pQK71p+GBAqHhcCROz/6+Dq/gtAHK9eFtsR9pOQYVoND1b8b5NdY9DldggthpHjZIuW/xZTvIDylADmfg1jrrv0D4gqdkDnEAfIOfac/eYUABcq0/GXfj0Drr7xWzxn+4QfiAPwplNmJPy5kPJUAOV+GiBr9xHh7Db1ic/V6Ot/ADtrWLPEgpLcuP99x+eXpKaUNqHtallJamlGanlMallMoppVnZd1oei8i+t6yn+M8cloqprFk4G2fhR3yFD7FeNv6LNrTKH/QLkCN/AG7HXfbf5DQDJbEYmoFLhD/YKBZB72fC7CzYM7JiVIZA9pRTSnenlPqa2PWrxZ8ppfUppeUppZmF8NVI8JZSWlZ0gguE1x9fR52NYooYIk+K3vCgWD/kDW76R/MCHCK6fW8byBcxU2yW3hEzRr9NzRahLJagJdwhWmA0YRZW4SUcNxIiVIKiC8UmZXSFcffZeCleFqvKpopQxjwRkZncbqbD4HisxonNrLQsVmdz282uSszFQyIq1ZReUBbHRJ2EBSIQ2xTUExNsN8q4VpxHjEkB4ASFoOtYE6AXJzejok4VgAiqNjxtd7IA82SHL40Mg04WYI6Bg6xjRoCJuElsouruBZ0sABGu6z+oqUeEThdgnNi+X1OvCJ0uADElrhIRpppF6AYBYDqewcW1itAtAhDHds+Jk+eqRegmASoirBY+oapFUrcJQJxBPiLWCWNSACJecPBYFmAbvh/LArwqzh3HpABfiNmgKnSbAH0icbOq1u9GAbbis8qPas4Uu02A9fipWvLdJsCveEGN2e/dIkCfWPx8XuuL3SDAvxn5p2WpdrXkE3SDAG+I06K+Wsl3gwBb8bAGrvx0sgDbRTTo60Yq6UQB9ojV3hKRfov684hqvjIzgtglbrDtko1n+xroH5FQtQUfieTqXxolPxoE2Im14tJEJWX2L+HZKwIkkWn6d/bsh0YzyNopwAaRfr9GtHBNaIR4PlTWI1ZOrfYFa8UdoS3NIlUnymWRrt5KbBKHGf3kS6VSS8gXUu0mobeMR4XzaQX6xLy9aSDDRvrJoXJ5enMppdSD63Enjjayw+F3sWTdrn0Zaftdn/8fCyjAIZVkzIYAAAAASUVORK5CYII='

export class TrayManager {
  private tray: Tray | null = null

  constructor(
    private showMainWindow: () => void,
    private showSidebar: () => void,
    private isSidebarEnabled: () => boolean,
    private onQuit: () => void,
    private isRecording: () => boolean,
    private onToggleMeeting: () => void
  ) {}

  setEnabled(enabled: boolean): void {
    if (enabled) {
      this.create()
      this.tray?.setContextMenu(this.buildMenu())
    } else this.destroy()
  }

  /**
   * Rebuild after meeting state changed. The menu is a snapshot taken when it
   * was built, so "Record meeting" would otherwise still say Record while a
   * recording is running.
   */
  refresh(): void {
    this.tray?.setContextMenu(this.buildMenu())
  }

  private create(): void {
    if (this.tray) return
    const appIconPath = app.isPackaged
      ? join(process.resourcesPath, 'icon.icns')
      : join(app.getAppPath(), 'build', 'icon.png')
    const source = existsSync(appIconPath)
      ? nativeImage.createFromPath(appIconPath)
      : nativeImage.createFromDataURL(`data:image/png;base64,${ICON_BASE64}`)
    const icon = source.resize({ width: 18, height: 18 })
    // Keep the actual Noteato mark instead of replacing it with a system
    // waveform glyph or letting macOS flatten the whole icon as a template.
    icon.setTemplateImage(false)
    this.tray = new Tray(icon)
    this.tray.setToolTip('Noteato')
    this.tray.setContextMenu(this.buildMenu())
  }

  private buildMenu(): Menu {
    return Menu.buildFromTemplate([
      {
        label: 'Show Noteato',
        click: () => this.showMainWindow()
      },
      { type: 'separator' },
      {
        label: this.isRecording() ? 'End meeting' : 'Record meeting',
        // Display-only hint, as below: GlobalShortcutManager owns the real
        // registration and a second handler here would fire it twice.
        accelerator: MEETING_ACCELERATOR,
        registerAccelerator: false,
        click: () => this.onToggleMeeting()
      },
      { type: 'separator' },
      ...(this.isSidebarEnabled()
        ? [
            {
              label: 'Show Sidebar',
              // Display-only hint — the global shortcut manager owns the real
              // registration, so this must not register a second handler.
              accelerator: SIDEBAR_MODE_ACCELERATOR,
              registerAccelerator: false,
              click: () => this.showSidebar()
            } as MenuItemConstructorOptions
          ]
        : []),
      { type: 'separator' },
      {
        label: 'Quit Noteato',
        click: () => {
          this.onQuit()
          // Drop the tray icon right away so quitting feels immediate even
          // if teardown takes a beat.
          this.destroy()
          app.quit()
        }
      }
    ])
  }

  private destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
