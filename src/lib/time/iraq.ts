/**
 * One company clock (ADR-0076).
 *
 * Everything a person is shown is presented in Iraq time and SAYS SO. The zone label is not
 * decoration: it is the half of d.1 that makes a single clock safe rather than merely consistent —
 * a reader in Dubai seeing "18:00" needs to know whose 18:00 it is.
 *
 * WHY THIS FILE EXISTS RATHER THAN THIRTEEN CALL SITES (d.7). A date rule copied by hand into every
 * screen is the drift this project has already paid for three times in one day — the notification
 * copy map, the audit trigger list, the audit entity filter (traps.md). The app and the Edge
 * Functions both import from here, so an email and a screen cannot disagree about when something is
 * due.
 *
 * THE THING TO UNDERSTAND BEFORE EDITING. Until ADR-0076 a deadline was a DAY written as midnight
 * UTC and printed with `slice(0, 10)`: two errors that cancelled, and only while every user sat east
 * of UTC. A deadline is now a real instant — 18:00 Asia/Baghdad, the close of business — so the
 * ordinary rule applies to it like any other timestamp, and `slice(0, 10)` is banned (d.6). Iraq
 * does not observe DST, but this converts properly through `Intl` rather than adding three hours,
 * because a hardcoded offset is how the next timezone bug gets written.
 */

export const IRAQ_TZ = 'Asia/Baghdad'

/** The close of the working day, in Iraq. A deadline falls here (ADR-0076 d.3). */
export const CLOSE_HOUR = 18

type Loc = 'en' | 'ar'

/**
 * The instant that `18:00 Iraq on <isoDay>` actually is.
 *
 * Built by asking Intl what UTC instant lands on that wall time rather than by assuming +03:00 —
 * the assumption is right today and is exactly the kind that survives until it does not.
 */
export function endOfWorkingDay(isoDay: string): Date {
  const guess = Date.parse(`${isoDay}T${String(CLOSE_HOUR).padStart(2, '0')}:00:00Z`)
  // How far the guess is from the intended wall time, in the office's zone.
  const seen = new Intl.DateTimeFormat('en-GB', {
    timeZone: IRAQ_TZ, hour: '2-digit', hourCycle: 'h23', minute: '2-digit',
  }).formatToParts(guess)
  const h = Number(seen.find((p) => p.type === 'hour')?.value ?? '0')
  const m = Number(seen.find((p) => p.type === 'minute')?.value ?? '0')
  const driftMs = (h * 60 + m - CLOSE_HOUR * 60) * 60_000
  return new Date(guess - driftMs)
}

/** The Iraq calendar day of an instant, as YYYY-MM-DD. Never the UTC day (d.6). */
export function iraqDay(at: string | number | Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IRAQ_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(at))
  return parts // en-CA formats as YYYY-MM-DD
}

/**
 * The language a caller that names none gets: the page's own (`<html lang>`, which `applyLocale`
 * keeps with the interface language), else English — an Edge Function has no document. I53.24
 * (21 Sep): twelve screens called these with no language and printed English dates in the Arabic
 * UI beside a phase strip that was fully Arabic; the seam is here so none of them can drift again.
 */
function pageLocale(): Loc {
  // Through globalThis, typed loosely: this file is also compiled by Deno, which has no `document`.
  const doc = (globalThis as { document?: { documentElement?: { lang?: string } } }).document
  return doc?.documentElement?.lang === 'ar' ? 'ar' : 'en'
}

/**
 * I66.8 (Edward, 29 Sep): EVERY date reads weekday, day, month — "Fri, 9 Oct" — and the year only when it is not
 * this year ("Sat, 9 Oct 2027"). Arabic is the pan-Arab form with Western digits — "الجمعة، 9 أكتوبر" (Edward: a
 * client and staff in Egypt, staff in Dubai, so not the Iraqi month names). One place builds it, for the app and
 * the Edge Functions alike.
 *
 * `ms` is read in `tz`: Iraq for an instant, UTC for a calendar day already written as YYYY-MM-DD.
 */
function dayWords(ms: number, tz: string, l: Loc, nowMs: number): string {
  const ar = l === 'ar'
  const parts = new Intl.DateTimeFormat(ar ? 'ar-u-nu-latn' : 'en-GB', {
    timeZone: tz, weekday: ar ? 'long' : 'short', day: 'numeric', month: ar ? 'long' : 'short', year: 'numeric',
  }).formatToParts(ms)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  // en-GB writes September "Sept"; every other month is three letters, and so is this one here.
  const month = ar ? part('month') : part('month').replace(/^Sept$/, 'Sep')
  const thisYear = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric' }).format(nowMs)
  const year = part('year') !== thisYear ? ` ${part('year')}` : ''
  return ar ? `${part('weekday')}، ${part('day')} ${month}${year}` : `${part('weekday')}, ${part('day')} ${month}${year}`
}

/** `Fri, 9 Oct` — a day, in Iraq, with no time; `Sat, 9 Oct 2027` in another year (I66.8). */
export function formatIraqDate(at: string | number | Date, l: Loc = pageLocale(), nowMs: number = Date.now()): string {
  return dayWords(new Date(at).getTime(), IRAQ_TZ, l, nowMs)
}

/** The same words as `formatIraqDate` — kept as a name for the lines that must stay short (a card). */
export function formatIraqShortDate(at: string | number | Date, l: Loc = pageLocale(), nowMs: number = Date.now()): string {
  return formatIraqDate(at, l, nowMs)
}

/**
 * A calendar day already written as `YYYY-MM-DD` (a phase's start, a leave day, a plan day) — `Fri, 9 Oct`.
 * Read in UTC: the string is already the office's own day, and converting it through a zone again is how a
 * date slips to the day before. Anything that is not a real day comes back as it was, never a throw.
 */
export function formatCalendarDay(isoDay: string, l: Loc = pageLocale(), nowMs: number = Date.now()): string {
  const ms = Date.parse(`${isoDay.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(ms) ? isoDay : dayWords(ms, 'UTC', l, nowMs)
}

/** `Fri, 9 Oct, 15:00` — a moment, in Iraq; `Sat, 9 Oct 2027, 15:00` in another year. */
export function formatIraqDateTime(at: string | number | Date, l: Loc = pageLocale(), nowMs: number = Date.now()): string {
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: IRAQ_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date(at))
  return `${formatIraqDate(at, l, nowMs)}${l === 'ar' ? '، ' : ', '}${time}`
}

/**
 * The words that name the clock (d.2). Kept here and not in the locale files because they must
 * reach the Edge Functions too, which have no i18next — and a second copy in `en.json` is the
 * drift this file exists to prevent.
 */
export function iraqZoneLabel(l: Loc = pageLocale()): string {
  return l === 'ar' ? 'بتوقيت العراق' : 'Iraq time'
}

/** `Fri, 9 Oct (Iraq time)` — the default way a deadline is shown. */
export function formatDeadline(at: string | number | Date, l: Loc = pageLocale()): string {
  return `${formatIraqDate(at, l)} (${iraqZoneLabel(l)})`
}

/** `Fri, 9 Oct, 18:00 (Iraq time)` — when the hour itself matters. */
export function formatMoment(at: string | number | Date, l: Loc = pageLocale()): string {
  return `${formatIraqDateTime(at, l)} (${iraqZoneLabel(l)})`
}

/**
 * Drop-in for a screen's own `Intl.DateTimeFormat` (I66.8): `stampFormatter(l).format(x)` reads "Fri, 9 Oct, 15:00"
 * (in Iraq), `dayFormatter(l).format(x)` reads "Fri, 9 Oct" — so a screen that built its own `dateStyle: 'medium'`
 * formatter says a date the one way every other screen does.
 */
export function stampFormatter(l: Loc = pageLocale()): { format: (at: string | number | Date) => string } {
  return { format: (at) => formatIraqDateTime(at, l) }
}
export function dayFormatter(l: Loc = pageLocale()): { format: (at: string | number | Date) => string } {
  return { format: (at) => formatIraqDate(at, l) }
}
