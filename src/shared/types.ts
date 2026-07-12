export interface NoteMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  tags: string[]
  fullWidth: boolean
  pinned: boolean
  /** ISO timestamp for a pending one-shot reminder, or null if none is set. */
  reminderAt: string | null
}

export interface NoteSummary extends NoteMeta {
  /** Relative POSIX path under the notes dir, e.g. "Work/projects/launch.md". */
  path: string
  /** Parent folder as a relative POSIX path ("" for the root). */
  folder: string
  excerpt: string
  /** True when the note is linked from outside the managed notes directory. */
  external?: boolean
}

export interface Note extends NoteSummary {
  body: string
}

// A trashed note or folder, kept so a delete can be undone.
export interface DeletedEntry {
  trashName: string
  originalPath: string
  isFolder: boolean
}

export interface NotionImportResult {
  created: NoteSummary[]
  /** Relative source paths (within the chosen export folder) that failed to import. */
  skipped: string[]
}

export interface SearchResult {
  id: string
  path: string
  title: string
  folder: string
  snippet: string
}

export interface StickyNoteData {
  id: string
  x: number
  y: number
  width: number
  height: number
  content: string
  color: string
}

export type ThemeMode = 'light' | 'dark' | 'system'
export type FontChoice = 'system' | 'serif' | 'mono' | 'rounded'
export type AccentChoice = 'ember' | 'ocean' | 'forest' | 'violet' | 'rose' | 'amber'
export type AiProvider = 'none' | 'anthropic' | 'openai'

export interface Settings {
  deepgramApiKey: string
  notesDir: string | null
  theme: ThemeMode
  fontFamily: FontChoice
  accent: AccentChoice
  zenMode: boolean
  aiProvider: AiProvider
  aiModel: string
  anthropicApiKey: string
  openaiApiKey: string
  aiSelectionActions: boolean
  aiAgentEnabled: boolean
  /** Keep running in the menu bar after closing/quitting, so reminders can still fire. */
  keepInMenuBar: boolean
}

export interface SaveOptions {
  title: string
  body: string
  tags?: string[]
  fullWidth?: boolean
}

export interface AiCompleteRequest {
  system: string
  prompt: string
  maxTokens?: number
  model?: string
  provider?: Exclude<AiProvider, 'none'>
}
