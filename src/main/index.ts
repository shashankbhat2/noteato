import { basename, join } from 'path'
import { readFileSync } from 'fs'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } from 'electron'
import type { SaveOptions } from '../shared/types'
import { NoteStore } from './storage'
import { createSettingsStore } from './settings'
import { StickyManager } from './sticky'
import { buildAppMenu } from './menu'

const settingsStore = createSettingsStore()
const noteStore = new NoteStore(settingsStore.read().notesDir ?? undefined)
const stickyManager = new StickyManager()

const DARK_BG = '#171614'
const LIGHT_BG = '#faf8f5'

function createMainWindow(): void {
  const isDark = settingsStore.read().theme === 'dark'
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    show: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 13, y: 13 },
    backgroundColor: isDark ? DARK_BG : LIGHT_BG,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())
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

  ipcMain.handle('app:closeWindow', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.noat.app')
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
