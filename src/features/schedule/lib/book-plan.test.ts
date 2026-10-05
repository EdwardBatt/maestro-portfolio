import { describe, expect, it } from 'vitest'
import { applyBulk, bookButtonCounts, checkPlan, daysBeforeDue, hoursPerDay, isAcceptableTaskName, planSummary, workDays, type PlanContext, type PlanRow } from './book-plan'
import type { ScheduleBooking, ScheduleResource } from '../api/schedule-api'

/** I74.22 — the booking window plans; it never refuses. Dates are Sun 27 Sep – Thu 1 Oct 2026. */
const res = (id: string): ScheduleResource => ({
  id, name: id, nickname: null, kind: 'human', userId: `u-${id}`, departmentId: null, departmentName: null, teamId: null, teamName: null,
  officeId: null, capacityModel: 'load_based', warnAtPct: 100, ceilingPct: 120, poolSize: null, requiresApproval: false,
  office: { name: 'Baghdad', timezone: 'Asia/Baghdad', workingDays: [7, 1, 2, 3, 4] },
})
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay()
const isWorking = (_r: string, iso: string) => weekday(iso) <= 4 // Sun–Thu
const row = (over: Partial<PlanRow>): PlanRow => ({ key: 'k', subTaskId: 'k', title: 'Task', hours: 3, resourceId: null, from: null, to: null, waitsFor: [], ...over })

const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
  resources: new Map([['zubaida', res('zubaida')], ['bad', res('bad')]]),
  bookingsOn: () => [],
  isWorking,
  onLeave: () => false,
  dueOn: '2026-10-01',
  others: new Map(),
  ...over,
})

describe('workDays / hoursPerDay', () => {
  it('skips the days off inside the span, keeps a picked first day', () => {
    expect(workDays('2026-09-30', '2026-10-04', (d) => isWorking('', d))).toEqual(['2026-09-30', '2026-10-01', '2026-10-04'])
    expect(workDays('2026-10-02', '2026-10-02', (d) => isWorking('', d))).toEqual(['2026-10-02'])
  })
  it('spreads the hours evenly: Tue 29 – Wed 30, 6h is 3h a day', () => {
    expect(hoursPerDay(6, 2)).toBe(3)
  })
})

describe('applyBulk — give them to one person on one day (SC-03b/c)', () => {
  it('sets the person and the day on the ticked rows only', () => {
    const rows = [row({ key: 'a' }), row({ key: 'b' }), row({ key: 'c', resourceId: 'bad', from: '2026-09-27', to: '2026-09-27' })]
    const out = applyBulk(rows, new Set(['a', 'b']), 'zubaida', '2026-10-01')
    expect(out.map((r) => [r.resourceId, r.from, r.to])).toEqual([
      ['zubaida', '2026-10-01', '2026-10-01'],
      ['zubaida', '2026-10-01', '2026-10-01'],
      ['bad', '2026-09-27', '2026-09-27'],
    ])
  })
})

describe('checkPlan — warnings on the row, never a block (SC-14)', () => {
  it('one row past a full day: the row says so, using the grid\'s own calculation', () => {
    const existing = [{ state: 'confirmed', loadPct: 150 } as ScheduleBooking] // 12h already on Monday
    const check = checkPlan(
      [row({ key: 'a', resourceId: 'bad', from: '2026-09-28', to: '2026-09-28', hours: 3 })],
      ctx({ bookingsOn: (r, d) => (r === 'bad' && d === '2026-09-28' ? existing : []) }),
    )
    expect(check.rows.get('a')).toEqual([{ kind: 'over', resourceId: 'bad', isoDate: '2026-09-28', totalHours: 15, overHours: 7 }])
    expect(check.count).toBe(1)
  })
  it('several rows on one day together over: one combined finding, not on each row (SC-03c)', () => {
    const rows = [
      row({ key: 'a', resourceId: 'zubaida', from: '2026-10-01', to: '2026-10-01', hours: 3 }),
      row({ key: 'b', resourceId: 'zubaida', from: '2026-10-01', to: '2026-10-01', hours: 6 }),
      row({ key: 'c', resourceId: 'zubaida', from: '2026-10-01', to: '2026-10-01', hours: 2 }),
    ]
    const check = checkPlan(rows, ctx())
    expect(check.rows.size).toBe(0)
    expect(check.combined).toEqual([{ resourceId: 'zubaida', isoDate: '2026-10-01', totalHours: 11, overHours: 3, rowKeys: ['a', 'b', 'c'] }])
  })
  it('starting before the task it waits for has ended — names the next working day', () => {
    const rows = [
      row({ key: 'a', title: 'Develop concept', resourceId: 'bad', from: '2026-09-28', to: '2026-09-28' }),
      row({ key: 'b', resourceId: 'zubaida', from: '2026-09-28', to: '2026-09-28', waitsFor: ['a'] }),
    ]
    expect(checkPlan(rows, ctx()).rows.get('b')).toEqual([
      { kind: 'order', startsOn: '2026-09-28', prerequisite: 'Develop concept', prerequisiteEndsOn: '2026-09-28', suggestOn: '2026-09-29' },
    ])
  })
  it('ending after the due date warns; the row still counts as ready', () => {
    const rows = [row({ key: 'a', resourceId: 'zubaida', from: '2026-10-04', to: '2026-10-04' })]
    expect(checkPlan(rows, ctx()).rows.get('a')).toEqual([{ kind: 'late', endsOn: '2026-10-04', dueOn: '2026-10-01' }])
    expect(planSummary(rows, isWorking).ready).toBe(1)
  })
  it('leave and a picked day off are named', () => {
    const rows = [row({ key: 'a', resourceId: 'zubaida', from: '2026-10-02', to: '2026-10-02' }), row({ key: 'b', resourceId: 'bad', from: '2026-09-29', to: '2026-09-29' })]
    const check = checkPlan(rows, ctx({ onLeave: (r, d) => r === 'bad' && d === '2026-09-29' }))
    expect(check.rows.get('a')?.[0]).toMatchObject({ kind: 'off' })
    expect(check.rows.get('b')?.[0]).toMatchObject({ kind: 'leave', isoDate: '2026-09-29' })
  })
  it('says nothing about a clean plan', () => {
    expect(checkPlan([row({ key: 'a', resourceId: 'zubaida', from: '2026-09-29', to: '2026-09-30', hours: 6 })], ctx()).count).toBe(0)
  })
})

describe('planSummary — the footer line', () => {
  it('counts hours with a person, rows ready, and when it is all done', () => {
    const rows = [
      row({ key: 'a', resourceId: 'zubaida', from: '2026-09-28', to: '2026-09-28', hours: 3 }),
      row({ key: 'b', resourceId: 'zubaida', from: '2026-09-29', to: '2026-09-30', hours: 6 }),
      row({ key: 'c', resourceId: 'bad', hours: 2 }),
      row({ key: 'd', hours: 1 }),
    ]
    expect(planSummary(rows, isWorking)).toEqual({
      plannedHours: 11, withPerson: 3, total: 4, ready: 2, lastDay: '2026-09-30', byPerson: [{ resourceId: 'zubaida', count: 2 }],
    })
    expect(daysBeforeDue('2026-09-30', '2026-10-01')).toBe(1)
  })
})

describe('isAcceptableTaskName (SC-12)', () => {
  it('needs three letters — a code is not a name', () => {
    expect(isAcceptableTaskName('Voice-over script check')).toBe(true)
    expect(isAcceptableTaskName('T1')).toBe(false)
    expect(isAcceptableTaskName('مراجعة')).toBe(true)
  })
})

describe('bookButtonCounts — the button says what will happen (test script, 4 Oct)', () => {
  const ready = (key: string, resourceId: string) => row({ key, subTaskId: key, resourceId, from: '2026-10-07', to: '2026-10-07' })
  it('for the account manager every pick is an ask — none of them books', () => {
    const rows = [ready('a', 'r-maker'), ready('b', 'r-maker')]
    expect(bookButtonCounts(rows, (r) => r.key === 'a', () => true)).toEqual({ book: 0, ask: 2 })
  })
  it('for a lead a row in reach books and a row picked as an ask asks', () => {
    const rows = [ready('a', 'r-maker'), ready('b', 'r-writer'), row({ key: 'c' })]
    expect(bookButtonCounts(rows, (r) => r.key === 'b', (rid) => rid === 'r-writer')).toEqual({ book: 1, ask: 1 })
  })
})
