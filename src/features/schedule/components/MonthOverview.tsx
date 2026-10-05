import { useTranslation } from 'react-i18next'
import type { DayColumn } from './DayGrid'
import type { ScheduleBooking, ScheduleResource } from '../api/schedule-api'

/**
 * L2.4 Month overview: a compact, read-only density grid — one small cell per
 * resource-day shaded by how loaded that day is (confirmed booked load vs the
 * resource's ceiling), with the same overload glyph the day grid uses. No add
 * or drag; this is the "how busy is everyone this month" surface.
 */
export function MonthOverview({
  resources,
  bookings,
  columns,
}: {
  resources: ScheduleResource[]
  bookings: ScheduleBooking[]
  columns: DayColumn[]
}) {
  const { t } = useTranslation()

  const byResource = new Map<string, ScheduleBooking[]>()
  for (const b of bookings) {
    const list = byResource.get(b.resourceId) ?? []
    list.push(b)
    byResource.set(b.resourceId, list)
  }

  return (
    <div className="month-overview" data-testid="month-overview" style={{ gridTemplateColumns: `minmax(160px, 220px) repeat(${columns.length}, 1fr)` }}>
      <div className="mo-corner" />
      {columns.map((col) => (
        <div key={col.isoDate} className="mo-colhead" title={col.isoDate}>
          {new Date(col.epoch).getUTCDate()}
        </div>
      ))}

      {resources.map((r) => {
        const rBookings = byResource.get(r.id) ?? []
        return (
          <div key={r.id} style={{ display: 'contents' }} data-testid={`mo-row-${r.id}`}>
            <div className="mo-sidebar">
              <span className="rname">
                {r.name}
                {r.nickname && <span className="rnick">{r.nickname}</span>}
              </span>
            </div>
            {columns.map((col) => {
              const dayStart = col.epoch
              const dayEnd = col.epoch + 86_400_000
              const confirmed = rBookings.filter((b) => b.state === 'confirmed' && b.start < dayEnd && b.end > dayStart)
              const load = confirmed.reduce((sum, b) => sum + (b.loadPct ?? 0), 0)
              const ceiling = r.ceilingPct ?? 100
              const warn = r.warnAtPct ?? ceiling
              let level: 'empty' | 'ok' | 'warn' | 'breach' = 'empty'
              if (load > ceiling) level = 'breach'
              else if (load > warn) level = 'warn'
              else if (load > 0) level = 'ok'
              const intensity = level === 'empty' ? 0 : Math.min(1, load / (ceiling || 100))
              return (
                <div
                  key={col.isoDate}
                  className={`mo-cell mo-${level}`}
                  data-testid={`mo-cell-${r.id}-${col.isoDate}`}
                  style={level === 'ok' ? { opacity: 0.35 + 0.65 * intensity } : undefined}
                  title={load > 0 ? t('schedule.month.loadTitle', { pct: Math.round(load) }) : ''}
                >
                  {level === 'breach' ? '⚠' : ''}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
