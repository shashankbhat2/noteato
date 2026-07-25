import { BrowserWindow, Notification } from 'electron'
import type { NoteSummary, ScratchChange, ScratchNote } from '../shared/types'
import type { NoteStore } from './storage'
import type { ScratchStore } from './scratchStore'

// setTimeout's delay is a signed 32-bit int under the hood; anything longer
// silently fires immediately in Node. Cap and re-arm for far-future reminders.
const MAX_TIMEOUT_MS = 2 ** 31 - 1

type ReminderTarget =
  | { kind: 'library'; note: NoteSummary }
  | { kind: 'scratch'; note: ScratchNote }

export class ReminderScheduler {
  private timers = new Map<string, NodeJS.Timeout>()
  // Library reminders that fired before the renderer was ready to receive them
  // (e.g. the reminder time passed while the app was closed) — delivered on
  // markReady(). Scratch notes need no catch-up: the sidebar reads the DB
  // fresh every time it lists.
  private pendingFired: NoteSummary[] = []
  private ready = false

  constructor(
    private noteStore: NoteStore,
    private scratchStore: ScratchStore,
    private getWindow: () => BrowserWindow | null,
    private openScratch: (note: ScratchNote) => void,
    private broadcastScratch: (change: ScratchChange) => void
  ) {}

  // Full rescan — used after operations that can shift many notes/paths at
  // once (folder move/rename/delete, changing the notes directory) where
  // recomputing the affected set precisely isn't worth the complexity.
  rebuildAll(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    for (const note of this.noteStore.list()) {
      if (note.reminderAt) this.schedule({ kind: 'library', note })
    }
    for (const note of this.scratchStore.list()) {
      if (note.reminderAt) this.schedule({ kind: 'scratch', note })
    }
  }

  // Targeted update for a single note whose id/path/reminderAt is already
  // known (returned directly from a save/move/setReminder call) — avoids a
  // full list() rescan on the autosave hot path.
  reschedule(note: NoteSummary): void {
    this.unschedule(note.id)
    if (note.reminderAt) this.schedule({ kind: 'library', note })
  }

  rescheduleScratch(note: ScratchNote): void {
    this.unschedule(note.id)
    if (note.reminderAt) this.schedule({ kind: 'scratch', note })
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

  private schedule(target: ReminderTarget): void {
    this.armTimer(target, new Date(target.note.reminderAt!).getTime() - Date.now())
  }

  private armTimer(target: ReminderTarget, remaining: number): void {
    const delay = Math.min(Math.max(remaining, 0), MAX_TIMEOUT_MS)
    const timer = setTimeout(() => {
      const stillRemaining = new Date(target.note.reminderAt!).getTime() - Date.now()
      if (stillRemaining > 0) this.armTimer(target, stillRemaining)
      else this.fire(target)
    }, delay)
    this.timers.set(target.note.id, timer)
  }

  private fire(target: ReminderTarget): void {
    this.timers.delete(target.note.id)
    if (target.kind === 'scratch') this.fireScratch(target.note)
    else this.fireLibrary(target.note)
  }

  private fireLibrary(note: NoteSummary): void {
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

  private fireScratch(note: ScratchNote): void {
    const cleared = this.scratchStore.setReminder(note.id, null)
    if (!cleared) return

    if (Notification.isSupported()) {
      const notification = new Notification({
        title: cleared.title || 'Untitled',
        body: 'Reminder'
      })
      notification.on('click', () => this.openScratch(cleared))
      notification.show()
    }

    this.broadcastScratch({ kind: 'upsert', note: cleared })
  }

  private openNote(note: NoteSummary): void {
    const win = this.getWindow()
    if (!win || win.isDestroyed()) return
    win.webContents.send('reminders:open', note)
    win.show()
    win.focus()
  }
}
