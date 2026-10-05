import { describe, expect, it } from 'vitest'
import {
  applyGoLiveDates,
  classifyDueDate,
  datesFromGoLive,
  minusDays,
  minusWorkingDays,
  startFromDue,
  COMMENCE_DAYS_BEFORE_DELIVERY,
  DELIVERY_DAYS_BEFORE_GO_LIVE,
  IRAQ_WORKING_CALENDAR,
} from './go-live-dates'

/**
 * Edward, 29 Aug: "delivery 2 days before go live, commence by 4 days before delivery."
 *
 * Two properties matter more than the arithmetic. Dates must not shift across a DST boundary — the
 * failure that put a booking on the wrong day in `I17`. And setting a go-live must never overwrite
 * a date somebody typed, because that is a commitment they made and silently re-planning it is the
 * same class of surprise ADR-0052 d.14 refuses by name.
 */

describe('minusDays', () => {
  it('subtracts calendar days', () => {
    expect(minusDays('2027-03-15', 2)).toBe('2027-03-13')
  })

  it('crosses a month boundary', () => {
    expect(minusDays('2027-03-01', 2)).toBe('2027-02-27')
  })

  it('crosses a year boundary', () => {
    expect(minusDays('2027-01-01', 2)).toBe('2026-12-30')
  })

  it('handles a leap day', () => {
    expect(minusDays('2028-03-01', 1)).toBe('2028-02-29')
  })

  // The I17 class of bug: a local Date built from an ISO string and shifted by days lands on the
  // wrong calendar day when the subtraction crosses a DST change. Europe springs forward on
  // 2027-03-28; a naive implementation returns the 27th here.
  it('does not drift across a DST boundary', () => {
    expect(minusDays('2027-03-29', 2)).toBe('2027-03-27')
    expect(minusDays('2027-10-31', 1)).toBe('2027-10-30')
  })

  it('returns the input unchanged rather than guessing at nonsense', () => {
    expect(minusDays('', 2)).toBe('')
    expect(minusDays('not-a-date', 2)).toBe('not-a-date')
  })
})

describe('minusWorkingDays (ADR-0078 — a day is a WORKING day)', () => {
  const iraq = IRAQ_WORKING_CALENDAR

  // THE defect I41.9 was raised for: a Sunday go-live gave a Friday delivery date.
  it('a Sunday minus 2 working days in Baghdad is Wednesday, never the Friday nobody works', () => {
    expect(minusWorkingDays('2026-10-04', 2, iraq)).toBe('2026-09-30') // Sun → Thu(1) → Wed(2)
  })

  it('steps over a closure exactly as it steps over a weekend (ADR-0079 d.4)', () => {
    const withEid = { ...iraq, closures: ['2026-09-30', '2026-10-01'] }
    expect(minusWorkingDays('2026-10-04', 2, withEid)).toBe('2026-09-28') // Wed+Thu closed → Tue(1) → Mon(2)
  })

  it('a go-live on a day off still counts back from that day', () => {
    expect(minusWorkingDays('2026-10-02', 1, iraq)).toBe('2026-10-01') // Fri → Thu
  })

  it('zero or negative days is the same day', () => {
    expect(minusWorkingDays('2026-10-04', 0, iraq)).toBe('2026-10-04')
  })

  it('an office that works no day falls back to calendar days rather than looping', () => {
    expect(minusWorkingDays('2026-10-04', 2, { workingDays: [] })).toBe('2026-10-02')
  })
})

/**
 * Edward, 24 Sep (`I56.11`): THE COUNT-BACK IS INCLUSIVE. "It needs four days" means four days of
 * work ending ON the day it is due, which is what Figma `CB-v3-04` prints and what
 * `lib/timing/plan-back.ts` has always done. This file counted exclusively and finished a clear
 * day early, so the same piece started on two different days depending on which screen asked.
 * There is now one function — this one — and `plan-back.ts` re-exports it.
 */
describe('startFromDue (the ONE inclusive count-back)', () => {
  const iraq = IRAQ_WORKING_CALENDAR

  it('counts the due day itself — 4 days due Wed 30 Sep starts Sun 27 Sep', () => {
    // The frame's four rows: 27, 28, 29, 30 is four days of work, not five.
    expect(startFromDue('2026-09-30', 4, iraq)).toBe('2026-09-27')
    expect(startFromDue('2026-09-30', 9, iraq)).toBe('2026-09-20')
  })

  it('a piece that needs one day starts on the day it is due', () => {
    expect(startFromDue('2026-09-30', 1, iraq)).toBe('2026-09-30')
    expect(startFromDue('2026-09-30', 0, iraq)).toBe('2026-09-30')
  })

  it('steps over the weekend exactly as minusWorkingDays does — it IS minusWorkingDays, minus one', () => {
    expect(startFromDue('2026-10-04', 3, iraq)).toBe('2026-09-30') // Sun; Thu(2), Wed(3)
    expect(startFromDue('2026-10-04', 3, iraq)).toBe(minusWorkingDays('2026-10-04', 2, iraq))
  })
})

describe('datesFromGoLive', () => {
  // 2027-03-15 is a Monday. Iraq: Mon → Sun(1) → Thu(2) = 11 Mar.
  it('puts delivery 2 WORKING days before go-live and commencement 4 counting the due day', () => {
    // MOVED 7 Mar → 8 Mar, one working day later (Edward, 24 Sep): commence-by is a DURATION, so
    // the four days are 8, 9, 10 and 11 March — the due day is the fourth of them, not a fifth day
    // after them. Delivery is unchanged: go-live minus 2 is a GAP between two events, still
    // exclusive, and it already agreed with `plan-back`'s `phaseDueDate`.
    expect(datesFromGoLive('2027-03-15')).toEqual({ dueAt: '2027-03-11', commenceAt: '2027-03-08' })
    expect(DELIVERY_DAYS_BEFORE_GO_LIVE).toBe(2)
    expect(COMMENCE_DAYS_BEFORE_DELIVERY).toBe(4)
  })

  it('reads the rule from the tenant setting, not the constant (I41.10)', () => {
    // MOVED 11 Mar → 14 Mar, one working day later. A tenant that says one day of work gets a job
    // that starts and finishes on its due day, which is what one day means.
    expect(
      datesFromGoLive('2027-03-15', IRAQ_WORKING_CALENDAR, { deliveryDaysBeforeGoLive: 1, commenceDaysBeforeDelivery: 1 }),
    ).toEqual({ dueAt: '2027-03-14', commenceAt: '2027-03-14' })
  })

  // "Quite often the client does not want to confirm go live" — the ordinary case, not a failure.
  it('derives nothing without a go-live', () => {
    expect(datesFromGoLive(null)).toBeNull()
    expect(datesFromGoLive('')).toBeNull()
    expect(datesFromGoLive(undefined)).toBeNull()
  })
})

describe('applyGoLiveDates', () => {
  const blank = { id: 'a', commenceAt: null, dueAt: null }

  it('fills every empty row', () => {
    const out = applyGoLiveDates([blank, { ...blank, id: 'b' }], '2027-03-15')
    expect(out.rows.map((r) => r.dueAt)).toEqual(['2027-03-11', '2027-03-11'])
    // MOVED 7 Mar → 8 Mar: the inclusive count-back (Edward, 24 Sep). Same rule as the row above.
    expect(out.rows.map((r) => r.commenceAt)).toEqual(['2027-03-08', '2027-03-08'])
    expect(out.filled).toBe(2)
  })

  // THE property. A typed date is a commitment; overwriting it because the go-live moved is the
  // silent reschedule I17 was raised for.
  it('never overwrites a date somebody typed', () => {
    const out = applyGoLiveDates(
      [{ id: 'a', commenceAt: '2027-01-01', dueAt: '2027-01-05' }],
      '2027-03-15',
    )
    expect(out.rows[0]).toEqual({ id: 'a', commenceAt: '2027-01-01', dueAt: '2027-01-05' })
    expect(out.filled).toBe(0)
    expect(out.kept).toBe(1)
  })

  it('fills only the half that is empty', () => {
    const out = applyGoLiveDates([{ id: 'a', commenceAt: null, dueAt: '2027-01-05' }], '2027-03-15')
    // MOVED 7 Mar → 8 Mar: the inclusive count-back. The TYPED due date is still untouched,
    // which is the property this case exists for.
    expect(out.rows[0]).toEqual({ id: 'a', commenceAt: '2027-03-08', dueAt: '2027-01-05' })
    expect(out.filled).toBe(1)
  })

  it('reports how many rows it left alone, so the surface can say so', () => {
    const out = applyGoLiveDates(
      [blank, { id: 'b', commenceAt: '2027-01-01', dueAt: '2027-01-05' }],
      '2027-03-15',
    )
    expect(out).toMatchObject({ filled: 1, kept: 1 })
  })

  it('changes nothing at all when the go-live is cleared', () => {
    const rows = [{ id: 'a', commenceAt: '2027-01-01', dueAt: '2027-01-05' }]
    const out = applyGoLiveDates(rows, null)
    expect(out.rows).toEqual(rows)
    expect(out).toMatchObject({ filled: 0, kept: 0 })
  })

  it('does not mutate what it was given', () => {
    const rows = [blank]
    applyGoLiveDates(rows, '2027-03-15')
    expect(rows[0]!.dueAt).toBeNull()
  })
})

describe('classifyDueDate (I41.8, ADR-0075 d.9 — warn, never block; refuse only after go-live)', () => {
  const goLive = '2026-10-04' // a Sunday

  it('is ok with the full offset of working days in hand', () => {
    expect(classifyDueDate({ dueDay: '2026-09-30', goLiveDay: goLive }).severity).toBe('ok') // Thu, Sun = 2
  })

  it('is tight inside the window', () => {
    const out = classifyDueDate({ dueDay: '2026-10-01', goLiveDay: goLive }) // only Sunday left
    expect(out).toMatchObject({ severity: 'tight', workingDaysToGoLive: 1, requiredDays: 2 })
  })

  it('a due date ON the go-live day is impossible, not tight', () => {
    expect(classifyDueDate({ dueDay: goLive, goLiveDay: goLive }).severity).toBe('impossible')
  })

  it('is impossible when the outstanding hours exceed the days left to do them', () => {
    const out = classifyDueDate({ dueDay: '2026-09-30', goLiveDay: goLive, outstandingHours: 40, workingDaysToDue: 2 })
    expect(out).toMatchObject({ severity: 'impossible', capacityHours: 16, outstandingHours: 40 })
  })

  it('a date after go-live is the one refusal', () => {
    expect(classifyDueDate({ dueDay: '2026-10-05', goLiveDay: goLive }).severity).toBe('after_go_live')
  })

  it('says nothing without a go-live — the ordinary case', () => {
    expect(classifyDueDate({ dueDay: '2026-10-05', goLiveDay: null }).severity).toBe('ok')
  })

  it('reads the tenant offset (I41.10)', () => {
    const rule = { deliveryDaysBeforeGoLive: 1, commenceDaysBeforeDelivery: 4 }
    expect(classifyDueDate({ dueDay: '2026-10-01', goLiveDay: goLive, rule }).severity).toBe('ok')
  })
})
