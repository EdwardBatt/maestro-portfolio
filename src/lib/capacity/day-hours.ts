/**
 * ADR-0006: hours are the booking vocabulary; load % is derived, never asked.
 * Standard day is a constant for v1 — becomes a per-office setting later
 * without changing callers (they already go through this function).
 */
export const STANDARD_DAY_HOURS = 8

export function hoursToLoadPct(hoursPerDay: number, dayHours: number = STANDARD_DAY_HOURS): number {
  return Math.round((hoursPerDay / dayHours) * 1000) / 10
}

export function loadPctToHours(loadPct: number, dayHours: number = STANDARD_DAY_HOURS): number {
  return Math.round((loadPct / 100) * dayHours * 10) / 10
}
