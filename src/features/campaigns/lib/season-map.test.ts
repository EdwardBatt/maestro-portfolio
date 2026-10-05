import { describe, expect, it } from 'vitest'
import type { DeliverableRow } from '../../deliverables/api/deliverables-api'
import type { WorkPhase } from '../../../lib/deliverables/work-phase'
import type { CampaignPhase } from '../api/campaign-detail-api'
import { mapColumns, mapRows, NO_DATE, NO_PHASE, orderSquares, squareStatus, weekColumns, weekOf, weekStartDay } from './season-map'

const NOW = Date.parse('2026-09-24T09:00:00Z')

const piece = (over: Partial<DeliverableRow> & { phase?: WorkPhase } = {}): DeliverableRow => {
  const { phase = 'in_progress', ...rest } = over
  return {
    id: 'd1', name: 'Piece', state: 'in_progress', dueAt: '2099-01-01T15:00:00Z', revisionRound: 0, revisionLimit: null,
    streamId: 's', streamName: null, taskCount: 1, unassignedCount: 0, typeName: null, ownerUserId: null, ownerName: null,
    progress: { phase, total: 1, unassigned: 0, done: 0, everTotal: 1, inReview: 0, inProgress: 0, notStarted: 0 }, assigneeNames: [], assignerNames: [],
    blockingReviewers: { names: [], allRequired: false }, discipline: 'Creative', departmentId: 'dep-c', campaignId: 'cam',
    approvedVersion: null, tasksApprovedAt: null, tasksApprovedBy: null, canApproveTasks: false, campaignKind: 'campaign',
    workstreamId: null, phaseId: null, code: null, taskList: [],
    ...rest,
  } as DeliverableRow
}

const PHASES: CampaignPhase[] = [
  { id: 'p2', number: 2, name: 'Week 1', startsOn: '2026-09-18', endsOn: '2026-09-25' },
  { id: 'p1', number: 1, name: 'Pre-launch', startsOn: '2026-09-12', endsOn: '2026-09-17' },
]

describe('squareStatus — one colour per piece (CG-02)', () => {
  it('reads delivered, approved (internal), review, progress and not started', () => {
    expect(squareStatus(piece({ state: 'delivered', phase: 'delivered' }), NOW)).toBe('delivered')
    expect(squareStatus(piece({ state: 'approved', phase: 'complete' }), NOW)).toBe('approved')
    expect(squareStatus(piece({ phase: 'in_review' }), NOW)).toBe('in_review')
    expect(squareStatus(piece({ phase: 'awaiting_signoff' }), NOW)).toBe('in_review')
    expect(squareStatus(piece({ phase: 'in_progress' }), NOW)).toBe('in_progress')
    expect(squareStatus(piece({ phase: 'not_started' }), NOW)).toBe('not_started')
    expect(squareStatus(piece({ phase: 'no_tasks' }), NOW)).toBe('not_started')
  })

  it('is red when late — unless the piece is already delivered or approved', () => {
    const past = '2026-09-01T15:00:00Z'
    expect(squareStatus(piece({ dueAt: past, phase: 'in_progress' }), NOW)).toBe('late')
    expect(squareStatus(piece({ dueAt: past, phase: 'in_review' }), NOW)).toBe('late')
    expect(squareStatus(piece({ dueAt: past, state: 'delivered', phase: 'delivered' }), NOW)).toBe('delivered')
    expect(squareStatus(piece({ dueAt: past, state: 'approved', phase: 'complete' }), NOW)).toBe('approved')
  })

  it('a piece waiting on an outstanding input is WAITING, as on the Board; late still wins', () => {
    const past = '2026-09-01T15:00:00Z'
    expect(squareStatus(piece({ phase: 'in_progress' }), NOW, 1)).toBe('waiting')
    expect(squareStatus(piece({ phase: 'not_started', state: 'blocked' }), NOW)).toBe('waiting')
    expect(squareStatus(piece({ dueAt: past, phase: 'in_progress' }), NOW, 1)).toBe('late')
    expect(squareStatus(piece({ state: 'delivered', phase: 'delivered' }), NOW, 2)).toBe('delivered')
  })
})

describe('mapColumns — the phases in order, today highlighted', () => {
  it('orders by number and marks the phase today falls in', () => {
    const cols = mapColumns(PHASES, [piece({ phaseId: 'p1' })], '2026-09-24')
    expect(cols.map((c) => c.key)).toEqual(['p1', 'p2'])
    expect(cols.map((c) => c.current)).toEqual([false, true])
  })

  it('adds "No phase" only when a live piece has none', () => {
    expect(mapColumns(PHASES, [piece({ phaseId: 'p1' })], '2026-09-24').some((c) => c.key === NO_PHASE)).toBe(false)
    expect(mapColumns(PHASES, [piece({ phaseId: null })], '2026-09-24').at(-1)?.key).toBe(NO_PHASE)
    // An archived piece will not be made: it does not open a column.
    expect(mapColumns(PHASES, [piece({ phaseId: null, state: 'archived' })], '2026-09-24').some((c) => c.key === NO_PHASE)).toBe(false)
  })
})

describe('mapRows — workstream × phase', () => {
  it('rows are workstreams, with "Not in a workstream" for the rest; archived pieces are left out', () => {
    const pieces = [
      piece({ id: 'a', workstreamId: 'w1', phaseId: 'p1', state: 'delivered', phase: 'delivered' }),
      piece({ id: 'b', workstreamId: 'w1', phaseId: 'p2' }),
      piece({ id: 'c', workstreamId: null, phaseId: null }),
      piece({ id: 'z', workstreamId: 'w1', phaseId: 'p1', state: 'archived' }),
    ]
    const cols = mapColumns(PHASES, pieces, '2026-09-24')
    const rows = mapRows(pieces, [{ id: 'w1', name: 'Design', ownerName: null }], cols, NOW)
    expect(rows.map((r) => r.group.key)).toEqual(['w1', 'none'])
    expect(rows[0].group.total).toBe(2)
    expect(rows[0].group.delivered).toBe(1)
    expect(rows[0].cells.get('p1')?.map((s) => s.piece.id)).toEqual(['a'])
    expect(rows[0].cells.get('p2')?.map((s) => s.piece.id)).toEqual(['b'])
    expect(rows[1].cells.get(NO_PHASE)?.map((s) => s.piece.id)).toEqual(['c'])
  })

  it('groups by department when the campaign has no workstreams', () => {
    const pieces = [piece({ id: 'a', departmentId: 'dep-c', discipline: 'Creative', phaseId: 'p1' }), piece({ id: 'b', departmentId: 'dep-m', discipline: 'Media', phaseId: 'p1' })]
    const rows = mapRows(pieces, [], mapColumns(PHASES, pieces, '2026-09-24'), NOW)
    expect(rows.map((r) => [r.group.kind, r.group.name])).toEqual([['department', 'Creative'], ['department', 'Media']])
  })

  it('a cell reads done first, untouched last', () => {
    const squares = orderSquares([
      piece({ id: 'n', phase: 'not_started', code: 'A-1' }),
      piece({ id: 'd', state: 'delivered', phase: 'delivered', code: 'A-2' }),
      piece({ id: 'p', phase: 'in_progress', code: 'A-3' }),
    ], NOW)
    expect(squares.map((s) => s.piece.id)).toEqual(['d', 'p', 'n'])
  })
})

describe('a campaign without phases is mapped by week (I63.5, Edward 28 Sep)', () => {
  it("starts the week on the client's first working day", () => {
    expect(weekStartDay([7, 1, 2, 3, 4])).toBe(7) // Iraq: Sunday
    expect(weekStartDay([1, 2, 3, 4, 5])).toBe(1) // the UAE: Monday
    expect(weekOf('2026-10-01', 7)).toBe('2026-09-27') // Thursday 1 Oct is in the week of Sunday 27 Sep
    expect(weekOf('2026-10-01', 1)).toBe('2026-09-28')
  })

  it('has every week from the first piece due to the last, a quiet week kept, then No date', () => {
    const pieces = [
      piece({ id: 'a', dueAt: '2026-09-24T12:00:00Z' }),
      piece({ id: 'b', dueAt: '2026-10-08T12:00:00Z' }),
      piece({ id: 'c', dueAt: null }),
    ]
    const cols = weekColumns(pieces, '2026-09-28', 7)
    expect(cols.map((c) => c.key)).toEqual(['week:2026-09-20', 'week:2026-09-27', 'week:2026-10-04', NO_DATE])
    expect(cols.map((c) => c.week?.number ?? null)).toEqual([1, 2, 3, null])
    expect(cols.map((c) => c.current)).toEqual([false, true, false, false])
  })

  it('puts each square in the week it is due, and one without a date under No date', () => {
    const pieces = [
      piece({ id: 'a', dueAt: '2026-09-24T12:00:00Z', code: 'A' }),
      piece({ id: 'b', dueAt: '2026-09-22T12:00:00Z', code: 'B' }),
      piece({ id: 'c', dueAt: null, code: 'C' }),
    ]
    const cols = weekColumns(pieces, '2026-09-28', 7)
    const [row] = mapRows(pieces, [], cols, NOW)
    expect(row!.cells.get('week:2026-09-20')!.map((s) => s.piece.id).sort()).toEqual(['a', 'b'])
    expect(row!.cells.get(NO_DATE)!.map((s) => s.piece.id)).toEqual(['c'])
  })
})
