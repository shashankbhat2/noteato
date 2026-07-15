import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge, ipcRenderer } from 'electron'
import type {
  AiCompleteRequest,
  DeletedEntry,
  Note,
  NoteChange,
  NoteSummary,
  NotionImportResult,
  SaveOptions,
  SearchResult,
  Settings,
  SidebarModeState,
  StickyNoteData
} from '../shared/types'

let nextAiStreamRequestId = 0

/** Right-click details forwarded from the main process's context-menu event. */
export interface ContextMenuParams {
  x: number
  y: number
  misspelledWord: string
  dictionarySuggestions: string[]
  selectionText: string
  isEditable: boolean
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean }
}

const api = {
  notes: {
    list: () => ipcRenderer.invoke('notes:list'),
    listFolders: (): Promise<string[]> => ipcRenderer.invoke('notes:listFolders'),
    read: (path: string) => ipcRenderer.invoke('notes:read', path),
    create: (title?: string, folder?: string) => ipcRenderer.invoke('notes:create', title, folder),
    save: (path: string, options: SaveOptions) => ipcRenderer.invoke('notes:save', path, options),
    setPinned: (path: string, pinned: boolean): Promise<NoteSummary | null> =>
      ipcRenderer.invoke('notes:setPinned', path, pinned),
    setReminder: (path: string, reminderAt: string | null): Promise<NoteSummary | null> =>
      ipcRenderer.invoke('notes:setReminder', path, reminderAt),
    delete: (path: string): Promise<DeletedEntry> => ipcRenderer.invoke('notes:delete', path),
    removeExternal: (path: string): Promise<boolean> =>
      ipcRenderer.invoke('notes:removeExternal', path),
    restore: (
      trashName: string,
      originalPath: string,
      isFolder: boolean
    ): Promise<NoteSummary | null> =>
      ipcRenderer.invoke('notes:restore', trashName, originalPath, isFolder),
    createFolder: (path: string): Promise<void> => ipcRenderer.invoke('notes:createFolder', path),
    renameFolder: (path: string, newName: string): Promise<void> =>
      ipcRenderer.invoke('notes:renameFolder', path, newName),
    moveNote: (path: string, targetFolder: string): Promise<NoteSummary | null> =>
      ipcRenderer.invoke('notes:moveNote', path, targetFolder),
    moveFolder: (path: string, targetParent: string): Promise<void> =>
      ipcRenderer.invoke('notes:moveFolder', path, targetParent),
    deleteFolder: (path: string): Promise<DeletedEntry> =>
      ipcRenderer.invoke('notes:deleteFolder', path),
    search: (query: string): Promise<SearchResult[]> => ipcRenderer.invoke('notes:search', query),
    takeExternalOpens: (): Promise<Note[]> => ipcRenderer.invoke('notes:takeExternalOpens'),
    subscribeExternalOpen: (callback: (note: Note) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, note: Note): void => callback(note)
      ipcRenderer.on('notes:external-open', listener)
      return () => ipcRenderer.removeListener('notes:external-open', listener)
    },
    getDir: () => ipcRenderer.invoke('notes:getDir'),
    chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('notes:chooseFolder'),
    import: (): Promise<Note[]> => ipcRenderer.invoke('notes:import'),
    importNotion: (): Promise<NotionImportResult | null> =>
      ipcRenderer.invoke('notes:importNotion'),
    subscribeChanged: (callback: (change: NoteChange) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, change: NoteChange): void => callback(change)
      ipcRenderer.on('notes:changed', listener)
      return () => ipcRenderer.removeListener('notes:changed', listener)
    }
  },
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    set: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:set', patch)
  },
  sidebar: {
    getState: (): Promise<SidebarModeState> => ipcRenderer.invoke('sidebar:getState'),
    show: (): Promise<void> => ipcRenderer.invoke('sidebar:show'),
    close: (): Promise<void> => ipcRenderer.invoke('sidebar:close'),
    setPinned: (pinned: boolean): Promise<SidebarModeState> =>
      ipcRenderer.invoke('sidebar:setPinned', pinned),
    subscribeState: (callback: (state: SidebarModeState) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, state: SidebarModeState): void =>
        callback(state)
      ipcRenderer.on('sidebar:state-changed', listener)
      return () => ipcRenderer.removeListener('sidebar:state-changed', listener)
    }
  },
  quickNote: {
    close: (): Promise<void> => ipcRenderer.invoke('quickNote:close')
  },
  reminders: {
    takeFired: (): Promise<NoteSummary[]> => ipcRenderer.invoke('reminders:takeFired'),
    subscribeFired: (callback: (note: NoteSummary) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, note: NoteSummary): void => callback(note)
      ipcRenderer.on('reminders:fired', listener)
      return () => ipcRenderer.removeListener('reminders:fired', listener)
    },
    subscribeOpen: (callback: (note: NoteSummary) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, note: NoteSummary): void => callback(note)
      ipcRenderer.on('reminders:open', listener)
      return () => ipcRenderer.removeListener('reminders:open', listener)
    }
  },
  sticky: {
    list: (): Promise<StickyNoteData[]> => ipcRenderer.invoke('sticky:list'),
    create: (): Promise<StickyNoteData> => ipcRenderer.invoke('sticky:create'),
    update: (id: string, patch: Partial<StickyNoteData>) =>
      ipcRenderer.invoke('sticky:update', id, patch),
    close: (id: string) => ipcRenderer.invoke('sticky:close', id)
  },
  ai: {
    complete: (req: AiCompleteRequest): Promise<string> => ipcRenderer.invoke('ai:complete', req),
    stream: (
      req: AiCompleteRequest,
      onDelta: (delta: string) => void,
      registerCancel?: (cancel: () => void) => void
    ): Promise<string> => {
      const requestId = ++nextAiStreamRequestId
      const channel = `ai:stream:${requestId}`
      const listener = (_e: Electron.IpcRendererEvent, delta: string): void => onDelta(delta)
      ipcRenderer.on(channel, listener)
      // Cancelling resolves the stream promise with the partial output.
      registerCancel?.(() => void ipcRenderer.invoke('ai:stream:abort', requestId))
      return ipcRenderer
        .invoke('ai:stream', requestId, req)
        .finally(() => ipcRenderer.removeListener(channel, listener))
    }
  },
  app: {
    closeWindow: () => ipcRenderer.invoke('app:closeWindow'),
    toggleMaximize: () => ipcRenderer.invoke('app:toggleMaximize'),
    spellcheckerLanguages: (): Promise<string[]> =>
      ipcRenderer.invoke('app:spellcheckerLanguages'),
    onContextMenu: (callback: (params: ContextMenuParams) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, params: ContextMenuParams): void =>
        callback(params)
      ipcRenderer.on('app:context-menu', listener)
      return () => ipcRenderer.removeListener('app:context-menu', listener)
    },
    replaceMisspelling: (word: string): Promise<void> =>
      ipcRenderer.invoke('app:replaceMisspelling', word),
    addToDictionary: (word: string): Promise<void> =>
      ipcRenderer.invoke('app:addToDictionary', word),
    lookUpSelection: (): Promise<void> => ipcRenderer.invoke('app:lookUpSelection'),
    searchGoogle: (text: string): Promise<void> => ipcRenderer.invoke('app:searchGoogle', text),
    cut: (): Promise<void> => ipcRenderer.invoke('app:cut'),
    copy: (): Promise<void> => ipcRenderer.invoke('app:copy'),
    paste: (): Promise<void> => ipcRenderer.invoke('app:paste'),
    openSettings: (): Promise<void> => ipcRenderer.invoke('app:openSettings')
  },
  shortcuts: {
    subscribe: (callback: (action: string) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, action: string): void => callback(action)
      ipcRenderer.on('shortcut', listener)
      return () => ipcRenderer.removeListener('shortcut', listener)
    }
  }
}

contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('api', api)

export type NoteatoApi = typeof api
