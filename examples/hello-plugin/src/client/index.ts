/**
 * 第三方插件的客户端半（最小样例）。
 *
 * 要点：客户端半的配置**不在**代码里，而在 `package.json` 的 `dsh.client`
 * （`platform` / `inject` / `immediately` / `external`）—— 加载器读清单，
 * `apply` 只做装配。
 *
 * @module @corum-examples/hello-plugin/client
 */

import type { Context } from '@corum/plugin-sdk/client'

/** 客户端半依赖的服务名（与 `dsh.client.inject` 保持一致）。 */
export const inject = ['slots']

/**
 * 装配函数：向宿主注册一条 titlebar 槽内容。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: Context): void {
  ctx.logger?.info?.('hello-plugin client mounted')
}
