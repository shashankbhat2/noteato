export interface NoteTab {
  kind: 'note'
  /** The note's stable id (never changes, unlike filename which can be renamed). */
  id: string
  /** Filename at the time the tab was opened — used only to bootstrap the editor's initial read. */
  filename: string
  title: string
}

export interface SettingsTab {
  kind: 'settings'
  id: 'settings'
}

export type Tab = NoteTab | SettingsTab
