/**
 * 第三方插件的宿主半（最小样例）。
 *
 * 三件事：**声明名字**、**声明依赖的服务**、**在 apply 里做实事**。
 * `definePlugin` 只是类型收窄（零运行时逻辑），不装它也能跑 —— 装它是因为
 * `inject` / `name` 的语义在一处写清，比散落在每个插件里可靠。
 *
 * @module @corum-examples/hello-plugin
 */

import { definePlugin, type Context } from '@corum/plugin-sdk'

/** 插件名：与包名后缀一致（cordis 用它给服务与日志打标）。 */
export const name = 'hello-plugin'

/** 依赖的宿主服务。空数组 = 不依赖任何服务，随根上下文一起挂载。 */
export const inject: string[] = []

/**
 * 装配函数。**不要在模块作用域做副作用** —— cordis 会多次 reload。
 * @param ctx - 宿主的根上下文。
 */
export function apply(ctx: Context): void {
  // 一条能被宿主其他部分看到的事实：本插件真的挂上了。
  // 用法：`ctx.get('helloPlugin')?.greet('world')`
  ctx.provide('helloPlugin', {
    greet: (who: string): string => `hello, ${who} (from @corum-examples/hello-plugin)`,
  })
  ctx.logger?.info?.('hello-plugin mounted')
}

export default definePlugin({ name, inject, apply })
