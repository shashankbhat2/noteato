import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron'

// A small render of the tray glyph, embedded inline so the tray works
// identically in dev and packaged builds without wiring a separate resource
// path through electron-builder's packaging config. Marked as a template
// image so macOS recolors it for light and dark menu bars.
const ICON_BASE64 =
  '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'

export class TrayManager {
  private tray: Tray | null = null

  constructor(
    private getWindow: () => BrowserWindow | null,
    private onQuit: () => void
  ) {}

  setEnabled(enabled: boolean): void {
    if (enabled) this.create()
    else this.destroy()
  }

  private create(): void {
    if (this.tray) return
    const icon = nativeImage
      .createFromDataURL(`data:image/png;base64,${ICON_BASE64}`)
      .resize({ width: 18, height: 18 })
    icon.setTemplateImage(true)
    this.tray = new Tray(icon)
    this.tray.setToolTip('Noteato')
    this.tray.setContextMenu(this.buildMenu())
  }

  private buildMenu(): Menu {
    return Menu.buildFromTemplate([
      {
        label: 'Show Noteato',
        click: () => {
          const win = this.getWindow()
          if (!win || win.isDestroyed()) return
          win.show()
          win.focus()
        }
      },
      { type: 'separator' },
      {
        label: 'Quit Noteato',
        click: () => {
          this.onQuit()
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
