import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { readStartupThemeArchive, validateThemePath } from './startup-theme-archive.ts'
import { readStartupThemeId, settingsHome, writeStartupThemeId } from './startup-settings.ts'

/**
 * 静态扫描主题 HTML 文本，拒绝明显危险的模式。
 *
 * ⚠️ 局限性声明：这是正则级静态检查，**不保证运行期安全**——它只挡掉最显眼的
 * 越界企图（嵌套框架 / 外部脚本 / 外部网络 / Node 模块加载），无法对抗混淆或
 * 间接调用。真正的安全屏障是 sandbox iframe（allow-scripts only，无同源、无
 * allow-same-origin）+ CSP（default-src 'none'）。本扫描的作用是「导入时提前
 * 拒绝并给出明确错误」，而不是「通过即安全」。
 *
 * 已知会误杀：合法的动态 import 字符串拼接、合法的 fetch 字面量 URL 等
 * 极少见用法——主题开发者应把外部资源打进 ZIP，用 corumapp://startup-theme 引用。
 */
const DANGEROUS_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /<iframe\s/i, reason: '禁止使用 <iframe>（主题运行在 sandbox iframe 内，不可嵌套）' },
  { pattern: /<object\s/i, reason: '禁止使用 <object>（CSP object-src 为 none）' },
  { pattern: /<embed\s/i, reason: '禁止使用 <embed>（CSP object-src 为 none）' },
  { pattern: /\brequire\s*\(/, reason: '禁止 require() 加载 Node 模块（sandbox 已拦截）' },
  { pattern: /\bimport\b[^;\n]*?\bhttps?:\/\//i, reason: '禁止 ESM import 外部 URL（只允许 import corumapp:// 资源）' },
  { pattern: /\bfetch\s*\(\s*['"]https?:\/\//i, reason: '禁止 fetch 外部网络地址' },
  { pattern: /\bXMLHttpRequest\b/, reason: '禁止使用 XMLHttpRequest（不允许外部网络请求）' },
  { pattern: /<script[^>]*\bsrc\s*=\s*['"]https?:\/\//i, reason: '禁止加载外部 <script src="http(s)://…">' },
  { pattern: /<link[^>]*\bhref\s*=\s*['"]https?:\/\//i, reason: '禁止加载外部 <link href="http(s)://…">（CSS）' },
]

export function validateThemeHtml(html: string): void {
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(html)) throw new Error(`主题 HTML 校验失败：${reason}`)
  }
}

export interface StartupThemeManifest {
  formatVersion: 1
  id: string
  name: string
  version: string
  type: 'html' | 'video'
  entry: string
  author?: string
  preview?: string
  background?: string
}
export interface StartupThemeInfo extends StartupThemeManifest { builtin: boolean; previewUrl?: string }
export interface ResolvedStartupTheme { info: StartupThemeInfo; root: string }
export interface StartupThemeCatalog { themes: StartupThemeInfo[]; selectedId: string }

const BUILTIN: StartupThemeInfo = { formatVersion: 1, id: 'corum-terminal', name: '代码汇聚', version: '1.1.0', type: 'html', entry: 'startup-terminal.html', background: '#0A0612', builtin: true }

function validateId(id: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id)) throw new Error('主题 ID 无效')
  validateThemePath(id)
}

export function validateStartupThemeManifest(value: unknown): StartupThemeManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('主题 manifest 格式无效')
  const m = value as Record<string, unknown>
  if (m.formatVersion !== 1) throw new Error('不支持的主题规范版本')
  for (const key of ['id', 'name', 'version', 'entry']) if (typeof m[key] !== 'string' || !(m[key] as string).trim()) throw new Error(`主题缺少有效的 ${key}`)
  validateId(m.id as string)
  validateThemePath(m.entry as string)
  if (m.type !== 'html' && m.type !== 'video') throw new Error('主题类型必须为 html 或 video')
  if (!(m.type === 'html' ? ['.html'] : ['.mp4', '.webm']).includes(extname(m.entry as string).toLowerCase())) throw new Error('主题入口文件类型无效')
  for (const key of ['author', 'preview', 'background']) if (m[key] !== undefined && typeof m[key] !== 'string') throw new Error(`主题 ${key} 格式无效`)
  if (m.preview !== undefined) {
    validateThemePath(m.preview as string)
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extname(m.preview as string).toLowerCase())) throw new Error('主题预览图格式无效')
  }
  if (m.background !== undefined && !/^#[0-9a-f]{6}$/i.test(m.background as string)) throw new Error('主题背景色格式无效')
  return { formatVersion: 1, id: m.id as string, name: m.name as string, version: m.version as string, type: m.type, entry: m.entry as string,
    ...(m.author === undefined ? {} : { author: m.author as string }), ...(m.preview === undefined ? {} : { preview: m.preview as string }), ...(m.background === undefined ? {} : { background: m.background as string }) }
}

/** 同时检查词法和 realpath 边界，防止安装后被替换成链接。 */
export async function resolveThemeFile(root: string, name: string): Promise<string> {
  validateThemePath(name)
  const base = await realpath(root)
  const file = await realpath(resolve(base, name))
  const rel = relative(base, file)
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`) || resolve(base, rel) !== file || !(await stat(file)).isFile()) throw new Error('主题资源越界或不是文件')
  return file
}

async function readInstalled(id: string, home: string): Promise<ResolvedStartupTheme> {
  validateId(id)
  const root = join(home, 'startup-themes', id)
  if ((await lstat(root)).isSymbolicLink()) throw new Error('主题目录不能是链接')
  const info = validateStartupThemeManifest(JSON.parse(await readFile(await resolveThemeFile(root, 'manifest.json'), 'utf8')))
  if (info.id !== id || id === BUILTIN.id) throw new Error('主题 ID 与安装目录不一致')
  await resolveThemeFile(root, info.entry)
  if (info.preview) await resolveThemeFile(root, info.preview)
  return { root, info: { ...info, builtin: false, ...(info.preview ? { previewUrl: `corumapp://startup-preview/${id}/${info.preview.split('/').map(encodeURIComponent).join('/')}` } : {}) } }
}

export async function resolveStartupTheme(assetsDir: string, id?: string, home = settingsHome()): Promise<ResolvedStartupTheme> {
  const selected = id ?? readStartupThemeId(home)
  if (selected !== BUILTIN.id) {
    try { return await readInstalled(selected, home) } catch { /* 缺失或损坏时保留可启动性。 */ }
  }
  return { info: { ...BUILTIN }, root: assetsDir }
}

export async function listStartupThemes(assetsDir: string, home = settingsHome()): Promise<StartupThemeCatalog> {
  const themes: StartupThemeInfo[] = [{ ...BUILTIN }]
  for (const dir of await readdir(join(home, 'startup-themes'), { withFileTypes: true }).catch(() => [])) {
    if (!dir.isDirectory() || dir.name.startsWith('.')) continue
    try { themes.push((await readInstalled(dir.name, home)).info) } catch { /* 未完成或损坏的安装不进入列表。 */ }
  }
  const selectedId = (await resolveStartupTheme(assetsDir, readStartupThemeId(home), home)).info.id
  return { themes, selectedId }
}

export async function importStartupTheme(zipPath: string, home = settingsHome()): Promise<StartupThemeInfo> {
  const files = await readStartupThemeArchive(zipPath)
  const raw = files.get('manifest.json')
  if (!raw) throw new Error('ZIP 根目录缺少 manifest.json')
  const manifest = validateStartupThemeManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)))
  if (manifest.id === BUILTIN.id) throw new Error('不能替换内置主题')
  if (!files.has(manifest.entry)) throw new Error('主题入口文件不存在')
  if (manifest.preview && !files.has(manifest.preview)) throw new Error('主题预览图不存在')
  // 静态扫描 HTML 主题入口（解压后、写入前）；视频主题不扫描文本。
  if (manifest.type === 'html') {
    const entryBytes = files.get(manifest.entry)
    if (entryBytes) validateThemeHtml(new TextDecoder('utf-8', { fatal: true }).decode(entryBytes))
  }
  const parent = join(home, 'startup-themes')
  await mkdir(parent, { recursive: true })
  const existing = await readdir(parent)
  if (existing.some(id => id.toLowerCase() === manifest.id.toLowerCase())) throw new Error('主题已安装，请先删除旧主题')
  const staging = await mkdtemp(join(parent, '.import-'))
  try {
    for (const [name, data] of files) {
      const path = join(staging, name)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, data, { flag: 'wx' })
    }
    await rename(staging, join(parent, manifest.id))
    return { ...manifest, builtin: false }
  } finally { await rm(staging, { recursive: true, force: true }) }
}

export async function selectStartupTheme(id: string, assetsDir: string, home = settingsHome()): Promise<void> {
  if (id !== BUILTIN.id) await readInstalled(id, home)
  writeStartupThemeId(id, home)
}

export async function deleteStartupTheme(id: string, home = settingsHome()): Promise<void> {
  if (id === BUILTIN.id) throw new Error('内置主题不能删除')
  validateId(id)
  const root = join(home, 'startup-themes', id)
  if ((await lstat(root)).isSymbolicLink()) throw new Error('主题目录不能是链接')
  await rm(root, { recursive: true })
  if (readStartupThemeId(home) === id) writeStartupThemeId(BUILTIN.id, home)
}
