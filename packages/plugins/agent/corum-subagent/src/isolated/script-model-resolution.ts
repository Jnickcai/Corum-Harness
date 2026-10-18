/**
 * fork（corum）2026-10-19：**脚本模式子 Agent 的模型路由解析**。
 *
 * ## 由来（用户 2026-10-19 报障）
 *
 * 用户报告：「全局的模型设置并未生效，我在使用通用助手时发现其调用编排工作流的
 * 子 Agent 模型并不是全局设置的 glm-5.3-flash 而是 DeepSeek-v4-flash」。
 *
 * 根因：`orchestrate` 的 **SCRIPT 模式**（`script` + `meta`）把脚本交给官方 workflow
 * 引擎执行，引擎里的 `agent()` **不经过 corum 工具层**（`spawnOne`），而子 Agent
 * 模型的三档解析（会话级覆盖 → 预设锁 → 全局兜底 → 跟随主 Agent）只写在 `spawnOne`
 * 里（`corum-tool-subagent/src/index.ts`）。于是脚本派出的子 Agent 走
 * `corum-isolated` provider → `startInProcessRun` →
 * `resolveChildAgentOptions(parent, undefined, childDepth)` → **继承父路由**
 * （= 主 Agent 的模型 `deepseek-v4-flash`），而不是全局设置的子 Agent 模型
 * （`glm-5.3-flash`）。
 *
 * ## 修法
 *
 * 在 `corum-isolated` provider 的 `start()` 里、调 `startInProcessRun` 之前，
 * 解析机制拥有的子 Agent 模型路由并注入 `agentOptions` +
 * `agentOptionsOwnedByMechanism: true`（driver P1 剥离只剥**未标记**的选项，
 * 故标记后的机制路由不会被剥掉）。
 *
 * 脚本模式没有**预设锁**档（脚本不区分 worker / research 双实例——orchestrate 工具
 * 只在 worker 实例注册，子 Agent 都是 worker 角色）。故本解析只有三档：
 *   ① **会话级覆盖**（`corumOrchestration.modelOverrideOf(sessionId, 'worker')`）；
 *   ② **全局兜底**（`corum-subagent` settings namespace 的 `defaultModel`）；
 *   ③ **跟随主 Agent**（返回 `undefined`，driver 用父路由）。
 *
 * 脚本若试图自选 `provider`/`model`（引擎 `agent(prompt, {provider, model})`），
 * 机制仍覆盖它：provider 把 `agentOptions` 换成解析出的机制路由并打标记，driver
 * 直接使用、不剥离。脚本选路由的通知在工具描述里已明确禁止（orchestrate 工具
 * description：「Do not pass `provider`/`model` from a script」），故脚本违规选路由
 * 时通知缺失是可接受的降级——子 Agent 跑对的模型比通知更重要。
 *
 * ## 为什么不直接 import `resolveChildModel`（`corum-tool-subagent`）
 *
 * 包依赖方向：`corum-subagent` → `corum-orchestration`（不依赖 `corum-tool-subagent`）。
 * `resolveChildModel` 是纯函数，但住在 `corum-tool-subagent/src/child-model-resolution.ts`；
 * 从本包 import 它会造循环依赖。故本模块实现**最小等价**逻辑（worker 单角色，无预设锁档）。
 *
 * @module @corum/corum-subagent/isolated/script-model-resolution
 */

import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { ResolvedSubagentStartRequest } from '../index.ts'

/**
 * `corumOrchestration` 的**最小能力面**（只取模型覆盖读取）。
 * 与 `isolated/index.ts` 的 `CorumOrchestrationFace` 同源但更窄——本模块只用覆盖读取。
 */
export interface OrchestrationModelOverrideFace {
  modelOverrideOf: (
    sessionId: string,
    role: 'worker' | 'research',
  ) => { provider: string; model: string; reasoningEffort?: string } | 'follow-main' | undefined
}

/** 「显式跟随主 Agent」哨兵（与 `child-model-resolution.ts` 的 `FOLLOW_MAIN` 逐字一致）。 */
export const FOLLOW_MAIN = 'follow-main' as const

/**
 * `settings` 服务的**最小能力面**：只需 `describe`（读 `corum-subagent` namespace 的
 * resolved 值）。`corum-subagent` settings namespace 由 `corum-tool-subagent` 的 boot
 * registrar（`settings-registrar.ts`）注册，本包不持有它——运行时通过 `ctx.root.get
 * ('settings')` 读取已注册的 namespace（与 `acquireCorumSubagentSettingsScope` 同款手法，
 * 但不持有模块级 scope 单例——避免跨 bundle 模块级状态被复制，红线 1）。
 */
export interface SettingsDescribeFace {
  describe?: (options?: unknown) => readonly { ns: string; value?: unknown }[]
}

/**
 * `corum-subagent` settings namespace 的名（与 `settings-namespace.ts` 的
 * `CORUM_SUBAGENT_SETTINGS_NAMESPACE` 逐字一致——两处各声明一份，因为本包不能
 * import `corum-tool-subagent`；判据同 `corum-subagent` 这个字符串值在两侧都是字面量，
 * 改时两处一起改，fork-drift 守卫不覆盖跨包字面量）。
 */
const CORUM_SUBAGENT_NS = 'corum-subagent'

/** 全局兜底设置的最小形状（只取 worker 的 `defaultModel`）。 */
interface GlobalChildModel {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** 空值判据：provider/model 必须有实义（空串不算配置）。 */
function meaningful(route: { provider: string; model: string } | undefined): { provider: string; model: string } | undefined {
  if (route === undefined) return undefined
  if (route.provider === '' || route.model === '') return undefined
  return route
}

/**
 * 读 `corum-subagent` settings namespace 的 resolved 值（只读，每次调用现读——
 * 与 `acquireCorumSubagentSettingsScope` 的「已注册 ⇒ 只读直读」分支同语义）。
 *
 * settings 服务缺席 / namespace 未注册 / describe 抛错 ⇒ 返回 `undefined`
 * （= 无全局兜底 ⇒ 跟随主 Agent），不阻断委派。
 * @param settings - settings 服务面（`ctx.root.get('settings')`）。
 * @returns 全局 worker 子 Agent 模型，或 `undefined`。
 */
export function readGlobalChildModel(settings: SettingsDescribeFace | undefined): GlobalChildModel | undefined {
  if (settings === undefined || typeof settings.describe !== 'function') return undefined
  try {
    const found = settings.describe().find(d => d.ns === CORUM_SUBAGENT_NS)
    if (found === undefined) return undefined
    const value = found.value as { defaultModel?: GlobalChildModel } | undefined
    return meaningful(value?.defaultModel)
  } catch {
    return undefined
  }
}

/** {@link resolveScriptChildModel} 的结论。 */
export interface ResolvedScriptChildModel {
  /**
   * 生效路由；`undefined` = 落到「跟随主 Agent」（由 driver 用父真实路由填充）。
   */
  readonly route: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string } | undefined
  /** 该结论来自哪一档（供日志/证据）。 */
  readonly tier: 'session-override' | 'global' | 'follow-main'
}

/**
 * 解析脚本模式子 Agent 的生效模型路由（三档，worker 单角色）。
 *
 * 优先级（高 → 低）：
 *   ① 会话级覆盖（含 `'follow-main'` 哨兵 ⇒ 直接跳到 ③）；
 *   ② 全局兜底（`corum-subagent` 的 `defaultModel`）；
 *   ③ 跟随主 Agent（返回 `undefined`）。
 *
 * @param orchestration - `corumOrchestration` 服务的模型覆盖面。
 * @param settings - `settings` 服务的 describe 面（`ctx.root.get('settings')`）。
 * @param sessionId - 父会话 id（用于查会话级覆盖）。
 * @returns 生效路由 + 它来自哪一档。
 */
export function resolveScriptChildModel(
  orchestration: OrchestrationModelOverrideFace | undefined,
  settings: SettingsDescribeFace | undefined,
  sessionId: string,
): ResolvedScriptChildModel {
  // ① 会话级覆盖。
  if (orchestration !== undefined) {
    const override = orchestration.modelOverrideOf(sessionId, 'worker')
    if (override === FOLLOW_MAIN) return { route: undefined, tier: 'follow-main' }
    const session = meaningful(override === undefined ? undefined : override as { provider: string; model: string })
    if (session !== undefined) {
      const route: { provider: string; model: string; reasoningEffort?: string } = { provider: session.provider, model: session.model }
      const effort = (override as { reasoningEffort?: string }).reasoningEffort
      if (effort !== undefined && effort !== '') route.reasoningEffort = effort
      return { route, tier: 'session-override' }
    }
  }

  // ② 全局兜底。
  const global = readGlobalChildModel(settings)
  if (global !== undefined) return { route: global, tier: 'global' }

  // ③ 跟随主 Agent。
  return { route: undefined, tier: 'follow-main' }
}

/**
 * 把解析出的机制路由注入到 start 请求（标记为机制拥有，driver 不剥离）。
 *
 * `route === undefined`（跟随主 Agent）时不注入——driver 会用父路由，这正是「跟随」语义。
 * @param request - 原始请求（字段 readonly，返回一个带注入的副本）。
 * @param route - 解析出的机制路由（`undefined` = 跟随主 Agent）。
 * @returns 带注入的请求（若 route 为 undefined 则原样返回）。
 */
export function applyMechanismRoute(
  request: ResolvedSubagentStartRequest,
  route: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string } | undefined,
): ResolvedSubagentStartRequest {
  if (route === undefined) return request
  const agentOptions: AgentOptions = {
    provider: route.provider,
    model: route.model,
    ...(route.reasoningEffort !== undefined && route.reasoningEffort !== ''
      ? { reasoningEffort: ReasoningEffortId(route.reasoningEffort) }
      : {}),
  }
  return {
    ...request,
    agentOptions,
    agentOptionsOwnedByMechanism: true,
  }
}
