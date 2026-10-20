/**
 * @corum/plugin-ui-contract —— 插件**可以碰的 UI 面**（公开契约）。
 *
 * # 两条，且只有两条
 *
 * 1. **右侧区域覆盖**：`corum.editor`（编辑器）/ `corum.trajectory`（轨迹）/ `corum.panel`（终端）。
 *    机制是官方 slot 的 priority 遮蔽：宿主在 `priority: 0`，插件在 {@link SHADOW_PRIORITY}
 *    注册即接管；卸载时注册随 fiber 撤销，宿主 occupant 自动回来。
 * 2. **设置 ›「扩展」里新增自己的设置页**：往 `settings.section`（list 槽）注册一条，
 *    id 不在壳的已知表里 ⇒ 自动落进「扩展」分组（壳的 `navGroupOf()` 缺省值就是 extensions）。
 *
 * # 壳布局不可改（这是硬边界，不是建议）
 *
 * 本包**故意不导出**任何布局写入面（`showRegion` / `setRegionHidden` / `toggleRegion` /
 * `resetLayout` / `closeRegion` 一律不提供）：
 *
 * - 网格树（五个区域、权重、拖放结果）由壳持有，插件改它 = 改产品布局；
 * - 「插件接管了某区域却看不见」的问题由**壳**解决：壳检测到某区域存在 `priority < 0`
 *   的占用者时会自动点亮该区域（2026-10-21 落地）。插件不需要、也不应该碰布局。
 *
 * 想加**新区域**？不支持。需要的话走产品需求评审 —— 否则每个插件都能长出自己的格子，
 * 布局会失去意义（方案 §F.2 的结论）。
 *
 * @module @corum/plugin-ui-contract
 */

import type { ComponentType } from 'react'
// 模块增强（declare module）要求本文件**能解析**该模块：显式 import 一次类型面，
// 否则 TS2664 `Invalid module name in augmentation`。
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'

export type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'

/**
 * 插件可覆盖的三个右侧区域。
 *
 * `corum.trajectory` 是 `session-maybe` 域（无当前会话时 occupant 渲染空态），
 * 另两个是 `root` 域。三条 `kind` 都是 `single` —— 这正是 priority 遮蔽能生效的前提。
 */
export const REGION_OVERRIDE_SLOTS = ['corum.editor', 'corum.trajectory', 'corum.panel'] as const

/** 可覆盖区域的联合类型。 */
export type RegionOverrideSlot = (typeof REGION_OVERRIDE_SLOTS)[number]

/**
 * 遮蔽优先级：宿主占用在默认 `0`，插件用 `-1` 即接管（官方语义「priority 最低者渲染」）。
 * 同一 priority 二次注册会**抛错**，所以这个值不能省。
 */
export const SHADOW_PRIORITY = -1

/** 设置页 section 的槽键（list 槽：每条注册 = 左侧导航里的一行）。 */
export const SETTINGS_SECTION_SLOT = 'settings.section'

/**
 * 插件可注册的槽（白名单）。**不在表里的槽一律不许碰** —— 那些键的 owner props 契约
 * 在 corum 内部层包里，注入进去等于和内部实现硬耦合（`scripts/verify-plugin-ui-surface.mjs`
 * 会对插件源码做静态检查）。
 */
export const PLUGIN_UI_SLOTS: ReadonlySet<string> = new Set<string>([
  ...REGION_OVERRIDE_SLOTS,
  SETTINGS_SECTION_SLOT,
])

/** 注册面（`ctx.slots` 的窄化视图：只暴露插件需要的方法）。 */
export interface SlotsFace {
  /** 等到槽被声明后执行注册（区域槽由壳声明，插件 apply 可能先跑）。 */
  inject: (key: string, callback: () => () => void) => () => void
  /** 注册一条占用。 */
  register: (
    options: { name: string; priority?: number; id?: string; order?: number; label?: string | (() => string); inject?: () => object },
    component: unknown,
  ) => () => void
}

/** 一条区域覆盖的声明。 */
export interface RegionOverride<Injected extends object = Record<string, never>> {
  /** 要接管的区域。 */
  slot: RegionOverrideSlot
  /** 区域内容组件（收到本声明 `inject` 的返回值作为 props）。 */
  Component: ComponentType<Injected>
  /** 注入面：返回值会展开成组件 props（不要用模块级单例传值 —— 红线 1）。 */
  inject?: () => Injected
}

/**
 * 声明一条区域覆盖（恒等返回，只为类型收窄）。
 *
 * ```ts
 * export const editorOverride = defineRegionOverride({
 *   slot: 'corum.editor',
 *   Component: MyEditor,
 * })
 * ```
 */
export function defineRegionOverride<Injected extends object = Record<string, never>>(
  override: RegionOverride<Injected>,
): RegionOverride<Injected> {
  return override
}

/**
 * 注册一条区域覆盖。
 * @param slots - `ctx.slots`（由调用方注入，本包不持有状态）。
 * @param override - 区域声明。
 * @returns disposer（建议挂进 `ctx.effect`）。
 */
export function registerRegionOverride<Injected extends object>(
  slots: unknown,
  override: RegionOverride<Injected>,
): () => void {
  const face = slots as SlotsFace
  return face.inject(override.slot, () => face.register(
    {
      name: override.slot,
      priority: SHADOW_PRIORITY,
      ...(override.inject === undefined ? {} : { inject: override.inject }),
    },
    override.Component,
  ))
}

/** 一条设置 section 的声明。 */
export interface SettingsSection<Injected extends object = Record<string, never>> {
  /** 稳定 id；**不要**用壳已知的 id（那会顶掉内置页），其余一律落进「扩展」分组。 */
  id: string
  /** 导航标签（thunk 形式会跟随语言，切语言时自动更新）。 */
  label: string | (() => string)
  /** 同组内排序（缺省 500：排在壳自带项之后）。 */
  order?: number
  /** 页面内容组件（收到本声明 `inject` 的返回值 + 壳下发的 owner props）。 */
  Component: ComponentType<Injected & SettingsSectionOwnerProps>
  /** 注入面。 */
  inject?: () => Injected
}

/**
 * 声明一条设置 section（恒等返回）。
 *
 * ```ts
 * export const mySettings = defineSettingsSection({
 *   id: 'my-plugin.settings',
 *   label: () => '我的插件',
 *   Component: MySettingsPage,
 * })
 * ```
 */
export function defineSettingsSection<Injected extends object = Record<string, never>>(
  section: SettingsSection<Injected>,
): SettingsSection<Injected> {
  return section
}

/**
 * 注册一条设置 section（落进设置 ›「扩展」分组）。
 * @param slots - `ctx.slots`。
 * @param section - section 声明。
 * @returns disposer。
 */
export function registerSettingsSection<Injected extends object>(
  slots: unknown,
  section: SettingsSection<Injected>,
): () => void {
  const face = slots as SlotsFace
  return face.inject(SETTINGS_SECTION_SLOT, () => face.register(
    {
      name: SETTINGS_SECTION_SLOT,
      id: section.id,
      order: section.order ?? 500,
      label: section.label,
      ...(section.inject === undefined ? {} : { inject: section.inject }),
    },
    section.Component,
  ))
}

/**
 * 把插件要碰的两个槽登记进全局 SlotMap（类型层面）。
 *
 * 为什么由契约包登记：第三方拿不到 corum 内部层的 SlotMap 增强块，而 `slots.register/inject`
 * 的键校验的是**全局合并接口**——不登记就编译不过。这里登记的行与壳的声明**逐字同形**
 * （`kind` / `scope` / `owner` 三处任一不同都会 TS2717 冲突）。
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** 右侧：编辑器（壳声明 single/root）。 */
    'corum.editor': { kind: 'single'; scope: 'root' }
    /** 右侧：轨迹（壳声明 single/session-maybe）。 */
    'corum.trajectory': { kind: 'single'; scope: 'session-maybe' }
    /** 底部：终端（壳声明 single/root）。 */
    'corum.panel': { kind: 'single'; scope: 'root' }
    /** 设置页 section（官方契约同形；壳的 occupant 与各插件共同往里注册）。 */
    'settings.section': { kind: 'list'; scope: 'root'; owner: SettingsSectionOwnerProps }
  }
}
