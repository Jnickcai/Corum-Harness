/**
 * 环境侦测（**渲染层半边**）—— issue 正文「### 环境」表的组装与渲染。
 *
 * ## 为什么单独一个模块
 *
 * 环境块有三个消费方：面板预览（折叠/展开）、正文拼装（`buildBody`）、以及自检
 * 脚本（`scripts/check-env.mjs` 直接 import 编译产物断言）。三处必须是**同一份**
 * 数据与**同一份**格式，否则「用户看到的」与「真提交的」会漂移——而这段东西是
 * 隐私敏感内容（用户取消勾选才有权不带），漂移就等于骗人。
 *
 * ## 字段面（12 项，一个都不许多）
 *
 * | 项 | 来源 |
 * |---|---|
 * | Corum | `window.corumDesktop.getAppVersion()`（桥） |
 * | dsh 基座 | host `envInfo`（`@deepseek-ai/dsh-base` 清单；退路见 host 半边） |
 * | 运行形态 | host `process.env.CORUM_DESKTOP_MODE` + `CORUM_DEBUG_PORT` |
 * | 操作系统 | host `os.type()` / `os.release()` / `os.version()` / `process.arch` |
 * | Electron / Chromium | `navigator.userAgent` |
 * | Node / V8 | host `process.versions` |
 * | 窗口 / 屏幕 | `window.innerWidth/innerHeight` / `devicePixelRatio` / `screen.*` |
 * | 语言 / 时区 | `navigator.language` / `Intl.DateTimeFormat()` |
 * | 主题 | `matchMedia('(prefers-color-scheme: dark)')` |
 * | CPU 线程 | `navigator.hardwareConcurrency` |
 * | 内存 | host `os.totalmem()`（GB 取整） |
 * | 窗口形态 | `location.search` 是否含 `floating` |
 *
 * ## 隐私红线（写进代码的约束，不是口号）
 *
 * **绝不采集**用户名、机器名、home/项目路径、IP、MAC、会话内容、token、文件列表。
 * 渲染层本来就摸不到这些；host 半边也只在返回值里放数值与版本号。此外每进入表格的
 * 值都过一遍 {@link cellOf}：单行化 + 把 `|` 换成全角 `／`（半个竖线会撑坏 markdown
 * 表格，且是注入表格结构的唯一入口）。
 *
 * @module corum-issue-reporter/client/env
 */

import { readBridge } from './bridge.ts'
import type { HostEnvInfo } from '../types.ts'

/** 缺项的统一写法（**整行都不许省**：维护者要能看出「没取到」而不是「不存在」）。 */
const UNKNOWN = 'unknown'

/** 预览默认展示的行数（其余靠「展开」）。 */
export const ENV_PREVIEW_ROWS = 4

/** 表里的一行（`key` = 项，`value` = 值）。 */
export interface EnvRow {
  readonly key: string
  readonly value: string
}

/** 合并后的环境表（数组顺序 = 正文里的行序 = 预览的行序）。 */
export type MergedEnv = readonly EnvRow[]

/** 渲染层能自己取到的字段（host 缺席时这一半仍然完整）。 */
export interface LocalEnv {
  /** 应用版本（`getAppVersion`）。 */
  readonly appVersion: string
  /** preload 给的基座版本（host `envInfo` 缺席时的退路）。 */
  readonly baseline: string
  /** UA 里的 `Electron/(\S+)`。 */
  readonly electron: string
  /** UA 里的 `Chrome/(\S+)`（Chromium 版本）。 */
  readonly chromium: string
  /** `1602×1078`。 */
  readonly windowSize: string
  /** `1.25`。 */
  readonly dpr: string
  /** `1920×1080`。 */
  readonly screen: string
  /** `zh-CN`。 */
  readonly language: string
  /** `Asia/Shanghai`。 */
  readonly timezone: string
  /** `dark` / `light`。 */
  readonly theme: string
  /** CPU 线程数（字符串形态，缺项 unknown）。 */
  readonly cpuThreads: string
  /** 是否浮窗（`location.search` 带 `floating`）。 */
  readonly floating: boolean
}

/** 全缺项的本地环境（首帧 / 非浏览器环境用；保证预览与正文格式稳定）。 */
export const UNKNOWN_LOCAL_ENV: LocalEnv = {
  appVersion: UNKNOWN,
  baseline: UNKNOWN,
  electron: UNKNOWN,
  chromium: UNKNOWN,
  windowSize: UNKNOWN,
  dpr: UNKNOWN,
  screen: UNKNOWN,
  language: UNKNOWN,
  timezone: UNKNOWN,
  theme: UNKNOWN,
  cpuThreads: UNKNOWN,
  floating: false,
}

/**
 * 值安全化：单行化 + `|` → `／`（markdown 表格单元格里出现裸 `|` 会把行切坏）。
 * @param value - 原始值（可能含换行/竖线）。
 * @returns 可安全放进表格单元格的值；空值 → `unknown`。
 */
function cellOf(value: string): string {
  const single = value.replace(/\s+/g, ' ').trim().replace(/\|/g, '／')
  return single === '' ? UNKNOWN : single
}

/**
 * 「取值或 unknown」。
 * @param value - 可能为空的值。
 * @returns 去掉首尾空白后的值；空/非字符串 → `unknown`。
 */
function known(value: string | null | undefined): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : UNKNOWN
}

/**
 * 用固定分隔符拼几段（**全 unknown 才写 unknown**，避免 `unknown · DPR 1.25` 这种噪音）。
 * @param parts - 各段（可为 unknown）。
 * @param separator - 分隔符。
 * @returns 拼好的值。
 */
function joinKnown(parts: readonly string[], separator: string): string {
  const real = parts.filter(part => part !== UNKNOWN && part !== '')
  return real.length === 0 ? UNKNOWN : real.join(separator)
}

/**
 * 「A / B」形态的两段（**逐段保留 unknown**：这里两段各自有意义，缺一段要让维护者看见）。
 * @param a - 第一段。
 * @param b - 第二段。
 * @returns `a / b`，两段都缺 → unknown。
 */
function pairOf(a: string, b: string): string {
  if (a === UNKNOWN && b === UNKNOWN) return UNKNOWN
  return `${a} / ${b}`
}

/**
 * 从 UA 里抓一个 token。
 * @param ua - `navigator.userAgent`。
 * @param pattern - 带一个捕获组的正则。
 * @returns 捕获值；匹配不到 → `unknown`。
 */
function uaToken(ua: string, pattern: RegExp): string {
  const matched = pattern.exec(ua)
  return matched?.[1] === undefined ? UNKNOWN : known(matched[1])
}

/**
 * 读桥上的一个异步字符串方法（异常的桥不把整个侦测带崩）。
 * @param read - 取值函数。
 * @returns 值或 `unknown`。
 */
async function bridgeString(read: () => Promise<string | null | undefined> | undefined): Promise<string> {
  try {
    return known(await read())
  } catch {
    return UNKNOWN
  }
}

/**
 * 当前是否浮窗（与 `src/client/index.ts`、`window-role.ts` 同一 URL 契约）。
 * @returns 带 `floating` 参数即 true。
 */
function isFloatingWindow(): boolean {
  try {
    if (typeof location === 'undefined') return false
    return new URLSearchParams(location.search).has('floating')
  } catch {
    return false
  }
}

/**
 * 当前配色主题。
 * @returns `dark` / `light`；`matchMedia` 缺席或抛 → `unknown`。
 */
function detectTheme(): string {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return UNKNOWN
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return UNKNOWN
  }
}

/**
 * 本地时区。
 * @returns IANA 时区名；`Intl` 抛 → `unknown`。
 */
function detectTimezone(): string {
  try {
    return known(new Intl.DateTimeFormat().resolvedOptions().timeZone)
  } catch {
    return UNKNOWN
  }
}

/**
 * 侦测渲染层能自己取到的环境（异步：桥的两个版本号方法是 Promise）。
 *
 * 全程不抛：任何一项取不到都落成 `unknown`，**不会**让面板因此不可用。
 * @returns 本地环境快照。
 */
export async function detectEnvLocal(): Promise<LocalEnv> {
  const bridge = readBridge()
  const appVersion = await bridgeString(() => bridge?.getAppVersion?.())
  const baseline = await bridgeString(() => bridge?.getDshBaselineVersion?.())
  const ua = typeof navigator === 'undefined' ? '' : String(navigator.userAgent ?? '')
  const screenSize = typeof window !== 'undefined' && typeof window.screen !== 'undefined'
    ? `${window.screen.width}×${window.screen.height}`
    : UNKNOWN
  const windowSize = typeof window === 'undefined' ? UNKNOWN : `${window.innerWidth}×${window.innerHeight}`
  const dpr = typeof window === 'undefined' || !Number.isFinite(window.devicePixelRatio)
    ? UNKNOWN
    : String(window.devicePixelRatio)
  const threads = typeof navigator === 'undefined' ? UNKNOWN : navigator.hardwareConcurrency
  return {
    appVersion,
    baseline,
    electron: uaToken(ua, /Electron\/(\S+)/),
    chromium: uaToken(ua, /Chrome\/(\S+)/),
    windowSize,
    dpr,
    screen: known(screenSize),
    language: known(typeof navigator === 'undefined' ? UNKNOWN : navigator.language),
    timezone: detectTimezone(),
    theme: detectTheme(),
    cpuThreads: typeof threads === 'number' && Number.isFinite(threads) && threads > 0 ? String(threads) : UNKNOWN,
    floating: isFloatingWindow(),
  }
}

/**
 * 操作系统单元格：`Windows_NT 10.0.26200 (x64)`；Windows 再附加版本名（`· Windows 11 Pro`）。
 * @param os - host 上报的操作系统段（缺席时 undefined）。
 * @returns 单元格值。
 */
function osOf(os: HostEnvInfo['os'] | undefined): string {
  if (os === undefined) return UNKNOWN
  const name = joinKnown([known(os.type), known(os.release)], ' ')
  const base = name === UNKNOWN ? UNKNOWN : `${name} (${known(os.arch)})`
  const version = known(os.version)
  return version === UNKNOWN ? base : joinKnown([base, version], ' · ')
}

/**
 * 运行形态单元格：`ide` / `ide · debug:9333`。
 * @param host - host 侧环境（缺席时 undefined）。
 * @returns 单元格值。
 */
function modeOf(host: HostEnvInfo | null): string {
  const mode = known(host?.mode)
  const port = typeof host?.debugPort === 'string' && host.debugPort.trim() !== '' ? host.debugPort.trim() : null
  return port === null ? mode : joinKnown([mode, `debug:${port}`], ' · ')
}

/**
 * 内存单元格：`32 GB`。
 * @param memGB - host 上报的 GB 数。
 * @returns 单元格值。
 */
function memOf(memGB: number | undefined): string {
  return typeof memGB === 'number' && Number.isFinite(memGB) && memGB > 0 ? `${Math.round(memGB)} GB` : UNKNOWN
}

/**
 * 应用版本单元格：`v0.5.0`（缺项就是 `unknown`，不写成 `vunknown`）。
 * @param appVersion - 桥给的版本号。
 * @returns 单元格值。
 */
function versionOf(appVersion: string): string {
  const version = known(appVersion)
  if (version === UNKNOWN) return UNKNOWN
  return version.startsWith('v') ? version : `v${version}`
}

/**
 * 把「本地半边」与「host 半边」合成固定 12 行的环境表。
 *
 * 行序**固定**（不随后端/取值成功与否变化）：缺什么都在原位写 `unknown`。
 * @param local - {@link detectEnvLocal} 的产物（或 {@link UNKNOWN_LOCAL_ENV}）。
 * @param host - host `envInfo` 的 `value`；调用失败/旧 host 时传 null。
 * @returns 12 行环境表。
 */
export function mergeEnv(local: LocalEnv, host: HostEnvInfo | null): MergedEnv {
  return [
    { key: 'Corum', value: versionOf(local.appVersion) },
    // host 的解析优先；它 unknown 时退回 preload 的基座版本（两条都是确定性读取）。
    {
      key: 'dsh 基座',
      value: known(host?.dshVersion) === UNKNOWN ? known(local.baseline) : known(host?.dshVersion),
    },
    { key: '运行形态', value: modeOf(host) },
    { key: '操作系统', value: osOf(host?.os) },
    { key: 'Electron / Chromium', value: pairOf(known(local.electron), known(local.chromium)) },
    { key: 'Node / V8', value: pairOf(known(host?.node), known(host?.v8)) },
    {
      key: '窗口 / 屏幕',
      value: joinKnown([
        known(local.windowSize),
        local.dpr === UNKNOWN ? UNKNOWN : `DPR ${local.dpr}`,
        local.screen === UNKNOWN ? UNKNOWN : `屏幕 ${local.screen}`,
      ], ' · '),
    },
    { key: '语言 / 时区', value: joinKnown([known(local.language), known(local.timezone)], ' · ') },
    { key: '主题', value: known(local.theme) },
    { key: 'CPU 线程', value: known(local.cpuThreads) },
    { key: '内存', value: memOf(host?.memGB) },
    { key: '窗口形态', value: local.floating ? '浮窗' : '主窗' },
  ].map(row => ({ key: row.key, value: cellOf(row.value) }))
}

/**
 * 环境表 → 进 issue 正文的那段 markdown（**唯一**格式来源）。
 * @param merged - {@link mergeEnv} 的产物。
 * @returns 表头 + 每行 `| 项 | 值 |`（行数 = 输入行数，缺项也是 `unknown` 而非省略）。
 */
export function envTableMarkdown(merged: MergedEnv): string {
  const lines: string[] = ['### 环境', '| 项 | 值 |', '| --- | --- |']
  for (const row of merged) {
    lines.push(`| ${cellOf(row.key)} | ${cellOf(row.value)} |`)
  }
  return lines.join('\n')
}
