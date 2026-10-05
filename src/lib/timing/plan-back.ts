/**
 * Planning a campaign BACKWARDS from each phase's own event (`I56.11`, Figma `CB-v3-04`).
 *
 * THE RULE, in Edward's words on the frame: *"Every phase plans back from its own Friday."* A
 * campaign is not one go-live with one count-back; it is a run of phases, each ending on an event
 * of its own — a draw night, a launch, a finale (`I56.10`) — and every piece inside a phase takes
 * its dates from THAT event. Nobody types a due date. They move a phase's end, or pull one piece
 * earlier; everything else follows.
 *
 * WHY THIS FILE HAS NO REACT IN IT. These are the numbers a missed deadline is made of. A quiet
 * error here is not a visual defect anybody notices in review — it is a piece that goes out late
 * and nobody knows why until it is too late. So the arithmetic is separated from the screen, it is
 * exhaustively tested (`plan-back.test.ts`), and the components call none of it: the wizard plans,
 * the components render what it planned (AGENTS.md §4).
 *
 * WHAT IS REUSED AND NOT REBUILT. There is exactly ONE definition of a working day in this
 * codebase (`capacity/working-week.ts` `isWorkingDay`, ADR-0079 d.4) and exactly one count-back
 * step (`campaigns/go-live-dates.ts` `minusWorkingDays`, ADR-0078) — and, since 24 Sep, exactly
 * one INCLUSIVE count-back (`startFromDue`, same file), which this one re-exports. A second
 * calendar living here is the three-places-disagreeing failure ADR-0078 was written about, so this
 * file writes neither.
 * The tenant's run-up is `DEFAULT_GO_LIVE_RULE` — delivery 2 working days before the event,
 * and the piece's own working days of work back from there.
 *
 * Dates are `YYYY-MM-DD` throughout and the arithmetic is done on UTC components, never through a
 * local `Date` — the DST class of bug `AGENTS.md` §5 asks for tests on.
 */

import { formatCalendarDay } from '../time/iraq.ts'
import {
  DEFAULT_GO_LIVE_RULE,
  IRAQ_WORKING_CALENDAR,
  minusWorkingDays,
  startFromDue,
  workingDaysBetween,
  type GoLiveRule,
  type WorkingCalendar,
} from '../campaigns/go-live-dates.ts'
import { isWorkingDay } from '../capacity/working-week.ts'

export { DEFAULT_GO_LIVE_RULE, IRAQ_WORKING_CALENDAR }
export type { GoLiveRule, WorkingCalendar }

/**
 * The inclusive count-back — `needs` working days back from the due day, COUNTING THE DUE DAY.
 *
 * It USED to be written out here and it is not any more (Edward, 24 Sep, `I56.11`). It lived in
 * two places counting two different ways: this file inclusively, `datesFromGoLive` exclusively, so
 * the same four-day piece started Sun 27 Sep on the timing screen and Thu 24 Sep on the go-live
 * count-back. There is now one function, it counts inclusively, and it lives beside
 * `minusWorkingDays` in `campaigns/go-live-dates.ts` because this file already depends on that one
 * — importing the other way round would be a cycle. Re-exported so every caller keeps its import.
 */
export { startFromDue }

const DAY_MS = 86_400_000

function utcMidnight(isoDate: string): number | null {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) return null
  return Date.UTC(y, m - 1, d)
}

function isoOf(t: number): string {
  return new Date(t).toISOString().slice(0, 10)
}

/** ISO weekday, 1 = Mon … 7 = Sun (ADR-0005). */
function isoWeekdayOf(isoDate: string): number {
  const t = utcMidnight(isoDate)
  if (t == null) return 0
  const js = new Date(t).getUTCDay()
  return js === 0 ? 7 : js
}

/**
 * Does the office work that day — through the ONE test, never a second copy. The timezone is
 * 'UTC' on purpose: the day is already an office-local `YYYY-MM-DD`, so converting it again is
 * how a date lands on the wrong side of midnight.
 */
export function isWorkingIsoDay(isoDate: string, calendar: WorkingCalendar): boolean {
  return isWorkingDay(
    { isoDate, isoWeekday: isoWeekdayOf(isoDate) },
    { timezone: 'UTC', workingDays: [...calendar.workingDays], closures: calendar.closures },
  )
}

/** `YYYY-MM-DD` plus n calendar days. A phase starts the day after the one before it ends. */
export function plusDays(isoDate: string, days: number): string {
  const t = utcMidnight(isoDate)
  if (t == null) return isoDate
  return isoOf(t + days * DAY_MS)
}

/**
 * The day itself if the office works it, else the working day before it.
 *
 * A due date on a Friday is a deadline on a day nobody works — the `I41.9` defect, in a new
 * place. The EVENT is exempt (a draw night IS a Friday); everything that plans back from it is
 * not.
 */
export function previousWorkingDay(isoDate: string, calendar: WorkingCalendar): string {
  if (calendar.workingDays.length === 0) return isoDate
  const start = utcMidnight(isoDate)
  if (start == null) return isoDate
  for (let t = start, guard = 0; guard < 366; t -= DAY_MS, guard++) {
    if (isWorkingIsoDay(isoOf(t), calendar)) return isoOf(t)
  }
  return isoDate
}

/** The day itself if the office works it, else the next working day. The start floor's snap. */
export function nextWorkingDay(isoDate: string, calendar: WorkingCalendar): string {
  if (calendar.workingDays.length === 0) return isoDate
  const start = utcMidnight(isoDate)
  if (start == null) return isoDate
  for (let t = start, guard = 0; guard < 366; t += DAY_MS, guard++) {
    if (isWorkingIsoDay(isoOf(t), calendar)) return isoOf(t)
  }
  return isoDate
}

/** The day after a phase ends — what the next phase's start is filled with (`I56.10`). */
export function phaseStartAfter(previousEndsOn: string): string {
  return plusDays(previousEndsOn, 1)
}

/**
 * Each phase's range, first day to last. A phase with no start of its own begins the day after the
 * one before it; the first phase with none is open at the start (`from: null`).
 */
export function phaseRanges<P extends { startsOn: string | null; endsOn: string }>(
  phases: readonly P[],
): { phase: P; from: string | null; to: string }[] {
  return phases.map((p, i) => {
    const prev = phases[i - 1]
    return { phase: p, from: p.startsOn || (prev ? phaseStartAfter(prev.endsOn) : null), to: p.endsOn }
  })
}

/**
 * The phase a day falls in, or null when it falls in none (Edward, 24 Sep: a date in another phase
 * — earlier OR later — moves the piece into that phase). Pass the day the piece will actually be
 * due, not the one typed: a Friday is due the Thursday before, and that Thursday is what decides.
 * Where two phases overlap the earlier one wins, so the answer never depends on list order twice.
 */
export function phaseForDay<P extends { startsOn: string | null; endsOn: string }>(
  phases: readonly P[],
  day: string,
): P | null {
  if (!day) return null
  const hit = phaseRanges(phases).find((r) => (r.from == null || day >= r.from) && day <= r.to)
  return hit?.phase ?? null
}

// ---- the phase -------------------------------------------------------------------------------

/** A phase, as the timing screen needs it. The END is the anchor; nothing else here is. */
export interface PlanPhase {
  id: string
  name: string
  /** The event it ends on — "Draw Night 2", "FINALE" (`I56.10`). Named in every explanation. */
  eventName: string | null
  /** The event's day, `YYYY-MM-DD`. Often a Friday, which the office does not work. */
  endsOn: string
  /** Filled from the previous phase's end and editable (`I56.10`); null on the first phase. */
  startsOn: string | null
}

/** A piece, before it has any dates. It has none of its own: they are all derived. */
export interface PlanPiece {
  id: string
  /** The per-campaign code, letters from the workstream plus a number (`I56.9`). */
  code: string
  name: string
  /** The department that does it. The capacity line is the DEPARTMENT's, never a person (Q14). */
  departmentName: string | null
  phaseId: string
  /** Working days of work, INCLUSIVE of the due day. Null takes the tenant's run-up. */
  needsWorkingDays?: number | null
  /** An exact due date somebody pulled it to. Null means "wherever the phase puts it". */
  pulledDueOn?: string | null
  /** The phase's own event — the draw night itself. It cannot move; the phase moves with it. */
  isEvent?: boolean
  /** A MARKER only (`I56.11` Q4) — it carries no second date and no evidence. */
  givenToClient?: boolean
}

/**
 * `fits` — the run-up is there. `reduced_scope` — it is not, so the piece is amber and goes out
 * tagged reduced scope with the client's sign-off recorded. `fixed` — it is the event; the
 * question does not apply to it.
 */
export type PieceFit = 'fits' | 'reduced_scope' | 'fixed'

export interface PlannedPiece {
  id: string
  code: string
  name: string
  departmentName: string | null
  phaseId: string
  isEvent: boolean
  givenToClient: boolean
  /** The day it is due. Always a working day — except the event, which is its own day. */
  dueOn: string
  /**
   * The day work starts: `needsWorkingDays` working days back, counting the due day — but never
   * before today or the phase's own start (I57.35).
   */
  startsOn: string
  /** Null on the event: it needs no run-up, it IS the date. */
  needsWorkingDays: number | null
  /** Working days from the start floor (today, or the phase's start if later) up to and including the due day. */
  workingDaysAvailable: number
  fit: PieceFit
  /** True when the due date is not the one the phase would have given it. */
  pulled: boolean
  /** True when a date past the phase's end was brought back to it. Warn-and-allow, not silence. */
  clampedToPhaseEnd: boolean
  /** The date the phase gives a piece with no pull — for "it would be due …" explanations. */
  phaseDueOn: string
  /** The phase's end and the event's name, so a row can explain itself without a lookup. */
  phaseEndsOn: string
  eventName: string | null
}

export interface PlannedPhase {
  phase: PlanPhase
  /** The delivery day this phase gives a piece that has not been pulled. */
  dueOn: string
  pieces: PlannedPiece[]
  /** How many of them are short of their run-up. The "see what will not fit" count. */
  reducedScopeCount: number
}

export interface PlanContext {
  /** Today, in the office's day. Availability is measured from here, not from the phase start. */
  today: string
  calendar?: WorkingCalendar
  rule?: GoLiveRule
}

/**
 * The delivery day a phase gives: its event minus the tenant's delivery offset in WORKING days.
 *
 * A Friday draw night therefore delivers on the Wednesday before — Thursday is one working day
 * back, Wednesday two — and never on the Friday or Saturday nobody works.
 */
export function phaseDueDate(
  phase: Pick<PlanPhase, 'endsOn'>,
  calendar: WorkingCalendar = IRAQ_WORKING_CALENDAR,
  rule: GoLiveRule = DEFAULT_GO_LIVE_RULE,
): string {
  return minusWorkingDays(phase.endsOn, rule.deliveryDaysBeforeGoLive, calendar)
}

/**
 * Working days from `today` up to and INCLUSIVE of `dueOn` — what the piece actually has to work
 * in. Today counts when the office works today; a due date already past counts as nothing left.
 */
export function workingDaysAvailable(
  today: string,
  dueOn: string,
  calendar: WorkingCalendar = IRAQ_WORKING_CALENDAR,
): number {
  if (!today || !dueOn || dueOn < today) return 0
  const todayCounts = isWorkingIsoDay(today, calendar) ? 1 : 0
  return todayCounts + workingDaysBetween(today, dueOn, calendar)
}

/** Whether a piece may be given this due date. Only the phase's END is a ceiling (see below). */
export function canPullTo(
  day: string,
  phase: Pick<PlanPhase, 'endsOn'>,
): { ok: boolean; reason: 'after_phase_end' | null } {
  // Early is never the problem — MC-003 needs nine days and starts in the phase before its own.
  // Late is: past the event, the work arrives after the thing it was made for.
  if (day && day > phase.endsOn) return { ok: false, reason: 'after_phase_end' }
  return { ok: true, reason: null }
}

/**
 * The earliest day work may start (I57.35): today. Never the phase's start — work only has to be
 * DELIVERED inside its phase, and a nine-day piece starts in the phase before its own (MC-003 on
 * `CB-v3-04`; Edward, 25 Sep: *"the start date can absolutely be before a phase starts"*). Null when
 * today is not known. Past a due day it is the due day's problem — the caller never moves a start
 * past its due.
 */
export function startFloor(today: string | null | undefined): string | null {
  return today || null
}

/** One piece's dates. Everything else in this file is built from this. */
export function planPiece(piece: PlanPiece, phase: PlanPhase, ctx: PlanContext): PlannedPiece {
  const calendar = ctx.calendar ?? IRAQ_WORKING_CALENDAR
  const rule = ctx.rule ?? DEFAULT_GO_LIVE_RULE
  const phaseDueOn = phaseDueDate(phase, calendar, rule)
  const isEvent = piece.isEvent === true

  let dueOn = phaseDueOn
  let clampedToPhaseEnd = false
  if (isEvent) {
    // The draw night is the event. It is the phase's end, working day or not, and it does not
    // move — the phase moves, and takes it. "Live Streams cannot move" on the frame is this.
    dueOn = phase.endsOn
  } else if (piece.pulledDueOn) {
    let wanted = piece.pulledDueOn
    if (!canPullTo(wanted, phase).ok) {
      // Warn-and-allow, not a silent keep: the date comes back to the event and the row says so.
      wanted = phase.endsOn
      clampedToPhaseEnd = true
    }
    dueOn = previousWorkingDay(wanted, calendar)
  }

  // No lead time in the catalogue yet (`I56.11` defers per-type lead times), so a piece that
  // names none gets the tenant's run-up — the same 4 the count-back uses everywhere else.
  const needsWorkingDays = isEvent ? null : (piece.needsWorkingDays ?? rule.commenceDaysBeforeDelivery)
  const countedBack = needsWorkingDays == null ? dueOn : startFromDue(dueOn, needsWorkingDays, calendar)
  // I57.35 (Edward, 25 Sep): a start is never in the past. It MAY be before its own phase — only
  // the delivery has to fall inside it. What the floor costs the piece is measured from the floor,
  // so a piece squeezed by it is amber (reduced scope), never silently "fits".
  const rawFloor = startFloor(ctx.today)
  const floor = rawFloor ? nextWorkingDay(rawFloor, calendar) : null
  const startsOn = isEvent || !floor || countedBack >= floor ? countedBack : floor > dueOn ? dueOn : floor
  const available = workingDaysAvailable(floor ?? ctx.today, dueOn, calendar)
  const fit: PieceFit = isEvent
    ? 'fixed'
    : available < (needsWorkingDays ?? 0)
      ? 'reduced_scope'
      : 'fits'

  return {
    id: piece.id,
    code: piece.code,
    name: piece.name,
    departmentName: piece.departmentName,
    phaseId: phase.id,
    isEvent,
    givenToClient: piece.givenToClient === true,
    dueOn,
    startsOn,
    needsWorkingDays,
    workingDaysAvailable: available,
    fit,
    pulled: !isEvent && dueOn !== phaseDueOn,
    clampedToPhaseEnd,
    phaseDueOn,
    phaseEndsOn: phase.endsOn,
    eventName: phase.eventName,
  }
}

/** One phase and everything in it. Moving the end and calling this again IS the re-plan. */
export function planPhase(
  phase: PlanPhase,
  pieces: readonly PlanPiece[],
  ctx: PlanContext,
): PlannedPhase {
  const calendar = ctx.calendar ?? IRAQ_WORKING_CALENDAR
  const rule = ctx.rule ?? DEFAULT_GO_LIVE_RULE
  const mine = pieces.filter((p) => p.phaseId === phase.id).map((p) => planPiece(p, phase, ctx))
  return {
    phase,
    dueOn: phaseDueDate(phase, calendar, rule),
    pieces: mine,
    reducedScopeCount: mine.filter((p) => p.fit === 'reduced_scope').length,
  }
}

/** The whole season, in the phases' given order. A piece in no phase is not planned. */
export function planCampaign(
  phases: readonly PlanPhase[],
  pieces: readonly PlanPiece[],
  ctx: PlanContext,
): PlannedPhase[] {
  return phases.map((phase) => planPhase(phase, pieces, ctx))
}

/**
 * Move a phase's end. Everything in that phase re-plans, because every date in it was derived
 * from the end in the first place — re-planning is simply planning again.
 *
 * The NEXT phase's start is filled from the new end, but **only when it still held the derived
 * value**. A start somebody typed is a decision they made, and overwriting it because the phase
 * before moved is the silent-reschedule failure `I17` was raised for and ADR-0052 d.14 refuses by
 * name (`applyGoLiveDates` takes the same line on blanks).
 */
export function movePhaseEnd(
  phases: readonly PlanPhase[],
  phaseId: string,
  newEndsOn: string,
): PlanPhase[] {
  const i = phases.findIndex((p) => p.id === phaseId)
  if (i < 0 || !newEndsOn) return [...phases]
  const oldEndsOn = phases[i].endsOn
  return phases.map((p, n) => {
    if (n === i) return { ...p, endsOn: newEndsOn }
    if (n === i + 1 && p.startsOn === phaseStartAfter(oldEndsOn)) {
      return { ...p, startsOn: phaseStartAfter(newEndsOn) }
    }
    return p
  })
}

// ---- the working week, and days as words ------------------------------------------------------

/** Sunday-first week order, as ISO weekday numbers. The office's week starts on Sunday here. */
const WEEK_FROM_SUNDAY = [7, 1, 2, 3, 4, 5, 6]

/**
 * The office's working week as one unbroken run — `{ from: 7, to: 4 }` is Sun–Thu, which is what
 * the frame's "WORKING WEEK SUN – THU" chip says. Null when the week has a hole in it (a Wed off),
 * because "Sun – Thu" would then be a lie and the caller should list the days instead.
 */
export function workingWeekSpan(
  calendar: WorkingCalendar = IRAQ_WORKING_CALENDAR,
): { from: number; to: number } | null {
  const seats = calendar.workingDays
    .map((d) => WEEK_FROM_SUNDAY.indexOf(d))
    .filter((n) => n >= 0)
    .sort((a, b) => a - b)
  if (seats.length === 0) return null
  const contiguous = seats.every((n, i) => i === 0 || n === seats[i - 1] + 1)
  if (!contiguous) return null
  return { from: WEEK_FROM_SUNDAY[seats[0]], to: WEEK_FROM_SUNDAY[seats[seats.length - 1]] }
}

/** The days the office does NOT work, in week order — "Fridays and Saturdays are never counted". */
export function restDays(calendar: WorkingCalendar = IRAQ_WORKING_CALENDAR): number[] {
  return WEEK_FROM_SUNDAY.filter((d) => !calendar.workingDays.includes(d))
}

function intlLocale(locale: string): string {
  // I66.8: pan-Arab month names and Western digits, as every other date (lib/time/iraq.ts).
  return locale === 'ar' ? 'ar-u-nu-latn' : 'en-GB'
}

/**
 * A planned day as words — `Wed 30 Sep`. Kept HERE, beside the arithmetic, because the table, the
 * phase strip and both dialogs all print the same dates and a second formatter is how two of them
 * end up disagreeing about what "2 Oct" is called.
 *
 * Formatted in UTC: the string is already the office's own day, and converting it through a zone a
 * second time is how a date slips to the day before.
 */
export function formatPlanDay(isoDate: string, locale = 'en', withWeekday = true): string {
  // I66.8: a day on its own reads as every date does — "Fri, 9 Oct", the year only when it is not this year.
  if (withWeekday) return formatCalendarDay(isoDate, locale === 'ar' ? 'ar' : 'en')
  const t = utcMidnight(isoDate)
  if (t == null) return isoDate
  const parts = new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: 'UTC',
    ...(withWeekday ? { weekday: 'short' as const } : {}),
    day: 'numeric',
    month: 'short',
  }).formatToParts(t)
  return parts
    .map((p) => (p.type === 'literal' ? p.value.replace(/[,،]/g, '') : p.type === 'month' ? p.value.replace(/^Sept$/, 'Sep') : p.value))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A phase's span as words — `26 Sep – 2 Oct`. The weekday is noise across a range. */
export function formatPlanRange(startsOn: string | null, endsOn: string, locale = 'en'): string {
  const end = formatPlanDay(endsOn, locale, false)
  if (!startsOn) return end
  return `${formatPlanDay(startsOn, locale, false)} – ${end}`
}

/** A weekday's short name — for the "WORKING WEEK SUN – THU" chip, in the reader's language. */
export function formatWeekday(isoWeekday: number, locale = 'en'): string {
  // 2024-01-01 was a Monday, so ISO weekday n is the nth day of that week.
  const t = Date.UTC(2024, 0, 1) + (isoWeekday - 1) * DAY_MS
  return new Intl.DateTimeFormat(intlLocale(locale), { timeZone: 'UTC', weekday: 'short' }).format(t)
}
