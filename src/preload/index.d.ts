import type { ElectronAPI } from '@electron-toolkit/preload'
import type { Note, NoteSummary, SaveOptions, Settings, StickyNoteData } from '../shared/types'

interface NoatApi {
  notes: {
    list: () => Promise<NoteSummary[]>
    read: (filename: string) => Promise<Note>
    create: (title?: string) => Promise<Note>
    save: (filename: string, options: SaveOptions) => Promise<Note>
    delete: (filename: string) => Promise<void>
    getDir: () => Promise<string>
    chooseFolder: () => Promise<string | null>
    import: () => Promise<Note[]>
  }
  settings: {
    get: () => Promise<Settings>
    set: (patch: Partial<Settings>) => Promise<Settings>
  }
  sticky: {
    list: () => Promise<StickyNoteData[]>
    create: () => Promise<StickyNoteData>
    update: (id: string, patch: Partial<StickyNoteData>) => Promise<void>
    close: (id: string) => Promise<void>
  }
  app: {
    closeWindow: () => Promise<void>
  }
  shortcuts: {
    subscribe: (callback: (action: string) => void) => () => void
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: NoatApi
  }
}
