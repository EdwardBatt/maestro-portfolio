import { useTranslation } from 'react-i18next'
import {
  useAttendanceHeartbeat,
  useAttendanceProfile,
  useEndDay,
  useMyAttendanceToday,
  useMyDeviation,
  useStartDay,
} from './api/attendance-api'
import { Button } from '../../components/Button'

/**
 * Attendance check-in/out widget (ADR-0031, I9). Shown on the My Work home. Auto-checks-in on
 * mount (heartbeat), shows the person's check-in vs the expected start, offers explicit Start
 * day / End day, and surfaces today's deviation flags (late / short / auto-closed). Suppressed
 * days (weekend / holiday / leave) render as a neutral "day off".
 */

function hhmm(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function AttendanceWidget({ userId }: { userId: string | null }) {
  const { t } = useTranslation()
  useAttendanceHeartbeat(userId)
  const today = useMyAttendanceToday(userId)
  const profile = useAttendanceProfile()
  const dev = useMyDeviation(userId)
  const start = useStartDay()
  const end = useEndDay()

  if (!userId) return null

  const day = today.data
  const d = dev.data
  const busy = start.isPending || end.isPending
  const checkedIn = Boolean(day?.checkedInAt)
  const checkedOut = Boolean(day?.checkedOutAt)
  const suppressed = Boolean(d?.suppressed)
  const hours = day?.workedMinutes != null ? (day.workedMinutes / 60).toFixed(1) : null
  const expected = profile.data?.expectedCheckIn ? profile.data.expectedCheckIn.slice(0, 5) : null

  return (
    <div className="attendance-widget" data-testid="attendance-widget">
      <div className="attendance-main">
        <span className="attendance-label">{t('attendance.today')}</span>
        <span className="attendance-sep" aria-hidden="true"> · </span>
        {suppressed ? (
          <span className="muted" data-testid="attendance-status">{t('attendance.dayOff')}</span>
        ) : checkedIn ? (
          <span data-testid="attendance-status">
            {t('attendance.checkedInAt', { time: hhmm(day!.checkedInAt) })}
            {expected && <span className="muted"> · {t('attendance.expected', { time: expected })}</span>}
            {checkedOut && (
              <> · {t('attendance.checkedOutAt', { time: hhmm(day!.checkedOutAt) })}{hours ? ` (${hours}h)` : ''}</>
            )}
          </span>
        ) : (
          <span className="muted" data-testid="attendance-status">{t('attendance.notStarted')}</span>
        )}

        {!suppressed && (
          <span className="attendance-flags">
            {d?.late && <span className="badge badge-warn" data-testid="attendance-late">{t('attendance.flag.late')}</span>}
            {d?.short && <span className="badge badge-warn" data-testid="attendance-short">{t('attendance.flag.short')}</span>}
            {day?.checkOutSource === 'inferred' && (
              <span className="badge" data-testid="attendance-inferred">{t('attendance.flag.inferred')}</span>
            )}
          </span>
        )}
      </div>

      {!suppressed && (
        <div className="attendance-actions">
          {!checkedIn && (
            <Button variant="primary" disabled={busy} onClick={() => start.mutate()} data-testid="attendance-start">
              {t('attendance.startDay')}
            </Button>
          )}
          {checkedIn && !checkedOut && (
            <Button variant="primary" disabled={busy} onClick={() => end.mutate()} data-testid="attendance-end">
              {t('attendance.endDay')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
