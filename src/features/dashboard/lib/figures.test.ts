import { describe, expect, it } from 'vitest'
import {
  arcs,
  breakdown,
  clashes,
  finishedOnTime,
  dueOutcomes,
  peopleFullPerDay,
  loadTone,
  campaignTone,
  finishedPerWeek,
  goLivesInDanger,
  isLateTask,
  nobodyOnIt,
  perDay,
  piecesByCampaign,
  trendPct,
  weekStartOf,
  workStateOf,
  type DashCampaign,
  type DashPiece,
} from './figures'

const H = 60 * 60 * 1000
const task = (over: Partial<DashPiece['tasks'][number]> = {}) => ({
  id: 't1', status: 'todo' as const, assigneeId: null, committedStartsAt: null, committedDueAt: null, hours: null,
  submittedAt: null, reviewerIds: [], ...over,
})
const piece = (over: Partial<DashPiece> = {}): DashPiece => ({
  id: 'p1', name: 'Post 1', campaignId: 'c1', state: 'in_progress', dueAt: null, taskListApprovedAt: '2026-09-20T00:00:00Z',
  ownerId: null, reviewerId: null, workstreamOwnerId: null, outstandingInputs: 0, tasks: [task()], ...over,
})

describe('the week', () => {
  it('starts on Sunday', () => {
    // Wed 30 Sep 2026 → Sun 27 Sep
    expect(new Date(weekStartOf(Date.parse('2026-09-30T10:00:00Z'))).toISOString()).toBe('2026-09-27T00:00:00.000Z')
  })
  it('counts dates per day and ignores the rest', () => {
    const w = Date.parse('2026-09-27T00:00:00Z')
    expect(perDay(['2026-09-27T09:00:00Z', '2026-09-30T09:00:00Z', '2026-09-30T20:00:00Z', '2026-10-05T00:00:00Z', null], w))
      .toEqual([1, 0, 0, 2, 0, 0, 0])
  })
})

describe('where a piece is', () => {
  it('reads delivered, blocked, in review, in progress and not started', () => {
    expect(workStateOf(piece({ state: 'approved' }))).toBe('delivered')
    expect(workStateOf(piece({ outstandingInputs: 1 }))).toBe('blocked')
    expect(workStateOf(piece({ tasks: [task({ status: 'review' })] }))).toBe('inReview')
    expect(workStateOf(piece({ tasks: [task({ status: 'in_progress' })] }))).toBe('inProgress')
    expect(workStateOf(piece())).toBe('notStarted')
  })
  it('is in review only when every open task is (I67.4 — the word follows the least advanced open task)', () => {
    const mixed = [task({ id: 'a', status: 'review' }), task({ id: 'b', status: 'todo' })]
    expect(workStateOf(piece({ tasks: mixed }))).toBe('inProgress')
    expect(workStateOf(piece({ tasks: [task({ id: 'a', status: 'review' }), task({ id: 'b', status: 'done' })] }))).toBe('inReview')
  })
  it('leaves archived pieces out of the ring', () => {
    expect(breakdown([piece(), piece({ state: 'archived' })])).toEqual({ delivered: 0, inProgress: 0, inReview: 0, notStarted: 1, blocked: 0 })
  })
})

describe('nobody on it (ADR-0118 ready to assign)', () => {
  const status = new Map([['c1', 'approved'], ['c2', 'pending_approval']])
  it('counts a live unassigned task under an approved list on a released campaign', () => {
    expect(nobodyOnIt([piece()], status)).toHaveLength(1)
  })
  it('does not count an unapproved list, an unreleased campaign, a finished piece or an assigned task', () => {
    expect(nobodyOnIt([piece({ taskListApprovedAt: null })], status)).toHaveLength(0)
    expect(nobodyOnIt([piece({ campaignId: 'c2' })], status)).toHaveLength(0)
    expect(nobodyOnIt([piece({ state: 'approved' })], status)).toHaveLength(0)
    expect(nobodyOnIt([piece({ tasks: [task({ assigneeId: 'u1' })] })], status)).toHaveLength(0)
  })
})

describe('late (ADR-0075)', () => {
  const now = Date.parse('2026-09-28T10:00:00Z')
  it('is a live task past the day it was committed to', () => {
    expect(isLateTask({ status: 'in_progress', committedDueAt: '2026-09-27T10:00:00Z' }, now)).toBe(true)
    expect(isLateTask({ status: 'in_progress', committedDueAt: '2026-09-28T06:00:00Z' }, now)).toBe(false)
    expect(isLateTask({ status: 'done', committedDueAt: '2026-09-20T10:00:00Z' }, now)).toBe(false)
    expect(isLateTask({ status: 'todo', committedDueAt: null }, now)).toBe(false)
  })
})

describe('go-live in danger', () => {
  it('is a released campaign going live this week with a piece late or at risk', () => {
    const w = Date.parse('2026-09-27T00:00:00Z')
    const now = Date.parse('2026-09-28T10:00:00Z')
    const late = piece({ dueAt: '2026-09-27T10:00:00Z', tasks: [task({ assigneeId: 'u1', status: 'in_progress' })] })
    const c = (id: string, goLiveAt: string | null, status = 'approved'): DashCampaign =>
      ({ id, name: id, clientName: 'Kite', goLiveAt, status, accountManagerId: null })
    const pieces = piecesByCampaign([{ ...late, campaignId: 'a' }, { ...late, campaignId: 'b' }, { ...piece(), campaignId: 'c' }])
    const out = goLivesInDanger([c('a', '2026-09-30T00:00:00Z'), c('b', '2026-10-10T00:00:00Z'), c('c', '2026-09-30T00:00:00Z')], pieces, w, now)
    expect(out.map((x) => x.id)).toEqual(['a'])
  })
})

describe('clashes', () => {
  const at = (h: number) => Date.parse('2026-09-28T00:00:00Z') + h * H
  const kind = (id: string) => (id === 'room' ? 'room' : 'human')
  it('a room booked twice at once is a clash', () => {
    const out = clashes([
      { id: 'a', resourceId: 'room', start: at(9), end: at(11), loadPct: null },
      { id: 'b', resourceId: 'room', start: at(10), end: at(12), loadPct: null },
    ], kind)
    expect(out).toHaveLength(1)
  })
  it('a person is never a clash — overlapping is how people are booked; over-booking is the ceiling figure', () => {
    expect(clashes([
      { id: 'a', resourceId: 'p', start: at(9), end: at(17), loadPct: 100 },
      { id: 'b', resourceId: 'p', start: at(12), end: at(18), loadPct: 100 },
    ], kind)).toHaveLength(0)
  })
  it('back-to-back bookings do not clash', () => {
    expect(clashes([
      { id: 'a', resourceId: 'room', start: at(9), end: at(10), loadPct: null },
      { id: 'b', resourceId: 'room', start: at(10), end: at(11), loadPct: null },
    ], kind)).toHaveLength(0)
  })
})

describe('drawing', () => {
  it('arcs share the whole and drop zeros', () => {
    expect(arcs([{ key: 'a', value: 1 }, { key: 'b', value: 0 }, { key: 'c', value: 3 }])).toEqual([
      { key: 'a', from: 0, to: 0.25 },
      { key: 'c', from: 0.25, to: 1 },
    ])
    expect(arcs([{ key: 'a', value: 0 }])).toEqual([])
  })
  it('a trend needs something to compare with', () => {
    expect(trendPct(12, 10)).toBe(20)
    expect(trendPct(5, 0)).toBeNull()
  })
})

describe('finished work (I61.3)', () => {
  const w = Date.parse('2026-09-27T00:00:00Z')
  const done = (finishedAt: string | null, dueAt: string | null) => piece({ state: 'approved', finishedAt, dueAt })
  it('is on time when it finished by its due date, or had none', () => {
    expect(finishedOnTime(done('2026-09-28T10:00:00Z', '2026-09-29T00:00:00Z'))).toBe(true)
    expect(finishedOnTime(done('2026-09-30T10:00:00Z', '2026-09-29T00:00:00Z'))).toBe(false)
    expect(finishedOnTime(done('2026-09-30T10:00:00Z', null))).toBe(true)
    expect(finishedOnTime(done(null, null))).toBe(false)
  })
  it('counts each week on time and late', () => {
    const pieces = [done('2026-09-28T10:00:00Z', '2026-09-29T00:00:00Z'), done('2026-09-30T10:00:00Z', '2026-09-29T00:00:00Z'),
      done('2026-09-21T10:00:00Z', null)]
    expect(finishedPerWeek(pieces, [w - 7 * 24 * 3600 * 1000, w])).toEqual([{ onTime: 1, late: 0 }, { onTime: 1, late: 1 }])
  })
})

describe('Figma H readings', () => {
  const w = Date.parse('2026-09-27T00:00:00Z')
  const now = Date.parse('2026-09-30T10:00:00Z')
  it('sorts a week\'s due pieces into on time, late, in review and still open', () => {
    const pieces = [
      piece({ state: 'approved', dueAt: '2026-09-28T17:00:00Z', finishedAt: '2026-09-28T09:00:00Z' }),
      piece({ state: 'approved', dueAt: '2026-09-28T17:00:00Z', finishedAt: '2026-09-29T09:00:00Z' }),
      piece({ dueAt: '2026-09-29T17:00:00Z' }),
      piece({ dueAt: '2026-10-01T17:00:00Z', tasks: [task({ status: 'review' })] }),
      piece({ dueAt: '2026-10-01T17:00:00Z' }),
      piece({ dueAt: '2026-10-08T17:00:00Z' }),
    ]
    expect(dueOutcomes(pieces, [w], now)).toEqual([{ onTime: 1, late: 2, inReview: 1, open: 1 }])
  })
  it('counts people booked a full day, splitting a booking across midnight', () => {
    const at = (d: number, h: number) => w + d * 24 * 3600 * 1000 + h * 3600 * 1000
    const b = [
      { resourceId: 'a', start: at(1, 9), end: at(1, 17) },
      { resourceId: 'b', start: at(1, 9), end: at(1, 13) }, { resourceId: 'b', start: at(1, 14), end: at(1, 18) },
      { resourceId: 'c', start: at(1, 9), end: at(1, 12) },
      { resourceId: 'x', start: at(1, 9), end: at(1, 17) },
    ]
    expect(peopleFullPerDay(b, new Set(['a', 'b', 'c']), w)).toEqual([0, 2, 0, 0, 0, 0, 0])
  })
  it('colours load and campaigns as the frames do', () => {
    expect([loadTone(90), loadTone(60), loadTone(20, true), loadTone(40), loadTone(0)]).toEqual(['risk', 'warn', 'warn', 'ink', 'empty'])
    expect(campaignTone({ total: 8, done: 8, atRisk: 0, nobody: 0, waiting: 0 })).toBe('ok')
    expect(campaignTone({ total: 25, done: 0, atRisk: 0, nobody: 20, waiting: 0 })).toBe('risk')
    expect(campaignTone({ total: 4, done: 4 - 1, atRisk: 0, nobody: 0, waiting: 1 })).toBe('warn')
    expect(campaignTone({ total: 8, done: 0, atRisk: 0, nobody: 0, waiting: 0 })).toBe('blue')
  })
})
