import type { ScheduleBooking, ScheduleResource } from '../api/schedule-api'
import { STANDARD_DAY_HOURS, hoursToLoadPct, loadPctToHours } from '../../../lib/capacity/day-hours.ts'
import { confirmedLoadPct, overloadFor, type Overload } from './drop-check.ts'

/**
 * A person's day in words — "8h free", "Full", "4h over", "On leave" (I74.24, Figma L SC-01).
 *
 * Read off the SAME two figures the drop and booking warnings use: `confirmedLoadPct` for the hours,
 * `overloadFor` for whether the day is over. So the line in a cell and the warning on a booking are
 * one calculation (capsule: "the grid's cell warning and its drop warning are one calculation").
 * A display, never a gate (ADR-0061 d.2).
 */

export type DayState = 'free' | 'full' | 'over' | 'off' | 'leave'

export interface DayLoad {
  state: DayState
  /** confirmed hours booked on the day */
  bookedHours: number
  /** room left on a working day; 0 when full, over, off or on leave */
  freeHours: number
  /** hours past a full day when over; 0 otherwise */
  overHours: number
  overload: Overload | null
}

type CapacityFields = Pick<ScheduleResource, 'capacityModel' | 'ceilingPct' | 'warnAtPct' | 'poolSize'>

const round1 = (n: number) => Math.round(n * 10) / 10

export function dayLoad(
  resource: CapacityFields,
  cellBookings: readonly Pick<ScheduleBooking, 'state' | 'loadPct'>[],
  opts: { nonWorking?: boolean; onLeave?: boolean } = {},
  dayHours: number = STANDARD_DAY_HOURS,
): DayLoad {
  const bookedHours = loadPctToHours(confirmedLoadPct(cellBookings), dayHours)
  const overload = overloadFor(resource, cellBookings)
  if (opts.onLeave) return { state: 'leave', bookedHours, freeHours: 0, overHours: 0, overload }
  if (opts.nonWorking) return { state: 'off', bookedHours, freeHours: 0, overHours: 0, overload }
  if (overload) return { state: 'over', bookedHours, freeHours: 0, overHours: Math.max(0, round1(bookedHours - dayHours)), overload }
  if (bookedHours >= dayHours) return { state: 'full', bookedHours, freeHours: 0, overHours: 0, overload }
  return { state: 'free', bookedHours, freeHours: round1(dayHours - bookedHours), overHours: 0, overload }
}

/** The free hours of a run of days — what "24h free this week" counts. Over days give nothing back. */
export function freeHoursOf(days: readonly DayLoad[]): number {
  return round1(days.reduce((sum, d) => sum + d.freeHours, 0))
}

/** The one short note under a name in the Who list (SC-04): the thing most worth knowing first. */
export type WeekNote =
  | { kind: 'over'; hours: number; isoDate: string }
  | { kind: 'leave'; isoDate: string }
  | { kind: 'full'; from: string; to: string }
  | { kind: 'free'; from: string; to: string }
  | { kind: 'none' }

/**
 * Over beats leave beats full beats free — the order a person booking needs to hear them in. A run is
 * the first unbroken stretch of working days in that state ("full Sun–Tue", "Mon–Thu free").
 */
export function weekNote(days: readonly { isoDate: string; load: DayLoad }[]): WeekNote {
  const over = days.find((d) => d.load.state === 'over')
  if (over) return { kind: 'over', hours: over.load.overHours, isoDate: over.isoDate }
  const leave = days.find((d) => d.load.state === 'leave')
  if (leave) return { kind: 'leave', isoDate: leave.isoDate }
  const working = days.filter((d) => d.load.state !== 'off')
  const run = (state: DayState) => {
    const start = working.findIndex((d) => d.load.state === state)
    if (start < 0) return null
    let end = start
    while (end + 1 < working.length && working[end + 1]!.load.state === state) end += 1
    return { from: working[start]!.isoDate, to: working[end]!.isoDate }
  }
  const full = run('full')
  if (full) return { kind: 'full', ...full }
  // Free means a whole day free: a part-booked day is not where the run starts.
  const wholeFree = working.map((d) => ({ ...d, load: { ...d.load, state: (d.load.state === 'free' && d.load.bookedHours === 0 ? 'free' : 'full') as DayState } }))
  const start = wholeFree.findIndex((d) => d.load.state === 'free')
  if (start < 0) return { kind: 'none' }
  let end = start
  while (end + 1 < wholeFree.length && wholeFree[end + 1]!.load.state === 'free') end += 1
  return { kind: 'free', from: wholeFree[start]!.isoDate, to: wholeFree[end]!.isoDate }
}

/**
 * ADR-0142 d.4 (I74.25): a day's internal-work hours as one confirmed load row, so `dayLoad`,
 * `overloadFor` and the drop check count them exactly as a booking — partial-day, never a whole-day
 * block. Empty when there are none. The id is stable per resource-day so a drop check never removes it.
 */
export function internalLoad(hours: number, key = 'internal'): { id: string; state: 'confirmed'; loadPct: number }[] {
  return hours > 0 ? [{ id: `internal:${key}`, state: 'confirmed', loadPct: hoursToLoadPct(hours) }] : []
}
