/**
 * corum-issue-reporter 的**共享契约**（host 半边与 client 调用层共用）。
 *
 * 为什么单独一个文件：host 半（`src/index.ts`）与 client 半
 * （`src/client/github.ts`）必须是**同一份**返回形状——client 只做薄转发，
 * 不重新解释 host 的结果（这正是 corum-ollama / corum-web-search 的既有分工：
 * 类型面共用、调用面各自一层）。本模块零依赖（只有类型与一个常量），
 * 因此被 tsdown 打进两边都不会拖入任何运行时依赖。
 * @module corum-issue-reporter/types
 */

/** host 半边暴露的 cordis 服务名 = Typert Remote 命名空间（`/api/issueReporter/<method>`）。 */
export const ISSUE_REPORTER_SERVICE = 'issueReporter'

/**
 * 统一的失败信封（7 个方法共用）。
 *
 * `code` 是**稳定的机器可读码**（`invalid-token` / `rate-limited` /
 * `validation-failed` / `no-token` / …），UI 按它分档；`message` 是给人看的中文
 * 说明；`detail` 只在「有原文可附」时出现（GitHub 响应里的 message / errors[]）。
 * **任何分支都不会把 token 放进这三个字段**（host 半只把 token 用在 Authorization 头）。
 */
export interface GithubFailure {
  readonly ok: false
  readonly code: string
  readonly message: string
  readonly detail?: string
}

/** `authStart()` —— 申请 device flow 授权码。 */
export type AuthStartResult =
  | {
    readonly ok: true
    readonly deviceCode: string
    readonly userCode: string
    readonly verificationUri: string
    readonly expiresIn: number
    readonly interval: number
  }
  | GithubFailure

/** `authPoll()` —— 轮询授权结果（三态都在 `ok: true` 里，失败才走 failure）。 */
export type AuthPollResult =
  | { readonly ok: true; readonly status: 'authorized'; readonly login: string; readonly scopes: string }
  | { readonly ok: true; readonly status: 'pending' }
  | { readonly ok: true; readonly status: 'slow_down'; readonly interval: number }
  | GithubFailure

/** `authStatus()` —— 本地凭据 + 远端有效性。 */
export type AuthStatusResult =
  | { readonly ok: true; readonly authorized: false; readonly reason?: 'invalid-token' }
  | { readonly ok: true; readonly authorized: true; readonly login: string; readonly scopes: string }
  | GithubFailure

/** `signOut()` —— 清除本地凭据。 */
export type SignOutResult = { readonly ok: true } | GithubFailure

/** `ensureAssetsRepo()` —— 截图托管仓库（`<login>/corum-issue-assets-<login>`）。 */
export type EnsureAssetsRepoResult =
  | { readonly ok: true; readonly owner: string; readonly repo: string; readonly created: boolean }
  | GithubFailure

/** `uploadAsset()` —— 一张截图写进资产仓库。 */
export type UploadAssetResult =
  | { readonly ok: true; readonly url: string; readonly htmlUrl: string; readonly path: string }
  | GithubFailure

/** `submitIssue()` —— 在目标仓库建 issue。 */
export type SubmitIssueResult =
  | { readonly ok: true; readonly number: number; readonly url: string; readonly htmlUrl: string }
  | GithubFailure
