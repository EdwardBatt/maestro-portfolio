import { IRAQ_WORKING_CALENDAR, startFromDue, type WorkingCalendar } from '../../../lib/campaigns/go-live-dates'
import { formatCalendarDay } from '../../../lib/time/iraq'
import { isRealDay } from '../../../lib/time/real-day'

/**
 * SJ-v3-04 — the lead time. The count itself (`computeLeadTime`, `LeadTime`) moved to
 * `src/lib/campaigns/lead-time.ts` (I59 Track 6): My Work's reduced-scope acknowledgement records
 * the same two numbers, so both read one rule. Re-exported here so the intake's imports stand.
 * What stays is the intake's own presentation of it: the day strip and the long day name.
 */
export { computeLeadTime, type LeadTime } from '../../../lib/campaigns/lead-time'

export interface StripDay {
  iso: string
  label: string
  kind: 'start' | 'working' | 'due' | 'weekend'
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function isWorkingDay(iso: string, calendar: WorkingCalendar): boolean {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay() // 0 = Sunday
  const iso8601 = dow === 0 ? 7 : dow
  return calendar.workingDays.includes(iso8601) && !(calendar.closures ?? []).includes(iso)
}

/** The days from the window's start to the due date, then the weekend that follows it — on the
 *  client's week (ADR-0123 d.3). */
export function dayStrip(dueDay: string, needsDays: number, locale: 'en' | 'ar', calendar: WorkingCalendar = IRAQ_WORKING_CALENDAR): StripDay[] {
  // I66.8: this ran on every keystroke, and a typed five-digit year crashed the page ("Invalid time value").
  // No strip for a day that is not real — the date box says what is wrong.
  if (!isRealDay(dueDay)) return []
  const start = startFromDue(dueDay, needsDays, calendar)
  const label = (iso: string) => formatCalendarDay(iso, locale)
  const out: StripDay[] = []
  for (let iso = start, guard = 0; iso <= dueDay && guard < 60; iso = addDays(iso, 1), guard++) {
    const kind: StripDay['kind'] = iso === start ? 'start' : iso === dueDay ? 'due' : isWorkingDay(iso, calendar) ? 'working' : 'weekend'
    out.push({ iso, label: label(iso), kind })
  }
  for (let iso = addDays(dueDay, 1), n = 0; n < 2 && !isWorkingDay(iso, calendar); iso = addDays(iso, 1), n++) {
    out.push({ iso, label: label(iso), kind: 'weekend' })
  }
  return out
}

/** A day in words — "Fri, 9 Oct", as every date reads (I66.8). */
export function formatDayLong(iso: string, locale: 'en' | 'ar'): string {
  return formatCalendarDay(iso, locale)
}
