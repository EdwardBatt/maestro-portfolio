// ADR-0024 (Phase I / I1.3): spread a sub-task's TOTAL effort hours evenly across the office's
// working days between its start and due dates — the input the subtask-schedule materialiser
// turns into a daily series of bookings. Pure (no I/O), so it unit-tests cleanly and the same
// math can preview in the UI. All day reasoning is in the OFFICE's timezone (ADR-0005), reusing
// the capacity working-week helpers.

import { hoursToLoadPct } from '../capacity/day-hours.ts'
import { isWorkingDay, localDayOf } from '../capacity/working-week.ts'
import { addDaysWallTime } from './recurrence.ts'
import type { OfficeCalendar } from '../capacity/types.ts'

export interface WorkingDay {
  /** office-local ISO date, e.g. 2026-08-17 */
  isoDate: string
  /** ISO weekday 1=Mon … 7=Sun */
  isoWeekday: number
}

export interface DailyAllocation extends WorkingDay {
  /** hours allocated to this day */
  hours: number
  /** derived load %, via the standard-day constant */
  loadPct: number
}

// A sub-task shouldn't span more than a year of working days; also a loop backstop.
const MAX_SPAN_DAYS = 366

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/**
 * Office-local working dates in [startEpoch, dueEpoch], end-inclusive by calendar date.
 * Steps one wall-time day at a time (DST-safe via addDaysWallTime); ISO dates compare
 * lexically, which equals chronologically, so the loop terminates on the due date.
 */
export function workingDaysInRange(
  startEpoch: number,
  dueEpoch: number,
  office: OfficeCalendar,
): WorkingDay[] {
  if (dueEpoch < startEpoch) return []
  const dueDate = localDayOf(dueEpoch, office.timezone).isoDate
  const all: WorkingDay[] = []
  let cursor = startEpoch
  for (let i = 0; i < MAX_SPAN_DAYS; i++) {
    const d = localDayOf(cursor, office.timezone)
    all.push({ isoDate: d.isoDate, isoWeekday: d.isoWeekday })
    if (d.isoDate >= dueDate) break
    cursor = addDaysWallTime(cursor, 1, office.timezone)
  }
  const working = all.filter((d) => isWorkingDay(d, office))

  // ADR-0061 d.2 — **nothing blocks.** When the span contains no working day at all, the span IS
  // the answer: somebody deliberately picked those dates, the surface warned them it was a
  // non-working day, and they proceeded. Returning [] there is what made the whole thing silent —
  // the task was created, the scheduler placed nothing, and the dialog said "booked".
  //
  // Deliberately NOT "book every calendar day": when the span DOES contain working days those are
  // used and the rest are skipped, so a Monday-to-Sunday task still spreads Monday to Friday and no
  // weekend is booked by accident. The fallback fires only when there is no other honest answer.
  //
  // Nothing is passed in to trigger this — no flag from the dialog, no column on the task. An
  // override that has to travel is an override that gets lost on the next re-spread.
  return working.length > 0 ? working : all
}

/**
 * Spread `totalHours` evenly across the working days in the range, in tenths of an hour, so the
 * allocation sums back to totalHours and no day is negative; a day whose share is nothing is left out.
 *
 * Returns [] only when the total is non-positive or the range is inverted. A span with no working
 * day in it is spread across its calendar days instead (ADR-0061 d.2) — it used to return [], which
 * meant the caller booked nothing and said nothing.
 */
export function spreadHours(
  totalHours: number,
  startEpoch: number,
  dueEpoch: number,
  office: OfficeCalendar,
): DailyAllocation[] {
  const days = workingDaysInRange(startEpoch, dueEpoch, office)
  if (days.length === 0 || totalHours <= 0) return []
  // Spread in tenths of an hour so no day goes negative: rounding every day up and leaving the
  // remainder to the last day made 2h over 12 days end at -0.2h — a booking ending before it starts
  // (I74, found by the more-time browser test). Each day gets the even share; the leftover tenths go
  // one each to the LAST days (where the remainder always went); a day left with nothing is not booked at all.
  const tenths = Math.round(totalHours * 10)
  const base = Math.floor(tenths / days.length)
  const extra = tenths - base * days.length
  return days
    .map((d, i) => {
      const hours = round1((base + (i >= days.length - extra ? 1 : 0)) / 10)
      return { ...d, hours, loadPct: hoursToLoadPct(hours) }
    })
    .filter((d) => d.hours > 0)
}
