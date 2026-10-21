import { useRef, useState } from 'react'
import { Check, Pause, Pencil, Play, Target, X } from 'lucide-react'
import type { GoalActivation, GoalProjection } from '@deepseek-ai/dsh-goal/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './GoalCard.module.css'

export type GoalActionResult = { ok: true } | { ok: false; error: { code: string; message: string } }
export interface GoalActions {
  onEdit: (objective: string) => Promise<GoalActionResult>
  onPause: () => Promise<GoalActionResult>
  onResume: () => Promise<GoalActionResult>
  onClear: () => Promise<GoalActionResult>
}
export interface GoalCardProps extends GoalActions, PropsLocale<'conversation'> {
  projection: GoalProjection
  activation: GoalActivation | undefined
}

/** Present the whole durable projection; live activation and CAS verbs stay with ui-goal. */
export function GoalCard({ projection, activation, onEdit, onPause, onResume, onClear, t }: GoalCardProps) {
  const { goal, roundsStarted, createdAt, updatedAt } = projection
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(goal.objective)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cleared, setCleared] = useState(false)
  const busy = useRef(false)
  const complete = goal.phase === 'complete'
  const phase = goal.phase === 'active' && activation === 'disarmed' ? 'inactive' : goal.phase
  const activationKey = goal.phase !== 'active' || activation === 'disarmed' ? 'off'
    : activation === 'armed' ? 'on' : 'loading'

  async function run(action: () => Promise<GoalActionResult>, success?: () => void) {
    if (busy.current) return
    busy.current = true
    setPending(true)
    setError(null)
    try {
      const result = await action()
      if (result.ok) success?.()
      else setError(`${result.error.message} (${result.error.code})`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  const save = () => { if (draft.trim()) void run(() => onEdit(draft.trim()), () => setEditing(false)) }
  if (cleared) return null

  return <section className={css.root} data-goal-bar data-phase={goal.phase} aria-label={t('goal.title')}>
    <div className={css.header}>
      <Target size={15} aria-hidden />
      <strong>{t(`goal.phase.${phase}`)}</strong>
      <span className={css.activation}>{t(`goal.activation.${activationKey}`)}</span>
      <div className={css.actions}>
        {editing && !complete ? <>
          <button type="button" title={t('goal.save')} aria-label={t('goal.save')} disabled={pending || !draft.trim()} onClick={save}><Check size={15} /></button>
          <button type="button" title={t('goal.cancel')} aria-label={t('goal.cancel')} disabled={pending} onClick={() => setEditing(false)}><X size={15} /></button>
        </> : <>
          {!complete && goal.phase === 'active' && activation === 'armed' &&
            <button type="button" title={t('goal.pause')} aria-label={t('goal.pause')} disabled={pending} onClick={() => void run(onPause)}><Pause size={15} /></button>}
          {(goal.phase === 'paused' || goal.phase === 'active' && activation === 'disarmed') &&
            <button type="button" title={t('goal.resume')} aria-label={t('goal.resume')} disabled={pending} onClick={() => void run(onResume)}><Play size={15} /></button>}
          {!complete && <button type="button" title={t('goal.edit')} aria-label={t('goal.edit')} disabled={pending}
            onClick={() => { setDraft(goal.objective); setEditing(true); setError(null) }}><Pencil size={15} /></button>}
          <button type="button" title={t(complete ? 'goal.dismiss' : 'goal.clear')} aria-label={t(complete ? 'goal.dismiss' : 'goal.clear')}
            disabled={pending} onClick={() => void run(onClear, () => setCleared(true))}><X size={15} /></button>
        </>}
      </div>
    </div>
    {editing && !complete ? <textarea className={css.input} aria-label={t('goal.objective')} autoFocus value={draft} disabled={pending}
      onChange={event => setDraft(event.target.value)} onKeyDown={event => {
        if (event.key === 'Escape') setEditing(false)
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); save() }
      }} /> : <p className={css.objective}>{goal.objective}</p>}
    <div className={css.metadata}>
      <span>{t('goal.rounds')} {roundsStarted} / {goal.maxGoalRounds}</span>
      <span>{t('goal.created')} <time dateTime={new Date(createdAt).toISOString()}>{new Date(createdAt).toLocaleString()}</time></span>
      <span>{t('goal.updated')} <time dateTime={new Date(updatedAt).toISOString()}>{new Date(updatedAt).toLocaleString()}</time></span>
    </div>
    {goal.phase === 'blocked' && goal.blockedReason && <p className={css.blocked}>
      <code>{goal.blockedReason.code}</code><span>{goal.blockedReason.message}</span>
    </p>}
    {error && <p className={css.error} role="alert">{error}</p>}
  </section>
}
