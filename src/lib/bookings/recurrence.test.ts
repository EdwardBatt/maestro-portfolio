import { describe, expect, it } from 'vitest'
import { addDaysWallTime, expandDaily, expandWeekly, tzOffsetMs } from './recurrence.ts'
import { localDayOf } from '../capacity/working-week.ts'

describe('weekly recurrence — wall-time preserving (M4.3, §12 DST edges)', () => {
  it('Baghdad (no DST): instances exactly 7×24h apart', () => {
    const first = { start: Date.parse('2026-08-02T07:00:00Z'), end: Date.parse('2026-08-02T11:00:00Z') } // Sun 10:00 Baghdad
    const spans = expandWeekly({ first, repeatCount: 4, intervalWeeks: 1, timezone: 'Asia/Baghdad' })
    expect(spans).toHaveLength(4)
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]!.start - spans[i - 1]!.start).toBe(7 * 86_400_000)
    }
  })

  it('Cairo series crossing the October DST fall-back keeps 10:00 local start', () => {
    // Thursdays 10:00 Cairo, starting before Egypt's 2026-10-29 end of DST (UTC+3 → UTC+2)
    const first = {
      start: Date.parse('2026-10-15T07:00:00Z'), // 10:00 Cairo (DST, UTC+3)
      end: Date.parse('2026-10-15T12:00:00Z'),
    }
    const spans = expandWeekly({ first, repeatCount: 4, intervalWeeks: 1, timezone: 'Africa/Cairo' })
    const localHours = spans.map((s) => {
      const off = tzOffsetMs(s.start, 'Africa/Cairo')
      return new Date(s.start + off).getUTCHours()
    })
    expect(localHours).toEqual([10, 10, 10, 10]) // wall time held through the transition
    // and the post-transition instant is genuinely a different UTC hour
    expect(new Date(spans[3]!.start).getUTCHours()).not.toBe(new Date(spans[0]!.start).getUTCHours())
  })

  it('interval_weeks spaces occurrences correctly', () => {
    const first = { start: Date.parse('2026-08-03T06:00:00Z'), end: Date.parse('2026-08-03T08:00:00Z') }
    const spans = expandWeekly({ first, repeatCount: 3, intervalWeeks: 2, timezone: 'Asia/Dubai' })
    expect(localDayOf(spans[1]!.start, 'Asia/Dubai').isoDate).toBe('2026-08-17')
    expect(localDayOf(spans[2]!.start, 'Asia/Dubai').isoDate).toBe('2026-08-31')
  })

  it('duration is preserved per instance', () => {
    const first = { start: Date.parse('2026-08-03T06:00:00Z'), end: Date.parse('2026-08-03T09:30:00Z') }
    for (const s of expandWeekly({ first, repeatCount: 5, intervalWeeks: 1, timezone: 'Africa/Cairo' })) {
      expect(s.end - s.start).toBe(3.5 * 3600_000)
    }
  })

  it('addDaysWallTime is identity-consistent in a no-DST zone', () => {
    const t = Date.parse('2026-08-03T06:00:00Z')
    expect(addDaysWallTime(t, 7, 'Asia/Dubai') - t).toBe(7 * 86_400_000)
  })
})

/**
 * I41.2. A user booked Thursday for "2 days x 8h" got all 16 hours on Thursday: the second day
 * landed on Friday, which nobody works, and the spreader then had one working day to put 16 hours
 * on. The count is what the assigner asked for, so a day off must not consume one of the days.
 */
describe('daily recurrence steps over the office weekend (I41.2)', () => {
  // Baghdad works Sun-Thu (ISO 7,1,2,3,4). Friday and Saturday are off.
  const BAGHDAD = [7, 1, 2, 3, 4]
  const TZ = 'Asia/Baghdad'
  // Thu 3 Sep 2026, 09:00-17:00 Baghdad.
  const first = { start: Date.parse('2026-09-03T06:00:00Z'), end: Date.parse('2026-09-03T14:00:00Z') }
  const days = (spans: { start: number }[]) => spans.map((s) => localDayOf(s.start, TZ).isoDate)

  it('places the second day on Sunday, not Friday', () => {
    const spans = expandDaily({ first, repeatCount: 2, timezone: TZ, workingDays: BAGHDAD })
    expect(days(spans)).toEqual(['2026-09-03', '2026-09-06'])
  })

  it('keeps going over the whole working week', () => {
    const spans = expandDaily({ first, repeatCount: 4, timezone: TZ, workingDays: BAGHDAD })
    expect(days(spans)).toEqual(['2026-09-03', '2026-09-06', '2026-09-07', '2026-09-08'])
  })

  it('never moves the FIRST day, even onto a day off (ADR-0061 d.2 — nothing blocks)', () => {
    // Fri 4 Sep, deliberately chosen. It is booked on the Friday and warned about, not silently slid.
    const onFriday = { start: Date.parse('2026-09-04T06:00:00Z'), end: Date.parse('2026-09-04T14:00:00Z') }
    const spans = expandDaily({ first: onFriday, repeatCount: 2, timezone: TZ, workingDays: BAGHDAD })
    expect(days(spans)).toEqual(['2026-09-04', '2026-09-06'])
  })

  it('is unchanged when no office calendar is passed', () => {
    const spans = expandDaily({ first, repeatCount: 3, timezone: TZ })
    expect(days(spans)).toEqual(['2026-09-03', '2026-09-04', '2026-09-05'])
  })

  it('leaves a WEEKLY series on its weekday — stepping would break the point of it', () => {
    // Fri 4 Sep weekly in Baghdad: every occurrence stays a Friday, day off or not.
    const onFriday = { start: Date.parse('2026-09-04T06:00:00Z'), end: Date.parse('2026-09-04T14:00:00Z') }
    const spans = expandWeekly({ first: onFriday, repeatCount: 3, intervalWeeks: 1, timezone: TZ })
    expect(days(spans)).toEqual(['2026-09-04', '2026-09-11', '2026-09-18'])
  })

  it('preserves each instance duration when it steps', () => {
    const spans = expandDaily({ first, repeatCount: 3, timezone: TZ, workingDays: BAGHDAD })
    for (const s of spans) expect(s.end - s.start).toBe(8 * 3600_000)
  })
})
