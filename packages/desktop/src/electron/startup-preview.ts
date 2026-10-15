import { BrowserWindow, ipcMain } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStartupThemeSession, restrictStartupNavigation } from './startup-theme-protocol.ts'
import type { ResolvedStartupTheme } from './startup-themes.ts'

let preview: BrowserWindow | null = null
ipcMain.on('corum:startup-preview-close', event => {
  if (preview && event.sender === preview.webContents && event.senderFrame === preview.webContents.mainFrame) preview.close()
})

export function openStartupPreview(parent: BrowserWindow, theme: ResolvedStartupTheme): void {
  preview?.close()
  const win = new BrowserWindow({ parent, width: 1000, height: 700, title: `启动主题预览 · ${theme.info.name}`, backgroundColor: theme.info.background ?? '#050403', webPreferences: {
    preload: join(dirname(fileURLToPath(import.meta.url)), 'startup-preview-preload.cjs'),
    contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false,
    session: createStartupThemeSession(theme, { theme: theme.info, animationEnabled: true, preview: true, platform: process.platform }),
  } })
  preview = win
  restrictStartupNavigation(win.webContents, theme)
  win.on('closed', () => { if (preview === win) preview = null })
  void win.loadURL('corumapp://startup/index.html').catch(() => { if (!win.isDestroyed()) win.close() })
}
