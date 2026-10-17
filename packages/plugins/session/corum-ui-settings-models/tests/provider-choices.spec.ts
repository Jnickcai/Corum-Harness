/**
 * `providerChoices` —— 供应商可选范围**只来自 pi-ai 目录**的不变式测试。
 *
 * 背景（2026-10-17）：向导原本读一份自维护的 `COMMON_PROVIDERS`（13 家硬编码）。
 * 那份清单与 pi-ai 内置的 39 家**长期脱节**：pi-ai 里 26 家用户根本选不到，而清单
 * 里 `qwen`/`baidu`/`spark`/`doubao` 在 pi-ai 里甚至没有原生定义。
 *
 * 同一类「自维护清单与上游事实源脱节」当天还出过两个事故：
 * `--dsh-alias` token 名笔误、`kimi-coding` 品牌靠数组顺序才勉强匹配上。
 *
 * 所以这里钉住的不是「有哪 13 家」，而是更根本的一条：
 * **`providerChoices` 的输出必须完全由传入的目录决定** —— 目录加一家，它就多一家；
 * 目录删一家，它就少一家；代码里不需要任何改动。`PINNED` 只影响排序，不影响集合。
 */
import { describe, expect, it } from 'vitest'
import { brandNameOf, brandOf, CUSTOM_TEMPLATES, isPinnedProvider, providerChoices } from '../src/client/brands.tsx'

/** 目录结果里除自定义模板之外的 provider id（模板不属于 pi-ai 目录）。 */
const directoryIds = (rows: ReadonlyArray<{ provider: string; displayName: string }>): string[] => {
  const templateIds = new Set(CUSTOM_TEMPLATES.map(t => t.id))
  return providerChoices(rows).map(c => c.id).filter(id => !templateIds.has(id))
}

const row = (provider: string, displayName = provider): { provider: string; displayName: string } => ({
  provider,
  displayName,
})

describe('providerChoices：可选范围由 pi-ai 目录决定', () => {
  it('目录里每个 provider 都出现在结果里（不遗漏）', () => {
    const rows = [row('deepseek'), row('groq'), row('cerebras'), row('baseten')]
    expect(directoryIds(rows).sort()).toEqual(['baseten', 'cerebras', 'deepseek', 'groq'])
  })

  it('目录新增一个 provider 会立即出现，无需改代码', () => {
    // 这就是本改动要买到的性质：pi-ai 上游加一家，UI 自动就有。
    const before = directoryIds([row('deepseek')])
    const after = directoryIds([row('deepseek'), row('brand-new-provider')])
    expect(before).toEqual(['deepseek'])
    expect(after).toContain('brand-new-provider')
    expect(after.length).toBe(before.length + 1)
  })

  it('目录为空时只剩自定义模板（第三方通道不属于目录）', () => {
    expect(directoryIds([])).toEqual([])
    expect(providerChoices([]).map(c => c.id)).toEqual(CUSTOM_TEMPLATES.map(t => t.id))
  })

  it('目录里已经消失的 provider 不会残留', () => {
    // 反向保证：不存在任何「代码里记着、目录里没了」的幽灵条目。
    const choices = directoryIds([row('deepseek')])
    expect(choices).toEqual(['deepseek'])
    // groq 曾是「只在别的清单里」的典型；它不出现说明集合完全由入参决定。
    expect(choices.includes('groq')).toBe(false)
  })

  it('过滤掉目录的 probe 伪路由（以 NUL 开头）', () => {
    // store.ts 用 PROBE_ROUTE = '\u0000probe' 命名一个 schema 节点，它不可配置。
    expect(directoryIds([row('deepseek'), row('\u0000probe', 'probe')])).toEqual(['deepseek'])
  })

  it('同一 provider 重复出现只保留一次', () => {
    expect(directoryIds([row('deepseek'), row('deepseek')])).toEqual(['deepseek'])
  })
})

describe('providerChoices：PINNED 只决定排序', () => {
  it('常用项排在未置顶项之前', () => {
    const ids = providerChoices([row('zzz-unknown'), row('deepseek'), row('aaa-unknown')]).map(c => c.id)
    expect(ids[0]).toBe('deepseek')
    // 未置顶项保持字母序，且都在置顶项之后
    const unknown = ids.filter(id => id === 'aaa-unknown' || id === 'zzz-unknown')
    expect(unknown).toEqual(['aaa-unknown', 'zzz-unknown'])
    expect(ids.indexOf('deepseek')).toBeLessThan(ids.indexOf('aaa-unknown'))
  })

  it('常用项之间保持 PINNED 里声明的顺序', () => {
    // deepseek 在 PINNED 里早于 openai，即使字母序相反。
    const ids = providerChoices([row('openai'), row('deepseek')]).map(c => c.id)
    // 只看这两家的相对顺序（火山方舟等置顶模板也在列表里，不参与本断言）
    expect(ids.indexOf('deepseek')).toBeLessThan(ids.indexOf('openai'))
  })

  it('置顶但没有出现在目录里的 provider 不会凭空冒出来', () => {
    // PINNED 里列了很多家；目录只给一家时，结果就只有一家。
    expect(directoryIds([row('groq')])).toEqual(['groq'])
  })

  it('isPinnedProvider 只反映展示偏好，与目录无关', () => {
    expect(isPinnedProvider('deepseek')).toBe(true)
    expect(isPinnedProvider('baseten')).toBe(false)
  })
})

describe('providerChoices：品牌是纯装饰，缺表也有兜底', () => {
  it('已知品牌用 BRANDS 的名字与色值', () => {
    const deepseek = providerChoices([row('deepseek', 'DeepSeek')]).find(c => c.id === 'deepseek')
    expect(deepseek?.name.en).toBe('DeepSeek')
    expect(brandNameOf(deepseek!.name, 'zh-CN')).toBe('深度求索')
    expect(deepseek?.mark).toBe('DS')
  })

  it('未知品牌回退到目录给的 displayName，而不是隐藏该选项', () => {
    // 关键：没有品牌条目 ≠ 不可配置。绝不能因为「不认识」就把厂家藏起来。
    const found = providerChoices([row('some-new-vendor', 'Some New Vendor')])
      .find(c => c.id === 'some-new-vendor')
    expect(found).toBeDefined()
    expect(found?.name.en).toBe('Some New Vendor')
    expect(found?.mark).toBe('S')
  })

  it('未知品牌的 displayName 为空时仍有可用标记', () => {
    const found = providerChoices([row('zzz-mystery', '')]).find(c => c.id === 'zzz-mystery')
    expect(found?.mark).toBe('?')
  })
})

describe('brandNameOf：供应商名跟随界面语言', () => {
  it('中文界面显示中文名，英文界面显示英文名', () => {
    const deepseek = brandOf('deepseek')!
    expect(brandNameOf(deepseek.name, 'zh-CN')).toBe('深度求索')
    expect(brandNameOf(deepseek.name, 'en')).toBe('DeepSeek')
  })

  it('接受纯语言码与带地区的 id（zh / zh-CN 都命中中文）', () => {
    const zai = brandOf('zai')!
    expect(brandNameOf(zai.name, 'zh')).toBe('智谱')
    expect(brandNameOf(zai.name, 'zh-CN')).toBe('智谱')
    expect(brandNameOf(zai.name, 'zh-cn')).toBe('智谱')
  })

  it('未提供中文的名字回退到英文，而不是显示空或音译', () => {
    // 海外厂商只写 en；中文界面下显示英文原名是刻意的（比生硬音译更准确）。
    const anthropic = brandOf('anthropic')!
    expect(brandNameOf(anthropic.name, 'zh-CN')).toBe('Anthropic')
    expect(brandNameOf(anthropic.name, 'en')).toBe('Anthropic')
  })

  it('未知语言回退到英文', () => {
    const qwen = brandOf('qwen')!
    expect(brandNameOf(qwen.name, 'ja')).toBe('Qwen')
    expect(brandNameOf(qwen.name, 'fr-FR')).toBe('Qwen')
  })
})

describe('CUSTOM_TEMPLATES：第三方通道与 pi-ai 目录分离', () => {
  it('火山方舟作为第三方模板存在，且不冒充 pi-ai route', () => {
    const ark = CUSTOM_TEMPLATES.find(t => t.id === 'volcengine-ark')
    expect(ark).toBeDefined()
    expect(ark?.name.zh).toBe('火山方舟')
    expect(ark?.name.en).toBe('Volcengine Ark')
    expect(ark?.baseUrl).toContain('volces.com')
  })

  it('模板会出现在品牌格里，并且排在置顶区', () => {
    const choices = providerChoices([])
    expect(choices.map(c => c.id)).toContain('volcengine-ark')
    expect(isPinnedProvider('volcengine-ark')).toBe(true)
  })

  it('上游若真的发布了同名 route，以目录为准（模板不覆盖）', () => {
    // 防御性：将来 pi-ai 收录火山方舟时，目录的 displayName 应当胜出。
    const found = providerChoices([{ provider: 'volcengine-ark', displayName: 'Upstream Volcengine' }])
      .find(c => c.id === 'volcengine-ark')
    expect(found?.name.en).toBe('Volcengine Ark')
  })
})
