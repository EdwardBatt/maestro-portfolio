import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from '../../../components/Button'
import { Modal } from '../../../components/Modal'
import { iraqDay, formatIraqDateTime } from '../../../lib/time/iraq'
import { isWorkingDay, localDayOf } from '../../../lib/capacity/working-week.ts'
import { STANDARD_DAY_HOURS } from '../../../lib/capacity/day-hours.ts'
import { blocksWholeDay, internalHoursOn } from '../../../lib/capacity/blocked-time.ts'
import { namedRefusal, refusalSentence } from '../../../lib/errors/classify'
import { translateScheduleWarning } from '../../../lib/bookings/schedule-outcome'
import { askHintKey, isUnanswered, timeLeftToAnswer, type TaskAsk } from '../../../lib/task-asks/asks'
import { useAnswerTaskRequest, useAskRuleHours } from '../../../lib/task-asks/api'
import { useScheduleBlackouts, useScheduleBookings, type ScheduleResource } from '../api/schedule-api'
import { usePieceFiles } from '../api/book-api'
import { daySpan } from '../lib/day-span.ts'
import { dayLoad, freeHoursOf, internalLoad, weekNote } from '../lib/day-load.ts'
import { hoursPerDay, isoPlus, workDays } from '../lib/book-plan.ts'
import { dayLong, weekdayName } from '../lib/day-words.ts'
import { Avatar } from './Avatar'
import { PeoplePicker, type PersonOption } from './PeoplePicker'
import { PieceBriefTab } from './PieceBriefTab'
import { PieceFilesTab } from './PieceFilesTab'
import { Popover } from './Popover'

const DAY = 86_400_000
const sundayOf = (iso: string) => isoPlus(iso, -new Date(`${iso}T00:00:00Z`).getUTCDay())

/**
 * The lead answers an ask (I74.4, Figma L SC-29): the task, who asked and why, then who does it, the
 * days and the hours — pre-filled with what was asked — and three answers: Book <person>, Offer
 * another day, Say no (with a reason). The server decides who may answer (ADR-0139 d.3/d.5); after it
 * waited past the rule, Traffic and the department lead see the same card marked unanswered.
 */
export function AnswerAskDialog({
  ask,
  people,
  onClose,
  onAnswered,
}: {
  ask: TaskAsk
  /** the answerer's own people — whom the ask can be booked to */
  people: ScheduleResource[]
  onClose: () => void
  onAnswered: (sentence: string) => void
}) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const rule = useAskRuleHours()
  const answer = useAnswerTaskRequest()
  const files = usePieceFiles(ask.deliverableId)

  const askedDay = ask.neededBy ?? (ask.dueAt ? iraqDay(ask.dueAt) : iraqDay(Date.now()))
  const firstDay = ask.startsAt ? iraqDay(ask.startsAt) : askedDay
  const asked = people.find((p) => p.userId === ask.assigneeId) ?? null
  const [resourceId, setResourceId] = useState<string | null>(asked?.id ?? null)
  const [from, setFrom] = useState(firstDay)
  const [to, setTo] = useState(askedDay)
  const [hours, setHours] = useState(ask.hours ?? 1)
  const [saying, setSaying] = useState<'no' | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [show, setShow] = useState<'brief' | 'files' | null>(null)
  const [whoAnchor, setWhoAnchor] = useState<HTMLElement | null>(null)

  const sunday = sundayOf(from)
  const span = useMemo(() => ({ start: Date.parse(`${sunday}T00:00:00Z`), end: Date.parse(`${sunday}T00:00:00Z`) + 14 * DAY }), [sunday])
  const bookings = useScheduleBookings(span)
  const blackouts = useScheduleBlackouts(span)
  const resById = useMemo(() => new Map(people.map((r) => [r.id, r])), [people])
  const working = (r: ScheduleResource, s: number) => (r.office ? isWorkingDay(localDayOf(s + 43_200_000, r.office.timezone), r.office) : true)
  const loadOn = (r: ScheduleResource, iso: string) => {
    const s = Date.parse(`${iso}T00:00:00Z`)
    const mine = (blackouts.data ?? []).filter((b) => b.resourceId === r.id)
    const cell = (bookings.data ?? []).filter((b) => b.resourceId === r.id && b.start < s + DAY && b.end > s)
    return dayLoad(r, [...cell, ...internalLoad(internalHoursOn(mine, s, (d) => working(r, d)))], { nonWorking: !working(r, s), onLeave: blocksWholeDay(mine, s) })
  }
  const options: PersonOption[] = people
    .filter((r) => r.kind === 'human' && r.userId)
    .map((r) => {
      const days = Array.from({ length: 7 }, (_, i) => isoPlus(sunday, i)).map((iso) => ({ isoDate: iso, load: loadOn(r, iso) }))
      const workingDays = days.filter((d) => d.load.state !== 'off')
      return { resource: r, freeHours: freeHoursOf(days.map((d) => d.load)), weekHours: workingDays.length * STANDARD_DAY_HOURS, note: weekNote(days) }
    })
    .sort((a, b) => b.freeHours - a.freeHours || a.resource.name.localeCompare(b.resource.name))
  const chosen = resourceId ? resById.get(resourceId) ?? null : null
  const chosenName = chosen?.name ?? ''
  const askerName = ask.requesterName ?? ''
  const freeOnTo = chosen ? loadOn(chosen, to) : null

  const left = timeLeftToAnswer(ask.createdAt, rule.data)
  const unanswered = isUnanswered(ask, rule.data)

  const instants = () => {
    if (!chosen) return null
    const tz = chosen.office?.timezone ?? 'UTC'
    const days = workDays(from, to < from ? from : to, (d) => working(chosen, Date.parse(`${d}T00:00:00Z`)))
    const per = hoursPerDay(hours, days.length)
    return {
      startsAt: new Date(daySpan(days[0]!, per, tz).start).toISOString(),
      dueAt: new Date(daySpan(days[days.length - 1]!, per, tz).end).toISOString(),
    }
  }
  const fail = (e: unknown) => {
    const hk = askHintKey(e)
    setError((hk ? t(hk) : null) ?? namedRefusal(e, t) ?? refusalSentence(e as { code?: string; message?: string }) ?? (e as { message?: string }).message ?? t('schedule.asks.failed'))
  }

  async function act(kind: 'book' | 'offer' | 'refuse') {
    setError(null)
    if (kind === 'refuse' && !reason.trim()) return setError(t('schedule.asks.hint.reason_required'))
    if (kind !== 'refuse' && !chosen) return setError(t('schedule.asks.hint.person_required'))
    const when = kind === 'refuse' ? null : instants()
    try {
      const r = await answer.mutateAsync({
        requestId: ask.id,
        answer: kind,
        assigneeId: chosen?.userId ?? null,
        startsAt: when?.startsAt ?? null,
        dueAt: when?.dueAt ?? null,
        hours: kind === 'refuse' ? null : hours,
        note: kind === 'refuse' ? reason : null,
      })
      const warn = r.scheduleWarning ? ` ${translateScheduleWarning(t, r.scheduleWarning) ?? ''}` : ''
      onAnswered(
        kind === 'book' ? t('schedule.asks.answer.booked', { name: chosenName, asker: askerName }) + warn
          : kind === 'offer' ? t('schedule.asks.answer.offered', { asker: askerName, day: dayLong(to, lang) })
            : t('schedule.asks.answer.refused', { asker: askerName }),
      )
      onClose()
    } catch (e) {
      fail(e)
    }
  }

  const team = ask.requesterTeamName
  return (
    <Modal onClose={onClose} labelledById="answer-ask-title" testId="answer-ask">
      <div className="sc-answer">
        <header className="sc-answer-head">
          <p className="sc-answer-tags">
            <span className="sc-tag is-ask">{team ? t('schedule.asks.tag.from', { team }) : t('schedule.asks.tag.fromOther')}</span>
            {unanswered
              ? <span className="sc-tag is-late" data-testid="answer-ask-unanswered">{t('schedule.asks.tag.unanswered')}</span>
              : left && <span className="sc-tag is-clock" data-testid="answer-ask-left">{t('schedule.asks.tag.left', { h: left.h, m: left.m })}</span>}
          </p>
          <h2 id="answer-ask-title" className="sc-answer-title">
            {ask.hours != null ? t('schedule.asks.answer.title', { name: askerName, count: ask.hours, task: ask.taskTitle }) : t('schedule.asks.answer.titleNoHours', { name: askerName, task: ask.taskTitle })}
          </h2>
          <p className="sc-answer-sub">{[ask.pieceName, ask.campaignName, t('schedule.asks.neededBy', { day: dayLong(askedDay, lang) })].filter(Boolean).join(' · ')}</p>
          <IconButton icon="close" label={t('schedule.sc.close')} className="sc-book-x" onClick={onClose} data-testid="answer-ask-close" />
        </header>

        <div className="sc-answer-note">
          {ask.note && <p className="sc-answer-quote">“{ask.note}”</p>}
          <p className="sc-answer-meta">
            <span>{[ask.requesterName ?? '', formatIraqDateTime(ask.createdAt, lang === 'ar' ? 'ar' : 'en')].filter(Boolean).join(' · ')}</span>
            {ask.deliverableId && (
              <>
                <button type="button" className="sc-link" onClick={() => setShow(show === 'brief' ? null : 'brief')} data-testid="answer-ask-brief">{t('schedule.asks.answer.readBrief')}</button>
                <button type="button" className="sc-link" onClick={() => setShow(show === 'files' ? null : 'files')} data-testid="answer-ask-files">
                  {t('schedule.asks.answer.files', { count: files.data?.files.length ?? 0 })}
                </button>
              </>
            )}
          </p>
          {ask.assigneeName && <p className="sc-answer-meta">{t('schedule.asks.answer.askedFor', { name: ask.assigneeName })}</p>}
        </div>
        {show === 'brief' && ask.deliverableId && <div className="sc-answer-tab"><PieceBriefTab deliverableId={ask.deliverableId} hours={ask.hours ?? 0} /></div>}
        {show === 'files' && ask.deliverableId && <div className="sc-answer-tab"><PieceFilesTab deliverableId={ask.deliverableId} pieceName={ask.pieceName ?? ''} /></div>}

        <div className="sc-answer-form">
          <span className="sc-answer-label">{t('schedule.asks.answer.who')}</span>
          <button type="button" className={`sc-field is-wide${chosen ? ' is-set' : ''}`} onClick={(e) => setWhoAnchor(e.currentTarget)} data-testid="answer-ask-who">
            {chosen ? (
              <>
                <Avatar id={chosen.id} name={chosen.name} size={18} />
                <span className="sc-field-text">
                  <span className="sc-field-main">{chosen.name}</span>
                  <span className="sc-field-sub">{[chosen.jobTitle, freeOnTo ? (freeOnTo.state === 'free' ? t('schedule.asks.answer.freeOn', { n: freeOnTo.freeHours, day: weekdayName(to, lang).slice(0, lang === 'ar' ? undefined : 3) }) : t(`schedule.sc.cell.${freeOnTo.state}`, { n: freeOnTo.overHours })) : null].filter(Boolean).join(' · ')}</span>
                </span>
              </>
            ) : <span className="sc-field-ph">{t('schedule.sc.pickPerson')}</span>}
            <span className="sc-caret" aria-hidden="true">▾</span>
          </button>

          <span className="sc-answer-label">{t('schedule.asks.answer.dates')}</span>
          <span className="sc-answer-dates">
            <label><span>{t('schedule.asks.answer.from')}</span>
              <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value) }} data-testid="answer-ask-from" /></label>
            <label><span>{t('schedule.asks.answer.to')}</span>
              <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} data-testid="answer-ask-to" /></label>
          </span>

          <span className="sc-answer-label">{t('schedule.sc.col.hours')}</span>
          <span className="sc-stepper" role="group" aria-label={t('schedule.sc.col.hours')}>
            <button type="button" aria-label={t('schedule.sc.less')} onClick={() => setHours((h) => Math.max(0.5, h - 1))} data-testid="answer-ask-less">−</button>
            <span data-testid="answer-ask-hours">{t('schedule.sc.hours', { n: hours })}</span>
            <button type="button" aria-label={t('schedule.sc.more')} onClick={() => setHours((h) => h + 1)} data-testid="answer-ask-more">+</button>
          </span>
        </div>

        {to === askedDay
          ? <p className="sc-answer-ok" data-testid="answer-ask-day-ok">✓ {t('schedule.asks.answer.dayAsked', { day: dayLong(askedDay, lang), name: askerName })}</p>
          : <p className="sc-answer-warn" data-testid="answer-ask-day-off">{t('schedule.asks.answer.dayOther', { day: dayLong(askedDay, lang), name: askerName })}</p>}
        <p className="sc-answer-foot">{chosen ? t('schedule.asks.answer.whatHappens', { name: chosenName, asker: askerName }) : t('schedule.asks.answer.whatHappensNoName', { asker: askerName })}</p>

        {saying === 'no' && (
          <div className="sc-answer-no">
            <label className="sc-answer-label" htmlFor="answer-ask-reason">{t('schedule.asks.answer.why')}</label>
            <textarea id="answer-ask-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500}
              placeholder={t('schedule.asks.answer.whyPh')} data-testid="answer-ask-reason" autoFocus />
          </div>
        )}
        {error && <p className="form-error" role="alert" data-testid="answer-ask-error">{error}</p>}

        <footer className="sc-answer-actions">
          {saying === 'no' ? (
            <>
              <Button variant="primary" tone="caution" busy={answer.isPending} onClick={() => void act('refuse')} data-testid="answer-ask-no-send">{t('schedule.asks.answer.sayNoSend', { name: askerName })}</Button>
              <Button variant="link" onClick={() => { setSaying(null); setReason('') }} data-testid="answer-ask-no-cancel">{t('schedule.cancel')}</Button>
            </>
          ) : (
            <>
              <Button variant="primary" busy={answer.isPending && answer.variables?.answer === 'book'} disabled={answer.isPending} onClick={() => void act('book')} data-testid="answer-ask-book">
                {chosen ? t('schedule.asks.answer.book', { name: chosenName }) : t('schedule.asks.answer.bookNoName')}
              </Button>
              <Button variant="secondary" busy={answer.isPending && answer.variables?.answer === 'offer'} disabled={answer.isPending} onClick={() => void act('offer')} data-testid="answer-ask-offer">
                {t('schedule.asks.answer.offer')}
              </Button>
              <span className="sc-grow" />
              <Button variant="link" tone="caution" onClick={() => setSaying('no')} data-testid="answer-ask-no">{t('schedule.asks.answer.sayNo')}</Button>
            </>
          )}
        </footer>
      </div>
      {whoAnchor && (
        <Popover anchor={whoAnchor} onClose={() => setWhoAnchor(null)} width={300} testId="answer-ask-who-pop">
          <PeoplePicker people={options} selectedId={resourceId} onPick={(rid) => { setResourceId(rid); setWhoAnchor(null) }} testId="answer-ask-who-list" />
        </Popover>
      )}
    </Modal>
  )
}
