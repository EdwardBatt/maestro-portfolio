import { formatIraqDate } from '../../../lib/time/iraq'
/**
 * The small rules the client screens (Figma section J, ADR-0123) read, kept pure so they are tested.
 */

/** The six steps of registration (CL-v3-01 … 06), in order. */
export const STEPS = ['basics', 'brands', 'people', 'rules', 'howWeWork', 'review'] as const
export type StepKey = (typeof STEPS)[number]

/**
 * The profile meter — "Fuller profile, fewer questions later" (CL-v3). Each part is what a later job
 * would otherwise have to ask, weighted as the frames step through it: the basics 20, a brand 20, a
 * person at the client 20, a rule 15, what the business is 15, someone who signs off 10.
 */
export interface ProfileParts {
  basics: boolean
  businessTypes: number
  brands: number
  contacts: number
  signsOff: number
  rules: number
}

export function profilePct(p: ProfileParts): number {
  return (
    (p.basics ? 20 : 0) +
    (p.brands > 0 ? 20 : 0) +
    (p.contacts > 0 ? 20 : 0) +
    (p.rules > 0 ? 15 : 0) +
    (p.businessTypes > 0 ? 15 : 0) +
    (p.signsOff > 0 ? 10 : 0)
  )
}

const WEEKDAY_BASE = Date.UTC(2026, 0, 5) // a Monday: ISO weekday 1

function dayName(isoWeekday: number, locale: 'en' | 'ar', style: 'short' | 'long'): string {
  const d = new Date(WEEKDAY_BASE + ((isoWeekday - 1) % 7) * 86_400_000)
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-IQ' : 'en-GB', { weekday: style, timeZone: 'UTC' }).format(d)
}

/** Runs of consecutive ISO weekdays, wrapping Sunday → Monday, starting where a run begins. */
function runs(days: readonly number[]): number[][] {
  const set = new Set(days.filter((d) => d >= 1 && d <= 7))
  if (set.size === 0) return []
  if (set.size === 7) return [[1, 2, 3, 4, 5, 6, 7]]
  const next = (d: number) => (d % 7) + 1
  const prev = (d: number) => ((d + 5) % 7) + 1
  const out: number[][] = []
  const seen = new Set<number>()
  for (let d = 1; d <= 7; d++) {
    if (!set.has(d) || seen.has(d) || set.has(prev(d))) continue
    const run: number[] = []
    for (let x = d; set.has(x) && !seen.has(x); x = next(x)) {
      run.push(x)
      seen.add(x)
    }
    out.push(run)
  }
  return out
}

/** "Sun–Thu" (or "Sunday – Thursday" long) for a working week; runs joined with a comma. */
export function weekLabel(days: readonly number[], locale: 'en' | 'ar', style: 'short' | 'long' = 'short'): string {
  const dash = style === 'long' ? ' – ' : '–'
  return runs(days)
    .map((r) => (r.length === 1 ? dayName(r[0]!, locale, style) : `${dayName(r[0]!, locale, style)}${dash}${dayName(r[r.length - 1]!, locale, style)}`))
    .join(locale === 'ar' ? '، ' : ', ')
}

/** The days a working week leaves out — its weekend. */
export function weekendOf(days: readonly number[]): number[] {
  const set = new Set(days)
  return [1, 2, 3, 4, 5, 6, 7].filter((d) => !set.has(d))
}

/**
 * The clients list's "Last activity" (CV-01): "2h ago" today, "yesterday", then the day ("Thu 17"),
 * then the date when it is more than a week back. The first two are the app's own words (the caller
 * renders `key` with `count`); the dates are the calendar's.
 */
export type ActivityLabel = { key: 'minutesAgo' | 'hoursAgo' | 'yesterday'; count: number } | { text: string }

export function lastActivityLabel(iso: string | null, now: number, locale: 'en' | 'ar'): ActivityLabel | null {
  if (!iso) return null
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return null
  const day = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad' }).format(ms)
  if (day(at) === day(now)) {
    const minutes = Math.max(1, Math.floor((now - at) / 60_000))
    return minutes < 60 ? { key: 'minutesAgo', count: minutes } : { key: 'hoursAgo', count: Math.floor(minutes / 60) }
  }
  if (day(at) === day(now - 86_400_000)) return { key: 'yesterday', count: 1 }
  // I66.8: an older day reads as every date does — "Tue, 22 Sep".
  return { text: formatIraqDate(at, locale, now) }
}

/** The clients list's "On time" (CV-01): green when all of it is, amber from three in four, red below. */
export function onTimeTone(w: { onTime: number; unfinished: number }): 'ok' | 'amber' | 'risk' | 'none' {
  if (w.unfinished === 0) return 'none'
  if (w.onTime === w.unfinished) return 'ok'
  return w.onTime / w.unfinished >= 0.75 ? 'amber' : 'risk'
}
