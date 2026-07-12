function tomorrowMorning(): Date {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return d
}

function nextWeekMorning(): Date {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  d.setHours(9, 0, 0, 0)
  return d
}

export interface ReminderPreset {
  label: string
  at: () => string
}

export const REMINDER_PRESETS: ReminderPreset[] = [
  { label: 'In 1 hour', at: () => new Date(Date.now() + 60 * 60 * 1000).toISOString() },
  { label: 'Tomorrow, 9 AM', at: () => tomorrowMorning().toISOString() },
  { label: 'Next week', at: () => nextWeekMorning().toISOString() }
]

export function formatReminderAt(iso: string): string {
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}
