/**
 * 测试插件的宿主半 —— 演示第三方插件**最重要**的能力：给 Agent 注入一个工具。
 *
 * 工具 `demo_session_report`：让 Agent 自己就能读出「当前会话花了多少 token、跑了几轮、
 * 派了几个子 Agent」。这既是演示（插件能给 Agent 加能力），也是实用件（Agent 自查上下文压力）。
 *
 * 注册路径故意走官方机制、不发明新的：
 * `defineAgentTool(defineTool 的薄封装)` → `registerAgentTool(ctx.tools, ...)` → `ctx.tools.register`。
 * 插件必须在 `inject` 里声明 `tools`（红线 4：未 inject 的属性访问会抛）。
 *
 * @module @corum-examples/region-replacement
 */

import { defineAgentTool, definePlugin, registerAgentTool } from '@corum/plugin-sdk'
import type { Context } from '@corum/plugin-sdk'

/** 插件名：与包名后缀一致。 */
export const name = 'region-replacement'

/** 依赖的宿主服务：工具注册表（本插件要往 Agent 工具面里注入一条）。 */
export const inject: string[] = ['tools']

/** 会话资源服务的最小能力面（`corum-platform` 提供，第三方按其公开契约读）。 */
interface SessionFactsFace {
  /** 宿主半直调签名：**扁平**的会话 id（RPC 层同样是扁平字段）。 */
  snapshot: (sessionId?: string) => Promise<{
    sessionId: string
    title?: string
    running: boolean
    tokens?: { uncachedInputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }
    context?: { pressureTokens?: number; projectedTokens?: number; contextWindow?: number; usedRatio?: number }
    stats?: { turns: number; steps: number; llmMs?: number; toolMs?: number }
    subagents: ReadonlyArray<{ id: string; label?: string; activity: string; role?: string; progress?: { turn?: number; done?: boolean } }>
    warnings?: string[]
  }>
}

/**
 * 装配：注册工具 + 一个只读信息服务。
 * @param ctx - 宿主根上下文。
 */
export function apply(ctx: Context): void {
  ctx.provide('regionReplacement', {
    /** 本插件替换的区域（客户端半实际注册的 slot 键）。 */
    regions: (): readonly string[] => ['corum.editor', 'corum.panel'],
    /** 本插件注入的工具名（诊断用）。 */
    tools: (): readonly string[] => ['demo_session_report'],
  })

  const tool = defineAgentTool({
    name: 'demo_session_report',
    description:
      'Report the current session\'s resource usage: token counts (uncached input / output / cache), '
      + 'context-window pressure, how many turns and steps have run, and the child sub-agents this '
      + 'session delegated to. Use it when you need to know how much context you have left or '
      + 'whether a delegated child is still running.',
    parameters: {
      include_subagents: {
        type: 'boolean',
        description: 'Include the child sub-agent list (ids, labels, activity, progress). Defaults to true.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, text) => [{ type: 'text', text }],
    },
    async execute(args, exec) {
      const facts = ctx.get('corumSessionFacts' as never) as SessionFactsFace | undefined
      if (facts === undefined) return JSON.stringify({ error: 'corumSessionFacts 服务不可用' })
      // 宿主半是**直调**服务（不是 RPC）：参数是扁平的 `sessionId?: string`。
      // 执行上下文里有本次调用所属的 Agent ⇒ 优先读它的会话，读不到就让宿主自己挑最近的。
      const agent = exec.agent as unknown as { sessionId?: string; session?: { id?: string } } | undefined
      const snapshot = await facts.snapshot(agent?.sessionId ?? agent?.session?.id)
      const includeSubagents = args.include_subagents !== false
      return JSON.stringify({
        sessionId: snapshot.sessionId,
        ...(snapshot.title === undefined ? {} : { title: snapshot.title }),
        running: snapshot.running,
        ...(snapshot.tokens === undefined ? {} : { tokens: snapshot.tokens }),
        ...(snapshot.context === undefined ? {} : { context: snapshot.context }),
        ...(snapshot.stats === undefined ? {} : { stats: snapshot.stats }),
        ...(includeSubagents ? { subagents: snapshot.subagents } : {}),
        ...(snapshot.warnings === undefined ? {} : { warnings: snapshot.warnings }),
      }, null, 2)
    },
  })

  // 注册随 fiber 撤销：插件卸载 ⇒ 工具从 Agent 工具面消失。
  ctx.logger.info('[region-replacement] host apply: 准备注册工具 demo_session_report')
  ctx.effect(() => {
    const dispose = registerAgentTool(ctx.tools, tool)
    const names = (ctx.tools as unknown as { schemas?: () => ReadonlyArray<{ name: string }> }).schemas?.() ?? []
    ctx.logger.info(`[region-replacement] 工具已注册；当前工具面 ${names.length} 条：${names.slice(0, 6).map(n => n.name).join(',')}`)
    return dispose
  })
}

export default definePlugin({ name, inject, apply })
