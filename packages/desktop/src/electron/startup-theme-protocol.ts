import { session, type Session, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { renderStartupPageHtml, type StartupPageOptions } from './startup-page.ts'
import { readStartupThemeResource } from './startup-theme-resource.ts'
import type { ResolvedStartupTheme } from './startup-themes.ts'

export function createStartupThemeSession(theme: ResolvedStartupTheme, options: StartupPageOptions): Session {
  const isolated = session.fromPartition(`corum-startup-${randomUUID()}`, { cache: false })
  const resourcePrefix = `corumapp://startup-theme/${theme.info.id}/`
  isolated.protocol.handle('corumapp', request => {
    if (request.url === 'corumapp://startup/index.html' || request.url === 'corumapp://startup/loading.html') {
      return new Response(renderStartupPageHtml(request.url.endsWith('/loading.html') ? { ...options, animationEnabled: false } : options), { headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src corumapp://startup-theme; media-src corumapp://startup-theme; img-src corumapp://startup-theme; object-src 'none'; base-uri 'none'",
      } })
    }
    return readStartupThemeResource(theme, request)
  })
  isolated.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !(details.url === 'corumapp://startup/index.html' || details.url === 'corumapp://startup/loading.html' || details.url.startsWith(resourcePrefix) || details.url.startsWith('data:') || details.url.startsWith('blob:')) })
  })
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  isolated.setPermissionCheckHandler(() => false)
  return isolated
}

export function restrictStartupNavigation(contents: WebContents, theme: ResolvedStartupTheme): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', event => event.preventDefault())
  const entry = theme.info.entry
    ? `corumapp://startup-theme/${theme.info.id}/${theme.info.entry.split('/').map(encodeURIComponent).join('/')}`
    : null
  contents.on('will-frame-navigate', event => { if (entry === null || event.isMainFrame || event.url !== entry) event.preventDefault() })
}
