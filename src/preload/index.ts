import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  AiCompleteRequest,
  DeletedEntry,
  MeetingError,
  MeetingLevels,
  MeetingState,
  Note,
  NoteRecording,
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
import type { MeetingTranscript } from '../shared/meetingTranscript'
import type { MeetingNotesState, MeetingNotesTemplateId } from '../shared/meetingNotes'

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
  images: {
    chooseLocal: (): Promise<{ name: string; url: string } | null> =>
      ipcRenderer.invoke('images:chooseLocal'),
    linkDropped: (file: File): { name: string; url: string } | null => {
      const filePath = webUtils.getPathForFile(file)
      return filePath ? { name: basename(filePath), url: pathToFileURL(filePath).href } : null
    },
    resolveLocal: (fileUrl: string): Promise<string> =>
      ipcRenderer.invoke('images:resolveLocal', fileUrl)
  },
  notes: {
    list: () => ipcRenderer.invoke('notes:list'),
    read: (id: string) => ipcRenderer.invoke('notes:read', id),
    create: (title?: string) => ipcRenderer.invoke('notes:create', title),
    save: (id: string, options: SaveOptions) => ipcRenderer.invoke('notes:save', id, options),
    setPinned: (id: string, pinned: boolean): Promise<NoteSummary | null> =>
      ipcRenderer.invoke('notes:setPinned', id, pinned),
    setReminder: (id: string, reminderAt: string | null): Promise<NoteSummary | null> =>
      ipcRenderer.invoke('notes:setReminder', id, reminderAt),
    delete: (id: string): Promise<DeletedEntry> => ipcRenderer.invoke('notes:delete', id),
    removeExternal: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('notes:removeExternal', id),
    /** Folders have no id — they are unlinked by path. */
    removeLinkedFolder: (rootPath: string): Promise<boolean> =>
      ipcRenderer.invoke('notes:removeLinkedFolder', rootPath),
    restore: (
      trashName: string,
      originalPath: string,
      isFolder: boolean
    ): Promise<NoteSummary | null> =>
      ipcRenderer.invoke('notes:restore', trashName, originalPath, isFolder),
    search: (query: string): Promise<SearchResult[]> => ipcRenderer.invoke('notes:search', query),
    listTrash: (): Promise<TrashEntry[]> => ipcRenderer.invoke('notes:listTrash'),
    purgeTrash: (trashName: string): Promise<void> =>
      ipcRenderer.invoke('notes:purgeTrash', trashName),
    emptyTrash: (): Promise<void> => ipcRenderer.invoke('notes:emptyTrash'),
    takeExternalOpens: (): Promise<Note[]> => ipcRenderer.invoke('notes:takeExternalOpens'),
    subscribeExternalOpen: (callback: (note: Note) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, note: Note): void => callback(note)
      ipcRenderer.on('notes:external-open', listener)
      return () => ipcRenderer.removeListener('notes:external-open', listener)
    },
    getDir: () => ipcRenderer.invoke('notes:getDir'),
    copyPath: (id: string): Promise<string> => ipcRenderer.invoke('notes:copyPath', id),
    revealInFinder: (id: string): Promise<void> =>
      ipcRenderer.invoke('notes:revealInFinder', id),
    chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('notes:chooseFolder'),
    import: (): Promise<Note[]> => ipcRenderer.invoke('notes:import'),
    openFolder: (): Promise<NoteSummary[]> => ipcRenderer.invoke('notes:openFolder'),
    importNotion: (): Promise<NotionImportResult | null> =>
      ipcRenderer.invoke('notes:importNotion'),
    subscribeChanged: (callback: (change: NoteChange) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, change: NoteChange): void => callback(change)
      ipcRenderer.on('notes:changed', listener)
      return () => ipcRenderer.removeListener('notes:changed', listener)
    }
  },
  scratch: {
    list: (): Promise<ScratchNote[]> => ipcRenderer.invoke('scratch:list'),
    read: (id: string): Promise<ScratchNote | null> => ipcRenderer.invoke('scratch:read', id),
    create: (): Promise<ScratchNote> => ipcRenderer.invoke('scratch:create'),
    save: (id: string, options: ScratchSaveOptions): Promise<ScratchNote | null> =>
      ipcRenderer.invoke('scratch:save', id, options),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke('scratch:delete', id),
    setPinned: (id: string, pinned: boolean): Promise<ScratchNote | null> =>
      ipcRenderer.invoke('scratch:setPinned', id, pinned),
    setReminder: (id: string, reminderAt: string | null): Promise<ScratchNote | null> =>
      ipcRenderer.invoke('scratch:setReminder', id, reminderAt),
    subscribeChanged: (callback: (change: ScratchChange) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, change: ScratchChange): void =>
        callback(change)
      ipcRenderer.on('scratch:changed', listener)
      return () => ipcRenderer.removeListener('scratch:changed', listener)
    },
    subscribeOpen: (callback: (id: string) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, id: string): void => callback(id)
      ipcRenderer.on('scratch:open', listener)
      return () => ipcRenderer.removeListener('scratch:open', listener)
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
  meeting: {
    getState: (): Promise<MeetingState> => ipcRenderer.invoke('meeting:getState'),
    getRecording: (noteId: string): Promise<NoteRecording | null> =>
      ipcRenderer.invoke('meeting:getRecording', noteId),
    getTranscript: (noteId: string): Promise<MeetingTranscript | null> =>
      ipcRenderer.invoke('meeting:getTranscript', noteId),
    saveTranscript: (noteId: string, texts: string[]): Promise<MeetingTranscript | null> =>
      ipcRenderer.invoke('meeting:saveTranscript', noteId, texts),
    getNotesState: (noteId: string): Promise<MeetingNotesState> =>
      ipcRenderer.invoke('meeting:getNotesState', noteId),
    getNotesMarkdown: (noteId: string): Promise<string | null> =>
      ipcRenderer.invoke('meeting:getNotesMarkdown', noteId),
    retryNotes: (noteId: string): Promise<MeetingNotesState> =>
      ipcRenderer.invoke('meeting:retryNotes', noteId),
    saveNotes: (noteId: string, markdown: string): Promise<boolean> =>
      ipcRenderer.invoke('meeting:saveNotes', noteId, markdown),
    setNotesTemplate: (
      noteId: string,
      template: MeetingNotesTemplateId
    ): Promise<MeetingNotesState> =>
      ipcRenderer.invoke('meeting:setNotesTemplate', noteId, template),
    /** Create a folder-backed meeting note, openable before capture completes. */
    startNew: (): Promise<Note | null> => ipcRenderer.invoke('meeting:startNew'),
    /** Omit `noteId` to use the folder-backed new-meeting path. */
    start: (noteId?: string | null): Promise<MeetingState> =>
      ipcRenderer.invoke('meeting:start', noteId ?? null),
    stop: (): Promise<MeetingState> => ipcRenderer.invoke('meeting:stop'),
    discard: (): Promise<MeetingState> => ipcRenderer.invoke('meeting:discard'),
    toggle: (noteId?: string | null): Promise<MeetingState> =>
      ipcRenderer.invoke('meeting:toggle', noteId ?? null),
    subscribeState: (callback: (state: MeetingState) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, state: MeetingState): void => callback(state)
      ipcRenderer.on('meeting:state-changed', listener)
      return () => ipcRenderer.removeListener('meeting:state-changed', listener)
    },
    subscribeLevels: (callback: (levels: MeetingLevels) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, levels: MeetingLevels): void =>
        callback(levels)
      ipcRenderer.on('meeting:levels', listener)
      return () => ipcRenderer.removeListener('meeting:levels', listener)
    },
    subscribeError: (callback: (error: MeetingError) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, error: MeetingError): void => callback(error)
      ipcRenderer.on('meeting:error', listener)
      return () => ipcRenderer.removeListener('meeting:error', listener)
    },
    subscribeRecorded: (callback: (noteId: string) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, noteId: string): void => callback(noteId)
      ipcRenderer.on('meeting:recorded', listener)
      return () => ipcRenderer.removeListener('meeting:recorded', listener)
    },
    subscribeTranscript: (callback: (noteId: string) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, noteId: string): void => callback(noteId)
      ipcRenderer.on('meeting:transcript-changed', listener)
      return () => ipcRenderer.removeListener('meeting:transcript-changed', listener)
    },
    subscribeNotes: (callback: (state: MeetingNotesState) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, state: MeetingNotesState): void =>
        callback(state)
      ipcRenderer.on('meeting:notes-state', listener)
      return () => ipcRenderer.removeListener('meeting:notes-state', listener)
    },
    subscribeModelProgress: (callback: (p: { received: number; total: number }) => void) => {
      const listener = (
        _e: Electron.IpcRendererEvent,
        p: { received: number; total: number }
      ): void => callback(p)
      ipcRenderer.on('meeting:model-progress', listener)
      return () => ipcRenderer.removeListener('meeting:model-progress', listener)
    }
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
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
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
