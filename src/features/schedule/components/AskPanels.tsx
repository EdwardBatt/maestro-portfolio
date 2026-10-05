import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from '../../../components/Button'
import { Modal } from '../../../components/Modal'
import { iraqDay } from '../../../lib/time/iraq'
import { namedRefusal, refusalSentence } from '../../../lib/errors/classify'
import { translateScheduleWarning } from '../../../lib/bookings/schedule-outcome'
import {
  askCardState,
  askHintKey,
  asksToShow,
  isUnanswered,
  timeAskAgainstDue,
  timeLeftToAnswer,
  type TaskAsk,
  type TimeAsk,
} from '../../../lib/task-asks/asks'
import { useAnswerMoreTime, useAskRuleHours, useTakeTaskOffer, useWithdrawTaskAsk } from '../../../lib/task-asks/api'
import { dayLong, weekdayName } from '../lib/day-words.ts'
import { taskWithPiece } from '../lib/task-title.ts'

/** How long ago, in the card's words ("just now", "20 min ago", "3h ago", "2 days ago"). */
function useAgo() {
  const { t } = useTranslation()
  return (at: string) => {
    const mins = Math.max(0, Math.floor((Date.now() - Date.parse(at)) / 60_000))
    if (mins < 2) return t('schedule.asks.ago.now')
    if (mins < 60) return t('schedule.asks.ago.min', { n: mins })
    const h = Math.floor(mins / 60)
    if (h < 48) return t('schedule.asks.ago.hour', { n: h })
    return t('schedule.asks.ago.day', { count: Math.floor(h / 24) })
  }
}

function useErrorWords() {
  const { t } = useTranslation()
  return (e: unknown) => {
    const hk = askHintKey(e)
    return (hk ? t(hk) : null) ?? namedRefusal(e, t) ?? refusalSentence(e as { code?: string; message?: string }) ?? (e as { message?: string }).message ?? t('schedule.asks.failed')
  }
}

const short = (iso: string, lang: string) => (lang === 'ar' ? weekdayName(iso, lang) : weekdayName(iso, lang).slice(0, 3))

/**
 * "Asks from other teams" (SC-29): what other teams asked of the viewer's people, on top of the left
 * column — the server's own list of what she answers. After the wait (ADR-0139 d.5) Traffic and the
 * department lead see the same card, marked unanswered.
 */
export function AsksFromTeamsSection({ asks, onOpen }: { asks: TaskAsk[]; onOpen: (ask: TaskAsk) => void }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const rule = useAskRuleHours()
  const ago = useAgo()
  if (asks.length === 0) return null
  return (
    <section className="sc-side-section" aria-labelledby="asks-from-title" data-testid="asks-from-teams">
      <h2 id="asks-from-title" className="sc-tobook-title">
        {t('schedule.asks.from.title')} <span className="sc-count is-ask" data-testid="asks-from-count">{asks.length}</span>
      </h2>
      <ul className="sc-cards">
        {asks.map((a) => {
          const late = isUnanswered(a, rule.data)
          const by = a.neededBy ?? (a.dueAt ? iraqDay(a.dueAt) : null)
          return (
            <li key={a.id}>
              <button type="button" className={`sc-card sc-ask-card is-from${late ? ' is-late' : ''}`} onClick={() => onOpen(a)} data-testid={`ask-from-${a.id}`}>
                <span className="sc-card-top">
                  <span className="sc-card-client">{[a.requesterName, a.requesterTeamName].filter(Boolean).join(' · ')}</span>
                  {late && <span className="sc-ask-state is-late">{t('schedule.asks.tag.unanswered')}</span>}
                </span>
                <span className="sc-card-name">{taskWithPiece(a.taskTitle ?? '', a.pieceName)}</span>
                <span className="sc-card-meta">
                  {[a.campaignName, a.hours != null && by ? t('schedule.asks.hoursBy', { n: a.hours, day: short(by, lang) }) : null, t('schedule.asks.asked', { ago: ago(a.createdAt) })].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * "Asked of other teams" (SC-18, SC-19, SC-30): the viewer's asks and their answers — Waiting (see it,
 * withdraw), Offer (take the day, or ask again), No (ask another team, or do it in your team), Booked
 * (OK puts it away). Every answer also reaches her notifications (ADR-0139 d.4).
 */
export function AskedOfTeamsSection({
  asks,
  dismissed,
  onDismiss,
  onSee,
  onAskAgain,
  onSaid,
}: {
  asks: TaskAsk[]
  dismissed: ReadonlySet<string>
  onDismiss: (id: string) => void
  onSee: (ask: TaskAsk) => void
  /** open the piece's booking window again — to ask another team, or to do it in the viewer's own */
  onAskAgain: (ask: TaskAsk) => void
  onSaid: (sentence: string) => void
}) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const ago = useAgo()
  const errorWords = useErrorWords()
  const withdraw = useWithdrawTaskAsk()
  const take = useTakeTaskOffer()
  const [error, setError] = useState<{ id: string; text: string } | null>(null)
  const shown = asksToShow(asks, dismissed)
  if (shown.length === 0) return null

  const run = async (id: string, f: () => Promise<unknown>) => {
    setError(null)
    try { await f() } catch (e) { setError({ id, text: errorWords(e) }) }
  }

  return (
    <section className="sc-side-section" aria-labelledby="asked-of-title" data-testid="asked-of-teams">
      <h2 id="asked-of-title" className="sc-tobook-title">
        {t('schedule.asks.sent.title')} <span className="sc-count is-ask" data-testid="asked-of-count">{shown.length}</span>
      </h2>
      <ul className="sc-cards">
        {shown.map((a) => {
          const state = askCardState(a)
          const by = a.neededBy ?? (a.dueAt ? iraqDay(a.dueAt) : null)
          const answerer = a.answeredByName ?? null
          const offerDay = a.offeredEndsAt ? iraqDay(a.offeredEndsAt) : null
          const bookedDay = a.dueAt ? iraqDay(a.dueAt) : by
          let line: string
          switch (state) {
            case 'waiting':
              line = [a.teamName, a.assigneeName ? t('schedule.asks.sent.askedFor', { name: a.assigneeName }) : null, t('schedule.asks.asked', { ago: ago(a.createdAt) }),
                a.hours != null && by ? t('schedule.asks.hoursBy', { n: a.hours, day: dayLong(by, lang) }) : null].filter(Boolean).join(' · ')
              break
            case 'offer':
              line = t('schedule.asks.sent.offerLine', { who: answerer ?? '', day: offerDay ? dayLong(offerDay, lang) : '', was: by ? dayLong(by, lang) : '', person: a.assigneeName ?? '', n: a.hours ?? 0 })
              break
            case 'booked':
              line = t('schedule.asks.sent.bookedLine', { who: answerer ?? '', person: a.assigneeName ?? '', day: bookedDay ? dayLong(bookedDay, lang) : '', n: a.hours ?? 0 })
              break
            default:
              line = a.answerNote ? t('schedule.asks.sent.noLine', { who: answerer ?? '', reason: a.answerNote }) : t('schedule.asks.sent.noLineBare', { who: answerer ?? '' })
          }
          return (
            <li key={a.id}>
              <div className={`sc-ask-card is-${state}`} data-testid={`ask-sent-${a.id}`}>
                <span className="sc-card-top">
                  <span className="sc-card-name">{taskWithPiece(a.taskTitle ?? '', a.pieceName)}</span>
                  <span className={`sc-ask-state is-${state}`} data-testid={`ask-sent-state-${a.id}`}>{t(`schedule.asks.state.${state}`)}</span>
                </span>
                <span className="sc-card-meta">{line}</span>
                <span className="sc-ask-actions">
                  {state === 'waiting' && (
                    <>
                      <Button variant="link" size="sm" onClick={() => onSee(a)} data-testid={`ask-see-${a.id}`}>{t('schedule.asks.sent.see')}</Button>
                      <Button variant="link" size="sm" tone="caution" busy={withdraw.isPending && withdraw.variables === a.id}
                        onClick={() => void run(a.id, async () => { await withdraw.mutateAsync(a.id); onSaid(t('schedule.asks.sent.withdrawn', { task: a.taskTitle })) })}
                        data-testid={`ask-withdraw-${a.id}`}>{t('schedule.asks.sent.withdraw')}</Button>
                    </>
                  )}
                  {state === 'offer' && (
                    <>
                      <Button variant="primary" size="sm" busy={take.isPending && take.variables === a.id}
                        onClick={() => void run(a.id, async () => {
                          const r = await take.mutateAsync(a.id)
                          onSaid(t('schedule.asks.sent.taken', { task: a.taskTitle, day: offerDay ? dayLong(offerDay, lang) : '' }) + (r.scheduleWarning ? ` ${translateScheduleWarning(t, r.scheduleWarning) ?? ''}` : ''))
                        })}
                        data-testid={`ask-take-${a.id}`}>{t('schedule.asks.sent.take', { day: offerDay ? short(offerDay, lang) : '' })}</Button>
                      <Button variant="secondary" size="sm"
                        onClick={() => void run(a.id, async () => { await withdraw.mutateAsync(a.id); onAskAgain(a) })}
                        data-testid={`ask-again-${a.id}`}>{t('schedule.asks.sent.again')}</Button>
                    </>
                  )}
                  {state === 'no' && (
                    <>
                      <Button variant="secondary" size="sm" onClick={() => { onDismiss(a.id); onAskAgain(a) }} data-testid={`ask-other-${a.id}`}>{t('schedule.asks.sent.another')}</Button>
                      <Button variant="link" size="sm" onClick={() => { onDismiss(a.id); onAskAgain(a) }} data-testid={`ask-own-${a.id}`}>{t('schedule.asks.sent.own')}</Button>
                    </>
                  )}
                  {state === 'booked' && (
                    <Button variant="secondary" size="sm" onClick={() => onDismiss(a.id)} data-testid={`ask-ok-${a.id}`}>{t('schedule.asks.sent.ok')}</Button>
                  )}
                </span>
                {error?.id === a.id && <span className="form-error" role="alert" data-testid={`ask-error-${a.id}`}>{error.text}</span>}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * "Asks" (SC-01, mock-up 9): a maker of the viewer's team asks for more time. Give it (her task's due
 * day moves) or say no with a reason. A yes that runs past the piece's due date opens the one change
 * form to the account manager, filled in (ADR-0141 d.5) — `onPastDue`.
 */
export function TimeAsksSection({
  asks,
  onSaid,
  onPastDue,
}: {
  asks: TimeAsk[]
  onSaid: (sentence: string) => void
  onPastDue: (ask: TimeAsk) => void
}) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const answer = useAnswerMoreTime()
  const errorWords = useErrorWords()
  const [saying, setSaying] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<{ id: string; text: string } | null>(null)
  if (asks.length === 0) return null

  async function give(a: TimeAsk, yes: boolean) {
    setError(null)
    if (!yes && !reason.trim()) return setError({ id: a.id, text: t('schedule.asks.hint.reason_required') })
    try {
      const r = await answer.mutateAsync({ askId: a.id, give: yes, note: yes ? null : reason })
      const first = a.askerName ?? ''
      if (yes && r.pastPieceDue) onPastDue(a)
      onSaid(yes
        ? t('schedule.asks.time.given', { name: first, day: dayLong(a.toDay, lang) }) + (r.scheduleWarning ? ` ${translateScheduleWarning(t, r.scheduleWarning) ?? ''}` : '')
        : t('schedule.asks.time.refused', { name: first }))
      setSaying(null)
      setReason('')
    } catch (e) {
      setError({ id: a.id, text: errorWords(e) })
    }
  }

  return (
    <section className="sc-side-section" aria-labelledby="time-asks-title" data-testid="time-asks">
      <h2 id="time-asks-title" className="sc-tobook-title">
        {t('schedule.asks.time.title')} <span className="sc-count is-warn" data-testid="time-asks-count">{asks.length}</span>
      </h2>
      <ul className="sc-cards">
        {asks.map((a) => {
          const first = a.askerName ?? ''
          const vs = timeAskAgainstDue(a)
          const day = weekdayName(a.toDay, lang)
          return (
            <li key={a.id}>
              <div className="sc-ask-card is-time" data-testid={`time-ask-${a.id}`}>
                <span className="sc-card-name">{t('schedule.asks.time.wants', { name: first, day })}</span>
                <span className="sc-card-meta">
                  {[a.pieceName ?? a.taskTitle, a.note ? `“${a.note}”` : null].filter(Boolean).join(' · ')}
                  {vs !== 'none' && <> {t(`schedule.asks.time.vs.${vs}`, { day })}</>}
                </span>
                {saying === a.id ? (
                  <span className="sc-ask-no">
                    <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoFocus
                      placeholder={t('schedule.asks.time.whyPh', { name: first })} aria-label={t('schedule.asks.answer.why')} data-testid={`time-ask-reason-${a.id}`} />
                    <span className="sc-ask-actions">
                      <Button variant="primary" size="sm" tone="caution" busy={answer.isPending} onClick={() => void give(a, false)} data-testid={`time-ask-no-send-${a.id}`}>{t('schedule.asks.time.noSend')}</Button>
                      <Button variant="link" size="sm" onClick={() => { setSaying(null); setReason('') }} data-testid={`time-ask-no-cancel-${a.id}`}>{t('schedule.cancel')}</Button>
                    </span>
                  </span>
                ) : (
                  <span className="sc-ask-actions">
                    <Button variant="primary" size="sm" busy={answer.isPending && answer.variables?.askId === a.id && answer.variables.give}
                      onClick={() => void give(a, true)} data-testid={`time-ask-give-${a.id}`}>{t('schedule.asks.time.give', { name: first, day: short(a.toDay, lang) })}</Button>
                    <Button variant="secondary" size="sm" onClick={() => setSaying(a.id)} data-testid={`time-ask-no-${a.id}`}>{t('schedule.asks.time.no')}</Button>
                  </span>
                )}
                {error?.id === a.id && <span className="form-error" role="alert" data-testid={`time-ask-error-${a.id}`}>{error.text}</span>}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** "See the ask" (SC-19): what was sent, to whom, and when it goes to Traffic if nobody answers. */
export function SeeAskDialog({ ask, onClose, onWithdraw }: { ask: TaskAsk; onClose: () => void; onWithdraw: () => void }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const rule = useAskRuleHours()
  const ago = useAgo()
  const left = timeLeftToAnswer(ask.createdAt, rule.data)
  const by = ask.neededBy ?? (ask.dueAt ? iraqDay(ask.dueAt) : null)
  return (
    <Modal onClose={onClose} labelledById="see-ask-title" testId="see-ask">
      <div className="sc-answer">
        <header className="sc-answer-head">
          <p className="sc-answer-tags"><span className="sc-ask-state is-waiting">{t('schedule.asks.state.waiting')}</span></p>
          <h2 id="see-ask-title" className="sc-answer-title">{taskWithPiece(ask.taskTitle ?? '', ask.pieceName)}</h2>
          <p className="sc-answer-sub">{[ask.campaignName, ask.hours != null && by ? t('schedule.asks.hoursBy', { n: ask.hours, day: dayLong(by, lang) }) : null].filter(Boolean).join(' · ')}</p>
          <IconButton icon="close" label={t('schedule.sc.close')} className="sc-book-x" onClick={onClose} data-testid="see-ask-close" />
        </header>
        <dl className="sc-see-ask">
          <dt>{t('schedule.asks.row.team')}</dt><dd>{ask.teamName ?? '—'}</dd>
          <dt>{t('schedule.asks.row.who')}</dt><dd>{ask.assigneeName ?? t('schedule.asks.row.anyoneNoName')}</dd>
          {ask.note && <><dt>{t('schedule.asks.row.noteLabel')}</dt><dd>“{ask.note}”</dd></>}
          <dt>{t('schedule.asks.see.sent')}</dt><dd>{ago(ask.createdAt)}</dd>
        </dl>
        <p className="sc-answer-foot" data-testid="see-ask-clock">{left ? t('schedule.asks.see.goesIn', { h: left.h, m: left.m }) : t('schedule.asks.see.gone')}</p>
        <footer className="sc-answer-actions">
          <Button variant="secondary" onClick={onClose} data-testid="see-ask-done">{t('schedule.asks.sent.ok')}</Button>
          <span className="sc-grow" />
          <Button variant="link" tone="caution" onClick={onWithdraw} data-testid="see-ask-withdraw">{t('schedule.asks.sent.withdraw')}</Button>
        </footer>
      </div>
    </Modal>
  )
}
