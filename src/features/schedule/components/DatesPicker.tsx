import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import type { DayLoad } from '../lib/day-load.ts'
import { dayLong, dayMonth, dayRange, spanWords, weekdayName } from '../lib/day-words.ts'
import { daysBeforeDue, hoursPerDay, isoPlus, workDays } from '../lib/book-plan.ts'

/**
 * "ZUBAIDA · PICK THE DATES" (SC-05 / SC-06): three weeks of the person's working days, each with its
 * free hours, and a line saying what the pick means. A day after the due date is picked like any
 * other — the line turns red and says you can still book (ADR-0061 d.2). A day already gone is shown
 * as past and is not offered: there is nothing to book into it.
 */
export function DatesPicker({
  personName,
  startSunday,
  from,
  to,
  hours,
  dueIso,
  todayIso,
  workingWeekdays,
  isWorking,
  loadOn,
  single = false,
  onChange,
  onDone,
  testId,
}: {
  personName: string | null
  /** the Sunday the three weeks start on */
  startSunday: string
  from: string | null
  to: string | null
  /** the task's total hours — for "3h a day = 6h"; 0 in the one-day bulk pick */
  hours: number
  dueIso: string | null
  todayIso: string
  /** the columns: day offsets from Sunday (0 = Sun) the person works */
  workingWeekdays: number[]
  isWorking: (iso: string) => boolean
  /** the person's day, with the rest of this window's plan on it; null when nobody is picked yet */
  loadOn: (iso: string) => DayLoad | null
  /** the bulk "on [day]" pick: one click is the whole answer */
  single?: boolean
  onChange: (from: string, to: string) => void
  onDone: () => void
  testId: string
}) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const [weekOffset, setWeekOffset] = useState(0)
  const [next, setNext] = useState<'from' | 'to'>(from && to && from === to && !single ? 'to' : 'from')
  const first = isoPlus(startSunday, weekOffset * 7)
  const last = isoPlus(first, 20)

  const pick = (iso: string) => {
    if (single) { onChange(iso, iso); return }
    // A click on the start day itself keeps the range open, so a day already chosen (the grid's click, I74.32)
    // then a later day makes the span — it does not start again on the later day.
    if (next === 'to' && from && iso >= from) { onChange(from, iso); setNext(iso === from ? 'to' : 'from'); return }
    onChange(iso, iso)
    setNext('to')
  }

  const days = from && to ? workDays(from, to, isWorking) : []
  const per = hoursPerDay(hours, days.length)
  const end = days[days.length - 1] ?? to
  const late = dueIso != null && end != null && end > dueIso
  const ahead = dueIso != null && end != null ? daysBeforeDue(end, dueIso) : null

  const weeks = [0, 1, 2].map((w) => isoPlus(first, w * 7))
  const cols = [...workingWeekdays].sort((a, b) => a - b)

  return (
    <div className="sc-dates" data-testid={testId}>
      <p className="sc-pop-title">
        {personName ? t('schedule.sc.dates.titleFor', { name: personName }) : t('schedule.sc.dates.title')}
      </p>
      {!single && (
        <div className="sc-dates-fromto">
          <span className={`sc-dates-pill${next === 'from' ? ' is-next' : ''}`}>
            <span className="sc-dates-pill-label">{t('schedule.sc.dates.from')}</span>
            <span data-testid={`${testId}-from`}>{from ? dayLong(from, lang) : '—'}</span>
          </span>
          <span className={`sc-dates-pill${next === 'to' ? ' is-next' : ''}`}>
            <span className="sc-dates-pill-label">{t('schedule.sc.dates.to')}</span>
            <span data-testid={`${testId}-to`}>{to ? dayLong(to, lang) : '—'}</span>
          </span>
        </div>
      )}
      <div className="sc-dates-nav">
        <button type="button" className="icon-btn icon-btn-sm sc-flip" aria-label={t('schedule.previous')} onClick={() => setWeekOffset((w) => w - 1)} data-testid={`${testId}-prev`}>‹</button>
        <span className="sc-dates-span">{spanWords(first, last, lang)}</span>
        <button type="button" className="icon-btn icon-btn-sm sc-flip" aria-label={t('schedule.next')} onClick={() => setWeekOffset((w) => w + 1)} data-testid={`${testId}-next`}>›</button>
      </div>
      <div className="sc-cal" style={{ gridTemplateColumns: `repeat(${cols.length}, 1fr)` }} role="grid">
        {cols.map((c) => (
          <span key={`h${c}`} className="sc-cal-head">{weekdayName(isoPlus(first, c), lang).slice(0, lang === 'ar' ? undefined : 3)}</span>
        ))}
        {weeks.flatMap((w) => cols.map((c) => {
          const iso = isoPlus(w, c)
          const past = iso < todayIso
          const chosen = from != null && to != null && iso >= from && iso <= to && isWorking(iso)
          const load = past ? null : loadOn(iso)
          const dayNum = new Date(`${iso}T00:00:00Z`).getUTCDate()
          return (
            <button
              key={iso}
              type="button"
              className={['sc-cal-day', chosen ? 'is-on' : '', past ? 'is-past' : '', iso === dueIso ? 'is-due' : '', load ? `is-${load.state}` : ''].filter(Boolean).join(' ')}
              disabled={past}
              onClick={() => pick(iso)}
              aria-pressed={chosen}
              aria-label={dayLong(iso, lang)}
              data-testid={`${testId}-day-${iso}`}
            >
              <span className="sc-cal-num">{dayNum === 1 ? dayMonth(iso, lang) : dayNum}</span>
              <span className="sc-cal-free">
                {past ? t('schedule.sc.dates.past')
                  : !load ? ''
                  : load.state === 'over' ? t('schedule.sc.cell.over', { n: load.overHours })
                  : load.state === 'full' ? t('schedule.sc.cell.full')
                  : load.state === 'leave' ? t('schedule.sc.cell.leave')
                  : load.state === 'off' ? t('schedule.sc.cell.off')
                  : t('schedule.sc.cell.free', { n: load.freeHours })}
              </span>
              {iso === dueIso && <span className="sc-cal-due">{t('schedule.sc.due')}</span>}
            </button>
          )
        }))}
      </div>
      {from && to && (
        <p className={`sc-dates-sum${late ? ' is-late' : ''}`} data-testid={`${testId}-summary`}>
          {single
            ? dayLong(from, lang)
            : [
                dayRange(from, to, lang, startSunday),
                t('schedule.sc.dates.days', { count: days.length }),
                hours > 0 ? t('schedule.sc.dates.perDay', { per, total: hours }) : null,
              ].filter(Boolean).join(' · ') + '. '}
          {!single && dueIso && (late
            ? t('schedule.sc.dates.late', { due: dayLong(dueIso, lang) })
            : ahead === 0 ? t('schedule.sc.dates.onDue')
            : ahead != null ? t('schedule.sc.dates.ahead', { count: ahead }) : null)}
        </p>
      )}
      <Button variant="primary" size="sm" onClick={onDone} data-testid={`${testId}-done`}>{t('schedule.sc.dates.done')}</Button>
    </div>
  )
}
