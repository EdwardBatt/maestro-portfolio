import { describe, expect, it } from 'vitest'
import { campaignPulse, countThreatened, isWaitingOnClient, pieceThreatensDeadline, type PulsePiece, type PulseTask } from './pulse'

// Thursday 24 Sep 2026, noon in Baghdad.
const NOW = Date.parse('2026-09-24T09:00:00Z')
const at = (day: string) => `${day}T15:00:00Z`

const task = (over: Partial<PulseTask> = {}): PulseTask => ({
  id: 't1',
  status: 'in_progress',
  assigneeId: 'maker',
  committedStartsAt: at('2026-09-20'),
  committedDueAt: at('2026-09-27'),
  hours: 8,
  submittedAt: null,
  reviewerIds: ['lead'],
  ...over,
})

const piece = (over: Partial<PulsePiece> = {}): PulsePiece => ({
  state: 'in_progress',
  dueAt: at('2026-10-06'),
  taskListApprovedAt: '2026-09-20T08:00:00Z',
  ownerId: 'owner',
  reviewerId: null,
  workstreamOwnerId: 'ws-owner',
  outstandingInputs: 0,
  tasks: [task()],
  ...over,
})

describe('isWaitingOnClient — the temporary rule (I57 answer 5)', () => {
  it('approved internally and not yet delivered is with the client', () => {
    expect(isWaitingOnClient({ state: 'approved', outstandingInputs: 0 })).toBe(true)
  })
  it('an outstanding external input is waiting on the client', () => {
    expect(isWaitingOnClient({ state: 'in_progress', outstandingInputs: 1 })).toBe(true)
  })
  it('delivered and closed pieces wait on nobody', () => {
    expect(isWaitingOnClient({ state: 'delivered', outstandingInputs: 2 })).toBe(false)
    expect(isWaitingOnClient({ state: 'archived', outstandingInputs: 2 })).toBe(false)
  })
  it('work in progress with nothing outstanding is not waiting on the client', () => {
    expect(isWaitingOnClient({ state: 'in_progress', outstandingInputs: 0 })).toBe(false)
  })
})

describe('campaignPulse — the card on the campaigns list (CG-00)', () => {
  it('counts live pieces and the delivered ones; a closed piece is neither', () => {
    const p = campaignPulse(
      [piece({ state: 'delivered' }), piece({ state: 'approved' }), piece(), piece({ state: 'archived' })],
      { now: NOW },
    )
    expect(p.total).toBe(3)
    expect(p.delivered).toBe(1)
    expect(p.waitingOnClient).toBe(1)
  })

  it('counts late and at-risk pieces as At risk, and a healthy one as neither', () => {
    const p = campaignPulse(
      [piece({ dueAt: at('2026-09-20') }), piece({ tasks: [task({ status: 'review', submittedAt: '2026-09-20T10:00:00Z' })] }), piece()],
      { now: NOW },
    )
    expect(p.atRisk).toBe(2)
  })

  it('a piece waiting on a client input is not at risk for the time that input costs', () => {
    const late = task({ status: 'todo', committedStartsAt: at('2026-09-22') })
    expect(campaignPulse([piece({ tasks: [late] })], { now: NOW }).atRisk).toBe(1)
    const waiting = campaignPulse([piece({ tasks: [late], outstandingInputs: 1 })], { now: NOW })
    expect(waiting.atRisk).toBe(0)
    expect(waiting.waitingOnClient).toBe(1)
  })

  it('counts unassigned TASKS, not pieces, and only live ones', () => {
    const p = campaignPulse(
      [
        piece({
          tasks: [
            task({ id: 'a', assigneeId: null, status: 'todo', committedStartsAt: null, committedDueAt: null }),
            task({ id: 'b', assigneeId: null, status: 'todo', committedStartsAt: null, committedDueAt: null }),
            task({ id: 'c', assigneeId: null, status: 'cancelled' }),
          ],
        }),
      ],
      { now: NOW },
    )
    expect(p.tasksUnassigned).toBe(2)
  })

  it('does not count unassigned tasks under a task list nobody has approved — they cannot be assigned yet', () => {
    const t = task({ assigneeId: null, status: 'todo', committedStartsAt: null, committedDueAt: null })
    const p = campaignPulse([piece({ taskListApprovedAt: null, tasks: [t] })], { now: NOW })
    expect(p.tasksUnassigned).toBe(0)
    expect(p.taskListsToApprove).toBe(1)
  })

  it('counts task lists waiting for their owner, not on finished pieces or pieces with no tasks', () => {
    const p = campaignPulse(
      [
        piece({ taskListApprovedAt: null }),
        piece({ taskListApprovedAt: null, state: 'approved' }),
        piece({ taskListApprovedAt: null, tasks: [] }),
        piece(),
      ],
      { now: NOW },
    )
    expect(p.taskListsToApprove).toBe(1)
  })

  it('names everyone on it in the four ways', () => {
    const p = campaignPulse([piece({ reviewerId: 'piece-reviewer' })], { now: NOW })
    expect([...p.people].sort()).toEqual(['lead', 'maker', 'owner', 'piece-reviewer', 'ws-owner'])
  })

  it('an empty campaign has an empty pulse', () => {
    const p = campaignPulse([], { now: NOW })
    expect(p).toMatchObject({ total: 0, delivered: 0, atRisk: 0, waitingOnClient: 0, tasksUnassigned: 0, taskListsToApprove: 0 })
    expect(p.people.size).toBe(0)
  })
})

describe('the hours-vs-booked check reaches the card (ADR-0075 d.4, I57.12)', () => {
  it('a piece whose task has more work left than booked time is At risk', () => {
    const short = task({ hoursRemaining: 6, bookedHoursLeft: 2 })
    expect(campaignPulse([piece({ tasks: [short] })], { now: NOW }).atRisk).toBe(1)
    expect(campaignPulse([piece({ tasks: [task({ hoursRemaining: 2, bookedHoursLeft: 6 })] })], { now: NOW }).atRisk).toBe(0)
  })
})

describe('countThreatened — the dashboard and Team tiles (I57.13)', () => {
  const pieces = [
    piece({ ownerId: 'a', dueAt: at('2026-09-20') }), // late
    piece({ ownerId: 'b', tasks: [task({ status: 'review', submittedAt: '2026-09-20T10:00:00Z' })] }), // stuck
    piece({ ownerId: 'a' }), // healthy
    piece({ ownerId: 'a', state: 'approved', dueAt: at('2026-09-20') }), // finished
    piece({ ownerId: 'a', state: 'archived', dueAt: at('2026-09-20') }), // closed
  ]
  it('counts late and at-risk live pieces, the same test the card uses', () => {
    expect(countThreatened(pieces, { now: NOW })).toBe(2)
    expect(countThreatened(pieces, { now: NOW })).toBe(campaignPulse(pieces, { now: NOW }).atRisk)
  })
  it('narrows to the pieces whose owner is one of the given people', () => {
    expect(countThreatened(pieces, { now: NOW }, new Set(['a']))).toBe(1)
    expect(countThreatened(pieces, { now: NOW }, new Set(['c']))).toBe(0)
    expect(countThreatened([piece({ ownerId: null, dueAt: at('2026-09-20') })], { now: NOW }, new Set(['a']))).toBe(0)
  })
})

describe("a piece is judged on its client's week (ADR-0123 d.3)", () => {
  // Due Sunday 4 Oct; its last task finishes Friday 2 Oct; today Thursday 1 Oct. The review needs a
  // working day between the two: Iraq has Sunday, the UAE (Monday to Friday) has none.
  const piece: PulsePiece = {
    state: 'in_progress', dueAt: '2026-10-04T14:00:00Z', taskListApprovedAt: '2026-09-28T09:00:00Z', ownerId: 'o',
    reviewerId: null, workstreamOwnerId: null, outstandingInputs: 0,
    tasks: [task({ committedStartsAt: '2026-10-01T06:00:00Z', committedDueAt: '2026-10-02T14:00:00Z' })],
  }
  const now = Date.parse('2026-10-01T09:00:00Z')

  it('on time for an Iraqi client, at risk for a UAE one', () => {
    expect(pieceThreatensDeadline({ ...piece, calendar: { workingDays: [7, 1, 2, 3, 4] } }, { now })).toBe(false)
    expect(pieceThreatensDeadline({ ...piece, calendar: { workingDays: [1, 2, 3, 4, 5] } }, { now })).toBe(true)
  })

  it("the piece's own calendar wins over the options'", () => {
    expect(pieceThreatensDeadline({ ...piece, calendar: { workingDays: [1, 2, 3, 4, 5] } }, { now, calendar: { workingDays: [7, 1, 2, 3, 4] } })).toBe(true)
  })
})
