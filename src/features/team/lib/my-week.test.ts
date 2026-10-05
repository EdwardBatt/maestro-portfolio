import { describe, expect, it } from 'vitest'
import { hoursByDay } from './my-week'

describe('hoursByDay (I59.10 — Your week)', () => {
  const sunday = new Date(2026, 8, 20) // Sun 20 Sep 2026, local

  it('lays out seven days from the Sunday, marking the office working days', () => {
    const days = hoursByDay([], sunday, [7, 1, 2, 3, 4])
    expect(days.map((d) => d.date)).toEqual([
      '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26',
    ])
    expect(days.map((d) => d.working)).toEqual([true, true, true, true, true, false, false])
    expect(days.every((d) => d.hours === 0)).toBe(true)
  })

  it('adds each booking to the local day it starts on, and ignores days outside the week', () => {
    const at = (day: number, h: number) => new Date(2026, 8, day, h).toISOString()
    const days = hoursByDay(
      [
        { startsAt: at(20, 9), hours: 4 },
        { startsAt: at(20, 14), hours: 4 },
        { startsAt: at(23, 9), hours: 2.5 },
        { startsAt: at(27, 9), hours: 8 }, // next Sunday — not this week
        { startsAt: 'not a date', hours: 3 },
      ],
      sunday,
    )
    expect(days[0]!.hours).toBe(8)
    expect(days[3]!.hours).toBe(2.5)
    expect(days.reduce((n, d) => n + d.hours, 0)).toBe(10.5)
  })
})
