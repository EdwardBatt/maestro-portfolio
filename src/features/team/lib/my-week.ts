/**
 * "Your week" on My Work (I59.10, ADR-0105 d.1): the signed-in person's booked hours on each day of
 * the current week (Sunday → Saturday, the same window `currentWeek` gives `useMyLoad`).
 *
 * Only the per-day split lives here. The week's total and its percent are `useMyLoad`'s, which reads
 * `weekLoadPct` from `schedule/lib/week-load` — the one calculation the Team page and the move
 * warnings also use — so "Your week · 36h · 90%" and the team timeline cannot disagree. A display
 * figure, never a gate (ADR-0061 d.2). Pure; no imports.
 */

export interface MyDay {
  /** YYYY-MM-DD, the viewer's local day. */
  date: string
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number
  hours: number
  /** The office works that weekday (ISO 1 = Mon … 7 = Sun, ADR-0005). */
  working: boolean
}

const pad = (n: number) => String(n).padStart(2, '0')
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Seven days from `weekStart` (a local Sunday), each with the hours of the bookings starting on it. */
export function hoursByDay(
  rows: readonly { startsAt: string; hours: number }[],
  weekStart: Date,
  workingDays: readonly number[] = [7, 1, 2, 3, 4],
): MyDay[] {
  const days: MyDay[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i)
    const iso = d.getDay() === 0 ? 7 : d.getDay()
    days.push({ date: localDay(d), weekday: d.getDay(), hours: 0, working: workingDays.includes(iso) })
  }
  const byDate = new Map(days.map((d) => [d.date, d]))
  for (const r of rows) {
    const at = new Date(r.startsAt)
    if (Number.isNaN(at.getTime())) continue
    const day = byDate.get(localDay(at))
    if (day) day.hours = Math.round((day.hours + r.hours) * 10) / 10
  }
  return days
}
