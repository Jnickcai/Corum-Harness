/**
 * 逐行 diff（LCS）——导入向导第④步冲突处理的 host 端基础。
 *
 * ## 背景
 *
 * 当前导入 Agent 预设时，第④步冲突处理对技能/MCP 只显示「同名已存在」+ 一个全局的
 * 「保留/覆盖」单选。用户看不到现有内容与模块内容的具体差异。本模块提供 split-view
 * diff 视图所需的数据（左右对照、红删绿增），让 UI 能像编辑器 diff 一样展示逐行差异。
 *
 * ## 算法
 *
 * 基于最长公共子序列（LCS）做行级 diff（与 `git diff --no-indent-heuristic` 同族，
 * 但更简单——只做行粒度，不做词粒度）。步骤：
 *
 * 1. 按行切分两个文本（`splitLines`）。
 * 2. 对行数组求 LCS（经典 DP，`O(n*m)` 时间与空间）。
 * 3. 从 LCS 回溯出 edit script：每行标记 `same` / `del`（左独有）/ `add`（右独有）。
 * 4. 把连续的 `same` 段折叠：差异前后各保留 `contextLines` 行上下文，中间折叠成 `folded`。
 * 5. 连续的 del/add（夹少量上下文）组成一个 hunk。
 *
 * ## 设计决定
 *
 * - **不引入外部依赖**（不用 `diff` npm 包）：本仓的 host 纯函数库纪律是自包含；
 *   LCS 实现不到 80 行，引入一个包反而带来版本/安全面。
 * - **行级、不做词级**：技能/MCP 内容主要是文本/JSON，行级差异已足够让人理解；
 *   词级会让 hunk 结构复杂化且对非英文文本有边界问题。UI 若要词级高亮可在渲染层做。
 * - **纯函数、不抛异常**：`diffText` 对任何两个 string 都返回 `DiffResult`（空文本也
 *   产出合法结果），符合本包「fail-loud 但用返回值表达」的约定。
 * - **折叠段用 `folded` 而非省略**：UI 可以渲染一个「⋯ N 行相同」的可展开块，
 *   也可以直接跳过——数据层只负责如实描述。
 *
 * @module @corum/corum-preset-modules/diff
 */

/**
 * 一行 diff 的类型。
 *
 * - `same`：左右两侧都有这行（上下文）。
 * - `del`：左侧（现有内容）独有 ⇒ 要删。
 * - `add`：右侧（模块内容）独有 ⇒ 要增。
 */
export type DiffLineKind = 'same' | 'del' | 'add'

/**
 * split-view 里的一行。
 *
 * `leftNum`/`rightNum` 是行号（1-based）。`null` 表示该侧无对应行：
 * - `add` 行：`leftNum===null`（模块新增，现有侧无）。
 * - `del` 行：`rightNum===null`（现有独有，模块侧无）。
 * - `same` 行：两侧都有行号。
 */
export interface DiffHunkLine {
  /** 现有侧行号（1-based）；`null` = 这行是模块新增，现有侧无对应行。 */
  readonly leftNum: number | null
  /** 模块侧行号（1-based）；`null` = 这行是现有独有，模块侧无对应行。 */
  readonly rightNum: number | null
  /** 行内容（不含换行符）。 */
  readonly content: string
  /** 行类型。 */
  readonly kind: DiffLineKind
}

/**
 * 一个折叠的相同段（夹在两个差异 hunk 之间）。
 *
 * 当差异之间有大段完全相同的行时，UI 可以把它折叠成一个「⋯ N 行相同」的块，
 * 展开则显示原始内容。`startLeft`/`startRight` 是该段第一行在左右两侧的行号，
 * 供 UI 展开后定位。
 */
export interface DiffFolded {
  /** 折叠的相同行数。 */
  readonly count: number
  /** 该段第一行在现有侧（左侧）的行号（1-based）。 */
  readonly startLeft: number
  /** 该段第一行在模块侧（右侧）的行号（1-based）。 */
  readonly startRight: number
}

/**
 * 一个差异 hunk。
 *
 * `folded`（如有）出现在 `lines` **之前**：表示上一个 hunk 结束后、本 hunk 开始前
 * 那段被折叠的相同行。第一个 hunk 若有 `folded`，表示文件开头的相同行被折叠。
 * `lines` 是差异行 + 少量上下文（diff -U 式）。连续的 del/add 组成本 hunk 的核心，
 * 上下文 `same` 行帮助定位差异位置。
 */
export interface DiffHunk {
  /** 折叠的相同段（夹在本 hunk 与上一个 hunk 之间）。无折叠段则省略。 */
  readonly folded?: DiffFolded
  /** 差异行（del/add/same 交替，但主要是 del+add）。same 行是上下文。 */
  readonly lines: readonly DiffHunkLine[]
}

/**
 * 两个文本的逐行 diff 结果（无文件路径元信息——纯 diff）。
 *
 * 这是 {@link diffText} 的直接产物。{@link FileDiffResult} 在此基础上附带路径与统计，
 * 是 `ModuleInspection` 里 skills/mcp 冲突项带的 diff 数据形态。
 */
export interface DiffResult {
  /** 分段后的 hunks（已折叠相同行）。 */
  readonly hunks: readonly DiffHunk[]
  /** 统计：新增行数。 */
  readonly added: number
  /** 统计：删除行数。 */
  readonly removed: number
}

/**
 * 一个文件的 diff 结果（带相对路径与统计）。
 *
 * 技能的每个文件（`SKILL.md`、`scripts/*.sh` 等）各产出一份；MCP 的单个 JSON 配置
 * 产出一份。这是 UI split 视图的数据源——每个 `FileDiffResult` 渲染一个对照面板。
 */
export interface FileDiffResult {
  /** 相对路径（技能=SKILL.md / scripts/xxx；MCP=配置字段名）。 */
  readonly path: string
  /** diff 分段。 */
  readonly hunks: readonly DiffHunk[]
  /** 统计：新增行数。 */
  readonly added: number
  /** 统计：删除行数。 */
  readonly removed: number
}

/** 折叠阈值：连续相同行超过此数才折叠（否则当上下文留在 hunk 里）。 */
const FOLD_THRESHOLD = 6
/** 每个 hunk 保留的上下文行数（差异前后各这么多行）。 */
const CONTEXT_LINES = 3

/**
 * 按行切分文本，保留行内容（不含换行符）。
 *
 * 与 `String.split('\n')` 的区别：末尾换行不产生多余空串。
 * `'a\nb\n'` → `['a', 'b']`（不是 `['a', 'b', '']`）。
 * 空字符串 `''` → `[]`（无行）。
 *
 * @param text - 原始文本。
 * @returns 行数组（不含换行符）。
 */
function splitLines(text: string): string[] {
  if (text === '') return []
  // 统一换行：CRLF → LF，CR → LF，避免同名行因换行符不同被误判为差异。
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  // 去掉末尾换行后切分：与 git diff 一致（末尾换行不单独算一行）。
  const trimmed = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized
  return trimmed.split('\n')
}

/**
 * 对两个行数组求 LCS 回溯路径，产出逐行 edit script。
 *
 * 经典 DP：
 * - `dp[i][j]` = `a[0..i)` 与 `b[0..j)` 的 LCS 长度。
 * - 回溯：`a[i-1] === b[j-1]` → same；否则往长度大的方向走，产出 del/add。
 *
 * 返回的行按**出现顺序**排列（左到右扫），每行带 `kind`。
 * 用一个 discriminated union（行类型 + 行号占位）表达，后面再补具体行号。
 */
interface RawDiffLine {
  readonly kind: DiffLineKind
  /** 左数组下标（same/del 有值；add 为 null）。 */
  readonly ai: number | null
  /** 右数组下标（same/add 有值；del 为 null）。 */
  readonly bi: number | null
  readonly content: string
}

function computeLcsDiff(a: string[], b: string[]): RawDiffLine[] {
  const n = a.length
  const m = b.length
  // 空间优化可以用滚动数组，但 O(n*m) 内存对文本 diff 完全够用（技能文件多在 KB 级），
  // 且需要完整表来回溯。保持简单可读优先。
  // dp[i][j] = a[0..i) 与 b[0..j) 的 LCS 长度。
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }
  // 回溯：从 (n, m) 往 (0, 0) 走，按逆序收集行，最后反转。
  const rev: RawDiffLine[] = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      rev.push({ kind: 'same', ai: i - 1, bi: j - 1, content: a[i - 1] })
      i -= 1
      j -= 1
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      rev.push({ kind: 'add', ai: null, bi: j - 1, content: b[j - 1] })
      j -= 1
    } else {
      rev.push({ kind: 'del', ai: i - 1, bi: null, content: a[i - 1] })
      i -= 1
    }
  }
  return rev.reverse()
}

/**
 * 一个 hunk 在 raw 里的范围（含上下文）+ 它前面夹着的折叠段。
 *
 * `start`/`end` 是 raw 下标（闭区间）。`foldStart`/`foldEnd` 是上一个 hunk 尾部
 * 上下文结束之后、本 hunk 头部上下文开始之前被折叠的相同段；`-1` 表示无折叠段。
 */
interface HunkRange {
  /** 本 hunk 头部上下文起始下标（含）。 */
  readonly start: number
  /** 本 hunk 尾部上下文结束下标（含）。 */
  readonly end: number
  /** 本 hunk 之前的折叠段起始下标（含）；无折叠段时为 -1。 */
  readonly foldStart: number
  /** 本 hunk 之前的折叠段结束下标（含）；无折叠段时为 -1。 */
  readonly foldEnd: number
}

/**
 * 把逐行 edit script 组装成带折叠上下文的 hunks。
 *
 * 策略（diff -U 式，两阶段）：
 *
 * 1. **分组**：找出所有差异行（del+add）下标；把相邻差异（间隔 ≤ `FOLD_THRESHOLD`
 *    行相同）归进同一组，组与组之间隔 > `FOLD_THRESHOLD` 行相同 ⇒ 拆开。每组算出
 *    带上下文的 `[start, end]` 范围与夹在前面的 `fold` 段。
 * 2. **产出**：按组把 raw[start..end] 的行（含 del/add/same 上下文）收进 hunk.lines，
 *    组前的折叠段记进 hunk.folded。
 *
 * - 全无差异 ⇒ 返回空 hunks（caller 据 added/removed===0 判断「无差异」）。
 *
 * 两阶段的好处：分组逻辑与行号计算解耦，比边扫边收更不易错（避免重复加上下文）。
 *
 * @param raw - {@link computeLcsDiff} 的产出。
 * @returns hunks 数组（可能为空）。
 */
function buildHunks(raw: readonly RawDiffLine[]): readonly DiffHunk[] {
  if (raw.length === 0) return []
  // 差异行的下标集合（del + add）。
  const diffIdx: number[] = []
  for (let k = 0; k < raw.length; k++) {
    if (raw[k].kind !== 'same') diffIdx.push(k)
  }
  // 无差异 ⇒ 空 hunks（added/removed 在 caller 已算）。
  if (diffIdx.length === 0) return []

  // 阶段 1：把差异行分组成 hunk 范围。
  // 第一个差异行的 hunk 头部上下文从 max(0, k-CONTEXT_LINES) 开始。
  const ranges: HunkRange[] = []
  let groupStart = Math.max(0, diffIdx[0] - CONTEXT_LINES)
  let groupEnd = Math.min(raw.length - 1, diffIdx[0] + CONTEXT_LINES)
  // 上一个组的尾部上下文结束下标（含）；-1 表示尚未封口任何组。
  let prevGroupEnd = -1

  for (let di = 1; di < diffIdx.length; di++) {
    const k = diffIdx[di]
    const gap = k - diffIdx[di - 1] - 1 // 两个差异之间的相同行数
    if (gap > FOLD_THRESHOLD) {
      // 间隔大 ⇒ 当前组结束，封口进 ranges。
      ranges.push({
        start: groupStart,
        end: groupEnd,
        // 折叠段 = 上一个组尾之后、本组头之前。
        foldStart: prevGroupEnd < 0 ? -1 : prevGroupEnd + 1,
        foldEnd: groupStart - 1,
      })
      prevGroupEnd = groupEnd
      // 开新组。
      groupStart = Math.max(0, k - CONTEXT_LINES)
      groupEnd = Math.min(raw.length - 1, k + CONTEXT_LINES)
    } else {
      // 间隔小 ⇒ 同组，扩大尾部上下文到本差异之后。
      groupEnd = Math.min(raw.length - 1, k + CONTEXT_LINES)
    }
  }
  // 封口最后一组。
  ranges.push({
    start: groupStart,
    end: groupEnd,
    foldStart: prevGroupEnd < 0 ? -1 : prevGroupEnd + 1,
    foldEnd: groupStart - 1,
  })

  // 阶段 2：把每个范围转成 DiffHunk。
  // raw 下标 → DiffHunkLine（行号 1-based；ai/bi 是 0-based，行号 = 下标+1）。
  const toHunkLine = (k: number): DiffHunkLine => {
    const r = raw[k]
    return {
      leftNum: r.ai === null ? null : r.ai + 1,
      rightNum: r.bi === null ? null : r.bi + 1,
      content: r.content,
      kind: r.kind,
    }
  }

  const hunks: DiffHunk[] = ranges.map((range) => {
    const lines: DiffHunkLine[] = []
    for (let k = range.start; k <= range.end; k++) {
      lines.push(toHunkLine(k))
    }
    let folded: DiffFolded | undefined
    if (range.foldStart >= 0 && range.foldEnd >= range.foldStart) {
      const fs = raw[range.foldStart]
      folded = {
        count: range.foldEnd - range.foldStart + 1,
        startLeft: fs.ai === null ? 0 : fs.ai + 1,
        startRight: fs.bi === null ? 0 : fs.bi + 1,
      }
    }
    return { ...(folded !== undefined ? { folded } : {}), lines }
  })

  return hunks
}

/**
 * 对比两个文本内容，输出 split-view 用的 hunks。
 *
 * 纯函数、无副作用。对任意两个 string 都返回合法 `DiffResult`（空文本也产出空 hunks）。
 *
 * @param left - 现有内容（split 视图左侧）。
 * @param right - 模块内容（split 视图右侧）。
 * @returns diff 结果（hunks + 增删统计）。
 *
 * @example
 * ```ts
 * const r = diffText('a\nb\nc', 'a\nB\nc')
 * // r.added === 1, r.removed === 1
 * // r.hunks[0].lines: [same a, del b, add B, same c]
 * ```
 */
export function diffText(left: string, right: string): DiffResult {
  const a = splitLines(left)
  const b = splitLines(right)
  const raw = computeLcsDiff(a, b)
  const hunks = buildHunks(raw)
  let added = 0
  let removed = 0
  for (const r of raw) {
    if (r.kind === 'add') added += 1
    else if (r.kind === 'del') removed += 1
  }
  return { hunks, added, removed }
}

/**
 * 构造一个 `FileDiffResult`（带路径的 diff）。
 *
 * 给 `inspectProfileModuleImpl` 用：对每个文件 diff 后包一层路径元信息。
 *
 * @param path - 相对路径（技能=SKILL.md / scripts/xxx；MCP=配置字段名）。
 * @param left - 现有内容。
 * @param right - 模块内容。
 * @returns 文件 diff 结果。
 */
export function diffFile(path: string, left: string, right: string): FileDiffResult {
  const r = diffText(left, right)
  return { path, hunks: r.hunks, added: r.added, removed: r.removed }
}
