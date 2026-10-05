import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookingsTable } from './BookingsTable'
import { ProjectTasks } from './ProjectTasks'
import { useBookingsList, type BookingsRange } from './api/bookings-api'
import { defaultRangeDates } from './lib/range'
import { DateField } from '../../components/DateField'

/**
 * Task-list surface (L3.1 + L3.3 + L3.4). Two tabs — a sortable/groupable
 * bookings table with CSV export, and a per-project rollup. Gated on
 * bookings_table:view. Reads are tenant-wide; nothing here writes.
 */
export function BookingsPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'all' | 'project'>('all')
  const [from, setFrom] = useState(defaultRangeDates().start)
  const [to, setTo] = useState(defaultRangeDates().end)

  const range = useMemo<BookingsRange>(
    () => ({ start: `${from}T00:00:00`, end: `${to}T23:59:59` }),
    [from, to],
  )
  const bookings = useBookingsList(range)

  return (
    <section data-testid="surface-bookings">
      <header className="schedule-bar">
        <h1>{t('bookings.title')}</h1>
      </header>

      <div className="tab-row" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'tab on' : 'tab'}
          onClick={() => setTab('all')} data-testid="tab-all">{t('bookings.tabAll')}</button>
        <button type="button" role="tab" aria-selected={tab === 'project'} className={tab === 'project' ? 'tab on' : 'tab'}
          onClick={() => setTab('project')} data-testid="tab-project">{t('bookings.tabProject')}</button>
      </div>

      {tab === 'all' ? (
        <>
          <div className="range-row">
            <label>{t('bookings.from')}<DateField value={from} onChange={(v) => setFrom(v)} data-testid="range-from" /></label>
            <label>{t('bookings.to')}<DateField value={to} onChange={(v) => setTo(v)} data-testid="range-to" /></label>
          </div>
          {bookings.isLoading ? (
            <p data-testid="bookings-loading">…</p>
          ) : bookings.isError ? (
            <p className="form-error">{t('bookings.loadFailed')}</p>
          ) : (
            <BookingsTable rows={bookings.data ?? []} csvName={`maestro-bookings_${from}_${to}`} />
          )}
        </>
      ) : (
        <ProjectTasks />
      )}
    </section>
  )
}
