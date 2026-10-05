import { describe, expect, it } from 'vitest'
import { assessRisk, threatensDeadline, type RiskPiece, type RiskTask } from './at-risk'

// Thursday 24 Sep 2026, noon in Baghdad. Iraq works Sunday–Thursday.
const NOW = Date.parse('2026-09-24T09:00:00Z')
const at = (day: string) => `${day}T15:00:00Z` // 18:00 Baghdad, the close of that day

const task = (over: Partial<RiskTask> = {}): RiskTask => ({
  id: 't1',
  status: 'in_progress',
  assigneeId: 'u1',
  committedStartsAt: at('2026-09-20'),
  committedDueAt: at('2026-09-27'),
  hours: 8,
  submittedAt: null,
  ...over,
})

const piece = (over: Partial<RiskPiece> = {}): RiskPiece => ({
  state: 'in_progress',
  dueAt: at('2026-09-29'),
  taskListApprovedAt: '2026-09-20T08:00:00Z',
  tasks: [task()],
  ...over,
})

const kinds = (p: RiskPiece) => assessRisk(p, { now: NOW }).reasons.map((r) => r.kind)

describe('assessRisk — ADR-0075 d.4/d.5, the date checks (I57.1)', () => {
  it('a healthy piece is on time', () => {
    const a = assessRisk(piece(), { now: NOW })
    expect(a.level).toBe('on_time')
    expect(a.reasons).toEqual([])
    expect(threatensDeadline(a)).toBe(false)
  })

  it('approved, delivered and closed pieces are done, however old the date', () => {
    for (const state of ['approved', 'delivered', 'archived'] as const) {
      expect(assessRisk(piece({ state, dueAt: at('2026-09-01') }), { now: NOW }).level).toBe('done')
    }
  })

  it('a piece past its date and not approved is LATE, counted in working days', () => {
    // Due Sun 20 Sep; Mon 21 … Thu 24 are four working days after it.
    const a = assessRisk(piece({ dueAt: at('2026-09-20') }), { now: NOW })
    expect(a.level).toBe('late')
    expect(a.reasons).toEqual([{ kind: 'past_due' }])
    expect(a.lateByWorkingDays).toBe(4)
    expect(threatensDeadline(a)).toBe(true)
  })

  it('an assigned task nobody started by its committed start day is at risk', () => {
    expect(kinds(piece({ tasks: [task({ status: 'todo', committedStartsAt: at('2026-09-23') })] }))).toContain('not_started')
  })

  it('an assigned task whose start day is today is not yet late to start', () => {
    const p = piece({ tasks: [task({ status: 'todo', committedStartsAt: at('2026-09-24'), committedDueAt: at('2026-09-28') })] })
    expect(kinds(p)).toEqual([])
  })

  it('an unassigned task with too few working hours left is at risk', () => {
    // Piece due Tue 29; less the review day → Mon 28; Sun 27 + Mon 28 = 16h left; the task needs 24.
    const p = piece({ tasks: [task({ status: 'todo', assigneeId: null, committedStartsAt: null, committedDueAt: null, hours: 24 })] })
    expect(kinds(p)).toEqual(['no_time_left'])
  })

  it('the same shortfall on an unapproved task list names the list, once', () => {
    const t = { status: 'todo' as const, assigneeId: null, committedStartsAt: null, committedDueAt: null, hours: 24 }
    const p = piece({ taskListApprovedAt: null, tasks: [task({ ...t, id: 'a' }), task({ ...t, id: 'b' })] })
    expect(kinds(p)).toEqual(['task_list_unapproved'])
  })

  it('an unapproved list with plenty of time is not at risk yet', () => {
    const p = piece({
      dueAt: at('2026-10-15'),
      taskListApprovedAt: null,
      tasks: [task({ status: 'todo', assigneeId: null, committedStartsAt: null, committedDueAt: null, hours: 8 })],
    })
    expect(kinds(p)).toEqual([])
  })

  it('a task with no stated hours is assumed to need one day', () => {
    // Due Mon 28 → deadline Sun 27 → one working day left after today: exactly enough.
    const ok = piece({ dueAt: at('2026-09-28'), tasks: [task({ status: 'todo', assigneeId: null, committedStartsAt: null, committedDueAt: null, hours: null })] })
    expect(kinds(ok)).toEqual([])
    const short = piece({ dueAt: at('2026-09-27'), tasks: [task({ status: 'todo', assigneeId: null, committedStartsAt: null, committedDueAt: null, hours: null })] })
    expect(kinds(short)).toEqual(['no_time_left'])
  })

  it('a review nobody has answered for more than a working day is stuck', () => {
    const stuck = piece({ tasks: [task({ status: 'review', submittedAt: '2026-09-21T10:00:00Z' })] })
    expect(kinds(stuck)).toEqual(['stuck_in_review'])
    const fresh = piece({ tasks: [task({ status: 'review', submittedAt: '2026-09-23T10:00:00Z' })] })
    expect(kinds(fresh)).toEqual([])
  })

  it('the last task finishing with no review day left before the piece is due is too close', () => {
    // Task committed to Mon 28, piece due Mon 28: no working day between them.
    const p = piece({ dueAt: at('2026-09-28'), tasks: [task({ committedDueAt: at('2026-09-28') })] })
    expect(assessRisk(p, { now: NOW }).reasons).toEqual([{ kind: 'too_close', taskId: 't1' }])
  })

  it('a task already past its committed date finishes no earlier than today', () => {
    // Committed Tue 22, still going; the piece is due Sun 27 — Thu 24 → Sun 27 leaves one day. Fine.
    expect(kinds(piece({ dueAt: at('2026-09-27'), tasks: [task({ committedDueAt: at('2026-09-22') })] }))).toEqual([])
    // Due today at close: nothing left for review.
    expect(kinds(piece({ dueAt: at('2026-09-24'), tasks: [task({ committedDueAt: at('2026-09-22') })] }))).toEqual(['too_close'])
  })

  it('the weekend is not a review day', () => {
    // Task committed Thu 24, piece due Sun 27: Fri and Sat are off, Sun is the one working day. Fine.
    expect(kinds(piece({ dueAt: at('2026-09-27'), tasks: [task({ committedDueAt: at('2026-09-24') })] }))).toEqual([])
  })

  it('a task short of time only because its prerequisite is outstanding is WAITING, not at risk', () => {
    const p = piece({ tasks: [task({ status: 'todo', committedStartsAt: at('2026-09-22'), waitingOnPrerequisite: true })] })
    const a = assessRisk(p, { now: NOW })
    expect(a.level).toBe('waiting')
    expect(a.reasons).toEqual([])
    expect(a.waiting).toEqual([{ kind: 'not_started', taskId: 't1' }])
    expect(threatensDeadline(a)).toBe(false)
  })

  it('finished and cancelled tasks carry no risk', () => {
    const p = piece({
      dueAt: at('2026-09-28'),
      tasks: [task({ status: 'done', committedDueAt: at('2026-09-28') }), task({ id: 't2', status: 'cancelled', committedDueAt: at('2026-09-28') })],
    })
    expect(kinds(p)).toEqual([])
  })

  it('a closed office day is not a working day (ADR-0079)', () => {
    // Task committed Thu 24, piece due Sun 27 — but the office is shut on Sun 27.
    const p = piece({ dueAt: at('2026-09-27'), tasks: [task({ committedDueAt: at('2026-09-24') })] })
    const a = assessRisk(p, { now: NOW, calendar: { workingDays: [7, 1, 2, 3, 4], closures: ['2026-09-27'] } })
    expect(a.reasons.map((r) => r.kind)).toEqual(['too_close'])
  })

  describe('d.4 first clause — hours remaining against the hours booked (I57.12)', () => {
    it('more work left than booked time before the date is at risk', () => {
      const p = piece({ tasks: [task({ hoursRemaining: 6, bookedHoursLeft: 4 })] })
      expect(assessRisk(p, { now: NOW }).reasons).toEqual([{ kind: 'not_enough_booked', taskId: 't1' }])
    })

    it('booked time that covers the work left is fine, to the hour', () => {
      expect(kinds(piece({ tasks: [task({ hoursRemaining: 4, bookedHoursLeft: 4 })] }))).toEqual([])
      expect(kinds(piece({ tasks: [task({ hoursRemaining: 0, bookedHoursLeft: 0 })] }))).toEqual([])
    })

    it('a task not started is judged by it too', () => {
      const p = piece({ tasks: [task({ status: 'todo', committedStartsAt: at('2026-09-24'), committedDueAt: at('2026-09-28'), hoursRemaining: 8, bookedHoursLeft: 2 })] })
      expect(kinds(p)).toEqual(['not_enough_booked'])
    })

    it('without both figures the clause is not judged — the engine answers as before', () => {
      expect(kinds(piece({ tasks: [task({ hoursRemaining: 6 })] }))).toEqual([])
      expect(kinds(piece({ tasks: [task({ bookedHoursLeft: 0 })] }))).toEqual([])
      expect(kinds(piece({ tasks: [task({ hoursRemaining: null, bookedHoursLeft: null })] }))).toEqual([])
    })

    it('a task in review, done or unassigned is not judged by it', () => {
      const short = { hoursRemaining: 6, bookedHoursLeft: 0 }
      expect(kinds(piece({ tasks: [task({ ...short, status: 'review', submittedAt: '2026-09-23T10:00:00Z' })] }))).toEqual([])
      expect(kinds(piece({ tasks: [task({ ...short, status: 'done' })] }))).toEqual([])
      expect(kinds(piece({ tasks: [task({ ...short, assigneeId: null })] }))).toEqual([])
    })

    it('short only because a prerequisite is outstanding is WAITING', () => {
      const a = assessRisk(piece({ tasks: [task({ hoursRemaining: 6, bookedHoursLeft: 1, waitingOnPrerequisite: true })] }), { now: NOW })
      expect(a.level).toBe('waiting')
      expect(a.waiting).toEqual([{ kind: 'not_enough_booked', taskId: 't1' }])
    })
  })
})
