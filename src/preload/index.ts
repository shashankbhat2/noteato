import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge, ipcRenderer } from 'electron'
import type { Note, SaveOptions, Settings, StickyNoteData } from '../shared/types'

const api = {
  notes: {
    list: () => ipcRenderer.invoke('notes:list'),
    read: (filename: string) => ipcRenderer.invoke('notes:read', filename),
    create: (title?: string) => ipcRenderer.invoke('notes:create', title),
    save: (filename: string, options: SaveOptions) => ipcRenderer.invoke('notes:save', filename, options),
    delete: (filename: string) => ipcRenderer.invoke('notes:delete', filename),
    getDir: () => ipcRenderer.invoke('notes:getDir'),
    chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('notes:chooseFolder'),
    import: (): Promise<Note[]> => ipcRenderer.invoke('notes:import')
  },
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    set: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:set', patch)
  },
  sticky: {
    list: (): Promise<StickyNoteData[]> => ipcRenderer.invoke('sticky:list'),
    create: (): Promise<StickyNoteData> => ipcRenderer.invoke('sticky:create'),
    update: (id: string, patch: Partial<StickyNoteData>) =>
      ipcRenderer.invoke('sticky:update', id, patch),
    close: (id: string) => ipcRenderer.invoke('sticky:close', id)
  },
  app: {
    closeWindow: () => ipcRenderer.invoke('app:closeWindow')
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

export type NoatApi = typeof api
