import type { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AiCompleteRequest,
  DeletedEntry,
  Note,
  NoteSummary,
  SaveOptions,
  SearchResult,
  Settings,
  StickyNoteData
} from '../shared/types'

interface NoteatoApi {
  notes: {
    list: () => Promise<NoteSummary[]>
    listFolders: () => Promise<string[]>
    read: (path: string) => Promise<Note>
    create: (title?: string, folder?: string) => Promise<Note>
    save: (path: string, options: SaveOptions) => Promise<Note>
    setPinned: (path: string, pinned: boolean) => Promise<NoteSummary | null>
    delete: (path: string) => Promise<DeletedEntry>
    restore: (
      trashName: string,
      originalPath: string,
      isFolder: boolean
    ) => Promise<NoteSummary | null>
    createFolder: (path: string) => Promise<void>
    renameFolder: (path: string, newName: string) => Promise<void>
    moveNote: (path: string, targetFolder: string) => Promise<NoteSummary | null>
    moveFolder: (path: string, targetParent: string) => Promise<void>
    deleteFolder: (path: string) => Promise<DeletedEntry>
    search: (query: string) => Promise<SearchResult[]>
    takeExternalOpens: () => Promise<Note[]>
    subscribeExternalOpen: (callback: (note: Note) => void) => () => void
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
  ai: {
    complete: (req: AiCompleteRequest) => Promise<string>
    stream: (
      req: AiCompleteRequest,
      onDelta: (delta: string) => void,
      registerCancel?: (cancel: () => void) => void
    ) => Promise<string>
  }
  app: {
    closeWindow: () => Promise<void>
    toggleMaximize: () => Promise<void>
  }
  shortcuts: {
    subscribe: (callback: (action: string) => void) => () => void
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: NoteatoApi
  }
}
