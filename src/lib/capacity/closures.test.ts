import { describe, expect, it } from 'vitest'
import { expandClosureDates, officeCalendarFromRow } from './closures'
import { isWorkingDay, nonWorkingDaysInSpan } from './working-week'
import { workingDaysInRange } from '../bookings/subtask-spread'
import { expandDaily } from '../bookings/recurrence'

/**
 * ADR-0079 d.4 — `OfficeCalendar` carries the closures and that is the whole seam. These tests
 * pin the property that matters: a closed day behaves exactly as a weekend does on every path that
 * asks "is this a working day", because they all ask the same function.
 */
describe('expandClosureDates', () => {
  it('expands a span into every day inside it, inclusive', () => {
    expect(expandClosureDates([{ starts_on: '2026-10-05', ends_on: '2026-10-07' }])).toEqual([
      '2026-10-05', '2026-10-06', '2026-10-07',
    ])
  })

  it('merges overlapping spans and sorts', () => {
    expect(
      expandClosureDates([
        { starts_on: '2026-10-06', ends_on: '2026-10-07' },
        { starts_on: '2026-10-05', ends_on: '2026-10-06' },
      ]),
    ).toEqual(['2026-10-05', '2026-10-06', '2026-10-07'])
  })

  it('crosses a month boundary without a Date in any timezone', () => {
    expect(expandClosureDates([{ starts_on: '2026-09-30', ends_on: '2026-10-01' }])).toEqual(['2026-09-30', '2026-10-01'])
  })

  it('ignores a malformed row rather than throwing', () => {
    expect(expandClosureDates([{ starts_on: 'eid', ends_on: '2026-10-01' }])).toEqual([])
    expect(expandClosureDates(null)).toEqual([])
  })
})

describe('officeCalendarFromRow', () => {
  it('builds the calendar the seam reads', () => {
    expect(
      officeCalendarFromRow({
        timezone: 'Asia/Baghdad',
        working_days: [7, 1, 2, 3, 4],
        office_closures: [{ starts_on: '2026-10-05', ends_on: '2026-10-05' }],
      }),
    ).toEqual({ timezone: 'Asia/Baghdad', workingDays: [7, 1, 2, 3, 4], closures: ['2026-10-05'] })
  })
})

describe('a closure travels the same path as a weekend (ADR-0079 d.3/d.4)', () => {
  // Monday 5 Oct 2026 is closed in Baghdad.
  const office = { timezone: 'Asia/Baghdad', workingDays: [7, 1, 2, 3, 4], closures: ['2026-10-05'] }

  it('isWorkingDay says no on the closed Monday and yes on the Tuesday', () => {
    expect(isWorkingDay({ isoDate: '2026-10-05', isoWeekday: 1 }, office)).toBe(false)
    expect(isWorkingDay({ isoDate: '2026-10-06', isoWeekday: 2 }, office)).toBe(true)
  })

  it('the spreader skips it', () => {
    const start = Date.parse('2026-10-04T06:00:00+03:00') // Sunday
    const due = Date.parse('2026-10-06T06:00:00+03:00') // Tuesday
    expect(workingDaysInRange(start, due, office).map((d) => d.isoDate)).toEqual(['2026-10-04', '2026-10-06'])
  })

  it('the candidate assessment lists it as a non-working day, so the drop warns', () => {
    const span = { start: Date.parse('2026-10-05T06:00:00+03:00'), end: Date.parse('2026-10-05T14:00:00+03:00') }
    expect(nonWorkingDaysInSpan(span, office)).toEqual(['2026-10-05'])
  })

  it('a daily series steps over it', () => {
    const first = { start: Date.parse('2026-10-04T06:00:00+03:00'), end: Date.parse('2026-10-04T14:00:00+03:00') }
    const out = expandDaily({ first, repeatCount: 2, timezone: office.timezone, workingDays: office.workingDays, closures: office.closures })
    expect(new Date(out[1].start).toISOString()).toBe('2026-10-06T03:00:00.000Z')
  })
})
