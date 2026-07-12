import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge, ipcRenderer } from 'electron'
import type {
  AiCompleteRequest,
  DeletedEntry,
  Note,
  NoteSummary,
  NotionImportResult,
  SaveOptions,
  SearchResult,
  Settings,
  StickyNoteData
} from '../shared/types'

let nextAiStreamRequestId = 0

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
      ipcRenderer.invoke('notes:importNotion')
  },
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    set: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:set', patch)
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
    toggleMaximize: () => ipcRenderer.invoke('app:toggleMaximize')
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
