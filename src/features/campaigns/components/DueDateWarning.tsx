import { useTranslation } from 'react-i18next'
import { isAfterPhaseEnd, type DueDateArithmetic } from '../../../lib/campaigns/go-live-dates'

/**
 * The due-date warning (I41.8, ADR-0075 d.9) — the arithmetic, stated.
 *
 * Not *"this is too tight"* but the numbers: how many working days the date leaves before go-live
 * against how many the tenant's rule wants, and — when the deliverable exists and has tasks — how
 * many hours are outstanding against how many the days before it can hold. Then which of three
 * things is true: **tight** (fits with nothing spare — proceed knowingly), **impossible** (does
 * not fit — a conversation with the client, said in those words) or **after go-live** (the client
 * must agree to receive the work after they have used it — ADR-0093). None refuses; every one is
 * recorded when the person proceeds. Presentation only: it renders what `classifyDueDate` computed.
 */
export function DueDateWarning({ arithmetic, testId }: { arithmetic: DueDateArithmetic | null; testId: string }) {
  const { t } = useTranslation()
  if (!arithmetic || arithmetic.severity === 'ok') return null

  // ADR-0093: a date after go-live WARNS like the others — it says the client's agreement is
  // needed, and proceeding is recorded. Nothing here refuses.
  if (arithmetic.severity === 'after_go_live') {
    return (
      <p className="cell-warn due-warning" role="status" data-testid={testId} data-severity="after_go_live">
        <strong>{t('campaigns.dueDate.afterGoLiveHead')}</strong> {t('campaigns.dueDate.afterGoLive')}
      </p>
    )
  }

  const days = t('campaigns.dueDate.days', { left: arithmetic.workingDaysToGoLive, required: arithmetic.requiredDays })
  const hours =
    arithmetic.outstandingHours != null && arithmetic.capacityHours != null
      ? ' ' + t('campaigns.dueDate.hours', { outstanding: arithmetic.outstandingHours, capacity: arithmetic.capacityHours })
      : ''
  return (
    <p className="cell-warn due-warning" role="status" data-testid={testId} data-severity={arithmetic.severity}>
      <strong>{t(`campaigns.dueDate.${arithmetic.severity}`)}</strong> {days}
      {hours}{' '}
      {t(arithmetic.severity === 'impossible' ? 'campaigns.dueDate.resolveWithClient' : 'campaigns.dueDate.proceedKnowingly')}
    </p>
  )
}

/**
 * ADR-0096 d.7: a due date after its PHASE ends warns the same way — stated, recorded, never
 * refused. Early is not a problem the team has, so a date before the phase starts says nothing.
 */
export function PhaseEndWarning({
  dueDay, phase, testId,
}: { dueDay: string; phase: { name: string; endsOn: string } | null; testId: string }) {
  const { t } = useTranslation()
  if (!phase || !isAfterPhaseEnd(dueDay, phase)) return null
  return (
    <p className="cell-warn due-warning" role="status" data-testid={testId} data-severity="after_phase_end">
      <strong>{t('campaigns.dueDate.afterPhaseEndHead')}</strong>{' '}
      {t('campaigns.dueDate.afterPhaseEnd', { phase: phase.name, date: phase.endsOn })}
    </p>
  )
}

