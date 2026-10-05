import type { ScheduleBooking, ScheduleResource } from '../api/schedule-api'
import { STANDARD_DAY_HOURS } from '../../../lib/capacity/day-hours.ts'

/**
 * How full a person's week is, and who has room — the figures the move warnings name (I59.13,
 * Figma L6 / L7: "Fadia W. is free", "Give it to Zuhour instead").
 *
 * The same rule the Team page has always shown (`useTeamLoad`): booked hours in the week over the
 * office's working days at a standard day, as a whole percent. `team-api` reads `weekLoadPct`
 * from here, so the number on the team timeline and the name a Schedule warning offers are one
 * calculation. A display figure, never a gate (ADR-0061 d.2).
 */

const DAY_MS = 86_400_000

/** booked / nominal, as a whole percent; 0 when there are no working days. */
export function weekLoadPct(bookedHours: number, workingDays: number, dayHours = STANDARD_DAY_HOURS): number {
  const nominal = workingDays * dayHours
  return nominal > 0 ? Math.round((bookedHours / nominal) * 100) : 0
}

/** Hours a resource has booked in the week starting `weekStart` (UTC epoch, a Sunday). */
export function bookedHoursInWeek(resourceId: string, bookings: readonly ScheduleBooking[], weekStart: number): number {
  const weekEnd = weekStart + 7 * DAY_MS
  let hours = 0
  for (const b of bookings) {
    if (b.resourceId !== resourceId || b.start >= weekEnd || b.end <= weekStart) continue
    hours += (b.end - b.start) / 3_600_000
  }
  return Math.round(hours * 10) / 10
}

/** One person a move could go to instead. */
export interface RoomCandidate {
  resourceId: string
  name: string
  /** booked this week, whole percent */
  pct: number
  /** the person's warn level (default 100%) */
  warnPct: number
}

/** A person's week, from the Schedule's own rows. People only — work is not given to a room. */
export function roomCandidates(
  resources: readonly ScheduleResource[],
  bookings: readonly ScheduleBooking[],
  weekStart: number,
): RoomCandidate[] {
  return resources
    .filter((r) => r.kind === 'human' && r.userId != null)
    .map((r) => ({
      resourceId: r.id,
      name: r.name,
      pct: weekLoadPct(bookedHoursInWeek(r.id, bookings, weekStart), r.office?.workingDays?.length ?? 5),
      warnPct: r.warnAtPct ?? 100,
    }))
}

/** People under their warn level, emptiest first — who "has room". `excludeId` is the one dragged onto. */
export function withRoom(candidates: readonly RoomCandidate[], excludeId?: string | null): RoomCandidate[] {
  return candidates
    .filter((c) => c.resourceId !== excludeId && c.pct < c.warnPct)
    .sort((a, b) => a.pct - b.pct || a.name.localeCompare(b.name))
}

/** The Sunday (UTC) that starts the week an ISO day falls in — the grid's own week spine. */
export function weekStartOf(isoDate: string): number {
  const t = Date.parse(`${isoDate}T00:00:00Z`)
  return t - new Date(t).getUTCDay() * DAY_MS
}
