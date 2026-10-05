/**
 * Blocked time on a person's week (ADR-0142 d.4, I74.25, Figma L SC-22): a row of
 * `resource_unavailability`. LEAVE (and every other kind) blocks the whole day, as it always has.
 * INTERNAL WORK with hours ("Team training — 3.5h") does not: it is part of the day, counted in the
 * person's hours like a booking, so "8h free" reads "4.5h free" and a day with 6h booked goes over.
 *
 * Pure, so the grid's words, the booking window's free hours and the drop warning read one figure.
 * A display and a warning, never a gate (ADR-0061 d.2).
 */

export interface BlockedTime {
  /** epoch ms */
  start: number
  end: number
  kind: string
  /** internal work only: the hours it takes across its days; null for a full block */
  hours: number | null
}

const DAY_MS = 86_400_000

/** Does this row take the whole of every day it covers? Everything but internal work with hours. */
export function isFullBlock(b: Pick<BlockedTime, 'kind' | 'hours'>): boolean {
  return !(b.kind === 'internal' && b.hours != null && b.hours > 0)
}

/** Is the UTC day starting at `dayStart` blocked whole (leave, a closure-like block)? */
export function blocksWholeDay(blocks: readonly BlockedTime[], dayStart: number, dayEnd: number = dayStart + DAY_MS): boolean {
  return blocks.some((b) => isFullBlock(b) && b.start < dayEnd && b.end > dayStart)
}

/** The UTC day starts a block covers — the grid's columns are UTC midnights (DayGrid `buildColumns`). */
export function blockDayStarts(b: Pick<BlockedTime, 'start' | 'end'>): number[] {
  const first = Math.floor(b.start / DAY_MS) * DAY_MS
  const out: number[] = []
  for (let d = first; d < b.end && out.length < 366; d += DAY_MS) out.push(d)
  return out
}

/**
 * The internal-work hours that fall on one UTC day: each block's hours spread evenly over the days it
 * covers that are WORKING days (`isWorking`, the office calendar's own test) — or over all of its days
 * when none of them is. Leave contributes nothing here: it is a whole-day block, not hours.
 */
export function internalHoursOn(
  blocks: readonly BlockedTime[],
  dayStart: number,
  isWorking: (dayStart: number) => boolean = () => true,
): number {
  let sum = 0
  for (const b of blocks) {
    if (isFullBlock(b)) continue
    const days = blockDayStarts(b)
    if (!days.includes(dayStart)) continue
    const working = days.filter(isWorking)
    const over = working.length > 0 ? working : days
    if (!over.includes(dayStart)) continue
    sum += (b.hours ?? 0) / over.length
  }
  return Math.round(sum * 100) / 100
}
