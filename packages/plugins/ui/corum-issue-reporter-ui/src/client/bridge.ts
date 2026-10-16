/**
 * `window.corumDesktop` 的**窄化能力面**（红线 3：跨 bundle 类型面不对齐时用本地
 * 能力接口收窄，不耦合实现包）。
 *
 * 这里只声明本插件真正用到的四个方法，全部 optional——桥整体可能缺席（纯 web
 * 构建 / 老 preload），逐个方法也可能缺席（旧版本没实现 `openExternal`）。
 * 消费方必须按「拿到才用、拿不到就降级」处理，禁止直接假定存在。
 *
 * `getAppVersion` / `getDshBaselineVersion` / `getPlatform` 是 preload 里**已有**
 * 的桥面（见 `packages/desktop/src/electron/preload.ts` 的 `CorumDesktopBridge`）；
 * `openExternal` 是本轮随插件一起新增的（host 侧 `corum:open-external`）。
 * @module corum-issue-reporter/client/bridge
 */

declare global {
  interface Window {
    /** 桌面 preload 暴露的桥（本插件只用到下面这四个方法）。 */
    corumDesktop?: IssueReporterBridge
  }
}

/** 本插件用到的桌面桥能力（全部 optional：缺席即降级）。 */
export interface IssueReporterBridge {
  /** 应用版本号（如 `0.2.1`）。 */
  getAppVersion?: () => Promise<string>
  /** dsh 基座版本号（取不到时 preload 给的是 undefined/null，两种都按「取不到」处理）。 */
  getDshBaselineVersion?: () => Promise<string | null>
  /** 实际运行平台（同步返回：平台是启动期常量）。 */
  getPlatform?: () => 'darwin' | 'linux' | 'win32'
  /**
   * 用系统默认浏览器打开外链（只放行 http/https，其余 scheme 由主进程拒绝）。
   * `ok:false` 视为打开失败，调用方要走失败态而不是假装成功。
   */
  openExternal?: (url: string) => Promise<{ ok: boolean; error?: string }>
}

/**
 * 从 window 读桥（SSR / 非桌面壳返回 undefined）。
 * @returns 桥梁对象或 undefined。
 */
export function readBridge(): IssueReporterBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return window.corumDesktop
}
