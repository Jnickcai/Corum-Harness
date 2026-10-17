/**
 * corum-issue-reporter —— GitHub REST 的**纯函数层**（URL 构造 / 请求体 / 响应解析 /
 * 错误分类 / 资产文件名安全化）。
 *
 * 本模块**零依赖、零 IO**（不 import 任何包，不碰 `fetch`，不碰 token 值）：host 半边
 * 的网络路径直接引用它们，`scripts/check-github-pure.mjs` 也能对 tsc 产物逐条断言
 * （不发一个网络请求、不带任何真 token 即可证明 URL 与错误映射是对的）。
 * @module corum-issue-reporter/github-api
 */

import type { GithubFailure } from './types.ts'

/** GitHub 网页域（OAuth device flow 的两个端点在这里）。 */
export const GITHUB_OAUTH_BASE = 'https://github.com'
/** GitHub REST API 域。 */
export const GITHUB_API_BASE = 'https://api.github.com'
/** REST API 版本头（GitHub 要求的钉版本头）。 */
export const GITHUB_API_VERSION = '2022-11-28'
/** 每个请求的 User-Agent（GitHub 拒绝无 UA 的请求）。 */
export const USER_AGENT = 'corum-issue-reporter'
/** 统一请求超时（ms）——一律用 AbortController 实现。 */
export const REQUEST_TIMEOUT_MS = 15_000
/** device flow 申请的 scope（建仓库 + 提交 issue 都需要 public_repo）。 */
export const OAUTH_SCOPE = 'public_repo'
/** device flow 的 grant_type（RFC 8628）。 */
export const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'
/** `slow_down` 的基础间隔缺省值（秒）——只在「没先调 authStart」时兜底，不是写死的轮询值。 */
export const DEFAULT_POLL_INTERVAL_SECONDS = 5
/** `slow_down` 的递增步长（秒）。 */
export const SLOW_DOWN_STEP_SECONDS = 5
/** 资产文件名允许的扩展名（强制落到其中之一）。 */
export const ASSET_EXTENSIONS: readonly string[] = ['.png', '.jpg', '.gif', '.webp']
/** 资产文件名长度上限（含扩展名）。 */
export const ASSET_NAME_MAX = 80
/** 资产在仓库里的月份目录格式（UTC）。 */
export const ASSET_DIR_PREFIX = 'issues'

/** device flow 授权码端点。 */
export const DEVICE_CODE_URL = `${GITHUB_OAUTH_BASE}/login/device/code`
/** device flow 取 token 端点。 */
export const ACCESS_TOKEN_URL = `${GITHUB_OAUTH_BASE}/login/oauth/access_token`

/** 构造失败信封（`detail` 为空串/undefined 时整体省略，兼容 exactOptionalPropertyTypes）。 */
export function fail(code: string, message: string, detail?: string): GithubFailure {
  return detail === undefined || detail === ''
    ? { ok: false, code, message }
    : { ok: false, code, message, detail }
}

// ── URL / 请求体 ────────────────────────────────────────────────────

/** `application/x-www-form-urlencoded` 编码。 */
export function formEncode(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
}

/** `POST /login/device/code` 的 body。 */
export function buildDeviceCodeBody(clientId: string): string {
  return formEncode({ client_id: clientId, scope: OAUTH_SCOPE })
}

/** `POST /login/oauth/access_token` 的 body。 */
export function buildAccessTokenBody(clientId: string, deviceCode: string): string {
  return formEncode({
    client_id: clientId,
    device_code: deviceCode,
    grant_type: DEVICE_GRANT_TYPE,
  })
}

/** `GET /user`。 */
export function currentUserUrl(): string {
  return `${GITHUB_API_BASE}/user`
}

/** `POST /user/repos`（建资产仓库）。 */
export function userReposUrl(): string {
  return `${GITHUB_API_BASE}/user/repos`
}

/** `GET /repos/{owner}/{repo}`。 */
export function repoUrl(owner: string, repo: string): string {
  return `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
}

/** `GET /repos/{owner}/{repo}/labels`。 */
export function labelsUrl(owner: string, repo: string, perPage: number = 100): string {
  return `${repoUrl(owner, repo)}/labels?per_page=${perPage}`
}

/** `POST /repos/{owner}/{repo}/issues`。 */
export function issuesUrl(owner: string, repo: string): string {
  return `${repoUrl(owner, repo)}/issues`
}

/** Contents API 端点（PUT 写文件 / 404 语义与仓库端点一致）。 */
export function contentsUrl(owner: string, repo: string, path: string): string {
  const quoted = path.split('/').map(segment => encodeURIComponent(segment)).join('/')
  return `${repoUrl(owner, repo)}/contents/${quoted}`
}

/** 资产仓库名：`corum-issue-assets-<login>`。 */
export function assetRepoName(login: string): string {
  return `${corumIssueAssetsPrefix()}${login}`
}

/** 资产仓库名前缀（单独导出，便于报告与断言里引用同一份字面量）。 */
export function corumIssueAssetsPrefix(): string {
  return 'corum-issue-assets-'
}

/** 资产仓库描述（建仓时写死）。 */
export const ASSETS_REPO_DESCRIPTION = 'Screenshots attached to issues reported from the Corum app'

/** Contents API 的写入 body（base64 不带 `data:` 前缀）。 */
export function buildUploadBody(name: string, base64: string): { message: string; content: string } {
  return { message: `add ${name}`, content: base64 }
}

/** 月份目录（UTC，`YYYY-MM`）——显式传 Date 才能被断言。 */
export function assetMonth(now: Date): string {
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

/** 资产在仓库内的路径：`issues/YYYY-MM/<safeName>`。 */
export function contentPath(month: string, safeName: string): string {
  return `${ASSET_DIR_PREFIX}/${month}/${safeName}`
}

/**
 * 资产文件名安全化：只留 `[A-Za-z0-9._-]`，强制落到
 * `.png`/`.jpg`/`.gif`/`.webp` 之一，总长 ≤ {@link ASSET_NAME_MAX}。
 */
export function sanitizeAssetName(raw: string): string {
  const cleaned = (raw ?? '').replace(/[^A-Za-z0-9._-]/g, '')
  const lower = cleaned.toLowerCase()
  const ext = ASSET_EXTENSIONS.find(candidate => lower.endsWith(candidate)) ?? '.png'
  const withoutExt = lower.endsWith(ext) ? cleaned.slice(0, cleaned.length - ext.length) : cleaned
  // 去掉前导点（避免隐藏文件名）与尾部点（GitHub/Windows 都别扭）
  let stem = withoutExt.replace(/^\.+/, '').replace(/\.+$/, '')
  if (stem === '') stem = 'screenshot'
  const maxStem = Math.max(1, ASSET_NAME_MAX - ext.length)
  return `${stem.slice(0, maxStem)}${ext}`
}

/** 4 位 base36 冲突后缀（传入 0..1 的随机数，便于断言）。 */
export function suffixToken(random: number): string {
  const clamped = Number.isFinite(random) ? Math.min(Math.max(random, 0), 0.9999999999) : 0
  return Math.floor(clamped * 36 ** 4).toString(36).padStart(4, '0')
}

/** 冲突重试时在扩展名前插 `-<token>`。 */
export function withSuffix(safeName: string, token: string): string {
  const dot = safeName.lastIndexOf('.')
  const stem = dot > 0 ? safeName.slice(0, dot) : safeName
  const ext = dot > 0 ? safeName.slice(dot) : ''
  const maxStem = Math.max(1, ASSET_NAME_MAX - ext.length - token.length - 1)
  return `${stem.slice(0, maxStem)}-${token}${ext}`
}

/** 去掉可能的 `data:image/png;base64,` 前缀与空白（契约上不带，防御性剥一次）。 */
export function stripBase64Prefix(value: string): string {
  const trimmed = (value ?? '').replace(/\s+/g, '')
  const commaIndex = trimmed.indexOf(',')
  if (trimmed.startsWith('data:') && commaIndex >= 0) return trimmed.slice(commaIndex + 1)
  return trimmed
}

/**
 * issue 提交体：只提交**目标仓库已存在**的 label；一个都不剩时整体省略 `labels`
 * 字段（GitHub 对不存在的 label 会 422）。
 */
export function buildIssuePayload(
  title: string,
  body: string,
  existing: readonly string[],
  wanted: readonly string[],
): { title: string; body: string; labels?: string[] } {
  const existingSet = new Set(existing)
  const accepted = wanted.filter(label => existingSet.has(label))
  return accepted.length === 0 ? { title, body } : { title, body, labels: accepted }
}

/** 解析现存的 label 名集合（响应形状不对时给空数组）。 */
export function parseLabelNames(json: unknown): string[] {
  if (!Array.isArray(json)) return []
  const names: string[] = []
  for (const entry of json) {
    const name = asRecord(entry)?.['name']
    if (typeof name === 'string' && name !== '') names.push(name)
  }
  return names
}

/** 解析 `login` 字段。 */
export function parseLogin(json: unknown): string | undefined {
  const login = asRecord(json)?.['login']
  return typeof login === 'string' && login !== '' ? login : undefined
}

/** 解析 issue 的 `number`。 */
export function parseIssueNumber(json: unknown): number | undefined {
  const number = asRecord(json)?.['number']
  return typeof number === 'number' && Number.isFinite(number) ? number : undefined
}

/** 解析 `html_url`。 */
export function parseHtmlUrl(json: unknown): string | undefined {
  const htmlUrl = asRecord(json)?.['html_url']
  return typeof htmlUrl === 'string' && htmlUrl !== '' ? htmlUrl : undefined
}

/** 解析 `url`（API URL）。 */
export function parseApiUrl(json: unknown): string | undefined {
  const url = asRecord(json)?.['url']
  return typeof url === 'string' && url !== '' ? url : undefined
}

/** 解析 `content.download_url`。 */
export function parseDownloadUrl(json: unknown): string | undefined {
  const downloadUrl = asRecord(asRecord(json)?.['content'])?.['download_url']
  return typeof downloadUrl === 'string' && downloadUrl !== '' ? downloadUrl : undefined
}

/** 解析 `content.html_url`。 */
export function parseContentHtmlUrl(json: unknown): string | undefined {
  const htmlUrl = asRecord(asRecord(json)?.['content'])?.['html_url']
  return typeof htmlUrl === 'string' && htmlUrl !== '' ? htmlUrl : undefined
}

/** `POST /login/device/code` 的成功响应（字段名与 GitHub 一致）。 */
export interface DeviceCodePayload {
  readonly deviceCode: string
  readonly userCode: string
  readonly verificationUri: string
  readonly expiresIn: number
  readonly interval: number
}

/** 解析 device code 响应；字段缺失/类型不对返回 null（调用方转成 parse-error）。 */
export function parseDeviceCodeResponse(json: unknown): DeviceCodePayload | null {
  const record = asRecord(json)
  if (record === undefined) return null
  const deviceCode = record['device_code']
  const userCode = record['user_code']
  const verificationUri = record['verification_uri']
  if (typeof deviceCode !== 'string' || typeof userCode !== 'string' || typeof verificationUri !== 'string') return null
  const expiresIn = record['expires_in']
  const interval = record['interval']
  return {
    deviceCode,
    userCode,
    verificationUri,
    expiresIn: typeof expiresIn === 'number' && Number.isFinite(expiresIn) ? expiresIn : 900,
    interval: typeof interval === 'number' && Number.isFinite(interval) && interval > 0
      ? interval
      : DEFAULT_POLL_INTERVAL_SECONDS,
  }
}

/** `POST /login/oauth/access_token` 的响应（成功与 device flow 错误共用一张形状）。 */
export interface AccessTokenPayload {
  readonly accessToken?: string
  readonly scope?: string
  readonly error?: string
  readonly errorDescription?: string
}

/** 解析 access_token 响应（`error` 分支原样带出，交给调用方分档）。 */
export function parseAccessTokenResponse(json: unknown): AccessTokenPayload {
  const record = asRecord(json) ?? {}
  const accessToken = record['access_token']
  const scope = record['scope']
  const error = record['error']
  const errorDescription = record['error_description']
  return {
    ...(typeof accessToken === 'string' && accessToken !== '' ? { accessToken } : {}),
    ...(typeof scope === 'string' ? { scope } : {}),
    ...(typeof error === 'string' && error !== '' ? { error } : {}),
    ...(typeof errorDescription === 'string' && errorDescription !== '' ? { errorDescription } : {}),
  }
}

/** `x-oauth-scopes` 头 → 逗号分隔的 scope 串（缺头给空串）。 */
export function parseScopesHeader(value: string | null | undefined): string {
  if (value === null || value === undefined) return ''
  return value.split(',').map(part => part.trim()).filter(part => part !== '').join(', ')
}

// ── 错误分类 ────────────────────────────────────────────────────────

/** 分类输入：状态码 + 两个限流头 + 已解析的响应体。 */
export interface GithubErrorInput {
  readonly status: number
  readonly rateLimitRemaining?: string | null
  readonly rateLimitReset?: string | null
  readonly body?: unknown
}

/** 响应体里的 `message`（GitHub 的错误摘要）。 */
export function extractMessage(body: unknown): string | undefined {
  const message = asRecord(body)?.['message']
  return typeof message === 'string' && message !== '' ? message : undefined
}

/** 响应体里的 `errors[]` 原文（逐条 JSON，422 校验失败用）。 */
export function extractErrors(body: unknown): string[] {
  const errors = asRecord(body)?.['errors']
  if (!Array.isArray(errors)) return []
  return errors.map(entry => (typeof entry === 'string' ? entry : JSON.stringify(entry)))
}

/** `detail` 字段：原文的 JSON（截断，避免把整个响应体塞进 UI）。 */
export function errorDetail(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  if (text === undefined || text === '' || text === '{}') return undefined
  return text.length > 800 ? `${text.slice(0, 800)}…` : text
}

/** `x-ratelimit-reset`（epoch 秒）→ 可读 UTC 时间；缺失/非法给 null。 */
export function readableReset(reset: string | null | undefined): string | null {
  if (reset === null || reset === undefined || reset.trim() === '') return null
  const seconds = Number(reset)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return new Date(seconds * 1000).toISOString()
}

/**
 * HTTP 失败 → 稳定失败码。**输入里没有任何 token 字段**，输出因此不可能泄 token。
 *
 * 分类（规格逐条）：401 token 失效；403 且 `x-ratelimit-remaining === '0'` 限流
 * （带 reset 可读时间）；404 仓库不可见；410 issues 已关闭；422 校验失败
 * （带 `message` 与 `errors[]` 原文）；5xx 服务端错误；其余 http-error。
 */
export function classifyApiFailure(input: GithubErrorInput): GithubFailure {
  const { status } = input
  const detail = errorDetail(input.body)
  const serverMessage = extractMessage(input.body)
  const errors = extractErrors(input.body)
  const notFoundMessage = serverMessage !== undefined
    ? `目标不可见或不存在（404）：${serverMessage}`
    : '目标不可见或不存在（404）'
  if (status === 401) {
    return fail('invalid-token', 'GitHub 授权已失效（401），请重新授权', detail)
  }
  if (status === 403 && input.rateLimitRemaining === '0') {
    const reset = readableReset(input.rateLimitReset)
    return fail(
      'rate-limited',
      `GitHub API 限流（403），配额恢复时间：${reset ?? '未知'}`,
      detail,
    )
  }
  if (status === 403) return fail('forbidden', serverMessage ?? 'GitHub 拒绝该请求（403）', detail)
  if (status === 404) return fail('not-found', notFoundMessage, detail)
  if (status === 410) return fail('issues-disabled', '目标仓库的 Issues 已被关闭（410）', detail)
  if (status === 422) {
    const errorText = errors.length > 0 ? `；errors: ${errors.join(' | ')}` : ''
    return fail('validation-failed', `GitHub 校验失败（422）：${serverMessage ?? '未知字段错误'}${errorText}`, detail)
  }
  if (status === 413) return fail('payload-too-large', '文件过大，GitHub 拒绝该上传（413）', detail)
  if (status >= 500) return fail('server-error', `GitHub 服务端错误（HTTP ${status}）`, detail)
  return fail('http-error', `GitHub 返回 HTTP ${status}${serverMessage !== undefined ? `：${serverMessage}` : ''}`, detail)
}

/** 网络层异常 → 失败码（超时与其它网络错误分开）。 */
export function classifyFetchError(error: unknown, timeoutMs: number = REQUEST_TIMEOUT_MS): GithubFailure {
  if (isAbortError(error)) {
    return fail('timeout', `请求超时（${Math.round(timeoutMs / 1000)}s）`)
  }
  const message = error instanceof Error ? error.message : String(error)
  return fail('network-error', `网络请求失败：${message}`)
}

/** AbortController 触发的中止（`signal.abort()` 在各运行时都落成 name=AbortError）。 */
export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}

/** 判一个值是不是可索引对象。 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}
