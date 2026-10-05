// ADR-0068 (I36.1) — cancelling a task from the SCHEDULE asks first.
//
// This is the surface Edward reported on 3 Sep: *"when a user wants to cancel a task from /schedule
// there is no warning and the task is not recoverable."* `onCancelTask` was wired straight to the
// button's `onClick`, so one stray click set `status = 'cancelled'` AND deleted every booking —
// the assignment, the placement, the load and the dates, none of which live on the `sub_tasks` row.
// A live task was lost that way on 2 September and came back only through hand-written SQL.
//
// So the assertions here are about WHAT DOES NOT HAPPEN on the click, and about the dialog saying
// what it costs. There is no assertion about the form rendering; that is not what went wrong.
//
// Everything reaching `lib/supabase` is mocked: it Zod-parses the VITE_ vars at import and throws
// where they are absent, which they are in CI (traps.md).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../../lib/i18n'
import type { ScheduleBooking, ScheduleResource } from '../api/schedule-api'

const state = vi.hoisted(() => ({
  cancelTask: vi.fn(async () => undefined),
  cancelBooking: vi.fn(async () => undefined),
  impact: { bookings: 2, isPlan: false, isAdhoc: false },
  detail: {
    subTaskId: 'st1',
    title: 'Harmony B2B Animation',
    assigneeId: 'u1',
    assigneeName: 'Basheer Mathai',
    creatorName: 'Lina',
    createdAt: '2026-08-31T09:00:00Z',
    modifierName: 'Lina',
    updatedAt: '2026-09-01T09:00:00Z',
    startsAt: '2026-09-02T06:00:00Z',
    dueAt: '2026-09-02T10:00:00Z',
    slaHours: 4,
    reviewMode: 'digital',
    reviewers: [],
    departmentId: null,
    teamId: null,
    committedDueAt: '2026-09-02T10:00:00Z',
    deliverableDueAt: null,
    goLiveAt: null,
  },
}))

// ADR-0088: the extension line beside the dates reads its own api module (→ lib/env in CI), and
// the dialog reads auth for the viewer's id. Both stubbed; the control has its own suite.
vi.mock('../../deliverables/api/extensions-api', () => ({
  useLatestExtensionByTask: () => ({ data: new Map() }),
  useRequestExtension: () => ({ mutate: vi.fn(), isPending: false }),
  useWithdrawExtension: () => ({ mutate: vi.fn(), isPending: false }),
  useDecideExtension: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
  isRefused: () => false,
}))
vi.mock('../../../app/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, claims: { tenantId: 't1' } }),
}))

vi.mock('../api/schedule-api', () => ({
  useRescheduleBooking: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelBooking: () => ({ mutateAsync: state.cancelBooking, isPending: false }),
  useUpdateTaskAssignment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateBookingFields: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useBookingTaskDetail: () => ({ data: state.detail, isLoading: false }),
}))

vi.mock('../../deliverables/api/deliverables-api', () => ({
  useCancelSubTask: () => ({ mutateAsync: state.cancelTask, isPending: false }),
  useReviewers: () => ({ data: [] }),
  fetchCancelImpact: vi.fn(async () => state.impact),
}))

vi.mock('../../deliverables/TaskResources', () => ({ TaskResources: () => null }))
// One hook supplies the whole authority surface this dialog reads (I28).
vi.mock('../hooks/use-write-scope.ts', () => ({
  useWriteScope: () => ({
    can: () => true,
    ready: true,
    scope: 'account',
    inScope: () => true,
    canWriteResource: () => true,
    refusalFor: () => ({ key: 'schedule.notAuthorisedCancelTask', params: {} }),
    routeFor: () => 'direct',
    canRequestResource: () => false,
  }),
}))

// ADR-0087: the request line and Withdraw. Nothing pending in these tests; the request surface
// has its own suite. The real module reaches lib/supabase → lib/env.
vi.mock('../../../lib/assignment-requests/api', () => ({
  usePendingAssignmentRequest: () => ({ data: null, isLoading: false }),
  useWithdrawAssignmentRequest: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('../../../app/auth-context', () => ({
  useAuth: () => ({ claims: { tenantId: 't1' }, session: { user: { id: 'me' } } }),
}))

// I41.10/I41.11: the extension arithmetic reads the tenant's buffer and calendar; the defaults here.
vi.mock('../../../lib/deadlines/use-extension-context', () => ({
  useExtensionContext: () => ({ reviewBufferWorkingDays: 1, workingDays: [7, 1, 2, 3, 4], closures: [] }),
}))

import { EditBookingDialog } from './EditBookingDialog'

const RESOURCES: ScheduleResource[] = [
  { id: 'r1', name: 'Basheer', kind: 'human', userId: 'u1' } as ScheduleResource,
]

const BOOKING = {
  id: 'b1',
  resourceId: 'r1',
  subTaskId: 'st1',
  start: Date.parse('2026-09-02T06:00:00Z'),
  end: Date.parse('2026-09-02T10:00:00Z'),
  loadPct: 50,
  state: 'confirmed',
  taskName: 'Harmony B2B Animation',
  bookingTitle: null,
  notes: null,
} as unknown as ScheduleBooking

const renderDialog = () =>
  render(<EditBookingDialog booking={BOOKING} resources={RESOURCES} onClose={vi.fn()} />)

describe('EditBookingDialog — cancelling asks first (ADR-0068)', () => {
  beforeEach(() => {
    state.cancelTask.mockClear()
    state.impact = { bookings: 2, isPlan: false, isAdhoc: false }
  })

  it('does NOT cancel on the click — the defect Edward reported', async () => {
    renderDialog()
    fireEvent.click(screen.getByTestId('edit-cancel-task'))
    // The impact is fetched before the dialog opens, so this resolves a microtask later.
    expect(await screen.findByTestId('edit-cancel-confirm-dialog')).toBeInTheDocument()
    expect(state.cancelTask).not.toHaveBeenCalled()
  })

  it('names the assignee, counts the bookings, and warns that reinstating does not restore them', async () => {
    renderDialog()
    fireEvent.click(screen.getByTestId('edit-cancel-task'))
    const detail = await screen.findByTestId('edit-cancel-confirm-detail')
    expect(detail).toHaveTextContent('Basheer Mathai')
    expect(detail).toHaveTextContent('2')
    // The half somebody would otherwise assume the other way round.
    expect(detail).toHaveTextContent('unassigned and unscheduled')
  })

  it('cancels only once confirmed', async () => {
    renderDialog()
    fireEvent.click(screen.getByTestId('edit-cancel-task'))
    fireEvent.click(await screen.findByTestId('edit-cancel-confirm-confirm'))
    expect(state.cancelTask).toHaveBeenCalledWith('st1')
  })

  it('changes nothing when dismissed, and the edit dialog stays open', async () => {
    renderDialog()
    fireEvent.click(screen.getByTestId('edit-cancel-task'))
    fireEvent.click(await screen.findByTestId('edit-cancel-confirm-cancel'))
    expect(state.cancelTask).not.toHaveBeenCalled()
    expect(screen.queryByTestId('edit-cancel-confirm-dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('edit-dialog')).toBeInTheDocument()
  })


  it('tells the truth about AD-HOC work: cancelling it cannot be undone', async () => {
    // The schedule is where most ad-hoc work gets cancelled, so this is the sentence that matters.
    state.impact = { bookings: 1, isPlan: false, isAdhoc: true }
    renderDialog()
    fireEvent.click(screen.getByTestId('edit-cancel-task'))
    const detail = await screen.findByTestId('edit-cancel-confirm-detail')
    expect(detail).toHaveTextContent('cannot be reinstated')
    expect(detail).not.toHaveTextContent('You can reinstate it afterwards')
  })

  it('offers no Reinstate here — a cancelled task leaves the calendar entirely', () => {
    // Cancelling deletes the bookings, so there is nothing left on the schedule to reinstate FROM.
    // It is offered on the deliverable, where the task still is.
    renderDialog()
    expect(screen.queryByTestId('edit-reinstate-task')).not.toBeInTheDocument()
  })
})

/**
 * I41.2, second cut. Opening a task re-derived where its days "would" land and announced a move
 * that was not happening — Edward opened a task he had dragged onto a Friday and was told it ends
 * a week later. A placed task ends where it was placed; re-placement belongs only to somebody
 * asking for a number of days again.
 */
describe('EditBookingDialog — the end date is not re-derived on open (I41.2)', () => {
  const onFriday: ScheduleResource[] = [
    {
      id: 'r1', name: 'Basheer', kind: 'human', userId: 'u1',
      // Baghdad works Sun-Thu, so the task below sits on a day off.
      office: { name: 'Baghdad', timezone: 'UTC', workingDays: [7, 1, 2, 3, 4] },
    } as ScheduleResource,
  ]
  const dragged = {
    ...BOOKING,
    start: Date.parse('2026-09-03T06:00:00Z'), // Thu
    end: Date.parse('2026-09-04T10:00:00Z'),   // dragged onto Fri
  } as unknown as ScheduleBooking

  beforeEach(() => {
    state.detail = { ...state.detail, startsAt: '2026-09-03T06:00:00Z', dueAt: '2026-09-04T10:00:00Z' }
  })

  it('says nothing when the task is merely opened', () => {
    render(<EditBookingDialog booking={dragged} resources={onFriday} onClose={vi.fn()} />)
    expect(screen.queryByTestId('edit-ends-on')).toBeNull()
  })

  it('says it once a date is actually changed, and the end genuinely moves', () => {
    // A one-day Thursday task; the person extends it onto the Friday, which nobody works.
    state.detail = { ...state.detail, startsAt: '2026-09-03T06:00:00Z', dueAt: '2026-09-03T10:00:00Z' }
    const oneDay = {
      ...BOOKING,
      start: Date.parse('2026-09-03T06:00:00Z'),
      end: Date.parse('2026-09-03T10:00:00Z'),
    } as unknown as ScheduleBooking
    render(<EditBookingDialog booking={oneDay} resources={onFriday} onClose={vi.fn()} />)
    expect(screen.queryByTestId('edit-ends-on')).toBeNull()

    fireEvent.change(screen.getByTestId('edit-end-date'), { target: { value: '2026-09-04' } })
    expect(screen.getByTestId('edit-ends-on')).toHaveTextContent('2026-09-06') // Sunday
  })
})
