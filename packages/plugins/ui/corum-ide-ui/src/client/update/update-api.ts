/**
 * UpdateApi —— 更新检查能力接口（本地窄化，红线 3）。
 *
 * AppFrame 是纯组件不碰 cordis；host 侧 `@corum/corum-update-checker` 经
 * `@Remote` 暴露 RPC，这里窄化成 AppFrame / UpdatePanel 只需的几个方法。
 * 类型与 `@corum/corum-update-checker` 的 UpdateState 同构（结构窄化，不 import
 * 实现包——红线 3：跨 bundle type-face 用本地能力接口收窄）。
 *
 * @module corum-ide-ui/client/update/update-api
 */

/** 下载进度（与 host 侧 DownloadProgress 同构）。 */
export interface UpdateDownloadProgress {
  readonly receivedBytes: number
  readonly totalBytes: number
  readonly percent: number
}

/** 更新完整状态（与 host 侧 UpdateState 同构）。 */
export interface UpdateState {
  readonly phase: 'idle' | 'checking' | 'up-to-date' | 'update-available' | 'downloading' | 'downloaded-ready' | 'check-failed' | 'download-failed'
  readonly currentVersion: string
  readonly latestVersion: string | null
  readonly releaseUrl: string | null
  readonly releaseNotes: string | null
  readonly downloadAsset: {
    readonly platform: string
    readonly arch: string
    readonly filename: string
    readonly downloadUrl: string
    readonly size: number
  } | null
  readonly downloadProgress: UpdateDownloadProgress | null
  readonly downloadedFile: { readonly path: string; readonly filename: string; readonly size: number } | null
  readonly checkedAt: number | null
  readonly error: string | null
}

/**
 * 更新能力面（AppFrame / UpdatePanel 经 props 消费）。
 * 安装动作走 IPC（window.corumDesktop.installUpdate），不经此面。
 */
export interface UpdateApi {
  /** 取完整状态（O(1) 内存读，轮询用）。 */
  getState(): Promise<UpdateState | null>
  /** 执行检查（成功且有更新则自动开始下载）。 */
  check(): Promise<UpdateState>
  /** 手动触发下载（菜单「立即下载」/ 重试）。 */
  download(): Promise<UpdateState>
}

/** 是否有「需要用户关注的更新」——活动栏按钮的显示条件。 */
export function hasReadyUpdate(state: UpdateState | null): boolean {
  return state !== null && state.phase === 'downloaded-ready'
}

/** 是否有「有更新但未下载」——用户菜单红点角标的显示条件。 */
export function hasPendingUpdate(state: UpdateState | null): boolean {
  return state !== null && (state.phase === 'update-available' || state.phase === 'downloading' || state.phase === 'download-failed')
}

/** 有更新时的版本标签（如 `v0.5.0`）。 */
export function updateVersionLabel(state: UpdateState | null): string | null {
  return state?.latestVersion ?? null
}
