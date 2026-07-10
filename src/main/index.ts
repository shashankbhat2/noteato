import { basename, join } from 'path'
import { readFileSync } from 'fs'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } from 'electron'
import type { AiCompleteRequest, SaveOptions } from '../shared/types'
import { NoteStore } from './storage'
import { createSettingsStore } from './settings'
import { StickyManager } from './sticky'
import { buildAppMenu } from './menu'
import { createWindowStateStore, trackWindowState } from './windowState'
import { completeAi } from './ai'

const settingsStore = createSettingsStore()
const noteStore = new NoteStore(settingsStore.read().notesDir ?? undefined)
const stickyManager = new StickyManager()
const windowStateStore = createWindowStateStore()

const DARK_BG = '#171614'
const LIGHT_BG = '#faf8f5'
const MIN_WIDTH = 350
const MIN_HEIGHT = 250

function createMainWindow(): void {
  const isDark = settingsStore.read().theme === 'dark'
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
  ipcMain.handle('notes:read', (_e, filename: string) => noteStore.read(filename))
  ipcMain.handle('notes:create', (_e, title?: string) => noteStore.create(title))
  ipcMain.handle('notes:save', (_e, filename: string, options: SaveOptions) =>
    noteStore.save(filename, options)
  )
  ipcMain.handle('notes:delete', (_e, filename: string) => noteStore.delete(filename))
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

    return result.filePaths.map((filePath) => {
      const raw = readFileSync(filePath, 'utf-8')
      return noteStore.importMarkdown(basename(filePath), raw)
    })
  })

  ipcMain.handle('settings:get', () => settingsStore.read())
  ipcMain.handle('settings:set', (_e, patch) => {
    const next = { ...settingsStore.read(), ...patch }
    settingsStore.write(next)
    if (patch.theme) nativeTheme.themeSource = patch.theme
    return next
  })

  ipcMain.handle('sticky:list', () => stickyManager.list())
  ipcMain.handle('sticky:create', () => stickyManager.create())
  ipcMain.handle('sticky:update', (_e, id: string, patch) => stickyManager.update(id, patch))
  ipcMain.handle('sticky:close', (_e, id: string) => stickyManager.close(id))

  ipcMain.handle('ai:complete', (_e, req: AiCompleteRequest) => completeAi(settingsStore.read(), req))

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
  })

  Menu.setApplicationMenu(buildAppMenu())
  registerIpcHandlers()
  createMainWindow()
  stickyManager.openAll()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
