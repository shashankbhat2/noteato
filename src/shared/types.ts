export interface NoteMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  tags: string[]
  fullWidth: boolean
}

export interface NoteSummary extends NoteMeta {
  filename: string
  excerpt: string
}

export interface Note extends NoteSummary {
  body: string
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

export type ThemeMode = 'light' | 'dark'
export type FontChoice = 'system' | 'serif' | 'mono' | 'rounded'
export type AiProvider = 'none' | 'anthropic' | 'openai'

export interface Settings {
  deepgramApiKey: string
  notesDir: string | null
  theme: ThemeMode
  fontFamily: FontChoice
  zenMode: boolean
  aiProvider: AiProvider
  aiModel: string
  anthropicApiKey: string
  openaiApiKey: string
  aiDictationPolish: boolean
  aiSelectionActions: boolean
  aiAskNote: boolean
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
}
