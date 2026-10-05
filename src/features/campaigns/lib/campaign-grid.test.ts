import { describe, expect, it } from 'vitest'
import type { CampaignTask, DeliverableRow } from '../../deliverables/api/deliverables-api'
import { executedBy, gridGroups, needsApproval, NO_FILTERS, ownersOf } from './campaign-grid'

const task = (over: Partial<CampaignTask> = {}): CampaignTask => ({
  id: 't', title: 'Create artwork', hours: 8, status: 'todo', assigneeName: null, startsAt: null, dueAt: null, ...over,
})

const piece = (id: string, over: Partial<DeliverableRow> = {}): DeliverableRow => ({
  id,
  name: `Piece ${id}`,
  state: 'in_progress',
  dueAt: null,
  revisionRound: 0,
  revisionLimit: null,
  streamId: 's',
  streamName: null,
  taskCount: 1,
  unassignedCount: 0,
  typeName: 'Carousel',
  ownerUserId: 'fadia',
  ownerName: 'Fadia',
  progress: { phase: 'in_progress', total: 1, unassigned: 0, done: 0, everTotal: 1, inReview: 0, inProgress: 0, notStarted: 0 },
  assigneeNames: [],
  assignerNames: [],
  blockingReviewers: { names: [], allRequired: false },
  discipline: 'Creative',
  departmentId: 'creative',
  campaignId: 'c',
  approvedVersion: null,
  tasksApprovedAt: '2026-09-20T08:00:00Z',
  tasksApprovedBy: null,
  canApproveTasks: false,
  campaignKind: 'campaign',
  workstreamId: null,
  taskList: [task()],
  ...over,
})

describe('gridGroups — CG-01, grouped by workstream (I57.5)', () => {
  const ws = [
    { id: 'da', name: 'Design & Animation', ownerName: 'Inas' },
    { id: 'ia', name: 'In-App', ownerName: 'Rowan' },
  ]

  it('groups by workstream in the campaign\'s order, with the owner who manages it and its delivered count', () => {
    const g = gridGroups(
      [piece('1', { workstreamId: 'da' }), piece('2', { workstreamId: 'da', state: 'delivered' }), piece('3', { workstreamId: 'ia' })],
      ws,
      NO_FILTERS,
    )
    expect(g.map((x) => [x.name, x.rows.length, x.delivered, x.managerName])).toEqual([
      ['Design & Animation', 2, 1, 'Inas'],
      ['In-App', 1, 0, 'Rowan'],
    ])
  })

  it('pieces outside every workstream get a group of their own; an empty workstream shows no group', () => {
    const g = gridGroups([piece('1', { workstreamId: 'da' }), piece('2')], ws, NO_FILTERS)
    expect(g.map((x) => [x.key, x.kind])).toEqual([['da', 'workstream'], ['none', 'none']])
  })

  it('a campaign with no workstreams groups by department', () => {
    const g = gridGroups(
      [piece('1'), piece('2', { departmentId: 'prod', discipline: 'Production' })],
      [],
      NO_FILTERS,
    )
    expect(g.map((x) => [x.name, x.kind])).toEqual([['Creative', 'department'], ['Production', 'department']])
  })

  it('a closed piece is not on the grid', () => {
    const g = gridGroups([piece('1'), piece('2', { state: 'archived' })], [], NO_FILTERS)
    expect(g[0].rows.map((d) => d.id)).toEqual(['1'])
    expect(g[0].total).toBe(1)
  })

  it('filters narrow the rows but the group line still counts the whole group', () => {
    const rows = [
      piece('1', { workstreamId: 'da', phaseId: 'w1' }),
      piece('2', { workstreamId: 'da', phaseId: 'w2', tasksApprovedAt: null }),
      piece('3', { workstreamId: 'ia', ownerUserId: 'jaafar', ownerName: 'Jaafar' }),
    ]
    const only = (f: Partial<typeof NO_FILTERS>) =>
      gridGroups(rows, ws, { ...NO_FILTERS, ...f }).flatMap((g) => g.rows.map((d) => d.id))
    expect(only({ phase: 'w2' })).toEqual(['2'])
    expect(only({ workstream: 'ia' })).toEqual(['3'])
    expect(only({ owner: 'jaafar' })).toEqual(['3'])
    expect(only({ needsApproval: true })).toEqual(['2'])
    expect(gridGroups(rows, ws, { ...NO_FILTERS, phase: 'w2' })[0].total).toBe(2)
  })

  it('filters by where the work is', () => {
    const rows = [piece('1'), piece('2', { progress: { phase: 'in_review', total: 1, unassigned: 0, done: 0, everTotal: 1, inReview: 0, inProgress: 0, notStarted: 0 } })]
    expect(gridGroups(rows, [], { ...NO_FILTERS, status: 'in_review' })[0].rows.map((d) => d.id)).toEqual(['2'])
  })

  it('the "none" workstream filter picks the pieces in no workstream', () => {
    const g = gridGroups([piece('1', { workstreamId: 'da' }), piece('2')], ws, { ...NO_FILTERS, workstream: 'none' })
    expect(g.flatMap((x) => x.rows.map((d) => d.id))).toEqual(['2'])
  })
})

describe('executedBy — every person on the piece, not one', () => {
  it('names each assignee once, in task order, and counts the live tasks nobody has', () => {
    const d = piece('1', {
      taskList: [
        task({ id: 'a', assigneeName: 'Zubaida', status: 'done' }),
        task({ id: 'b', assigneeName: 'Lisa', status: 'review' }),
        task({ id: 'c', assigneeName: 'Zubaida', status: 'in_progress' }),
        task({ id: 'd', assigneeName: null, status: 'todo' }),
        task({ id: 'e', assigneeName: null, status: 'todo' }),
      ],
    })
    expect(executedBy(d)).toEqual({ names: ['Zubaida', 'Lisa'], unassigned: 2 })
  })
  it('a piece with no tasks has nobody and nothing unassigned', () => {
    expect(executedBy(piece('1', { taskList: [] }))).toEqual({ names: [], unassigned: 0 })
  })
})

describe('needsApproval and ownersOf', () => {
  it('a list waits for approval only when it has tasks and nobody has approved it', () => {
    expect(needsApproval(piece('1', { tasksApprovedAt: null }))).toBe(true)
    expect(needsApproval(piece('1', { tasksApprovedAt: null, taskCount: 0 }))).toBe(false)
    expect(needsApproval(piece('1'))).toBe(false)
  })
  it('offers each owner once, sorted, leaving out closed pieces', () => {
    expect(ownersOf([piece('1'), piece('2'), piece('3', { ownerUserId: 'b', ownerName: 'Abeer' }), piece('4', { ownerUserId: 'z', ownerName: 'Zed', state: 'archived' })]))
      .toEqual([{ id: 'b', name: 'Abeer' }, { id: 'fadia', name: 'Fadia' }])
  })
})
