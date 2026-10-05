import type { ScheduleResource } from '../api/schedule-api'

/**
 * How wide a chip should be, as a share of the cell — so a 2h booking is visibly a quarter of the
 * day and an 8h one fills it. Every chip used to be full width regardless of hours, which made a
 * half-hour holding slot look identical to a full day's work and hid overload until you read the
 * numbers.
 *
 * Only meaningful for LOAD-BASED resources (every human, by CHECK constraint): 100% load = a
 * standard day. An exclusive room or an equipment pool is not "half booked" — it is taken or it is
 * not — so those stay full width.
 *
 * Clamped at both ends: a floor so a 30-minute chip is still readable and clickable, and a ceiling
 * so a single over-long booking cannot overflow the column. Going over the day is signalled by the
 * cell's overload badge, which is a better place for it than a broken layout.
 */
const CHIP_MIN_PCT = 18

export function chipWidthPct(loadPct: number | null, model: ScheduleResource['capacityModel']): number {
  if (model !== 'load_based' || loadPct == null) return 100
  return Math.min(100, Math.max(CHIP_MIN_PCT, loadPct))
}
