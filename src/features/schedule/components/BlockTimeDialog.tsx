import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from '../../../components/Button'
import { Modal } from '../../../components/Modal'
import { useAuth } from '../../../app/auth-context'
import { usePermissions } from '../../../app/permissions'
import { iraqDay } from '../../../lib/time/iraq'
import { refusalSentence } from '../../../lib/errors/classify'
import { resourceInSchedulingScope, resourceInWriteScope } from '../lib/write-scope.ts'
import { useBlockTime } from '../api/book-api'
import type { ScheduleResource } from '../api/schedule-api'
import { dayLong, dayRange, weekdayName } from '../lib/day-words.ts'
import { sundayOfIso, usePeopleWeek } from '../hooks/use-people-week'
import { Avatar } from './Avatar'
import { DatesPicker } from './DatesPicker'
import { PeoplePicker } from './PeoplePicker'
import { Popover } from './Popover'

/**
 * "Block time on someone's week" (I74.25, Figma L SC-22, mock-up 8): Leave or Internal work — "Amend
 * on delivered work" is gone (ADR-0142 d.4: an amend re-opens the task). Leave is who and which days;
 * internal work also says what for and how many hours, and counts in the person's day rather than blocking it.
 *
 * Who may (ADR-0139 d.7 addendum, Edward 3 Oct): a lead blocks time — leave included — for the people she leads, from
 * here, without the leave grant: whoever may book (`bookings:create`) reaches her SCHEDULING reach (a team lead her
 * team, a department lead his department, Traffic and the Power Admin everyone). The leave lands as the row the Leave
 * page reads. HR holders of `leave:manage` (and `blackouts:manage` for internal work) keep their write reach. The
 * server's policies decide; this only chooses whom to offer.
 *
 * Who and the dates are the Schedule's own pickers (I74.27, SC-22) — the ones a task's Edit uses — never the
 * browser's boxes. A past day stays pickable: leave is also recorded after the fact.
 */
export function BlockTimeDialog({
  people,
  initialDay,
  onClose,
  onDone,
}: {
  people: ScheduleResource[]
  initialDay: string | null
  onClose: () => void
  onDone: (sentence: string) => void
}) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const { claims } = useAuth()
  const perms = usePermissions()
  const block = useBlockTime()
  const books = perms.can('bookings:create')
  const mayLeave = !perms.ready || perms.can('leave:manage') || books
  const mayInternal = !perms.ready || perms.can('blackouts:manage') || books
  const [kind, setKind] = useState<'leave' | 'internal'>(mayLeave || !mayInternal ? 'leave' : 'internal')
  // Whom each grant reaches: booking over the scheduling reach (both kinds); the leave grant (leave) or the blackout
  // grant (internal) over the write scope.
  const reach = useMemo(() => people.filter((r) => {
    if (r.kind !== 'human') return false
    if (!perms.ready) return true
    if (books && resourceInSchedulingScope(r, perms)) return true
    const grant = kind === 'leave' ? perms.can('leave:manage') : perms.can('blackouts:manage')
    return grant && resourceInWriteScope(r, perms)
  }), [people, perms, books, kind])
  const [resourceId, setResourceId] = useState<string>(reach[0]?.id ?? '')
  const day = initialDay ?? iraqDay(Date.now())
  const [from, setFrom] = useState(day)
  const [to, setTo] = useState(day)
  const [hours, setHours] = useState(1)
  const [what, setWhat] = useState('')
  const [error, setError] = useState<string | null>(null)
  // The calendar keeps the weeks it opened on: a pick must not move the days under the pointer.
  const [open, setOpen] = useState<{ kind: 'who' | 'dates'; anchor: HTMLElement; sunday: string } | null>(null)
  const who = reach.find((r) => r.id === resourceId) ?? reach[0] ?? null
  const week = usePeopleWeek(sundayOfIso(from))
  const { optionsFor } = week
  const options = useMemo(() => optionsFor(reach), [optionsFor, reach])
  const free = who ? options.find((o) => o.resource.id === who.id)?.freeHours ?? null : null

  async function save() {
    setError(null)
    if (!who) return setError(t('schedule.block.whoRequired'))
    if (to < from) return setError(t('leave.endBeforeStart'))
    if (kind === 'internal' && !what.trim()) return setError(t('schedule.block.whatRequired'))
    try {
      await block.mutateAsync({ tenantId: claims.tenantId ?? '', resourceId: who.id, kind, from, to, hours: kind === 'internal' ? hours : null, reason: kind === 'internal' ? what : null })
      onDone(kind === 'leave'
        ? t('schedule.block.doneLeave', { name: who.name, days: from === to ? dayLong(from, lang) : `${dayLong(from, lang)} – ${dayLong(to, lang)}` })
        : t('schedule.block.doneInternal', { name: who.name, hours, what: what.trim() }))
      onClose()
    } catch (e) {
      setError(refusalSentence(e as { code?: string; message?: string }) ?? (e as { message?: string }).message ?? t('leave.saveFailed'))
    }
  }

  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
  return (
    <Modal onClose={onClose} labelledById="block-time-title" testId="block-time">
      <div className="sc-answer sc-block">
        <header className="sc-answer-head">
          <p className="sc-answer-tags"><span className="sc-tag">{t('schedule.block.eyebrow')}</span></p>
          <h2 id="block-time-title" className="sc-answer-title">{t('schedule.block.title')}</h2>
          <p className="sc-answer-sub">{t('schedule.block.sub')}</p>
          <IconButton icon="close" label={t('schedule.sc.close')} className="sc-book-x" onClick={onClose} data-testid="block-time-close" />
        </header>
        <div className="sc-answer-form">
          <span className="sc-answer-label">{t('schedule.block.what')}</span>
          <span className="sc-seg" role="radiogroup" aria-label={t('schedule.block.what')}>
            {mayLeave && (
              <button type="button" role="radio" aria-checked={kind === 'leave'} className={kind === 'leave' ? 'is-on' : ''} onClick={() => setKind('leave')} data-testid="block-time-leave">{t('schedule.block.leave')}</button>
            )}
            {mayInternal && (
              <button type="button" role="radio" aria-checked={kind === 'internal'} className={kind === 'internal' ? 'is-on' : ''} onClick={() => setKind('internal')} data-testid="block-time-internal">{t('schedule.block.internal')}</button>
            )}
          </span>

          {kind === 'internal' && (
            <>
              <label className="sc-answer-label" htmlFor="block-time-what">{t('schedule.block.whatFor')}</label>
              <input id="block-time-what" className="sc-input" value={what} onChange={(e) => setWhat(e.target.value)} maxLength={200}
                placeholder={t('schedule.block.whatForPh')} data-testid="block-time-what" />
            </>
          )}

          <span className="sc-answer-label">{t('schedule.block.who')}</span>
          <button type="button" className={`sc-field is-wide${who ? ' is-set' : ''}${open?.kind === 'who' ? ' is-open' : ''}`}
            onClick={(e) => setOpen({ kind: 'who', anchor: e.currentTarget, sunday: sundayOfIso(from) })} data-testid="block-time-who">
            {who ? (
              <>
                <Avatar id={who.id} name={who.name} size={18} />
                <span className="sc-field-text">
                  <span className="sc-field-main">{who.name}</span>
                  <span className="sc-field-sub">{[who.jobTitle, free != null ? t('schedule.sc.freeThisWeek', { n: free }) : null].filter(Boolean).join(' · ')}</span>
                </span>
              </>
            ) : <span className="sc-field-ph">{t('schedule.block.nobody')}</span>}
            <span className="sc-caret" aria-hidden="true">▾</span>
          </button>

          <span className="sc-answer-label">{t('schedule.asks.answer.dates')}</span>
          <button type="button" className={`sc-field sc-field-dates is-wide is-set${open?.kind === 'dates' ? ' is-open' : ''}`}
            onClick={(e) => setOpen({ kind: 'dates', anchor: e.currentTarget, sunday: sundayOfIso(from) })} data-testid="block-time-dates">
            <span className="sc-field-main">{dayRange(from, to, lang)}</span>
            <span className="sc-caret" aria-hidden="true">▾</span>
          </button>

          {kind === 'internal' && (
            <>
              <span className="sc-answer-label">{t('schedule.sc.col.hours')}</span>
              <span className="sc-stepper" role="group" aria-label={t('schedule.sc.col.hours')}>
                <button type="button" aria-label={t('schedule.sc.less')} onClick={() => setHours((h) => Math.max(0.5, h - 0.5))} data-testid="block-time-less">−</button>
                <span data-testid="block-time-hours">{t('schedule.sc.hours', { n: hours })}</span>
                <button type="button" aria-label={t('schedule.sc.more')} onClick={() => setHours((h) => h + 0.5)} data-testid="block-time-more">+</button>
              </span>
            </>
          )}
        </div>
        {error && <p className="form-error" role="alert" data-testid="block-time-error">{error}</p>}
        <footer className="sc-answer-actions">
          <Button variant="primary" busy={block.isPending} disabled={!who} onClick={() => void save()} data-testid="block-time-save">
            {days === 1 ? t('schedule.block.saveDay', { day: weekdayName(from, lang) }) : t('schedule.block.saveDays', { count: days })}
          </Button>
          <Button variant="link" onClick={onClose} data-testid="block-time-cancel">{t('schedule.cancel')}</Button>
          <span className="sc-grow" />
          <span className="sc-foot-note">{kind === 'leave' ? t('schedule.block.leaveNote') : t('schedule.block.internalNote')}</span>
        </footer>
      </div>
      {open?.kind === 'who' && (
        <Popover anchor={open.anchor} onClose={() => setOpen(null)} width={320} testId="block-time-who-pop">
          <PeoplePicker people={options} selectedId={who?.id ?? null} onPick={(rid) => { setResourceId(rid); setOpen(null) }} testId="block-time-people" />
        </Popover>
      )}
      {open?.kind === 'dates' && (
        <Popover anchor={open.anchor} onClose={() => setOpen(null)} width={360} testId="block-time-dates-pop">
          <DatesPicker
            personName={who?.name ?? null}
            startSunday={open.sunday}
            from={from}
            to={to}
            hours={0}
            dueIso={null}
            todayIso=""
            workingWeekdays={week.workingCols(who?.id ?? null)}
            isWorking={(iso) => (who ? week.isWorking(who.id, iso) : true)}
            loadOn={(iso) => (who ? week.loadOn(who.id, iso) : null)}
            onChange={(f, tt) => { setFrom(f); setTo(tt) }}
            onDone={() => setOpen(null)}
            testId="block-time-dates-picker"
          />
        </Popover>
      )}
    </Modal>
  )
}
