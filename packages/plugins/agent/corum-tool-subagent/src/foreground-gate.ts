/**
 * fork（corum）2026-10-18：前台子 Agent 的「伪前台」门禁（issue #75）。
 *
 * 设计文档：`docs/PENDING-foreground-subagent-pseudo-foreground.md`。
 *
 * ## 它做什么
 *
 * 前台委派不再阻塞父 Agent 的工具调用；工具立即返回 `{kind:'foreground-pending'}`
 * + `exec.concludeTurn()`，父 Agent 的 turn 正常结束 → 进入 idle → **仍能收事件**。
 * 本 service 记住「父 Agent X 正在等子 Agent Y/Z/… settle」，挂载在
 * `agent/pre-step` 钩子上拦截：等待期间父 Agent 的后续 turn 不进模型上下文
 * （用户插话排队、子 Agent 完成通知穿透）。
 *
 * ## 红线 1 合规
 *
 * 本服务是 **cordis Service**，挂在根上下文（`ctx.root`）—— corum preset 里
 * `corum-tool-subagent` 是双实例（worker + research），模块级单例会被切成两份、
 * 永不合并（`__corumSidebarMode` 教训）。根上下文的 reflect store 保证 service 实例
 * 跨 bundle 唯一。挂载采用 `corum-orchestration` 同款的 get-or-create 幂等模式，
 * worker/research 两个 apply 各跑一次都安全。
 *
 * ## 最小验证范围（本文件）
 *
 * 只做：
 *   - 记住「parentAgentId → Set<childId>」；
 *   - 前台委派时 `track(parentAgentId, childId)`；
 *   - 子 Agent settle 时 `release(parentAgentId, childId)`；
 *   - `isBlocking(agentId)`：该 agent 是否还有未 settle 的前台子 Agent；
 *   - `pendingChildren(agentId)`：快照，供 pre-step 钩子与通知用。
 *
 * **不做**（留到完整实施）：持久化、嵌套判定（`origin !== 'subagent'` 由 pre-step
 * 钩子侧判）、并发计数的原子替换、`agent/disposed` 清理。
 *
 * @module @corum/corum-tool-subagent/foreground-gate
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'

/**
 * 伪前台门禁状态：父 Agent → 其在飞的前台子 Agent childId 集合。
 *
 * cordis Service（根上下文 provide，跨 bundle 单例，红线 1 合规）。
 */
export class CorumForegroundGate extends Service {
  /** key = 父 Agent id（SessionId 字符串），value = 未 settle 的 childId 集合。 */
  private readonly pending = new Map<string, Set<string>>()

  constructor(ctx: Context) {
    super(ctx, 'corumForegroundGate')
  }

  /**
   * 登记一次前台委派：父 Agent 正在等这个 childId settle。
   *
   * 幂等：重复 track 同一 childId 无副作用（Set 天然去重）。
   */
  track(parentAgentId: SessionId | string, childId: string): void {
    const key = String(parentAgentId)
    let set = this.pending.get(key)
    if (set === undefined) {
      set = new Set<string>()
      this.pending.set(key, set)
    }
    set.add(childId)
  }

  /**
   * 一个前台子 Agent settle：从父 Agent 的等待集合里移除。
   *
   * @returns 移除后该父 Agent 是否还有未 settle 的前台子 Agent（true = 仍在等）。
   */
  release(parentAgentId: SessionId | string, childId: string): boolean {
    const key = String(parentAgentId)
    const set = this.pending.get(key)
    if (set === undefined) return false
    set.delete(childId)
    if (set.size === 0) {
      this.pending.delete(key)
      return false
    }
    return true
  }

  /** 父 Agent 是否还有未 settle 的前台子 Agent（门禁是否阻塞）。 */
  isBlocking(agentId: SessionId | string): boolean {
    const set = this.pending.get(String(agentId))
    return set !== undefined && set.size > 0
  }

  /** 父 Agent 当前在等的前台子 Agent childId 快照（不可变副本）。 */
  pendingChildren(agentId: SessionId | string): readonly string[] {
    const set = this.pending.get(String(agentId))
    return set === undefined ? [] : [...set]
  }

  /** 清空某父 Agent 的全部前台等待（dispose/取消兜底）。 */
  clear(parentAgentId: SessionId | string): void {
    this.pending.delete(String(parentAgentId))
  }
}

/**
 * 幂等 provide：在根上下文 get-or-create `corumForegroundGate`。
 *
 * worker/research 双实例的 apply 各跑一次都安全（get-or-create）。
 * 返回 service 实例，供调用方直接用（不必再 `ctx.root.get`）。
 */
export function acquireCorumForegroundGate(ctx: Context): CorumForegroundGate {
  const existing = ctx.root.get('corumForegroundGate', false) as CorumForegroundGate | undefined
  if (existing !== undefined) return existing
  return new CorumForegroundGate(ctx.root)
}
