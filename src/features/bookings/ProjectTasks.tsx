import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBookingCampaigns, useProjectBookings, type BookingListRow } from './api/bookings-api'

interface TaskRollup {
  task: string
  bookings: number
  hours: number
}

/** Group a project's bookings by task label → count + summed hours. */
function rollup(rows: BookingListRow[], adhoc: string): TaskRollup[] {
  const byTask = new Map<string, TaskRollup>()
  for (const r of rows) {
    const key = r.task || adhoc
    const acc = byTask.get(key) ?? { task: key, bookings: 0, hours: 0 }
    acc.bookings += 1
    acc.hours += r.hours
    byTask.set(key, acc)
  }
  return [...byTask.values()].sort((a, b) => b.hours - a.hours)
}

/**
 * Per-project task list (L3.3): pick a project → its tasks (deliverables, or
 * the ad-hoc free-text task) with their booking count and total booked hours.
 * Degrades cleanly: with no campaigns (Module 1 is ad-hoc until V1.7) it shows
 * a short explanation instead of an empty control.
 */
export function ProjectTasks() {
  const { t } = useTranslation()
  const campaigns = useBookingCampaigns()
  const [campaignId, setCampaignId] = useState<string>('')
  const bookings = useProjectBookings(campaignId || null)

  const adhoc = t('bookings.adhoc')
  const rows = useMemo(() => rollup(bookings.data ?? [], adhoc), [bookings.data, adhoc])
  const totalHours = rows.reduce((s, r) => s + r.hours, 0)

  if (campaigns.isLoading) return <p data-testid="project-loading">…</p>
  if (campaigns.isError) return <p className="form-error">{t('bookings.loadFailed')}</p>

  if ((campaigns.data ?? []).length === 0) {
    return <p className="muted" data-testid="project-none">{t('bookings.noProjects')}</p>
  }

  return (
    <div data-testid="project-tasks">
      <div className="range-row">
        <label>
          {t('bookings.project')}
          <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} data-testid="project-select">
            <option value="">{t('bookings.selectProject')}</option>
            {(campaigns.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      </div>

      {!campaignId ? (
        <p className="muted" data-testid="project-prompt">{t('bookings.pickProjectPrompt')}</p>
      ) : bookings.isLoading ? (
        <p data-testid="project-bookings-loading">…</p>
      ) : rows.length === 0 ? (
        <p className="muted" data-testid="project-empty">{t('bookings.projectEmpty')}</p>
      ) : (
        <table className="data-table" data-testid="project-table">
          <thead>
            <tr>
              <th>{t('bookings.cols.task')}</th>
              <th>{t('bookings.cols.bookings')}</th>
              <th>{t('bookings.cols.hours')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.task} data-testid={`task-row-${r.task}`}>
                <td>{r.task}</td>
                <td>{r.bookings}</td>
                <td>{r.hours.toFixed(1)}</td>
              </tr>
            ))}
            <tr className="group-row">
              <td>{t('bookings.total')}</td>
              <td>{rows.reduce((s, r) => s + r.bookings, 0)}</td>
              <td>{totalHours.toFixed(1)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  )
}
