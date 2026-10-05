import type { OfficeCalendar } from './types.ts'

/**
 * Office closures as the ONE seam reads them (ADR-0079 d.4).
 *
 * `office_closures` stores a closure as a DATE span — whole days in the office's own calendar,
 * never a moment (traps.md, "a deadline is a DAY stored as a MOMENT"). `OfficeCalendar.closures`
 * wants the individual dates, because `isWorkingDay` asks about one day at a time. This is the
 * expansion, and it is pure string arithmetic on `YYYY-MM-DD` — no `Date` in any timezone, so it
 * cannot drift across DST or the viewer's clock.
 *
 * Used by the schedule read, both dialogs, and the two Edge Functions that place work, so an
 * `offices(…)` embed can be turned into a calendar in one line: `officeCalendarFromRow(row)`.
 */

/** The `office_closures(starts_on, ends_on)` embed as PostgREST returns it. */
export interface ClosureSpanRow {
  starts_on: string
  ends_on: string
}

/** The `offices(timezone, working_days, office_closures(starts_on, ends_on))` embed. */
export interface OfficeRowWithClosures {
  timezone: string
  working_days: number[]
  office_closures?: ClosureSpanRow[] | null
}

/**
 * The select fragment every office embed carries. Written out LITERALLY at each site rather than
 * interpolated — `src/test/postgrest-selects.test.ts` reads select strings statically and a computed
 * one is a site it cannot check. This constant is the reference the sites are kept in step with.
 */
export const OFFICE_CALENDAR_SELECT = 'timezone, working_days, office_closures(starts_on, ends_on)'

const MAX_CLOSURE_DAYS = 366

function nextIsoDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + 86_400_000).toISOString().slice(0, 10)
}

/** Every date inside the given spans, inclusive both ends, de-duplicated and sorted. */
export function expandClosureDates(rows: readonly ClosureSpanRow[] | null | undefined): string[] {
  const out = new Set<string>()
  for (const row of rows ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.starts_on) || !/^\d{4}-\d{2}-\d{2}$/.test(row.ends_on)) continue
    let day = row.starts_on
    for (let i = 0; i < MAX_CLOSURE_DAYS && day <= row.ends_on; i++) {
      out.add(day)
      day = nextIsoDay(day)
    }
  }
  return [...out].sort()
}

/** An `OfficeCalendar` from an office embed, closures included. */
export function officeCalendarFromRow(row: OfficeRowWithClosures): OfficeCalendar {
  return {
    timezone: row.timezone,
    workingDays: row.working_days ?? [],
    closures: expandClosureDates(row.office_closures),
  }
}
