import type { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AiCompleteRequest,
  DeletedEntry,
  Note,
  NoteChange,
  NoteSummary,
  NotionImportResult,
  SaveOptions,
  ScratchChange,
  ScratchNote,
  ScratchSaveOptions,
  SearchResult,
  Settings,
  SidebarModeState,
  TrashEntry
} from '../shared/types'

export interface ContextMenuParams {
  x: number
  y: number
  misspelledWord: string
  dictionarySuggestions: string[]
  selectionText: string
  isEditable: boolean
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean }
}

interface NoteatoApi {
  images: {
    chooseLocal: () => Promise<{ name: string; url: string } | null>
    linkDropped: (file: File) => { name: string; url: string } | null
    resolveLocal: (fileUrl: string) => Promise<string>
  }
  notes: {
    list: () => Promise<NoteSummary[]>
    read: (id: string) => Promise<Note>
    create: (title?: string) => Promise<Note>
    save: (id: string, options: SaveOptions) => Promise<Note>
    setPinned: (id: string, pinned: boolean) => Promise<NoteSummary | null>
    setReminder: (id: string, reminderAt: string | null) => Promise<NoteSummary | null>
    delete: (id: string) => Promise<DeletedEntry>
    removeExternal: (id: string) => Promise<boolean>
    removeLinkedFolder: (rootPath: string) => Promise<boolean>
    restore: (
      trashName: string,
      originalPath: string,
      isFolder: boolean
    ) => Promise<NoteSummary | null>
    search: (query: string) => Promise<SearchResult[]>
    listTrash: () => Promise<TrashEntry[]>
    purgeTrash: (trashName: string) => Promise<void>
    emptyTrash: () => Promise<void>
    takeExternalOpens: () => Promise<Note[]>
    subscribeExternalOpen: (callback: (note: Note) => void) => () => void
    getDir: () => Promise<string>
    copyPath: (id: string) => Promise<string>
    revealInFinder: (id: string) => Promise<void>
    chooseFolder: () => Promise<string | null>
    import: () => Promise<Note[]>
    openFolder: () => Promise<NoteSummary[]>
    importNotion: () => Promise<NotionImportResult | null>
    subscribeChanged: (callback: (change: NoteChange) => void) => () => void
  }
  scratch: {
    list: () => Promise<ScratchNote[]>
    read: (id: string) => Promise<ScratchNote | null>
    create: () => Promise<ScratchNote>
    save: (id: string, options: ScratchSaveOptions) => Promise<ScratchNote | null>
    delete: (id: string) => Promise<boolean>
    setPinned: (id: string, pinned: boolean) => Promise<ScratchNote | null>
    setReminder: (id: string, reminderAt: string | null) => Promise<ScratchNote | null>
    subscribeChanged: (callback: (change: ScratchChange) => void) => () => void
    subscribeOpen: (callback: (id: string) => void) => () => void
  }
  settings: {
    get: () => Promise<Settings>
    set: (patch: Partial<Settings>) => Promise<Settings>
  }
  sidebar: {
    getState: () => Promise<SidebarModeState>
    show: () => Promise<void>
    close: () => Promise<void>
    setPinned: (pinned: boolean) => Promise<SidebarModeState>
    subscribeState: (callback: (state: SidebarModeState) => void) => () => void
  }
  reminders: {
    takeFired: () => Promise<NoteSummary[]>
    subscribeFired: (callback: (note: NoteSummary) => void) => () => void
    subscribeOpen: (callback: (note: NoteSummary) => void) => () => void
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
    getVersion: () => Promise<string>
    closeWindow: () => Promise<void>
    toggleMaximize: () => Promise<void>
    spellcheckerLanguages: () => Promise<string[]>
    onContextMenu: (callback: (params: ContextMenuParams) => void) => () => void
    replaceMisspelling: (word: string) => Promise<void>
    addToDictionary: (word: string) => Promise<void>
    lookUpSelection: () => Promise<void>
    searchGoogle: (text: string) => Promise<void>
    cut: () => Promise<void>
    copy: () => Promise<void>
    paste: () => Promise<void>
    openSettings: () => Promise<void>
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
