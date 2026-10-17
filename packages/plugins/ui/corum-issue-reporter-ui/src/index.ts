/**
 * @corum/corum-issue-reporter-ui —— **host 半边**（GitHub API 管线）。
 *
 * 本轮引入的能力（面板 UI 仍是下一轮）：在应用内直接走 GitHub API 完成
 * 「授权 → 建资产仓库 → 传截图 → 提 issue」的整条底层管线，**不再**靠手工组装
 * `issues/new` URL 交系统浏览器。
 *
 * ## 服务面（Typert Remote，命名空间 = 服务名 `issueReporter`）
 *
 * 客户端经 `connection.rpc.call('/api', 'issueReporter/<method>', { args })` 调用
 * （形态与 corum-ollama 的 `localLlm/*` 逐字相同）。7 个方法：
 *
 * | method | 端点 | 作用 |
 * |---|---|---|
 * | `authStart()` | POST github.com/login/device/code | 申请 device code |
 * | `authPoll(deviceCode)` | POST github.com/login/oauth/access_token | 轮询授权（token 落凭据库） |
 * | `authStatus()` | GET api.github.com/user | 本地凭据 + 远端有效性 |
 * | `signOut()` | —（凭据库 unset） | 清除本地 token |
 * | `ensureAssetsRepo()` | GET/POST `…/repos…` | 保证截图托管仓库存在 |
 * | `uploadAsset(name, base64)` | PUT Contents API | 传一张截图进 `issues/YYYY-MM/` |
 * | `submitIssue(title, body, labels)` | GET labels + POST issues | 提交 issue 到目标仓库 |
 *
 * ## ⚠️ 参数形态的硬约束（照抄自 typert SRC 网关的实现）
 *
 * `@Remote` 方法的参数只能是**唯一的标识符形参**：网关用
 * `Function.prototype.toString` 解析形参名（`dsh-api-gateway/lib/index.js:1010-1039`），
 * **解构 / 默认值 / rest 一律抛 `gateway/signature-invalid`**。所以规格里的
 * `authPoll({ deviceCode })` 落成 `authPoll(deviceCode: string)`，wire 上的字段名就是
 * 形参名（`{ args: { deviceCode } }`）——与 `corumReview/setRetention` 传
 * `{ args: { days } }`（host 侧是 `setRetention(days: number)`）同一套规则。
 *
 * ## token 纪律（红线）
 *
 * token 只在**本模块的内存**与**加密凭据库**之间流动：进 `Authorization: Bearer` 头、
 * 出 `credentials.set/unset/resolve`。**不写日志、不写 localStorage/settings、不进任何
 * 返回值或 message/detail**（失败分类函数根本不接受 token 入参）。
 *
 * @module @corum/corum-issue-reporter-ui
 */

import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  ACCESS_TOKEN_URL,
  ASSETS_REPO_DESCRIPTION,
  DEFAULT_POLL_INTERVAL_SECONDS,
  DEVICE_CODE_URL,
  GITHUB_API_VERSION,
  REQUEST_TIMEOUT_MS,
  SLOW_DOWN_STEP_SECONDS,
  USER_AGENT,
  assetMonth,
  assetRepoName,
  buildAccessTokenBody,
  buildDeviceCodeBody,
  buildIssuePayload,
  buildUploadBody,
  classifyApiFailure,
  classifyFetchError,
  contentPath,
  contentsUrl,
  currentUserUrl,
  fail,
  issuesUrl,
  labelsUrl,
  parseAccessTokenResponse,
  parseApiUrl,
  parseContentHtmlUrl,
  parseDeviceCodeResponse,
  parseDownloadUrl,
  parseHtmlUrl,
  parseIssueNumber,
  parseLabelNames,
  parseLogin,
  parseScopesHeader,
  repoUrl,
  sanitizeAssetName,
  stripBase64Prefix,
  suffixToken,
  userReposUrl,
  withSuffix,
} from './github-api.ts'
import { ISSUE_REPORTER_SERVICE } from './types.ts'
import type {
  AuthPollResult,
  AuthStartResult,
  AuthStatusResult,
  EnsureAssetsRepoResult,
  GithubFailure,
  SignOutResult,
  SubmitIssueResult,
  UploadAssetResult,
} from './types.ts'

export * from './types.ts'
export {
  GITHUB_API_BASE,
  GITHUB_API_VERSION,
  GITHUB_OAUTH_BASE,
  REQUEST_TIMEOUT_MS,
  USER_AGENT,
  classifyApiFailure,
  classifyFetchError,
  sanitizeAssetName,
} from './github-api.ts'

/**
 * OAuth App 的 client_id（GitHub → Settings → Developer settings → OAuth Apps）。
 *
 * device flow **只需要 client_id**（无 client secret），故它是可公开值；
 * 未配置时 {@link IssueReporterService.authStart} 直接拒绝发请求。
 */
export const GITHUB_CLIENT_ID = 'Ov23lidmyYwphoulfCj0'

/** 占位串（`authStart` 的防御性守卫：未替换就绝不发请求）。 */
const CLIENT_ID_PLACEHOLDER = 'REPLACE_WITH_OAUTH_APP_CLIENT_ID'

/** 目标仓库（issue 落这里）。 */
export const TARGET_REPO = { owner: 'kukucaiCndy', repo: 'Corum-Harness' }

/**
 * 凭据库 ref（`ctx.credentials` 的寻址键）。
 *
 * 依据：本仓既有 ref 命名风格是**大写环境变量式**（`DEEPSEEK_API_KEY` ——
 * `corum-ui-base/src/client/web-search-credential.ts:27`、`corum-web-search/src/deepseek-sub-provider.ts:50`），
 * 且官方 seam 的语法就在 `@deepseek-ai/dsh-credentials`：
 * `REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/`（`lib/index.js:14`）——点号形式的
 * `corum.issue-reporter.github` **会被 `credentialRef()` 直接抛 TypeError**，
 * 写进 credentials.yml 也会在下次启动被 `parseRefs()` 拒绝。故取等价的
 * 环境变量式名字 `CORUM_ISSUE_REPORTER_GITHUB_TOKEN`。
 */
export const TOKEN_REF = 'CORUM_ISSUE_REPORTER_GITHUB_TOKEN'

/** 品牌化的引用（每次调用都现取，避免把品牌值当可变状态传递）。 */
const tokenRef = credentialRef(TOKEN_REF)

/** HTTP 响应（已读出 body）。 */
interface HttpResponse {
  readonly status: number
  readonly headers: Headers
  readonly json: unknown
  readonly text: string
}

/** 请求结果：`ok:false` 一侧**只**带失败信封（不含 token）。 */
type RequestOutcome =
  | { readonly ok: true; readonly response: HttpResponse }
  | { readonly ok: false; readonly failure: GithubFailure }

/** 带 token 调 `/user` 的产物。 */
type LoginOutcome =
  | { readonly ok: true; readonly login: string; readonly scopes: string }
  | { readonly ok: false; readonly failure: GithubFailure }

/** 取 token 的产物。 */
type TokenOutcome =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false; readonly failure: GithubFailure }

/** Contents API 写入结果（`retryable` 只在 409/422 冲突时为 true）。 */
type PutOutcome =
  | { readonly ok: true; readonly result: UploadAssetResult }
  | { readonly ok: false; readonly failure: GithubFailure; readonly retryable: boolean }

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Issue 提交管线（GitHub device flow + 资产仓库 + issue 提交）。 */
    issueReporter: IssueReporterService
  }
}

/**
 * GitHub issue 提交管线服务。
 *
 * 无持久状态：唯一的「状态」是授权期间记住的轮询间隔（`pollIntervalSeconds`，
 * 供 `slow_down` 在**基准上 +5**，而不是写死一个数字）。token 一律现取现用。
 */
export class IssueReporterService extends TypertRemoteService {
  /** inject 由插件层声明（见文件尾 `inject`）；服务类自身不额外等待，同 corum-ollama。 */
  static inject: string[] = []

  /**
   * 最近一次 `authStart()` 返回的轮询间隔（秒）。
   * `slow_down` 时返回 `基准 + 5` 并就地更新——不写死 5。
   */
  private pollIntervalSeconds: number | undefined

  constructor(ctx: Context) {
    super(ctx, ISSUE_REPORTER_SERVICE)
  }

  // ── 内部：凭据 ────────────────────────────────────────────────────

  /**
   * 取凭据 seam（**每次现取**：credentials 可能在本插件之后装配；缺席是合法组合，
   * 同 corum-web-search/src/deepseek-sub-provider.ts:106-112 的 `ctx.get` 用法）。
   */
  private credentialsOf(): Context['credentials'] | undefined {
    return this.ctx.get('credentials')
  }

  /** 读本地 token；缺席 → `no-token` / `no-credentials`。 */
  private async readToken(): Promise<TokenOutcome> {
    const credentials = this.credentialsOf()
    if (credentials === undefined) {
      return { ok: false, failure: fail('no-credentials', '凭据服务不可用（credentials 未装配）') }
    }
    const resolved = await credentials.resolve(tokenRef)
    const value = resolved?.value
    if (value === undefined || value === '') {
      return { ok: false, failure: fail('no-token', '尚未授权 GitHub：请先完成设备授权') }
    }
    return { ok: true, token: value }
  }

  /** 写 token 进凭据库（**唯一**的落盘动作；不进日志/设置/返回值）。 */
  private async storeToken(token: string): Promise<{ ok: true } | { ok: false; failure: GithubFailure }> {
    const credentials = this.credentialsOf()
    if (credentials === undefined) {
      return { ok: false, failure: fail('no-credentials', '凭据服务不可用（credentials 未装配）') }
    }
    try {
      await credentials.set(tokenRef, token)
      return { ok: true }
    } catch (error) {
      return { ok: false, failure: fail('credentials-error', `保存凭据失败：${error instanceof Error ? error.message : String(error)}`) }
    }
  }

  // ── 内部：HTTP ────────────────────────────────────────────────────

  /**
   * 统一请求：`AbortController` + {@link REQUEST_TIMEOUT_MS} 超时，body 读成文本后
   * 尽力 JSON 解析（GitHub 的错误分支也可能是空体）。
   */
  private async request(url: string, init: RequestInit): Promise<RequestOutcome> {
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(url, { ...init, signal: controller.signal })
      const text = await response.text()
      let json: unknown
      if (text !== '') {
        try {
          json = JSON.parse(text) as unknown
        } catch {
          json = text
        }
      }
      return { ok: true, response: { status: response.status, headers: response.headers, json, text } }
    } catch (error) {
      return { ok: false, failure: classifyFetchError(error, REQUEST_TIMEOUT_MS) }
    } finally {
      clearTimeout(timer)
    }
  }

  /** 调 API 的公共头（token 只出现在这里）。 */
  private apiHeaders(token: string): Record<string, string> {
    return {
      'Accept': 'application/vnd.github+json',
      'User-Agent': USER_AGENT,
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      'Authorization': `Bearer ${token}`,
    }
  }

  /** 不带 token 的头（device flow 的两个端点）。 */
  private oauthHeaders(urlEncoded: boolean): Record<string, string> {
    return {
      'Accept': 'application/json',
      'User-Agent': USER_AGENT,
      ...(urlEncoded ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    }
  }

  /** 从响应里抽限流头（失败分类要用）。 */
  private rateLimitOf(response: HttpResponse): { rateLimitRemaining: string | null; rateLimitReset: string | null } {
    return {
      rateLimitRemaining: response.headers.get('x-ratelimit-remaining'),
      rateLimitReset: response.headers.get('x-ratelimit-reset'),
    }
  }

  /** `GET /user`（带 token）→ login + scopes。 */
  private async fetchLogin(token: string): Promise<LoginOutcome> {
    const outcome = await this.request(currentUserUrl(), { method: 'GET', headers: this.apiHeaders(token) })
    if (!outcome.ok) return outcome
    const { status, headers, json } = outcome.response
    if (status !== 200) {
      return { ok: false, failure: classifyApiFailure({ status, body: json, ...this.rateLimitOf(outcome.response) }) }
    }
    const login = parseLogin(json)
    if (login === undefined) {
      return { ok: false, failure: fail('parse-error', 'GET /user 成功但响应里没有 login') }
    }
    return { ok: true, login, scopes: parseScopesHeader(headers.get('x-oauth-scopes')) }
  }

  // ── 7 个 @Remote 方法 ─────────────────────────────────────────────

  /** 申请 device flow 授权码（未配置 client_id 则**不发请求**）。 */
  @Remote('authStart')
  async authStart(): Promise<AuthStartResult> {
    const clientId = GITHUB_CLIENT_ID.trim()
    if (clientId === '' || clientId === CLIENT_ID_PLACEHOLDER || clientId.startsWith('REPLACE_WITH')) {
      return fail('no-client-id', '插件尚未配置 OAuth App client_id')
    }
    const outcome = await this.request(DEVICE_CODE_URL, {
      method: 'POST',
      headers: this.oauthHeaders(true),
      body: buildDeviceCodeBody(clientId),
    })
    if (!outcome.ok) return outcome.failure
    const { status, json } = outcome.response
    if (status !== 200) {
      return classifyApiFailure({ status, body: json, ...this.rateLimitOf(outcome.response) })
    }
    const payload = parseDeviceCodeResponse(json)
    if (payload === null) {
      return fail('parse-error', 'device code 响应缺少 device_code/user_code/verification_uri', JSON.stringify(json))
    }
    // 记住基准间隔：`slow_down` 要在这个值上 +5（规格：不要写死 5）。
    this.pollIntervalSeconds = payload.interval
    return {
      ok: true,
      deviceCode: payload.deviceCode,
      userCode: payload.userCode,
      verificationUri: payload.verificationUri,
      expiresIn: payload.expiresIn,
      interval: payload.interval,
    }
  }

  /**
   * 轮询授权结果。拿到 token 就**存进凭据库**再取 `login`，返回 `authorized`。
   * `authorization_pending` / `slow_down` 都是**正常态**（`ok:true`）。
   */
  @Remote('authPoll')
  async authPoll(deviceCode: string): Promise<AuthPollResult> {
    if (typeof deviceCode !== 'string' || deviceCode.trim() === '') {
      return fail('bad-request', 'device_code 不能为空')
    }
    const outcome = await this.request(ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: this.oauthHeaders(true),
      body: buildAccessTokenBody(GITHUB_CLIENT_ID.trim(), deviceCode.trim()),
    })
    if (!outcome.ok) return outcome.failure
    const { status, json } = outcome.response
    if (status !== 200) {
      return classifyApiFailure({ status, body: json, ...this.rateLimitOf(outcome.response) })
    }
    const payload = parseAccessTokenResponse(json)
    if (payload.accessToken !== undefined) {
      const stored = await this.storeToken(payload.accessToken)
      if (!stored.ok) return stored.failure
      const user = await this.fetchLogin(payload.accessToken)
      if (!user.ok) return user.failure
      // scope：优先取 token 响应里的 scope（本次授权实际授予的），否则回落 x-oauth-scopes。
      return {
        ok: true,
        status: 'authorized',
        login: user.login,
        scopes: payload.scope !== undefined ? parseScopesHeader(payload.scope) : user.scopes,
      }
    }
    if (payload.error === 'authorization_pending') return { ok: true, status: 'pending' }
    if (payload.error === 'slow_down') {
      const base = this.pollIntervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS
      const next = base + SLOW_DOWN_STEP_SECONDS
      this.pollIntervalSeconds = next
      return { ok: true, status: 'slow_down', interval: next }
    }
    return fail(
      payload.error ?? 'unknown-error',
      payload.errorDescription ?? 'GitHub 未返回 access_token，也未给出 error',
    )
  }

  /**
   * 授权状态：无凭据 ⇒ `{authorized:false}`；有凭据则 `GET /user`——
   * **401 不当失败抛**，而是 `{authorized:false, reason:'invalid-token'}`（token 过期）。
   */
  @Remote('authStatus')
  async authStatus(): Promise<AuthStatusResult> {
    const token = await this.readToken()
    if (!token.ok) {
      const { failure } = token
      if (failure.code === 'no-token') return { ok: true, authorized: false }
      return failure
    }
    const outcome = await this.request(currentUserUrl(), { method: 'GET', headers: this.apiHeaders(token.token) })
    if (!outcome.ok) return outcome.failure
    const { status, headers, json } = outcome.response
    if (status === 401) return { ok: true, authorized: false, reason: 'invalid-token' }
    if (status !== 200) {
      return classifyApiFailure({ status, body: json, ...this.rateLimitOf(outcome.response) })
    }
    const login = parseLogin(json)
    if (login === undefined) {
      return fail('parse-error', 'GET /user 成功但响应里没有 login')
    }
    return { ok: true, authorized: true, login, scopes: parseScopesHeader(headers.get('x-oauth-scopes')) }
  }

  /** 退出授权：从凭据库删掉该 ref（token 不进日志）。 */
  @Remote('signOut')
  async signOut(): Promise<SignOutResult> {
    const credentials = this.credentialsOf()
    if (credentials === undefined) {
      return fail('no-credentials', '凭据服务不可用（credentials 未装配）')
    }
    try {
      await credentials.unset(tokenRef)
      return { ok: true }
    } catch (error) {
      return fail('credentials-error', `清除凭据失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * 保证资产仓库存在：`<login>/corum-issue-assets-<login>`。
   * 不存在则建（**`auto_init: true` 必须带**——没有初始提交的仓库无法用 Contents API
   * 写文件）；`422 name already exists` 当作成功。仓库是 public（截图要能贴进 issue）。
   */
  @Remote('ensureAssetsRepo')
  async ensureAssetsRepo(): Promise<EnsureAssetsRepoResult> {
    const token = await this.readToken()
    if (!token.ok) return token.failure
    const user = await this.fetchLogin(token.token)
    if (!user.ok) return user.failure
    const repo = assetRepoName(user.login)
    const probe = await this.request(repoUrl(user.login, repo), { method: 'GET', headers: this.apiHeaders(token.token) })
    if (!probe.ok) return probe.failure
    if (probe.response.status === 200) return { ok: true, owner: user.login, repo, created: false }
    if (probe.response.status !== 404) {
      return classifyApiFailure({ status: probe.response.status, body: probe.response.json, ...this.rateLimitOf(probe.response) })
    }
    const created = await this.request(userReposUrl(), {
      method: 'POST',
      headers: { ...this.apiHeaders(token.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: repo,
        private: false,
        auto_init: true,
        description: ASSETS_REPO_DESCRIPTION,
      }),
    })
    if (!created.ok) return created.failure
    if (created.response.status === 201) return { ok: true, owner: user.login, repo, created: true }
    // 竞态/重名：仓库已经在了 ⇒ 当作成功（created:false：不是本次建的）。
    if (created.response.status === 422) return { ok: true, owner: user.login, repo, created: false }
    return classifyApiFailure({ status: created.response.status, body: created.response.json, ...this.rateLimitOf(created.response) })
  }

  /**
   * 传一张截图进资产仓库 `issues/YYYY-MM/<safeName>`（Contents API PUT）。
   * 文件名先安全化；409/422 冲突时**加 4 位随机后缀重试一次**。
   */
  @Remote('uploadAsset')
  async uploadAsset(name: string, base64: string): Promise<UploadAssetResult> {
    const repo = await this.ensureAssetsRepo()
    if (!repo.ok) return repo
    const token = await this.readToken()
    if (!token.ok) return token.failure
    const content = stripBase64Prefix(typeof base64 === 'string' ? base64 : '')
    if (content === '') return fail('bad-request', 'base64 内容为空')
    const baseName = sanitizeAssetName(typeof name === 'string' ? name : '')
    const month = assetMonth(new Date())
    const first = await this.putContent(token.token, repo.owner, repo.repo, contentPath(month, baseName), baseName, content)
    if (first.ok) return first.result
    if (!first.retryable) return first.failure
    const retryName = withSuffix(baseName, suffixToken(Math.random()))
    const second = await this.putContent(token.token, repo.owner, repo.repo, contentPath(month, retryName), retryName, content)
    if (second.ok) return second.result
    return second.failure
  }

  /** Contents API 单次 PUT（`retryable` 只在 409/422 冲突时为 true）。 */
  private async putContent(
    token: string,
    owner: string,
    repo: string,
    path: string,
    name: string,
    base64: string,
  ): Promise<PutOutcome> {
    const outcome = await this.request(contentsUrl(owner, repo, path), {
      method: 'PUT',
      headers: { ...this.apiHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(buildUploadBody(name, base64)),
    })
    if (!outcome.ok) return { ok: false, failure: outcome.failure, retryable: false }
    const { status, json } = outcome.response
    if (status === 200 || status === 201) {
      const url = parseDownloadUrl(json)
      const htmlUrl = parseContentHtmlUrl(json)
      if (url === undefined || htmlUrl === undefined) {
        return { ok: false, failure: fail('parse-error', '上传成功但响应缺少 content.download_url/html_url'), retryable: false }
      }
      return { ok: true, result: { ok: true, url, htmlUrl, path } }
    }
    const failure = classifyApiFailure({ status, body: json, ...this.rateLimitOf(outcome.response) })
    // 路径已存在（409/422）：换个带随机后缀的名字再试一次。
    return { ok: false, failure, retryable: status === 409 || status === 422 }
  }

  /**
   * 提交 issue 到 {@link TARGET_REPO}。
   *
   * label 策略：先读目标仓库现有 label（`?per_page=100`），**只提交其中存在的**；
   * 一个都不剩就整体省略 `labels` 字段；那个 GET 失败**不致命**（照常提交，只是不带 label）。
   */
  @Remote('submitIssue')
  async submitIssue(title: string, body: string, labels: string[]): Promise<SubmitIssueResult> {
    if (typeof title !== 'string' || title.trim() === '') {
      return fail('bad-request', 'issue 标题不能为空')
    }
    const token = await this.readToken()
    if (!token.ok) return token.failure
    const existing = await this.existingLabels(token.token)
    const wanted = Array.isArray(labels) ? labels : []
    const payload = buildIssuePayload(title, typeof body === 'string' ? body : '', existing, wanted)
    const outcome = await this.request(issuesUrl(TARGET_REPO.owner, TARGET_REPO.repo), {
      method: 'POST',
      headers: { ...this.apiHeaders(token.token), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!outcome.ok) return outcome.failure
    const { status, json } = outcome.response
    if (status !== 201) {
      return classifyApiFailure({ status, body: json, ...this.rateLimitOf(outcome.response) })
    }
    const number = parseIssueNumber(json)
    const htmlUrl = parseHtmlUrl(json)
    if (number === undefined || htmlUrl === undefined) {
      return fail('parse-error', '创建 issue 成功但响应缺少 number/html_url')
    }
    return { ok: true, number, url: parseApiUrl(json) ?? htmlUrl, htmlUrl }
  }

  /** 目标仓库现有 label 名（任何失败都返回空数组：不因它阻断提交）。 */
  private async existingLabels(token: string): Promise<string[]> {
    const outcome = await this.request(labelsUrl(TARGET_REPO.owner, TARGET_REPO.repo, 100), {
      method: 'GET',
      headers: this.apiHeaders(token),
    })
    if (!outcome.ok || outcome.response.status !== 200) return []
    return parseLabelNames(outcome.response.json)
  }
}

/** Cordis 插件名。 */
export const name = 'corum-issue-reporter'

/**
 * 运行时依赖的服务。
 *
 * 本插件**没有必需**的 host 依赖：credentials 是按需现取的**可选** seam
 * （缺席时 `authStatus/signOut/...` 返回 `no-credentials`，而不是让整个插件不装配）——
 * 与 corum-web-search 把 credentials 留在 inject 之外的分档一致
 * （`corum-web-search/src/index.ts:52-61`）。client 半的 `connection` 要求是
 * **客户端** inject 的事（见 `src/client/index.ts`），与 host 无关。
 */
export const inject: string[] = []

/**
 * 挂载 `issueReporter` 服务（幂等：重复 apply 不再注册，避免 cordis
 * 「service has been registered」硬错——同 corum-ollama / corum-web-search 的既有做法）。
 *
 * @param ctx - host cordis context.
 */
export function apply(ctx: Context): void {
  if (ctx.get(ISSUE_REPORTER_SERVICE) === undefined) {
    new IssueReporterService(ctx)
  }
}
