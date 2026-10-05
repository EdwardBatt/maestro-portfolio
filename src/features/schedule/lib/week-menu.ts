import type { ScheduleBooking, ScheduleResource } from '../api/schedule-api'
import { STANDARD_DAY_HOURS } from '../../../lib/capacity/day-hours.ts'
import { isWorkingDay, localDayOf } from '../../../lib/capacity/working-week.ts'
import { dayLoad } from './day-load.ts'

/**
 * The weeks menu (I74.24, Figma L SC-20): last week, this week and the three after it, each with how
 * full the viewer's team is: the hours the grid's cells count (`dayLoad`) over the working days at a
 * standard day, summed over the people on the grid — a display, never a gate.
 */

const DAY = 86_400_000
export const WEEK_OFFSETS = [-1, 0, 1, 2, 3] as const

export interface WeekOption {
  /** UTC midnight of the week's Sunday */
  start: number
  /** weeks from this one: -1 last, 0 this, 1 next */
  offset: number
  /** booked over capacity, whole percent */
  pct: number
}

export function teamWeekPct(resources: readonly ScheduleResource[], bookings: readonly ScheduleBooking[], weekStart: number, dayHours = STANDARD_DAY_HOURS): number {
  let booked = 0
  let capacity = 0
  for (const r of resources) {
    if (r.kind !== 'human') continue
    const own = bookings.filter((b) => b.resourceId === r.id)
    for (let i = 0; i < 7; i += 1) {
      const day = weekStart + i * DAY
      if (r.office && !isWorkingDay(localDayOf(day + 43_200_000, r.office.timezone), r.office)) continue
      // The grid's own reading of a day (`dayLoad`): confirmed load, so the menu and the cells agree.
      booked += dayLoad(r, own.filter((b) => b.start < day + DAY && b.end > day)).bookedHours
      capacity += dayHours
    }
  }
  return capacity > 0 ? Math.round((booked / capacity) * 100) : 0
}

export function weekOptions(thisWeekStart: number, resources: readonly ScheduleResource[], bookings: readonly ScheduleBooking[]): WeekOption[] {
  return WEEK_OFFSETS.map((offset) => {
    const start = thisWeekStart + offset * 7 * DAY
    return { start, offset, pct: teamWeekPct(resources, bookings, start) }
  })
}

/** "This week" / "Next week" / "Last week", else none — the pill's first words (SC-20, SC-21b). */
export function weekWord(start: number, thisWeekStart: number): 'last' | 'this' | 'next' | null {
  const off = Math.round((start - thisWeekStart) / (7 * DAY))
  return off === 0 ? 'this' : off === 1 ? 'next' : off === -1 ? 'last' : null
}

/**
 * The first and last working day of a week for an office: "27 Sep – 1 Oct" for Sun–Thu. `workingDays`
 * are ISO weekdays (1 = Mon … 7 = Sun, ADR-0005); the week starts on Sunday.
 */
export function workingRange(weekStart: number, workingDays: readonly number[] = [7, 1, 2, 3, 4]): { from: string; to: string } {
  const days = workingDays.map((d) => d % 7).sort((a, b) => a - b)
  const first = days[0] ?? 0
  const last = days[days.length - 1] ?? 6
  const iso = (n: number) => new Date(weekStart + n * DAY).toISOString().slice(0, 10)
  return { from: iso(first), to: iso(last) }
}
