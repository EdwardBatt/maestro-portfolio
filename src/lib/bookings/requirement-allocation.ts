import type { DailyAllocation } from './subtask-spread.ts'
import type { OfficeCalendar } from '../capacity/types.ts'
import { hoursToLoadPct, STANDARD_DAY_HOURS } from '../capacity/day-hours.ts'
import { isWorkingDay, localDayOf } from '../capacity/working-week.ts'

/**
 * ADR-0042 d.3 (amended 26 Aug): how a REQUIRED resource's hours land on the calendar.
 *
 * A requirement is `hours` — the total the asset is needed for — plus an optional `starts_on`. It is
 * deliberately NOT the task's span: a camera needed for three hours of a five-day shoot occupies
 * three hours, and booking it for the whole span would make the schedule lie about availability.
 *
 * Hours, not days, because that is the booking vocabulary everywhere else on this project
 * (ADR-0006: "hours are the booking vocabulary; load % is derived, never asked"). This mirrors
 * `sub_tasks.sla_hours`, which is a total spread across working days by `spreadHours`.
 *
 * The difference from `spreadHours` is the shape of the question. A sub-task has a start AND a due
 * date and spreads its hours EVENLY between them, because the work fills the time it was given. A
 * requirement has a start and no end: the asset is wanted for as long as it is wanted, so hours FILL
 * consecutive working days — up to a standard day each — and stop. 3h is one short booking; 16h is
 * two full days; 20h is 8 + 8 + 4.
 *
 * Working days come from the RESOURCE's own office (ADR-0005). An office that does not work Friday
 * does not lend its camera on Friday, and the three offices differ.
 */

/** Midday UTC of an ISO date — a probe instant far enough from either edge to survive any tz shift. */
function noonUtcOf(isoDate: string): number {
  return Date.parse(`${isoDate}T12:00:00Z`)
}

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * Lay `hours` out from `startIsoDate` across the office's working days.
 *
 * `startIsoDate` is a floor, not a guarantee: a start on a non-working day rolls forward to the next
 * working one rather than failing.
 *
 * Returns fewer hours than asked only if the search runs past `maxLookaheadDays` — an office that
 * works no days at all would otherwise loop forever. **A caller must treat a short result as "could
 * not place the whole requirement" and say so**, because silently booking less than was asked for is
 * the schedule lying by a different route.
 */
export function requirementAllocations(
  startIsoDate: string,
  hours: number,
  office: OfficeCalendar,
  dayHours: number = STANDARD_DAY_HOURS,
  maxLookaheadDays = 365,
): DailyAllocation[] {
  if (!(hours > 0) || !(dayHours > 0)) return []

  let probe = noonUtcOf(startIsoDate)
  if (Number.isNaN(probe)) return []

  const out: DailyAllocation[] = []
  let remaining = hours

  for (let step = 0; step < maxLookaheadDays && remaining > 0; step++) {
    const local = localDayOf(probe, office.timezone)
    probe += 86_400_000
    if (!isWorkingDay(local, office)) continue

    const todays = round1(Math.min(remaining, dayHours))
    out.push({
      isoDate: local.isoDate,
      isoWeekday: local.isoWeekday,
      hours: todays,
      loadPct: hoursToLoadPct(todays, dayHours),
    })
    remaining = round1(remaining - todays)
  }
  return out
}

/** Total hours actually placed — compare with what was asked to detect a short placement. */
export function allocatedHours(allocations: DailyAllocation[]): number {
  return round1(allocations.reduce((sum, a) => sum + a.hours, 0))
}
