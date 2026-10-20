import { describe, expect, it } from 'vitest'
import { CLIENT_EXTERNALS_BASE, clientConfig, definePluginBundle, hostConfig } from '../src/index.ts'

/**
 * 这些断言钉的是**契约本身的形状**，不是某个包的构建结果：
 * banner/footer/intro 里任何一个字节变了，消费它的整个 loader 就装不上，
 * 而失败形态是「白屏 / 静默不生效」，不是编译错误。
 */
describe('clientConfig — 闭包工厂契约', () => {
  it('banner/footer/intro 构成可直接执行的 CJS 闭包', () => {
    const config = clientConfig({ id: '@corum/x' })
    // 返回类型是精确的 `ClientBundleConfig`（见 src/index.ts 的注释），这里可以直接读字段。
    const output = config.outputOptions
    expect(output.entryFileNames).toBe('client.js')
    expect(output.inlineDynamicImports).toBe(true)
    expect(output.banner).toContain('window.__ModuleLoader__.load(')
    expect(output.banner).toContain('"@corum/x"')
    expect(output.banner).toContain('factory: (require) => {')
    expect(output.footer).toContain('return module.exports;')
    expect(output.intro).toContain('var module = { exports: {} }')
  })

  it('基础 externals 全部被 external 且 noExternal 对其返回 undefined', () => {
    const config = clientConfig({ id: '@corum/x' })
    const externals = config.external
    expect(Array.isArray(externals)).toBe(true)
    for (const id of CLIENT_EXTERNALS_BASE) expect(externals).toContain(id)
    const noExternal = config.noExternal
    expect(typeof noExternal).toBe('function')
    for (const id of CLIENT_EXTERNALS_BASE) expect(noExternal(id)).toBeUndefined()
    expect(noExternal('lodash')).toBe(true)
  })

  it('extraExternals 追加到 external 且同样走 noExternal 判据', () => {
    const config = clientConfig({ id: '@corum/x', extraExternals: ['@corum/corum-ui-conversation/client'] })
    expect(config.external).toContain('@corum/corum-ui-conversation/client')
    expect(config.noExternal('@corum/corum-ui-conversation/client')).toBeUndefined()
  })

  it('css 缺省单文件；显式 cssMode: default 才交回 tsdown 默认（逐字保真用）', () => {
    expect(clientConfig({ id: '@corum/x' }).css).toEqual({ splitting: false })
    expect(clientConfig({ id: '@corum/x', cssMode: 'default' }).css).toBeUndefined()
  })

  it('conditionNames 只在显式开启时钉死（默认不改变解析行为）', () => {
    expect(clientConfig({ id: '@corum/x' }).inputOptions).toBeUndefined()
    const pinned = clientConfig({ id: '@corum/x', pinConditionNames: true })
    expect(pinned.inputOptions?.resolve?.conditionNames?.[0]).toMatch(/^(production|development)$/)
  })
})

describe('hostConfig — 宿主半契约', () => {
  it('入口是 tsc 产物、ESM/node、不产 d.ts（d.ts 由 tsc 出）', () => {
    const config = hostConfig({ id: '@corum/x' })
    expect(config.entry).toEqual(['lib/types/index.js'])
    expect(config.format).toEqual(['esm'])
    expect(config.platform).toBe('node')
    expect(config.dts).toBe(false)
    expect(config.outDir).toBe('lib')
  })

  it('多入口与 external 透传', () => {
    const config = hostConfig({
      id: '@corum/x',
      entries: { index: 'lib/types/index.js', invariant: 'lib/types/invariant.js' },
      external: ['@deepseek-ai/cordis'],
    })
    expect(config.entry).toEqual({ index: 'lib/types/index.js', invariant: 'lib/types/invariant.js' })
    expect(config.external).toEqual(['@deepseek-ai/cordis'])
  })
})

describe('definePluginBundle — 组装', () => {
  it('三类包各自的形态：K1 只有宿主半 / K2 双半 / K3 只有客户端半', () => {
    const k1 = definePluginBundle({ id: '@corum/k1', client: false })()
    expect(k1).toHaveLength(1)
    expect(k1[0]?.platform).toBe('node')

    const k2 = definePluginBundle({ id: '@corum/k2', client: {} })()
    expect(k2).toHaveLength(2)
    expect(k2[1]?.platform).toBe('browser')

    const k3 = definePluginBundle({ id: '@corum/k3', host: false, client: {} })()
    expect(k3).toHaveLength(1)
    expect(k3[0]?.platform).toBe('browser')
  })
})
