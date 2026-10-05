import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getGroupedRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type GroupingState,
  type SortingState,
} from '@tanstack/react-table'
import type { BookingListRow } from './api/bookings-api'
import { downloadCsv } from './lib/csv'
import { Button } from '../../components/Button'

type GroupMode = 'none' | 'project' | 'resource'

/**
 * The shared bookings/task table (L3.1–L3.3). Headless TanStack Table: client
 * sort, global filter, optional group-by (project or resource) with summed
 * hours, and CSV export of the currently filtered rows (L3.4 — the first slice
 * of the data-export story, 0.3.3). Presentational: rows come from a hook.
 */
export function BookingsTable({
  rows,
  csvName,
  enableGrouping = true,
}: {
  rows: BookingListRow[]
  csvName: string
  enableGrouping?: boolean
}) {
  const { t } = useTranslation()
  const [sorting, setSorting] = useState<SortingState>([{ id: 'date', desc: true }])
  const [grouping, setGrouping] = useState<GroupingState>([])
  const [globalFilter, setGlobalFilter] = useState('')

  const adhoc = t('bookings.adhoc')
  const dash = '—'

  // TanStack ColumnDef is invariant in its value type, so a mixed-value column
  // list must be typed `any` here (matches the library's own columns prop type).
  const columns = useMemo<ColumnDef<BookingListRow, any>[]>(() => {
    const col = createColumnHelper<BookingListRow>()
    return [
      col.accessor('date', { header: () => t('bookings.cols.date'), cell: (c) => c.getValue() }),
      col.accessor('resourceName', {
        id: 'resource',
        header: () => t('bookings.cols.resource'),
        cell: (c) => {
          const r = c.row.original
          const label = r.resourceNickname ? `${r.resourceName} · ${r.resourceNickname}` : r.resourceName
          return r.resourceActive ? label : (
            <span>
              {label}{' '}
              <span className="flag-inactive" title={t('bookings.inactiveResourceHint')} data-testid={`inactive-${r.id}`}>
                {t('bookings.inactiveResource')}
              </span>
            </span>
          )
        },
      }),
      col.accessor('task', { header: () => t('bookings.cols.task'), cell: (c) => c.getValue() || dash }),
      col.accessor((r) => r.project ?? adhoc, {
        id: 'project',
        header: () => t('bookings.cols.project'),
        cell: (c) => c.getValue() as string,
      }),
      col.accessor('hours', {
        header: () => t('bookings.cols.hours'),
        aggregationFn: 'sum',
        cell: (c) => (c.getValue() as number).toFixed(1),
        aggregatedCell: (c) => (c.getValue() as number).toFixed(1),
      }),
      col.accessor('state', {
        header: () => t('bookings.cols.state'),
        cell: (c) => t(`bookings.states.${c.getValue()}`),
      }),
      col.accessor((r) => r.type ?? dash, { id: 'type', header: () => t('bookings.cols.type'), cell: (c) => c.getValue() as string }),
    ]
  }, [t, adhoc])

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, grouping, globalFilter },
    onSortingChange: setSorting,
    onGroupingChange: setGrouping,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    autoResetExpanded: false,
  })

  function onGroupChange(mode: GroupMode) {
    setGrouping(mode === 'none' ? [] : mode === 'project' ? ['project'] : ['resource'])
  }

  function onExport() {
    const leaves = table.getFilteredRowModel().rows.map((r) => r.original)
    const header = [
      t('bookings.cols.date'), t('bookings.cols.resource'), t('bookings.cols.nickname'),
      t('bookings.cols.task'), t('bookings.cols.project'), t('bookings.cols.hours'),
      t('bookings.cols.state'), t('bookings.cols.type'),
    ]
    const body = leaves.map((r) => [
      r.date, r.resourceName, r.resourceNickname ?? '', r.task, r.project ?? adhoc,
      r.hours.toFixed(1), t(`bookings.states.${r.state}`), r.type ?? '',
    ])
    downloadCsv(csvName, [header, ...body])
  }

  const totalHours = table.getFilteredRowModel().rows
    .filter((r) => !r.getIsGrouped())
    .reduce((sum, r) => sum + r.original.hours, 0)

  const inactiveCount = rows.filter((r) => !r.resourceActive).length

  return (
    <div data-testid="bookings-table-wrap">
      {inactiveCount > 0 && (
        <p className="form-warn" role="status" data-testid="bookings-inactive-notice">
          {t('bookings.inactiveNotice', { n: inactiveCount })}
        </p>
      )}
      <div className="table-toolbar">
        <input
          className="table-search"
          placeholder={t('bookings.search')}
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          data-testid="bookings-search"
        />
        {enableGrouping && (
          <label className="group-select">
            {t('bookings.groupBy')}
            <select
              value={grouping[0] === 'project' ? 'project' : grouping[0] === 'resource' ? 'resource' : 'none'}
              onChange={(e) => onGroupChange(e.target.value as GroupMode)}
              data-testid="bookings-group"
            >
              <option value="none">{t('bookings.group.none')}</option>
              <option value="project">{t('bookings.group.project')}</option>
              <option value="resource">{t('bookings.group.resource')}</option>
            </select>
          </label>
        )}
        <span className="table-total" data-testid="bookings-total">
          {t('bookings.totalHours', { n: table.getFilteredRowModel().rows.filter((r) => !r.getIsGrouped()).length, hours: totalHours.toFixed(1) })}
        </span>
        <Button variant="secondary" onClick={onExport} data-testid="bookings-export">{t('bookings.exportCsv')}</Button>
      </div>

      <table className="data-table" data-testid="bookings-table">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id}
                  className={h.column.getCanSort() ? 'sortable' : undefined}
                  onClick={h.column.getToggleSortingHandler()}
                  data-testid={`col-${h.column.id}`}>
                  {flexRender(h.column.columnDef.header, h.getContext())}
                  {{ asc: ' ▲', desc: ' ▼' }[h.column.getIsSorted() as string] ?? ''}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) =>
            row.getIsGrouped() ? (
              <tr key={row.id} className="group-row" data-testid={`group-${row.groupingColumnId}`}>
                <td colSpan={columns.length}>
                  <button type="button" className="group-toggle" onClick={row.getToggleExpandedHandler()}>
                    {row.getIsExpanded() ? '▾' : '▸'} {String(row.getGroupingValue(row.groupingColumnId!))}
                    <span className="group-meta"> · {t('bookings.groupMeta', {
                      n: row.getLeafRows().length,
                      hours: row.getLeafRows().reduce((s, lr) => s + lr.original.hours, 0).toFixed(1),
                    })}</span>
                  </button>
                </td>
              </tr>
            ) : (
              <tr key={row.id} data-testid={`booking-row-${row.original.id}`} className={row.original.resourceActive ? undefined : 'row-attention'}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
              </tr>
            ),
          )}
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} className="muted" data-testid="bookings-empty">{t('bookings.empty')}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
