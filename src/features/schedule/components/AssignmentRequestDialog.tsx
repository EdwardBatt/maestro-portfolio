import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { Modal } from '../../../components/Modal'
import { useAuth } from '../../../app/auth-context'
import { loadPctToHours } from '../../../lib/capacity/day-hours.ts'
import { useNavigate } from 'react-router'
import { useWithdrawAssignmentRequest } from '../../../lib/assignment-requests/api'
import { requestHoursPerDay, requestSpan, type AssignmentRequest } from '../../../lib/assignment-requests/requests'
import { useWriteScope } from '../hooks/use-write-scope.ts'
import type { ScheduleBooking, ScheduleResource } from '../api/schedule-api'
import { formatCalendarDay } from '../../../lib/time/iraq'

const DAY = 86_400_000

/**
 * ADR-0087 d.11: the request, opened from its chip on the grid.
 *
 * The approver sees what is being asked — who, for what, on which days — and, per d.10, the number
 * that decides it: what the person already has on each of those days. A pending request holds no
 * capacity, so that figure is the existing CONFIRMED load only, read from the same bookings the
 * grid draws. ADR-0139: the answer is the lead's answer window (Book / Offer another day / Say no), opened by
 * `/schedule?ask=<id>` as the bell and My work do — one-click approve/refuse cannot answer a "the lead
 * decides" ask or a no without its reason. The requester gets Withdraw. Whether the viewer
 * may decide is MIRRORED here (bookings:create + reach over the calendar) only to choose which
 * buttons to offer — the server refuses anyone the mirror got wrong.
 */
export function AssignmentRequestDialog({
  request,
  resources,
  bookings,
  onClose,
}: {
  request: AssignmentRequest
  resources: ScheduleResource[]
  bookings: ScheduleBooking[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { session } = useAuth()
  const myId = session?.user.id ?? null
  const { can, ready, inScope } = useWriteScope()
  const navigate = useNavigate()
  const withdraw = useWithdrawAssignmentRequest()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const resource = resources.find((r) => r.id === request.resourceId) ?? null
  const isRequester = myId != null && myId === request.requestedBy
  // The decide test, mirrored: whoever could have made the booking directly (d.5). Leans ALLOW
  // while permissions load, as every gate on this page does.
  const mayDecide = !isRequester && (!ready || (can('bookings:create') && (!resource || inScope(resource))))

  const span = requestSpan(request)
  const perDay = requestHoursPerDay(request)
  const fmtDay = (epoch: number) => formatCalendarDay(new Date(epoch).toISOString().slice(0, 10))

  /** Each requested day with the hours already CONFIRMED on that person — the cost in view (d.10). */
  const days = useMemo(() => {
    if (!span) return []
    const first = Math.floor(span.start / DAY) * DAY
    const out: { epoch: number; bookedHours: number }[] = []
    for (let epoch = first; epoch < span.end && out.length < 60; epoch += DAY) {
      const dayEnd = epoch + DAY
      const booked = bookings
        .filter((b) => b.resourceId === request.resourceId && b.state === 'confirmed' && b.start < dayEnd && b.end > epoch)
        .reduce((sum, b) => sum + (b.loadPct != null ? loadPctToHours(b.loadPct) : (b.end - b.start) / 3_600_000), 0)
      out.push({ epoch, bookedHours: Math.round(booked * 10) / 10 })
    }
    return out
  }, [span, bookings, request.resourceId])

  async function onWithdraw() {
    setError(null)
    try {
      await withdraw.mutateAsync(request.id)
      setDone(t('schedule.request.withdrawn'))
    } catch (err) {
      setError((err as { message?: string }).message ?? t('schedule.request.failed'))
    }
  }

  const busy = withdraw.isPending

  return (
    // I48.6: shared Modal behaviour (backdrop/Esc/focus); the `.dialog` card is kept.
    <Modal onClose={onClose} card={false}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={t('schedule.request.title')}
        data-testid="request-dialog">
        <h2>{t('schedule.request.title')}</h2>
        <p data-testid="request-summary">
          {t('schedule.request.summary', {
            requester: request.requesterName ?? '',
            name: resource?.name ?? request.resourceName ?? '',
            task: request.taskTitle ?? request.title,
          })}
          {request.campaignName && <span className="muted"> · {request.campaignName}</span>}
        </p>
        <p className="muted" data-testid="request-awaiting">
          {t('schedule.request.awaiting', { department: request.departmentName ?? '' })}
        </p>

        {days.length > 0 && (
          <dl className="task-meta" data-testid="request-days">
            {days.map((d) => (
              <div key={d.epoch}>
                <dt>{fmtDay(d.epoch)}</dt>
                <dd>
                  {perDay != null && t('schedule.request.asksHours', { hours: perDay })}
                  {perDay != null && ' · '}
                  {t('schedule.request.alreadyBooked', { hours: d.bookedHours })}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {done ? (
          <p className="notice notice-ok" role="status" data-testid="request-done">{done}</p>
        ) : (
          <>
            {error && <p className="form-error" role="alert" data-testid="request-error">{error}</p>}
          </>
        )}

        <div className="dialog-actions">
          {!done && isRequester && (
            <Button type="button" variant="danger" size="sm" busy={withdraw.isPending} disabled={busy}
              onClick={() => void onWithdraw()} data-testid="request-withdraw">
              {t('schedule.request.withdraw')}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose} data-testid="request-close">
            {t('schedule.request.close')}
          </Button>
          {!done && mayDecide && (
            <Button type="button" variant="primary" disabled={busy}
              onClick={() => { onClose(); navigate(`/schedule?ask=${request.id}`) }} data-testid="request-answer">
              {t('myWork.asks.answer')}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
