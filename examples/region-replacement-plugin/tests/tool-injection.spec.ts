import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { apply } from '../src/index.ts'

/**
 * **端到端判据：插件注入的工具真的被注册、真的能被执行。**
 *
 * 跑的是真实 `ToolRuntime`（官方 `@deepseek-ai/dsh-tools`，本仓 override 到 fork，逐字节同源）：
 * `register` 走完结构和 schema 校验，`execute` 走完准备/派发/收尾整条管线 ——
 * 不是「handler 单独能跑」，而是**注册 + 执行都过真机管线**。
 *
 * 唯一被替换的是宿主侧 `corumSessionFacts` 的返回值（用固定事实代替真实会话），
 * 这样断言可以精确到字段，而不是「跑起来不报错」。
 */
const signal = new AbortController().signal

const fakeFacts = {
  async snapshot(sessionId?: string) {
    return {
      sessionId: sessionId ?? 'sess-fixed',
      title: 'fixed-title',
      running: true,
      attached: true,
      isSubagent: false,
      tokens: { uncachedInputTokens: 1200, outputTokens: 300, cacheReadTokens: 4000, cacheWriteTokens: 50 },
      context: { pressureTokens: 500, contextWindow: 1000, usedRatio: 0.5 },
      stats: { turns: 7, steps: 21, llmMs: 1000 },
      subagents: [{ id: 'child-1', activity: 'running' as const, label: 'child one', role: 'worker' as const }],
    }
  },
}

/** 真 ToolRuntime + 假宿主服务，拼出插件 apply 需要的 ctx 形状。 */
async function harness() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const fakeCtx = {
    tools: ctx.tools,
    provide: () => undefined,
    logger: { info: () => undefined },
    effect: (factory: () => (() => void) | void) => factory(),
    get: (name: string) => (name === 'corumSessionFacts' ? fakeFacts : undefined),
  }
  apply(fakeCtx as never)
  return ctx
}

describe('插件注入的工具（真实 ToolRuntime 管线）', () => {
  it('注册进了模型可见工具面', async () => {
    const ctx = await harness()
    expect(ctx.tools.schemas().map(s => s.name)).toContain('demo_session_report')
  })

  it('能被执行，返回会话资源的 JSON', async () => {
    const ctx = await harness()
    const result = await ctx.tools.execute({ signal, callId: ToolCallId('c1'), name: 'demo_session_report', arguments: {} })
    // 判据读的是**工具的返回值本身**（`value`），不是包在外面的执行信封。
    const payload = JSON.parse((result as unknown as { value: string }).value) as Record<string, any>
    expect(payload.sessionId).toBe('sess-fixed')
    expect(payload.tokens.uncachedInputTokens).toBe(1200)
    expect(payload.stats.turns).toBe(7)
    expect(payload.subagents).toHaveLength(1)
    expect(payload.subagents[0].id).toBe('child-1')
  })

  it('参数 include_subagents=false 时不返回子 Agent', async () => {
    const ctx = await harness()
    const result = await ctx.tools.execute({
      signal, callId: ToolCallId('c2'), name: 'demo_session_report', arguments: { include_subagents: false },
    })
    const payload = JSON.parse((result as unknown as { value: string }).value) as Record<string, any>
    expect(payload.subagents).toBeUndefined()
    expect(payload.stats.turns).toBe(7)
  })
})
