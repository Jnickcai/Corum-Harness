/**
 * Web-only plugin: corum-issue-reporter carries no Host-side contributions.
 *
 * 悬浮入口与提交面板**全部**在浏览器半边（`src/client/index.ts` 的
 * `ctx.effect` 自建 body 级容器 + createRoot）——host 侧不需要任何服务、
 * 任何 IPC、任何 RPC：提交流程是纯手工的 URL 组装 + 系统浏览器外链
 * （外链走桌面壳的 `corum:open-external`，与 cordis 插件图无关）。
 */

import type { Context } from '@deepseek-ai/cordis'

export const name = 'corum-issue-reporter'

/** Required services (none — every contribution lives in the browser half). */
export const inject: string[] = []

/**
 * No-op Host half; kept so the package graph entry stays a valid plugin.
 * @param _ctx - Host context (unused).
 */
export function apply(_ctx: Context): void {
  // 本插件的全部行为都在浏览器半边。
}
