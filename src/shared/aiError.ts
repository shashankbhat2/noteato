/** Keep provider/API detail while removing Electron's IPC wrapper noise. */
export function aiErrorMessage(
  error: unknown,
  fallback = 'The AI provider did not complete that request.'
): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const cleaned = raw
    .replace(/^Error invoking remote method ['"]ai:[^'"]+['"]:\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
  return cleaned || fallback
}
