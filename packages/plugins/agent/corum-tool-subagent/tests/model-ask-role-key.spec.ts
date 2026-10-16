/**
 * ★ 2026-10-16 实机缺陷的回归网：**只读调研（research）角色模型不可用时必须照样弹处理面板**。
 *
 * ## 用户报障（原话）
 *
 * 「只读agent的provider不存在，模型调用失败时，**应该和之前的worker一样弹出处理对话框让我处理，
 * 但是并没有**……**我们的机制在这个情况下未生效**。」
 *
 * ## 真因（有实机证据，见 `model-ask-run.ts` 的 `corumDelegationPolicyStateFrom` 头注释）
 *
 * 「子 Agent 模型不可用 ⇒ 问用户」这条通路上，面板之前有一道**陈旧失败判据**（2026-09-21 立的
 * 规矩：会话级路由已换过 ⇒ 这条失败已过时 ⇒ 不再问）。判据必须**读该角色自己的会话覆盖**，
 * 而当时构造覆盖面时写的是 `modelOverrideOf: sessionId => orchestration.modelOverrideOf(sessionId)`
 * —— **把 `role` 参数丢在地上**，于是上游按缺省角色 `'worker'` 取值：
 *
 * | 时刻（会话 `corum-task-5dcf1f0b`） | 事实 |
 * |---|---|
 * | 15:28:54Z | 用户在 **worker** 面板上选了「永久改指定模型」⇒ 机制用**正确的键**写了 worker 覆盖（`agent-lifecycle.jsonl` 的 torn-down 栈 + `conductor-lead/agent.json` 的 `subagentModel` 双向印证） |
 * | 15:39:01Z | 同一会话的 `subagent_research` 失败（配置 `localhost/glm-5.3-flash`）⇒ 陈旧判据拿 **worker 键**（`deepseek-official/deepseek-flash`）去比 ⇒ 误判「陈旧」⇒ **静默跳过提问** ⇒ 上层抛 `no fallback was authorized` |
 *
 * 这解释了报障里的不对称：worker 角色的缺省恰好就是正确的键，所以只有 research 不弹。
 *
 * ## 断言什么
 *
 * ① research 角色 + 会话里存在 **worker** 的覆盖 ⇒ 判据**不得**判陈旧，且机制**确实派发询问**
 *    （channel 被调用 = 面板会出现）——这一条在修复前是红的（旧实现：stale=true 且 channel 调用数 0）；
 * ② worker 自己的键变了 ⇒ **仍然**是「陈旧失败不问」（2026-09-21 的规矩不许被这次修复打破）；
 * ③ 该角色当前路由与失败路由**相同** ⇒ 必须问（换了也还是坏的，那是真·新信息）；
 * ④ `'follow-main'` 哨兵只在**该角色**上命中；
 * ⑤ 工厂真的把 role 转给了编排服务（setModelOverride / modelOverrideOf 都验，worker 键不串味）。
 *
 * 用的是**真服务**（`new CorumOrchestration(new Context())`，双键语义即上游真身）+
 * **真转发工厂** + **真询问核**，只把「提问通路」和「父 Agent」换成只记账的桩。
 *
 * @module @corum/corum-tool-subagent/tests/model-ask-role-key
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CorumOrchestration } from '../src/index.ts'
import {
  FOLLOW_MAIN,
  corumAskAboutModelUnlessStale,
  corumDelegationPolicyStateFrom,
  corumModelFailureIsStale,
  corumResetModelAskLocks,
  type CorumDelegationPolicyState,
  type CorumModelAskChannel,
} from '../src/model-ask-run.ts'
import type { CorumModelFailureFacts } from '../src/model-ask.ts'

afterEach(() => {
  corumResetModelAskLocks()
})

/** 实机现场的那个会话 id（`.corum/sessions.json`：profileId = conductor-lead）。 */
const SESSION = 'corum-task-5dcf1f0b'
/** 现场值①：用户在 worker 面板上选的永久路由（= 写进 worker 键的值）。 */
const WORKER_ROUTE = { provider: 'deepseek-official', model: 'deepseek-flash' }
/** 现场值②：research 实例配置的坏路由（provider 不存在 ⇒ 起跑即失败）。 */
const RESEARCH_CONFIGURED = { provider: 'localhost', model: 'glm-5.3-flash' }
/** 回退路由（= 父 Agent 的真实路由）。 */
const PARENT_ROUTE = { provider: 'deepseek-official', model: 'deepseek-flash' }

/** 造父 Agent 桩（只需要 `session.id`）。 */
function makeParent(sessionId: string = SESSION): Agent {
  return { session: { id: sessionId }, ctx: {} } as unknown as Agent
}

/**
 * 造「真服务 + 真转发工厂」的状态面。
 *
 * ⚠️ 刻意**不**手写一个 Map 版的假覆盖面：缺陷恰恰住在「转发」这一步，用假覆盖面等于把
 * 被验对象换掉（那样这条测试在修复前后都会是绿的 —— 假绿）。
 */
function makeState(): { state: CorumDelegationPolicyState, svc: CorumOrchestration } {
  const svc = new CorumOrchestration(new Context())
  return { state: corumDelegationPolicyStateFrom(svc), svc }
}

/** 造失败事实。 */
function makeFacts(role: 'worker' | 'research', configured: { provider: string, model: string }): CorumModelFailureFacts {
  return {
    label: '摸清 Windows 开发上手路径',
    role,
    configured: { ...configured },
    fallback: { ...PARENT_ROUTE },
    cause: 'no adapter registered for provider "localhost"',
  } as CorumModelFailureFacts
}

/** 只记账的提问通道：每次 `call` 计一次数（= 面板被派发了一次）。 */
function channelThatAnswers(): { channel: CorumModelAskChannel, calls: () => number } {
  let n = 0
  return {
    channel: {
      call: async () => {
        n += 1
        return { kind: 'temporary' as const }
      },
    },
    calls: () => n,
  }
}

const silentLogger = { warn: () => {}, info: () => {} }

describe('corumModelFailureIsStale —— 陈旧判据必须按**角色**取会话覆盖', () => {
  it('★ research 失败 + 会话里已有 worker 的永久决定 ⇒ 不得判陈旧（旧实现恒读 worker 键 ⇒ 误判）', () => {
    const { state, svc } = makeState()
    // 现场①：用户答的是 **worker** 那一问 ⇒ 机制写的是 worker 键。
    svc.setModelOverride(SESSION, 'worker', WORKER_ROUTE)

    const verdict = corumModelFailureIsStale(state, SESSION, 'research', RESEARCH_CONFIGURED)

    expect(
      verdict.stale,
      '缺陷形态：research 读到了 worker 的键 ⇒ 判成「陈旧失败」⇒ 静默跳过提问 ⇒ 面板永不出现',
    ).toBe(false)
    expect(verdict.effective, 'research 角色本该没有任何会话级覆盖').toBeUndefined()
  })

  it('★ 端到端（真链路）：research 的失败**确实派发了询问**（channel 被调用），而不是静默返回无决议', async () => {
    const { state, svc } = makeState()
    svc.setModelOverride(SESSION, 'worker', WORKER_ROUTE)
    const { channel, calls } = channelThatAnswers()

    // 这就是 index.ts 的 `corumAskAboutModel` 走的那个入口：陈旧闸门 → 至多一次询问。
    const outcome = await corumAskAboutModelUnlessStale(
      { state, channel },
      makeParent(),
      makeFacts('research', RESEARCH_CONFIGURED),
      new AbortController().signal,
      silentLogger,
    )

    expect(calls(), '缺陷形态：这里会是 0（询问根本没发出去，用户看不到面板）').toBe(1)
    expect(outcome.decision.kind).toBe('temporary')
    expect(outcome.override).toEqual(PARENT_ROUTE)
  })

  it('★ 端到端（真链路）：真正陈旧的失败仍然不问（闸门不许因为这次修复被掀掉）', async () => {
    const { state, svc } = makeState()
    svc.setModelOverride(SESSION, 'worker', WORKER_ROUTE)
    const { channel, calls } = channelThatAnswers()

    // worker 角色：失败声称的配置模型与 worker 键当前值不同 ⇒ 这条失败确已过时。
    const outcome = await corumAskAboutModelUnlessStale(
      { state, channel },
      makeParent(),
      makeFacts('worker', { provider: 'localhost', model: 'deepseek-v4.1-flash' }),
      new AbortController().signal,
      silentLogger,
    )

    expect(calls(), '陈旧失败不该再问（2026-09-21 的规矩）').toBe(0)
    expect(outcome.decision.kind).toBe('dismissed')
    expect(outcome.override).toBeUndefined()
  })

  it('★ worker 自己的会话路由已换过 ⇒ 仍是「陈旧失败不问」（2026-09-21 的规矩没被这次修复打破）', () => {
    const { state, svc } = makeState()
    svc.setModelOverride(SESSION, 'worker', WORKER_ROUTE)

    const verdict = corumModelFailureIsStale(state, SESSION, 'worker', { provider: 'localhost', model: 'deepseek-v4.1-flash' })

    expect(verdict.stale, '这正是 2026-09-21 实机（两个并行兄弟被连问两次）要消灭的形态').toBe(true)
    expect(verdict.effective).toEqual(WORKER_ROUTE)
  })

  it('★ 该角色当前路由与失败路由**相同** ⇒ 仍然要问（换了也还是坏的，那是真·新信息）', () => {
    const { state, svc } = makeState()
    svc.setModelOverride(SESSION, 'research', RESEARCH_CONFIGURED)

    expect(corumModelFailureIsStale(state, SESSION, 'research', RESEARCH_CONFIGURED).stale).toBe(false)
  })

  it('research 自己的路由被换过 ⇒ 同样判陈旧（不是「research 永不判陈旧」的过度纠正）', () => {
    const { state, svc } = makeState()
    svc.setModelOverride(SESSION, 'research', WORKER_ROUTE)

    const verdict = corumModelFailureIsStale(state, SESSION, 'research', RESEARCH_CONFIGURED)
    expect(verdict.stale).toBe(true)
    expect(verdict.effective).toEqual(WORKER_ROUTE)
  })

  it("★ `'follow-main'` 哨兵只在**该角色**上命中：worker 跟随主 Agent 不影响 research 的判据", () => {
    const { state, svc } = makeState()
    svc.setModelOverride(SESSION, 'worker', FOLLOW_MAIN)

    expect(corumModelFailureIsStale(state, SESSION, 'worker', RESEARCH_CONFIGURED).stale).toBe(true)
    expect(corumModelFailureIsStale(state, SESSION, 'research', RESEARCH_CONFIGURED).stale).toBe(false)
  })
})

describe('corumDelegationPolicyStateFrom —— 三个方法都必须逐参转发角色', () => {
  it('★ setModelOverride / modelOverrideOf 按角色落到不同的键，互不串味', () => {
    const { state, svc } = makeState()

    state.setModelOverride(SESSION, { provider: 'p-research', model: 'm-research' }, 'research')
    state.setModelOverride(SESSION, { provider: 'p-worker', model: 'm-worker' }, 'worker')
    // 两参形态 = worker 角色（上游的历史兼容口径），不许把 research 键覆盖掉。
    state.setModelOverride(SESSION, { provider: 'p-worker-2', model: 'm-worker-2' })

    expect(svc.modelOverrideOf(SESSION, 'research'), 'research 键被 worker 的写入串味了').toEqual({ provider: 'p-research', model: 'm-research' })
    expect(svc.modelOverrideOf(SESSION, 'worker')).toEqual({ provider: 'p-worker-2', model: 'm-worker-2' })
    expect(state.modelOverrideOf(SESSION, 'research')).toEqual({ provider: 'p-research', model: 'm-research' })
    expect(state.modelOverrideOf(SESSION, 'worker')).toEqual({ provider: 'p-worker-2', model: 'm-worker-2' })
    // 缺省角色 = worker（与上游一致，避免「不传 role 就取到别的角色」这类静默偏移）。
    expect(state.modelOverrideOf(SESSION)).toEqual({ provider: 'p-worker-2', model: 'm-worker-2' })
  })
})
