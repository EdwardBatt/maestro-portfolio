/**
 * Working a campaign's dates back from its go-live (Edward, 29 Aug; ADR-0075 d.5; ADR-0078).
 *
 * *"Delivery 2 days before go live, commence by 4 days before delivery."* — and, since ADR-0078,
 * **a day is a WORKING day.** A Sunday go-live in Baghdad used to give a Friday delivery date: a
 * deadline on a day nobody works, with commence-by inheriting the same error (`I41.9`). The
 * offsets now step back over the office's days off AND its closures, through the same
 * `isWorkingDay` test everything else uses (ADR-0079 d.4). No second definition of a working day
 * lives here.
 *
 * **The two numbers are SETTINGS** (`I41.10`, ADR-0075 d.5): `tenant_reminder_settings` carries
 * them per tenant and the Admin → Organization screen edits them. `DEFAULT_GO_LIVE_RULE` is what a
 * tenant that never opened that screen gets, and it is the measured 2 and 4.
 *
 * **This is still a placeholder rule and it is stated as one.** The columns built to do this
 * properly — `deliverable_types.lead_time_hours` and `workflow_steps.default_hours` — exist and are
 * entirely empty, so a TVC and a social post get the same six working days. When those columns are
 * filled, THIS FILE is what changes; nothing that calls it needs to.
 *
 * Dates are `YYYY-MM-DD` throughout, matching `<input type="date">`. The arithmetic is done on UTC
 * components rather than through a local `Date`, because constructing a local date from an ISO
 * string and subtracting days shifts across a DST boundary — the class of bug `AGENTS.md` §5 asks
 * for tests on, and the class that put a booking on the wrong day in `I17`.
 */

import { isWorkingDay } from '../capacity/working-week.ts'

/** The weekly pattern and the closures — everything `isWorkingDay` needs, minus the timezone. */
export interface WorkingCalendar {
  /** ISO weekday numbers 1=Mon … 7=Sun (ADR-0005). */
  workingDays: readonly number[]
  /** Office-local ISO dates the office is closed (ADR-0079). */
  closures?: readonly string[]
}

/** Iraq's Sunday–Thursday: the fallback when no office calendar is in hand. */
export const IRAQ_WORKING_CALENDAR: WorkingCalendar = { workingDays: [7, 1, 2, 3, 4] }

export interface GoLiveRule {
  /** Go-live minus this many WORKING days is the delivery (approval) date. */
  deliveryDaysBeforeGoLive: number
  /** Delivery minus this many WORKING days is when work must start. */
  commenceDaysBeforeDelivery: number
}

/** Edward, 29 Aug — the measured defaults, until the tenant edits them (I41.10). */
export const DEFAULT_GO_LIVE_RULE: GoLiveRule = {
  deliveryDaysBeforeGoLive: 2,
  commenceDaysBeforeDelivery: 4,
}

/** @deprecated use `DEFAULT_GO_LIVE_RULE.deliveryDaysBeforeGoLive`; kept so nothing that read the constant breaks. */
export const DELIVERY_DAYS_BEFORE_GO_LIVE = DEFAULT_GO_LIVE_RULE.deliveryDaysBeforeGoLive
/** @deprecated use `DEFAULT_GO_LIVE_RULE.commenceDaysBeforeDelivery`. */
export const COMMENCE_DAYS_BEFORE_DELIVERY = DEFAULT_GO_LIVE_RULE.commenceDaysBeforeDelivery

export interface DerivedDates {
  commenceAt: string
  dueAt: string
}

function utcMidnight(isoDate: string): number | null {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) return null
  return Date.UTC(y, m - 1, d)
}

function isoOf(t: number): string {
  return new Date(t).toISOString().slice(0, 10)
}

/** ISO weekday (1 = Mon … 7 = Sun) of a UTC-midnight epoch. */
function isoWeekdayOf(t: number): number {
  const js = new Date(t).getUTCDay()
  return js === 0 ? 7 : js
}

function isWorking(t: number, calendar: WorkingCalendar): boolean {
  return isWorkingDay(
    { isoDate: isoOf(t), isoWeekday: isoWeekdayOf(t) },
    { timezone: 'UTC', workingDays: [...calendar.workingDays], closures: calendar.closures },
  )
}

/** `YYYY-MM-DD` minus n CALENDAR days, no timezone anywhere near it. */
export function minusDays(isoDate: string, days: number): string {
  const t = utcMidnight(isoDate)
  if (t == null) return isoDate
  return isoOf(t - days * 86_400_000)
}

/**
 * `YYYY-MM-DD` minus n WORKING days (ADR-0078 d.1). Each step lands on the previous day the office
 * works; a day off or a closure never consumes a step. "Sunday minus 2" in Baghdad is Wednesday —
 * Thursday is one working day before, Wednesday two — and never the Friday nobody works.
 *
 * An office whose calendar works no day at all is misconfigured, not a reason to loop forever: the
 * search gives up after a year and returns the calendar-day answer.
 */
export function minusWorkingDays(isoDate: string, days: number, calendar: WorkingCalendar): string {
  const start = utcMidnight(isoDate)
  if (start == null) return isoDate
  if (!(days > 0)) return isoDate
  if (calendar.workingDays.length === 0) return minusDays(isoDate, days)
  let t = start
  let stepped = 0
  for (let guard = 0; guard < 366 && stepped < days; guard++) {
    t -= 86_400_000
    if (isWorking(t, calendar)) stepped += 1
  }
  return stepped === days ? isoOf(t) : minusDays(isoDate, days)
}

/**
 * The day work STARTS: `days` working days back from the day it is due, COUNTING THE DUE DAY.
 *
 * Edward, 24 Sep (`I56.11`): *"it needs four days"* means four days of WORK ending on the day it
 * is due — 4 days due Wed 30 Sep starts Sun 27 Sep (27, 28, 29, 30), which is what Figma
 * `CB-v3-04` prints on all four of its rows. A piece that needs one day starts on the day it is
 * due; a piece that needs none starts then too.
 *
 * THIS IS THE ONLY COUNT-BACK THAT MEANS "HOW LONG THIS TAKES", and it lives here, beside
 * `minusWorkingDays`, because there was briefly a second copy of it in `lib/timing/plan-back.ts`
 * counting inclusively while `datesFromGoLive` counted exclusively — the same piece started on
 * two different days depending on which screen asked. `plan-back.ts` re-exports this one.
 *
 * `minusWorkingDays` keeps its own, EXCLUSIVE meaning: it is a GAP between two events ("delivery
 * 2 working days before go-live"), not a duration, and the two must never be confused.
 */
export function startFromDue(
  dueOn: string,
  days: number,
  calendar: WorkingCalendar = IRAQ_WORKING_CALENDAR,
): string {
  if (!(days > 1)) return dueOn
  return minusWorkingDays(dueOn, days - 1, calendar)
}

/**
 * The two dates a go-live implies, or null when there is no go-live.
 *
 * Null is the ordinary case, not a failure: Edward — *"quite often the client does not want to
 * confirm go live"* — so a campaign without one is planned by hand and nothing is derived.
 */
export function datesFromGoLive(
  goLiveAt: string | null | undefined,
  calendar: WorkingCalendar = IRAQ_WORKING_CALENDAR,
  rule: GoLiveRule = DEFAULT_GO_LIVE_RULE,
): DerivedDates | null {
  if (!goLiveAt) return null
  // The delivery offset is a GAP — go-live minus 2 working days — so it steps back exclusively.
  // The commence offset is a DURATION — the working days of work — so it counts the due day
  // itself (Edward, 24 Sep, `I56.11`), which is why one uses `minusWorkingDays` and the other
  // `startFromDue`. Only NEW count-backs take the new rule: `applyGoLiveDates` below still fills
  // blanks only, so no date already stored on a row is recalculated.
  const dueAt = minusWorkingDays(goLiveAt, rule.deliveryDaysBeforeGoLive, calendar)
  return { dueAt, commenceAt: startFromDue(dueAt, rule.commenceDaysBeforeDelivery, calendar) }
}

/**
 * Apply those dates to rows that have none, and report what was left alone.
 *
 * **Blanks only.** A date somebody typed is a commitment they made; overwriting it because the
 * go-live moved is the silent-reschedule failure `I17` was raised for and ADR-0052 d.14 refuses by
 * name. Changing the go-live therefore fills what is still empty and says how many it did not
 * touch, rather than quietly re-planning the campaign.
 */
export function applyGoLiveDates<T extends { commenceAt: string | null; dueAt: string | null }>(
  rows: readonly T[],
  goLiveAt: string | null | undefined,
  calendar: WorkingCalendar = IRAQ_WORKING_CALENDAR,
  rule: GoLiveRule = DEFAULT_GO_LIVE_RULE,
): { rows: T[]; filled: number; kept: number } {
  const dates = datesFromGoLive(goLiveAt, calendar, rule)
  if (!dates) return { rows: [...rows], filled: 0, kept: 0 }

  let filled = 0
  let kept = 0
  const next = rows.map((r) => {
    const takesDue = r.dueAt == null
    const takesCommence = r.commenceAt == null
    if (!takesDue && !takesCommence) {
      kept += 1
      return r
    }
    if (takesDue || takesCommence) filled += 1
    return {
      ...r,
      dueAt: takesDue ? dates.dueAt : r.dueAt,
      commenceAt: takesCommence ? dates.commenceAt : r.commenceAt,
    }
  })
  return { rows: next, filled, kept }
}

// ---- the warning (I41.8, ADR-0075 d.9) --------------------------------------------------------

/**
 * What a due date inside the delivery window is.
 *
 * - `ok`           — at least the delivery offset of working days sits between due and go-live.
 * - `tight`        — fewer than that. The work may fit, with nothing spare. Proceed knowingly.
 * - `impossible`   — the work does not fit in the working days left at all: the outstanding hours
 *                    exceed what those days hold, or the due date IS the go-live day. This is a
 *                    conversation with the client, and the warning says so in those words.
 * - `after_go_live` — REFUSED. Not a tight deadline but a typing mistake: the client would receive
 *                    the work after they have used it.
 */
export type DueDateSeverity = 'ok' | 'tight' | 'impossible' | 'after_go_live'

export interface DueDateArithmeticInput {
  /** The due day being typed, `YYYY-MM-DD`. */
  dueDay: string
  /** The campaign's go-live day, `YYYY-MM-DD`; null means no warning is possible. */
  goLiveDay: string | null | undefined
  calendar?: WorkingCalendar
  rule?: GoLiveRule
  /**
   * Hours of work still to do on the deliverable, when known (an existing deliverable's open
   * tasks). At wizard time the tasks do not exist yet (traps.md), so the arithmetic is in days.
   */
  outstandingHours?: number | null
  /** Working days from today up to the due day — how many days there are to do the work in. */
  workingDaysToDue?: number | null
  /** Hours one working day holds, for turning days into capacity. Default 8. */
  dayHours?: number
}

export interface DueDateArithmetic {
  severity: DueDateSeverity
  /** Working days strictly after the due day up to and including go-live. */
  workingDaysToGoLive: number
  /** The offset the days were measured against. */
  requiredDays: number
  /** Hours the remaining working days before the due date can hold; null when unknown. */
  capacityHours: number | null
  outstandingHours: number | null
}

/** Working days strictly after `fromDay` up to and including `toDay`; zero when not after. */
export function workingDaysBetween(fromDay: string, toDay: string, calendar: WorkingCalendar): number {
  const from = utcMidnight(fromDay)
  const to = utcMidnight(toDay)
  if (from == null || to == null || to <= from) return 0
  let n = 0
  for (let t = from + 86_400_000, guard = 0; t <= to && guard < 3_660; t += 86_400_000, guard++) {
    if (isWorking(t, calendar)) n += 1
  }
  return n
}

export function classifyDueDate(input: DueDateArithmeticInput): DueDateArithmetic {
  const calendar = input.calendar ?? IRAQ_WORKING_CALENDAR
  const rule = input.rule ?? DEFAULT_GO_LIVE_RULE
  const requiredDays = rule.deliveryDaysBeforeGoLive
  const outstanding = input.outstandingHours ?? null
  const capacity =
    input.workingDaysToDue == null ? null : input.workingDaysToDue * (input.dayHours ?? 8)

  if (!input.goLiveDay || !input.dueDay) {
    return { severity: 'ok', workingDaysToGoLive: 0, requiredDays, capacityHours: capacity, outstandingHours: outstanding }
  }
  if (input.dueDay > input.goLiveDay) {
    return { severity: 'after_go_live', workingDaysToGoLive: 0, requiredDays, capacityHours: capacity, outstandingHours: outstanding }
  }
  const left = workingDaysBetween(input.dueDay, input.goLiveDay, calendar)
  let severity: DueDateSeverity = left >= requiredDays ? 'ok' : 'tight'
  // The due day is the go-live day: nothing can be approved before it is used.
  if (input.dueDay === input.goLiveDay) severity = 'impossible'
  // The hours do not fit in the days: the plan cannot be executed, whoever proceeds.
  if (outstanding != null && capacity != null && outstanding > capacity) severity = 'impossible'
  return { severity, workingDaysToGoLive: left, requiredDays, capacityHours: capacity, outstandingHours: outstanding }
}

/** ADR-0096 d.7: true when the due day is past its phase's end — the record's `after_phase_end`.
 *  Early is not a problem the team has, so a date before the phase starts says nothing. */
export function isAfterPhaseEnd(dueDay: string, phase: { endsOn: string } | null | undefined): boolean {
  return Boolean(phase && dueDay && dueDay > phase.endsOn)
}

