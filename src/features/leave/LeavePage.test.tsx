import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import '../../lib/i18n'
import type { LeaveEntry, LeaveResource, OfficeClosure, StrandedBooking } from './api/leave-api'

const createMutate = vi.fn()
const updateMutate = vi.fn()
const deleteMutate = vi.fn()
const createClosureMutate = vi.fn()
const deleteClosureMutate = vi.fn()

const CLOSURES: OfficeClosure[] = [
  { id: 'c1', officeId: 'o1', officeName: 'Baghdad', kind: 'public_holiday', name: 'Eid al-Fitr', startsOn: '2026-10-05', endsOn: '2026-10-06' },
]
const STRANDED: StrandedBooking[] = [
  {
    bookingId: 'b1', resourceId: 'r1', resourceName: 'Alice', title: 'Panels',
    startsAt: '2026-10-05T06:00:00Z', endsAt: '2026-10-05T14:00:00Z', deliverableName: 'Key visual', ownerName: 'Lead',
  },
]

const ENTRIES: LeaveEntry[] = [
  {
    id: 'l1',
    resourceId: 'r1',
    resourceName: 'Alice',
    kind: 'leave',
    category: 'emergency',
    startsAt: '2026-08-10T00:00:00',
    endsAt: '2026-08-12T23:59:59',
    reason: 'family',
  },
]

const RESOURCES: LeaveResource[] = [
  { id: 'r1', name: 'Alice', kind: 'human' },
  { id: 'r2', name: 'Bob', kind: 'human' },
]

// Self-contained factory (the real module reaches lib/env, which throws in CI).
vi.mock('./api/leave-api', () => ({
  useLeaveEntries: () => ({ data: ENTRIES, isLoading: false, isError: false }),
  useLeaveResources: () => ({ data: RESOURCES, isLoading: false, isError: false }),
  useCreateLeave: () => ({ mutate: createMutate, isPending: false }),
  useUpdateLeave: () => ({ mutate: updateMutate, isPending: false }),
  useDeleteLeave: () => ({ mutate: deleteMutate, isPending: false }),
  useOfficeClosures: () => ({ data: CLOSURES, isLoading: false, isError: false }),
  useClosureOffices: () => ({ data: [{ id: 'o1', name: 'Baghdad' }, { id: 'o2', name: 'Dubai' }], isLoading: false }),
  useCreateClosure: () => ({ mutate: createClosureMutate, isPending: false }),
  useUpdateClosure: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteClosure: () => ({ mutate: deleteClosureMutate, isPending: false }),
  useStrandedBookings: (id: string | null) => ({ data: id ? STRANDED : [], isLoading: false, isError: false }),
}))

vi.mock('../../app/permissions', () => ({
  usePermissions: () => ({ can: (k: string) => k === 'leave:manage' || k === 'leave:view' }),
}))

import { LeavePage } from './LeavePage'

function renderPage() {
  return render(
    <MemoryRouter>
      <LeavePage />
    </MemoryRouter>,
  )
}

describe('LeavePage — leave calendar (L1.7)', () => {
  beforeEach(() => {
    createMutate.mockReset()
    updateMutate.mockReset()
    deleteMutate.mockReset()
  })

  it('lists leave entries with person, category and dates', () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-29T09:00:00Z')) // I66.8: a 2026 date shows no year
    renderPage()
    const row = screen.getByTestId('leave-row-l1')
    expect(row).toHaveTextContent('Alice')
    expect(row).toHaveTextContent('Mon, 10 Aug')
    expect(row).toHaveTextContent('Wed, 12 Aug')
    vi.useRealTimers()
  })

  it('records leave: fills the dialog and calls create with a day-precision span', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('leave-add'))
    fireEvent.change(screen.getByTestId('leave-resource'), { target: { value: 'r2' } })
    fireEvent.change(screen.getByTestId('leave-start'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByTestId('leave-end'), { target: { value: '2026-09-03' } })
    fireEvent.submit(screen.getByTestId('leave-dialog'))
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: 'r2',
        kind: 'leave',
        category: 'planned',
        startsAt: '2026-09-01T00:00:00',
        endsAt: '2026-09-03T23:59:59',
      }),
      expect.anything(),
    )
  })

  it('rejects an end date before the start date', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('leave-add'))
    fireEvent.change(screen.getByTestId('leave-resource'), { target: { value: 'r1' } })
    fireEvent.change(screen.getByTestId('leave-start'), { target: { value: '2026-09-05' } })
    fireEvent.change(screen.getByTestId('leave-end'), { target: { value: '2026-09-01' } })
    fireEvent.submit(screen.getByTestId('leave-dialog'))
    expect(createMutate).not.toHaveBeenCalled()
    expect(screen.getByTestId('leave-error')).toBeInTheDocument()
  })

  it('delete is two-step: arm, then confirm', () => {
    renderPage()
    const btn = screen.getByTestId('leave-delete-l1')
    fireEvent.click(btn)
    expect(deleteMutate).not.toHaveBeenCalled()
    fireEvent.click(btn)
    expect(deleteMutate).toHaveBeenCalledWith('l1', expect.anything())
  })

  // ADR-0079: the leave form no longer offers "holiday" — that is an office closure now.
  it('the leave form offers leave only; holiday belongs to the office', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('leave-add'))
    const options = Array.from((screen.getByTestId('leave-kind') as HTMLSelectElement).options).map((o) => o.value)
    expect(options).toEqual(['leave'])
  })
})

describe('LeavePage — office closures (ADR-0079)', () => {
  beforeEach(() => {
    createClosureMutate.mockReset()
    deleteClosureMutate.mockReset()
  })

  it('lists closures by office with their span', () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-29T09:00:00Z')) // I66.8: a 2026 date shows no year
    renderPage()
    const row = screen.getByTestId('closure-row-c1')
    expect(row).toHaveTextContent('Baghdad')
    expect(row).toHaveTextContent('Eid al-Fitr')
    expect(row).toHaveTextContent('Mon, 5 Oct')
    expect(row).toHaveTextContent('Tue, 6 Oct')
    vi.useRealTimers()
  })

  // d.1/d.7: the form asks for an OFFICE, not a person.
  it('declares a closure on an office, whole days, and a single day needs no end date', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('closure-add'))
    fireEvent.change(screen.getByTestId('closure-office'), { target: { value: 'o2' } })
    fireEvent.change(screen.getByTestId('closure-kind'), { target: { value: 'company_closed' } })
    fireEvent.change(screen.getByTestId('closure-name'), { target: { value: 'Stocktake' } })
    fireEvent.change(screen.getByTestId('closure-start'), { target: { value: '2026-11-01' } })
    fireEvent.submit(screen.getByTestId('closure-dialog').querySelector('form')!)
    expect(createClosureMutate).toHaveBeenCalledWith(
      { officeId: 'o2', kind: 'company_closed', name: 'Stocktake', startsOn: '2026-11-01', endsOn: '2026-11-01' },
      expect.anything(),
    )
  })

  it('refuses a closure with no name', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('closure-add'))
    fireEvent.change(screen.getByTestId('closure-office'), { target: { value: 'o1' } })
    fireEvent.change(screen.getByTestId('closure-start'), { target: { value: '2026-11-01' } })
    fireEvent.submit(screen.getByTestId('closure-dialog').querySelector('form')!)
    expect(createClosureMutate).not.toHaveBeenCalled()
    expect(screen.getByTestId('closure-error')).toBeInTheDocument()
  })

  // d.6: nothing moves, but what sits on the closed day is LISTED, with its owner.
  it('shows the stranded work for a closure, with owner and a link to the schedule week', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('closure-stranded-c1'))
    const row = screen.getByTestId('stranded-b1')
    expect(row).toHaveTextContent('Alice')
    expect(row).toHaveTextContent('Key visual')
    expect(row).toHaveTextContent('Lead')
    expect(screen.getByTestId('stranded-open-b1')).toHaveAttribute('href', '/schedule?on=2026-10-05&who=Alice')
  })

  it('closure delete is two-step: arm, then confirm', () => {
    renderPage()
    const btn = screen.getByTestId('closure-delete-c1')
    fireEvent.click(btn)
    expect(deleteClosureMutate).not.toHaveBeenCalled()
    fireEvent.click(btn)
    expect(deleteClosureMutate).toHaveBeenCalledWith('c1', expect.anything())
  })
})
