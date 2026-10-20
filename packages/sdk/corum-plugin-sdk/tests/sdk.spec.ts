import { describe, expect, it } from 'vitest'
import { definePlugin } from '../src/index.ts'
import { defineClientPlugin } from '../src/client.ts'

/**
 * SDK 的判据只有两条，但都很要紧：
 *  1. 两个 helper 是**恒等**的（不夹带运行期行为 —— 一旦夹带，它就变成新的宿主契约）；
 *  2. 聚合面成立（第三方只依赖一个包就能拿到槽 API 与 RPC helper）。
 */
describe('definePlugin（宿主半）', () => {
  it('恒等返回，不改写字段', () => {
    const plugin = { name: 'probe', inject: ['tools'], apply: () => undefined }
    expect(definePlugin(plugin)).toBe(plugin)
  })
})

describe('defineClientPlugin（客户端半）', () => {
  it('恒等返回', () => {
    const plugin = { inject: ['slots'], apply: () => undefined }
    expect(defineClientPlugin(plugin)).toBe(plugin)
  })
})

describe('聚合面（第三方只依赖一个包）', () => {
  it('槽 API 与布局基件从 SDK 的 client 入口可见', async () => {
    // 动态按名字取导出：命名空间对象要收窄成索引签名，否则 tsc 报 TS7053。
    const sdk = await import('../src/client.ts') as unknown as Record<string, unknown>
    for (const name of ['registerSlot', 'getSlotMeta', 'GridView', 'RegionCard', 'MosaicWall', 'joinPath', 'makeCorumRpcCall']) {
      expect(sdk[name], `SDK/client 未聚合 ${name}`).toBeDefined()
    }
  })
})
