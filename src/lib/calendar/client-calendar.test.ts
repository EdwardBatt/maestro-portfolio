import { describe, expect, it } from 'vitest'
import { clientCalendar } from './client-calendar'
import { computeLeadTime } from '../campaigns/lead-time'
import { dayStrip } from '../../features/intake/lib/lead-time'
import { classifyDueDate, workingDaysBetween } from '../campaigns/go-live-dates'

/**
 * ADR-0123 d.3 — the client's country is the calendar of its work. Iraq works Sunday to Thursday,
 * the UAE Monday to Friday; the same job, due the same Tuesday, starts on a different day.
 */
const IRAQ = [7, 1, 2, 3, 4]
const UAE = [1, 2, 3, 4, 5]
const office = { workingDays: IRAQ, closures: ['2026-10-05'] }

describe('the client calendar (ADR-0123 d.3)', () => {
  it("takes the country's week and keeps the office's closures", () => {
    expect(clientCalendar(UAE, office)).toEqual({ workingDays: UAE, closures: ['2026-10-05'] })
  })

  it("falls back to the office's week, then to Iraq's, never a blank week", () => {
    expect(clientCalendar(null, { workingDays: [1, 2, 3] })).toEqual({ workingDays: [1, 2, 3] })
    expect(clientCalendar([], null)).toEqual({ workingDays: IRAQ })
  })

  it('counts a three-day job due Tuesday 6 Oct back to Sunday in Iraq and to Friday in the UAE', () => {
    expect(computeLeadTime('2026-10-06', 24, '2026-09-28', { workingDays: IRAQ })?.startDay).toBe('2026-10-04')
    expect(computeLeadTime('2026-10-06', 24, '2026-09-28', { workingDays: UAE })?.startDay).toBe('2026-10-02')
  })

  it("the UAE's Friday is a working day and its Sunday is not", () => {
    // After Friday 2 Oct up to Sunday 4 Oct: Iraq counts the Sunday; the UAE counts nothing.
    expect(workingDaysBetween('2026-10-02', '2026-10-04', { workingDays: IRAQ })).toBe(1)
    expect(workingDaysBetween('2026-10-02', '2026-10-04', { workingDays: UAE })).toBe(0)
  })

  it("the intake's day strip marks the client's weekend", () => {
    const uae = dayStrip('2026-10-06', 3, 'en', { workingDays: UAE })
    expect(uae.map((d) => [d.iso, d.kind])).toEqual([
      ['2026-10-02', 'start'],
      ['2026-10-03', 'weekend'],
      ['2026-10-04', 'weekend'],
      ['2026-10-05', 'working'],
      ['2026-10-06', 'due'],
    ])
    const iraq = dayStrip('2026-10-06', 3, 'en', { workingDays: IRAQ })
    expect(iraq.map((d) => d.kind)).toEqual(['start', 'working', 'due'])
  })

  it("the working days left before a go-live are counted on the client's week", () => {
    // Due Friday 2 Oct, live Thursday 8 Oct: Iraq has Sunday to Thursday after it (5), the UAE Monday to Thursday (4).
    const iraq = classifyDueDate({ dueDay: '2026-10-02', goLiveDay: '2026-10-08', calendar: { workingDays: IRAQ } })
    const uae = classifyDueDate({ dueDay: '2026-10-02', goLiveDay: '2026-10-08', calendar: { workingDays: UAE } })
    expect(iraq.workingDaysToGoLive).toBe(5)
    expect(uae.workingDaysToGoLive).toBe(4)
  })
})
