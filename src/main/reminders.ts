import { BrowserWindow, Notification } from 'electron'
import type { NoteSummary } from '../shared/types'
import type { NoteStore } from './storage'

// setTimeout's delay is a signed 32-bit int under the hood; anything longer
// silently fires immediately in Node. Cap and re-arm for far-future reminders.
const MAX_TIMEOUT_MS = 2 ** 31 - 1

export class ReminderScheduler {
  private timers = new Map<string, NodeJS.Timeout>()
  // Reminders that fired before the renderer was ready to receive them (e.g.
  // the reminder time passed while the app was closed) — delivered on markReady().
  private pendingFired: NoteSummary[] = []
  private ready = false

  constructor(
    private noteStore: NoteStore,
    private getWindow: () => BrowserWindow | null
  ) {}

  // Full rescan — used after operations that can shift many notes/paths at
  // once (folder move/rename/delete, changing the notes directory) where
  // recomputing the affected set precisely isn't worth the complexity.
  rebuildAll(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    for (const note of this.noteStore.list()) {
      if (note.reminderAt) this.schedule(note)
    }
  }

  // Targeted update for a single note whose id/path/reminderAt is already
  // known (returned directly from a save/move/setReminder call) — avoids a
  // full list() rescan on the autosave hot path.
  reschedule(note: NoteSummary): void {
    this.unschedule(note.id)
    if (note.reminderAt) this.schedule(note)
  }

  unschedule(id: string): void {
    const timer = this.timers.get(id)
    if (timer) clearTimeout(timer)
    this.timers.delete(id)
  }

  // Called once the renderer has mounted and subscribed; returns (and clears)
  // any reminders that fired before that point so they can be shown as a
  // catch-up instead of being silently dropped.
  markReady(): NoteSummary[] {
    this.ready = true
    return this.pendingFired.splice(0)
  }

  private schedule(note: NoteSummary): void {
    this.armTimer(note, new Date(note.reminderAt!).getTime() - Date.now())
  }

  private armTimer(note: NoteSummary, remaining: number): void {
    const delay = Math.min(Math.max(remaining, 0), MAX_TIMEOUT_MS)
    const timer = setTimeout(() => {
      const stillRemaining = new Date(note.reminderAt!).getTime() - Date.now()
      if (stillRemaining > 0) this.armTimer(note, stillRemaining)
      else this.fire(note)
    }, delay)
    this.timers.set(note.id, timer)
  }

  private fire(note: NoteSummary): void {
    this.timers.delete(note.id)

    let cleared: NoteSummary | null
    try {
      cleared = this.noteStore.setReminder(note.path, null)
    } catch {
      cleared = null
    }
    // The note vanished (deleted/moved without a matching reschedule) —
    // nothing sensible to notify about.
    if (!cleared) return

    if (Notification.isSupported()) {
      const notification = new Notification({
        title: cleared.title || 'Untitled',
        body: 'Reminder'
      })
      notification.on('click', () => this.openNote(cleared!))
      notification.show()
    }

    if (this.ready) {
      // The main editor and compact sidebar are separate renderer windows.
      // Keep both reminder lists live; windows that do not subscribe simply
      // ignore the event.
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('reminders:fired', cleared)
      }
    } else {
      this.pendingFired.push(cleared)
    }
  }

  private openNote(note: NoteSummary): void {
    const win = this.getWindow()
    if (!win || win.isDestroyed()) return
    win.webContents.send('reminders:open', note)
    win.show()
    win.focus()
  }
}
