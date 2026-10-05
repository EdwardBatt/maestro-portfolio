import type { ScheduleBooking, ScheduleResource } from '../api/schedule-api'
import { iraqDay } from '../../../lib/time/iraq'

/**
 * What is wrong with dropping a chip on a day — the check the drag never had (I41.5).
 *
 * `onDrop` asked one question, "may I write this resource's row", and then moved the booking. The
 * target cell's non-working shade was the entire signal, and shading is passive: drop a task on a
 * Friday, or onto a day already over its ceiling, and it simply happened. That silence is half of
 * the I41.2 decision missing — hours slide forward off a day off *because* the assigner can drag
 * them back and be told what they are doing (Edward, 7 Sep: "dragged it back to Friday, no
 * warning").
 *
 * Pure, and separate from the grid, so the two things that must not drift — what the cell DISPLAYS
 * and what the drop WARNS about — are one calculation. `overloadFor` lived inside `DayGrid` and is
 * exported from here for exactly that reason.
 *
 * Not a gate. ADR-0061 d.2: say what is wrong, let them proceed, and let the audit record that
 * they did. The only level the database itself refuses is an exclusive double-book.
 */

export type OverloadLevel = 'warn' | 'breach'

export interface Overload {
  level: OverloadLevel
  /** load_based only: the projected summed load % for the day */
  pct?: number
  /** pooled / exclusive: how many bookings the day would hold */
  count?: number
}

/**
 * The summed load % of a resource-day's CONFIRMED bookings — the one figure `overloadFor` judges and
 * the Schedule's "8h free / Full / 4h over" line reads (I74.24), so the words in a cell and the
 * warning on a drop or a booking cannot disagree.
 */
export function confirmedLoadPct(cellBookings: readonly Pick<ScheduleBooking, 'state' | 'loadPct'>[]): number {
  return cellBookings.filter((b) => b.state === 'confirmed').reduce((sum, b) => sum + (b.loadPct ?? 0), 0)
}

/** Day overload level for a resource-day cell (confirmed bookings only). */
export function overloadFor(
  resource: Pick<ScheduleResource, 'capacityModel' | 'ceilingPct' | 'warnAtPct' | 'poolSize'>,
  cellBookings: readonly Pick<ScheduleBooking, 'state' | 'loadPct'>[],
): Overload | null {
  const confirmed = cellBookings.filter((b) => b.state === 'confirmed')
  if (resource.capacityModel === 'load_based') {
    const total = confirmedLoadPct(confirmed)
    if (resource.ceilingPct != null && total > resource.ceilingPct) return { level: 'breach', pct: total }
    if (resource.warnAtPct != null && total > resource.warnAtPct) return { level: 'warn', pct: total }
    return null
  }
  if (resource.capacityModel === 'pooled') {
    if (resource.poolSize != null && confirmed.length > resource.poolSize)
      return { level: 'breach', count: confirmed.length }
    return null
  }
  if (confirmed.length > 1) return { level: 'breach', count: confirmed.length } // exclusive: should be impossible
  return null
}

export interface DropCheck {
  /** the target day is not one the target resource's office works */
  nonWorking: boolean
  /** the target day would be over capacity WITH this booking on it, or null */
  overload: Overload | null
  /** the target day is blacked out for that resource */
  blackout: boolean
  /**
   * I59.13 (ADR-0105 d.5, D5): the moved work would end after the task's committed date — the L6
   * warning. Null when it does not, or when the task has no commitment to measure against.
   */
  pastCommitment?: PastCommitment | null
}

export interface PastCommitment {
  /** the Iraq day the task is committed to (ADR-0075 d.3, ADR-0076 d.1) */
  committedDay: string
  /** the day the moved work would end on */
  landsOn: string
  /** calendar days between the two */
  daysLate: number
}

export function hasFindings(c: DropCheck): boolean {
  return c.nonWorking || c.blackout || c.overload != null || c.pastCommitment != null
}

const DAY_MS = 86_400_000
const isoPlus = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)

/**
 * How many days a task spans, the way a drag keeps it: first to last day inclusive, never under
 * one. The reassignment keeps this length and moves the start to the drop day
 * (`useReassignTaskToResource`), so the check measures the same span the write will place.
 */
export function taskSpanDays(startsAt: string | null, dueAt: string | null): number {
  if (!startsAt || !dueAt) return 1
  return Math.max(1, Math.round((Date.parse(dueAt) - Date.parse(startsAt)) / DAY_MS) + 1)
}

/** The last day work of `spanDays` days dropped on `dropIso` lands on. */
export function landsOnDay(dropIso: string, spanDays: number): string {
  return isoPlus(dropIso, Math.max(1, spanDays) - 1)
}

/**
 * Does work ending on `landsOn` finish after the task's committed date? Warn, never refuse
 * (ADR-0061 d.2): this only says so, and "Move it anyway" stays on offer.
 */
export function pastCommitmentFor(landsOn: string, committedDueAt: string | null | undefined): PastCommitment | null {
  if (!committedDueAt) return null
  const committedDay = iraqDay(committedDueAt)
  if (landsOn <= committedDay) return null
  const daysLate = Math.round((Date.parse(`${landsOn}T00:00:00Z`) - Date.parse(`${committedDay}T00:00:00Z`)) / DAY_MS)
  return { committedDay, landsOn, daysLate }
}

/**
 * ADR-0141 d.2 (I74 fix-up): does the moved work end after the PIECE's due date? Only then does the move offer the
 * one change form to the account manager — a move past the task's own commitment that still lands on or before the
 * piece's due date is the lead's to make (the L6 warning says so, and "Move it anyway" stands), not a change to the
 * piece. No piece date, or no day the work lands on: nothing to ask.
 */
export function pastPieceDue(landsOn: string | null | undefined, pieceDueAt: string | null | undefined): boolean {
  if (!landsOn || !pieceDueAt) return false
  return landsOn > iraqDay(pieceDueAt)
}

/**
 * Assess a drop before it commits.
 *
 * `cellBookings` is what the target cell holds NOW. The moving booking is added to it, and removed
 * first by id: dragging a chip one day sideways within the same row would otherwise count against
 * itself and report an overload that only exists because the booking is being counted twice.
 */
export function assessDrop(input: {
  targetResource: ScheduleResource
  /** the cell's bookings, and (ADR-0142 d.4) its internal-work hours as `internalLoad` rows */
  cellBookings: readonly Pick<ScheduleBooking, 'id' | 'state' | 'loadPct'>[]
  moving: Pick<ScheduleBooking, 'id' | 'state' | 'loadPct'>
  nonWorking: boolean
  blackout: boolean
  /** I59.13: the task behind the move, when it has a commitment — the day the work would end on. */
  commitment?: { committedDueAt: string | null; landsOn: string } | null
}): DropCheck {
  const withMove = [
    ...input.cellBookings.filter((b) => b.id !== input.moving.id),
    input.moving,
  ]
  return {
    nonWorking: input.nonWorking,
    blackout: input.blackout,
    overload: overloadFor(input.targetResource, withMove),
    pastCommitment: input.commitment ? pastCommitmentFor(input.commitment.landsOn, input.commitment.committedDueAt) : null,
  }
}
