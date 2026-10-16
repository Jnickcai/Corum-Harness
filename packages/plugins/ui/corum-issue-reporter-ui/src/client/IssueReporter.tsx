/**
 * IssueReporter — corum 的 Issue 提交入口（悬浮按钮 + 提交面板）。
 *
 * 形态照抄通知悬浮按钮（`packages/desktop/src/client/NotificationHost.tsx` 的
 * `drawer-tab`）：56×52、`position: fixed`、`z-index: 9999`、玻璃底 + 描边 + 外阴影、
 * 可拖动松手吸附最近边缘、位置持久化、6px 阈值区分点击与拖动。差别只有三处：
 *   ① 轴向偏移缺省 **184**（通知 bell 是 120，本入口排它下面一行，不压未读徽标）；
 *   ② 吸附只认左右两条边（面板要贴在按钮内侧，上下边会让面板压住按钮）；
 *   ③ 图标用品牌色 token（bell 用 `--dsw-alias-label-secondary`），并在有未提交草稿
 *      时右上角加一个 6px 品牌色圆点。
 *
 * 提交流程是**纯手工**的：不调用任何模型、不发任何网络请求——只把用户填的内容
 * 组装成 GitHub 的 `issues/new` 预填 URL，把该提前搬进剪贴板的东西（正文 / 第一张
 * 截图 / 退化的链接）搬进系统剪贴板，然后交给系统浏览器（`openExternal`）打开。
 * 截图只存在内存（ObjectURL），**不落 localStorage**；落盘的只有草稿三项与环境勾选。
 *
 * 为什么环境信息是「只读一行 + 一个勾」而不是可编辑文本框：它是**确定性读取**
 * （应用版本 / dsh 基座版本 / 平台），让用户能改就等于让报障信息可以失真。
 * @module corum-issue-reporter/client/IssueReporter
 */

import {
  useCallback, useEffect, useRef, useState,
  type CSSProperties, type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent,
} from 'react'
import { Bug, CircleCheck, CircleX, Image as ImageIcon, X } from 'lucide-react'
import { readBridge } from './bridge.ts'
import css from './IssueReporter.module.css'

/** 贴边位置持久化键（纯 UI 偏好，不参与跨 bundle 共享状态）。 */
const TAB_KEY = 'corum.issueReporter.tab'

/** 草稿持久化键（标题/描述/类型/环境勾选；**截图不落盘**）。 */
const DRAFT_KEY = 'corum.issueReporter.draft'

/** Issue 目标仓库（预填 URL 的 path 段）。 */
const REPO_SLUG = 'kukucaiCndy/Corum-Harness'

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

/** GitHub 的 `issues/new` 预填 URL 长度上限：超过就把正文改走系统剪贴板。 */
const URL_LIMIT = 8000

/** 描述框的 placeholder（三行：发生了什么 / 空行 / 复现步骤 + 粘贴提示）。 */
const DESC_PLACEHOLDER = '发生了什么？\n\n复现步骤 / 期望结果 · 截图直接 Ctrl+V 粘到这里'

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

/** 类型 → GitHub label（`issues/new?...&labels=`）。 */
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

/** 剪贴板里现在装的是什么（决定成功态步骤①的文案；`none` = 什么都没搬，不编造）。 */
type CopiedMode = 'shot-copied' | 'body-copied' | 'link-copied' | 'none'

/** 成功态的浏览器打开结果（与剪贴板内容分开记，两条步骤各自如实）。 */
type OpenOutcome = 'opened' | 'link-copied' | 'failed'

/** 成功态。 */
interface SubmitSuccess {
  ok: true
  mode: CopiedMode
  outcome: OpenOutcome
  /** 回显的标题。 */
  title: string
  /** 最终使用的 URL（退化后可能只带 title，故要留着给「打开 GitHub」再调一次）。 */
  url: string
}

/** 失败态（内容仍在草稿里，故要留着 URL 给「复制内容并打开」）。 */
interface SubmitFailure {
  ok: false
  message: string
  url: string
}

/** 提交结果：`null` = 编辑态（面板显示表单）。 */
type SubmitResult = SubmitSuccess | SubmitFailure

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

/** 面板样式：垂直中心对齐按钮中心，贴右时在按钮左侧、贴左时镜像。 */
function panelStyle(position: TabPosition): CSSProperties {
  // 面板高度可变（内容而定），故用 top=中心 + translateY(-50%) 表达「中心对齐」，
  // 而不是去测量面板高度（测量会引入一次额外的 layout 与抖动）。
  const center = position.offset + TAB_HEIGHT / 2
  const base: CSSProperties = { top: center, transform: 'translateY(-50%)' }
  return position.edge === 'right'
    ? { ...base, right: TAB_WIDTH + PANEL_GAP }
    : { ...base, left: TAB_WIDTH + PANEL_GAP }
}

/** 从 window 读剪贴板写入口（非 secure context / 老壳下不存在）。 */
function readClipboard(): { writeText: (text: string) => Promise<void>; write: (items: ClipboardItem[]) => Promise<void> } | undefined {
  return (navigator as unknown as {
    clipboard?: { writeText: (text: string) => Promise<void>; write: (items: ClipboardItem[]) => Promise<void> }
  }).clipboard
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
 * 把一张截图写进系统剪贴板。
 *
 * 走 `ClipboardItem({'image/png': blob})`：GitHub 的正文框能直接吃图片粘贴。
 * 整个调用用 try/catch 包住——剪贴板在非 secure context 下不可用、或宿主拒绝
 * 写入图片时，调用方要能**如实**降级成 body-copied，而不是假装复制过了。
 * @param blob - 截图原始数据。
 * @returns 是否真的写成功。
 */
async function copyImage(blob: Blob): Promise<boolean> {
  const clipboard = readClipboard()
  if (clipboard === undefined || typeof ClipboardItem === 'undefined') return false
  try {
    await clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch {
    return false
  }
}

/** 错误对象 → 可读文案（面板的失败态要显示等宽小字错误信息）。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 悬浮入口 + 提交面板。
 * @returns 入口按钮与（展开时的）面板。
 */
export function IssueReporter() {
  const [tab, setTab] = useState<TabPosition>(readTab)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(readDraft)
  const [shots, setShots] = useState<Shot[]>([])
  const [result, setResult] = useState<SubmitResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  /** 拖动中的临时位置（视口坐标；松手吸附后清空）。 */
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  /** 成功态里「已复制第 N 张」的标记（0 = 还没点过）。 */
  const [copiedShot, setCopiedShot] = useState(0)
  /** 环境信息（确定性读取，取不到就显示 unknown，不编造）。 */
  const [env, setEnv] = useState({ appVersion: 'unknown', baseline: 'unknown', platform: 'unknown' })

  const tabRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const titleRef = useRef<HTMLInputElement | null>(null)
  /** 拖动是否真的越过了阈值（越过则松手不触发展开）。 */
  const draggedRef = useRef(false)
  /** 截图命名序号（只增不减：删掉一张再粘一张不会撞名）。 */
  const shotSeqRef = useRef(0)
  /** 截图快照（卸载时按它逐个 revoke ObjectURL——state 在清理函数里读不到最新值）。 */
  const shotsRef = useRef<Shot[]>([])
  /** 进行中的拖动监听清理器（组件在拖动中途卸载时不漏监听）。 */
  const dragCleanupRef = useRef<(() => void) | null>(null)

  // 贴边位置持久化（与通知 bell 同一套：UI 偏好写 localStorage，不进跨 bundle 状态）。
  useEffect(() => { writeStorage(TAB_KEY, tab) }, [tab])

  // 草稿持久化（截图不落盘）。
  useEffect(() => { writeStorage(DRAFT_KEY, draft) }, [draft])

  // 截图快照：给卸载清理用。
  useEffect(() => { shotsRef.current = shots }, [shots])

  // 卸载时 revoke 所有还活着的 ObjectURL（否则每张粘贴的图都留一份内存）。
  useEffect(() => () => {
    for (const shot of shotsRef.current) URL.revokeObjectURL(shot.url)
  }, [])

  // 卸载时摘掉可能还在的拖动监听。
  useEffect(() => () => { dragCleanupRef.current?.() }, [])

  // 环境信息（应用版本 / dsh 基座版本异步取一次；平台同步取）。
  useEffect(() => {
    const bridge = readBridge()
    const platform = bridge?.getPlatform?.()
    if (platform !== undefined) setEnv(prev => ({ ...prev, platform }))
    let cancelled = false
    void (async () => {
      try {
        const version = await bridge?.getAppVersion?.()
        if (!cancelled && typeof version === 'string' && version !== '') {
          setEnv(prev => ({ ...prev, appVersion: version }))
        }
      } catch {
        // 取不到就保留 unknown（宁可显示 unknown，也不编造一个版本号）。
      }
      try {
        const baseline = await bridge?.getDshBaselineVersion?.()
        if (!cancelled && typeof baseline === 'string' && baseline !== '') {
          setEnv(prev => ({ ...prev, baseline }))
        }
      } catch {
        // 同上：基座版本取不到时显示 unknown。
      }
    })()
    return () => { cancelled = true }
  }, [])

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

  /** 收起面板：结果卡一并清掉（issue 已经建好了，重开面板该回到表单；草稿还在）。 */
  const closePanel = useCallback((): void => {
    setOpen(false)
    setResult(null)
    setCopiedShot(0)
  }, [])

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

  // 打开后焦点落在标题输入框（键盘用户不必再 Tab 一轮）。
  useEffect(() => {
    if (open) titleRef.current?.focus()
  }, [open])

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

  /**
   * 收下一批图片文件：超出上限的部分**直接丢弃**（不提示、不警告色、不进通知栏）。
   * @param files - 来自粘贴或拖入的图片文件。
   */
  const addShots = (files: readonly File[]): void => {
    const room = MAX_SHOTS - shots.length
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
    setShots(prev => [...prev, ...next])
  }

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

  /** 删掉一张截图：立刻 revoke 它的 ObjectURL，并腾出名额（删一张就能再粘一张）。 */
  const removeShot = (id: string): void => {
    const target = shots.find(shot => shot.id === id)
    if (target !== undefined) URL.revokeObjectURL(target.url)
    setShots(prev => prev.filter(shot => shot.id !== id))
  }

  /** 环境信息行（确定性读取的三段；取不到的那段显示 unknown）。 */
  const envLine = `Corum v${env.appVersion} · dsh ${env.baseline} · ${env.platform}`

  /** 组装正文（环境块只在勾选时拼入）。 */
  const buildBody = (): string => draft.includeEnv
    ? `${draft.body}\n\n---\n\n### 环境\n- ${envLine}`
    : draft.body

  /** 预填 URL（`labels=` 一起带上）。 */
  const buildUrl = (title: string, body: string): string =>
    `https://github.com/${REPO_SLUG}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=${encodeURIComponent(KIND_TAG[draft.kind])}`

  /**
   * 提交流程（纯手工：不调模型、不发网络请求）。
   *
   * 打开方式**必须依次判断**（顺序即优先级）：
   *   ① URL 超长 ⇒ 正文改走系统剪贴板，URL 退化为只带 title；
   *   ② 有截图 ⇒ 把**第一张**写进系统剪贴板（失败则降级为 body-copied 并如实标记）；
   *   ③ 交给系统浏览器 `openExternal`。
   * 桥缺席（旧 host）时不能走 `window.open`（壳会拦），只能把链接写进剪贴板。
   * @returns 结果卡要渲染的状态。
   */
  const runSubmit = async (): Promise<SubmitResult> => {
    const title = draft.title.trim()
    const body = buildBody()
    const bridge = readBridge()
    let url = buildUrl(title, body)

    // ① 长度超限：GitHub 也读不了那么长的 query，正文退化为剪贴板搬运。
    const tooLong = url.length > URL_LIMIT
    if (tooLong) url = `https://github.com/${REPO_SLUG}/issues/new?title=${encodeURIComponent(title)}&labels=${encodeURIComponent(KIND_TAG[draft.kind])}`

    // ③′ 桥缺席：直接进成功态，但第②步换成「链接已复制到剪贴板，请在浏览器打开」。
    if (bridge?.openExternal === undefined) {
      const copied = await copyText(url)
      return { ok: true, mode: copied ? 'link-copied' : 'none', outcome: 'link-copied', title, url }
    }

    // ①② 决定剪贴板里装什么（决定成功态步骤①的文案）。
    let mode: CopiedMode = 'none'
    if (tooLong) {
      mode = await copyText(body) ? 'body-copied' : 'none'
    } else if (shots.length > 0) {
      mode = await copyImage(shots[0]!.blob) ? 'shot-copied' : 'none'
      // 图片写不进去（非 secure context 等）⇒ 降级为正文，并如实标记成 body-copied。
      if (mode === 'none') mode = await copyText(body) ? 'body-copied' : 'none'
    }

    // ③ 系统浏览器打开；`ok:false` 与抛错都是失败态（不假装成功）。
    try {
      const opened = await bridge.openExternal(url)
      if (opened.ok) return { ok: true, mode, outcome: 'opened', title, url }
      return { ok: false, message: opened.error ?? 'openExternal 返回 ok:false', url }
    } catch (error) {
      return { ok: false, message: errorMessage(error), url }
    }
  }

  /** 提交按钮：禁用规则由 `disabled` 表达（标题为空即禁用），不是点击后才报错。 */
  const submit = async (): Promise<void> => {
    if (busy || draft.title.trim() === '') return
    setBusy(true)
    try {
      setResult(await runSubmit())
    } finally {
      setBusy(false)
    }
  }

  /** 失败态「复制内容并打开」：先复制正文（不依赖桥），再试着打开一次。 */
  const copyAndOpen = async (url: string): Promise<void> => {
    const copied = await copyText(buildBody())
    const bridge = readBridge()
    let outcome: OpenOutcome = copied ? 'failed' : 'link-copied'
    if (bridge?.openExternal !== undefined) {
      try {
        outcome = (await bridge.openExternal(url)).ok ? 'opened' : 'failed'
      } catch {
        outcome = 'failed'
      }
    } else if (!copied) {
      // 桥缺席**且**剪贴板也不可用：连链接都递不出去，不能假装成功。
      setResult({ ok: false, message: '剪贴板与系统浏览器均不可用', url })
      return
    } else {
      // 桥缺席时正文已经在剪贴板里，链接无处可放——如实标成 link-copied 会让文案说谎，
      // 故这里重写一次剪贴板为「正文 + 链接」，两步都能落到用户手里。
      outcome = await copyText(`${buildBody()}\n\nIssue 页面：${url}`) ? 'failed' : 'link-copied'
    }
    setResult({ ok: true, mode: copied ? 'body-copied' : 'none', outcome, title: draft.title.trim(), url })
  }

  /** 成功态「复制正文」。 */
  const copyBodyAgain = async (): Promise<void> => {
    await copyText(buildBody())
  }

  /** 成功态「复制第 N 张截图」（逐张；点了显示「已复制第 N 张」，失败则不谎报）。 */
  const copyShotAt = async (index: number): Promise<void> => {
    const shot = shots[index]
    if (shot === undefined) return
    setCopiedShot(await copyImage(shot.blob) ? index + 1 : 0)
  }

  /** 成功态/失败态的「打开 GitHub」：再调一次 openExternal（依然不依赖 window.open）。 */
  const reopen = async (url: string): Promise<void> => {
    const bridge = readBridge()
    if (bridge?.openExternal === undefined) {
      await copyText(url)
      return
    }
    try {
      await bridge.openExternal(url)
    } catch {
      // 再打开失败不改状态：URL 已经显示在结果卡里，用户可手动复制。
    }
  }

  const dirty = draft.title.trim() !== '' || draft.body.trim() !== ''
  const canSubmit = draft.title.trim() !== '' && !busy
  const dragStyle: CSSProperties | undefined = dragPos === null
    ? undefined
    : { left: dragPos.x, top: dragPos.y, right: 'auto' }

  /** 成功态的三步说明（哪一步为真就说哪一步，不说没发生的事）。 */
  const successSteps = (success: SubmitSuccess): string[] => {
    const steps: string[] = []
    if (success.outcome !== 'link-copied') {
      if (success.mode === 'shot-copied') steps.push(`${shots.length} 张截图已复制到剪贴板（第 1 张）`)
      else if (success.mode === 'body-copied') steps.push('正文已复制到剪贴板')
    }
    if (success.outcome === 'opened') steps.push('已用系统浏览器打开 issue 页面')
    else if (success.outcome === 'link-copied') steps.push('链接已复制到剪贴板，请在浏览器打开')
    else steps.push('未能打开浏览器，请复制下方链接手动打开')
    steps.push(success.mode === 'shot-copied'
      ? '在正文框按 Ctrl+V 上传截图'
      : '在打开的页面里确认正文后提交')
    return steps
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
        <div ref={panelRef} className={css.panel} data-testid="issue-reporter-panel" style={panelStyle(tab)} role="dialog" aria-label="提交 Issue">
          {result === null ? (
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
                      {shots.map((shot, index) => (
                        <div key={shot.id} className={css.shot} data-testid="issue-reporter-chip" data-shot-index={index + 1}>
                          <ImageIcon size={16} strokeWidth={2} className={css.shotIcon} />
                          <span className={css.shotName}>{shot.name}</span>
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
                      ))}
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
                <span className={css.envLine}>{envLine}</span>
              </div>

              <div className={css.actions}>
                <button type="button" className={css.btnGhost} onClick={closePanel}>取消</button>
                <span className={css.actionsSpacer} />
                <button type="button" className={css.btnPrimary} data-testid="issue-reporter-submit" disabled={!canSubmit} onClick={() => { void submit() }}>
                  {busy ? '提交中…' : '提交 Issue'}
                </button>
              </div>
            </>
          ) : result.ok ? (
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
                <span className={css.resultMeta}>GitHub 新建页</span>
                <span className={css.resultEcho}>{result.title}</span>
                <ol className={css.steps}>
                  {successSteps(result).map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}
                </ol>
                {result.outcome !== 'opened' && <span className={css.resultUrl}>{result.url}</span>}
              </div>

              <div className={css.actions}>
                <button type="button" className={css.btnGhost} onClick={() => { void copyBodyAgain() }}>复制正文</button>
                {shots.map((shot, index) => (
                  <button
                    key={shot.id}
                    type="button"
                    className={css.btnGhost}
                    onClick={() => { void copyShotAt(index) }}
                  >
                    {copiedShot === index + 1 ? `已复制第 ${index + 1} 张` : `复制第 ${index + 1} 张截图`}
                  </button>
                ))}
                <span className={css.actionsSpacer} />
                <button type="button" className={css.btnPrimary} onClick={() => { void reopen(result.url) }}>打开 GitHub</button>
              </div>
            </>
          ) : (
            <>
              <div className={css.resultHead} data-testid="issue-reporter-failure">
                <CircleX size={16} strokeWidth={2} className={css.errIcon} />
                <span className={css.resultTitle}>提交失败</span>
                <span className={css.headSpacer} />
                <button type="button" className={css.closeBtn} aria-label="关闭面板" onClick={closePanel}>
                  <X size={12} strokeWidth={2} />
                </button>
              </div>

              <div className={css.resultBody}>
                <span className={css.errMsg}>{result.message}</span>
                <span className={css.resultNote}>你的内容还在草稿里</span>
              </div>

              <div className={css.actions}>
                <span className={css.actionsSpacer} />
                <button type="button" className={css.btnGhost} onClick={() => { void copyAndOpen(result.url) }}>复制内容并打开</button>
                <button type="button" className={css.btnPrimary} disabled={busy} onClick={() => { void submit() }}>
                  {busy ? '提交中…' : '重试'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}
