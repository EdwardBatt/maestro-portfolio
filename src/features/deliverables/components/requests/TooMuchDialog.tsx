import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../../components/Button'
import { useMyLoad } from '../../../team/api/team-api'
import { useSayTooMuch } from '../../api/requests-api'
import { errorText } from '../../lib/requests-text'
import { RequestDialog } from './RequestDialog'

/**
 * Too much (plan View 6, ADR-0113 d.3): the maker's week with this task in it — hours per day, the
 * total and % (the same figures as Your week, `useMyLoad`) — and an optional note. It goes to
 * whoever assigned the task, as a Needs-you item, a notification and an email; the task stays
 * assigned. The server sends the week it computes itself (`app.person_week_load`).
 */
export function TooMuchDialog({
  subTaskId,
  taskTitle,
  assignerName,
  meId,
  onClose,
  testId = 'too-much',
}: {
  subTaskId: string
  taskTitle: string
  assignerName: string | null
  meId: string | null
  onClose: () => void
  testId?: string
}) {
  const { t, i18n } = useTranslation()
  const load = useMyLoad(meId)
  const say = useSayTooMuch()
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const w = load.data
  const dayName = (date: string) =>
    new Intl.DateTimeFormat(i18n.language.startsWith('ar') ? 'ar' : 'en-GB', { weekday: 'short' }).format(new Date(`${date}T12:00:00`))

  function send() {
    setError(null)
    say.mutate({ subTaskId, note }, { onSuccess: onClose, onError: (e) => setError(errorText(e, t('requests.failed'))) })
  }

  return (
    <RequestDialog
      testId={testId}
      title={t('requests.tooMuch.title')}
      subtitle={taskTitle}
      told={assignerName}
      error={error}
      onClose={onClose}
      actions={
        <>
          <Button variant="primary" busy={say.isPending} disabled={say.isPending} onClick={send} data-testid={`${testId}-send`}>
            {t('requests.tooMuch.send')}
          </Button>
          <Button variant="secondary" onClick={onClose} data-testid={`${testId}-cancel`}>{t('common.cancel')}</Button>
        </>
      }
    >
      {w?.hasResource ? (
        <div className="rq-week" data-testid={`${testId}-week`}>
          <p className="rq-week-total" data-testid={`${testId}-week-total`}>
            {t('requests.tooMuch.week', { hours: w.bookedHours, pct: w.utilPct })}
          </p>
          <ul className="rq-week-days">
            {w.days
              .filter((d) => d.working || d.hours > 0)
              .map((d) => (
                <li key={d.date} data-testid={`${testId}-day-${d.date}`}>
                  <span>{dayName(d.date)}</span> <span>{t('needsYou.week.hours', { hours: d.hours })}</span>
                </li>
              ))}
          </ul>
        </div>
      ) : (
        <p className="muted" data-testid={`${testId}-no-week`}>{t('requests.tooMuch.noWeek')}</p>
      )}
      <label>
        {t('requests.tooMuch.note')}
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} data-testid={`${testId}-note`} dir="auto" />
      </label>
    </RequestDialog>
  )
}
