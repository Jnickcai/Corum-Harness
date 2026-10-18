/**
 * `script-model-resolution.ts` 单测（2026-10-19）。
 *
 * 背景：用户报障「编排工作流的子 Agent 模型不是全局设置的 glm-5.3-flash 而是
 * DeepSeek-v4-flash」。根因是 SCRIPT 模式经引擎的 `agent()` 不经过 corum 工具层，
 * 子 Agent 模型三档解析只写在 `spawnOne` 里。本 spec 锁定本模块的三档解析行为
 * （会话覆盖 → 全局兜底 → 跟随主 Agent）+ 路由注入（标记为机制拥有）。
 */
import { describe, expect, it } from 'vitest'
import type { ResolvedSubagentStartRequest } from '../src/index.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  applyMechanismRoute,
  FOLLOW_MAIN,
  readGlobalChildModel,
  resolveScriptChildModel,
  type OrchestrationModelOverrideFace,
  type SettingsDescribeFace,
} from '../src/isolated/script-model-resolution.ts'

/** 造一个最小 orchestration face（只实现 modelOverrideOf）。 */
function orchestrationWith(
  overrideOf: OrchestrationModelOverrideFace['modelOverrideOf'],
): OrchestrationModelOverrideFace {
  return { modelOverrideOf: overrideOf }
}

/** 造一个最小 settings face（describe 返回指定 ns 的 value）。 */
function settingsWith(ns: string, value: unknown): SettingsDescribeFace {
  return { describe: () => [{ ns, value }] }
}

/** 造一个最小 start request（只带 sessionId）。 */
function request(sessionId: string): ResolvedSubagentStartRequest {
  return {
    parent: { session: { id: sessionId } } as unknown as Agent,
    prompt: [{ type: 'text', text: 'do the thing' }],
    signal: new AbortController().signal,
  } as unknown as ResolvedSubagentStartRequest
}

describe('resolveScriptChildModel — 三档解析（worker 单角色）', () => {
  it('① 会话级覆盖（具体路由）优先', () => {
    const orch = orchestrationWith(() => ({ provider: 'pi-ai', model: 'glm-5.3' }))
    const settings = settingsWith('corum-subagent', { defaultModel: { provider: 'zai', model: 'glm-5.3-flash' } })
    const resolved = resolveScriptChildModel(orch, settings, 'sess-1')
    expect(resolved.tier).toBe('session-override')
    expect(resolved.route).toEqual({ provider: 'pi-ai', model: 'glm-5.3' })
  })

  it('① 会话级覆盖带 reasoningEffort 保留', () => {
    const orch = orchestrationWith(() => ({ provider: 'pi-ai', model: 'glm-5.3', reasoningEffort: 'high' }))
    const resolved = resolveScriptChildModel(orch, undefined, 'sess-1')
    expect(resolved.route).toEqual({ provider: 'pi-ai', model: 'glm-5.3', reasoningEffort: 'high' })
  })

  it("① 会话级覆盖 = 'follow-main' 哨兵 ⇒ 直接跳到 ③（跳过全局档）", () => {
    const orch = orchestrationWith(() => FOLLOW_MAIN)
    const settings = settingsWith('corum-subagent', { defaultModel: { provider: 'zai', model: 'glm-5.3-flash' } })
    const resolved = resolveScriptChildModel(orch, settings, 'sess-1')
    expect(resolved.tier).toBe('follow-main')
    expect(resolved.route).toBeUndefined()
  })

  it('② 全局兜底（corum-subagent 的 defaultModel）次之', () => {
    const orch = orchestrationWith(() => undefined)
    const settings = settingsWith('corum-subagent', { defaultModel: { provider: 'zai', model: 'glm-5.3-flash' } })
    const resolved = resolveScriptChildModel(orch, settings, 'sess-1')
    expect(resolved.tier).toBe('global')
    expect(resolved.route).toEqual({ provider: 'zai', model: 'glm-5.3-flash' })
  })

  it('③ 会话覆盖缺失 + 全局未配 ⇒ 跟随主 Agent', () => {
    const orch = orchestrationWith(() => undefined)
    const resolved = resolveScriptChildModel(orch, undefined, 'sess-1')
    expect(resolved.tier).toBe('follow-main')
    expect(resolved.route).toBeUndefined()
  })

  it('orchestration 服务缺席 + 全局未配 ⇒ 跟随主 Agent（不阻断委派）', () => {
    const resolved = resolveScriptChildModel(undefined, undefined, 'sess-1')
    expect(resolved.tier).toBe('follow-main')
    expect(resolved.route).toBeUndefined()
  })

  it('orchestration 服务缺席 + 全局已配 ⇒ 用全局', () => {
    const settings = settingsWith('corum-subagent', { defaultModel: { provider: 'zai', model: 'glm-5.3-flash' } })
    const resolved = resolveScriptChildModel(undefined, settings, 'sess-1')
    expect(resolved.tier).toBe('global')
    expect(resolved.route).toEqual({ provider: 'zai', model: 'glm-5.3-flash' })
  })
})

describe('readGlobalChildModel — corum-subagent namespace 读取', () => {
  it('settings 缺席 ⇒ undefined', () => {
    expect(readGlobalChildModel(undefined)).toBeUndefined()
  })

  it('describe 缺席 ⇒ undefined', () => {
    expect(readGlobalChildModel({})).toBeUndefined()
  })

  it('namespace 未注册 ⇒ undefined', () => {
    const settings = settingsWith('other-ns', { defaultModel: { provider: 'zai', model: 'glm-5.3-flash' } })
    expect(readGlobalChildModel(settings)).toBeUndefined()
  })

  it('defaultModel 空 provider/model ⇒ undefined（空串不算配置）', () => {
    const settings = settingsWith('corum-subagent', { defaultModel: { provider: '', model: '' } })
    expect(readGlobalChildModel(settings)).toBeUndefined()
  })

  it('defaultModel 缺席（只有其它键）⇒ undefined', () => {
    const settings = settingsWith('corum-subagent', { maxParallelChildren: 4 })
    expect(readGlobalChildModel(settings)).toBeUndefined()
  })

  it('describe 抛错 ⇒ undefined（不阻断）', () => {
    const settings: SettingsDescribeFace = { describe: () => { throw new Error('boom') } }
    expect(readGlobalChildModel(settings)).toBeUndefined()
  })

  it('正常值 ⇒ 返回路由', () => {
    const settings = settingsWith('corum-subagent', { defaultModel: { provider: 'zai', model: 'glm-5.3-flash', reasoningEffort: 'high' } })
    expect(readGlobalChildModel(settings)).toEqual({ provider: 'zai', model: 'glm-5.3-flash', reasoningEffort: 'high' })
  })
})

describe('applyMechanismRoute — 路由注入（标记为机制拥有）', () => {
  it('route = undefined ⇒ 原样返回请求（跟随主 Agent）', () => {
    const req = request('sess-1')
    const result = applyMechanismRoute(req, undefined)
    expect(result).toBe(req)
  })

  it('route = 具体路由 ⇒ 注入 agentOptions + agentOptionsOwnedByMechanism:true', () => {
    const req = request('sess-1')
    const result = applyMechanismRoute(req, { provider: 'zai', model: 'glm-5.3-flash' })
    expect(result).not.toBe(req)
    expect(result.agentOptions).toEqual({ provider: 'zai', model: 'glm-5.3-flash' })
    expect(result.agentOptionsOwnedByMechanism).toBe(true)
  })

  it('route 带 reasoningEffort ⇒ agentOptions 含 reasoningEffort', () => {
    const req = request('sess-1')
    const result = applyMechanismRoute(req, { provider: 'zai', model: 'glm-5.3-flash', reasoningEffort: 'high' })
    expect(result.agentOptions).toMatchObject({ provider: 'zai', model: 'glm-5.3-flash', reasoningEffort: 'high' })
    expect(result.agentOptionsOwnedByMechanism).toBe(true)
  })

  it('route reasoningEffort 空串 ⇒ 不写 reasoningEffort', () => {
    const req = request('sess-1')
    const result = applyMechanismRoute(req, { provider: 'zai', model: 'glm-5.3-flash', reasoningEffort: '' })
    expect(result.agentOptions).toEqual({ provider: 'zai', model: 'glm-5.3-flash' })
  })

  it('覆盖原 agentOptions（机制路由胜出）', () => {
    const req = request('sess-1')
    const result = applyMechanismRoute(req, { provider: 'zai', model: 'glm-5.3-flash' })
    expect(result.agentOptions).toEqual({ provider: 'zai', model: 'glm-5.3-flash' })
    expect(result.agentOptionsOwnedByMechanism).toBe(true)
  })
})

describe('用户报障场景：全局设 glm-5.3-flash，主 Agent 跑 deepseek-v4-flash', () => {
  it('全局 defaultModel=glm-5.3-flash ⇒ 脚本子 Agent 解析到 global 档（非父路由）', () => {
    // 主 Agent（general-assistant）跑 deepseek-official/deepseek-v4-flash；
    // 用户在全局设置把子 Agent 默认模型设成 zai/glm-5.3-flash。
    const orch = orchestrationWith(() => undefined) // 无会话级覆盖
    const settings = settingsWith('corum-subagent', { defaultModel: { provider: 'zai', model: 'glm-5.3-flash' } })
    const resolved = resolveScriptChildModel(orch, settings, 'corum-task-xyz')
    expect(resolved.tier).toBe('global')
    expect(resolved.route).toEqual({ provider: 'zai', model: 'glm-5.3-flash' })
    // 注入后子 Agent 跑 glm-5.3-flash（不是父的 deepseek-v4-flash）
    const req = request('corum-task-xyz')
    const routed = applyMechanismRoute(req, resolved.route)
    expect(routed.agentOptions).toEqual({ provider: 'zai', model: 'glm-5.3-flash' })
    expect(routed.agentOptionsOwnedByMechanism).toBe(true)
  })
})
