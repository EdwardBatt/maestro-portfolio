import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../../lib/i18n'
import type { ScheduleBooking, ScheduleResource } from '../api/schedule-api'
import type { AssignmentRequest } from '../../../lib/assignment-requests/requests'

/**
 * ADR-0087 d.10/d.11 — the request opened from its chip.
 *
 * Three people can open it and each gets different verbs: the LEAD who may answer gets Answer, which
 * opens the lead's answer window (ADR-0139: Book / Offer another day / Say no, `/schedule?ask=<id>`);
 * the REQUESTER gets Withdraw; anybody else reads it. Whether the viewer may decide is a
 * mirror (bookings:create + reach over the calendar) that only chooses buttons — the server
 * refuses anyone it got wrong, and that refusal is shown in words.
 *
 * And the number that decides it (d.10): what the person already has on each requested day, from
 * CONFIRMED bookings only — a request holds no capacity, so it never counts itself.
 */

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  withdraw: vi.fn(),
  can: true,
  inScope: true,
  me: 'u-prod-lead',
}))

vi.mock('react-router', async (orig) => ({ ...(await orig<typeof import('react-router')>()), useNavigate: () => state.navigate }))

vi.mock('../../../lib/assignment-requests/api', () => ({
  useWithdrawAssignmentRequest: () => ({ mutateAsync: state.withdraw, isPending: false }),
}))
vi.mock('../hooks/use-write-scope.ts', () => ({
  useWriteScope: () => ({ can: () => state.can, ready: true, inScope: () => state.inScope }),
}))
vi.mock('../../../app/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: state.me } } }),
}))

import { AssignmentRequestDialog } from './AssignmentRequestDialog'

const THU = Date.parse('2026-09-03T00:00:00Z')
const person = {
  id: 'r1', name: 'Sam', nickname: null, kind: 'human', userId: 'u1',
  departmentId: 'dept-prod', departmentName: 'Production', teamId: null, teamName: null,
  officeId: 'o1', capacityModel: 'load_based', requiresApproval: false,
  warnAtPct: 100, ceilingPct: 200, poolSize: null,
  office: { name: 'Baghdad', timezone: 'UTC', workingDays: [7, 1, 2, 3, 4] },
} as unknown as ScheduleResource

const request: AssignmentRequest = {
  id: 'q1', subTaskId: 'st9', resourceId: 'r1', resourceName: 'Sam', assigneeId: 'u1',
  requestedBy: 'u-creative-lead', requesterName: 'Creative Lead', requestedAt: '2026-09-01T00:00:00Z',
  title: 'Studio day', startsAt: '2026-09-03T05:00:00Z', dueAt: '2026-09-04T13:00:00Z', hours: 16,
  status: 'pending', decidedBy: null, decidedAt: null, reason: null,
  departmentName: 'Production', taskTitle: 'Studio day', campaignName: 'Ramadan 2027',
}

const confirmed = (id: string, dayEpoch: number, loadPct: number, resourceId = 'r1'): ScheduleBooking =>
  ({
    id, resourceId, state: 'confirmed', loadPct,
    start: dayEpoch + 6 * 3_600_000, end: dayEpoch + 14 * 3_600_000,
    taskName: 'Other', bookingTitle: null, notes: null, subTaskId: 'st1',
    campaignId: null, deliverableId: null, seriesId: null,
  }) as unknown as ScheduleBooking

function open(bookings: ScheduleBooking[] = []) {
  const onClose = vi.fn()
  render(<AssignmentRequestDialog request={request} resources={[person]} bookings={bookings} onClose={onClose} />)
  return onClose
}

beforeEach(() => {
  state.navigate.mockReset()
  state.withdraw.mockReset().mockResolvedValue(undefined)
  state.can = true
  state.inScope = true
  state.me = 'u-prod-lead'
})

describe('AssignmentRequestDialog — who gets which verbs', () => {
  it('says who asks for whom, for what, and which department answers', () => {
    open()
    expect(screen.getByTestId('request-summary').textContent).toContain('Creative Lead asks to book Sam for Studio day')
    expect(screen.getByTestId('request-awaiting').textContent).toContain('Production')
  })

  it('offers Answer — no one-click approve or refuse — to somebody who could have booked directly', () => {
    open()
    expect(screen.getByTestId('request-answer')).toBeInTheDocument()
    expect(screen.queryByTestId('request-approve')).toBeNull()
    expect(screen.queryByTestId('request-refuse')).toBeNull()
    expect(screen.queryByTestId('request-withdraw')).toBeNull()
  })

  it('offers Withdraw, and nothing else, to the requester — they cannot answer their own request (d.5)', () => {
    state.me = 'u-creative-lead'
    state.inScope = true // even if the mirror thought they reached it, the requester never decides
    open()
    expect(screen.getByTestId('request-withdraw')).toBeInTheDocument()
    expect(screen.queryByTestId('request-answer')).toBeNull()
  })

  it('offers no verb at all to a reader with no reach over that calendar', () => {
    state.inScope = false
    open()
    expect(screen.queryByTestId('request-answer')).toBeNull()
    expect(screen.queryByTestId('request-withdraw')).toBeNull()
    expect(screen.getByTestId('request-close')).toBeInTheDocument()
  })
})

describe('AssignmentRequestDialog — the number that decides it (d.10)', () => {
  it('lists each requested day with the hours already CONFIRMED on that person, and what is asked', () => {
    open([confirmed('b1', THU, 50), confirmed('b2', THU, 25, 'r-other')])
    const days = screen.getByTestId('request-days').textContent ?? ''
    expect(days).toContain('asks for 8h')
    expect(days).toContain('4h already booked') // 50% of an 8h day, and only Sam's own bookings
    expect(days).toContain('0h already booked') // the 4th, empty
  })
})

describe('AssignmentRequestDialog — the verbs', () => {
  it('Answer closes this and opens the lead’s answer window for the same request', () => {
    const onClose = open()
    fireEvent.click(screen.getByTestId('request-answer'))
    expect(onClose).toHaveBeenCalled()
    expect(state.navigate).toHaveBeenCalledWith('/schedule?ask=q1')
  })

  it('withdraws for the requester', async () => {
    state.me = 'u-creative-lead'
    open()
    fireEvent.click(screen.getByTestId('request-withdraw'))
    await vi.waitFor(() => expect(state.withdraw).toHaveBeenCalledWith('q1'))
    await vi.waitFor(() => expect(screen.getByTestId('request-done').textContent).toContain('withdrawn'))
  })
})
