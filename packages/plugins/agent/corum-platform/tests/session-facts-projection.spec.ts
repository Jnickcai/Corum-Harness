import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
// `dsh-session-stats` 没有 default export：它导出的是 `{ name, inject, apply }` 对象形态的插件。
import * as SessionStats from '@deepseek-ai/dsh-session-stats'
import { SessionFactsService } from '../src/session-facts.ts'

/**
 * **端到端（进程内）：会话资源快照真的从官方投影里折叠出 token 与轮次。**
 *
 * 不是 mock 投影返回值 —— 这里挂的是真的 `dsh-session` + `dsh-session-projection` +
 * `dsh-token-meter` + `dsh-session-stats`，往一条真 Session 里 append 真事件
 * （`turn/start` → `assistant/message`（带 usage）→ `step/end` → `turn/end`），
 * 再由 `SessionFactsService.snapshot()` 读出来断言。
 *
 * 这条补上了「实机只验到 attached:false」的那一半：投影折叠链路本身是真的。
 */
async function setup() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(TokenMeter)
  await ctx.plugin(SessionStats)
  return ctx
}

/** 往会话里写一轮「有 token 账」的完整回合。 */
function appendTurn(
  session: { append: (...args: never[]) => unknown },
  turn: number,
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number },
) {
  // ⚠️ 必须 bind：`Session.append` 是原型方法，摘下来裸调会丢 `this`
  // （实测报 `Cannot read properties of undefined (reading 'log')`）。
  const append = (session.append as unknown as (type: string, data: unknown, opts?: unknown) => unknown).bind(session)
  append('turn/start', { turn })
  append('assistant/message', {
    turn,
    step: 0,
    message: createAssistantMessage({
      content: [{ type: 'text', text: `answer ${turn}` }],
      source: { provider: 'test-provider', model: 'test-model' },
    } as never),
    stream: [],
    usage,
  }, { surfaceOp: 'append' })
  append('step/end', { turn, step: 0 })
  append('turn/end', { turn, reason: { kind: 'completed' } })
}

describe('SessionFactsService × 官方投影（进程内端到端）', () => {
  it('attached 会话：tokens 与 turns 来自真实投影折叠', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('facts-e2e-1'))
    appendTurn(session, 1, { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 400, cacheWriteTokens: 50 })
    appendTurn(session, 2, { inputTokens: 800, outputTokens: 200 })

    const facts = await new SessionFactsService(ctx as never).snapshot('facts-e2e-1')

    expect(facts.sessionId).toBe('facts-e2e-1')
    expect(facts.attached).toBe(true)
    // 轮次：sessionStats 的判据是「有闭合 step 的 distinct turn」⇒ 两轮都闭合了
    expect(facts.stats?.turns).toBe(2)
    expect(facts.stats?.steps).toBe(2)
    // token：两次调用累加。**`uncachedInputTokens` 就是 `inputTokens` 之和**（1200+800），
    // 不是「input − cacheRead」——官方 `tokenUsage` 投影把 inputTokens 当未缓存部分，
    // 缓存命中单独计。这条是本测试实测出来的语义（我原先按 input−cacheRead 猜，猜错了）。
    expect(facts.tokens?.uncachedInputTokens).toBe(2000)
    expect(facts.tokens?.outputTokens).toBe(500)
    expect(facts.tokens?.cacheReadTokens).toBe(400)
    expect(facts.tokens?.cacheWriteTokens).toBe(50)
  })

  it('没有事件的会话：给 0 轮、0 token，而不是报错', async () => {
    const ctx = await setup()
    ctx.sessions.create(SessionId('facts-e2e-empty'))
    const facts = await new SessionFactsService(ctx as never).snapshot('facts-e2e-empty')
    expect(facts.attached).toBe(true)
    expect(facts.stats?.turns).toBe(0)
    expect(facts.tokens?.outputTokens).toBe(0)
  })

  it('会话不存在：fail-soft（空 id + warnings），绝不抛', async () => {
    const ctx = await setup()
    const facts = await new SessionFactsService(ctx as never).snapshot('no-such-session')
    expect(facts.sessionId).toBe('')
    expect(facts.warnings?.join('；')).toContain('不存在')
  })
})
