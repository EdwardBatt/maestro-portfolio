import { useTranslation } from 'react-i18next'
import { Panel } from '../../components/Panel'
import { useStrandedBookings } from './api/leave-api'
import { Button } from '../../components/Button'
import { dayFormatter } from '../../lib/time/iraq'

/**
 * What now sits on a closed day (ADR-0079 d.6).
 *
 * Declaring a closure moves no booking (d.5) — Eid is confirmed weeks after the calendar filled
 * up, and moving work automatically would shift deadlines under people who made commitments.
 * "Nothing moves" without a list is the same silent failure in a different coat, so this is the
 * other half of that decision: each booking on a closed day, with its owner, and a link to the
 * week on the schedule where the authorised person drags it (the drop warns exactly as I41.5
 * made it warn). Presentation only.
 */
export function StrandedWorkPanel({ closureId, closureName, onDismiss }: { closureId: string; closureName: string; onDismiss: () => void }) {
  const { t, i18n } = useTranslation()
  const stranded = useStrandedBookings(closureId)
  const fmt = dayFormatter(i18n.language === 'ar' ? 'ar' : 'en')
  const day = (iso: string) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : fmt.format(d)
  }
  const rows = stranded.data ?? []

  return (
    <Panel
      title={t('leave.closures.stranded.title', { name: closureName })}
      headerEnd={
        <Button variant="secondary" onClick={onDismiss} data-testid="stranded-dismiss">
          {t('common.gotIt')}
        </Button>
      }
      testId="stranded-panel"
    >
      {stranded.isLoading ? (
        <p className="muted">…</p>
      ) : stranded.isError ? (
        <p className="form-error" data-testid="stranded-failed">{t('leave.closures.stranded.loadFailed')}</p>
      ) : rows.length === 0 ? (
        <p className="muted" data-testid="stranded-empty">{t('leave.closures.stranded.none')}</p>
      ) : (
        <>
          <p className="muted">{t('leave.closures.stranded.intro', { count: rows.length })}</p>
          <table className="data-table" data-testid="stranded-table">
            <thead>
              <tr>
                <th>{t('leave.person')}</th>
                <th>{t('leave.closures.stranded.work')}</th>
                <th>{t('leave.closures.stranded.owner')}</th>
                <th>{t('leave.from')}</th>
                <th>{t('leave.to')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.bookingId} data-testid={`stranded-${b.bookingId}`}>
                  <td>{b.resourceName}</td>
                  <td>{[b.deliverableName, b.title].filter(Boolean).join(' · ') || '—'}</td>
                  <td>{b.ownerName ?? '—'}</td>
                  <td>{day(b.startsAt)}</td>
                  <td>{day(b.endsAt)}</td>
                  <td className="row-actions">
                    <Button
                      variant="link"
                      to={`/schedule?on=${b.startsAt.slice(0, 10)}&who=${encodeURIComponent(b.resourceName)}`}
                      data-testid={`stranded-open-${b.bookingId}`}
                    >
                      {t('leave.closures.stranded.open')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Panel>
  )
}
