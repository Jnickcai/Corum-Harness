import { describe, expect, it } from 'vitest'
import { brandOf, COMMON_PROVIDERS } from '../src/client/brands.tsx'

describe('Kimi Code 供应商入口', () => {
  it('为会员编程额度提供独立原生路由，不复用普通 Moonshot API', () => {
    expect(COMMON_PROVIDERS.find(provider => provider.id === 'kimi-coding')?.name).toBe('Kimi Code')
    expect(COMMON_PROVIDERS.find(provider => provider.id === 'moonshotai')?.name).toBe('月之暗面')
  })

  it('原生路由在供应商卡片中显示为 Kimi Code', () => {
    expect(brandOf('kimi-coding')?.name).toBe('Kimi Code')
    expect(brandOf('KIMI-CODING')?.name).toBe('Kimi Code')
  })

  it('普通 Moonshot API 和既有自定义 Kimi 路由保持原有品牌', () => {
    expect(brandOf('moonshotai-cn')?.name).toBe('月之暗面')
    expect(brandOf('my-kimi-api')?.name).toBe('月之暗面')
  })
})
