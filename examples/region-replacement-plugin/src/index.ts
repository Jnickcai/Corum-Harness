/**
 * 测试插件的宿主半（no-op）。
 *
 * 本插件的全部能力在客户端半（替换两个区域），宿主半只做两件事：
 * ① 让 loader 有一个**条目**（客户端半是按条目供应的，没有条目就不会被加载）；
 * ② 提供一个最小服务作为「确实挂上了」的判据（`ctx.get('regionReplacement')`）。
 *
 * @module @corum-examples/region-replacement
 */

import { definePlugin } from '@corum/plugin-sdk'
import type { Context } from '@corum/plugin-sdk'

/** 插件名：与包名后缀一致。 */
export const name = 'region-replacement'

/** 不依赖任何宿主服务。 */
export const inject: string[] = []

/**
 * 装配：注册一个只读信息面，供宿主侧诊断/测试断言用。
 * @param ctx - 宿主根上下文。
 */
export function apply(ctx: Context): void {
  ctx.provide('regionReplacement', {
    /** 本插件替换的区域（客户端半实际注册的 slot 键）。 */
    regions: (): readonly string[] => ['corum.editor', 'corum.panel'],
  })
}

export default definePlugin({ name, inject, apply })
