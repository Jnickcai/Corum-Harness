import { describe, expect, it } from 'vitest'
import { asContext, asStats, asTokens } from '../src/session-facts.ts'

/**
 * 这些断言钉的是「官方投影形状 → 公开契约」的映射。它比端到端更值钱的地方在于：
 * 端到端只能证明「有值」，映射测得住「字段对不对、缺字段怎么降级」。
 */
describe('tokenUsage 投影 → SessionFactsTokens', () => {
  it('四个桶逐个搬运', () => {
    expect(asTokens({ uncachedInputTokens: 1200, outputTokens: 300, cacheReadTokens: 4000, cacheWriteTokens: 50 }))
      .toEqual({ uncachedInputTokens: 1200, outputTokens: 300, cacheReadTokens: 4000, cacheWriteTokens: 50 })
  })

  it('缺缓存桶按 0 兜底（老版本投影可能没这两键）', () => {
    expect(asTokens({ uncachedInputTokens: 1, outputTokens: 2 }))
      .toEqual({ uncachedInputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 })
  })

  it('核心字段缺失/类型不对 ⇒ undefined（不编 0）', () => {
    expect(asTokens(undefined)).toBeUndefined()
    expect(asTokens({ outputTokens: 2 })).toBeUndefined()
    expect(asTokens({ uncachedInputTokens: '1', outputTokens: 2 })).toBeUndefined()
  })
})

describe('contextPressure 投影 → SessionFactsContext', () => {
  it('算 usedRatio（pressureTokens / contextWindow）', () => {
    expect(asContext({ pressureTokens: 500, contextWindow: 1000 })).toEqual({ pressureTokens: 500, contextWindow: 1000, usedRatio: 0.5 })
  })

  it('ratio 封顶 1（provider 上报可能超过窗口）', () => {
    expect(asContext({ pressureTokens: 1500, contextWindow: 1000 })?.usedRatio).toBe(1)
  })

  it('没有窗口就不给 ratio；空对象 ⇒ undefined', () => {
    expect(asContext({ pressureTokens: 10 })).toEqual({ pressureTokens: 10 })
    expect(asContext({})).toBeUndefined()
  })
})

describe('sessionStats 投影 → SessionFactsStats', () => {
  it('turns/steps 必需，耗时字段可选', () => {
    expect(asStats({ turns: 3, steps: 7, llmMs: 120, toolMs: 30, ttftMs: 20, decodeMs: 90, decodeTokens: 800 }))
      .toEqual({ turns: 3, steps: 7, llmMs: 120, toolMs: 30, ttftMs: 20, decodeMs: 90, decodeTokens: 800 })
  })

  it('缺 turns ⇒ undefined（不让界面显示假的 0 轮）', () => {
    expect(asStats({ steps: 7 })).toBeUndefined()
    expect(asStats(null)).toBeUndefined()
  })
})
