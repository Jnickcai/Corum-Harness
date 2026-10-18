/**
 * 启动期「自动安装待应用更新」（强制更新）。
 *
 * ## 为什么单独一个模块
 *
 * 这段逻辑要在**主窗口创建之前**跑（用户下次打开就是新版），而 `main.ts` 已经
 * 很重、且启动顺序敏感。单独成文件后，判断逻辑（要不要装、装哪个）可以脱离
 * Electron 运行时被单测直接验证 —— 这是本仓库对「宿主相关分支」的既有做法。
 *
 * ## 为什么必须确认「确实能装」
 *
 * 安装脚本会**替换正在运行的 .app**（darwin/linux），或交给 NSIS 静默安装
 * （win32）。一旦判断错误（比如文件其实不完整），用户会失去可用应用。
 * 所以这里只做**保守判断**：状态文件与下载文件都在、文件大小与记录一致、
 * 版本确实比当前新 —— 任何一条不满足就**不装**，退回正常启动。
 *
 * ## 失败即降级，绝不阻塞启动
 *
 * 安装失败（spawn 不起来、文件损坏）时返回 `failed`，调用方继续正常启动。
 * 「更新失败」永远不能变成「应用打不开」。
 *
 * @module corum-desktop/electron/startup-update
 */

import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

/** 待安装更新的判定结果。 */
export type PendingUpdateVerdict =
  | { readonly kind: 'none'; readonly reason: string }
  | { readonly kind: 'ready'; readonly version: string; readonly path: string }
  | { readonly kind: 'invalid'; readonly reason: string }

/** `update-state.json` 的形状（与 host 插件写入的一致）。 */
interface PersistedState {
  readonly version?: unknown
  readonly filename?: unknown
  readonly size?: unknown
}

/**
 * 比较两段 semver 是否 `candidate` 严格大于 `current`。
 *
 * 只支持 `X.Y.Z` 与可选预发布段（本仓库版本号就是这个形状，
 * 见 `docs/VERSIONING.md`）。**不引入 semver 依赖**：这里只需要一个方向判断，
 * 解析失败时一律返回 false（= 不装），这是安全侧。
 *
 * @param current - 当前运行版本。
 * @param candidate - 待安装版本。
 * @returns candidate > current 时为 true。
 */
export function isNewerVersion(current: string, candidate: string): boolean {
  const parse = (v: string): [number, number, number] | undefined => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(v.trim())
    if (m === null) return undefined
    return [Number(m[1]), Number(m[2]), Number(m[3])]
  }
  const a = parse(current)
  const b = parse(candidate)
  if (a === undefined || b === undefined) return false
  for (let i = 0; i < 3; i++) {
    if (b[i] > a[i]) return true
    if (b[i] < a[i]) return false
  }
  return false
}

/**
 * 判断「本次启动是否应当先安装更新」。
 *
 * @param updatesDir - 已下载更新的目录（`~/.corum/updates`）。
 * @param currentVersion - 当前运行版本。
 * @returns 判定结果；只有 `ready` 才应当触发安装。
 */
export function judgePendingUpdate(updatesDir: string, currentVersion: string): PendingUpdateVerdict {
  const statePath = join(updatesDir, 'update-state.json')
  if (!existsSync(statePath)) return { kind: 'none', reason: 'no update-state.json' }

  let state: PersistedState
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8')) as PersistedState
  } catch {
    return { kind: 'invalid', reason: 'update-state.json is not valid JSON' }
  }

  const version = typeof state.version === 'string' ? state.version : ''
  const filename = typeof state.filename === 'string' ? state.filename : ''
  const size = typeof state.size === 'number' ? state.size : 0
  if (version === '' || filename === '') {
    return { kind: 'invalid', reason: 'update-state.json is missing version/filename' }
  }

  // 记录里的版本不比当前新 ⇒ 这次更新已经应用过（或记录过期），不重复装。
  // 这一条很关键：安装成功重启后状态文件可能还在，若不做版本比较会形成
  // 「每次启动都重装一遍」的死循环。
  if (!isNewerVersion(currentVersion, version)) {
    return { kind: 'none', reason: `recorded version ${version} is not newer than ${currentVersion}` }
  }

  const filePath = join(updatesDir, filename)
  if (!existsSync(filePath)) return { kind: 'invalid', reason: `downloaded file missing: ${filename}` }

  // 大小必须与记录一致：不一致说明下载被中断（`.part` 之类）或文件被改动，
  // 拿这种文件替换应用是危险的。
  try {
    const actual = statSync(filePath).size
    if (size > 0 && actual !== size) {
      return { kind: 'invalid', reason: `size mismatch for ${filename}: recorded ${size}, actual ${actual}` }
    }
  } catch {
    return { kind: 'invalid', reason: `cannot stat ${filename}` }
  }

  return { kind: 'ready', version, path: filePath }
}

/**
 * 清理「已应用」的状态记录。
 *
 * 安装脚本成功后会删掉下载文件，但**状态文件由 host 插件写**，主进程不主动清。
 * 若版本比较已能挡住重复安装（见 `judgePendingUpdate`），这里不清理也是安全的；
 * 保留此函数是为了在「安装已开始」的时刻显式标记，便于排查。
 *
 * @param updatesDir - 更新目录。
 * @returns 是否删除成功（失败不抛，仅用于日志）。
 */
export function clearPendingUpdateState(updatesDir: string): boolean {
  const statePath = join(updatesDir, 'update-state.json')
  if (!existsSync(statePath)) return true
  try {
    // 用 unlinkSync 而不是写空内容：残留一个空文件会让下一次判断走 JSON 解析失败分支。
    unlinkSync(statePath)
    return true
  } catch {
    return false
  }
}
