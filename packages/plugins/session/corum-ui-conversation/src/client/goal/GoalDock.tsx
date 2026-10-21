import type { Context } from '@deepseek-ai/cordis'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime, SlotCore, StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type { GoalActivation, GoalRef } from '@deepseek-ai/dsh-goal/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '../contract/slots.ts'
import { NS } from '../locales.ts'
import { GoalCard, type GoalActions } from './GoalCard.tsx'

/** Local capability face of the official goal entry; retain its ordered live activation source and CAS actions. */
interface GoalInjected extends GoalActions {
  hooks: { goalActivation: HostObservable<Partial<GoalRef> & { activation?: GoalActivation }> }
}
type GoalDockProps = PropsRuntime<'conversation.input.dock'> & InjectFace<GoalInjected> & PropsLocale<'conversation'>

export function GoalDock({ useProjection, useGoalActivation, ...props }: GoalDockProps) {
  const projection = useProjection('goal')
  const goal = projection?.goal
  const activation = useGoalActivation(next => next.id === goal?.id && next.revision === goal?.revision ? next.activation : undefined)
  return projection ? <GoalCard key={projection.goal.id} projection={projection} activation={activation} {...props} /> : null
}

/** Shadow only the official goal cell through the public slot API, following its load/unload lifecycle. */
export function registerGoalDock(slots: Pick<SlotCore, 'entries' | 'register' | 'subscribe'>): () => void {
  const name = 'conversation.input.dock'
  let source: StoredEntry | undefined
  let dispose: (() => void) | undefined
  const reconcile = () => {
    const next = slots.entries(name).find(entry => entry.options.id === 'goal' && entry.locale === 'goal')
    if (next === source) return
    dispose?.()
    dispose = undefined
    source = next
    if (!next?.inject) return
    // StoredEntry erases the business face; the official goal contract supplies these capabilities.
    const inject = next.inject as unknown as (sessionId: SessionId) => GoalInjected
    dispose = slots.register({ name, id: 'goal', order: 10, priority: -10, locale: NS, inject }, GoalDock)
  }
  const unsubscribe = slots.subscribe(name, reconcile)
  reconcile()
  return () => { unsubscribe(); dispose?.() }
}

export const goalDockEntry = {
  name: 'conversation-goal-dock',
  inject: ['slots'],
  apply(ctx: Context): void { ctx.effect(() => registerGoalDock(ctx.slots)) },
}
