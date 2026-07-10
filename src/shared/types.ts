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

export interface Settings {
  deepgramApiKey: string
  notesDir: string | null
  theme: ThemeMode
  fontFamily: FontChoice
}

export interface SaveOptions {
  title: string
  body: string
  tags?: string[]
  fullWidth?: boolean
}
