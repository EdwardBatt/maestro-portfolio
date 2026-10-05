import { formatCalendarDay } from '../../../lib/time/iraq'

/**
 * The Schedule's short day words (Figma L): "Tue 29 Sep" in a sentence, "Mon 28" on a row whose month
 * is the week's own, "Sun 4 Oct" when it is not. Built on the project's one date helper
 * (`formatCalendarDay`, I66.8) — only the comma goes, as the frames write it — and Arabic keeps the
 * pan-Arab month names with Western digits.
 */
type Lang = string

const intl = (lang: Lang, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB', { timeZone: 'UTC', ...o })
const at = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)
const month = (iso: string, lang: Lang) => intl(lang, { month: lang === 'ar' ? 'long' : 'short' }).format(at(iso)).replace(/^Sept$/, 'Sep')

/** "Tue 29 Sep" — a whole day, in a sentence. */
export function dayLong(iso: string, lang: Lang): string {
  const s = formatCalendarDay(iso, lang === 'ar' ? 'ar' : 'en')
  return lang === 'ar' ? s : s.replace(',', '')
}

/** "Monday" — for "would have 15 hours on Monday". */
export function weekdayName(iso: string, lang: Lang): string {
  return intl(lang, { weekday: 'long' }).format(at(iso))
}

/** "Mon 28", with the month only when it is not `refIso`'s month ("Sun 4 Oct"). */
export function dayTiny(iso: string, lang: Lang, refIso?: string | null): string {
  const wd = intl(lang, { weekday: lang === 'ar' ? 'long' : 'short' }).format(at(iso))
  const day = String(new Date(at(iso)).getUTCDate())
  const showMonth = refIso != null && iso.slice(0, 7) !== refIso.slice(0, 7)
  return `${wd} ${day}${showMonth ? ` ${month(iso, lang)}` : ''}`
}

/** "Tue 29 – Wed 30", "Tue 6 – Wed 7 Oct" — one day reads as one. */
export function dayRange(from: string, to: string, lang: Lang, refIso?: string | null): string {
  if (from === to) return dayTiny(from, lang, refIso)
  const sameMonth = from.slice(0, 7) === to.slice(0, 7)
  const left = sameMonth ? dayTiny(from, lang, null) : dayTiny(from, lang, refIso)
  return `${left} – ${dayTiny(to, lang, refIso)}`
}

/** "27 Sep – 1 Oct" — a week's working days, no weekday (the weeks menu). */
export function spanWords(from: string, to: string, lang: Lang): string {
  const dm = (iso: string) => `${new Date(at(iso)).getUTCDate()} ${month(iso, lang)}`
  if (from.slice(0, 7) === to.slice(0, 7)) return `${new Date(at(from)).getUTCDate()} – ${dm(to)}`
  return `${dm(from)} – ${dm(to)}`
}

/** "1 Oct" — a calendar cell that starts a month. */
export function dayMonth(iso: string, lang: Lang): string {
  return `${new Date(at(iso)).getUTCDate()} ${month(iso, lang)}`
}
