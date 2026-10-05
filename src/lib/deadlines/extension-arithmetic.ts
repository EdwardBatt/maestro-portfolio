import { iraqDay } from '../time/iraq'

/**
 * The arithmetic an extension request is shown with (ADR-0088 d.7, in ADR-0075 d.9's shape).
 *
 * Not a decision — a warning that does the work a wall cannot, by being specific. "How many working
 * days does the new date leave before the deliverable's approval deadline, less its department's
 * review buffer?" — and therefore whether the deliverable is still **fine**, **tight** or **at
 * risk**. The approver may approve any of them; only a date after the campaign's go-live is refused,
 * because that is a typing mistake and not a tight deadline. The server refuses it too
 * (`sub_task_extension_request`); this only lets the screen say so before the round trip.
 *
 * PRESENTATION, NOT A RULE. The commitment, the deadline and the refusal all live in Postgres. This
 * classifies numbers the server already holds so a person reading a request can see what accepting
 * it costs — the same standing as `isOverdue` in `lib/campaigns/status.ts`.
 *
 * Days are Iraq days (ADR-0076): a deadline is 18:00 Asia/Baghdad, so the day of an instant is read
 * through `iraqDay`, never `slice(0, 10)`. Counting steps `YYYY-MM-DD` strings on UTC components,
 * as `lib/campaigns/go-live-dates.ts` does — no local `Date`, no DST anywhere near it.
 *
 * THE BUFFER IS A DEFAULT UNTIL `I41.10` BUILDS THE SCREEN. ADR-0075 d.5 measured it at one working
 * day for Creative and makes it a per-department admin setting; the setting does not exist yet, so
 * callers pass what they know and get one working day otherwise. Same for the working week: Iraq's
 * Sunday–Thursday by default, the office's own when the caller has it.
 */

export type ExtensionSeverity = 'fine' | 'tight' | 'at_risk' | 'after_go_live'

export interface ExtensionArithmeticInput {
  /** The day being asked for, `YYYY-MM-DD` in Iraq. */
  requestedDay: string
  /** The deliverable's approval deadline — an instant; null when none is promised. */
  deliverableDueAt: string | null
  /** The campaign's go-live — an instant; null when the client has not confirmed one. */
  goLiveAt: string | null
  /** Working days of review the department needs after the last task lands. Default 1 (ADR-0075 d.5). */
  reviewBufferWorkingDays?: number
  /** ISO weekdays (1 = Mon … 7 = Sun) that are working days. Default Iraq: Sun–Thu. */
  workingDays?: readonly number[]
  /** Office-local ISO dates the office is closed (ADR-0079) — a closed day is not a working day. */
  closures?: readonly string[]
}

export interface ExtensionArithmetic {
  severity: ExtensionSeverity
  /** Working days after the requested day up to and including the deliverable's due day; null with no due date. */
  workingDaysLeft: number | null
  /** The buffer the days were measured against. */
  bufferDays: number
  /** `workingDaysLeft − bufferDays`; null with no due date. Negative means the review will not fit. */
  slackDays: number | null
}

export const IRAQ_WORKING_DAYS: readonly number[] = [7, 1, 2, 3, 4]
export const DEFAULT_REVIEW_BUFFER_DAYS = 1

function utcMidnight(isoDay: string): number | null {
  const [y, m, d] = isoDay.split('-').map(Number)
  if (!y || !m || !d) return null
  return Date.UTC(y, m - 1, d)
}

/** ISO weekday of a `YYYY-MM-DD` (1 = Mon … 7 = Sun), from UTC components. */
function isoWeekdayOf(t: number): number {
  const js = new Date(t).getUTCDay() // 0 = Sun
  return js === 0 ? 7 : js
}

/**
 * Working days strictly after `fromDay` up to and including `toDay`. Zero when `toDay` is not after
 * `fromDay`; never negative — the sign of the shortfall is carried by `slackDays`, not here.
 */
export function workingDaysBetween(
  fromDay: string,
  toDay: string,
  workingDays: readonly number[] = IRAQ_WORKING_DAYS,
  closures: readonly string[] = [],
): number {
  const from = utcMidnight(fromDay)
  const to = utcMidnight(toDay)
  if (from == null || to == null || to <= from) return 0
  let n = 0
  for (let t = from + 86_400_000; t <= to; t += 86_400_000) {
    // ADR-0079 d.4: the same two-part test as `isWorkingDay` — the weekly pattern AND the closures.
    if (workingDays.includes(isoWeekdayOf(t)) && !closures.includes(new Date(t).toISOString().slice(0, 10))) n += 1
  }
  return n
}

export function classifyExtension(input: ExtensionArithmeticInput): ExtensionArithmetic {
  const bufferDays = input.reviewBufferWorkingDays ?? DEFAULT_REVIEW_BUFFER_DAYS
  const workingDays = input.workingDays ?? IRAQ_WORKING_DAYS
  const closures = input.closures ?? []

  if (input.goLiveAt && input.requestedDay > iraqDay(input.goLiveAt)) {
    return { severity: 'after_go_live', workingDaysLeft: null, bufferDays, slackDays: null }
  }
  if (!input.deliverableDueAt) {
    return { severity: 'fine', workingDaysLeft: null, bufferDays, slackDays: null }
  }

  const dueDay = iraqDay(input.deliverableDueAt)
  // A request past the deliverable's own deadline leaves no days at all — and the shortfall is
  // real, so it is counted (negatively) rather than clamped: the reader should see "two days
  // past", not "zero left".
  const left = input.requestedDay >= dueDay
    ? 0 - workingDaysBetween(dueDay, input.requestedDay, workingDays, closures) // `0 -`, not unary minus: no -0
    : workingDaysBetween(input.requestedDay, dueDay, workingDays, closures)
  const slack = left - bufferDays
  const severity: ExtensionSeverity = slack > 0 ? 'fine' : slack === 0 ? 'tight' : 'at_risk'
  return { severity, workingDaysLeft: left, bufferDays, slackDays: slack }
}
