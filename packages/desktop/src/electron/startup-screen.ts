import { BrowserWindow, WebContentsView } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StartupGate } from './startup-state.ts'
import { createStartupThemeSession, restrictStartupNavigation } from './startup-theme-protocol.ts'
import type { ResolvedStartupTheme } from './startup-themes.ts'

export interface StartupStatus { phase: 'loading' | 'ready' | 'error'; message?: string }

/** 在主页面之上显示本地启动页；主页面加载期间不移除展示层。 */
export function createStartupScreen(win: BrowserWindow, animationEnabled: boolean, retry: () => void, theme: ResolvedStartupTheme) {
  const view = new WebContentsView({ webPreferences: {
    preload: join(dirname(fileURLToPath(import.meta.url)), 'preload.cjs'),
    contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
    session: createStartupThemeSession(theme, { theme: theme.info, animationEnabled, preview: false, platform: process.platform }),
  } })
  restrictStartupNavigation(view.webContents, theme)
  view.setBackgroundColor('#050403')
  let disposed = false
  let fallbackShown = false
  let watchdog: ReturnType<typeof setTimeout> | undefined
  let status: StartupStatus = { phase: 'loading' }
  const resize = (): void => { if (!win.isDestroyed()) { const [width, height] = win.getContentSize(); view.setBounds({ x: 0, y: 0, width, height }) } }
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    clearTimeout(watchdog)
    win.removeListener('resize', resize)
    win.removeListener('closed', dispose)
    if (!win.isDestroyed()) { win.contentView.removeChildView(view); win.webContents.focus() }
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }
  const gate = new StartupGate(dispose, animationEnabled)
  const fallback = (): void => {
    if (disposed || fallbackShown) return
    fallbackShown = true
    clearTimeout(watchdog)
    gate.finish()
    if (!disposed) void view.webContents.loadURL('corumapp://startup/loading.html').catch(error => {
      console.error('[corum-startup] 加载提示页无法显示', error)
    })
  }
  // 独立于 renderer 的保护：主题脚本卡住或播放器崩溃也不能挡住已就绪的主界面。
  if (animationEnabled && theme.info.type === 'html') watchdog = setTimeout(fallback, 45_000)
  view.webContents.on('render-process-gone', fallback)
  view.webContents.on('unresponsive', () => { if (!disposed) view.webContents.forcefullyCrashRenderer() })
  const publish = (next: StartupStatus): void => {
    status = next
    if (!disposed && !view.webContents.isDestroyed()) view.webContents.send('corum:startup-status', status)
  }
  win.contentView.addChildView(view)
  view.setVisible(true)
  resize()
  win.on('resize', resize)
  win.once('closed', dispose)
  void view.webContents.loadURL('corumapp://startup/index.html').then(() => {
    if (!disposed && !view.webContents.isDestroyed()) view.webContents.focus()
  }).catch(error => {
    console.error('[corum-startup] 启动页加载失败', error)
    gate.finish()
  })
  return {
    senderId: view.webContents.id,
    getStatus: () => status,
    finish: () => { clearTimeout(watchdog); gate.finish() },
    ready: () => {
      if (disposed || status.phase === 'error') return
      publish({ phase: 'ready' })
      view.webContents.focus()
      gate.ready()
    },
    fail: (message: string) => { gate.fail(); publish({ phase: 'error', message }) },
    retry: () => { if (status.phase === 'error' && !disposed) { dispose(); retry() } },
    dispose,
  }
}
