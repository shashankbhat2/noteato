import { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } from 'electron'
import type { AiCompleteRequest, Note, SaveOptions } from '../shared/types'
import { NoteStore } from './storage'
import { createSettingsStore } from './settings'
import { StickyManager } from './sticky'
import { buildAppMenu } from './menu'
import { createWindowStateStore, trackWindowState } from './windowState'
import { completeAi, streamAi } from './ai'
import { ReminderScheduler } from './reminders'
import { importNotionExport } from './notionImport'
import { TrayManager } from './tray'

const settingsStore = createSettingsStore()
const noteStore = new NoteStore(settingsStore.read().notesDir ?? undefined)
const stickyManager = new StickyManager()
const windowStateStore = createWindowStateStore()
const reminderScheduler = new ReminderScheduler(noteStore, () => mainWindow)
// The tray's own "Quit Noteato" sets this before calling app.quit(), so the
// before-quit handler below knows to let that one through.
let allowQuit = false
const trayManager = new TrayManager(
  () => mainWindow,
  () => {
    allowQuit = true
  }
)

// Cmd+Q / Dock "Quit" / the app-menu Quit role all call app.quit(), which
// fires this before any window closes. With keepInMenuBar on, treat that as
// "hide to the tray" instead of a real quit — reminder timers live in this
// process regardless of whether any window is open, so keeping the process
// alive is what actually keeps them firing.
app.on('before-quit', (event) => {
  if (allowQuit) return
  if (settingsStore.read().keepInMenuBar) {
    event.preventDefault()
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
  }
})

const DARK_BG = '#171614'
const LIGHT_BG = '#faf8f5'
const MIN_WIDTH = 350
const MIN_HEIGHT = 250

let mainWindow: BrowserWindow | null = null

// While the app lives only in the menu bar (keepInMenuBar on, no visible
// windows), drop the Dock icon and its running dot — the same behavior as
// menu-bar apps like Docker Desktop. Any window becoming visible brings the
// Dock icon back (see browser-window-created below).
function hideDockIfBackgrounded(): void {
  if (process.platform !== 'darwin') return
  const anyVisible = BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isVisible())
  if (!anyVisible && settingsStore.read().keepInMenuBar && app.dock.isVisible()) {
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
    if (!allowQuit && settingsStore.read().keepInMenuBar) {
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
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle('notes:list', () => noteStore.list())
  ipcMain.handle('notes:listFolders', () => noteStore.listFolders())
  ipcMain.handle('notes:read', (_e, path: string) => noteStore.read(path))
  ipcMain.handle('notes:create', (_e, title?: string, folder?: string) =>
    noteStore.create(title, folder)
  )
  ipcMain.handle('notes:save', (_e, path: string, options: SaveOptions) => {
    const saved = noteStore.save(path, options)
    reminderScheduler.reschedule(saved)
    return saved
  })
  ipcMain.handle('notes:setPinned', (_e, path: string, pinned: boolean) =>
    noteStore.setPinned(path, pinned)
  )
  ipcMain.handle('notes:setReminder', (_e, path: string, reminderAt: string | null) => {
    const result = noteStore.setReminder(path, reminderAt)
    if (result) reminderScheduler.reschedule(result)
    return result
  })
  ipcMain.handle('notes:delete', (_e, path: string) => {
    let id: string | null = null
    try {
      id = noteStore.read(path).id
    } catch {
      /* already gone */
    }
    const result = noteStore.delete(path)
    if (id) reminderScheduler.unschedule(id)
    return result
  })
  ipcMain.handle('notes:removeExternal', (_e, path: string) => {
    let id: string | null = null
    try {
      id = noteStore.read(path).id
    } catch {
      /* already gone */
    }
    const result = noteStore.removeExternal(path)
    if (id) reminderScheduler.unschedule(id)
    return result
  })
  ipcMain.handle('notes:restore', (_e, trashName: string, originalPath: string, isFolder: boolean) => {
    const restored = noteStore.restore(trashName, originalPath, isFolder)
    if (restored) reminderScheduler.reschedule(restored)
    else reminderScheduler.rebuildAll()
    return restored
  })
  ipcMain.handle('notes:createFolder', (_e, path: string) => noteStore.createFolder(path))
  ipcMain.handle('notes:renameFolder', (_e, path: string, newName: string) => {
    noteStore.renameFolder(path, newName)
    reminderScheduler.rebuildAll()
  })
  ipcMain.handle('notes:moveNote', (_e, path: string, targetFolder: string) => {
    const moved = noteStore.moveNote(path, targetFolder)
    if (moved) reminderScheduler.reschedule(moved)
    return moved
  })
  ipcMain.handle('notes:moveFolder', (_e, path: string, targetParent: string) => {
    noteStore.moveFolder(path, targetParent)
    reminderScheduler.rebuildAll()
  })
  ipcMain.handle('notes:deleteFolder', (_e, path: string) => {
    const result = noteStore.deleteFolder(path)
    reminderScheduler.rebuildAll()
    return result
  })
  ipcMain.handle('notes:search', (_e, query: string) => noteStore.search(query))
  ipcMain.handle('notes:getDir', () => noteStore.getNotesDir())

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

    return result.filePaths.map((filePath) => noteStore.openExternal(filePath))
  })

  ipcMain.handle('notes:importNotion', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.OpenDialogOptions = { properties: ['openDirectory'] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return importNotionExport(noteStore, result.filePaths[0])
  })

  ipcMain.handle('notes:takeExternalOpens', () => {
    rendererReady = true
    return pendingExternalNotes.splice(0)
  })

  ipcMain.handle('reminders:takeFired', () => reminderScheduler.markReady())

  ipcMain.handle('settings:get', () => settingsStore.read())
  ipcMain.handle('settings:set', (_e, patch) => {
    const next = { ...settingsStore.read(), ...patch }
    settingsStore.write(next)
    if (patch.theme) nativeTheme.themeSource = patch.theme
    if ('keepInMenuBar' in patch) {
      trayManager.setEnabled(next.keepInMenuBar)
      // Turning the tray off must never leave the app unreachable with a
      // hidden Dock icon and no menu bar presence.
      if (!next.keepInMenuBar && process.platform === 'darwin') void app.dock.show()
    }
    return next
  })

  ipcMain.handle('sticky:list', () => stickyManager.list())
  ipcMain.handle('sticky:create', () => stickyManager.create())
  ipcMain.handle('sticky:update', (_e, id: string, patch) => stickyManager.update(id, patch))
  ipcMain.handle('sticky:close', (_e, id: string) => stickyManager.close(id))

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
  createMainWindow()
  stickyManager.openAll()
  reminderScheduler.rebuildAll()
  trayManager.setEnabled(settingsStore.read().keepInMenuBar)

  // Windows/Linux deliver OS-opened files as launch arguments.
  for (const arg of process.argv.slice(1)) openExternalMarkdown(arg)

  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    } else if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
