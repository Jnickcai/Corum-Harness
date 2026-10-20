import { describe, expect, it } from 'vitest'
import {
  PLUGIN_UI_SLOTS,
  REGION_OVERRIDE_SLOTS,
  SETTINGS_SECTION_SLOT,
  SHADOW_PRIORITY,
  defineRegionOverride,
  defineSettingsSection,
  registerRegionOverride,
  registerSettingsSection,
} from '../src/index.ts'

/** 假 ctx.slots：记录 inject/register 的调用，验证 helper 的注册形态。 */
function fakeSlots() {
  const calls: Array<{ kind: 'inject' | 'register'; key?: string; options?: Record<string, unknown> }> = []
  return {
    calls,
    inject(key: string, callback: () => () => void) {
      calls.push({ kind: 'inject', key })
      return callback()
    },
    register(options: Record<string, unknown>) {
      calls.push({ kind: 'register', options })
      return () => undefined
    },
  }
}

describe('白名单', () => {
  it('只放三个右侧区域 + 设置 section', () => {
    expect([...PLUGIN_UI_SLOTS].sort()).toEqual([
      'corum.editor', 'corum.panel', 'corum.trajectory', 'settings.section',
    ])
  })

  it('明确不含会话流与其它内部槽（布局与内部实现不对第三方开放）', () => {
    for (const key of ['conversation', 'conversation.chat.node', 'settings.general.item', 'corum.sidebar', 'corum.titlebar']) {
      expect(PLUGIN_UI_SLOTS.has(key), `${key} 不该在插件白名单里`).toBe(false)
    }
  })
})

describe('registerRegionOverride', () => {
  it('用 inject 等声明，并以 priority -1 注册', () => {
    const slots = fakeSlots()
    const Component = () => null
    registerRegionOverride(slots, defineRegionOverride({ slot: 'corum.editor', Component }))
    expect(slots.calls[0]).toEqual({ kind: 'inject', key: 'corum.editor' })
    expect(slots.calls[1]?.options).toMatchObject({ name: 'corum.editor', priority: SHADOW_PRIORITY })
  })

  it('inject 面透传成注册选项（组件 props 的来源）', () => {
    const slots = fakeSlots()
    const Component = () => null
    registerRegionOverride(slots, defineRegionOverride({ slot: 'corum.panel', Component, inject: () => ({ foo: 1 }) }))
    const options = slots.calls[1]?.options as { inject?: () => object }
    expect(options.inject?.()).toEqual({ foo: 1 })
  })
})

describe('registerSettingsSection', () => {
  it('注册到 settings.section，带 id / order / label（不写 priority ⇒ 与壳并列而非遮蔽）', () => {
    const slots = fakeSlots()
    const Component = () => null
    registerSettingsSection(slots, defineSettingsSection({ id: 'my.settings', label: () => '我的插件', Component }))
    expect(slots.calls[0]).toEqual({ kind: 'inject', key: SETTINGS_SECTION_SLOT })
    const options = slots.calls[1]?.options as Record<string, unknown>
    expect(options.name).toBe('settings.section')
    expect(options.id).toBe('my.settings')
    expect(options.order).toBe(500)
    expect(options.priority).toBeUndefined()
  })
})
