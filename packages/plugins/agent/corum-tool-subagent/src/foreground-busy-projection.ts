/**
 * fork（corum）2026-10-18（issue #75 #9）：伪前台 busy 语义的 session projection。
 *
 * 设计文档 §5.6 问题 13：客户端 busy 语义依赖 `agent.status`——伪前台让父 Agent idle
 * ⇒ 用户插话被判成 `transcript`（聊天消息）、停止按钮无效、队列坞看不到。
 *
 * 本投影把 foreground-gate 的 blocking 状态暴露给客户端：当父 Agent 有未 settle 的
 * 前台子 Agent 时，`corumForegroundBusy` = true（即使 `agent.status === 'idle'`）。
 * 客户端据此判「父 Agent 实际仍在忙」（排队用户新消息、停止按钮有效、队列坞可见）。
 *
 * 事件 `corum/foreground-busy` 在伪前台 track / release 时 append 到父会话。
 *
 * ⚠️ 当前为 host-only projection（无 SessionProjectionMap 声明）；客户端读取 wire view
 * 待后续实施（需补 wire: { viewSchema, view } + SessionProjectionMap 声明）。
 *
 * @module @corum/corum-tool-subagent/foreground-busy-projection
 */

import { z as zod } from 'zod'
import type { SessionHeader, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

// fork（corum）：声明 session event（与 model-selection-state.ts 同款 declare module）。
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Records that this session has pending foreground subagents (pseudo-foreground).
     * `pending` = true when foreground children are running; false when all settled.
     * Log-only: carries no `surfaceOp`, never enters model history.
     */
    'corum/foreground-busy': {
      /** Whether this session currently has pending foreground subagents. */
      pending: boolean
      /** The child session ids that are still pending (empty when pending=false). */
      childIds?: readonly string[]
    }
  }
}

// fork（corum）：声明 session projection state（host-only，客户端 wire view 待后续）。
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /**
     * Whether this session has pending foreground subagents (pseudo-foreground busy).
     * `null` = no foreground delegation has ever started (default);
     * `true` = foreground children are running (parent is "busy" despite `agent.status === 'idle'`);
     * `false` = all foreground children settled.
     */
    corumForegroundBusy: boolean | null
  }
}

// fork（corum）：nullable boolean 的 schema（zod v4）。
const busySchema = zod.union([zod.null(), zod.boolean()]) as unknown as zod.ZodType<boolean | null>

/**
 * The projection definition for `corumForegroundBusy` (host-only).
 *
 * - `init`: `null` (no foreground delegation has started yet);
 * - `apply`: on `corum/foreground-busy` events, update to `pending` (true/false);
 *   on all other events, keep the current value.
 */
export const corumForegroundBusyProjectionDefinition: ProjectionDefinition<'corumForegroundBusy', boolean | null> = {
  key: 'corumForegroundBusy',
  stateVersion: 1,
  stateSchema: busySchema,
  init: () => null,
  apply: (state, event: SessionEvent) => {
    if (event.type !== 'corum/foreground-busy') return state
    const data = (event as { data?: { pending?: boolean } }).data
    return data?.pending === true
  },
}

/** Helper: append a `corum/foreground-busy` event to a parent session. */
export function appendForegroundBusyEvent(
  session: { append(type: 'corum/foreground-busy', data: { pending: boolean; childIds?: readonly string[] }): void },
  pending: boolean,
  childIds: readonly string[],
): void {
  try {
    session.append('corum/foreground-busy', {
      pending,
      ...(childIds.length > 0 ? { childIds } : {}),
    })
  } catch {
    // append 失败只静默（投影是增强，不能反过来让委派失败）。
  }
}
