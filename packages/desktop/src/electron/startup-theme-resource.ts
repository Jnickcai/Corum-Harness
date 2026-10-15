import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import { resolveThemeFile, type ResolvedStartupTheme } from './startup-themes.ts'

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.webm': 'video/webm' }
export const THEME_CSP = "default-src 'none'; script-src 'unsafe-inline' corumapp://startup-theme corumapp://startup-sdk; style-src 'unsafe-inline' corumapp://startup-theme; img-src data: blob: corumapp://startup-theme; font-src data: corumapp://startup-theme; media-src corumapp://startup-theme; connect-src corumapp://startup-theme; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"

/** 与 Electron 注册分开，以普通 Node 测试验证文件与 Range 边界。 */
export async function readStartupThemeResource(theme: ResolvedStartupTheme, request: Request): Promise<Response> {
  let file: string
  try {
    const url = new URL(request.url)
    const prefix = `/${theme.info.id}/`
    if (url.protocol !== 'corumapp:' || url.host !== 'startup-theme' || !url.pathname.startsWith(prefix)) return new Response(null, { status: 403 })
    file = await resolveThemeFile(theme.root, decodeURIComponent(url.pathname.slice(prefix.length)))
  } catch (error) {
    return new Response(null, { status: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 403 })
  }
  const { size } = await stat(file)
  const headers = new Headers({ 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'accept-ranges': 'bytes', 'access-control-allow-origin': '*', 'content-security-policy': THEME_CSP, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' })
  let start = 0, end = size - 1, status = 200
  const range = request.headers.get('range')
  if (range !== null) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } })
    if (!match[1]) start = Math.max(0, size - Number(match[2]))
    else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])) }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } })
    status = 206
    headers.set('content-range', `bytes ${start}-${end}/${size}`)
  }
  headers.set('content-length', String(Math.max(0, end - start + 1)))
  const body = request.method === 'HEAD' || size === 0 ? null : Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>
  return new Response(body, { status, headers })
}
