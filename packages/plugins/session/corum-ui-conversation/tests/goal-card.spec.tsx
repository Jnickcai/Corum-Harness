import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GoalProjection } from '@deepseek-ai/dsh-goal/client'
import { GoalCard } from '../src/client/goal/GoalCard.tsx'
import { en, zh } from '../src/client/locales.ts'

const projection: GoalProjection = {
  goal: { id: 'test-goal' as GoalProjection['goal']['id'], revision: 1,
    objective: '检查目标卡片完整信息与状态', phase: 'active', maxGoalRounds: 8 },
  roundsStarted: 3, createdAt: 1792500000000, updatedAt: 1792500060000,
}
const actions = {
  onEdit: async () => ({ ok: true as const }), onPause: async () => ({ ok: true as const }),
  onResume: async () => ({ ok: true as const }), onClear: async () => ({ ok: true as const }),
}
function render(value = projection, activation: 'armed' | 'disarmed' | null = 'armed', english = false) {
  const dictionary = english ? en : zh
  return renderToStaticMarkup(<GoalCard projection={value} activation={activation ?? undefined} {...actions}
    t={(key, params) => Object.entries(params ?? {}).reduce((text, [name, replacement]) =>
      text.replace(`{${name}}`, String(replacement)), dictionary[key as keyof typeof dictionary] ?? key)} />).replace(/<!--.*?-->/g, '')
}

describe('goal card', () => {
  it('shows the whole projection, including rounds, timestamps and activation', () => {
    const html = render()
    for (const text of ['检查目标卡片完整信息与状态', '3 / 8', '创建', '更新', '自动继续已启用',
      new Date(projection.createdAt).toISOString(), new Date(projection.updatedAt).toISOString()]) {
      expect(html).toContain(text)
    }
    expect(html).toContain('暂停目标')
  })
  it('keeps completed goals visible and offers only dismissal', () => {
    const html = render({ ...projection, goal: { ...projection.goal, phase: 'complete' } })
    expect(html).toContain('已完成的目标')
    expect(html).toContain('关闭已完成目标')
    for (const label of ['编辑目标', '暂停目标', '恢复目标']) expect(html).not.toContain(label)
  })
  it('shows blocked reason code and message without hovering', () => {
    const html = render({ ...projection, goal: { ...projection.goal, phase: 'blocked',
      blockedReason: { code: 'round-budget-exhausted', message: '已达到目标轮次上限' } } })
    expect(html).toContain('round-budget-exhausted')
    expect(html).toContain('已达到目标轮次上限')
    expect(html).not.toContain('恢复目标')
  })
  it('offers resume for paused or disarmed goals, but not while activation is unknown', () => {
    expect(render(projection, 'disarmed')).toContain('恢复目标')
    expect(render({ ...projection, goal: { ...projection.goal, phase: 'paused' } })).toContain('恢复目标')
    const loading = render(projection, null)
    expect(loading).toContain('同步自动继续状态')
    expect(loading).not.toContain('恢复目标')
    expect(loading).not.toContain('暂停目标')
  })
  it('has English copy for the same information', () => {
    const html = render(projection, 'armed', true)
    for (const text of ['Ongoing goal', 'Auto-continue on', 'Created', 'Updated', '3 / 8']) expect(html).toContain(text)
  })
})
