export const QUICK_NOTE_ACCELERATOR = 'CommandOrControl+Alt+N'
export const SIDEBAR_MODE_ACCELERATOR = 'CommandOrControl+Alt+S'

export function shortcutDisplay(accelerator: string, platform: string): string {
  if (platform === 'darwin') {
    const parts = accelerator.split('+')
    const key = parts[parts.length - 1]
    return `${parts.includes('Control') ? '⌃' : ''}${parts.includes('Alt') ? '⌥' : ''}${parts.includes('Shift') ? '⇧' : ''}${parts.includes('CommandOrControl') ? '⌘' : ''}${key}`
  }
  return accelerator.replace('CommandOrControl', 'Ctrl').replaceAll('+', ' + ')
}
