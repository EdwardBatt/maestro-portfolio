import type { Span } from '../capacity/types.ts'
import { isWorkingDay, localDayOf } from '../capacity/working-week.ts'

/**
 * Weekly recurrence expansion (M4.3 — series vs instance, §9.1).
 * Wall-time preserving: a Monday 10:00 Cairo booking stays 10:00 Cairo across
 * DST transitions, so instance N after a clock change shifts its UTC instant
 * by the offset delta. Pure Intl, no date library.
 */

const utcFieldsCache = new Map<string, Intl.DateTimeFormat>()
function fieldsFormatter(timezone: string): Intl.DateTimeFormat {
  let f = utcFieldsCache.get(timezone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    })
    utcFieldsCache.set(timezone, f)
  }
  return f
}

/** Offset (ms) of `timezone` from UTC at the given instant. */
export function tzOffsetMs(epochMs: number, timezone: string): number {
  const parts = fieldsFormatter(timezone).formatToParts(epochMs)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0')
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - Math.floor(epochMs / 1000) * 1000
}

/** Add `days` calendar days preserving office-local wall time. */
export function addDaysWallTime(epochMs: number, days: number, timezone: string): number {
  const naive = epochMs + days * 86_400_000
  const drift = tzOffsetMs(epochMs, timezone) - tzOffsetMs(naive, timezone)
  return naive + drift
}

export interface SeriesInput {
  first: Span
  /** total occurrences including the first (DB check: 2..52) */
  repeatCount: number
  /** calendar days between occurrence starts (7×intervalWeeks for weekly, 1 for daily) */
  stepDays: number
  /** office IANA zone — wall time is preserved in THIS zone (ADR-0005 spirit) */
  timezone: string
  /**
   * ISO weekdays the office works (ADR-0005). When given, an occurrence that would land on a
   * non-working day steps forward to the next working one — the count of occurrences is what the
   * assigner asked for, and a day off never consumes one of them. Omit for weekly series, where
   * stepping would break the "same weekday every week" contract that is the point of them.
   */
  workingDays?: number[]
  /** Office-local ISO dates the office is closed (ADR-0079). A repeat steps over these too. */
  closures?: readonly string[]
}

/**
 * Expand a series into concrete instance spans (first included), wall-time preserving.
 *
 * The FIRST occurrence is never moved, even onto a non-working day: somebody picked that date and
 * the surface warned them (ADR-0061 d.2, "nothing blocks"). Only the repeats step over.
 */
export function expandSeries(input: SeriesInput): Span[] {
  const duration = input.first.end - input.first.start
  const out: Span[] = []

  // No office calendar: the original absolute stepping, offset from the first occurrence rather
  // than accumulated, which is the more DST-robust of the two. Weekly always takes this path.
  if (!input.workingDays?.length) {
    for (let i = 0; i < input.repeatCount; i++) {
      const start = addDaysWallTime(input.first.start, i * input.stepDays, input.timezone)
      out.push({ start, end: start + duration })
    }
    return out
  }

  // Working-day stepping has to accumulate: how far the next occurrence jumps depends on where the
  // previous one landed, so it cannot be expressed as an offset from the first.
  let cursor = input.first.start
  out.push({ start: cursor, end: cursor + duration })
  for (let i = 1; i < input.repeatCount; i++) {
    cursor = addDaysWallTime(cursor, input.stepDays, input.timezone)
    // A whole week of days off would be a misconfigured office, not a reason to loop forever.
    for (let guard = 0; guard < 14; guard++) {
      if (isWorkingDay(localDayOf(cursor, input.timezone), { timezone: input.timezone, workingDays: input.workingDays, closures: input.closures })) break
      cursor = addDaysWallTime(cursor, 1, input.timezone)
    }
    out.push({ start: cursor, end: cursor + duration })
  }
  return out
}

export interface WeeklySeriesInput {
  first: Span
  repeatCount: number
  intervalWeeks: number
  timezone: string
}

/** Weekly convenience wrapper over expandSeries. */
export function expandWeekly(input: WeeklySeriesInput): Span[] {
  return expandSeries({ ...input, stepDays: 7 * input.intervalWeeks })
}

/**
 * Daily convenience wrapper (ADR-0006 multi-day bookings). Pass the office's `workingDays` and a
 * repeat lands on the next working day rather than a day off: "Thursday, 2 days" is Thursday and
 * Sunday, not 16 hours on Thursday (I41.2).
 */
export function expandDaily(
  input: Omit<WeeklySeriesInput, 'intervalWeeks'> & { workingDays?: number[]; closures?: readonly string[] },
): Span[] {
  return expandSeries({ ...input, stepDays: 1 })
}
