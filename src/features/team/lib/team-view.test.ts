import { describe, expect, it } from 'vitest'
import type { TeamLoadGroup, TeamLoadPerson } from '../api/team-api'
import type { TeamTask } from '../api/team-view-api'
import { roundClocks } from '../api/team-view-api'
import {
  applyPieceFilter,
  assignDialogReason,
  durationSince,
  hoursPerDayOf,
  inNobodyYet,
  timeInState,
  barState,
  freeDaysOf,
  groupPct,
  isLate,
  layoutBars,
  loadSentence,
  personLine,
  resolveScope,
  sectionsFor,
  sortByPiece,
  startOfWeekUtc,
  taskLabel,
  timelineStatus,
  weekDays,
  workstreamsOnScreen,
  type BarBooking,
} from './team-view'

const person = (over: Partial<TeamLoadPerson>): TeamLoadPerson => ({
  id: 'p', name: 'P', nickname: null, teamId: null, teamName: null, departmentId: 'D1', departmentName: 'Creative',
  bookedHours: 0, bookingCount: 0, nominalHours: 40, utilPct: 0, warnPct: 100, ceilingPct: 120, level: 'ok', over: false,
  ...over,
})

const GROUPS: TeamLoadGroup[] = [
  { key: 'team:Art', label: 'Art & Video', kind: 'team', people: [
    person({ id: 'zubaida', name: 'Zubaida', teamId: 'T1', teamName: 'Art & Video', bookedHours: 36, utilPct: 90 }),
    person({ id: 'fadia', name: 'Fadia', teamId: 'T1', teamName: 'Art & Video', bookedHours: 12, utilPct: 30 }),
  ] },
  { key: 'team:Copy', label: 'Copy', kind: 'team', people: [
    person({ id: 'abeer', name: 'Abeer', teamId: 'T2', teamName: 'Copy', bookedHours: 22, utilPct: 55 }),
  ] },
  { key: 'dept:Creative', label: 'Creative', kind: 'department', people: [
    person({ id: 'lead', name: 'Creative lead', bookedHours: 4, utilPct: 10 }),
  ] },
  { key: 'team:Perf', label: 'Performance', kind: 'team', people: [
    person({ id: 'omar', name: 'Omar', teamId: 'T9', teamName: 'Performance', departmentId: 'D9', departmentName: 'Perf' }),
  ] },
]

const task = (over: Partial<TeamTask>): TeamTask => ({
  id: 't', title: 'Design', deliverableId: 'd', pieceName: 'Post 2', campaignId: 'c', campaignName: 'LUMA',
  workstreamId: null, workstreamName: null, status: 'in_progress', revisionNumber: 0, assigneeId: 'u1',
  startsAt: null, dueAt: null, committedDueAt: null, hours: 8, departmentId: 'D1', teamId: null,
  deliverableDueAt: null, goLiveAt: null, waitingOn: null,
  ownerId: null, deliverableDepartmentId: null, reviewerIds: ['rev'],
  assignedAt: null, tasksApprovedAt: null, roundStartedAt: null, roundSentAt: null, blockedSince: null,
  ...over,
})

const SUN = Date.parse('2026-09-20T00:00:00Z')
const DAYS = weekDays(SUN)
const H = 3_600_000
const booking = (id: string, resourceId: string, subTaskId: string, day: number): BarBooking =>
  ({ id, resourceId, subTaskId, start: SUN + day * 86_400_000 + 6 * H, end: SUN + day * 86_400_000 + 14 * H })
const NOW = Date.parse('2026-09-22T09:00:00Z')

describe('resolveScope — who sees what (ADR-0105 d.4)', () => {
  const depts = [{ id: 'D2', name: 'Strategy' }, { id: 'D1', name: 'Creative' }]
  it('a team lead or deputy sees their team', () => {
    expect(resolveScope({ scope: 'team', teamId: 'T1', departmentId: 'D1' }, 'D2', depts)).toEqual({ kind: 'team', id: 'T1' })
  })
  it('a department lead sees their department, with no picker', () => {
    expect(resolveScope({ scope: 'department', teamId: null, departmentId: 'D1' }, 'D2', depts)).toEqual({ kind: 'department', id: 'D1', picker: false })
  })
  it('a scoped role with no team yet is told so — never the whole org', () => {
    expect(resolveScope({ scope: 'team', teamId: null, departmentId: 'D1' }, null, depts)).toEqual({ kind: 'unplaced' })
    expect(resolveScope({ scope: 'department', teamId: null, departmentId: null }, null, depts)).toEqual({ kind: 'unplaced' })
  })
  it('anyone else picks: their own department first, else the first alphabetically', () => {
    expect(resolveScope({ scope: 'tenant', teamId: null, departmentId: 'D2' }, null, depts)).toEqual({ kind: 'department', id: 'D2', picker: true })
    expect(resolveScope({ scope: 'tenant', teamId: null, departmentId: null }, null, depts)).toEqual({ kind: 'department', id: 'D1', picker: true })
  })
  it('a pick wins, and a pick that no longer exists falls back', () => {
    expect(resolveScope({ scope: 'account', teamId: null, departmentId: null }, 'D2', depts)).toMatchObject({ id: 'D2' })
    expect(resolveScope({ scope: 'account', teamId: null, departmentId: null }, 'gone', depts)).toMatchObject({ id: 'D1' })
  })
  it('with no departments there is nothing to pick', () => {
    expect(resolveScope({ scope: 'tenant', teamId: null, departmentId: null }, null, [])).toEqual({ kind: 'empty' })
  })
})

describe('sectionsFor — rows and grouping', () => {
  it('a team is one section, no heading, its own people only, by name', () => {
    const s = sectionsFor(GROUPS, { kind: 'team', id: 'T1' })
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ kind: 'all', label: null })
    expect(s[0]!.people.map((p) => p.id)).toEqual(['fadia', 'zubaida'])
  })
  it('a department groups people under their team, each with its own %, then No team', () => {
    const s = sectionsFor(GROUPS, { kind: 'department', id: 'D1', picker: false })
    expect(s.map((x) => [x.kind, x.label])).toEqual([['team', 'Art & Video'], ['team', 'Copy'], ['none', null]])
    expect(s[0]!.pct).toBe(60) // (36 + 12) / 80
    expect(s[2]!.people.map((p) => p.id)).toEqual(['lead'])
    expect(s.flatMap((x) => x.people).some((p) => p.id === 'omar')).toBe(false) // another department
  })
  it('an unplaced viewer has no rows', () => {
    expect(sectionsFor(GROUPS, { kind: 'unplaced' })).toEqual([])
  })
  it('groupPct is booked over nominal', () => {
    expect(groupPct([person({ bookedHours: 20 }), person({ bookedHours: 0 })])).toBe(25)
    expect(groupPct([])).toBe(0)
  })
})

describe('the week', () => {
  it('starts on Sunday, UTC — the Schedule\'s spine', () => {
    expect(startOfWeekUtc(NOW)).toBe(SUN)
    expect(DAYS.map((d) => d.isoDate)).toEqual(['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26'])
  })
})

describe('layoutBars — one bar per task over its booked days (Q9)', () => {
  const rows = new Set(['zubaida', 'fadia'])
  it('joins a task\'s days into one bar on its person\'s row', () => {
    const bars = layoutBars([task({ id: 't1' })], [booking('b1', 'zubaida', 't1', 0), booking('b2', 'zubaida', 't1', 1)], DAYS, rows, NOW)
    expect(bars).toHaveLength(1)
    expect(bars[0]).toMatchObject({ taskId: 't1', resourceId: 'zubaida', from: 0, to: 1, lane: 0 })
  })
  it('stacks overlapping bars in lanes, and reuses a lane once it is free', () => {
    const bars = layoutBars(
      [task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c' })],
      [booking('1', 'zubaida', 'a', 0), booking('2', 'zubaida', 'a', 1), booking('3', 'zubaida', 'b', 1), booking('4', 'zubaida', 'c', 3)],
      DAYS, rows, NOW,
    )
    const lane = Object.fromEntries(bars.map((b) => [b.taskId, b.lane]))
    expect(lane).toEqual({ a: 0, b: 1, c: 0 })
  })
  it('puts work nobody has on the Nobody-yet row from start to due, clipped to the week', () => {
    const bars = layoutBars(
      [task({ id: 'u', assigneeId: null, startsAt: '2026-09-18T06:00:00Z', dueAt: '2026-09-23T14:00:00Z' })],
      [], DAYS, rows, NOW,
    )
    expect(bars[0]).toMatchObject({ resourceId: null, from: 0, to: 3, undated: false })
  })
  it('draws undated unassigned work on the first day, and skips work outside the week', () => {
    const bars = layoutBars(
      [task({ id: 'u1', assigneeId: null }), task({ id: 'u2', assigneeId: null, startsAt: '2026-10-05T06:00:00Z', dueAt: '2026-10-06T14:00:00Z' })],
      [], DAYS, rows, NOW,
    )
    expect(bars.map((b) => [b.taskId, b.from, b.to, b.undated])).toEqual([['u1', 0, 0, true]])
  })
  it('undated work takes no lane, so dated work nobody has keeps the first lane on its day', () => {
    const bars = layoutBars(
      [
        task({ id: 'a-undated', assigneeId: null }),
        task({ id: 'b-undated', assigneeId: null }),
        task({ id: 'c-dated', assigneeId: null, startsAt: '2026-09-20T06:00:00Z', dueAt: '2026-09-21T14:00:00Z' }),
      ],
      [], DAYS, rows, NOW,
    )
    expect(Object.fromEntries(bars.map((b) => [b.taskId, [b.undated, b.lane]]))).toEqual({
      'a-undated': [true, 0], 'b-undated': [true, 0], 'c-dated': [false, 0],
    })
  })
  it('ignores bookings on rows not shown', () => {
    expect(layoutBars([task({ id: 't1' })], [booking('b', 'omar', 't1', 0)], DAYS, rows, NOW)).toEqual([])
  })
  it('lists each workstream on screen once, for the key', () => {
    const tasks = [task({ id: 'a', workstreamId: 'w1', workstreamName: 'Draw nights' }), task({ id: 'b', workstreamId: 'w1', workstreamName: 'Draw nights' }), task({ id: 'c' })]
    const bars = layoutBars(tasks, [booking('1', 'zubaida', 'a', 0), booking('2', 'fadia', 'b', 0), booking('3', 'zubaida', 'c', 2)], DAYS, rows, NOW)
    expect(workstreamsOnScreen(tasks, bars)).toEqual([{ id: 'w1', name: 'Draw nights', campaignName: 'LUMA' }])
  })
})

describe('bar state and lateness', () => {
  it('names review and changes requested', () => {
    expect(barState({ status: 'review', revisionNumber: 0 })).toBe('review')
    expect(barState({ status: 'todo', revisionNumber: 1 })).toBe('changes')
    expect(barState({ status: 'in_progress', revisionNumber: 0 })).toBeNull()
  })
  it('is late past its committed Iraq day, or when drawn past it; never once done', () => {
    const t = { committedDueAt: '2026-09-21T14:00:00Z', status: 'in_progress' as const }
    expect(isLate(t, null, NOW)).toBe(true) // today (22nd) is past the 21st
    expect(isLate({ ...t, committedDueAt: '2026-09-24T14:00:00Z' }, '2026-09-25', NOW)).toBe(true)
    expect(isLate({ ...t, committedDueAt: '2026-09-24T14:00:00Z' }, '2026-09-24', NOW)).toBe(false)
    expect(isLate({ ...t, status: 'done' }, null, NOW)).toBe(false)
    expect(isLate({ ...t, committedDueAt: null }, null, NOW)).toBe(false)
  })
})

describe('personLine — the one plain line on By person', () => {
  it('says the ceiling first', () => {
    expect(personLine({ level: 'over', bookedHours: 50 }, [{ waitingOn: 'copy' }], ['Sun'])).toEqual({ kind: 'ceiling' })
  })
  it('then an input the work is waiting on', () => {
    expect(personLine({ level: 'ok', bookedHours: 8 }, [{ waitingOn: null }, { waitingOn: 'Arabic copy' }], [])).toEqual({ kind: 'waiting', on: 'Arabic copy' })
  })
  it('then nothing booked', () => {
    expect(personLine({ level: 'ok', bookedHours: 0 }, [], ['Sun', 'Mon'])).toEqual({ kind: 'nothing' })
  })
  it('then the free days, and nothing at all when the week is simply full', () => {
    expect(personLine({ level: 'ok', bookedHours: 16 }, [{ waitingOn: null }], ['Mon', 'Thu'])).toEqual({ kind: 'free', days: ['Mon', 'Thu'] })
    expect(personLine({ level: 'warn', bookedHours: 40 }, [{ waitingOn: null }], [])).toBeNull()
  })
  it('free days are the working days with no booking', () => {
    const free = freeDaysOf('zubaida', [booking('1', 'zubaida', 't', 0), booking('2', 'fadia', 't', 1)], DAYS, (d) => d.isoDate <= '2026-09-24')
    expect(free.map((d) => d.isoDate)).toEqual(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'])
  })
})

describe('By piece — sorted by what bites first, filtered by the figures', () => {
  const rows = [
    task({ id: 'later', dueAt: '2026-09-30T14:00:00Z' }),
    task({ id: 'soon', dueAt: '2026-09-23T14:00:00Z' }),
    task({ id: 'nobody', assigneeId: null, dueAt: '2026-10-10T14:00:00Z' }),
    task({ id: 'late', committedDueAt: '2026-09-21T14:00:00Z', dueAt: '2026-09-21T14:00:00Z' }),
    task({ id: 'undated' }),
    task({ id: 'rev', status: 'review', dueAt: '2026-09-24T14:00:00Z' }),
  ]
  it('puts unassigned and late first, then by due, undated last', () => {
    expect(sortByPiece(rows, NOW).map((r) => r.id)).toEqual(['late', 'nobody', 'soon', 'rev', 'later', 'undated'])
  })
  it('the figures open it filtered', () => {
    expect(applyPieceFilter(rows, 'unassigned', new Set()).map((r) => r.id)).toEqual(['nobody'])
    expect(applyPieceFilter(rows, 'review', new Set()).map((r) => r.id)).toEqual(['rev'])
    expect(applyPieceFilter(rows, 'atRisk', new Set(['soon'])).map((r) => r.id)).toEqual(['soon'])
    expect(applyPieceFilter(rows, null, new Set())).toHaveLength(6)
  })
})

describe('loadSentence — who is over, who is empty', () => {
  it('names each', () => {
    expect(loadSentence([
      { name: 'Zubaida', utilPct: 120, warnPct: 100 },
      { name: 'Lujain', utilPct: 0, warnPct: 100 },
      { name: 'Fadia', utilPct: 60, warnPct: 100 },
    ])).toEqual({ over: ['Zubaida'], empty: ['Lujain'] })
  })
})

describe('inNobodyYet — whose unassigned work a view shows (I59 E1)', () => {
  const team = { kind: 'team', id: 'T1' } as const
  const dept = { kind: 'department', id: 'D1', picker: false } as const
  const owners = new Set(['lead-t1'])
  it('a team: only work on pieces a team member owns — a task placed on the team is not enough', () => {
    expect(inNobodyYet(task({ assigneeId: null, ownerId: 'lead-t1' }), team, owners)).toBe(true)
    expect(inNobodyYet(task({ assigneeId: null, ownerId: 'lead-t2', teamId: 'T1' }), team, owners)).toBe(false)
    expect(inNobodyYet(task({ assigneeId: null, ownerId: null, teamId: 'T1' }), team, owners)).toBe(false)
  })
  it('a department: every unassigned task in it, by the task or by its piece', () => {
    expect(inNobodyYet(task({ assigneeId: null, departmentId: 'D1' }), dept, new Set())).toBe(true)
    expect(inNobodyYet(task({ assigneeId: null, departmentId: null, deliverableDepartmentId: 'D1' }), dept, new Set())).toBe(true)
    expect(inNobodyYet(task({ assigneeId: null, departmentId: 'D9', deliverableDepartmentId: 'D9' }), dept, new Set())).toBe(false)
  })
  it('assigned work is never Nobody yet', () => {
    expect(inNobodyYet(task({ assigneeId: 'u1', ownerId: 'lead-t1' }), team, owners)).toBe(false)
  })
})

describe('timeInState — By piece "For", real time in the current state (I59 E2)', () => {
  const clocks = {
    assignedAt: '2026-09-20T08:00:00Z', tasksApprovedAt: '2026-09-19T08:00:00Z', roundStartedAt: '2026-09-21T08:00:00Z',
    roundSentAt: '2026-09-22T07:00:00Z', blockedSince: null,
  }
  it('in review: since sent', () => {
    expect(timeInState(task({ ...clocks, status: 'review' }))).toEqual({ state: 'review', since: '2026-09-22T07:00:00Z' })
  })
  it('unassigned: since the task list was approved', () => {
    expect(timeInState(task({ ...clocks, status: 'todo', assigneeId: null }))).toEqual({ state: 'unassigned', since: '2026-09-19T08:00:00Z' })
  })
  it('blocked: since the input was raised, ahead of in progress and assigned', () => {
    const blockedSince = '2026-09-21T12:00:00Z'
    expect(timeInState(task({ ...clocks, blockedSince, status: 'in_progress' }))).toEqual({ state: 'blocked', since: blockedSince })
    expect(timeInState(task({ ...clocks, blockedSince, status: 'todo' }))).toEqual({ state: 'blocked', since: blockedSince })
    expect(timeInState(task({ ...clocks, blockedSince, status: 'review' }))?.state).toBe('review')
  })
  it("in progress: since the round's Start", () => {
    expect(timeInState(task({ ...clocks, status: 'in_progress' }))).toEqual({ state: 'inProgress', since: '2026-09-21T08:00:00Z' })
  })
  it('assigned, not started: since it was given out', () => {
    expect(timeInState(task({ ...clocks, status: 'todo' }))).toEqual({ state: 'assigned', since: '2026-09-20T08:00:00Z' })
  })
  it('no clock for a sent-back round not yet started, nor for finished work', () => {
    expect(timeInState(task({ ...clocks, status: 'todo', revisionNumber: 1 }))).toBeNull()
    expect(timeInState(task({ ...clocks, status: 'done' }))).toBeNull()
  })
})

describe('durationSince — under a day in hours, else days', () => {
  it('formats', () => {
    expect(durationSince('2026-09-22T08:30:00Z', NOW)).toEqual({ unit: 'underHour' })
    expect(durationSince('2026-09-22T04:00:00Z', NOW)).toEqual({ unit: 'hours', count: 5 })
    expect(durationSince('2026-09-21T09:00:00Z', NOW)).toEqual({ unit: 'days', count: 1 })
    expect(durationSince('2026-09-20T07:00:00Z', NOW)).toEqual({ unit: 'days', count: 2 })
    expect(durationSince('2026-09-23T09:00:00Z', NOW)).toEqual({ unit: 'underHour' }) // never negative
  })
})

describe("roundClocks — the current round's Start and send", () => {
  const e = (round: number, started_at: string | null, submitted_at: string | null) => ({ sub_task_id: 't', round, started_at, submitted_at })
  it('reads only the round the task is on', () => {
    const entries = [e(1, '2026-09-18T08:00:00Z', '2026-09-19T08:00:00Z'), e(2, '2026-09-21T08:00:00Z', null)]
    expect(roundClocks(entries, 2)).toEqual({ startedAt: '2026-09-21T08:00:00Z', sentAt: null })
    expect(roundClocks(entries, 1)).toEqual({ startedAt: null, sentAt: '2026-09-19T08:00:00Z' })
    expect(roundClocks([], 1)).toEqual({ startedAt: null, sentAt: null })
  })
})

describe('assignDialogReason — a Nobody-yet drop the drag cannot finish', () => {
  it('no reviewer, or the person it lands on is its reviewer', () => {
    expect(assignDialogReason(task({ assigneeId: null, reviewerIds: [] }), 'u1')).toBe('reviewer')
    expect(assignDialogReason(task({ assigneeId: null, reviewerIds: ['u1'] }), 'u1')).toBe('reviewer')
  })
  it('no hours (E11)', () => {
    expect(assignDialogReason(task({ assigneeId: null, hours: null }), 'u1')).toBe('hours')
    expect(assignDialogReason(task({ assigneeId: null, hours: 0 }), 'u1')).toBe('hours')
  })
  it('otherwise the drag assigns it; a move of assigned work is not this', () => {
    expect(assignDialogReason(task({ assigneeId: null }), 'u1')).toBeNull()
    expect(assignDialogReason(task({ assigneeId: 'u2', reviewerIds: [] }), 'u1')).toBeNull()
  })
  it('hours a day for the dialog, to the half hour; empty when there are none', () => {
    expect(hoursPerDayOf(16, 2)).toBe('8')
    expect(hoursPerDayOf(8, 3)).toBe('2.5')
    expect(hoursPerDayOf(null, 1)).toBe('')
  })
})

describe('taskLabel — "Piece · Step", the piece named once', () => {
  it('drops the trailing " — <piece>" a composed task title carries', () => {
    expect(taskLabel({ pieceName: 'Autumn key visual', title: 'Creative Direction — Autumn key visual' })).toBe('Autumn key visual · Creative Direction')
  })
  it('leaves a title whose tail is not the piece alone', () => {
    expect(taskLabel({ pieceName: 'Launch reel', title: 'Write Copy — Teaser' })).toBe('Launch reel · Write Copy — Teaser')
    expect(taskLabel({ pieceName: 'Post 2', title: 'Design' })).toBe('Post 2 · Design')
  })
  it('keeps the title of a task with no piece', () => {
    expect(taskLabel({ pieceName: '', title: 'Brief — Poster' })).toBe('Brief — Poster')
  })
  it('names the piece once before a unit number or the translation\'s languages (I67.1)', () => {
    expect(taskLabel({ pieceName: 'Social statics', title: 'Create Artwork — Social statics 3' })).toBe('Social statics · Create Artwork 3')
    expect(taskLabel({ pieceName: 'Static Post', title: 'Translation — Static Post (English, Arabic)' }))
      .toBe('Static Post · Translation (English, Arabic)')
  })
  it('a 4 Oct title (campaign and type, not the piece) is left as written after the piece', () => {
    expect(taskLabel({ pieceName: 'Social statics', title: 'Create Artwork — Northwind Summer Launch · Static Post 3' }))
      .toBe('Social statics · Create Artwork — Northwind Summer Launch · Static Post 3')
    expect(taskLabel({ pieceName: 'Social statics', title: 'Translation — Northwind Summer Launch (Arabic, English)' }))
      .toBe('Social statics · Translation — Northwind Summer Launch (Arabic, English)')
  })
})

describe('timelineStatus — what colours a bar (I67.3)', () => {
  const t = (over: Partial<Pick<TeamTask, 'status' | 'revisionNumber' | 'waitingOn'>>) =>
    ({ status: 'todo' as TeamTask['status'], revisionNumber: 0, waitingOn: null, ...over })
  it('reads the task\'s status, with nobody on it and a block first', () => {
    expect(timelineStatus(t({}), 'r1')).toBe('notStarted')
    expect(timelineStatus(t({ status: 'in_progress' }), 'r1')).toBe('inProgress')
    expect(timelineStatus(t({ status: 'review' }), 'r1')).toBe('review')
    expect(timelineStatus(t({ status: 'in_progress', revisionNumber: 1 }), 'r1')).toBe('changes')
    expect(timelineStatus(t({ status: 'in_progress', waitingOn: 'Arabic copy' }), 'r1')).toBe('blocked')
    expect(timelineStatus(t({ status: 'in_progress' }), null)).toBe('unassigned')
    expect(timelineStatus(t({ status: 'done' }), 'r1')).toBe('done')
  })
})
