import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'

function sendShortcut(action: string): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  win?.webContents.send('shortcut', action)
}

export function buildAppMenu(): Menu {
  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              {
                label: 'Settings…',
                accelerator: 'CmdOrCtrl+,',
                click: () => sendShortcut('open-settings')
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'Note',
      submenu: [
        {
          label: 'New Note',
          accelerator: 'CmdOrCtrl+T',
          click: () => sendShortcut('new-note')
        },
        {
          label: 'New Sticky Note',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => sendShortcut('new-sticky')
        },
        { type: 'separator' },
        {
          label: 'Import Markdown…',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendShortcut('import-markdown')
        },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => sendShortcut('close-tab')
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+\\',
          click: () => sendShortcut('toggle-sidebar')
        },
        {
          label: 'Toggle Zen Mode',
          accelerator: 'CmdOrCtrl+.',
          click: () => sendShortcut('toggle-zen')
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' as const }, { role: 'front' as const }] : [{ role: 'close' as const }])
      ]
    }
  ]

  return Menu.buildFromTemplate(template)
}
