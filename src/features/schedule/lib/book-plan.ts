import type { ScheduleBooking, ScheduleResource } from '../api/schedule-api'
import { hoursToLoadPct } from '../../../lib/capacity/day-hours.ts'
import { dayLoad } from './day-load.ts'

/**
 * "Book the tasks" — the piece's unbooked tasks as rows, each with its own hours, person, days and
 * what it waits for (I74.22, Figma L SC-03…SC-17, SC-03b/c).
 *
 * Nothing here writes. It plans: which rows are ready, what the footer says, and what is worth a
 * second look. Every finding is a WARNING — the button still books (ADR-0061 d.2, "the UI never
 * blocks"). The over-a-day check is `dayLoad`, the grid's own calculation, with the planned hours
 * added as confirmed bookings.
 */

export interface PlanRow {
  /** the task id, or `new:<n>` for a task added in this window */
  key: string
  subTaskId: string | null
  title: string
  /** total planned hours for the task */
  hours: number
  resourceId: string | null
  /** first and last ISO day picked; null until picked */
  from: string | null
  to: string | null
  /** keys of rows (or ids of other tasks of the piece) this one waits for — several allowed */
  waitsFor: string[]
  workflowStepId?: string | null
}

export const isNewRow = (r: Pick<PlanRow, 'subTaskId'>) => r.subTaskId == null

/** A row the button books: a person and days. */
export const isReady = (r: PlanRow) => r.resourceId != null && r.from != null && r.to != null && r.hours > 0

const DAY = 86_400_000
export const isoPlus = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10)

/**
 * The days a task will be worked on: the person's working days from `from` to `to`. The FIRST day is
 * kept even when it is a day off (ADR-0061 d.2 — a deliberately picked day is booked and warned about).
 */
export function workDays(from: string, to: string, isWorking: (iso: string) => boolean): string[] {
  const out: string[] = []
  for (let d = from; d <= to && out.length < 62; d = isoPlus(d, 1)) if (d === from || isWorking(d)) out.push(d)
  return out
}

/** Hours a day, spread evenly over the days worked — what the booking writes per day. */
export function hoursPerDay(hours: number, days: number): number {
  return days > 0 ? Math.round((hours / days) * 10) / 10 : hours
}

/** SC-03b/c — "Give them to Zubaida on Thu 1 Oct": every ticked row gets the person and that one day. */
export function applyBulk(rows: readonly PlanRow[], keys: ReadonlySet<string>, resourceId: string | null, isoDate: string | null): PlanRow[] {
  return rows.map((r) =>
    keys.has(r.key)
      ? { ...r, resourceId: resourceId ?? r.resourceId, from: isoDate ?? r.from, to: isoDate ?? r.to }
      : r,
  )
}

export type RowWarning =
  | { kind: 'over'; resourceId: string; isoDate: string; totalHours: number; overHours: number }
  | { kind: 'order'; startsOn: string; prerequisite: string; prerequisiteEndsOn: string; suggestOn: string }
  | { kind: 'late'; endsOn: string; dueOn: string }
  | { kind: 'leave'; resourceId: string; isoDate: string }
  | { kind: 'off'; resourceId: string; isoDate: string }

/** Several rows of this window landing on one person's one day, together past a full day (SC-03c). */
export interface CombinedOver { resourceId: string; isoDate: string; totalHours: number; overHours: number; rowKeys: string[] }

export interface PlanContext {
  resources: ReadonlyMap<string, ScheduleResource>
  /** confirmed and pending bookings the person ALREADY has on that day */
  bookingsOn: (resourceId: string, isoDate: string) => ScheduleBooking[]
  isWorking: (resourceId: string, isoDate: string) => boolean
  onLeave: (resourceId: string, isoDate: string) => boolean
  /** the piece's due day, or null */
  dueOn: string | null
  /** other tasks of the piece, by id: their title and the day they end (already booked work) */
  others: ReadonlyMap<string, { title: string; endsOn: string | null }>
}

export interface PlanCheck {
  rows: Map<string, RowWarning[]>
  combined: CombinedOver[]
  /** findings in all — "3 things to check" */
  count: number
}

/** The last day a row is worked — its `to`, pulled back to a working day. */
function lastDay(r: PlanRow, ctx: PlanContext): string | null {
  if (!r.from || !r.to || !r.resourceId) return r.to
  const days = workDays(r.from, r.to, (d) => ctx.isWorking(r.resourceId!, d))
  return days[days.length - 1] ?? r.to
}

export function checkPlan(rows: readonly PlanRow[], ctx: PlanContext): PlanCheck {
  const out = new Map<string, RowWarning[]>()
  const add = (key: string, w: RowWarning) => out.set(key, [...(out.get(key) ?? []), w])
  const combined: CombinedOver[] = []

  // 1 — over a day: what the person already has plus every planned row on that day, through `dayLoad`.
  const perDay = new Map<string, { resourceId: string; isoDate: string; rows: { key: string; hours: number }[] }>()
  for (const r of rows) {
    if (!isReady(r)) continue
    const days = workDays(r.from!, r.to!, (d) => ctx.isWorking(r.resourceId!, d))
    const h = hoursPerDay(r.hours, days.length)
    for (const d of days) {
      const k = `${r.resourceId}|${d}`
      const e = perDay.get(k) ?? { resourceId: r.resourceId!, isoDate: d, rows: [] }
      e.rows.push({ key: r.key, hours: h })
      perDay.set(k, e)
    }
  }
  for (const e of perDay.values()) {
    const res = ctx.resources.get(e.resourceId)
    if (!res) continue
    const planned = e.rows.map((x) => ({ state: 'confirmed' as const, loadPct: hoursToLoadPct(x.hours) }))
    const load = dayLoad(res, [...ctx.bookingsOn(e.resourceId, e.isoDate), ...planned])
    if (load.state !== 'over') continue
    if (e.rows.length === 1) {
      add(e.rows[0]!.key, { kind: 'over', resourceId: e.resourceId, isoDate: e.isoDate, totalHours: load.bookedHours, overHours: load.overHours })
    } else {
      combined.push({ resourceId: e.resourceId, isoDate: e.isoDate, totalHours: load.bookedHours, overHours: load.overHours, rowKeys: e.rows.map((x) => x.key) })
    }
  }

  const byKey = new Map(rows.map((r) => [r.key, r]))
  for (const r of rows) {
    if (!isReady(r)) continue
    const rid = r.resourceId!
    // 2 — a day off or leave on the days picked.
    if (!ctx.isWorking(rid, r.from!)) add(r.key, { kind: 'off', resourceId: rid, isoDate: r.from! })
    const leaveDay = workDays(r.from!, r.to!, (d) => ctx.isWorking(rid, d)).find((d) => ctx.onLeave(rid, d))
    if (leaveDay) add(r.key, { kind: 'leave', resourceId: rid, isoDate: leaveDay })
    // 3 — starts before something it waits for has ended.
    for (const w of r.waitsFor) {
      const pre = byKey.get(w)
      const title = pre?.title ?? ctx.others.get(w)?.title ?? ''
      const ends = pre ? lastDay(pre, ctx) : (ctx.others.get(w)?.endsOn ?? null)
      if (!ends || (pre && !isReady(pre))) continue
      if (r.from! <= ends) {
        let next = isoPlus(ends, 1)
        for (let i = 0; i < 14 && !ctx.isWorking(rid, next); i += 1) next = isoPlus(next, 1)
        add(r.key, { kind: 'order', startsOn: r.from!, prerequisite: title, prerequisiteEndsOn: ends, suggestOn: next })
        break
      }
    }
    // 4 — ends after the piece is due.
    const end = lastDay(r, ctx)
    if (ctx.dueOn && end && end > ctx.dueOn) add(r.key, { kind: 'late', endsOn: end, dueOn: ctx.dueOn })
  }

  let count = combined.length
  for (const list of out.values()) count += list.length
  return { rows: out, combined, count }
}

export interface PlanSummary {
  /** hours on rows that have a person */
  plannedHours: number
  withPerson: number
  total: number
  /** rows the button books */
  ready: number
  /** the last day any ready row ends, or null */
  lastDay: string | null
  /** ready rows per person, most first */
  byPerson: { resourceId: string; count: number }[]
}

export function planSummary(rows: readonly PlanRow[], isWorking: (resourceId: string, iso: string) => boolean): PlanSummary {
  let plannedHours = 0
  let withPerson = 0
  let ready = 0
  let last: string | null = null
  const per = new Map<string, number>()
  for (const r of rows) {
    if (r.resourceId) { withPerson += 1; plannedHours += r.hours }
    if (!isReady(r)) continue
    ready += 1
    per.set(r.resourceId!, (per.get(r.resourceId!) ?? 0) + 1)
    const days = workDays(r.from!, r.to!, (d) => isWorking(r.resourceId!, d))
    const end = days[days.length - 1] ?? r.to!
    if (!last || end > last) last = end
  }
  return {
    plannedHours: Math.round(plannedHours * 10) / 10,
    withPerson,
    total: rows.length,
    ready,
    lastDay: last,
    byPerson: [...per].map(([resourceId, count]) => ({ resourceId, count })).sort((a, b) => b.count - a.count),
  }
}

/** Working days between the end and the due day, for "done Wed 30, a day before it's due". Negative = late. */
export function daysBeforeDue(lastDayIso: string, dueIso: string): number {
  return Math.round((Date.parse(`${dueIso}T00:00:00Z`) - Date.parse(`${lastDayIso}T00:00:00Z`)) / DAY)
}

/** A new task's name: at least three letters, and not a bare code (SC-12). */
export function isAcceptableTaskName(name: string): boolean {
  const letters = (name.match(/\p{L}/gu) ?? []).length
  return letters >= 3
}

/**
 * What the Book button will actually do (test script, 4 Oct): a row the person may book books; a row picked as an ask,
 * AND a ready row whose person is outside the booker's reach (the server turns it into an ask — an account manager's
 * every pick, ADR-0139 d.1), sends an ask. The label counts them so: for her "Send 2 asks", never "Book 1 task".
 */
export function bookButtonCounts(
  rows: readonly PlanRow[],
  isAsk: (r: PlanRow) => boolean,
  outsideReach: (resourceId: string) => boolean,
): { book: number; ask: number } {
  let book = 0
  let ask = 0
  for (const r of rows) {
    if (isAsk(r)) ask += 1
    else if (isReady(r)) {
      if (outsideReach(r.resourceId!)) ask += 1
      else book += 1
    }
  }
  return { book, ask }
}
