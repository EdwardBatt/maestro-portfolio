import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../lib/i18n'
import type { BookingListRow } from './api/bookings-api'

const downloadCsv = vi.fn()
vi.mock('./lib/csv', () => ({ downloadCsv: (...a: unknown[]) => downloadCsv(...a) }))

import { BookingsTable } from './BookingsTable'

const ROWS: BookingListRow[] = [
  { id: 'b1', startsAt: '2026-09-01T09:00:00Z', endsAt: '2026-09-01T13:00:00Z', date: '2026-09-01', resourceId: 'r1', resourceName: 'Sarah', resourceNickname: 'falcon', task: 'Edit reel', project: 'Ramadan', type: 'Video', state: 'confirmed', hours: 4, resourceActive: true },
  { id: 'b2', startsAt: '2026-09-02T09:00:00Z', endsAt: '2026-09-02T12:00:00Z', date: '2026-09-02', resourceId: 'r1', resourceName: 'Sarah', resourceNickname: 'falcon', task: 'Color grade', project: 'Ramadan', type: null, state: 'tentative', hours: 3, resourceActive: true },
  { id: 'b3', startsAt: '2026-09-03T09:00:00Z', endsAt: '2026-09-03T10:00:00Z', date: '2026-09-03', resourceId: 'r2', resourceName: 'Omar', resourceNickname: null, task: 'Quick logo', project: null, type: null, state: 'confirmed', hours: 1, resourceActive: false },
]

describe('BookingsTable (L3.1/L3.4)', () => {
  beforeEach(() => downloadCsv.mockReset())

  it('renders one row per booking with resource, task and ad-hoc fallback', () => {
    render(<BookingsTable rows={ROWS} csvName="test" />)
    expect(screen.getByTestId('booking-row-b1')).toHaveTextContent('Edit reel')
    expect(screen.getByTestId('booking-row-b1')).toHaveTextContent('Sarah · falcon')
    // b3 has no project → "Ad-hoc" fallback
    expect(screen.getByTestId('booking-row-b3')).toHaveTextContent('Ad-hoc')
  })

  it('global filter narrows rows', () => {
    render(<BookingsTable rows={ROWS} csvName="test" />)
    fireEvent.change(screen.getByTestId('bookings-search'), { target: { value: 'Omar' } })
    expect(screen.queryByTestId('booking-row-b1')).not.toBeInTheDocument()
    expect(screen.getByTestId('booking-row-b3')).toBeInTheDocument()
  })

  it('groups by project with group rows (Ramadan + Ad-hoc)', () => {
    render(<BookingsTable rows={ROWS} csvName="test" />)
    fireEvent.change(screen.getByTestId('bookings-group'), { target: { value: 'project' } })
    const groups = screen.getAllByTestId('group-project')
    expect(groups.length).toBe(2)
    expect(groups.some((g) => /Ramadan/.test(g.textContent ?? ''))).toBe(true)
    expect(groups.some((g) => /Ad-hoc/.test(g.textContent ?? ''))).toBe(true)
  })

  it('flags bookings whose resource has been deactivated (ADR-0014)', () => {
    render(<BookingsTable rows={ROWS} csvName="test" />)
    expect(screen.getByTestId('bookings-inactive-notice')).toBeInTheDocument()
    expect(screen.getByTestId('inactive-b3')).toBeInTheDocument()
    // active resources are not flagged
    expect(screen.queryByTestId('inactive-b1')).not.toBeInTheDocument()
  })

  it('exports the filtered rows to CSV including a header', () => {
    render(<BookingsTable rows={ROWS} csvName="mysheet" />)
    fireEvent.click(screen.getByTestId('bookings-export'))
    expect(downloadCsv).toHaveBeenCalledTimes(1)
    const [name, matrix] = downloadCsv.mock.calls[0]
    expect(name).toBe('mysheet')
    expect(matrix[0]).toContain('Date') // header row
    expect(matrix).toHaveLength(1 + ROWS.length)
  })
})
