import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron'

// A small render of the tray glyph, embedded inline so the tray works
// identically in dev and packaged builds without wiring a separate resource
// path through electron-builder's packaging config. Marked as a template
// image so macOS recolors it for light and dark menu bars.
const ICON_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAAeGVYSWZNTQAqAAAACAAEARoABQAAAAEAAAA+ARsABQAAAAEAAABGASgAAwAAAAEAAgAAh2kABAAAAAEAAABOAAAAAAAAAEgAAAABAAAASAAAAAEAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAQKADAAQAAAABAAAAQAAAAAB13naHAAAACXBIWXMAAAsTAAALEwEAmpwYAAABWWlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iWE1QIENvcmUgNi4wLjAiPgogICA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPgogICAgICA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIgogICAgICAgICAgICB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iPgogICAgICAgICA8eG1wOkNyZWF0b3JUb29sPkZpZ21hPC94bXA6Q3JlYXRvclRvb2w+CiAgICAgIDwvcmRmOkRlc2NyaXB0aW9uPgogICA8L3JkZjpSREY+CjwveDp4bXBtZXRhPgoE/1zIAAAENElEQVR4Ae2bT2gTQRTGN80/m1ioVqqiKCiIkB6UVrAg3rz04knwJHhQetGborU3aw8eBT1UBMWLiIJ4sFUQLxbEWqESStqerFq0CiLFoLVJ/L01STdhU3Y2Zplm98HXmZ19M/O+b2Znp5tdw8hbLpfrBsOg0U04dhd4ByRDQR/JAJgF30Aj2ybI7QD9gUBgUMh35of8EmkMBBocwlG4inWJACPgPQg18rBbuQnXPOenIoDYa6uDF/JwHhPiTXmyTeTN9cAj5IWrybcggBd423L0BbCVxUOF/gzw0GDbUvVngK0sHip0tftjz7AVjQ4DmUFyP5XUCmtZkHOj7LsnSEuMdmRf3gX2g92gDUTBHzAxPj5+ubm5uS2RSHzmuDZGEGJvgLkxcNILvkelkoJdtLZLvX1gCMyt0EaSc+Gpqaknk5OTR6z1q83Trvy/I5yLO0HVNjOKFbLiT3/rwVWyo+AUkJlUyX5xQvrZxix4iBA9lRyrKde1CC5CfAuBDoNzIKYQ9GIwGGwJh8P3U6nUMYV6jlx1CbCXaB6DQ46iKnNaWloympiYiEcikbuIcLLsdFWHugSQ6X6gmkgzmYyIEEWEm9PT02eqacta15UA9hLNY3DIUVRlTkVERDgTMi1FEsBhw+v8fnASYWq4A1IqQmVdCWAv0TwGh1RihLKnMBcuXAgODw9fA/LcqLq5EsBpPFa/nBxw+yyJkVlgyCURjUYHZ2ZmrlgreOn8Sf9dnkX2ZbxdDXORwPUuLq4hUwWpltJEuS8vJvIRELKvV14/6BJ7VjEDpJi1ZjyxjKY6z1XeOc0LKGGf1a6uV8t9XVVgXQKoxqXN3xdAk9T+DNAktHI3/iWgLFmDVdA1A/w1oM4mjq4ZUK/8zfd63AQn7/2o2DoV57yvah3VmMxu3P4w8oHa9xRIyQNOlae88hD1Adis0McnBd9lV36JEVN6SWq59trMwbfql6TWJnObqP1F0EYUTxX5M8BTw21D1p8BNqJ4qqgwA3L8dl+Xz+xqMRp5rvKc0twKPyNtZ3PgdldYixhr2maeq+wyzQ8nuygQ8+Kns53mK6yQ70ONATALvPXxNIRNQwT5fF6+I250K/l8/i8AVtLP3TsobQAAAABJRU5ErkJggg=='

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
