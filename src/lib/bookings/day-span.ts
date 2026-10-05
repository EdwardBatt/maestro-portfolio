import type { Span } from '../capacity/types.ts'

// Canonical day-booking convention (ADR-0006), shared by the schedule grid and the
// subtask-schedule Edge Function. features/schedule/lib/day-span.ts re-exports this.
export const DAY_START_HOUR = 9 // office-local booking anchor (config later)

/** date (YYYY-MM-DD) + hours → concrete span anchored 09:00 in the office zone */
export function daySpan(isoDate: string, hours: number, timezone: string): Span {
  // epoch of 09:00 office-local on isoDate: start from UTC noon (safe within
  // ±12h of any zone) and correct by the zone's rendered hour
  const utcNoon = Date.parse(`${isoDate}T12:00:00Z`)
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hourCycle: 'h23' })
  const localHourAtNoon = Number(fmt.format(utcNoon))
  const start = utcNoon - (localHourAtNoon - DAY_START_HOUR) * 3600_000
  return { start, end: start + hours * 3600_000 }
}
