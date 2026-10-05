/**
 * The two figures ADR-0075 d.4's first clause compares (I57.12), from the rows they live in:
 *
 *   hours_remaining    = the task's hours − the minutes logged THIS round
 *   capacity_remaining = the assignee's hours booked on the task between now and committed_due_at
 *
 * "Booked" is the assignee's bookings ON THIS TASK (`bookings.sub_task_id`, on the resource mapped to
 * the assignee — ADR-0042 d.5, the same bookings `app.sync_subtask_span` builds the task's dates
 * from). Their other bookings are other work, not time for this one.
 *
 * A booking's hours are the booking vocabulary (ADR-0006): its load in hours per day where it has
 * one, else its length. The part already behind `now` or past the deadline is not time left, so a
 * booking counts in proportion to how much of it falls inside the window.
 */

import { loadPctToHours, STANDARD_DAY_HOURS } from '../capacity/day-hours.ts'

export interface BookedSpan {
  start: number
  end: number
  loadPct: number | null
}

const HOUR = 3_600_000
const DAY = 86_400_000

/** The hours a booking holds in all: hours per day × the days it spans, else its length. */
export function bookingHours(b: BookedSpan, dayHours: number = STANDARD_DAY_HOURS): number {
  if (b.end <= b.start) return 0
  if (b.loadPct == null) return (b.end - b.start) / HOUR
  return loadPctToHours(b.loadPct, dayHours) * Math.max(1, Math.ceil((b.end - b.start) / DAY))
}

/** Hours booked inside [from, to]: each booking in proportion to its part inside the window. */
export function bookedHoursBetween(
  bookings: readonly BookedSpan[],
  from: number,
  to: number,
  dayHours: number = STANDARD_DAY_HOURS,
): number {
  let total = 0
  for (const b of bookings) {
    const lo = Math.max(b.start, from)
    const hi = Math.min(b.end, to)
    if (hi <= lo || b.end <= b.start) continue
    total += bookingHours(b, dayHours) * ((hi - lo) / (b.end - b.start))
  }
  return Math.round(total * 10) / 10
}

export interface LoggedEntry {
  minutes: number | null
  /** A running timer: it has started and not been submitted, so `minutes` is not written yet. */
  startedAt: string | null
  submittedAt: string | null
}

/** The task's hours less what was logged this round — a running timer counts up to `now`. Never
 *  below zero; null when nobody said how long the task takes. */
export function hoursRemaining(hours: number | null, entries: readonly LoggedEntry[], now: number): number | null {
  if (hours == null || hours <= 0) return null
  let minutes = 0
  for (const e of entries) {
    if (e.minutes != null) minutes += e.minutes
    else if (e.startedAt && !e.submittedAt) minutes += Math.max(0, (now - Date.parse(e.startedAt)) / 60_000)
  }
  return Math.max(0, Math.round((hours - minutes / 60) * 10) / 10)
}
