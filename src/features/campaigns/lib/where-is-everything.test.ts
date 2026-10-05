import { describe, expect, it } from 'vitest'
import type { CampaignTask, DeliverableRow } from '../../deliverables/api/deliverables-api'
import { assessRisk, type RiskAssessment } from '../../../lib/deadlines/at-risk'
import {
  clockOf,
  defaultPhase,
  durationSince,
  filterRows,
  nextStep,
  pieceSince,
  sinceOf,
  whereRows,
  whereStatus,
  type PieceRisk,
} from './where-is-everything'

const task = (over: Partial<CampaignTask> = {}): CampaignTask => ({
  id: 't', title: 'Create artwork', hours: 8, status: 'todo', assigneeName: 'Zubaida', startsAt: null, dueAt: null, ...over,
})

const piece = (id: string, over: Partial<DeliverableRow> = {}): DeliverableRow => ({
  id,
  name: `Piece ${id}`,
  code: `DA-${id}`,
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
  progress: { phase: 'not_started', total: 1, unassigned: 0, done: 0, everTotal: 1, inReview: 0, inProgress: 0, notStarted: 0 },
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

const phase = (p: DeliverableRow['progress']['phase']) => ({ phase: p, total: 1, unassigned: 0, done: 0, everTotal: 1, inReview: 0, inProgress: 0, notStarted: 0 })
const assessment = (level: RiskAssessment['level'], lateByWorkingDays = 0): RiskAssessment => ({ level, reasons: [], waiting: [], lateByWorkingDays })
const risk = (level: RiskAssessment['level'], over: Partial<PieceRisk> = {}): PieceRisk => ({
  assessment: assessment(level, level === 'late' ? 2 : 0), outstandingInputs: 0, since: null, waitingSince: null, ...over,
})

describe('whereStatus — where the piece is (CG-03, I57.10)', () => {
  it('delivered is delivered; approved (the internal approval) is with the client', () => {
    expect(whereStatus(piece('1', { state: 'delivered' }), 0)).toBe('delivered')
    expect(whereStatus(piece('1', { state: 'approved' }), 0)).toBe('with_client')
    // finished outranks an outstanding input
    expect(whereStatus(piece('1', { state: 'approved' }), 2)).toBe('with_client')
  })

  it('an outstanding input is Waiting — never "blocked" — whatever the tasks say', () => {
    expect(whereStatus(piece('1', { progress: phase('in_progress') }), 1)).toBe('waiting')
    expect(whereStatus(piece('1', { state: 'blocked', progress: phase('blocked') }), 0)).toBe('waiting')
  })

  it('reads the tasks: in review (and every task done, awaiting sign-off), in progress', () => {
    expect(whereStatus(piece('1', { progress: phase('in_review') }), 0)).toBe('in_review')
    expect(whereStatus(piece('1', { progress: phase('awaiting_signoff') }), 0)).toBe('in_review')
    expect(whereStatus(piece('1', { progress: phase('in_progress') }), 0)).toBe('in_progress')
  })

  it('unassigned: a live task nobody has, or a task list its owner has not approved', () => {
    expect(whereStatus(piece('1', { taskList: [task({ assigneeName: null })] }), 0)).toBe('unassigned')
    expect(whereStatus(piece('1', { tasksApprovedAt: null }), 0)).toBe('unassigned')
    // a done task with nobody on it is not unassigned work
    expect(whereStatus(piece('1', { taskList: [task(), task({ id: 'd', status: 'done', assigneeName: null })] }), 0)).toBe('not_started')
    // without the task list, the row's own count
    expect(whereStatus(piece('1', { taskList: undefined, unassignedCount: 1 }), 0)).toBe('unassigned')
  })

  it('not started: everything given out and nobody has pressed Start, or no tasks at all', () => {
    expect(whereStatus(piece('1'), 0)).toBe('not_started')
    expect(whereStatus(piece('1', { taskCount: 0, taskList: [], progress: phase('no_tasks'), tasksApprovedAt: null }), 0)).toBe('not_started')
  })
})

describe('nextStep — the one thing that moves it', () => {
  const next = (d: DeliverableRow, inputs = 0) => nextStep(d, whereStatus(d, inputs), inputs)
  it('names the step for every status', () => {
    expect(next(piece('1', { state: 'delivered' }))).toEqual({ kind: 'delivered' })
    expect(next(piece('1', { state: 'approved' }))).toEqual({ kind: 'clientSignsOff' })
    expect(next(piece('1'), 2)).toEqual({ kind: 'inputs', count: 2 })
    expect(next(piece('1', { state: 'blocked' }))).toEqual({ kind: 'inputArrives' })
    expect(next(piece('1', { progress: phase('in_review') }))).toEqual({ kind: 'approveOrChanges' })
    expect(next(piece('1', { progress: phase('awaiting_signoff') }))).toEqual({ kind: 'ownerApproves' })
    expect(next(piece('1', { progress: phase('in_progress') }))).toEqual({ kind: 'goesForReview' })
    expect(next(piece('1', { tasksApprovedAt: null }))).toEqual({ kind: 'ownerApprovesList' })
    expect(next(piece('1', { taskList: [task({ assigneeName: null })] }))).toEqual({ kind: 'ownerGivesIt' })
    expect(next(piece('1', { taskCount: 0, taskList: [] }))).toEqual({ kind: 'ownerPlans' })
    expect(next(piece('1'))).toEqual({ kind: 'someoneStarts' })
  })

  it('a piece not started gives the earliest start of its tasks', () => {
    const d = piece('1', {
      taskCount: 2,
      taskList: [task({ id: 'a', startsAt: '2026-09-28T05:00:00Z' }), task({ id: 'b', startsAt: '2026-09-26T05:00:00Z' })],
    })
    expect(next(d)).toEqual({ kind: 'startsOn', at: '2026-09-26T05:00:00Z' })
  })
})

describe('clockOf — the at-risk rule (I57 answer 11)', () => {
  it('late by N working days, at risk, waiting, on time; nothing once finished or before the read answers', () => {
    expect(clockOf(risk('late'))).toEqual({ tone: 'late', days: 2 })
    expect(clockOf(risk('at_risk'))).toEqual({ tone: 'at_risk', days: 0 })
    expect(clockOf(risk('waiting'))).toEqual({ tone: 'waiting', days: 0 })
    expect(clockOf(risk('on_time'))).toEqual({ tone: 'on_time', days: 0 })
    expect(clockOf(risk('done'))).toBeNull()
    expect(clockOf(undefined)).toBeNull()
  })

  it('agrees with assessRisk: a piece past its date is late', () => {
    const now = Date.parse('2026-09-24T09:00:00Z')   // Thursday
    const a = assessRisk({ state: 'in_progress', dueAt: '2026-09-21T15:00:00Z', taskListApprovedAt: null, tasks: [] }, { now })
    expect(clockOf({ assessment: a, outstandingInputs: 0, since: null, waitingSince: null })).toEqual({ tone: 'late', days: a.lateByWorkingDays })
    expect(a.lateByWorkingDays).toBeGreaterThan(0)
  })
})

describe('for how long', () => {
  const now = Date.parse('2026-09-24T12:00:00Z')
  it('under an hour, hours under a day, whole days after', () => {
    expect(durationSince('2026-09-24T11:30:00Z', now)).toEqual({ unit: 'under_hour' })
    expect(durationSince('2026-09-24T09:00:00Z', now)).toEqual({ unit: 'hours', n: 3 })
    expect(durationSince('2026-09-23T11:00:00Z', now)).toEqual({ unit: 'days', n: 1 })
    expect(durationSince('2026-09-22T11:00:00Z', now)).toEqual({ unit: 'days', n: 2 })
    expect(durationSince(null, now)).toBeNull()
    expect(durationSince('not a date', now)).toBeNull()
  })

  it('Waiting counts from the oldest input; delivered counts nothing', () => {
    const r = risk('waiting', { since: '2026-09-01T00:00:00Z', waitingSince: '2026-09-20T00:00:00Z' })
    expect(sinceOf('waiting', r)).toBe('2026-09-20T00:00:00Z')
    expect(sinceOf('in_progress', r)).toBe('2026-09-01T00:00:00Z')
    expect(sinceOf('delivered', r)).toBeNull()
    expect(sinceOf('in_progress', undefined)).toBeNull()
  })

  it('pieceSince: approval, the latest submission, the earliest start, the list approval, creation', () => {
    const p = { state: 'in_progress' as const, tasksApprovedAt: '2026-09-10T00:00:00Z', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-22T00:00:00Z' }
    expect(pieceSince({ ...p, state: 'approved' }, [])).toBe('2026-09-22T00:00:00Z')
    expect(pieceSince(p, [
      { status: 'review', submittedAt: '2026-09-21T00:00:00Z', startedAt: null },
      { status: 'review', submittedAt: '2026-09-23T00:00:00Z', startedAt: null },
      { status: 'in_progress', submittedAt: null, startedAt: '2026-09-12T00:00:00Z' },
    ])).toBe('2026-09-23T00:00:00Z')
    expect(pieceSince(p, [
      { status: 'in_progress', submittedAt: null, startedAt: '2026-09-15T00:00:00Z' },
      { status: 'in_progress', submittedAt: null, startedAt: '2026-09-12T00:00:00Z' },
    ])).toBe('2026-09-12T00:00:00Z')
    expect(pieceSince(p, [{ status: 'todo', submittedAt: null, startedAt: null }])).toBe('2026-09-10T00:00:00Z')
    expect(pieceSince({ ...p, tasksApprovedAt: null }, [])).toBe('2026-09-01T00:00:00Z')
  })
})

describe('whereRows — urgency order', () => {
  it('late first (the latest first), then at risk, then by due date; finished last; closed pieces left out', () => {
    const pieces = [
      piece('ontime-late-due', { dueAt: '2026-10-05T00:00:00Z' }),
      piece('ontime-early-due', { dueAt: '2026-09-26T00:00:00Z' }),
      piece('no-date'),
      piece('atrisk', { dueAt: '2026-10-10T00:00:00Z' }),
      piece('late1', { dueAt: '2026-09-22T00:00:00Z' }),
      piece('late5', { dueAt: '2026-09-15T00:00:00Z' }),
      piece('done', { state: 'delivered', dueAt: '2026-09-01T00:00:00Z' }),
      piece('closed', { state: 'archived' }),
    ]
    const map = new Map<string, PieceRisk>([
      ['ontime-late-due', risk('on_time')],
      ['ontime-early-due', risk('on_time')],
      ['no-date', risk('waiting')],
      ['atrisk', risk('at_risk')],
      ['late1', { ...risk('late'), assessment: assessment('late', 1) }],
      ['late5', { ...risk('late'), assessment: assessment('late', 5) }],
      ['done', risk('done')],
    ])
    expect(whereRows(pieces, map).map((r) => r.piece.id)).toEqual([
      'late5', 'late1', 'atrisk', 'ontime-early-due', 'ontime-late-due', 'no-date', 'done',
    ])
  })
})

describe('filters', () => {
  const rows = whereRows(
    [
      piece('a', { phaseId: 'w1', workstreamId: 'da', ownerUserId: 'fadia' }),
      piece('b', { phaseId: 'w2', workstreamId: null, ownerUserId: 'jaafar', progress: phase('in_progress') }),
      piece('c', { phaseId: 'w1', workstreamId: 'da', ownerUserId: 'jaafar', state: 'delivered' }),
    ],
    new Map(),
  )
  const ids = (f: Partial<Parameters<typeof filterRows>[1]>) =>
    filterRows(rows, { phase: '', workstream: '', owner: '', status: '', ...f }).map((r) => r.piece.id).sort()

  it('narrows by phase, workstream (and "not in one"), owner and where it is', () => {
    expect(ids({})).toEqual(['a', 'b', 'c'])
    expect(ids({ phase: 'w1' })).toEqual(['a', 'c'])
    expect(ids({ workstream: 'da' })).toEqual(['a', 'c'])
    expect(ids({ workstream: 'none' })).toEqual(['b'])
    expect(ids({ owner: 'jaafar' })).toEqual(['b', 'c'])
    expect(ids({ status: 'delivered' })).toEqual(['c'])
    expect(ids({ status: 'in_progress', owner: 'fadia' })).toEqual([])
  })

  it('defaultPhase: the phase today falls in; all when today is in none, or that phase holds no piece', () => {
    const phases = [
      { id: 'w1', startsOn: '2026-09-21', endsOn: '2026-09-27' },
      { id: 'w2', startsOn: '2026-09-28', endsOn: '2026-10-04' },
    ]
    const pieces = [piece('a', { phaseId: 'w1' })]
    expect(defaultPhase(phases, pieces, Date.parse('2026-09-24T09:00:00Z'))).toBe('w1')
    expect(defaultPhase(phases, pieces, Date.parse('2026-10-01T09:00:00Z'))).toBe('')   // w2 is empty
    expect(defaultPhase(phases, pieces, Date.parse('2026-11-01T09:00:00Z'))).toBe('')
    expect(defaultPhase([], pieces, Date.parse('2026-09-24T09:00:00Z'))).toBe('')
    // Iraq days: 22:30 UTC on the 27th is already the 28th in Baghdad — week 2
    expect(defaultPhase(phases, [piece('b', { phaseId: 'w2' })], Date.parse('2026-09-27T22:30:00Z'))).toBe('w2')
  })
})
