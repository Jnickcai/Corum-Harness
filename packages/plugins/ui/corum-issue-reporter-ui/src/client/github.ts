/**
 * `issueReporter` host 半边的**客户端调用层**（薄转发，零 UI、零状态）。
 *
 * ## 为什么是「薄函数 + 显式 connection」
 *
 * 形态照抄 corum-ollama（`src/client/index.tsx:89-95`）/ corum-web-search
 * （`src/client/index.tsx:57-66`）/ corum-memory：`connection.rpc.call('/api',
 * '<ns>/<method>', { args })`，失败时 `result.ok === false` 带 `error.code/message`。
 * 本层**只**做三件事：拼端点名、把 `{ args }` 传对、把 host 的返回原样交回。
 * 任何 UI 与状态管理都不在这里（面板是下一轮），所以它不碰 `ctx`、不注册 slot。
 *
 * ## host 半边缺席 / 旧版本
 *
 * 三种情况都必须**返回** `{ ok:false, code:'unsupported' }` 而**不是抛**：
 *   1. 调用方没拿到 connection（`createGithubClient(undefined)`）；
 *   2. 网关不认识这个端点（插件没挂/是旧版 host）——
 *      `gateway/invocation-unavailable`（`dsh-api-gateway/lib/index.js:779`）；
 *   3. 端点名在旧版 host 上不存在（`gateway/method-unavailable`）或定义已撤回
 *      （`gateway/definition-unavailable`）。
 *
 * 其余 RPC 层失败（`gateway/internal` 等）归 `rpc-error`，同样不抛——调用方只需要
 * 一个「可判定的失败信封」，不需要 try/catch。
 *
 * ## 类型面
 *
 * 返回类型与 host **同一份声明**（`src/types.ts`），本层不重新解释、不改写字段。
 * connection 不依赖 `@deepseek-ai/dsh-client-connection` 包，改用**本地窄化能力接口**
 * （红线 3：跨 bundle 类型面不对齐时用本地能力接口收窄，不耦合实现包）。
 * @module corum-issue-reporter/client/github
 */

import { ISSUE_REPORTER_SERVICE } from '../types.ts'
import type {
  AuthPollResult,
  AuthStartResult,
  AuthStatusResult,
  EnsureAssetsRepoResult,
  GithubFailure,
  SignOutResult,
  SubmitIssueResult,
  UploadAssetResult,
} from '../types.ts'

/** `/api` 通道（Typert 网关的唯一 HTTP 通道）。 */
const API_CHANNEL = '/api'

/** 网关「这个端点没人导出」的失败码（host 半缺席/旧版的判据）。 */
const UNSUPPORTED_RPC_CODES: readonly string[] = [
  'gateway/invocation-unavailable',
  'gateway/definition-unavailable',
  'gateway/method-unavailable',
]

/** RPC 返回信封（只声明本层读得到的那几个字段）。 */
export interface GithubRpcOutcome {
  readonly ok: boolean
  readonly value?: unknown
  readonly error?: { readonly code?: string; readonly message?: string }
}

/**
 * 本层需要的 connection 面（结构窄化，方法式声明 ⇒ 参数双变，任何兼容
 * `connection.rpc.call(channel, endpoint, payload, signal?)` 的实现都能传进来）。
 */
export interface GithubConnection {
  readonly rpc: {
    call(
      channel: string,
      endpoint: string,
      payload: { readonly args: Record<string, unknown> },
    ): Promise<GithubRpcOutcome>
  }
}

/** 7 个方法的薄包装（返回类型与 host 一致）。 */
export interface GithubClient {
  authStart(): Promise<AuthStartResult>
  authPoll(deviceCode: string): Promise<AuthPollResult>
  authStatus(): Promise<AuthStatusResult>
  signOut(): Promise<SignOutResult>
  ensureAssetsRepo(): Promise<EnsureAssetsRepoResult>
  uploadAsset(name: string, base64: string): Promise<UploadAssetResult>
  submitIssue(title: string, body: string, labels?: readonly string[]): Promise<SubmitIssueResult>
}

/** `unsupported` 失败信封（host 半缺席/旧版专用文案）。 */
function unsupported(detail: string): GithubFailure {
  return { ok: false, code: 'unsupported', message: `issue-reporter host 半边不可用：${detail}` }
}

/**
 * 造客户端调用层。
 * @param connection - `ctx.get('connection')`；缺席（旧壳/无连接）时每个方法都返回
 *   `{ ok:false, code:'unsupported' }`，调用方无需区分「没连接」与「host 没挂」。
 * @returns 7 个方法构成的薄客户端。
 */
export function createGithubClient(connection: GithubConnection | undefined | null): GithubClient {
  /**
   * 发一次 RPC 并把三种失败收敛成信封。
   * @returns host 的返回值（`ok:true`）或失败信封。
   */
  async function invoke(method: string, args: Record<string, unknown>): Promise<unknown> {
    if (connection === undefined || connection === null) {
      return unsupported('浏览器半没有拿到 connection')
    }
    let outcome: GithubRpcOutcome
    try {
      outcome = await connection.rpc.call(API_CHANNEL, `${ISSUE_REPORTER_SERVICE}/${method}`, { args })
    } catch (error) {
      // 连接层自身抛（信道断开/超时）：不是「不支持」，但同样不把异常丢给调用方。
      return {
        ok: false,
        code: 'rpc-error',
        message: `RPC 调用失败（${ISSUE_REPORTER_SERVICE}/${method}）：${error instanceof Error ? error.message : String(error)}`,
      } satisfies GithubFailure
    }
    if (outcome.ok) return outcome.value
    const code = outcome.error?.code ?? 'gateway/internal'
    const message = outcome.error?.message ?? '未知 RPC 失败'
    if (UNSUPPORTED_RPC_CODES.includes(code)) {
      return unsupported(`${code}（${ISSUE_REPORTER_SERVICE}/${method}）：${message}`)
    }
    return {
      ok: false,
      code: 'rpc-error',
      message: `${code}：${message}`,
    } satisfies GithubFailure
  }

  return {
    async authStart(): Promise<AuthStartResult> {
      return await invoke('authStart', {}) as AuthStartResult
    },
    async authPoll(deviceCode: string): Promise<AuthPollResult> {
      return await invoke('authPoll', { deviceCode }) as AuthPollResult
    },
    async authStatus(): Promise<AuthStatusResult> {
      return await invoke('authStatus', {}) as AuthStatusResult
    },
    async signOut(): Promise<SignOutResult> {
      return await invoke('signOut', {}) as SignOutResult
    },
    async ensureAssetsRepo(): Promise<EnsureAssetsRepoResult> {
      return await invoke('ensureAssetsRepo', {}) as EnsureAssetsRepoResult
    },
    async uploadAsset(name: string, base64: string): Promise<UploadAssetResult> {
      return await invoke('uploadAsset', { name, base64 }) as UploadAssetResult
    },
    async submitIssue(title: string, body: string, labels: readonly string[] = []): Promise<SubmitIssueResult> {
      return await invoke('submitIssue', { title, body, labels: [...labels] }) as SubmitIssueResult
    },
  }
}
