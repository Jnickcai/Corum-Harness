/**
 * 会话资源服务（`corumSessionFacts`）—— 让第三方插件读到「当前会话发生了什么」。
 *
 * ## 为什么不放在平台服务里
 *
 * `platform` 回答的是「我跑在哪」（平台事实），会话资源回答的是「这个会话里发生了什么」。
 * 两条正交的轴塞进一个服务，会让 `platform` 的语义变成杂物箱 —— 那是本仓反复踩过的坑
 * （服务命名三轨制，规范 §6）。所以同一个**包**里提供**两个服务**：
 *
 * - `platform` —— 平台事实（工具链/路径/窗口装饰的判据）；
 * - `corumSessionFacts` —— 会话资源（token / 轮次 / 子 Agent）。
 *
 * 对外都经 `@Remote` 暴露成 RPC；第三方插件宿主半可 `ctx.get('corumSessionFacts')` 直调，
 * 客户端半用 `@corum/plugin-sdk` 的 `readSessionFacts()`。
 *
 * ## 数据的来源与纪律
 *
 * | 块 | 来源 | 纪律 |
 * |---|---|---|
 * | tokens / context / stats | `sessionProjections.snapshot(session, [...])` | **一次一致切**：三项同 `asOfSeq`，可互相比较 |
 * | 子 Agent 目录 | corum 子 Agent 血缘（durable `origin: 'subagent'`） | 冷启动唯一可重放的事实源 |
 * | 子 Agent 进度 | `corumAgent/getChildSessionProgress` | **best-effort**：取不到就降级进 warnings，绝不让整次读取失败 |
 *
 * **不缓存、不统计**：每次调用现读。缓存会让「第三方读到的数」与「界面显示的」分叉。
 *
 * @module corum-platform/session-facts
 */

import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type {
  SessionFactsContext,
  SessionFactsSnapshot,
  SessionFactsStats,
  SessionFactsSubagent,
  SessionFactsTokens,
} from '@corum/plugin-sdk'

/** `sessions` 服务的最小能力面（dsh-session 的 SessionStore）。 */
interface SessionsFace {
  get: (id: string) => SessionLike | undefined
  list: () => SessionLike[]
}

/** 一个会话对象的最小能力面（只要 header 与 id）。 */
interface SessionLike {
  readonly id: string
  /** true = 已在宿主 store 里（投影可读）；false = 只从磁盘 header 认出来的。 */
  readonly attached?: boolean
  readonly header?: {
    readonly title?: string
    readonly origin?: 'subagent'
    readonly parentSession?: string
    readonly delegationDepth?: number
    readonly updatedAt?: number
  }
}

/** `sessionProjections` 服务的最小能力面。 */
interface ProjectionsFace {
  snapshot: (session: SessionLike, keys?: readonly string[]) => {
    readonly values?: Readonly<Record<string, unknown>>
    readonly asOfSeq?: number
  }
}

/** 子 Agent 目录项（只取用得上的字段）。 */
interface CatalogEntry {
  readonly kind: 'child' | 'diagnostic'
  readonly id?: string
  readonly label?: string
  readonly activity?: 'running' | 'inactive'
  readonly mode?: 'one-shot' | 'continuable'
  readonly hasChildren?: boolean
}

/** 子 Agent 目录服务（corum-subagent 的 SubagentRuntime）。 */
interface SubagentsFace {
  remoteExportList?: (parentSessionId: string, signal: AbortSignal) => Promise<{ entries?: readonly CatalogEntry[] }>
}

/** 进度服务（corum-agent 的 getChildSessionProgress）。 */
interface AgentProgressFace {
  getChildSessionProgressRemote?: (childSessionId: string) => Promise<{
    role?: 'worker' | 'research' | 'fork'
    isolated?: boolean
    progress?: { turn?: number; step?: number; currentAction?: string; done?: boolean; stopReason?: string }
  }>
}

/** 一次快照读取的参数。 */
interface SnapshotArgs {
  /** 目标会话；缺省 = 最近更新的那个会话。 */
  sessionId?: string
}

/** 投影名（官方 token-meter / session-stats 注册的 wire key）。 */
const PROJECTION_KEYS = ['tokenUsage', 'contextPressure', 'sessionStats'] as const

/**
 * 会话资源服务。
 *
 * 经 `@Remote` 暴露 RPC：`/api/corumSessionFacts/snapshot`。
 */
export class SessionFactsService extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'corumSessionFacts')
  }

  /**
   * 读一次会话资源快照。
   *
   * **永不抛**：读不到的块降级进 `warnings`（第三方界面不该因为宿主少挂一个单元就白屏）。
   * @param args - `{ sessionId? }`；缺省取最近更新的会话。
   * @returns 快照。
   */
  @Remote('snapshot')
  async snapshot(sessionId?: string): Promise<SessionFactsSnapshot> {
    // ⚠️ typert 网关的两条硬约束（都是实测报错换来的）：
    // ① `SRC method "snapshot" must use unique identifier parameters without destructuring,
    //    defaults, or rest` —— 形参必须是**普通标识符**；
    // ② `args fields do not match the descriptor: unexpected "sessionId"` —— 参数**类型**若
    //    不能被 SRC 静态解析成字段表，网关就把 args 当空对象，传任何字段都被拒。
    //    所以这里用「扁平的唯一标识符」而不是对象参数：`{ sessionId }` → 一个 string 形参。
    const warnings: string[] = []
    const session = await this.resolveSession(sessionId, warnings)
    if (session === undefined) {
      return { sessionId: '', running: false, attached: false, isSubagent: false, subagents: [], warnings: [...warnings, '没有可用会话'] }
    }

    if (!session.attached) {
      return {
        sessionId: session.id,
        ...(session.header?.title === undefined ? {} : { title: session.header.title }),
        running: false,
        attached: false,
        isSubagent: session.header?.origin === 'subagent',
        ...(session.header?.parentSession === undefined ? {} : { parentSessionId: session.header.parentSession }),
        ...(session.header?.delegationDepth === undefined ? {} : { delegationDepth: session.header.delegationDepth }),
        subagents: await this.readSubagents(session.id, warnings),
        warnings: [...warnings, '会话未打开（只读磁盘 header）：token/轮次要在会话打开后读'],
      }
    }

    const projections = this.projections()
    const snapshot = projections === undefined ? undefined : this.readProjections(projections, session, warnings)

    const tokens = asTokens(snapshot?.values?.tokenUsage)
    const context = asContext(snapshot?.values?.contextPressure)
    const stats = asStats(snapshot?.values?.sessionStats)
    if (snapshot?.values?.tokenUsage === undefined) warnings.push('tokenUsage 投影不可用（宿主未挂 token-meter 单元）')
    if (snapshot?.values?.sessionStats === undefined) warnings.push('sessionStats 投影不可用（宿主未挂 session-stats 单元）')

    return {
      sessionId: session.id,
      ...(session.header?.title === undefined ? {} : { title: session.header.title }),
      running: this.isRunning(session.id),
      attached: true,
      isSubagent: session.header?.origin === 'subagent',
      ...(session.header?.parentSession === undefined ? {} : { parentSessionId: session.header.parentSession }),
      ...(session.header?.delegationDepth === undefined ? {} : { delegationDepth: session.header.delegationDepth }),
      ...(tokens === undefined ? {} : { tokens }),
      ...(context === undefined ? {} : { context }),
      ...(stats === undefined ? {} : { stats }),
      subagents: await this.readSubagents(session.id, warnings),
      ...(snapshot?.asOfSeq === undefined ? {} : { asOfSeq: snapshot.asOfSeq }),
      ...(warnings.length === 0 ? {} : { warnings }),
    }
  }

  /**
   * 当前 Agent 可用的**工具名清单**（`ctx.tools.schemas()` 的模型可见面）。
   *
   * 为什么这条也在会话资源服务里：第三方插件常需要知道「现在这个 Agent 能用什么」
   * （做能力清单、诊断、避免重复注册同名工具）。工具注册表本身没有面向插件的只读 RPC，
   * 这里补一条 —— 只暴露 name，不暴露实现细节。
   * @returns 工具名数组（升序）；工具服务不可用时为空数组 + 说明。
   */
  @Remote('toolNames')
  toolNames(): { names: string[]; warning?: string } {
    try {
      const tools = this.ctx.get('tools' as never) as {
        schemas?: () => ReadonlyArray<{ name: string }>
        get?: (name: string) => unknown
      } | undefined
      if (tools?.schemas === undefined) return { names: [], warning: 'tools 服务不可用' }
      return { names: tools.schemas().map(schema => schema.name).sort() }
    } catch (error) {
      return { names: [], warning: `工具清单读取失败：${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /** 取 sessions / sessionProjections / subagents / corumAgent 的能力面（缺失即 undefined）。 */
  private sessions(): SessionsFace | undefined {
    return this.ctx.get('sessions' as never) as SessionsFace | undefined
  }

  private projections(): ProjectionsFace | undefined {
    return this.ctx.get('sessionProjections' as never) as ProjectionsFace | undefined
  }

  private agents(): AgentProgressFace | undefined {
    return this.ctx.get('corumAgent' as never) as AgentProgressFace | undefined
  }

  /**
   * 目标会话：显式 id > 最近更新的会话。
   * @param sessionId - 显式 id。
   * @param warnings - 降级说明收集器。
   */
  private async resolveSession(sessionId: string | undefined, warnings: string[]): Promise<SessionLike | undefined> {
    const sessions = this.sessions()
    if (sessions === undefined) {
      warnings.push('sessions 服务不可用')
      return undefined
    }
    if (sessionId !== undefined) {
      const hit = sessions.get(sessionId)
      if (hit !== undefined) return hit
      // 未 attach：退回磁盘 header（`session/inspect` 明说「不看 Agent 也能读持久化 header」）。
      // 这恰好是第三方最常见的场景之一：插件想展示「这条会话是什么」，而用户没打开它。
      const persisted = await this.persistedHeader(sessionId)
      if (persisted !== undefined) return persisted
      warnings.push(`会话 ${sessionId} 不存在`)
      return undefined
    }
    const all = sessions.list()
    if (all.length === 0) return undefined
    return all.reduce((latest, current) => ((current.header?.updatedAt ?? 0) >= (latest.header?.updatedAt ?? 0) ? current : latest))
  }

  /**
   * 从持久化存里读一个会话的 header（不激活 Agent）。
   * @param sessionId - durable 会话 id。
   * @returns 最小 SessionLike（`attached: false`）或 undefined。
   */
  /**
   * ⚠️ 未实机验证的兜底路径（2026-10-21）：`sessionController.inspect` 读磁盘 header 这条
   * 分支在 verify 环境里没能跑到（复制的会话无法 resume：先缺 preset、补 preset 后 zstd 帧
   * 校验失败）。代码保持 fail-soft（拿不到就当会话不存在，行为与不写这段一致），
   * 但**下个 session 应在有真实会话的 home 上验一次**再把它写进契约文档。
   */
  private async persistedHeader(sessionId: string): Promise<SessionLike | undefined> {
    try {
      const controller = this.ctx.get('sessionController' as never) as {
        inspect?: (id: string) => Promise<{ header?: { id?: string; title?: string; origin?: 'subagent'; parentSession?: string; delegationDepth?: number; updatedAt?: number } }>
      } | undefined
      if (controller?.inspect === undefined) return undefined
      const value = await controller.inspect(sessionId)
      const header = value?.header
      if (header?.id === undefined) return undefined
      return {
        id: header.id,
        attached: false,
        header: {
          ...(header.title === undefined ? {} : { title: header.title }),
          ...(header.origin === undefined ? {} : { origin: header.origin }),
          ...(header.parentSession === undefined ? {} : { parentSession: header.parentSession }),
          ...(header.delegationDepth === undefined ? {} : { delegationDepth: header.delegationDepth }),
          ...(header.updatedAt === undefined ? {} : { updatedAt: header.updatedAt }),
        },
      }
    } catch {
      return undefined
    }
  }

  /** 一次一致切读三个投影。 */
  private readProjections(
    projections: ProjectionsFace,
    session: SessionLike,
    warnings: string[],
  ): { values?: Readonly<Record<string, unknown>>; asOfSeq?: number } | undefined {
    try {
      return projections.snapshot(session, PROJECTION_KEYS)
    } catch (error) {
      warnings.push(`投影读取失败：${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  /** 会话是否在跑（宿主 agent registry 的 status；会话存在 ≠ 在跑）。 */
  private isRunning(sessionId: string): boolean {
    try {
      const agents = this.ctx.get('agents' as never) as { get?: (id: string) => { status?: string } | undefined } | undefined
      return agents?.get?.(sessionId)?.status === 'running'
    } catch {
      return false
    }
  }

  /** durable 血缘目录 + best-effort 进度。 */
  private async readSubagents(parentSessionId: string, warnings: string[]): Promise<SessionFactsSubagent[]> {
    const service = this.ctx.get('subagents' as never) as SubagentsFace | undefined
    if (service?.remoteExportList === undefined) {
      warnings.push('subagents 服务不可用')
      return []
    }
    try {
      const catalog = await service.remoteExportList(parentSessionId, AbortSignal.timeout(2_000))
      const children = (catalog.entries ?? []).filter((entry): entry is CatalogEntry & { id: string } =>
        entry.kind === 'child' && typeof entry.id === 'string')
      const progressFace = this.agents()
      const rows: SessionFactsSubagent[] = []
      for (const child of children) {
        const row: SessionFactsSubagent = {
          id: child.id,
          activity: child.activity ?? 'inactive',
          ...(child.label === undefined ? {} : { label: child.label }),
          ...(child.mode === undefined ? {} : { mode: child.mode }),
          ...(child.hasChildren === undefined ? {} : { hasChildren: child.hasChildren }),
        }
        if (progressFace?.getChildSessionProgressRemote !== undefined) {
          try {
            const detail = await progressFace.getChildSessionProgressRemote(child.id)
            if (detail.role !== undefined) row.role = detail.role
            if (detail.isolated !== undefined) row.isolated = detail.isolated
            if (detail.progress !== undefined) row.progress = detail.progress
          } catch {
            warnings.push(`子 Agent ${child.id} 进度读取失败（已降级）`)
          }
        }
        rows.push(row)
      }
      return rows
    } catch (error) {
      warnings.push(`子 Agent 目录读取失败：${error instanceof Error ? error.message : String(error)}`)
      return []
    }
  }
}

/** 投影值 → 契约类型（字段全 optional，类型不符就当缺省）。 */
export function asTokens(value: unknown): SessionFactsTokens | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.uncachedInputTokens !== 'number' || typeof raw.outputTokens !== 'number') return undefined
  return {
    uncachedInputTokens: raw.uncachedInputTokens,
    outputTokens: raw.outputTokens,
    cacheReadTokens: typeof raw.cacheReadTokens === 'number' ? raw.cacheReadTokens : 0,
    cacheWriteTokens: typeof raw.cacheWriteTokens === 'number' ? raw.cacheWriteTokens : 0,
  }
}

export function asContext(value: unknown): SessionFactsContext | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const context: SessionFactsContext = {}
  if (typeof raw.pressureTokens === 'number') context.pressureTokens = raw.pressureTokens
  if (typeof raw.projectedTokens === 'number') context.projectedTokens = raw.projectedTokens
  if (typeof raw.contextWindow === 'number') context.contextWindow = raw.contextWindow
  if (context.pressureTokens !== undefined && context.contextWindow !== undefined && context.contextWindow > 0) {
    context.usedRatio = Math.min(1, context.pressureTokens / context.contextWindow)
  }
  return Object.keys(context).length === 0 ? undefined : context
}

export function asStats(value: unknown): SessionFactsStats | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.turns !== 'number' || typeof raw.steps !== 'number') return undefined
  const stats: SessionFactsStats = { turns: raw.turns, steps: raw.steps }
  for (const key of ['llmMs', 'toolMs', 'ttftMs', 'decodeMs', 'decodeTokens'] as const) {
    if (typeof raw[key] === 'number') stats[key] = raw[key] as number
  }
  return stats
}
