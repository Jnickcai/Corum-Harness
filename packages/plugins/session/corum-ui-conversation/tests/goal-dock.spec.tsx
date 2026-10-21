import { describe, expect, it } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { registerGoalDock, GoalDock } from '../src/client/goal/GoalDock.tsx'

function setup() {
  const slots = new SlotCore()
  const undeclare = slots.register({ name: 'root', children: {
    'conversation.input.dock': { kind: 'list', scope: 'session' },
  } }, () => null)
  return { slots, undeclare }
}
const source = { getSnapshot: () => ({}), subscribe: () => () => {} }
const success = async () => ({ ok: true as const })
function official(slots: SlotCore) {
  const inject = () => ({ hooks: { goalActivation: source }, onEdit: success, onPause: success, onResume: success, onClear: success })
  return { inject, dispose: slots.register({ name: 'conversation.input.dock', id: 'goal', order: 10, locale: 'goal' as never, inject }, () => null) }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve() }

describe('goal dock override', () => {
  it('waits for the official entry, shares its exact inject factory, and renders one goal cell', async () => {
    const { slots } = setup()
    const stop = registerGoalDock(slots)
    expect(slots.entriesOfSlot('conversation.input.dock')).toHaveLength(0)
    const base = official(slots)
    await flush()
    const entries = slots.entriesOfSlot('conversation.input.dock')
    expect(entries).toHaveLength(1)
    expect(entries[0]?.component).toBe(GoalDock)
    expect(entries[0]?.inject).toBe(base.inject)
    stop()
    expect(slots.entriesOfSlot('conversation.input.dock')[0]?.inject).toBe(base.inject)
    expect(slots.entries('conversation.input.dock')).toHaveLength(1)
  })
  it('follows official unload/reload without retaining stale actions or subscriptions', async () => {
    const { slots } = setup()
    const first = official(slots)
    const stop = registerGoalDock(slots)
    first.dispose()
    await flush()
    expect(slots.entries('conversation.input.dock')).toHaveLength(0)
    const next = official(slots)
    await flush()
    expect(slots.entriesOfSlot('conversation.input.dock')[0]?.inject).toBe(next.inject)
    stop()
    next.dispose()
    official(slots)
    await flush()
    expect(slots.entries('conversation.input.dock')).toHaveLength(1)
  })
  it('cleans up when the owning conversation slot collapses', async () => {
    const { slots, undeclare } = setup()
    official(slots)
    const stop = registerGoalDock(slots)
    undeclare()
    await flush()
    expect(slots.entries('conversation.input.dock')).toHaveLength(0)
    stop()
  })
})
