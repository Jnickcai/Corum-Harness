/**
 * IssueReporter — corum 的 Issue 提交入口（悬浮按钮 + 三视图面板）。
 *
 * 形态照抄通知悬浮按钮（`packages/desktop/src/client/NotificationHost.tsx` 的
 * `drawer-tab`）：56×52、`position: fixed`、`z-index: 9999`、玻璃底 + 描边 + 外阴影、
 * 可拖动松手吸附最近边缘、位置持久化、6px 阈值区分点击与拖动。差别只有三处：
 *   ① 轴向偏移缺省 **184**（通知 bell 是 120，本入口排它下面一行，不压未读徽标）；
 *   ② 吸附只认左右两条边（面板要贴在按钮内侧，上下边会让面板压住按钮）；
 *   ③ 图标用品牌色 token（bell 用 `--dsw-alias-label-secondary`），并在有未提交草稿
 *      时右上角加一个 6px 品牌色圆点。
 *
 * ## 三个视图（`form` | `auth` | `result`）
 *
 * 状态机（事件 → 视图）：
 *   - `form`：默认态。标题/描述/类型/环境信息/截图 chip 都在这里。
 *   - 首次打开面板且 `authStatus()` 明确返回 `authorized:false` → `auth`；
 *     点「提交 Issue」但尚未授权 → `auth`（**不提交**）；
 *     上传阶段收到 `invalid-token` → `auth`（带「授权已失效」提示）；
 *     `submitIssue` 收到 `invalid-token` → `auth`（本次提交的东西都没落库，
 *     收回结果卡没有意义；用户从 auth 视图点「取消」会看到那张失败卡，里面有
 *     「重新授权」按钮）。
 *   - `auth` 授权成功 → 若从未同意截图托管且当前有截图 ⇒ 回 `form` 并亮出**托管同意卡**；
 *     否则直接回 `form`。「取消」恒回 `form`。
 *   - `result`：提交**结束**后由 `submitIssue`/`authStatus` 的返回值决定（成功卡 / 失败卡）。
 *     关闭面板、「再报一个」、失败卡上的「返回修改」都把它清掉。
 *
 * ## 提交流程（`form` 视图的「提交 Issue」）
 *
 * ① 授权闸 → ② 托管闸（有截图但从未表态 ⇒ 先弹同意卡，本次不提交）→ ③ 逐张上传
 * （每张 chip 独立进度，**一张失败不阻断其余**；上传前有 4 MB 体积闸与魔数校验）→
 * ④ 组装正文（描述 + 环境块 + 只有真正上传成功的图的 `![]()` 行）→
 * ⑤ `submitIssue(title, body, labels)`（label 由 host 过滤成仓库里真实存在的）。
 *
 * 全程不跳浏览器：唯一的外链面是 `window.corumDesktop.openExternal`（设备授权页、
 * 成功卡上的 issue 页面）。截图只存在内存（ObjectURL），**不落 localStorage**；
 * 落盘的只有草稿三项 + 环境勾选 + 「已同意截图托管」这一个标记。
 *
 * 为什么环境信息是「只读预览 + 一个勾」而不是可编辑文本框：它是**确定性读取**
 * （12 项，渲染层 6 项 + host 6 项，见 `./env.ts`），让用户能改就等于让报障信息可以
 * 失真。但**能看**是隐私要求而不是装饰：默认折叠显示前 4 行，点「共 N 项 · 展开」看
 * 全部——用户提交前必须能确认到底附上了什么。
 * @module corum-issue-reporter/client/IssueReporter
 */

import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react'
import {
  Bug, Check, CircleCheck, CircleX, ExternalLink, Image as ImageIcon,
  LoaderCircle, RefreshCw, ShieldCheck, TriangleAlert, X,
} from 'lucide-react'
import { readBridge } from './bridge.ts'
import {
  ENV_PREVIEW_ROWS, UNKNOWN_LOCAL_ENV, detectEnvLocal, envTableMarkdown, mergeEnv,
  type LocalEnv, type MergedEnv,
} from './env.ts'
import type { HostEnvInfo } from '../types.ts'
import type { GithubClient } from './github.ts'
import css from './IssueReporter.module.css'

/** 贴边位置持久化键（纯 UI 偏好，不参与跨 bundle 共享状态）。 */
const TAB_KEY = 'corum.issueReporter.tab'

/** 草稿持久化键（标题/描述/类型/环境勾选；**截图不落盘**）。 */
const DRAFT_KEY = 'corum.issueReporter.draft'

/** 截图托管同意标记键（与草稿键同一命名风格；只写「已同意」这一种值）。 */
const CONSENT_KEY = 'corum.issueReporter.consent'

/** Issue 目标仓库（**只用于显示**：真正提交到哪由 host 半的 `TARGET_REPO` 决定）。 */
const REPO_SLUG = 'kukucaiCndy/Corum-Harness'

/** 资产仓库名前缀（与 host 半 `assetRepoName()` 同一份字面量；面板只做显示）。 */
const ASSETS_REPO_PREFIX = 'corum-issue-assets-'

/** GitHub 的设备授权页（`authStart` 的 `verificationUri` 为空时的兜底）。 */
const DEVICE_PAGE_URL = 'https://github.com/login/device'

/** 入口按钮宽高（与通知 bell 同规格；面板定位要用到，故提成常量）。 */
const TAB_WIDTH = 56
const TAB_HEIGHT = 52

/** 面板与按钮之间的留白（贴右时面板右缘距按钮左缘 14px）。 */
const PANEL_GAP = 14

/**
 * 缺省位置：贴右边缘、轴向偏移 184。
 *
 * 为什么是 184 而不是 bell 的 120：两个入口同贴右边缘时**必须错行**——184 = 120 +
 * 52（bell 高度）+ 12（行距），这样本入口整块落在 bell 下方，不会压住它的未读数徽标，
 * 也不会被徽标压住。
 */
const DEFAULT_TAB: TabPosition = { edge: 'right', offset: 184 }

/** 拖动判定阈值（px）：位移超过它才算拖动，否则视为点击展开。 */
const DRAG_THRESHOLD = 6

/** 吸附后沿轴的最小偏移，避免贴到视口角落被裁。 */
const AXIS_MIN = 72

/** 截图上限。满了之后粘贴/拖入**直接忽略**：不弹提示、不用警告色、不进通知栏。 */
const MAX_SHOTS = 6

/** 单张截图的上传体积闸（> 4 MB 一律不发上传请求，chip 直接标「过大」）。 */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024

/** 描述框的 placeholder（三行：发生了什么 / 空行 / 复现步骤 + 粘贴提示）。 */
const DESC_PLACEHOLDER = '发生了什么？\n\n复现步骤 / 期望结果 · 截图直接 Ctrl+V 粘到这里'

/** 瞬时失败退避的上限秒数（再失败也按这个间隔重试，不无限拉长）。 */
const POLL_BACKOFF_CAP_SEC = 10

/**
 * `authPoll` 里属于**瞬时**（信道抖动）的失败码。
 *
 * 这些码**绝不能结束授权会话**：一旦结束，这一枚 `device_code` 就永久失去续轮询
 * 的能力，用户只能重新拿码（实测一次网络抖动连废四枚码）。其余失败码
 * （`expired_token` / `access_denied` / `unsupported` / …）才是真结束。
 */
const TRANSIENT_POLL_CODES: readonly string[] = ['network-error', 'timeout', 'rpc-error']

/**
 * 瞬时失败后的下一次轮询延迟。
 * @param retries - 已经连续失败了几次（从 1 开始计数）。
 * @returns 下一次轮询该等多少秒（2 → 4 → 8，之后按 {@link POLL_BACKOFF_CAP_SEC} 封顶）。
 */
function pollBackoffSec(retries: number): number {
  if (retries <= 0) return 2
  return Math.min(POLL_BACKOFF_CAP_SEC, 2 ** Math.min(retries, 4))
}

/** 贴边位置：只认左右两条边（面板贴在按钮内侧，上下边会让面板压住按钮）。 */
interface TabPosition {
  edge: 'left' | 'right'
  offset: number
}

/** 提交类型三档（值即 GitHub label）。 */
type IssueKind = 'bug' | 'feature' | 'other'

/** 类型按钮文案。 */
const KIND_LABEL: Record<IssueKind, string> = {
  bug: '缺陷 Bug',
  feature: '功能建议',
  other: '其他',
}

/** 类型 → GitHub label（host 会过滤成仓库里真实存在的标签）。 */
const KIND_TAG: Record<IssueKind, string> = {
  bug: 'bug',
  feature: 'enhancement',
  other: 'question',
}

/** 类型的展示顺序（缺陷默认选中，排第一）。 */
const KIND_ORDER: readonly IssueKind[] = ['bug', 'feature', 'other']

/** 草稿（截图只在内存，故不在这里）。 */
interface Draft {
  title: string
  body: string
  kind: IssueKind
  includeEnv: boolean
}

/** 空草稿（类型默认「缺陷 Bug」、环境信息默认勾选）。 */
const EMPTY_DRAFT: Draft = { title: '', body: '', kind: 'bug', includeEnv: true }

/** 内存里的一张截图（ObjectURL 预览 + 原始 Blob）。 */
interface Shot {
  id: string
  /** chip 底部显示的文件名（形如 `shot-01.png`），按加入次序编号。 */
  name: string
  blob: Blob
  /** 预览/剪贴板用的 ObjectURL（删除与卸载时必须 revoke）。 */
  url: string
}

/** 授权闸的三态（`unknown` = 还没问过 GitHub，不能当成「未授权」）。 */
type AuthGate = 'unknown' | 'authorized' | 'unauthorized'

/** 截图托管表态（`unasked` 只在本机从未同意过时出现；`skipped` 只在本次运行有效）。 */
type ConsentChoice = 'unasked' | 'accepted' | 'skipped'

/** 一张截图的上传状态（chip 徽标的 `data-state` 就是它）。 */
type UploadState = 'idle' | 'uploading' | 'done' | 'failed' | 'toolarge' | 'notimage'

/** 单张截图的上传记录（`done` 带 raw 链接，`failed` 带 host 原文）。 */
interface ShotUpload {
  readonly state: UploadState
  readonly url?: string
  readonly code?: string
  readonly message?: string
}

/** 设备授权会话（`authStart` 的返回 + 本地起始时刻，用于算过期）。 */
interface AuthSession {
  readonly deviceCode: string
  readonly userCode: string
  readonly verificationUri: string
  readonly expiresIn: number
  readonly interval: number
  readonly startedAt: number
}

/** auth 视图内部的阶段（与视图本身正交）。 */
type AuthPhase = 'idle' | 'starting' | 'waiting' | 'failed'

/** 失败卡要执行的动作（按 `code` 分档，不允许「只显示错误」）。 */
type FailureAction = 'reauth' | 'retry' | 'edit' | 'none'

/** 失败卡的内容。 */
interface FailureView {
  readonly code: string
  readonly message: string
  readonly detail?: string
  /** 卡片标题（按 code 给的结论，如「授权已失效」）。 */
  readonly title: string
  /** 可执行动作。 */
  readonly action: FailureAction
  /** 补一句该怎么办（可缺省）。 */
  readonly hint?: string
}

/** 成功卡的内容。 */
interface SuccessView {
  readonly number: number
  readonly htmlUrl: string
  readonly title: string
  /** 真正进了正文的截图数（0 = 正文不含图片）。 */
  readonly uploaded: number
  /** 资产仓库（`已上传` 那句的落点）。 */
  readonly assetsOwner: string
  readonly assetsRepo: string
  /** 正文是否带上了环境块（勾了才算）。 */
  readonly envIncluded: boolean
}

/** 提交结果：`null` = 没结果（form 视图自己渲染）。 */
type SubmitResult = { readonly kind: 'success'; readonly view: SuccessView } | { readonly kind: 'failure'; readonly view: FailureView }

/** 读持久化的贴边位置（异常数据回退缺省值；同通知 bell 的 readBellPosition）。 */
function readTab(): TabPosition {
  if (typeof localStorage === 'undefined') return DEFAULT_TAB
  try {
    const raw = localStorage.getItem(TAB_KEY)
    if (raw === null) return DEFAULT_TAB
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_TAB
    const { edge, offset } = parsed as { edge?: unknown; offset?: unknown }
    if (edge !== 'left' && edge !== 'right') return DEFAULT_TAB
    if (typeof offset !== 'number' || !Number.isFinite(offset)) return DEFAULT_TAB
    return { edge, offset }
  } catch {
    return DEFAULT_TAB
  }
}

/** 读持久化的草稿（逐字段校验，坏字段单独回退，不让一条坏数据吃掉整份草稿）。 */
function readDraft(): Draft {
  if (typeof localStorage === 'undefined') return EMPTY_DRAFT
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (raw === null) return EMPTY_DRAFT
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_DRAFT
    const { title, body, kind, includeEnv } = parsed as Record<string, unknown>
    return {
      title: typeof title === 'string' ? title : EMPTY_DRAFT.title,
      body: typeof body === 'string' ? body : EMPTY_DRAFT.body,
      kind: kind === 'bug' || kind === 'feature' || kind === 'other' ? kind : EMPTY_DRAFT.kind,
      includeEnv: typeof includeEnv === 'boolean' ? includeEnv : EMPTY_DRAFT.includeEnv,
    }
  } catch {
    return EMPTY_DRAFT
  }
}

/** 读持久化的托管同意标记（只有「已同意」会落盘；其余一律回 `unasked`）。 */
function readConsent(): ConsentChoice {
  if (typeof localStorage === 'undefined') return 'unasked'
  try {
    return localStorage.getItem(CONSENT_KEY) === 'accepted' ? 'accepted' : 'unasked'
  } catch {
    return 'unasked'
  }
}

/** 写持久化（配额满/隐私模式等失败一律吞掉：不影响本次会话内的行为）。 */
function writeStorage(key: string, value: unknown): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 持久化失败不上报给用户：草稿仍在内存里，本次会话照常可用。
  }
}

/**
 * 把拖动落点吸附到最近边缘（**只认左右**，见 TabPosition 注释）。
 * @param x - 落点中心 x（视口坐标）。
 * @param y - 落点中心 y。
 * @param width - 视口宽。
 * @param height - 视口高。
 * @returns 吸附后的位置（轴向偏移夹在 `[72, 视口高-72]`）。
 */
function snapToEdge(x: number, y: number, width: number, height: number): TabPosition {
  return {
    edge: x < width - x ? 'left' : 'right',
    offset: Math.max(AXIS_MIN, Math.min(height - AXIS_MIN, y)),
  }
}

/** 入口按钮的贴边样式（圆角朝向由 `data-edge` 交给 CSS 翻转）。 */
function tabStyle(position: TabPosition): CSSProperties {
  return position.edge === 'right'
    ? { right: 0, top: position.offset }
    : { left: 0, top: position.offset }
}

/**
 * 面板样式：优先垂直中心对齐按钮中心，**夹进视口**；贴右时在按钮左侧、贴左时镜像。
 *
 * 为什么必须夹紧而不是只用 `top=中心 + translateY(-50%)`：面板高度随内容变（空白态
 * 481px、有草稿/截图 557px），而按钮贴顶时中心只有 210px ⇒ 面板顶缘会顶出视口
 * （实测 top=-30 / -68，头部行连同关闭按钮被裁掉，用户无法关闭面板）。
 *
 * 用**绝对 top**（不用 transform）表达：夹紧结果是一个绝对值，再叠一个百分比
 * transform 两者会互相打架（transform 会把夹好的 top 又拉回去）。
 * @param position - 吸附位置（边 + 轴向偏移）。
 * @param panelHeight - `panelRef` 实测的面板高度（首帧未测到时为 0）。
 * @param viewportHeight - 当前视口高度（`window.innerHeight`）。
 */
function panelStyle(position: TabPosition, panelHeight: number, viewportHeight: number): CSSProperties {
  const center = position.offset + TAB_HEIGHT / 2
  const GAP = 8
  let top = center - panelHeight / 2 // 优先「中心对齐按钮」
  top = Math.max(GAP, Math.min(top, viewportHeight - GAP - panelHeight)) // 夹进视口
  // 面板比视口还高时上式把 top 夹到 GAP（顶部对齐），配合 CSS 的 max-height + 内部滚动。
  const base: CSSProperties = { top }
  return position.edge === 'right'
    ? { ...base, right: TAB_WIDTH + PANEL_GAP }
    : { ...base, left: TAB_WIDTH + PANEL_GAP }
}

/** 从 window 读剪贴板写入口（非 secure context / 老壳下不存在）。 */
function readClipboard(): { writeText: (text: string) => Promise<void> } | undefined {
  return (navigator as unknown as { clipboard?: { writeText: (text: string) => Promise<void> } }).clipboard
}

/**
 * 把纯文本写进系统剪贴板。
 * @param text - 要写入的文本。
 * @returns 是否真的写成功（调用方据此决定「已复制」这类文案要不要说）。
 */
async function copyText(text: string): Promise<boolean> {
  const clipboard = readClipboard()
  if (clipboard === undefined) return false
  try {
    await clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * 把一张截图的 base64 解出前 18 字节，判它是不是四种放行的图片格式之一。
 *
 * 为什么在**上传前**做魔数校验：GitHub 的 Contents API 只认 base64，不会替我们
 * 挡「其实不是图片」的字节；一张假图片传上去只会变成一个公开的垃圾文件。
 * 放行集与 host 半的 `ASSET_EXTENSIONS` 对齐：PNG / JPEG / GIF / WEBP。
 * @param base64 - **不带** `data:` 前缀的 base64。
 * @returns 认出的格式，或 `null`（不认）。
 */
function sniffImageKind(base64: string): 'png' | 'jpeg' | 'gif' | 'webp' | null {
  let head: Uint8Array
  try {
    const binary = atob(base64.slice(0, 24)) // 24 个 base64 字符 = 18 字节，够判 WEBP
    head = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) head[index] = binary.charCodeAt(index)
  } catch {
    return null
  }
  const at = (index: number): number => head[index] ?? -1
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'png'
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'jpeg'
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return 'gif'
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return 'webp'
  return null
}

/**
 * 把 Blob 读成**不带 `data:` 前缀**的 base64（host 的 `uploadAsset` 要的就是这个）。
 * @param blob - 截图数据。
 * @returns base64，或 `null`（读不出来）。
 */
async function readBase64(blob: Blob): Promise<string | null> {
  return await new Promise<string | null>((resolve) => {
    const reader = new FileReader()
    reader.onerror = () => { resolve(null) }
    reader.onload = () => {
      const value = reader.result
      if (typeof value !== 'string') {
        resolve(null)
        return
      }
      const comma = value.indexOf(',')
      resolve(comma === -1 ? null : value.slice(comma + 1))
    }
    reader.readAsDataURL(blob)
  })
}

/**
 * 按失败码给出**可执行动作**（不允许只显示错误）。
 *
 * 分档事实源是 host 半的 `classifyApiFailure/classifyFetchError` 与
 * `authStatus/authStart` 的失败码；这里只补「用户下一步做什么」，不改写 message。
 * @param code - host 返回的失败码。
 * @param message - host 的中文说明（原样显示）。
 * @param detail - host 附的原文（有就原样显示）。
 * @returns 失败卡的内容。
 */
function failureOf(code: string, message: string, detail?: string): FailureView {
  const base = detail === undefined ? { code, message } : { code, message, detail }
  switch (code) {
    case 'invalid-token':
      return { ...base, title: '授权已失效', action: 'reauth', hint: 'GitHub 授权已被撤销或过期；重新授权后内容还在草稿里，直接再提交即可。' }
    case 'rate-limited':
      return { ...base, title: 'GitHub 限流', action: 'retry', hint: '等上面那条重置时间过去，再点「重试」。' }
    case 'validation-failed':
      return { ...base, title: 'GitHub 校验失败', action: 'edit', hint: '上面是 GitHub 的原文；按它改完标题/描述再提交。' }
    case 'payload-too-large':
      return { ...base, title: '截图或正文过大', action: 'edit', hint: '删掉几张截图（单张请控制在 4 MB 以内）或精简正文后再提交。' }
    case 'network-error':
    case 'timeout':
      return { ...base, title: '网络不可达', action: 'retry', hint: '检查网络/代理后点「重试」。' }
    case 'no-client-id':
    case 'unsupported':
      return { ...base, title: '运行环境不支持', action: 'none', hint: '这是构建/环境问题（host 半边没启用，或 OAuth client_id 未配置），重试不会解决——请更新或重装应用。' }
    case 'no-token':
    case 'no-credentials':
      return { ...base, title: '尚未授权', action: 'reauth', hint: '完成设备授权后即可继续。' }
    case 'issues-disabled':
      return { ...base, title: '目标仓库已关闭 Issues', action: 'none', hint: '这是仓库设置问题，应用内无法解决。' }
    default:
      return { ...base, title: '提交失败', action: 'retry' }
  }
}

/** 签发徽标的文案与图标类型。 */
function uploadLabel(state: UploadState): { text: string; icon: 'spinner' | 'check' | 'warn' | 'none' } {
  switch (state) {
    case 'uploading': return { text: '上传中…', icon: 'spinner' }
    case 'done': return { text: '已上传', icon: 'check' }
    case 'failed': return { text: '失败', icon: 'warn' }
    case 'toolarge': return { text: '过大（>4 MB）', icon: 'warn' }
    case 'notimage': return { text: '不是图片', icon: 'warn' }
    default: return { text: '', icon: 'none' }
  }
}

/**
 * 向 host 要一次环境侦测。
 *
 * 任何失败（旧 host 的 `unsupported`、连接层抛、host 内部 fail）都收敛成 `null`：
 * 这只影响展示（host 那几行落成 unknown），不该让面板报错或挡住提交。
 * @param client - host 半边的调用层。
 * @returns host 上报的环境；取不到 → null。
 */
async function readHostEnv(client: GithubClient): Promise<HostEnvInfo | null> {
  try {
    const result = await client.envInfo()
    return result.ok ? result.value : null
  } catch {
    return null
  }
}

/** 面板的 prop：host 半边的 8 个方法（由 `apply` 建一次后传进来）。 */
export interface IssueReporterProps {
  /** `createGithubClient(connection)` 的产物（面板不自己造）。 */
  readonly client: GithubClient
}

/**
 * 悬浮入口 + 提交面板。
 * @param props - 注入的 GitHub 客户端（见 {@link IssueReporterProps}）。
 * @returns 入口按钮与（展开时的）面板。
 */
export function IssueReporter({ client }: IssueReporterProps) {
  const [tab, setTab] = useState<TabPosition>(readTab)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(readDraft)
  const [shots, setShots] = useState<Shot[]>([])
  const [result, setResult] = useState<SubmitResult | null>(null)
  const [view, setView] = useState<'form' | 'auth'>('form')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  /** 拖动中的临时位置（视口坐标；松手吸附后清空）。 */
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  /**
   * 环境信息（确定性读取）。
   * 本地半边（渲染层）与 host 半边分开存：host 半边可能取不到（旧 host / 没连接），
   * 那时本地那几行照样完整，host 那几行落成 unknown。
   */
  const [localEnv, setLocalEnv] = useState<LocalEnv | null>(null)
  /** host `envInfo` 的 `value`（失败/缺席 = null）。 */
  const [hostEnv, setHostEnv] = useState<HostEnvInfo | null>(null)
  /** 环境表预览是否展开（默认折叠：只显示前 4 行 + 「共 N 项 · 展开」）。 */
  const [envOpen, setEnvOpen] = useState(false)
  /** 面板实测高度（未展开/未测到 = 0；面板垂直夹紧要用它，见 `panelStyle`）。 */
  const [panelHeight, setPanelHeight] = useState(0)
  /** 当前视口高度（面板垂直夹紧的另一半输入；resize 时更新）。 */
  const [viewportHeight, setViewportHeight] = useState(() => (typeof window === 'undefined' ? 0 : window.innerHeight))

  // ── 授权/托管/上传状态 ────────────────────────────────────────────
  /** 授权闸（unknown = 还没问过 GitHub）。 */
  const [gate, setGate] = useState<AuthGate>('unknown')
  /** 已授权的 GitHub 登录名（同意卡的仓库行、成功卡的托管落点都用它）。 */
  const [login, setLogin] = useState<string | null>(null)
  /** 托管表态（unasked/skipped 都不上传，区别只是有没有问过）。 */
  const [consent, setConsent] = useState<ConsentChoice>(readConsent)
  /** 是否正在展示同意卡（auth 成功后或提交时按需亮出）。 */
  const [consentPrompt, setConsentPrompt] = useState(false)
  /** 同意卡上的复选框（勾了才允许点「同意并创建仓库」）。 */
  const [consentChecked, setConsentChecked] = useState(false)
  /** 「同意并创建仓库」进行中。 */
  const [consentBusy, setConsentBusy] = useState(false)
  /** `ensureAssetsRepo` 的失败原文（要原样显示 code + message）。 */
  const [consentError, setConsentError] = useState<{ code: string; message: string; detail?: string } | null>(null)
  /** 设备授权会话。 */
  const [session, setSession] = useState<AuthSession | null>(null)
  /** auth 视图阶段。 */
  const [authPhase, setAuthPhase] = useState<AuthPhase>('idle')
  /** 轮询间隔（秒）：初始取 `authStart`，`slow_down` 时换成 host 给的新值。 */
  const [intervalSec, setIntervalSec] = useState(5)
  /** auth 流程的失败原文。 */
  const [authError, setAuthError] = useState<{ code: string; message: string; detail?: string } | null>(null)
  /** 「重新获取设备码」的重发序号（变化即重跑 authStart）。 */
  const [authSeq, setAuthSeq] = useState(0)
  /** 每轮轮询后 +1：让轮询 effect 重新排下一次定时器（pending 时状态不变）。 */
  const [pollSeq, setPollSeq] = useState(0)
  /** 连续瞬时失败次数（>0 = 正在退避重试；收到任意成功响应即归零）。 */
  const [pollRetries, setPollRetries] = useState(0)
  /** 设备码是否已过期（本地按 `expiresIn` 计时，不依赖 GitHub 回错）。 */
  const [expired, setExpired] = useState(false)
  /** auth 视图上的一句话提示（如「授权已失效，请重新授权」）。 */
  const [authNotice, setAuthNotice] = useState<string | null>(null)
  /** 「复制设备码」按钮的 1.5s 反馈。 */
  const [copiedCode, setCopiedCode] = useState(false)
  /** 每张截图的上传进度。 */
  const [uploads, setUploads] = useState<Record<string, ShotUpload>>({})

  const tabRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const titleRef = useRef<HTMLInputElement | null>(null)
  /** 拖动是否真的越过了阈值（越过则松手不触发展开）。 */
  const draggedRef = useRef(false)
  /** 截图命名序号（只增不减：删掉一张再粘一张不会撞名）。 */
  const shotSeqRef = useRef(0)
  /** 截图快照（卸载清理、授权成功后的判断、上传结果落点都读它——**同步维护**）。 */
  const shotsRef = useRef<Shot[]>([])
  /** 托管表态的同步镜像（异步回调里读不到最新 state）。 */
  const consentRef = useRef<ConsentChoice>(consent)
  /** 上传进度的同步镜像（逐张上传时下一张要读上一张的结果）。 */
  const uploadsRef = useRef<Record<string, ShotUpload>>({})
  /** 授权闸的同步镜像（提交时判断用）。 */
  const gateRef = useRef<AuthGate>('unknown')
  /** 最近一次提交用的完整正文（失败卡的「复制内容」要照搬它）。 */
  const lastBodyRef = useRef('')
  /** 「首次打开面板查一次授权」只做一次。 */
  const authCheckedRef = useRef(false)
  /** 退避档位的同步镜像（effect 排 timer 时要读到最新值，state 在闭包里可能是旧值）。 */
  const pollRetryRef = useRef(0)
  /** 进行中的拖动监听清理器（组件在拖动中途卸载时不漏监听）。 */
  const dragCleanupRef = useRef<(() => void) | null>(null)
  /** 「已复制」的复位定时器。 */
  const copiedTimerRef = useRef<number | null>(null)

  // 面板高度实测 + 视口高度跟踪（垂直夹紧的输入）。
  // 用 useLayoutEffect：首帧就在 paint 前测出高度并同步修正 top，用户看不到抖动。
  useLayoutEffect(() => {
    const onResize = () => { setViewportHeight(window.innerHeight) }
    onResize()
    window.addEventListener('resize', onResize)
    const node = panelRef.current
    if (node === null) {
      setPanelHeight(0)
      return () => { window.removeEventListener('resize', onResize) }
    }
    const measure = () => { setPanelHeight(node.getBoundingClientRect().height) }
    measure() // 先同步测一次，不依赖 ResizeObserver 的首个回调时机
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(node)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  // 贴边位置持久化（与通知 bell 同一套：UI 偏好写 localStorage，不进跨 bundle 状态）。
  useEffect(() => { writeStorage(TAB_KEY, tab) }, [tab])

  // 草稿持久化（截图不落盘）。
  useEffect(() => { writeStorage(DRAFT_KEY, draft) }, [draft])

  // 卸载时 revoke 所有还活着的 ObjectURL（否则每张粘贴的图都留一份内存）。
  useEffect(() => () => {
    for (const shot of shotsRef.current) URL.revokeObjectURL(shot.url)
  }, [])

  // 卸载时摘掉可能还在的拖动监听与「已复制」定时器（轮询的 timer 由 effect 清理负责）。
  useEffect(() => () => {
    dragCleanupRef.current?.()
    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current)
  }, [])

  // 环境信息（本地半边在渲染层算，host 半边问一次 RPC；两边都不抛）。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [local, host] = await Promise.all([detectEnvLocal(), readHostEnv(client)])
      if (cancelled) return
      setLocalEnv(local)
      setHostEnv(host)
    })()
    return () => { cancelled = true }
  }, [client])

  // 窗口缩放后把 offset 夹回可见范围（否则可能被推出屏幕）。
  useEffect(() => {
    const clamp = (): void => {
      setTab(prev => {
        const offset = Math.max(AXIS_MIN, Math.min(window.innerHeight - AXIS_MIN, prev.offset))
        return offset === prev.offset ? prev : { edge: prev.edge, offset }
      })
    }
    clamp()
    window.addEventListener('resize', clamp)
    return () => { window.removeEventListener('resize', clamp) }
  }, [])

  // ── 视图与授权 ────────────────────────────────────────────────────

  /**
   * 收起面板：三视图回到 form，结果与授权会话一并清掉（草稿与托管表态保留）。
   *
   * 结果态**必须**在这里复位：关掉再打开要落在 form（上一张成功卡/失败卡都不常驻），
   * 失败时草稿照旧保留（面板没提交成功，内容不能跟着结果卡一起消失）。
   */
  const closePanel = useCallback((): void => {
    setOpen(false)
    setResult(null)
    setView('form')
    setSession(null)
    setAuthError(null)
    setAuthPhase('idle')
    setExpired(false)
    setAuthNotice(null)
    setCopiedCode(false)
    setConsentPrompt(false)
    setConsentError(null)
    pollRetryRef.current = 0
    setPollRetries(0)
  }, [])

  /**
   * 进入 auth 视图并（重新）申请设备码。
   * @param notice - 可选的一句话提示（如「授权已失效，请重新授权」）。
   */
  const startAuth = useCallback((notice?: string): void => {
    setAuthNotice(notice ?? null)
    setView('auth')
    setSession(null)
    setAuthError(null)
    setAuthPhase('starting')
    setExpired(false)
    setCopiedCode(false)
    // 新的一枚设备码 ⇒ 退避档位从零开始（不能继承上一枚码的连续失败计数）。
    pollRetryRef.current = 0
    setPollRetries(0)
    setAuthSeq(seq => seq + 1)
  }, [])

  /** 从 auth 视图返回 form（轮询由 effect 的 cleanup 停掉）。 */
  const cancelAuth = useCallback((): void => {
    setView('form')
    setSession(null)
    setAuthError(null)
    setAuthPhase('idle')
    setExpired(false)
    setAuthNotice(null)
    setCopiedCode(false)
    pollRetryRef.current = 0
    setPollRetries(0)
  }, [])

  /** 授权成功后的落点：记下 login，按「有没有截图 + 有没有同意过托管」决定下一步。 */
  const onAuthorized = useCallback((authorizedLogin: string): void => {
    setExpired(false)
    setAuthError(null)
    setAuthNotice(null)
    setGate('authorized')
    gateRef.current = 'authorized'
    setLogin(authorizedLogin)
    setView('form')
    if (consentRef.current === 'unasked' && shotsRef.current.length > 0) {
      setConsentChecked(false)
      setConsentError(null)
      setConsentPrompt(true)
    }
  }, [])

  /** `invalid-token` 的统一出口：不提交、不回结果卡，直接进 auth 视图。 */
  const reauthForInvalidToken = useCallback((): void => {
    setGate('unauthorized')
    gateRef.current = 'unauthorized'
    startAuth('授权已失效，请重新授权')
  }, [startAuth])

  // auth 视图一进去就申请设备码（「重新获取设备码」= authSeq 变化再跑一次）。
  useEffect(() => {
    if (!open || view !== 'auth') return undefined
    let cancelled = false
    setAuthPhase('starting')
    setSession(null)
    setAuthError(null)
    void (async () => {
      const started = await client.authStart()
      if (cancelled) return
      if (!started.ok) {
        setAuthError(started)
        setAuthPhase('failed')
        return
      }
      setSession({
        deviceCode: started.deviceCode,
        userCode: started.userCode,
        verificationUri: started.verificationUri,
        expiresIn: started.expiresIn,
        interval: started.interval,
        startedAt: Date.now(),
      })
      setIntervalSec(started.interval)
      setAuthPhase('waiting')
      setPollSeq(seq => seq + 1)
    })()
    return () => { cancelled = true }
  }, [open, view, authSeq, client])

  // 设备码过期：本地按 `expiresIn` 计时（到点就停轮询并显示「已过期」）。
  useEffect(() => {
    if (!open || view !== 'auth' || session === null || expired) return undefined
    const deadline = session.startedAt + session.expiresIn * 1000
    const tick = (): void => { if (Date.now() >= deadline) setExpired(true) }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => { window.clearInterval(timer) }
  }, [open, view, session, expired])

  // 轮询授权结果：每次只排一个 `setTimeout`，随 interval/pollSeq 重排。
  // **面板关闭（open=false）或离开 auth 视图时 cleanup 一定清掉定时器**——
  // 组件卸载也一样走 cleanup，所以没有任何路径能让轮询在后台继续跑。
  //
  // 瞬时失败（`network-error` / `timeout` / `rpc-error`）**不结束会话**：沿用同一枚
  // `deviceCode` 温和退避重试（2s → 4s → 8s → 10s 封顶），`authPhase` 保持 waiting
  // ⇒ 设备码继续渲染；收到任意成功响应即把退避档位归零。只有 GitHub 明确回
  // `expired_token` / `access_denied`（或本地 `expiresIn` 到期、用户点取消）才收摊。
  useEffect(() => {
    if (!open || view !== 'auth' || session === null || authPhase !== 'waiting' || expired) return undefined
    const deviceCode = session.deviceCode
    // 排这一轮定时器时就定下延迟：正在退避 ⇒ 按失败次数退避，否则按 host 给的 interval。
    const delaySec = pollRetryRef.current > 0 ? pollBackoffSec(pollRetryRef.current) : Math.max(1, intervalSec)
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        const polled = await client.authPoll(deviceCode)
        if (cancelled) return
        if (polled.ok) {
          // 收到任意成功响应 ⇒ 信道恢复，退避档位归零，回到正常 interval。
          pollRetryRef.current = 0
          setPollRetries(0)
          if (polled.status === 'authorized') {
            onAuthorized(polled.login)
            return
          }
          if (polled.status === 'slow_down') setIntervalSec(polled.interval)
          setPollSeq(seq => seq + 1) // pending / slow_down 都继续排下一次
          return
        }
        if (TRANSIENT_POLL_CODES.includes(polled.code)) {
          // 瞬时失败：同一枚 deviceCode 继续轮询，只把状态行换成非致命提示并退避。
          pollRetryRef.current += 1
          setPollRetries(pollRetryRef.current)
          setPollSeq(seq => seq + 1)
          return
        }
        // 真正结束授权会话（expired_token / access_denied / unsupported / …）：
        // 就地显示原因 + 「重新获取设备码」。
        pollRetryRef.current = 0
        setPollRetries(0)
        setAuthError(polled)
        setAuthPhase('failed')
      })()
    }, delaySec * 1000)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, view, session, authPhase, intervalSec, pollSeq, expired, client, onAuthorized])

  // 面板打开期间：Esc 收起 + 点面板外收起。
  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closePanel()
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panelRef.current?.contains(target) === true) return
      // 入口自身的 pointerdown 不算「面板外」（否则点击会先收起再被 click 展开）。
      if (tabRef.current?.contains(target) === true) return
      closePanel()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [open, closePanel])

  // 打开后焦点落在标题输入框（键盘用户不必再 Tab 一轮）；auth 视图没有标题框。
  useEffect(() => {
    if (open && view === 'form' && result === null && !consentPrompt) titleRef.current?.focus()
  }, [open, view, result, consentPrompt])

  // 首次打开面板：问一次 `authStatus()`。**只有明确「未授权」才进 auth 视图**；
  // 查询本身失败（网络/不支持）不当成未授权——那时进 auth 反而会把用户引错方向。
  useEffect(() => {
    if (!open || authCheckedRef.current) return undefined
    authCheckedRef.current = true
    let cancelled = false
    void (async () => {
      const status = await client.authStatus()
      if (cancelled) return
      if (status.ok && status.authorized) {
        setGate('authorized')
        gateRef.current = 'authorized'
        setLogin(status.login)
        return
      }
      if (status.ok && !status.authorized) {
        setGate('unauthorized')
        gateRef.current = 'unauthorized'
        startAuth()
      }
    })()
    return () => { cancelled = true }
  }, [open, client, startAuth])

  // ── 拖动 / 截图 ───────────────────────────────────────────────────

  /**
   * 拖动入口按钮：pointer 捕获 + 6px 阈值（阈值内视为点击 → 开合面板）。
   * 松手吸附最近边缘并持久化；拖动中不触发展开（浏览器抬手后会补一次 click）。
   */
  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>): void => {
    // 只响应主键（右键/中键不拖）。
    if (event.button !== 0) return
    const el = event.currentTarget
    const rect = el.getBoundingClientRect()
    const grab = { dx: event.clientX - rect.left, dy: event.clientY - rect.top }
    draggedRef.current = false
    const start = { x: event.clientX, y: event.clientY }
    let moved: { x: number; y: number } | null = null
    const onMove = (e: PointerEvent): void => {
      const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y)
      if (!draggedRef.current && dist < DRAG_THRESHOLD) return
      draggedRef.current = true
      setDragging(true)
      moved = {
        x: Math.max(0, Math.min(window.innerWidth - rect.width, e.clientX - grab.dx)),
        y: Math.max(0, Math.min(window.innerHeight - rect.height, e.clientY - grab.dy)),
      }
      setDragPos(moved)
    }
    const cleanup = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (dragCleanupRef.current === cleanup) dragCleanupRef.current = null
    }
    const onUp = (): void => {
      cleanup()
      setDragging(false)
      if (!draggedRef.current) {
        setDragPos(null)
        return
      }
      // 吸附：用按钮中心点算最近边缘。
      const base = moved ?? { x: rect.left, y: rect.top }
      setTab(snapToEdge(base.x + rect.width / 2, base.y + rect.height / 2, window.innerWidth, window.innerHeight))
      setDragPos(null)
    }
    dragCleanupRef.current = cleanup
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }, [])

  /** 点入口：拖动过就不开合（浏览器在 pointerup 后仍会补一次 click）。 */
  const onTabClick = useCallback((): void => {
    if (draggedRef.current) {
      draggedRef.current = false
      return
    }
    if (open) closePanel()
    else setOpen(true)
  }, [open, closePanel])

  /** 写截图列表（state + 同步镜像一起更新：异步流程要立刻读到最新值）。 */
  const applyShots = useCallback((next: Shot[]): void => {
    shotsRef.current = next
    setShots(next)
  }, [])

  /** 写某张截图的上传状态（同样带同步镜像）。 */
  const applyUpload = useCallback((id: string, value: ShotUpload): void => {
    const next = { ...uploadsRef.current, [id]: value }
    uploadsRef.current = next
    setUploads(next)
  }, [])

  /**
   * 收下一批图片文件：超出上限的部分**直接丢弃**（不提示、不警告色、不进通知栏）。
   * @param files - 来自粘贴或拖入的图片文件。
   */
  const addShots = useCallback((files: readonly File[]): void => {
    const room = MAX_SHOTS - shotsRef.current.length
    if (room <= 0) return
    const next = files.slice(0, room).map((file) => {
      shotSeqRef.current += 1
      const seq = shotSeqRef.current
      return {
        id: `shot-${seq}`,
        name: `shot-${String(seq).padStart(2, '0')}.png`,
        blob: file,
        url: URL.createObjectURL(file),
      }
    })
    applyShots([...shotsRef.current, ...next])
  }, [applyShots])

  /** 描述框粘贴：只拦图片（纯文本粘贴照旧，不能被这里吃掉）。 */
  const onPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>): void => {
    const files: File[] = []
    for (const item of Array.from(event.clipboardData.items)) {
      if (!item.type.startsWith('image/')) continue
      const file = item.getAsFile()
      if (file !== null) files.push(file)
    }
    if (files.length === 0) return
    event.preventDefault()
    addShots(files)
  }

  /** 拖入图片：与粘贴同一条路径（同一上限、同一忽略语义）。 */
  const onDrop = (event: ReactDragEvent<HTMLDivElement>): void => {
    const files = Array.from(event.dataTransfer.files).filter(file => file.type.startsWith('image/'))
    if (files.length === 0) return
    event.preventDefault()
    addShots(files)
  }

  /** 只在拖的是文件时放行 drop（否则会干扰框内的文本拖拽）。 */
  const onDragOver = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
  }

  /** 删掉一张截图：立刻 revoke 它的 ObjectURL、腾出名额（删一张就能再粘一张），并清掉它的上传记录。 */
  const removeShot = (id: string): void => {
    const target = shotsRef.current.find(shot => shot.id === id)
    if (target !== undefined) URL.revokeObjectURL(target.url)
    applyShots(shotsRef.current.filter(shot => shot.id !== id))
    const { [id]: removed, ...rest } = uploadsRef.current
    void removed
    uploadsRef.current = rest
    setUploads(rest)
  }

  /**
   * 清空「本次提交掉的内容」：标题、描述、全部截图 chip（含 ObjectURL 回收）。
   *
   * **只在 `submitIssue` 成功之后调用**（失败一律原样保留：那份内容要能原样重试，
   * 见 `runSubmit` 的两条分支）。类型选择与环境信息勾选**保留**——它们是下一条
   * issue 大概率还要用的同一套表态，不属于「这条 issue 的内容」。
   *
   * 草稿 state 一变，`DRAFT_KEY` 那条 effect 就把它落盘，所以持久化的草稿跟着变空
   * （否则会出现「界面空了、关掉重开又回来」）。成功卡上的标题回显与 `#编号`
   * 取自 `result` 快照，不读 `draft`，因此清空不会把卡片变空白。
   */
  const clearSubmittedContent = useCallback((): void => {
    setDraft(prev => ({ ...EMPTY_DRAFT, kind: prev.kind, includeEnv: prev.includeEnv }))
    for (const shot of shotsRef.current) URL.revokeObjectURL(shot.url)
    applyShots([])
    uploadsRef.current = {}
    setUploads({})
    lastBodyRef.current = ''
  }, [applyShots])

  // ── 授权闸 / 托管 / 上传 ──────────────────────────────────────────

  /**
   * 提交前的授权闸：只有**确认已授权**才放行。
   *
   * 三种结果：
   *   - 已知已授权 ⇒ 直接放行（不再打一次 `/user`）；
   *   - 明确未授权 ⇒ 进 auth 视图，**不提交**；
   *   - `authStatus()` 本身失败（网络/不支持）⇒ 走失败卡（那时把用户推进 auth 视图
   *     反而会引导错方向）。
   * @returns 是否放行提交。
   */
  const ensureAuthorized = async (): Promise<boolean> => {
    if (gateRef.current === 'authorized') return true
    const status = await client.authStatus()
    if (status.ok && status.authorized) {
      setGate('authorized')
      gateRef.current = 'authorized'
      setLogin(status.login)
      return true
    }
    if (status.ok) {
      setGate('unauthorized')
      gateRef.current = 'unauthorized'
      startAuth()
      return false
    }
    setResult({ kind: 'failure', view: failureOf(status.code, status.message, status.detail) })
    return false
  }

  /** 「同意并创建仓库」：调 `ensureAssetsRepo()`，成功才落盘标记并进 form。 */
  const acceptConsent = async (): Promise<void> => {
    setConsentBusy(true)
    setConsentError(null)
    const created = await client.ensureAssetsRepo()
    setConsentBusy(false)
    if (!created.ok) {
      setConsentError(created.detail === undefined
        ? { code: created.code, message: created.message }
        : { code: created.code, message: created.message, detail: created.detail })
      return
    }
    setConsent('accepted')
    consentRef.current = 'accepted'
    try {
      localStorage.setItem(CONSENT_KEY, 'accepted')
    } catch {
      // 落盘失败不影响本次运行（内存里已经是 accepted）。
    }
    setConsentPrompt(false)
  }

  /** 「暂不托管」：本次运行跳过上传（不落盘，下次运行还会再问一次）。 */
  const skipConsent = (): void => {
    setConsent('skipped')
    consentRef.current = 'skipped'
    setConsentPrompt(false)
  }

  /**
   * 上传一张截图（体积闸 → 魔数校验 → RPC）。**不抛**：所有失败都落进 chip 状态。
   * @param shot - 目标截图。
   * @returns `true` 表示这次失败是 `invalid-token`（调用方要转投 auth 视图）。
   */
  const uploadOne = async (shot: Shot): Promise<boolean> => {
    if (shot.blob.size > MAX_UPLOAD_BYTES) {
      // 体积闸在**发请求之前**：Contents API 的上限未从一手文档确认，4 MB 是保守闸。
      applyUpload(shot.id, { state: 'toolarge' })
      return false
    }
    applyUpload(shot.id, { state: 'uploading' })
    const base64 = await readBase64(shot.blob)
    if (base64 === null) {
      applyUpload(shot.id, { state: 'failed', code: 'read-error', message: '读不出这张截图的字节' })
      return false
    }
    if (sniffImageKind(base64) === null) {
      applyUpload(shot.id, { state: 'notimage' })
      return false
    }
    const uploaded = await client.uploadAsset(shot.name, base64)
    if (uploaded.ok) {
      applyUpload(shot.id, { state: 'done', url: uploaded.url })
      return false
    }
    if (uploaded.code === 'invalid-token') return true
    applyUpload(shot.id, { state: 'failed', code: uploaded.code, message: uploaded.message })
    return false
  }

  /** 失败 chip 上的「重试这一张」（只重传这一张，不动别的）。 */
  const retryShot = async (id: string): Promise<void> => {
    const shot = shotsRef.current.find(item => item.id === id)
    if (shot === undefined) return
    const invalid = await uploadOne(shot)
    if (invalid) reauthForInvalidToken()
  }

  // ── 正文 / 提交 ───────────────────────────────────────────────────

  /**
   * 环境表（12 行，行序固定）：预览与正文用的**同一份**数据。
   * 本地半边还没侦测完时用 {@link UNKNOWN_LOCAL_ENV}，先渲染出 12 行 unknown，
   * 不让面板出现「少了几行」的中间态。
   */
  const envRows: MergedEnv = useMemo(
    () => mergeEnv(localEnv ?? UNKNOWN_LOCAL_ENV, hostEnv),
    [localEnv, hostEnv],
  )

  /**
   * 组装正文：描述 + （勾选时）环境表 + （有成功上传的图时）每张一行 `![]()`。
   * **只带真正上传成功的图**——没上传的截图绝不出现在正文里。
   * @param imageLines - 已拼好的图片行。
   * @returns 提交用的完整正文。
   */
  const buildBody = (imageLines: readonly string[]): string => {
    const parts = [draft.body]
    if (draft.includeEnv) parts.push(`---\n\n${envTableMarkdown(envRows)}`)
    if (imageLines.length > 0) parts.push(imageLines.join('\n'))
    return parts.join('\n\n')
  }

  /** 资产仓库名（`corum-issue-assets-<login>`，与 host 的 `assetRepoName()` 同构）。 */
  const assetsRepo = login === null ? `${ASSETS_REPO_PREFIX}…` : `${ASSETS_REPO_PREFIX}${login}`

  /** 「复制内容」用：把当前可见的正文搬进剪贴板（不依赖任何桥）。 */
  const copyCurrentBody = async (): Promise<void> => {
    // 优先用**那次提交实际发出去的**正文（lastBodyRef）；没有就按当前状态重拼一遍
    // （只算真正上传成功的图，与提交时的规则同一份）。
    const imageLines = shotsRef.current
      .filter(shot => uploadsRef.current[shot.id]?.state === 'done')
      .map(shot => `![${shot.name.replace(/\.[a-z0-9]+$/i, '')}](${uploadsRef.current[shot.id]?.url ?? ''})`)
    await copyText(lastBodyRef.current !== '' ? lastBodyRef.current : buildBody(imageLines))
  }

  /**
   * 提交流程（授权闸 → 托管闸 → 逐张上传 → 组装正文 → `submitIssue`）。
   *
   * 全程留在 form 视图（chip 上能看到逐张进度），只有**结束**（成功/失败）或
   * 需要重新授权时才切视图。
   */
  const runSubmit = async (): Promise<void> => {
    // ① 授权闸：未授权不提交，直接进 auth 视图。
    if (!(await ensureAuthorized())) return

    // ② 托管闸：有截图但从未表态 ⇒ 先亮同意卡（本次不提交，选完再点提交）。
    if (shotsRef.current.length > 0 && consentRef.current === 'unasked') {
      setConsentChecked(false)
      setConsentError(null)
      setConsentPrompt(true)
      return
    }

    // ③ 逐张上传（只有「已同意托管」才传；一张失败不阻断其余）。
    if (consentRef.current === 'accepted') {
      for (const shot of shotsRef.current) {
        if (uploadsRef.current[shot.id]?.state === 'done') continue // 已经传过的（含重试）不重复传
        const invalid = await uploadOne(shot)
        if (invalid) {
          reauthForInvalidToken()
          return
        }
      }
    }

    // ④ 正文：只带真正上传成功的图。
    const imageLines: string[] = []
    for (const shot of shotsRef.current) {
      const upload = uploadsRef.current[shot.id]
      if (upload?.state !== 'done' || upload.url === undefined) continue
      imageLines.push(`![${shot.name.replace(/\.[a-z0-9]+$/i, '')}](${upload.url})`)
    }
    const body = buildBody(imageLines)
    lastBodyRef.current = body

    // ⑤ 提交（labels 给类型对应的标签名，host 会过滤成仓库里真实存在的）。
    const submitted = await client.submitIssue(draft.title.trim(), body, [KIND_TAG[draft.kind]])
    if (submitted.ok) {
      // 成功卡的内容全部来自 result 快照（标题回显 + #编号），不读 draft —— 所以下面
      // 清草稿不会把卡片清空。
      setResult({
        kind: 'success',
        view: {
          number: submitted.number,
          htmlUrl: submitted.htmlUrl,
          title: draft.title.trim(),
          uploaded: imageLines.length,
          assetsOwner: login ?? '',
          assetsRepo,
          envIncluded: draft.includeEnv,
        },
      })
      // 成功 ⇒ 清空标题/描述/截图与持久化草稿，用户可以直接报下一条（保留类型与环境勾选）。
      // **失败路径绝不清空**：内容必须原样留在输入框里可重试。
      clearSubmittedContent()
      return
    }
    if (submitted.code === 'invalid-token') {
      // 授权在这条链路上失效：不回结果卡（issue 没建，卡片没有信息量），转投 auth；
      // 用户从 auth 点「取消」会看到已经落好的失败卡。
      setResult({ kind: 'failure', view: failureOf(submitted.code, submitted.message, submitted.detail) })
      reauthForInvalidToken()
      return
    }
    setResult({ kind: 'failure', view: failureOf(submitted.code, submitted.message, submitted.detail) })
  }

  /** 提交按钮：禁用规则由 `disabled` 表达（标题为空即禁用），不是点击后才报错。 */
  const submit = async (): Promise<void> => {
    if (busy || draft.title.trim() === '') return
    setBusy(true)
    try {
      await runSubmit()
    } finally {
      setBusy(false)
    }
  }

  /** 成功卡「再报一个」：内容在提交成功时已经清空，这里只退掉结果卡（幂等）。 */
  const reportAgain = (): void => {
    clearSubmittedContent()
    setResult(null)
  }

  /** 成功卡「打开 issue」/ 失败卡兜底：经窄化桥开外链，桥不可用就退回复制链接。 */
  const openExternal = async (url: string): Promise<void> => {
    const bridge = readBridge()
    if (bridge?.openExternal === undefined) {
      await copyText(url)
      return
    }
    try {
      const opened = await bridge.openExternal(url)
      if (!opened.ok) await copyText(url)
    } catch {
      await copyText(url)
    }
  }

  /** auth 视图「打开授权页」。 */
  const openDevicePage = async (): Promise<void> => {
    const url = session !== null && session.verificationUri !== '' ? session.verificationUri : DEVICE_PAGE_URL
    await openExternal(url)
  }

  /** auth 视图「复制设备码」（1.5 秒内显示「已复制」；写不进去就什么都不说）。 */
  const copyDeviceCode = async (): Promise<void> => {
    if (session === null) return
    if (!(await copyText(session.userCode))) return
    setCopiedCode(true)
    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = window.setTimeout(() => {
      setCopiedCode(false)
      copiedTimerRef.current = null
    }, 1500)
  }

  const dirty = draft.title.trim() !== '' || draft.body.trim() !== ''
  const canSubmit = draft.title.trim() !== '' && !busy
  const dragStyle: CSSProperties | undefined = dragPos === null
    ? undefined
    : { left: dragPos.x, top: dragPos.y, right: 'auto' }

  /** 成功卡的三步（哪一步为真就说哪一步，不说没发生的事）。 */
  const successSteps = (done: SuccessView): string[] => {
    const steps: string[] = []
    steps.push(done.uploaded > 0
      ? `${done.uploaded} 张截图已上传到 ${done.assetsOwner}/${done.assetsRepo}`
      : '截图未上传（正文不含图片）')
    steps.push('issue 已通过 GitHub API 创建（全程无浏览器）')
    const envText = done.envIncluded ? '正文已带上环境信息' : '正文未包含环境信息（你取消了勾选）'
    steps.push(done.uploaded > 0 ? `${envText}与 ${done.uploaded} 张截图链接` : envText)
    return steps
  }

  /** 失败卡的按钮（按 `action` 给可执行动作，不留「只显示错误」的死胡同）。 */
  const failureButtons = (failure: FailureView): ReactElement[] => {
    const buttons: ReactElement[] = []
    if (failure.action === 'reauth') {
      buttons.push(
        <button key="reauth" type="button" className={css.btnPrimary} disabled={busy} onClick={() => { startAuth() }}>
          重新授权
        </button>,
      )
    }
    if (failure.action === 'retry') {
      buttons.push(
        <button key="retry" type="button" className={css.btnPrimary} disabled={busy} onClick={() => { void submit() }}>
          {busy ? '提交中…' : '重试'}
        </button>,
      )
    }
    if (failure.action === 'edit') {
      buttons.push(
        <button key="edit" type="button" className={css.btnPrimary} onClick={() => { setResult(null) }}>
          返回修改
        </button>,
      )
    }
    return buttons
  }

  return (
    <>
      <button
        ref={tabRef}
        type="button"
        className={css.tab}
        data-testid="issue-reporter-tab"
        data-edge={tab.edge}
        data-dragging={dragging || undefined}
        aria-label="提交 Issue / 反馈（可拖到屏幕边缘）"
        style={dragStyle ?? tabStyle(tab)}
        onPointerDown={onPointerDown}
        onClick={onTabClick}
      >
        <Bug size={18} strokeWidth={2} className={css.tabIcon} />
        {dirty && <span className={css.tabDot} aria-hidden="true" />}
        <span className={css.hint} aria-hidden="true">提交 Issue / 反馈</span>
      </button>

      {open && (
        <div ref={panelRef} className={css.panel} data-testid="issue-reporter-panel" style={panelStyle(tab, panelHeight, viewportHeight)} role="dialog" aria-label="提交 Issue">
          {view === 'auth' ? (
            <>
              <div className={css.head}>
                <ShieldCheck size={14} strokeWidth={2} className={css.headIcon} />
                <span className={css.headTitle}>授权 GitHub</span>
                <span className={css.repoPill}>{REPO_SLUG}</span>
                <span className={css.headSpacer} />
                <button type="button" className={css.closeBtn} aria-label="关闭面板" onClick={closePanel}>
                  <X size={12} strokeWidth={2} />
                </button>
              </div>

              <div className={css.divider} />

              <div className={css.auth} data-testid="issue-reporter-auth">
                {authNotice !== null && <span className={css.authNotice}>{authNotice}</span>}

                {authPhase === 'starting' && (
                  <div className={css.authPoll}>
                    <LoaderCircle size={12} strokeWidth={2} className={css.spinner} />
                    <span>正在获取设备码…</span>
                  </div>
                )}

                {authPhase === 'failed' && authError !== null && (
                  <div className={css.authBlock}>
                    <div className={css.authErrRow}>
                      <TriangleAlert size={13} strokeWidth={2} className={css.errIcon} />
                      <span className={css.authErrCode}>{authError.code}</span>
                    </div>
                    <span className={css.errMsg}>{authError.message}</span>
                    {authError.detail !== undefined && <span className={css.errDetail}>{authError.detail}</span>}
                    <div className={css.actions}>
                      <span className={css.actionsSpacer} />
                      <button type="button" className={css.btnPrimary} onClick={() => { startAuth() }}>
                        <RefreshCw size={12} strokeWidth={2} /> 重新获取设备码
                      </button>
                    </div>
                  </div>
                )}

                {expired && (
                  <div className={css.authBlock}>
                    <div className={css.authErrRow}>
                      <TriangleAlert size={13} strokeWidth={2} className={css.errIcon} />
                      <span className={css.authErrCode}>设备码已过期</span>
                    </div>
                    <span className={css.authNote}>设备码有效期已过，GitHub 不再接受这次授权。</span>
                    <div className={css.actions}>
                      <span className={css.actionsSpacer} />
                      <button type="button" className={css.btnPrimary} onClick={() => { startAuth() }}>
                        <RefreshCw size={12} strokeWidth={2} /> 重新获取设备码
                      </button>
                    </div>
                  </div>
                )}

                {authPhase === 'waiting' && session !== null && !expired && (
                  <>
                    <div className={css.authCodeRow}>
                      <span className={css.authCode} data-testid="issue-reporter-auth-code">{session.userCode}</span>
                      <button
                        type="button"
                        className={css.authCopy}
                        data-testid="issue-reporter-auth-copy"
                        onClick={() => { void copyDeviceCode() }}
                      >
                        {copiedCode ? <Check size={11} strokeWidth={2} /> : null}
                        {copiedCode ? '已复制' : '复制设备码'}
                      </button>
                    </div>

                    <button type="button" className={css.authOpen} data-testid="issue-reporter-auth-open" onClick={() => { void openDevicePage() }}>
                      <ExternalLink size={12} strokeWidth={2} /> 打开授权页
                    </button>

                    <div className={css.authPoll} data-testid="issue-reporter-auth-poll" data-retrying={pollRetries > 0 || undefined}>
                      <LoaderCircle size={12} strokeWidth={2} className={css.spinner} />
                      <span>
                        {pollRetries > 0
                          ? `网络抖动，重试中…（第 ${pollRetries} 次，设备码仍然有效）`
                          : `等待授权… 每 ${intervalSec} 秒自动查询一次`}
                      </span>
                    </div>

                    <span className={css.authNote}>
                      在打开的页面里输入上面的设备码并确认；本面板会自动完成授权，不需要回到浏览器复制任何东西。
                    </span>
                  </>
                )}

                <div className={css.actions}>
                  <button type="button" className={css.btnGhost} onClick={cancelAuth}>取消</button>
                </div>
              </div>
            </>
          ) : result !== null ? (
            result.kind === 'success' ? (
              <>
                <div className={css.resultHead} data-testid="issue-reporter-success">
                  <CircleCheck size={16} strokeWidth={2} className={css.okIcon} />
                  <span className={css.resultTitle}>Issue 已创建</span>
                  <span className={css.headSpacer} />
                  <button type="button" className={css.closeBtn} aria-label="关闭面板" onClick={closePanel}>
                    <X size={12} strokeWidth={2} />
                  </button>
                </div>

                <div className={css.resultBody}>
                  <span className={css.resultNumber}>#{result.view.number}</span>
                  <span className={css.resultEcho}>{result.view.title}</span>
                  <span className={css.resultMeta}>{REPO_SLUG}</span>
                  <ol className={css.steps}>
                    {successSteps(result.view).map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}
                  </ol>
                </div>

                <div className={css.actions}>
                  <button type="button" className={css.btnGhost} onClick={() => { void copyText(result.view.htmlUrl) }}>复制链接</button>
                  <button type="button" className={css.btnGhost} onClick={reportAgain}>再报一个</button>
                  <span className={css.actionsSpacer} />
                  <button type="button" className={css.btnPrimary} onClick={() => { void openExternal(result.view.htmlUrl) }}>
                    <ExternalLink size={12} strokeWidth={2} /> 打开 issue
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className={css.resultHead} data-testid="issue-reporter-failure">
                  <CircleX size={16} strokeWidth={2} className={css.errIcon} />
                  <span className={css.resultTitle}>{result.view.title}</span>
                  <span className={css.headSpacer} />
                  <button type="button" className={css.closeBtn} aria-label="关闭面板" onClick={closePanel}>
                    <X size={12} strokeWidth={2} />
                  </button>
                </div>

                <div className={css.resultBody}>
                  <span className={css.errMsg} data-testid="issue-reporter-submit-error">{result.view.code}</span>
                  <span className={css.resultNote}>{result.view.message}</span>
                  {result.view.detail !== undefined && <span className={css.errDetail}>{result.view.detail}</span>}
                  {result.view.hint !== undefined && <span className={css.resultNote}>{result.view.hint}</span>}
                  <span className={css.resultNote}>你的内容还在草稿里。</span>
                </div>

                <div className={css.actions}>
                  <button type="button" className={css.btnGhost} onClick={() => { void copyCurrentBody() }}>复制内容</button>
                  <span className={css.actionsSpacer} />
                  {failureButtons(result.view)}
                </div>
              </>
            )
          ) : (
            <>
              <div className={css.head}>
                <Bug size={14} strokeWidth={2} className={css.headIcon} />
                <span className={css.headTitle}>提交 Issue</span>
                <span className={css.repoPill}>{REPO_SLUG}</span>
                <span className={css.headSpacer} />
                <button type="button" className={css.closeBtn} aria-label="关闭面板" onClick={closePanel}>
                  <X size={12} strokeWidth={2} />
                </button>
              </div>

              <div className={css.divider} />

              {consentPrompt ? (
                <div className={css.consent} data-testid="issue-reporter-consent">
                  <div className={css.consentHead}>
                    <ShieldCheck size={14} strokeWidth={2} className={css.consentIcon} />
                    <span className={css.consentTitle}>截图托管</span>
                  </div>
                  <p className={css.consentText}>
                    GitHub 的 API 不能把图片作为附件放进 issue 正文（正文是 Markdown，图片只能是 URL）。
                    截图会上传到<strong>你账号下的公开仓库</strong>，正文只引用它的 raw 链接。
                  </p>
                  <span className={css.consentRepo}>{assetsRepo}（公开）</span>
                  <label className={css.consentCheck}>
                    <input
                      type="checkbox"
                      data-testid="issue-reporter-consent-check"
                      checked={consentChecked}
                      onChange={(event) => { setConsentChecked(event.target.checked) }}
                    />
                    <span>我了解这些截图会作为公开文件存在这个仓库里</span>
                  </label>
                  {consentError !== null && (
                    <div className={css.consentErr}>
                      <span className={css.authErrCode}>{consentError.code}</span>
                      <span className={css.errMsg}>{consentError.message}</span>
                      {consentError.detail !== undefined && <span className={css.errDetail}>{consentError.detail}</span>}
                      <div className={css.actions}>
                        <span className={css.actionsSpacer} />
                        <button type="button" className={css.btnGhost} disabled={consentBusy} onClick={() => { void acceptConsent() }}>重试</button>
                      </div>
                    </div>
                  )}
                  <div className={css.actions}>
                    <span className={css.actionsSpacer} />
                    <button type="button" className={css.btnGhost} data-testid="issue-reporter-consent-skip" onClick={skipConsent}>
                      暂不托管
                    </button>
                    <button
                      type="button"
                      className={css.btnPrimary}
                      data-testid="issue-reporter-consent-accept"
                      disabled={!consentChecked || consentBusy}
                      onClick={() => { void acceptConsent() }}
                    >
                      {consentBusy ? '创建中…' : '同意并创建仓库'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className={css.kinds} role="group" aria-label="Issue 类型">
                    {KIND_ORDER.map(kind => (
                      <button
                        key={kind}
                        type="button"
                        className={css.kind}
                        data-testid="issue-reporter-kind"
                        data-kind={kind}
                        data-active={draft.kind === kind || undefined}
                        aria-pressed={draft.kind === kind}
                        onClick={() => { setDraft(prev => ({ ...prev, kind })) }}
                      >
                        {KIND_LABEL[kind]}
                      </button>
                    ))}
                  </div>

                  <label className={css.field}>
                    <span className={css.labelRow}>
                      <span className={css.label}>标题</span>
                      <span className={css.required}>必填</span>
                    </span>
                    <input
                      ref={titleRef}
                      className={css.input}
                      data-testid="issue-reporter-title"
                      value={draft.title}
                      placeholder="一句话说明问题，如：切换模型后会话卡死"
                      onChange={(event) => { setDraft(prev => ({ ...prev, title: event.target.value })) }}
                    />
                  </label>

                  <div className={css.field}>
                    <span className={css.labelRow}>
                      <span className={css.label}>详细描述</span>
                      <span className={css.hintText}>支持 Markdown</span>
                    </span>
                    <div className={css.descBox} data-testid="issue-reporter-desc" onDragOver={onDragOver} onDrop={onDrop}>
                      {shots.length > 0 && (
                        <div className={css.shotRow}>
                          {shots.map((shot, index) => {
                            const upload: ShotUpload | undefined = uploads[shot.id]
                            const state: UploadState = upload?.state ?? 'idle'
                            const badge = uploadLabel(state)
                            return (
                              <div key={shot.id} className={css.shot} data-testid="issue-reporter-chip" data-shot-index={index + 1} data-state={state}>
                                <ImageIcon size={16} strokeWidth={2} className={css.shotIcon} />
                                <span className={css.shotName}>{shot.name}</span>
                                {badge.icon !== 'none' && (
                                  <span className={css.chipState} data-testid="issue-reporter-chip-state" data-state={state}>
                                    {badge.icon === 'spinner' && <LoaderCircle size={9} strokeWidth={2} className={css.spinner} />}
                                    {badge.icon === 'check' && <Check size={9} strokeWidth={2} />}
                                    {badge.text}
                                  </span>
                                )}
                                {state === 'failed' && (
                                  <button type="button" className={css.chipRetry} onClick={() => { void retryShot(shot.id) }}>
                                    重试这一张
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className={css.shotRemove}
                                  data-testid="issue-reporter-chip-remove"
                                  aria-label={`移除第 ${index + 1} 张截图`}
                                  onClick={() => { removeShot(shot.id) }}
                                >
                                  <X size={10} strokeWidth={2} />
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      )}
                      <textarea
                        className={css.textarea}
                        data-testid="issue-reporter-desc-input"
                        value={draft.body}
                        placeholder={DESC_PLACEHOLDER}
                        onChange={(event) => { setDraft(prev => ({ ...prev, body: event.target.value })) }}
                        onPaste={onPaste}
                      />
                    </div>
                  </div>

                  <div className={css.envCard}>
                    <label className={css.envCheck}>
                      <input
                        type="checkbox"
                        data-testid="issue-reporter-env"
                        checked={draft.includeEnv}
                        onChange={(event) => { setDraft(prev => ({ ...prev, includeEnv: event.target.checked })) }}
                      />
                      <span>附带环境信息（自动附加，可取消）</span>
                    </label>
                    {/* 预览：默认折叠前 4 行，展开后是**全部 12 行**——用户提交前必须能
                        看清将被附上的每一行（隐私要求，不是装饰）。 */}
                    <div
                      className={css.envPreview}
                      data-testid="issue-reporter-env-preview"
                      data-expanded={envOpen ? 'true' : undefined}
                    >
                      {(envOpen ? envRows : envRows.slice(0, ENV_PREVIEW_ROWS)).map(row => (
                        <div key={row.key} className={css.envRow} data-testid="issue-reporter-env-row" data-key={row.key}>
                          <span className={css.envRowKey}>{row.key}</span>
                          <span className={css.envRowValue}>{row.value}</span>
                        </div>
                      ))}
                      <button
                        type="button"
                        className={css.envToggle}
                        data-testid="issue-reporter-env-toggle"
                        aria-expanded={envOpen}
                        onClick={() => { setEnvOpen(prev => !prev) }}
                      >
                        {envOpen ? '收起' : `共 ${envRows.length} 项 · 展开`}
                      </button>
                    </div>
                    {shots.length > 0 && (
                      <span className={css.envLine}>
                        {consent === 'accepted'
                          ? `截图将上传到 ${assetsRepo} 并作为图片链接写进正文`
                          : shots.length > 0 && consent === 'skipped'
                            ? '本次运行不托管截图：正文不含图片'
                            : '尚未决定截图托管：提交时会先问一次'}
                      </span>
                    )}
                  </div>

                  <div className={css.actions}>
                    <button type="button" className={css.btnGhost} onClick={closePanel}>取消</button>
                    <span className={css.actionsSpacer} />
                    <button type="button" className={css.btnPrimary} data-testid="issue-reporter-submit" disabled={!canSubmit} onClick={() => { void submit() }}>
                      {busy ? '提交中…' : '提交 Issue'}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </>
  )
}
