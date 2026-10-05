import { describe, expect, it } from 'vitest'
import { byDeadlineThenPriority, endOfWeek, isDueToday, isFinished, isForToday, isOverdue, listOf, localDay, openWork, today } from './my-work'

/**
 * The bug these guard against: `new Date().toISOString().slice(0, 10)` is the UTC date, so east of
 * Greenwich the calendar day rolls over hours late. A task due 06:00 Cairo on the 24th read as the
 * 23rd until 03:00 local. Tests pin an explicit `now` so they mean the same thing in every runner
 * timezone (CI runs UTC; this machine does not).
 */
describe('my-work day boundaries', () => {
  const at = (iso: string) => new Date(iso).getTime()

  it('reads the local calendar day, not the UTC one', () => {
    // 00:30 local on the 24th. In a UTC+3 zone that is 21:30 UTC on the 23rd — the old code's answer.
    const localMidnightish = new Date(2026, 7, 24, 0, 30, 0)
    expect(localDay(localMidnightish)).toBe('2026-08-24')
    expect(today(localMidnightish.getTime())).toBe('2026-08-24')
  })

  it('puts overdue work in today, not in the later list', () => {
    const now = at('2026-08-24T09:00:00')
    expect(isForToday({ startsAt: null, dueAt: new Date(2026, 7, 20).toISOString() }, now)).toBe(true)
    expect(isOverdue(new Date(2026, 7, 20).toISOString(), now)).toBe(true)
  })

  it('treats due-today as today and not overdue, however late in the day', () => {
    const now = at('2026-08-24T23:45:00')
    const dueToday = new Date(2026, 7, 24, 9, 0, 0).toISOString()
    expect(isForToday({ startsAt: null, dueAt: dueToday }, now)).toBe(true)
    expect(isDueToday(dueToday, now)).toBe(true)
    expect(isOverdue(dueToday, now)).toBe(false)
  })

  it('leaves future and undated work out of today', () => {
    const now = at('2026-08-24T09:00:00')
    expect(isForToday({ startsAt: null, dueAt: new Date(2026, 7, 25).toISOString() }, now)).toBe(false)
    expect(isForToday({ startsAt: null, dueAt: null }, now)).toBe(false)
    expect(isOverdue(null, now)).toBe(false)
    expect(isDueToday(null, now)).toBe(false)
  })

  /**
   * The bug: a task booked Thursday–Sunday sorted on its due date alone, so it sat in "Other tasks"
   * for the three days it was actually being worked on and surfaced on the day it was already due.
   */
  describe('a task booked across several days', () => {
    const span = {
      startsAt: new Date(2026, 7, 20, 9, 0, 0).toISOString(),
      dueAt: new Date(2026, 7, 23, 17, 0, 0).toISOString(),
    }

    it('is today’s work from its first day', () => {
      expect(isForToday(span, at('2026-08-20T09:30:00'))).toBe(true)
    })

    it('stays today’s work in the middle of the span', () => {
      expect(isForToday(span, at('2026-08-22T11:00:00'))).toBe(true)
    })

    it('is still today’s work on its last day, and after it', () => {
      expect(isForToday(span, at('2026-08-23T08:00:00'))).toBe(true)
      expect(isForToday(span, at('2026-08-25T08:00:00'))).toBe(true)
    })

    it('is not today’s work before the span opens', () => {
      expect(isForToday(span, at('2026-08-19T23:59:00'))).toBe(false)
    })
  })
})

/**
 * ADR-0080 d.8. Six tasks across four people were sitting in "Tasks for today" under a container
 * somebody had archived — unclearable, because the assignee cannot cancel her own work, the modal
 * hides every task control on a finished container, and `archived` is terminal so it cannot be
 * reopened to reach the task. The classifier did not know the state existed.
 */
describe('settled work leaves the working lists (ADR-0080 d.8)', () => {
  const task = (status: string, deliverableState: string | null) => ({ status, deliverableState })

  it('counts a task done on its own row, whatever its container says', () => {
    expect(isFinished(task('done', 'in_progress'))).toBe(true)
  })

  it.each(['approved', 'delivered', 'archived'])(
    'counts a live task settled when its container is %s',
    (state) => {
      expect(isFinished(task('todo', state))).toBe(true)
    },
  )

  it.each(['draft', 'in_progress', 'in_review', 'blocked'])(
    'leaves a live task open when its container is %s',
    (state) => {
      expect(isFinished(task('todo', state))).toBe(false)
    },
  )

  it('leaves a standalone task with no container open', () => {
    // ADR-0034: an ad-hoc task assigned on the scheduler has no deliverable. A null container must
    // read as "nothing settles it", never as a missing value that quietly matches.
    expect(isFinished(task('todo', null))).toBe(false)
  })

  it('drops archived work out of the open list', () => {
    const items = [
      task('todo', 'archived'),
      task('todo', 'in_progress'),
      task('in_progress', 'delivered'),
    ]
    expect(openWork(items)).toEqual([task('todo', 'in_progress')])
  })
})

// ---------------------------------------------------------------------------------
// I54.15 — the working lists are ordered (Edward, 23 Sep: "order the work according to
// priority"). The deadline leads; priority breaks the tie between two tasks due the same day.

describe('byDeadlineThenPriority', () => {
  const item = (id: string, dueAt: string | null, priority: 'high' | 'medium' | 'low' | null) =>
    ({ id, dueAt, priority })
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id)

  it('puts the nearer deadline first, whatever its priority', () => {
    // The whole reason priority does NOT overrule the date: a normal job due today must never
    // sink below a high one due next week.
    const out = byDeadlineThenPriority([
      item('next-week-high', '2026-09-30T15:00:00Z', 'high'),
      item('today-normal', '2026-09-23T15:00:00Z', 'low'),
    ])
    expect(ids(out)).toEqual(['today-normal', 'next-week-high'])
  })

  it('breaks a tie on the same day by priority', () => {
    const out = byDeadlineThenPriority([
      item('c', '2026-09-23T15:00:00Z', 'low'),
      item('a', '2026-09-23T15:00:00Z', 'high'),
      item('b', '2026-09-23T15:00:00Z', 'medium'),
    ])
    expect(ids(out)).toEqual(['a', 'b', 'c'])
  })

  it('ties on the DAY, not the instant', () => {
    // Since ADR-0076 a deadline is 18:00 Iraq, but a task carrying any other time would otherwise
    // never reach the priority tie-break at all.
    const out = byDeadlineThenPriority([
      item('same-day-normal-earlier', '2026-09-23T06:00:00Z', 'low'),
      item('same-day-high-later', '2026-09-23T15:00:00Z', 'high'),
    ])
    expect(ids(out)).toEqual(['same-day-high-later', 'same-day-normal-earlier'])
  })

  it('sorts a task with no priority with the normal ones', () => {
    const out = byDeadlineThenPriority([
      item('none', '2026-09-23T15:00:00Z', null),
      item('high', '2026-09-23T15:00:00Z', 'high'),
    ])
    expect(ids(out)).toEqual(['high', 'none'])
  })

  it('puts a task nobody has dated last', () => {
    const out = byDeadlineThenPriority([
      item('undated-high', null, 'high'),
      item('dated-normal', '2026-09-30T15:00:00Z', 'low'),
    ])
    expect(ids(out)).toEqual(['dated-normal', 'undated-high'])
  })

  it('does not mutate the list it is given', () => {
    const input = [item('b', '2026-09-30T15:00:00Z', 'low'), item('a', '2026-09-23T15:00:00Z', 'low')]
    const before = ids(input)
    byDeadlineThenPriority(input)
    expect(ids(input)).toEqual(before)
  })
})

describe('listOf — the five lists (ADR-0105 d.1, I59.10)', () => {
  // Thursday 24 Sep 2026, local noon: the week runs Sun 20 → Sat 26.
  const now = new Date(2026, 8, 24, 12).getTime()
  const at = (d: number, h = 18) => new Date(2026, 8, d, h).toISOString()
  const t = (o: Partial<{ status: string; deliverableState: string | null; startsAt: string | null; dueAt: string | null }>) => ({
    status: 'todo', deliverableState: 'in_progress', startsAt: null, dueAt: null, ...o,
  })

  it('ends the week on Saturday', () => {
    expect(endOfWeek(now)).toBe('2026-09-26')
    expect(endOfWeek(new Date(2026, 8, 26, 23).getTime())).toBe('2026-09-26')
    expect(endOfWeek(new Date(2026, 8, 27, 1).getTime())).toBe('2026-10-03')
  })

  it('puts due today, overdue and a begun span in Today', () => {
    expect(listOf(t({ dueAt: at(24) }), now)).toBe('today')
    expect(listOf(t({ dueAt: at(21) }), now)).toBe('today')
    expect(listOf(t({ startsAt: at(23, 9), dueAt: at(30) }), now)).toBe('today')
  })

  it('puts the rest of this week in This week, and after it — or undated — in Later', () => {
    expect(listOf(t({ dueAt: at(25) }), now)).toBe('week')
    expect(listOf(t({ dueAt: at(26) }), now)).toBe('week')
    expect(listOf(t({ dueAt: at(27) }), now)).toBe('later')
    expect(listOf(t({ dueAt: null }), now)).toBe('later')
  })

  it('puts my task in review in Waiting on someone else, whatever its date', () => {
    expect(listOf(t({ status: 'review', dueAt: at(21) }), now)).toBe('waiting')
    expect(listOf(t({ status: 'review', dueAt: null }), now)).toBe('waiting')
  })

  it('puts finished work in Completed, before anything else is asked', () => {
    expect(listOf(t({ status: 'done', dueAt: at(24) }), now)).toBe('done')
    expect(listOf(t({ status: 'review', deliverableState: 'approved' }), now)).toBe('done')
    expect(listOf(t({ deliverableState: 'archived' }), now)).toBe('done')
  })
})
