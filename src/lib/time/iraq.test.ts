import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CLOSE_HOUR, endOfWorkingDay, formatCalendarDay, formatDeadline, formatIraqDate, formatIraqDateTime,
  formatIraqShortDate, formatMoment, iraqDay, iraqZoneLabel,
} from './iraq'

/**
 * ADR-0076. These assertions are the ones that would have caught the defect the ADR closes: a
 * deadline written as midnight UTC and printed as the UTC day, correct only while every user sat
 * east of UTC. Vitest pins no TZ and CI runs UTC, so nothing here may depend on the machine's clock.
 */
/** "Today" for every assertion that depends on the year: 29 Sep 2026, noon in Baghdad. */
const NOW = Date.parse('2026-09-29T09:00:00Z')

describe('the company clock is Iraq (ADR-0076)', () => {
  // formatDeadline and formatMoment take no `nowMs`, so the year they print follows the clock: pin its date.
  afterEach(() => { vi.useRealTimers() })
  const pinToday = () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) }

  it('puts the close of the working day at 18:00 Iraq, which is 15:00 UTC', () => {
    const d = endOfWorkingDay('2027-03-12')
    expect(d.toISOString()).toBe('2027-03-12T15:00:00.000Z')
    expect(CLOSE_HOUR).toBe(18)
  })

  it('reads the same wall time back out in Iraq', () => {
    const shown = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Baghdad', hour: '2-digit', hourCycle: 'h23', minute: '2-digit',
    }).format(endOfWorkingDay('2027-03-12'))
    expect(shown).toBe('18:00')
  })

  it('holds across the dates when Europe changes its clocks — Iraq does not observe DST', () => {
    // Late March and late October, either side of European DST transitions.
    expect(endOfWorkingDay('2027-03-30').toISOString()).toBe('2027-03-30T15:00:00.000Z')
    expect(endOfWorkingDay('2027-10-30').toISOString()).toBe('2027-10-30T15:00:00.000Z')
  })

  /**
   * The heart of it. 22:00 UTC on the 11th is already the 12th in Iraq. `slice(0, 10)` — the
   * banned mechanism (d.6) — answers "2027-03-11" and is wrong by a day.
   */
  it('reads the IRAQ day of an instant, not the UTC one', () => {
    const lateUtc = '2027-03-11T22:00:00Z'
    expect(iraqDay(lateUtc)).toBe('2027-03-12')
    expect(lateUtc.slice(0, 10)).toBe('2027-03-11') // what the old code answered
  })

  it('agrees with itself: the close of a day is still that day in Iraq', () => {
    expect(iraqDay(endOfWorkingDay('2027-03-12'))).toBe('2027-03-12')
  })

  it('names the clock on a deadline, because one clock is only safe if it is stated (d.2)', () => {
    pinToday()
    expect(formatDeadline(endOfWorkingDay('2027-03-12'), 'en')).toBe('Fri, 12 Mar 2027 (Iraq time)')
    expect(formatDeadline(endOfWorkingDay('2026-10-09'), 'en')).toBe('Fri, 9 Oct (Iraq time)')
  })

  it('names the clock on a moment too', () => {
    pinToday()
    expect(formatMoment(endOfWorkingDay('2027-03-12'), 'en')).toBe('Fri, 12 Mar 2027, 18:00 (Iraq time)')
    expect(formatMoment(endOfWorkingDay('2026-10-09'), 'en')).toBe('Fri, 9 Oct, 18:00 (Iraq time)')
  })

  it('says it in Arabic as well', () => {
    pinToday()
    expect(iraqZoneLabel('ar')).toBe('بتوقيت العراق')
    expect(formatDeadline(endOfWorkingDay('2026-10-09'), 'ar')).toBe('الجمعة، 9 أكتوبر (بتوقيت العراق)')
    expect(formatMoment(endOfWorkingDay('2026-10-09'), 'ar')).toBe('الجمعة، 9 أكتوبر، 18:00 (بتوقيت العراق)')
  })

  it('formats a bare date and a date-time in Iraq regardless of the runner’s zone', () => {
    // 23:30 UTC on the 11th is 02:30 on the 12th in Baghdad: a UTC runner would print the 11th.
    const crossing = '2027-03-11T23:30:00Z'
    expect(formatIraqDate(crossing, 'en', NOW)).toBe('Fri, 12 Mar 2027')
    expect(formatIraqDateTime(crossing, 'en', NOW)).toBe('Fri, 12 Mar 2027, 02:30')
  })
})

/** I66.8 (29 Sep 2026): every date reads weekday, day, month; the year only when it is not this year. */
describe('every date reads weekday, day, month (I66.8)', () => {
  const oct9 = endOfWorkingDay('2026-10-09')

  it('reads "Fri, 9 Oct" in English', () => {
    expect(formatIraqDate(oct9, 'en', NOW)).toBe('Fri, 9 Oct')
    expect(formatIraqShortDate(oct9, 'en', NOW)).toBe('Fri, 9 Oct')
    expect(formatCalendarDay('2026-10-09', 'en', NOW)).toBe('Fri, 9 Oct')
  })

  it('reads "الجمعة، 9 أكتوبر" in Arabic — pan-Arab month, Western digits', () => {
    expect(formatIraqDate(oct9, 'ar', NOW)).toBe('الجمعة، 9 أكتوبر')
    expect(formatCalendarDay('2026-10-09', 'ar', NOW)).toBe('الجمعة، 9 أكتوبر')
    expect(formatIraqDate(oct9, 'ar', NOW)).not.toMatch(/[٠-٩]/)
  })

  it('puts the time after the day, with the comma of each language', () => {
    expect(formatIraqDateTime('2026-10-09T12:00:00Z', 'en', NOW)).toBe('Fri, 9 Oct, 15:00')
    expect(formatIraqDateTime('2026-10-09T12:00:00Z', 'ar', NOW)).toBe('الجمعة، 9 أكتوبر، 15:00')
  })

  it('shows the year only when the date is not in the current year', () => {
    expect(formatCalendarDay('2027-10-09', 'en', NOW)).toBe('Sat, 9 Oct 2027')
    expect(formatCalendarDay('2025-10-09', 'en', NOW)).toBe('Thu, 9 Oct 2025')
    expect(formatIraqDate(endOfWorkingDay('2027-03-12'), 'ar', NOW)).toBe('الجمعة، 12 مارس 2027')
    // The same day read from within 2027 drops the year.
    expect(formatCalendarDay('2027-10-09', 'en', Date.parse('2027-01-05T09:00:00Z'))).toBe('Sat, 9 Oct')
  })

  it('writes September "Sep", never "Sept"', () => {
    expect(formatCalendarDay('2026-09-30', 'en', NOW)).toBe('Wed, 30 Sep')
    expect(formatIraqDate(endOfWorkingDay('2026-09-30'), 'en', NOW)).toBe('Wed, 30 Sep')
  })

  it('hands back a calendar day that is not a real date unchanged', () => {
    expect(formatCalendarDay('20266-10-09', 'en', NOW)).toBe('20266-10-09')
  })
})
