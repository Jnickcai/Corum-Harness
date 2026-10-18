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
  /**
   * fork（corum）2026-10-18（issue #75 #5）：持有的前台 run 引用（key = childId）。
   *
   * 伪前台**不立即 dispose run**（5.4：否则 `localAgent` 不可达）。但停止必须有效
   * （5.6 问题 1：父 Agent idle 时 cancel 是 no-op、interrupt 对一次性 run 静默 no-op）。
   * 故 gate 持有 run 引用：父 Agent 被 dispose / 停止时，`disposeRun(childId)` 直接
   * `run.dispose()` 杀掉子 Agent——这是唯一能真正中断一次性 run 的路径。
   */
  private readonly runs = new Map<string, { dispose(): Promise<void> }>()

  constructor(ctx: Context) {
    super(ctx, 'corumForegroundGate')
  }

  /**
   * 登记一次前台委派：父 Agent 正在等这个 childId settle。
   *
   * @param run - 持有的前台子 Agent run 引用（供停止路径直接 dispose，5.6 问题 1）。
   *   伪前台不立即 dispose（5.4），但 `disposeRun(childId)` 可在停止时杀掉它。
   *   传 `undefined` 则不持有 run（向后兼容最小验证）。
   * 幂等：重复 track 同一 childId 无副作用（Set 天然去重）。
   */
  track(parentAgentId: SessionId | string, childId: string, run?: { dispose(): Promise<void> }): void {
    const key = String(parentAgentId)
    let set = this.pending.get(key)
    if (set === undefined) {
      set = new Set<string>()
      this.pending.set(key, set)
    }
    set.add(childId)
    if (run !== undefined) this.runs.set(childId, run)
  }

  /**
   * 一个前台子 Agent settle：从父 Agent 的等待集合里移除。
   *
   * 同时丢弃持有的 run 引用（子 Agent 已 settle，dispose 由调用方负责）。
   *
   * @returns 移除后该父 Agent 是否还有未 settle 的前台子 Agent（true = 仍在等）。
   */
  release(parentAgentId: SessionId | string, childId: string): boolean {
    const key = String(parentAgentId)
    const set = this.pending.get(key)
    if (set === undefined) return false
    set.delete(childId)
    this.runs.delete(childId)
    if (set.size === 0) {
      this.pending.delete(key)
      return false
    }
    return true
  }

  /**
   * fork（corum）2026-10-18（issue #75 #5）：直接 dispose 一个前台子 Agent 的 run。
   *
   * 这是停止一次性 run 的唯一有效路径——`cancel()` 在 idle 时是 no-op、`interrupt()`
   * 对一次性 run 静默 no-op（5.6 问题 1）。拿到 run 引用直接 `dispose()` 才能杀掉它。
   *
   * @returns 是否找到了该 childId 的 run 并发起了 dispose（false = 无引用，可能已 settle）。
   */
  async disposeRun(childId: string): Promise<boolean> {
    const run = this.runs.get(childId)
    if (run === undefined) return false
    this.runs.delete(childId)
    try {
      await run.dispose()
    } catch {
      // dispose 是幂等的；失败只记静默（run 可能已自行结束）。
    }
    return true
  }

  /**
   * fork（corum）2026-10-18（issue #75 #5/#14）：父 Agent dispose 时清理其全部前台子 Agent。
   *
   * 杀掉所有持有的 run、清空 pending 集合。每个 run 的 dispose 是 fire-and-forget
   * （不阻塞 dispose 流程）。
   */
  disposeAllFor(parentAgentId: SessionId | string): void {
    const key = String(parentAgentId)
    const set = this.pending.get(key)
    if (set !== undefined) {
      for (const childId of set) {
        const run = this.runs.get(childId)
        if (run !== undefined) {
          this.runs.delete(childId)
          void run.dispose().catch(() => {})
        }
      }
      this.pending.delete(key)
    }
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

  /** 清空某父 Agent 的全部前台等待 + 杀掉其全部持有的 run（dispose/取消兜底）。 */
  clear(parentAgentId: SessionId | string): void {
    this.disposeAllFor(parentAgentId)
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
