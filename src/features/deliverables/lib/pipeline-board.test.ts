import { describe, expect, it } from 'vitest'
import { boardStages, buildBoard, buildPhaseGrid, PIPELINE_STAGES } from './pipeline-board'
import type { WorkPhase } from '../../../lib/deliverables/work-phase'
import type { DeliverableRow } from '../api/deliverables-api'

const mk = (o: Partial<DeliverableRow> & { id: string }): DeliverableRow => ({
  name: o.id,
  state: 'draft',
  dueAt: null,
  revisionRound: 0,
  ownerUserId: null,
  ownerName: null,
  typeName: null,
  taskCount: 0,
  unassignedCount: 0,
  revisionLimit: null,
  streamId: 's1',
  workstreamId: null,
  streamName: 'Art',
  discipline: 'Creative',
  departmentId: null,
  campaignId: 'cam1',
  approvedVersion: null,
  // I40.22: where the work actually is, derived from the tasks. Fixtures here carry no tasks.
  progress: { phase: 'no_tasks', total: 0, unassigned: 0, done: 0, everTotal: 0, inReview: 0, inProgress: 0, notStarted: 0 },
  assigneeNames: [],
  assignerNames: [],
  blockingReviewers: { names: [], allRequired: false },
  tasksApprovedAt: null,
  tasksApprovedBy: null,
  canApproveTasks: false,
  campaignKind: 'campaign',
  ...o,
})

const phase = (p: WorkPhase): DeliverableRow['progress'] => ({ phase: p, total: 1, unassigned: 0, done: 0, everTotal: 1, inReview: 0, inProgress: 0, notStarted: 0 })

describe('pipeline board (ADR-0024, I2.4)', () => {
  // 20 Sep: the lane is the DEPARTMENT. A campaign has one stream (ADR-0050), so a lane per stream
  // put every deliverable in one lane named after whichever department came first.
  it('one swimlane per department, deliverables bucketed by state', () => {
    const board = buildBoard([
      mk({ id: 'a', departmentId: 'd1', progress: phase('not_started') }),
      mk({ id: 'b', departmentId: 'd1', progress: phase('in_review') }),
      mk({ id: 'c', departmentId: 'd2', discipline: 'Production', progress: phase('complete') }),
    ])
    expect(board).toHaveLength(2)
    const art = board.find((l) => l.laneId === 'd1')!
    expect(art.columns.not_started.map((d) => d.id)).toEqual(['a'])
    expect(art.columns.in_review.map((d) => d.id)).toEqual(['b'])
    expect(art.count).toBe(2)
  })

  it('drops archived deliverables', () => {
    const board = buildBoard([mk({ id: 'a', state: 'archived' }), mk({ id: 'b', state: 'draft' })])
    expect(board).toHaveLength(1)
    expect(board[0].count).toBe(1)
  })

  it('orders cards in a column by due date, undated last', () => {
    const board = buildBoard([
      mk({ id: 'late', dueAt: '2026-09-10T00:00:00Z' }),
      mk({ id: 'none', dueAt: null }),
      mk({ id: 'soon', dueAt: '2026-09-01T00:00:00Z' }),
    ])
    expect(board[0].columns.no_tasks.map((d) => d.id)).toEqual(['soon', 'late', 'none'])
  })

  it('orders swimlanes by department name, the unowned lane last', () => {
    const board = buildBoard([
      mk({ id: 'a', departmentId: 'd2', discipline: 'Production' }),
      mk({ id: 'n', departmentId: null, discipline: null }),
      mk({ id: 'b', departmentId: 'd1', discipline: 'Creative' }),
    ])
    expect(board.map((l) => l.discipline)).toEqual(['Creative', 'Production', null])
  })

  // ADR-0096 d.12: phases down, departments across — the team's sheet as a board.
  describe('buildPhaseGrid', () => {
    const phases = [
      { id: 'p1', number: 1, name: 'Pre-Launch', startsOn: '2026-09-21', endsOn: '2026-09-27' },
      { id: 'p2', number: 2, name: 'Week 1', startsOn: '2026-09-28', endsOn: '2026-10-04' },
    ]
    it('lays every phase out as a row, even an empty one, and the departments as columns', () => {
      const grid = buildPhaseGrid([
        mk({ id: 'a', departmentId: 'd1', discipline: 'Creative', phaseId: 'p1', progress: phase('not_started') }),
        mk({ id: 'b', departmentId: 'd2', discipline: 'Production', phaseId: 'p1', progress: phase('delivered') }),
      ], phases)
      expect(grid.columns.map((c) => [c.name, c.total])).toEqual([['Creative', 1], ['Production', 1]])
      expect(grid.rows.map((r) => r.phase?.name)).toEqual(['Pre-Launch', 'Week 1'])
      expect(grid.rows[0].cells.d1.map((d) => d.id)).toEqual(['a'])
      expect(grid.rows[0]).toMatchObject({ total: 2, done: 1 })
      expect(grid.rows[1]).toMatchObject({ total: 0, done: 0 })
    })
    it('keeps a deliverable with no phase visible, in a last row of its own', () => {
      const grid = buildPhaseGrid([mk({ id: 'x', departmentId: 'd1', phaseId: null })], phases)
      expect(grid.rows).toHaveLength(3)
      expect(grid.rows[2].phase).toBeNull()
      expect(grid.rows[2].cells.d1.map((d) => d.id)).toEqual(['x'])
    })
    it('drops archived rows and sorts a cell by due date', () => {
      const grid = buildPhaseGrid([
        mk({ id: 'late', departmentId: 'd1', phaseId: 'p1', dueAt: '2026-09-26T15:00:00Z' }),
        mk({ id: 'gone', departmentId: 'd1', phaseId: 'p1', state: 'archived' }),
        mk({ id: 'soon', departmentId: 'd1', phaseId: 'p1', dueAt: '2026-09-22T15:00:00Z' }),
      ], phases)
      expect(grid.rows[0].cells.d1.map((d) => d.id)).toEqual(['soon', 'late'])
      expect(grid.columns[0].total).toBe(2)
    })
  })

  // The columns are where the WORK is (I40.22), never the container's own state.
  it('adds the blocked and cancelled columns only when something is', () => {
    expect(boardStages([mk({ id: 'a' })])).toEqual(PIPELINE_STAGES)
    expect(boardStages([mk({ id: 'a', progress: phase('blocked') })])).toEqual([...PIPELINE_STAGES, 'blocked'])
    expect(boardStages([mk({ id: 'a', progress: phase('cancelled') })])).toEqual([...PIPELINE_STAGES, 'cancelled'])
  })
})
