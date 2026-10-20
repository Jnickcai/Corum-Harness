/**
 * 测试插件的客户端半 —— 用官方 slot 的 **priority 遮蔽**替换两个区域。
 *
 * ## 机制（这是本插件要验证的核心）
 *
 * corum 的 IDE 壳把右侧区域声明成三个 `single` 槽：
 * `corum.editor`（编辑器）/ `corum.trajectory`（轨迹）/ `corum.panel`（终端）。
 * 官方 slot 注册表对 `single` 槽的规则是：
 *
 * - **同一 priority 二次注册 ⇒ 直接 throw**（`already has a registration …`）；
 * - **不同 priority ⇒ 允许共存，且 priority 最低的那个渲染**。
 *
 * 因此「替换一个区域」不需要改宿主、不需要内部层权限：
 * 在 `priority: -1` 上注册即可遮蔽宿主在默认 `priority: 0` 上的占用；
 * 插件卸载时注册被 fiber 一起撤销，宿主占用自动恢复。
 *
 * ## 两个必须做对的前置
 *
 * 1. **必须用 `slots.inject(key, factory)`，不能直接 `register`**：
 *    区域槽是由壳（父条目 children 表）**声明**的，客户端半可能比声明先跑；
 *    `inject` 会等到声明出现再执行注册（官方 renderer 的契约）。
 * 2. **`inject` 声明里要带 `slots`**（服务名），否则注册面拿不到。
 *
 * ## 可见性
 *
 * IDE 壳默认把这三个区域设为 hidden（`DEFAULT_HIDDEN`），所以替换后还要把它们点亮：
 * 走布局控制器的 `showRegion`（能力接口 + 可选链，缺面时静默跳过——红线 3 的做法）。
 *
 * @module @corum-examples/region-replacement/client
 */

import type { Context } from '@corum/plugin-sdk/client'
import { makeCorumRpcCall } from '@corum/plugin-sdk/client'
// type-only：把 `ctx.slots`（renderer 注册表）拉进本编译单元。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { EditorReplacement } from './EditorReplacement.tsx'
import { TerminalReplacement } from './TerminalReplacement.tsx'

/**
 * 声明要替换的两个槽（第三方没法 import 内部层 `corum-ide-ui` 的 SlotMap 增强块，
 * 所以在自己的编译单元里登记同形行 —— `kind`/`scope` 必须与壳声明一致）。
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** 右侧：编辑器区域（壳声明为 single/root）。 */
    'corum.editor': { kind: 'single'; scope: 'root' }
    /** 底部：终端面板（壳声明为 single/root）。 */
    'corum.panel': { kind: 'single'; scope: 'root' }
  }
}

/** 客户端半依赖的服务：槽注册表 + 布局（点亮区域）+ connection（演示 RPC）。 */
export const inject = ['slots', 'layout', 'connection']

/** 遮蔽优先级：官方语义「lowest renders」⇒ 比宿主的 0 更低即接管。 */
const SHADOW_PRIORITY = -1

/** 布局控制器的最小能力面（只在缺面时静默跳过；不 import 壳实现包）。 */
interface ShowRegionCapableLayout {
  showRegion?: (slot: string) => void
  setRegionHidden?: (slot: string, hidden: boolean) => void
}

/**
 * 装配：注册两个区域的 occupant，并点亮它们。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: Context): void {
  const connection = ctx.get('connection') as Parameters<typeof makeCorumRpcCall>[0] | undefined
  const callRemote = connection === undefined ? undefined : makeCorumRpcCall(connection)

  // slots.register 的完整类型面在官方 renderer 的 SlotCore 上（含 store/children/locale 等
  // 与本插件无关的座位）；第三方只需要 name/priority 两个字段，故在此收窄。
  const slots = ctx.slots as unknown as {
    inject: (key: string, callback: () => () => void) => () => void
    register: (
      options: { name: string; priority?: number; inject?: () => object },
      component: unknown,
    ) => () => void
  }

  // `inject` 是**每条注册自带**的注入面：官方 renderer 会把它的返回值展开成组件 props
  // （`entry.inject` → `...injected`）。这是把 RPC caller 交给面板的正规路径 ——
  // 不要用模块级单例传值（红线 1：跨 bundle 共享状态必须走 cordis 服务）。
  const layout = ctx.get('layout') as ShowRegionCapableLayout | undefined

  /**
   * 点亮区域。**必须在槽声明之后调用**（也就是 `slots.inject` 的回调里）：
   * `layout` 的网格动作依赖 AppFrame 已挂载 —— 在 apply 顶层直接调会抛
   * `layout: grid actions not wired (AppFrame not mounted)`，从而整条 loader 条目
   * apply 失败（本插件第一版就是这么挂的）。try/catch 是第二道兜底：
   * 区域点亮失败不该让插件整体失效。
   */
  const reveal = (key: string): void => {
    // 有界重试：`showRegion` 的实现闭包依赖 AppFrame 的运行时显隐状态，在插件
    // **刚挂载**那一刻调用可能落在状态初始化之前（实测：一次调用无效）。这里按
    // 400ms 间隔重试、最多 5 次，并用「区域元素是否已进 DOM」作为停止判据 ——
    // 拿到了就停，避免反复触发壳的重排。
    let attempts = 0
    const attempt = (): void => {
      attempts += 1
      try {
        layout?.showRegion?.(key)
        layout?.setRegionHidden?.(key, false)
      } catch { /* 壳尚未就绪：只影响可见性，不影响注册 */ }
      const mounted = document.querySelector(`[data-slot="${key}"]`) !== null
      if (mounted || attempts >= 5) return
      window.setTimeout(attempt, 400)
    }
    attempt()
  }

  slots.inject('corum.editor', () => {
    const dispose = slots.register(
      { name: 'corum.editor', priority: SHADOW_PRIORITY, inject: () => ({ callRemote }) },
      EditorReplacement,
    )
    reveal('corum.editor')
    return dispose
  })

  slots.inject('corum.panel', () => {
    const dispose = slots.register(
      { name: 'corum.panel', priority: SHADOW_PRIORITY },
      TerminalReplacement,
    )
    reveal('corum.panel')
    return dispose
  })

  ctx.logger?.info?.('region-replacement: 已接管 corum.editor / corum.panel（priority -1）')
}
