import { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import {
  app,
  BrowserWindow,
  Menu,
  clipboard,
  dialog,
  ipcMain,
  nativeTheme,
  session,
  shell
} from 'electron'
import type {
  AiCompleteRequest,
  Note,
  NoteChange,
  SaveOptions,
  ScratchChange,
  ScratchNote,
  ScratchSaveOptions,
  Settings
} from '../shared/types'
import { getAppDb } from './db'
import { NoteStore } from './storage'
import { ScratchStore } from './scratchStore'
import { ExternalWatcher } from './fileWatcher'
import { createSettingsStore } from './settings'
import { buildAppMenu } from './menu'
import { createWindowStateStore, trackWindowState } from './windowState'
import { completeAi, streamAi } from './ai'
import { ReminderScheduler } from './reminders'
import { importNotionExport } from './notionImport'
import { TrayManager } from './tray'
import { SidebarModeManager } from './sidebarMode'
import { EdgeHoverWatcher } from './edgeHover'
import { GlobalShortcutManager } from './globalShortcuts'
import { AgentClient } from './agentClient'

const appDb = getAppDb()
const settingsStore = createSettingsStore()
const noteStore = new NoteStore(appDb, settingsStore.read().notesDir ?? undefined)
const scratchStore = new ScratchStore(appDb)
// Linked external files/folders reload live: any on-disk change lands as an
// upsert (single file) or refresh (folder) in every window.
const externalWatcher = new ExternalWatcher((rootPath, kind) => {
  if (kind === 'folder') {
    broadcastNoteChange({ kind: 'refresh' })
    return
  }
  try {
    broadcastNoteChange({ kind: 'upsert', note: noteStore.read(rootPath) })
  } catch {
    broadcastNoteChange({ kind: 'refresh' })
  }
})
const windowStateStore = createWindowStateStore(appDb)
const sidebarModeManager = new SidebarModeManager(appDb, () => settingsStore.read())
const reminderScheduler = new ReminderScheduler(
  noteStore,
  scratchStore,
  () => mainWindow,
  (note) => openScratchNote(note),
  (change) => broadcastScratchChange(change)
)
const globalShortcutManager = new GlobalShortcutManager(() => sidebarModeManager.toggle())

// The resident native agent (docs/revamp/phase-plan.md, Phase 1). Behind a flag
// while both capture paths coexist; the Electron path goes in Phase 3. Absent
// agent is an ordinary state — the client retries quietly and the library works
// exactly as before.
const agentEnabled = process.env['NOTEATO_AGENT'] === '1'
const agentClient = new AgentClient(
  (message) => {
    switch (message.type) {
      case 'showLibrary':
        showMainWindow()
        break
      case 'welcome':
        if (message.protocolVersion !== undefined && message.protocolVersion !== 1) {
          console.warn(
            `NoteatoAgent speaks protocol ${message.protocolVersion}; this library speaks 1.`
          )
        }
        break
      default:
        break
    }
  },
  (connected) => {
    // Exclusive ownership: the agent registers the global shortcuts whenever it
    // is up, and Electron takes them back only if it goes away.
    globalShortcutManager.setAgentConnected(connected, runtimeSettings())
  }
)
const edgeHoverWatcher = new EdgeHoverWatcher(
  () => {
    const settings = runtimeSettings()
    return {
      enabled: settings.sidebarModeEnabled && settings.sidebarHoverReveal,
      edge: settings.sidebarEdge,
      delayMs: settings.sidebarHoverDelay
    }
  },
  () => sidebarModeManager.isVisible(),
  () => sidebarModeManager.show()
)

function runtimeSettings(settings: Settings = settingsStore.read()): Settings {
  if (settings.onboardingCompleted) return settings
  return { ...settings, keepInMenuBar: false, sidebarModeEnabled: false }
}
// The tray's own "Quit Noteato" sets this before calling app.quit(), so the
// before-quit handler below knows to let that one through.
let allowQuit = false
const trayManager = new TrayManager(
  () => showMainWindow(),
  () => sidebarModeManager.show(),
  () => runtimeSettings().sidebarModeEnabled,
  () => {
    allowQuit = true
    edgeHoverWatcher.stop()
    sidebarModeManager.destroy()
  }
)

function shouldKeepRunning(): boolean {
  const settings = runtimeSettings()
  return settings.keepInMenuBar || settings.sidebarModeEnabled
}

// Cmd+Q / Dock "Quit" / the app-menu Quit role all call app.quit(), which
// fires this before any window closes. With keepInMenuBar on, treat that as
// "hide to the tray" instead of a real quit — reminder timers live in this
// process regardless of whether any window is open, so keeping the process
// alive is what actually keeps them firing.
app.on('before-quit', (event) => {
  if (allowQuit) {
    sidebarModeManager.destroy()
    return
  }
  if (shouldKeepRunning()) {
    event.preventDefault()
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
  }
})

// Chromium's Hunspell spellchecker takes a language list on Windows/Linux;
// macOS always uses the native system spellchecker (this is a no-op there).
function applySpellcheckLanguage(language: string): void {
  if (process.platform === 'darwin') return
  const ses = session.defaultSession
  try {
    ses.setSpellCheckerLanguages([language === 'auto' ? app.getLocale() : language])
  } catch {
    /* unknown language code — keep the current dictionary */
  }
}

function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    const { protocol } = new URL(rawUrl)
    return protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:'
  } catch {
    return false
  }
}

/* Matches --sidebar-bg, the window chrome the app shell paints, so the frame
   the OS shows before the renderer boots is the same colour it lands on. */
const DARK_BG = '#1a1a1a'
const LIGHT_BG = '#ededed'
const MIN_WIDTH = 350
const MIN_HEIGHT = 250

let mainWindow: BrowserWindow | null = null

function broadcastNoteChange(change: NoteChange, exceptWebContentsId?: number): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.webContents.id !== exceptWebContentsId) {
      win.webContents.send('notes:changed', change)
    }
  }
}

function broadcastScratchChange(change: ScratchChange, exceptWebContentsId?: number): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.webContents.id !== exceptWebContentsId) {
      win.webContents.send('scratch:changed', change)
    }
  }
}

// Clicking a scratch-note reminder notification opens the sidebar-mode window
// on that note (the sidebar is the only surface scratch notes live on). No-op
// if sidebar mode is disabled in settings.
function openScratchNote(note: ScratchNote): void {
  sidebarModeManager.show()
  const win = sidebarModeManager.getWindow()
  if (!win || win.isDestroyed()) return
  const send = (): void => win.webContents.send('scratch:open', note.id)
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send)
  else send()
}

// While the app lives only in the menu bar (keepInMenuBar on, no visible
// windows), drop the Dock icon and its running dot — the same behavior as
// menu-bar apps like Docker Desktop. Any window becoming visible brings the
// Dock icon back (see browser-window-created below).
function hideDockIfBackgrounded(): void {
  if (process.platform !== 'darwin') return
  const sidebarWindow = sidebarModeManager.getWindow()
  const anyVisibleRegularWindow = BrowserWindow.getAllWindows().some(
    (w) => w !== sidebarWindow && !w.isDestroyed() && w.isVisible()
  )
  if (!anyVisibleRegularWindow && shouldKeepRunning() && app.dock.isVisible()) {
    app.dock.hide()
  }
}

// --- Markdown files opened via the OS (Finder "Open With", double-click) ----
// macOS delivers these through 'open-file' (possibly before the app is ready);
// Windows/Linux pass them on argv. Each file is linked in place, then
// handed to the renderer — queued until it announces readiness.
const pendingExternalNotes: Note[] = []
let rendererReady = false

function openExternalMarkdown(filePath: string): void {
  if (!/\.(md|markdown)$/i.test(filePath)) return
  let note: Note
  try {
    note = noteStore.openExternal(filePath)
  } catch {
    return
  }
  externalWatcher.sync(noteStore.listOpenedRoots())
  if (rendererReady && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('notes:external-open', note)
    mainWindow.show()
  } else {
    pendingExternalNotes.push(note)
  }
}

app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (app.isReady()) {
    if (!mainWindow || mainWindow.isDestroyed()) createMainWindow()
    openExternalMarkdown(filePath)
  } else {
    // Imported once the store is safe to use, right after ready.
    app.whenReady().then(() => openExternalMarkdown(filePath))
  }
})

function createMainWindow(): void {
  // themeSource is set to the saved mode (incl. 'system') at startup, so
  // shouldUseDarkColors reflects the resolved appearance.
  const isDark = nativeTheme.shouldUseDarkColors
  const state = windowStateStore.read()
  const win = new BrowserWindow({
    width: Math.max(state.width, MIN_WIDTH),
    height: Math.max(state.height, MIN_HEIGHT),
    x: state.x,
    y: state.y,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 13, y: 13 },
    backgroundColor: isDark ? DARK_BG : LIGHT_BG,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null
      rendererReady = false
    }
  })
  // With "keep in menu bar" on, the traffic-light close / Cmd+W-with-no-tabs
  // hides the window instead of destroying it — reminder timers already run
  // regardless of whether a window exists, but keeping it around (rather than
  // fully destroyed) means a fired reminder's notification can still open it.
  // allowQuit distinguishes this from a window closing as part of a real quit
  // the tray itself initiated (see the before-quit handler above).
  win.on('close', (event) => {
    if (!allowQuit && shouldKeepRunning()) {
      event.preventDefault()
      win.hide()
    }
  })

  trackWindowState(win, windowStateStore)

  win.on('ready-to-show', () => {
    if (state.isMaximized) win.maximize()
    win.show()
  })
  win.webContents.setWindowOpenHandler((details) => {
    if (isSafeExternalUrl(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Right-clicks are handled by the renderer (custom menus), but only the main
  // process sees the spellchecker's suggestions — forward what it needs.
  win.webContents.on('context-menu', (_event, params) => {
    win.webContents.send('app:context-menu', {
      x: params.x,
      y: params.y,
      misspelledWord: params.misspelledWord,
      dictionarySuggestions: params.dictionarySuggestions,
      selectionText: params.selectionText,
      isEditable: params.isEditable,
      editFlags: {
        canCut: params.editFlags.canCut,
        canCopy: params.editFlags.canCopy,
        canPaste: params.editFlags.canPaste
      }
    })
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow()
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.show()
  mainWindow.focus()
}

function openMainSettings(): void {
  showMainWindow()
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  const send = (): void => win.webContents.send('shortcut', 'open-settings')
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send)
  else send()
}

function registerIpcHandlers(): void {
  ipcMain.handle('notes:list', () => noteStore.list())
  ipcMain.handle('notes:read', (_e, path: string) => noteStore.read(path))
  ipcMain.handle('notes:create', (e, title?: string) => {
    const created = noteStore.create(title)
    broadcastNoteChange({ kind: 'upsert', note: created }, e.sender.id)
    return created
  })
  ipcMain.handle('notes:save', (e, path: string, options: SaveOptions) => {
    // An external save writes the watched file itself — flag it so the change
    // doesn't echo back as an "edited outside Noteato" reload.
    if (path.startsWith('/')) externalWatcher.markSelfWrite(path)
    const saved = noteStore.save(path, options)
    reminderScheduler.reschedule(saved)
    broadcastNoteChange({ kind: 'upsert', note: saved }, e.sender.id)
    return saved
  })
  ipcMain.handle('notes:setPinned', (e, path: string, pinned: boolean) => {
    const result = noteStore.setPinned(path, pinned)
    if (result) broadcastNoteChange({ kind: 'upsert', note: result }, e.sender.id)
    return result
  })
  ipcMain.handle('notes:setReminder', (e, path: string, reminderAt: string | null) => {
    const result = noteStore.setReminder(path, reminderAt)
    if (result) {
      reminderScheduler.reschedule(result)
      broadcastNoteChange({ kind: 'upsert', note: result }, e.sender.id)
    }
    return result
  })
  ipcMain.handle('notes:delete', (e, path: string) => {
    let id: string | null = null
    try {
      id = noteStore.read(path).id
    } catch {
      /* already gone */
    }
    const result = noteStore.delete(path)
    if (id) reminderScheduler.unschedule(id)
    if (id) broadcastNoteChange({ kind: 'remove', id }, e.sender.id)
    return result
  })
  ipcMain.handle('notes:removeExternal', (e, path: string) => {
    let id: string | null = null
    try {
      id = noteStore.read(path).id
    } catch {
      /* already gone */
    }
    const result = noteStore.removeExternal(path)
    externalWatcher.sync(noteStore.listOpenedRoots())
    if (id) reminderScheduler.unschedule(id)
    // Unlinking a folder removes many notes at once — easier to rescan.
    broadcastNoteChange(id ? { kind: 'remove', id } : { kind: 'refresh' }, e.sender.id)
    return result
  })
  ipcMain.handle('notes:restore', (e, trashName: string, originalPath: string, isFolder: boolean) => {
    const restored = noteStore.restore(trashName, originalPath, isFolder)
    if (restored) {
      reminderScheduler.reschedule(restored)
      broadcastNoteChange({ kind: 'upsert', note: restored }, e.sender.id)
    } else {
      reminderScheduler.rebuildAll()
      broadcastNoteChange({ kind: 'refresh' }, e.sender.id)
    }
    return restored
  })
  ipcMain.handle('notes:search', (_e, query: string) => noteStore.search(query))
  ipcMain.handle('notes:getDir', () => noteStore.getNotesDir())
  ipcMain.handle('notes:copyPath', (_e, path: string) => {
    const full = noteStore.absolutePath(path)
    clipboard.writeText(full)
    return full
  })
  ipcMain.handle('notes:revealInFinder', (_e, path: string) => {
    shell.showItemInFolder(noteStore.absolutePath(path))
  })
  ipcMain.handle('notes:listTrash', () => noteStore.listTrash())
  ipcMain.handle('notes:purgeTrash', (_e, trashName: string) => noteStore.purgeTrash(trashName))
  ipcMain.handle('notes:emptyTrash', () => noteStore.emptyTrash())

  ipcMain.handle('notes:chooseFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: noteStore.getNotesDir()
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null

    const newDir = result.filePaths[0]
    noteStore.setNotesDir(newDir)
    settingsStore.write({ ...settingsStore.read(), notesDir: newDir })
    reminderScheduler.rebuildAll()
    broadcastNoteChange({ kind: 'refresh' }, e.sender.id)
    return newDir
  })

  ipcMain.handle('notes:import', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled) return []

    const opened = result.filePaths.map((filePath) => noteStore.openExternal(filePath))
    externalWatcher.sync(noteStore.listOpenedRoots())
    for (const note of opened) broadcastNoteChange({ kind: 'upsert', note }, e.sender.id)
    return opened
  })

  ipcMain.handle('notes:openFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.OpenDialogOptions = { properties: ['openDirectory'] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return []

    const opened = noteStore.openExternalFolder(result.filePaths[0])
    externalWatcher.sync(noteStore.listOpenedRoots())
    broadcastNoteChange({ kind: 'refresh' }, e.sender.id)
    return opened
  })

  ipcMain.handle('notes:importNotion', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.OpenDialogOptions = { properties: ['openDirectory'] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    const imported = importNotionExport(noteStore, result.filePaths[0])
    broadcastNoteChange({ kind: 'refresh' }, e.sender.id)
    return imported
  })

  ipcMain.handle('notes:takeExternalOpens', () => {
    rendererReady = true
    return pendingExternalNotes.splice(0)
  })

  ipcMain.handle('reminders:takeFired', () => reminderScheduler.markReady())

  // --- Scratch notes (SQLite-backed; quick note + sidebar mode) -------------
  ipcMain.handle('scratch:list', () => scratchStore.list())
  ipcMain.handle('scratch:read', (_e, id: string) => scratchStore.read(id))
  ipcMain.handle('scratch:create', (e) => {
    const created = scratchStore.create()
    broadcastScratchChange({ kind: 'upsert', note: created }, e.sender.id)
    return created
  })
  ipcMain.handle('scratch:save', (e, id: string, options: ScratchSaveOptions) => {
    const saved = scratchStore.save(id, options)
    if (saved) broadcastScratchChange({ kind: 'upsert', note: saved }, e.sender.id)
    return saved
  })
  ipcMain.handle('scratch:delete', (e, id: string) => {
    const removed = scratchStore.delete(id)
    if (removed) {
      reminderScheduler.unschedule(id)
      broadcastScratchChange({ kind: 'remove', id }, e.sender.id)
    }
    return removed
  })
  ipcMain.handle('scratch:setPinned', (e, id: string, pinned: boolean) => {
    const updated = scratchStore.setPinned(id, pinned)
    if (updated) broadcastScratchChange({ kind: 'upsert', note: updated }, e.sender.id)
    return updated
  })
  ipcMain.handle('scratch:setReminder', (e, id: string, reminderAt: string | null) => {
    const updated = scratchStore.setReminder(id, reminderAt)
    if (updated) {
      reminderScheduler.rescheduleScratch(updated)
      broadcastScratchChange({ kind: 'upsert', note: updated }, e.sender.id)
    }
    return updated
  })

  ipcMain.handle('settings:get', () => settingsStore.read())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    const next = { ...settingsStore.read(), ...patch }
    settingsStore.write(next)
    const runtime = runtimeSettings(next)
    if (patch.theme) nativeTheme.themeSource = patch.theme
    if ('spellcheckLanguage' in patch) applySpellcheckLanguage(next.spellcheckLanguage)
    if ('sidebarModeEnabled' in patch || 'onboardingCompleted' in patch) {
      sidebarModeManager.setEnabled(runtime.sidebarModeEnabled)
      globalShortcutManager.sync(runtime)
    }
    if ('sidebarEdge' in patch) sidebarModeManager.applyEdge()
    if (
      'sidebarModeEnabled' in patch ||
      'sidebarHoverReveal' in patch ||
      'onboardingCompleted' in patch
    ) {
      edgeHoverWatcher.sync()
    }
    if (
      'keepInMenuBar' in patch ||
      'sidebarModeEnabled' in patch ||
      'onboardingCompleted' in patch
    ) {
      trayManager.setEnabled(runtime.keepInMenuBar || runtime.sidebarModeEnabled)
      // Turning the tray off must never leave the app unreachable with a
      // hidden Dock icon and no menu bar presence.
      if (!runtime.keepInMenuBar && !runtime.sidebarModeEnabled && process.platform === 'darwin') {
        void app.dock.show()
      }
    }
    return next
  })

  ipcMain.handle('sidebar:getState', () => sidebarModeManager.getState())
  ipcMain.handle('sidebar:show', () => sidebarModeManager.show())
  ipcMain.handle('sidebar:close', () => sidebarModeManager.hide())
  ipcMain.handle('sidebar:setPinned', (_e, pinned: boolean) => {
    const next = { ...settingsStore.read(), sidebarPinned: pinned }
    settingsStore.write(next)
    sidebarModeManager.setPinned(pinned)
    return sidebarModeManager.getState()
  })
  ipcMain.handle('ai:complete', (_e, req: AiCompleteRequest) => completeAi(settingsStore.read(), req))
  const aiStreamAborts = new Map<number, AbortController>()
  ipcMain.handle('ai:stream', (e, requestId: number, req: AiCompleteRequest) => {
    const controller = new AbortController()
    aiStreamAborts.set(requestId, controller)
    return streamAi(
      settingsStore.read(),
      req,
      (delta) => {
        if (!e.sender.isDestroyed()) e.sender.send(`ai:stream:${requestId}`, delta)
      },
      controller.signal
    ).finally(() => aiStreamAborts.delete(requestId))
  })
  ipcMain.handle('ai:stream:abort', (_e, requestId: number) => {
    aiStreamAborts.get(requestId)?.abort()
  })

  ipcMain.handle('app:spellcheckerLanguages', () =>
    process.platform === 'darwin' ? [] : session.defaultSession.availableSpellCheckerLanguages
  )

  // Actions for the renderer's custom right-click menu. Cut/copy/paste go
  // through webContents so they hit the OS clipboard and the focused editable.
  ipcMain.handle('app:replaceMisspelling', (e, word: string) =>
    e.sender.replaceMisspelling(word)
  )
  ipcMain.handle('app:addToDictionary', (e, word: string) =>
    e.sender.session.addWordToSpellCheckerDictionary(word)
  )
  ipcMain.handle('app:lookUpSelection', (e) => {
    if (process.platform === 'darwin') e.sender.showDefinitionForSelection()
  })
  ipcMain.handle('app:searchGoogle', (_e, text: string) =>
    shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(text)}`)
  )
  ipcMain.handle('app:cut', (e) => e.sender.cut())
  ipcMain.handle('app:copy', (e) => e.sender.copy())
  ipcMain.handle('app:paste', (e) => e.sender.paste())
  ipcMain.handle('app:openSettings', () => openMainSettings())

  ipcMain.handle('app:closeWindow', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
  ipcMain.handle('app:toggleMaximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.noteato.app')
  nativeTheme.themeSource = settingsStore.read().theme

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
    // Restoring the Dock icon flips the app back to a regular Dock app; the
    // window is refocused once that completes because the activation-policy
    // switch can steal focus from a window shown in the same beat.
    window.on('show', () => {
      if (window === sidebarModeManager.getWindow()) {
        setImmediate(hideDockIfBackgrounded)
        return
      }
      if (process.platform !== 'darwin' || app.dock.isVisible()) return
      void app.dock.show().then(() => {
        if (!window.isDestroyed()) window.focus()
      })
    })
    window.on('hide', () => hideDockIfBackgrounded())
    window.on('closed', () => setImmediate(hideDockIfBackgrounded))
  })

  Menu.setApplicationMenu(buildAppMenu())
  registerIpcHandlers()
  applySpellcheckLanguage(settingsStore.read().spellcheckLanguage)
  externalWatcher.sync(noteStore.listOpenedRoots())
  createMainWindow()
  reminderScheduler.rebuildAll()
  const runtime = runtimeSettings()
  sidebarModeManager.setEnabled(runtime.sidebarModeEnabled)
  globalShortcutManager.sync(runtime)
  if (agentEnabled) agentClient.start()
  edgeHoverWatcher.sync()
  trayManager.setEnabled(shouldKeepRunning())

  // Windows/Linux deliver OS-opened files as launch arguments.
  for (const arg of process.argv.slice(1)) openExternalMarkdown(arg)

  app.on('activate', () => {
    showMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !shouldKeepRunning()) app.quit()
})

app.on('will-quit', () => {
  agentClient.stop()
  globalShortcutManager.destroy()
  edgeHoverWatcher.stop()
  externalWatcher.destroy()
})
