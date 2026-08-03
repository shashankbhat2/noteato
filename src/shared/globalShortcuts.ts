export const SIDEBAR_MODE_ACCELERATOR = 'CommandOrControl+Alt+S'

/**
 * Start/stop a meeting recording. Matches the accelerator the removed Swift
 * agent registered, so anyone who had built the habit keeps it.
 */
export const MEETING_ACCELERATOR = 'CommandOrControl+Alt+Shift+Space'

export function shortcutDisplay(accelerator: string, platform: string): string {
  if (platform === 'darwin') {
    const parts = accelerator.split('+')
    const key = parts[parts.length - 1]
    return `${parts.includes('Control') ? '⌃' : ''}${parts.includes('Alt') ? '⌥' : ''}${parts.includes('Shift') ? '⇧' : ''}${parts.includes('CommandOrControl') ? '⌘' : ''}${key}`
  }
  return accelerator.replace('CommandOrControl', 'Ctrl').replaceAll('+', ' + ')
}
