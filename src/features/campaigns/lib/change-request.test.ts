import { describe, expect, it } from 'vitest'
import {
  costFigures,
  escalatesAt,
  hasChanges,
  isLive,
  isOpen,
  landsOn,
  latestByDeliverable,
  pgInstant,
  readStoredCost,
  requestedChanges,
  requestLine,
  sendError,
  startedFromTasks,
  toRpcChanges,
  workCost,
  type ChangeRequestRow,
  type WorkTask,
} from './change-request'

/**
 * ADR-0110 + addendum (I59.23): on STARTED work only type, quantity and due date become a change
 * request; the owner is never part of one (E6); who asked is the one required answer; the cost is
 * the work already put in; one request is open per piece.
 */
const now = { typeId: 'type-carousel', quantity: 1, dueDay: '2099-09-24' }

describe('which fields go to the owner', () => {
  it('unstarted work: nothing — type, quantity and date save as CG-E1 saves them', () => {
    expect(requestedChanges(now, { typeId: 'type-reel', quantity: 3, dueDay: '2099-09-30' }, false)).toEqual({})
  })

  it('started work: type, quantity and due date, each with its before and after', () => {
    expect(requestedChanges(now, { typeId: 'type-reel', quantity: 3, dueDay: '2099-09-30' }, true)).toEqual({
      type: { from: 'type-carousel', to: 'type-reel' },
      quantity: { from: '1', to: '3' },
      due: { from: '2099-09-24', to: '2099-09-30' },
    })
  })

  it('started work, only what changed: an untouched field is not on the request', () => {
    const c = requestedChanges(now, { typeId: 'type-carousel', quantity: 2, dueDay: '2099-09-24' }, true)
    expect(c).toEqual({ quantity: { from: '1', to: '2' } })
    expect(hasChanges(c)).toBe(true)
    expect(hasChanges(requestedChanges(now, { typeId: 'type-carousel', quantity: 1, dueDay: null }, true))).toBe(false)
  })

  it('a cleared type is not a change the request can carry', () => {
    expect(requestedChanges(now, { typeId: null, quantity: 1, dueDay: null }, true)).toEqual({})
  })

  it('the RPC body is {field: {to}} — the server reads from itself', () => {
    expect(toRpcChanges({ quantity: { from: '1', to: '3' }, due: { from: null, to: '2099-10-01' } })).toEqual({
      quantity: { to: '3' },
      due: { to: '2099-10-01' },
    })
  })
})

describe('started', () => {
  it('the task half of deliverable_is_started: in progress, review or done', () => {
    expect(startedFromTasks([{ status: 'todo' }, { status: 'blocked' }])).toBe(false)
    expect(startedFromTasks([{ status: 'todo' }, { status: 'in_progress' }])).toBe(true)
    expect(startedFromTasks([{ status: 'review' }])).toBe(true)
    expect(startedFromTasks([{ status: 'done' }])).toBe(true)
    expect(startedFromTasks([])).toBe(false)
  })
})

describe('who asked', () => {
  it('is required: the client or us, nothing else', () => {
    expect(sendError(null)).toBe('askedByRequired')
    expect(sendError('client')).toBeNull()
    expect(sendError('us')).toBeNull()
  })
})

describe('the cost', () => {
  const tasks: WorkTask[] = [
    { id: 'a', title: 'Concept', status: 'done', bookedHours: 4, timedHours: 3.5 },
    { id: 'b', title: 'Artwork', status: 'in_progress', bookedHours: 6, timedHours: 1.25 },
    { id: 'c', title: 'Copy', status: 'todo', bookedHours: 2, timedHours: 0 },
    { id: 'd', title: 'Resize', status: 'todo', bookedHours: 1, timedHours: 0.5 },
    { id: 'e', title: 'Old', status: 'cancelled', bookedHours: 0, timedHours: 2 },
  ]
  it('is the started work — in progress, review, done, or timed — with its booked and timed hours', () => {
    const cost = workCost(tasks)
    expect(cost.started.map((t) => t.id)).toEqual(['a', 'b', 'd'])
    expect(cost.bookedHours).toBe(11)
    expect(cost.timedHours).toBe(5.3)
  })

  it('lands on the new date when the request moves it, else today’s', () => {
    expect(landsOn({ due: { from: '2099-09-24', to: '2099-10-01' } }, '2099-09-24')).toBe('2099-10-01')
    expect(landsOn({ quantity: { from: '1', to: '2' } }, '2099-09-24')).toBe('2099-09-24')
    expect(landsOn({}, null)).toBeNull()
  })

  it('is recorded as named figures', () => {
    expect(costFigures(workCost(tasks), '2099-10-01')).toEqual({ started_tasks: 3, booked_hours: 11, timed_hours: 5.3, lands_on: '2099-10-01' })
  })

  it('is read back by the same names — what Needs you shows (I59 Track 11)', () => {
    // Round-tripped through JSON, as the jsonb column returns it.
    const stored = JSON.parse(JSON.stringify(costFigures(workCost(tasks), '2099-10-01'))) as Record<string, unknown>
    expect(readStoredCost(stored)).toEqual({ startedTasks: 3, bookedHours: 11, timedHours: 5.3, landsOn: '2099-10-01', other: [] })
    // No landing date (nothing moves it), and numbers that came back as text.
    expect(readStoredCost({ started_tasks: '0', booked_hours: '0', timed_hours: 0, lands_on: null }))
      .toEqual({ startedTasks: 0, bookedHours: 0, timedHours: 0, landsOn: null, other: [] })
    // A figure it does not know is kept under its own name; nothing it knows is "no cost".
    expect(readStoredCost({ started_tasks: 1, note: 'x' })?.other).toEqual([['note', 'x']])
    expect(readStoredCost({})).toBeNull()
    expect(readStoredCost(null)).toBeNull()
    expect(readStoredCost({ days_lost: 3 })).toBeNull()
  })

  it('escalates the tenant’s hours later, in real time; no rule, no clock', () => {
    expect(escalatesAt(1_000, 8)).toBe(1_000 + 8 * 3_600_000)
    expect(escalatesAt(1_000, null)).toBeNull()
  })
})

describe('reading a request', () => {
  const row = (over: Partial<ChangeRequestRow>): ChangeRequestRow => ({
    id: 'r', deliverableId: 'd1', status: 'pending', requestedBy: 'am', requestedByName: 'Nadia AM', changes: {},
    askedBy: 'client', declineReason: null, counterText: null, counterDate: null, createdAt: '2099-09-20T10:00:00Z', closedAt: null,
    ...over,
  })

  it('one open per piece: pending and pushed back are open; declined stays live until closed', () => {
    expect(isOpen(row({ status: 'pending' }))).toBe(true)
    expect(isOpen(row({ status: 'pushed_back' }))).toBe(true)
    expect(isOpen(row({ status: 'declined' }))).toBe(false)
    expect(isLive(row({ status: 'declined' }))).toBe(true)
    expect(isLive(row({ status: 'declined', closedAt: '2099-09-21T10:00:00Z' }))).toBe(false)
    expect(isLive(row({ status: 'accepted' }))).toBe(false)
  })

  it('the newest request per piece', () => {
    const m = latestByDeliverable([
      row({ id: 'old', createdAt: '2099-09-19T10:00:00Z', status: 'withdrawn' }),
      row({ id: 'new', createdAt: '2099-09-21T10:00:00Z' }),
      row({ id: 'other', deliverableId: 'd2' }),
    ])
    expect(m.get('d1')?.id).toBe('new')
    expect(m.get('d2')?.id).toBe('other')
  })

  it('reads as one line naming who it waits on', () => {
    expect(requestLine(row({}), 'Fadia')).toEqual({ key: 'changeRequest.state.pending', values: { owner: 'Fadia' } })
    expect(requestLine(row({ status: 'pushed_back' }), 'Fadia')).toEqual({
      key: 'changeRequest.state.pushedBack', values: { owner: 'Fadia', requester: 'Nadia AM' },
    })
    expect(requestLine(row({ status: 'declined', declineReason: 'No time' }), 'Fadia').values.reason).toBe('No time')
    expect(requestLine(row({ status: 'declined', closedAt: 'x' }), 'Fadia').key).toBe('changeRequest.state.declinedClosed')
  })

  it('reads the server’s timestamptz text as an instant', () => {
    expect(new Date(pgInstant('2099-09-24 15:00:00+00')).toISOString()).toBe('2099-09-24T15:00:00.000Z')
    expect(pgInstant('2099-09-24T15:00:00+03:00')).toBe('2099-09-24T15:00:00+03:00')
  })
})
