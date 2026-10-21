/**
 * fork（corum）2026-10-21：`ask_user_question` 行的高容错解析模型。
 *
 * ## 为什么需要它（实测现场，会话 `corum-task-617b6402` turn 4）
 *
 * 模型一次发出了**四个并行**的 `ask_user_question` 调用，而且参数里的键被写坏
 * （`"multi_select true,":false`、`"options[{":":`）。官方 `AskQuestionRow` 的解析是
 * **严格**的：任一题缺 `id`/`question` 就整组判 null，于是回落到通用工具行，把
 * **整段原始 JSON** 当摘要显示——用户看到的就是「提问卡片展示异常」。
 *
 * 本模块刻意**只做宽容解析**，判据是「能读出什么就显示什么」：
 *   - `question` 非字符串 / 空串 ⇒ 该题没有题干（不因此丢掉整组）；
 *   - `options` 不是数组 ⇒ 该题没有选项（不因此丢掉整组）；
 *   - 整组一个题干/选项都读不出来 ⇒ 返回 `null`，由渲染层给「参数不完整」的降级壳。
 *
 * 它**不修改**任何数据，也不影响会话日志；只决定这一行怎么读。
 *
 * @module @corum/corum-ui-chat/toolviews/ask-question
 */
import type { ToolCallBlock } from '../contract/snapshot.ts'

/** 一个可渲染的选项。 */
export interface AskQuestionOption {
  readonly label: string
  readonly description?: string
}

/** 一道可渲染的题。 */
export interface AskQuestionEntry {
  /** 分组名（模型给的 header），可能为空。 */
  readonly header?: string
  /** 题干；空串表示「模型没给题干」。 */
  readonly question: string
  readonly options: readonly AskQuestionOption[]
  readonly multiSelect: boolean
}

/** 一行 ask_user_question 的渲染模型。 */
export interface AskQuestionModel {
  /** 解析出的题；空数组 = 参数完全不完整（走降级壳）。 */
  readonly questions: readonly AskQuestionEntry[]
  /** 原始参数（降级壳里折叠展示，不当摘要）。 */
  readonly raw: string
  /** 调用仍在跑（还没有结果）。 */
  readonly running: boolean
  /** 结构化错误码（`ASK_ABORTED` / `ASK_CANCELLED` / …），没有则 undefined。 */
  readonly errorCode?: string
  /** 已作答题数（判定方式见 {@link answeredCount}）。 */
  readonly answered: number
  /** 题数（解析出的题数；参数不完整时退化为答案条数或 0）。 */
  readonly total: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 宽容解析一份 `ask_user_question` 参数。
 *
 * @param argsRaw - 工具调用的原始参数字符串。
 * @returns 可渲染的题数组；参数不是 JSON 对象、或一个题干/选项都读不出时返回 `null`。
 */
export function parseAskQuestions(argsRaw: string): AskQuestionEntry[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(argsRaw)
  } catch {
    return null
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.questions)) return null

  const entries: AskQuestionEntry[] = []
  for (const item of parsed.questions) {
    if (!isRecord(item)) continue
    const question = asText(item.question)
    const header = asText(item.header)
    const options: AskQuestionOption[] = []
    if (Array.isArray(item.options)) {
      for (const option of item.options) {
        if (!isRecord(option)) continue
        const label = asText(option.label)
        if (label === '') continue
        const description = asText(option.description)
        options.push(description === '' ? { label } : { label, description })
      }
    }
    if (question === '' && options.length === 0) continue
    entries.push({
      ...(header === '' ? {} : { header }),
      question,
      options,
      multiSelect: item.multiSelect === true || item['multi_select'] === true,
    })
  }
  return entries.length === 0 ? null : entries
}

/**
 * 从结果文本里数「已作答」的题数。
 *
 * 结果形如 `{"answers":[{"id":"scope","selected":["全量治理"]}]}`；无法解析时返回 0。
 *
 * @param text - 工具结果文本（可能为空或非 JSON）。
 * @returns 有选中项或有自定义文本的答案条数。
 */
export function answeredCount(text: string | undefined): number {
  if (text === undefined || text.trim() === '') return 0
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return 0
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.answers)) return 0
  let count = 0
  for (const answer of parsed.answers) {
    if (!isRecord(answer)) continue
    const selected = Array.isArray(answer.selected) ? answer.selected.length : 0
    const custom = asText(answer.custom)
    if (selected > 0 || custom !== '') count += 1
  }
  return count
}

/** 结果块里的第一段文本（无则 undefined）。 */
export function resultText(block: ToolCallBlock): string | undefined {
  if (!('kind' in block)) return undefined
  const content = block.content
  if (!Array.isArray(content)) return undefined
  for (const part of content) {
    if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') return part.text
  }
  return undefined
}

/**
 * 把一块 tool call 归一化成渲染模型。
 *
 * @param block - 工具调用根（running 或 settled）。
 * @returns 渲染模型；`questions` 为空数组表示参数不完整（渲染层降级）。
 */
export function askQuestionModel(block: ToolCallBlock): AskQuestionModel {
  const call = 'kind' in block ? block.call : block
  const raw = call?.argsRaw ?? ''
  const questions = parseAskQuestions(raw) ?? []
  const running = !('kind' in block)
  const errorCode = 'kind' in block ? block.error?.code : undefined
  const answered = running || errorCode !== undefined
    ? 0
    : answeredCount(resultText(block))
  return {
    questions,
    raw,
    running,
    ...(errorCode === undefined ? {} : { errorCode }),
    answered,
    total: questions.length,
  }
}
