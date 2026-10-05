import type { OfficeCalendar, Span } from './types.ts'

/**
 * Working-week helpers (ADR-0005). All day-level reasoning happens in the
 * OFFICE's IANA timezone — never the viewer's. Implementation uses Intl only
 * (no date library): correctness across DST (Cairo observes DST; Baghdad and
 * Dubai do not) comes from asking Intl for the office-local date/weekday of
 * concrete instants rather than doing calendar arithmetic ourselves.
 */

const WEEKDAY_TO_ISO: Record<string, number> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
}

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function formatter(timezone: string): Intl.DateTimeFormat {
  let f = fmtCache.get(timezone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    fmtCache.set(timezone, f)
  }
  return f
}

export interface LocalDay {
  /** office-local ISO date, e.g. 2026-07-31 */
  isoDate: string
  /** ISO weekday 1=Mon … 7=Sun */
  isoWeekday: number
}

/** Office-local date + weekday of an instant. */
export function localDayOf(epochMs: number, timezone: string): LocalDay {
  const parts = formatter(timezone).formatToParts(epochMs)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return {
    isoDate: `${get('year')}-${get('month')}-${get('day')}`,
    isoWeekday: WEEKDAY_TO_ISO[get('weekday')] ?? 0,
  }
}

/**
 * THE one test for "does the office work that day" (ADR-0079 d.4). A day is non-working if the
 * weekly pattern excludes it OR the office is closed on that date. Every caller goes through here;
 * a second copy of this rule is the three-places-disagreeing failure ADR-0078 was written about.
 */
export function isWorkingDay(day: LocalDay, office: OfficeCalendar): boolean {
  return office.workingDays.includes(day.isoWeekday) && !office.closures?.includes(day.isoDate)
}

export function isWorkingInstant(epochMs: number, office: OfficeCalendar): boolean {
  return isWorkingDay(localDayOf(epochMs, office.timezone), office)
}

/**
 * Distinct office-local days touched by a span (end exclusive).
 * Steps in 6-hour increments and dedupes — immune to 23/25-hour DST days.
 */
export function localDaysInSpan(span: Span, timezone: string): LocalDay[] {
  const out = new Map<string, LocalDay>()
  const STEP = 6 * 3600_000
  for (let t = span.start; t < span.end; t += STEP) {
    const d = localDayOf(t, timezone)
    out.set(d.isoDate, d)
  }
  // ensure the final instant's day is captured (span shorter than STEP, or tail)
  const last = localDayOf(span.end - 1, timezone)
  out.set(last.isoDate, last)
  return [...out.values()]
}

/** Office-local ISO dates within the span that fall outside the working week. */
export function nonWorkingDaysInSpan(span: Span, office: OfficeCalendar): string[] {
  return localDaysInSpan(span, office.timezone)
    .filter((d) => !isWorkingDay(d, office))
    .map((d) => d.isoDate)
}
