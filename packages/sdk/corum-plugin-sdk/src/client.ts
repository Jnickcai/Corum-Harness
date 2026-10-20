/**
 * @corum/plugin-sdk —— 第三方插件的**客户端半**入口（`@corum/plugin-sdk/client`）。
 *
 * ## 这里为什么是「编译 ESM 库」而不是 `__ModuleLoader__` 闭包
 *
 * 本包**不是**被装载的插件，它是被插件在**构建期 import** 的库。闭包形态（CJS + banner）
 * 是 loader 的装载契约，只能用于最终产物；库形态必须是可被消费者打包器静态分析的 ESM。
 * 插件包自己的 `./client` 才走闭包（`@corum/plugin-build` 的 `clientConfig`）。
 *
 * ## 导出面的取舍
 *
 * 只导出**承诺稳定**的东西：槽注册与查询、布局渲染基件（GridView/RegionCard/MosaicWall）、
 * 路径 helper、RPC 调用。内部层的 35 个包**不**从这里透出 —— 它们随应用发布但不承诺
 * 跨版本兼容（方案 §A.2），透出等于给它们套上 semver 承诺。
 *
 * @module @corum/plugin-sdk/client
 */

import type { Context } from '@deepseek-ai/cordis'

export type { Context } from '@deepseek-ai/cordis'

// ── 槽与布局（来自 @corum/corum-ui-base 的客户端半） ─────────────────────────
export {
  registerSlot,
  getSlotMeta,
  getAllRegisteredSlots,
  drainPendingSlots,
  GridView,
  RegionCard,
  FloatingLayer,
  useFloatingLayer,
  MosaicWall,
  MosaicTileBody,
  useMosaicColumns,
  buildMosaic,
  ThemePresenter,
  joinPath,
  basenameOf,
  shortenPath,
} from '@corum/corum-ui-base/client'
export type {
  SlotMeta,
  SlotRegistryFace,
  GridNode,
  GridViewProps,
  RegionCardProps,
  FloatingLayerApi,
  MosaicSize,
  MosaicItemHint,
  MosaicTint,
  MosaicWallProps,
} from '@corum/corum-ui-base/client'

// ── RPC（来自 @corum/corum-rpc-client 的客户端半） ───────────────────────────
export { makeCorumRpcCall } from '@corum/corum-rpc-client/client'
export type { CorumRpcCall } from '@corum/corum-rpc-client/client'

/**
 * 客户端插件的入口契约。
 *
 * 与 host 半的区别只有一处、但很重要：**没有 config**。客户端半的配置随 `dsh.client`
 * 清单走（`platform` / `inject` / `immediately` / `external`），不进 `apply` 的参数。
 */
export interface ClientPlugin {
  /** 依赖的服务名（客户端服务，如 `slots` / `layout`）。 */
  inject: string[]
  /** 装配函数。作用域是浏览器上下文。 */
  apply(ctx: Context): void
}

/**
 * 定义一个客户端插件。
 *
 * ```ts
 * import { defineClientPlugin, registerSlot, RegionCard } from '@corum/plugin-sdk/client'
 *
 * export const inject = ['slots']          // 清单里也要写同样的 inject
 * export function apply(ctx: Context) { … }
 * ```
 *
 * 注意：客户端半的 `dsh.client` 清单字段**不在**这个 helper 里，它属于 `package.json`
 * （`packages/plugin-build` 与规范 §1 管这一段），运行期拿不到也不该拿。
 */
export function defineClientPlugin(plugin: ClientPlugin): ClientPlugin {
  return plugin
}
