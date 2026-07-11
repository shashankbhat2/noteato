export interface NoteMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  tags: string[]
  fullWidth: boolean
  pinned: boolean
}

export interface NoteSummary extends NoteMeta {
  /** Relative POSIX path under the notes dir, e.g. "Work/projects/launch.md". */
  path: string
  /** Parent folder as a relative POSIX path ("" for the root). */
  folder: string
  excerpt: string
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
