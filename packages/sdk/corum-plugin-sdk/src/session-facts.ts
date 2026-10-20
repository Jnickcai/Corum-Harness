/**
 * 会话资源快照 —— 第三方插件读取「当前会话发生了什么」的**公开契约**。
 *
 * ## 数据来源（单一权威，不是本包自己统计的）
 *
 * | 块 | 官方/内部来源 |
 * |---|---|
 * | `tokens` | `@deepseek-ai/dsh-token-meter` 的 `tokenUsage` 投影 |
 * | `context` | 同包的 `contextPressure` 投影（上下文占用 = pressureTokens / contextWindow） |
 * | `stats` | `@deepseek-ai/dsh-session-stats` 的 `sessionStats` 投影（turns / steps / 耗时） |
 * | `subagents` | corum 子 Agent 目录（durable 血缘：`origin: 'subagent'` + `parentSession`） |
 *
 * **本包不持有状态、不缓存**：`readSessionFacts()` 是一次 RPC 读，值来自宿主此刻的投影
 * 与血缘目录。想要「活」的数据（每次 token 变化都刷新），客户端应该直接订阅官方投影
 * （`useProjection('tokenUsage')` 等，见 docs/PLUGIN-SPEC.md §9d）——那才是零延迟路径。
 *
 * @module @corum/plugin-sdk/session-facts
 */

/** 一次会话的 token 累计（四个桶互斥；reasoning 已含在 `outputTokens` 内）。 */
export interface SessionFactsTokens {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** 上下文占用（provider 上报的 prompt 量 / 下一次请求的预估 / 路由容量）。 */
export interface SessionFactsContext {
  /** 最近一次请求的 provider 上报 prompt 量。 */
  pressureTokens?: number
  /** 加上此后 surface 增减后的「下一次请求」预估。 */
  projectedTokens?: number
  /** 当前模型路由的上下文窗口。 */
  contextWindow?: number
  /** `pressureTokens / contextWindow`（0–1，缺字段时不给）。 */
  usedRatio?: number
}

/** 轮次与耗时统计（`sessionStats` 投影；turns 的判据是有闭合 step 的 distinct turn）。 */
export interface SessionFactsStats {
  turns: number
  steps: number
  llmMs?: number
  toolMs?: number
  ttftMs?: number
  decodeMs?: number
  decodeTokens?: number
}

/** 子 Agent 的一条目录项（durable 血缘；`activity` 是采样时刻的存活态，不是终态）。 */
export interface SessionFactsSubagent {
  /** 子会话 id（跨激活稳定）。 */
  id: string
  /** 创建标签（durable descriptor；one-shot 可能没有）。 */
  label?: string
  /** 采样时刻是否常驻（`running` = 逻辑记录在内存里）。**不等于「在跑」**。 */
  activity: 'running' | 'inactive'
  mode?: 'one-shot' | 'continuable'
  hasChildren?: boolean
  /** corum 角色（worker / research / fork），进度服务不认得时缺省。 */
  role?: 'worker' | 'research' | 'fork'
  /** 是否隔离工作区（worktree）。 */
  isolated?: boolean
  /** 进度（来自 corum 的进度服务，best-effort；取不到就没有这一块）。 */
  progress?: {
    turn?: number
    step?: number
    currentAction?: string
    done?: boolean
    stopReason?: string
  }
}

/** 一次会话资源快照。 */
export interface SessionFactsSnapshot {
  /** 被读取的会话 id。 */
  sessionId: string
  /** 会话标题（缺省时宿主会给 cwd 末段或 id）。 */
  title?: string
  /** 宿主认为该会话是否正在跑（宿主 agent registry 的 status，不是「会话是否存在」）。 */
  running: boolean
  /** 该会话是否是子 Agent 会话（`header.origin === 'subagent'`）。 */
  isSubagent: boolean
  /** 父会话 id（子 Agent 会话才有）。 */
  parentSessionId?: string
  /** 委派深度（根 = 0）。 */
  delegationDepth?: number
  tokens?: SessionFactsTokens
  context?: SessionFactsContext
  stats?: SessionFactsStats
  /** 该会话的直接子 Agent（durable 血缘）。 */
  subagents: SessionFactsSubagent[]
  /** 投影一致切的位置（同一 asOfSeq 的读数可互相比较）。 */
  asOfSeq?: number
  /** 读取过程中的降级说明（例如「进度服务不可用」）。宿主永不为它抛错。 */
  warnings?: string[]
}

/** `readSessionFacts` 的参数。 */
export interface ReadSessionFactsArgs {
  /** 目标会话；缺省 = 宿主当前最近活跃的会话。 */
  sessionId?: string
}

/** connection 的最小能力面（官方 `ConnectionHandle` 的超集子集）。 */
interface RpcConnection {
  rpc: { call: (channel: '/api', endpoint: string, payload: { args: object }) => Promise<{ ok: boolean; value?: unknown; error?: { code: string; message: string } }> }
}

/**
 * 读一次会话资源快照（走宿主 RPC `corumSessionFacts/snapshot`）。
 *
 * ```ts
 * const facts = await readSessionFacts(ctx.get('connection') as never, { sessionId })
 * ctx.logger.info(`第 ${facts.stats?.turns} 轮，上下文 ${Math.round((facts.context?.usedRatio ?? 0) * 100)}%`)
 * ```
 *
 * @param connection - 客户端 `connection` 服务。
 * @param args - 目标会话（缺省跟随宿主当前会话）。
 * @returns 快照（宿主保证不抛：降级项进 `warnings`）。
 */
export async function readSessionFacts(
  connection: RpcConnection,
  args: ReadSessionFactsArgs = {},
): Promise<SessionFactsSnapshot> {
  // 线上 args 是**扁平字段**（typert 只接受能被 SRC 静态解析的标识符参数）。
  const result = await connection.rpc.call('/api', 'corumSessionFacts/snapshot', { args: { sessionId: args.sessionId } })
  if (!result.ok) throw new Error(`${result.error?.code ?? 'rpc/error'}: ${result.error?.message ?? 'corumSessionFacts/snapshot failed'}`)
  return result.value as SessionFactsSnapshot
}
