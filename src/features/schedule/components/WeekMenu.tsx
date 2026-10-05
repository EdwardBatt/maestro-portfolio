import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DateField } from '../../../components/DateField'
import { useScheduleBookings, type ScheduleResource } from '../api/schedule-api'
import { weekOptions, weekWord, workingRange, type WeekOption } from '../lib/week-menu.ts'
import { spanWords } from '../lib/day-words.ts'
import { Popover } from './Popover'

const DAY = 86_400_000

/**
 * The week pill (I74.24, Figma L SC-20 / SC-21b): "‹ This week · 27 Sep – 1 Oct ›". The arrows step a
 * week; the words open the weeks menu — last week, this week and the three after, each with how full
 * the viewer's team is — and "Jump to a date…".
 */
export function WeekMenu({
  start,
  thisWeek,
  people,
  onGo,
  onPrev,
  onNext,
}: {
  start: number
  thisWeek: number
  people: ScheduleResource[]
  onGo: (weekStart: number) => void
  onPrev: () => void
  onNext: () => void
}) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const word = weekWord(start, thisWeek)
  const wd = people.find((p) => p.office)?.office?.workingDays
  const range = (s: number) => { const r = workingRange(s, wd); return spanWords(r.from, r.to, lang) }

  return (
    <div className="sc-week" data-testid="week-pill">
      <button type="button" className="sc-week-arrow sc-flip" onClick={onPrev} aria-label={t('schedule.previous')} data-testid="nav-prev">‹</button>
      <button type="button" className="sc-week-label" aria-haspopup="dialog" aria-expanded={anchor != null} onClick={(e) => setAnchor(anchor ? null : e.currentTarget)} data-testid="week-menu-open">
        {word ? `${t(`schedule.sc.week.${word}`)} · ` : `${t('schedule.sc.week.weekOf')} `}{range(start)}
      </button>
      <button type="button" className="sc-week-arrow sc-flip" onClick={onNext} aria-label={t('schedule.next')} data-testid="nav-next">›</button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={250} align="end" testId="week-menu">
          <WeekList thisWeek={thisWeek} current={start} people={people} range={range} onGo={(s) => { onGo(s); setAnchor(null) }} />
        </Popover>
      )}
    </div>
  )
}

function WeekList({ thisWeek, current, people, range, onGo }: {
  thisWeek: number
  current: number
  people: ScheduleResource[]
  range: (start: number) => string
  onGo: (start: number) => void
}) {
  const { t } = useTranslation()
  const [jumping, setJumping] = useState(false)
  const span = useMemo(() => ({ start: thisWeek - 7 * DAY, end: thisWeek + 28 * DAY }), [thisWeek])
  const bookings = useScheduleBookings(span)
  const options: WeekOption[] = useMemo(() => weekOptions(thisWeek, people, bookings.data ?? []), [thisWeek, people, bookings.data])

  return (
    <div className="sc-weeks">
      {options.map((o) => {
        const word = weekWord(o.start, thisWeek)
        return (
          <button key={o.start} type="button" className={`sc-week-row${o.start === current ? ' is-on' : ''}`} onClick={() => onGo(o.start)} data-testid={`week-option-${o.offset}`}>
            <span className="sc-week-row-text">
              {word && <span className="sc-week-row-word">{t(`schedule.sc.week.${word}`)}</span>}
              <span className="sc-week-row-range">{range(o.start)}</span>
            </span>
            <span className="sc-week-row-load">
              <span className="sc-week-row-pct">{bookings.isLoading ? '…' : o.pct === 0 ? t('schedule.sc.week.nothing') : t('schedule.sc.week.booked', { pct: o.pct })}</span>
              <span className="sc-bar" aria-hidden="true"><span className={`sc-bar-fill${o.pct > 100 ? ' is-over' : o.start === current ? ' is-on' : o.pct >= 80 ? ' is-full' : ' is-free'}`} style={{ inlineSize: `${Math.min(o.pct, 100)}%` }} /></span>
            </span>
          </button>
        )
      })}
      {jumping ? (
        <div className="sc-week-jump">
          <DateField value="" onChange={(d) => { if (d) { const s = Date.parse(`${d}T00:00:00Z`); onGo(s - new Date(s).getUTCDay() * DAY) } }} aria-label={t('schedule.sc.week.jump')} data-testid="week-jump-date" />
        </div>
      ) : (
        <button type="button" className="sc-week-jump-link" onClick={() => setJumping(true)} data-testid="week-jump">{t('schedule.sc.week.jump')}</button>
      )}
    </div>
  )
}
