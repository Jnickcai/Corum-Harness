/**
 * 测试插件的客户端半 —— 只做两件**契约允许**的事：
 * ① 覆盖右侧两个区域（`corum.editor` / `corum.panel`）；
 * ② 在 设置 ›「扩展」里新增自己的设置页。
 *
 * 三条边界（`@corum/plugin-ui-contract` 的注释里写死了，这里再点名）：
 *
 * - **不碰布局**：不调 `showRegion` / `setRegionHidden` / `toggleRegion` / `resetLayout`。
 *   「插件接管了区域却看不见」由**壳**解决 —— 壳检测到某区域存在 `priority < 0` 的占用者
 *   会自动点亮它（2026-10-21 落地，见 `corum-ide-ui/src/client/index.tsx` 的
 *   `revealPluginOverriddenRegions`）。
 * - **不新增区域**：网格是壳的，第三方只能覆盖已有区域。
 * - **不碰白名单外的槽**：`conversation.*` / `settings.general.item` 等键的 owner props
 *   契约在 corum 内部层包里（`scripts/verify-plugin-ui-surface.mjs` 会静态拦）。
 *
 * 机制补充（为什么这样做能达到「替换」而不是「并列」）：官方 slot 对 `single` 槽的规则是
 * —— 同 priority 二次注册直接抛错，**不同 priority 允许共存且最低者渲染**；宿主占 0，
 * 契约包用 `priority: -1` 接管，插件卸载时注册随 fiber 撤销、宿主 occupant 自动回来。
 *
 * @module @corum-examples/region-replacement/client
 */

import type { Context } from '@corum/plugin-sdk/client'
import { makeCorumRpcCall } from '@corum/plugin-sdk/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import {
  registerRegionOverride as registerRegion,
  registerSettingsSection as registerSettings,
} from '@corum/plugin-ui-contract'
import { EditorReplacement } from './EditorReplacement.tsx'
import { TerminalReplacement } from './TerminalReplacement.tsx'
import { RegionReplacementSettings } from './SettingsPage.tsx'

/** 依赖的服务：槽注册表 + connection（演示宿主 RPC）。**不含 layout**：布局归壳。 */
export const inject = ['slots', 'connection']

/** 设置 section 的稳定 id（不在壳已知表里 ⇒ 自动落进「扩展」分组）。 */
export const SETTINGS_SECTION_ID = 'region-replacement.settings'

/**
 * 装配：两个区域覆盖 + 一条设置页。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: Context): void {
  const connection = ctx.get('connection') as Parameters<typeof makeCorumRpcCall>[0] | undefined
  const callRemote = connection === undefined ? undefined : makeCorumRpcCall(connection)

  // ① 区域覆盖：契约包内部做 slots.inject + priority -1 注册。
  registerRegion(ctx.slots, {
    slot: 'corum.editor',
    Component: EditorReplacement,
    inject: () => ({ callRemote }),
  })
  registerRegion(ctx.slots, { slot: 'corum.panel', Component: TerminalReplacement })

  // ② 设置 ›「扩展」里的一页。
  registerSettings(ctx.slots, {
    id: SETTINGS_SECTION_ID,
    label: () => '测试插件 · 区域替换',
    order: 500,
    Component: RegionReplacementSettings,
  })

  ctx.logger?.info?.('region-replacement: 已注册 2 条区域覆盖 + 1 条设置页（setup 契约）')
}
