import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { Button } from '../../../components/Button'
import { iraqDay, formatIraqDate } from '../../../lib/time/iraq'
import { namedRefusal, refusalSentence } from '../../../lib/errors/classify'
import { askHintKey, isUnanswered, timeLeftToAnswer, type TaskAsk } from '../../../lib/task-asks/asks'
import { useAnswerTaskRequest, useAskRuleHours, useAsksToAnswer } from '../../../lib/task-asks/api'

/**
 * "Asks from other teams" on a lead's My work (I74.26, Figma L SC-28): on top, each with the time left
 * before it goes to Traffic (ADR-0139 d.5). Answering opens the Schedule with the ask ready — she picks
 * who and the day there (SC-29); "Say no…" answers here, with the reason the asker will read.
 * After the wait, Traffic and the department lead see the same card, marked unanswered (mock-up 2).
 * The list is the server's own (`my_pending_approvals`), so who sees a card is who may answer it.
 */
export function AsksFromOtherTeams() {
  const { t, i18n } = useTranslation()
  const loc = i18n.language.startsWith('ar') ? 'ar' : 'en'
  const asks = useAsksToAnswer({ live: true })
  const rule = useAskRuleHours()
  const list = asks.data ?? []
  if (list.length === 0) return null
  return (
    <section className="mw-asks" aria-labelledby="mw-asks-title" data-testid="my-work-asks">
      <h2 id="mw-asks-title" className="mw-asks-title">{t('myWork.asks.title', { count: list.length })}</h2>
      {list.map((a) => <AskCard key={a.id} ask={a} ruleHours={rule.data ?? null} loc={loc} />)}
    </section>
  )
}

function AskCard({ ask, ruleHours, loc }: { ask: TaskAsk; ruleHours: number | null; loc: 'ar' | 'en' }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const answer = useAnswerTaskRequest()
  const [saying, setSaying] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const left = timeLeftToAnswer(ask.createdAt, ruleHours)
  const late = isUnanswered(ask, ruleHours)
  const askerName = ask.requesterName ?? ''
  const by = ask.neededBy ?? (ask.dueAt ? iraqDay(ask.dueAt) : null)

  async function sayNo() {
    setError(null)
    if (!reason.trim()) return setError(t('schedule.asks.hint.reason_required'))
    try {
      await answer.mutateAsync({ requestId: ask.id, answer: 'refuse', note: reason })
    } catch (e) {
      const hk = askHintKey(e)
      setError((hk ? t(hk) : null) ?? namedRefusal(e, t) ?? refusalSentence(e as { code?: string; message?: string }) ?? (e as { message?: string }).message ?? t('schedule.asks.failed'))
    }
  }

  return (
    <article className={`mw-ask${late ? ' is-late' : ''}`} data-testid={`my-work-ask-${ask.id}`}>
      <p className="mw-ask-tags">
        <span className="sc-tag is-ask">{ask.requesterTeamName ? t('schedule.asks.tag.from', { team: ask.requesterTeamName }) : t('schedule.asks.tag.fromOther')}</span>
        {late
          ? <span className="sc-tag is-late" data-testid={`my-work-ask-late-${ask.id}`}>{t('schedule.asks.tag.unanswered')}</span>
          : left && <span className="sc-tag is-clock" data-testid={`my-work-ask-left-${ask.id}`}>{t('schedule.asks.tag.left', { h: left.h, m: left.m })}</span>}
      </p>
      <h3 className="mw-ask-title">
        {ask.hours != null ? t('schedule.asks.answer.title', { name: askerName, count: ask.hours, task: ask.taskTitle }) : t('schedule.asks.answer.titleNoHours', { name: askerName, task: ask.taskTitle })}
      </h3>
      <p className="mw-ask-meta">
        {[ask.pieceName, ask.campaignName, by ? t('schedule.asks.neededBy', { day: formatIraqDate(`${by}T12:00:00Z`, loc) }) : null,
          ask.assigneeName ? t('schedule.asks.answer.askedFor', { name: ask.assigneeName }) : null].filter(Boolean).join(' · ')}
      </p>
      {ask.note && <p className="mw-ask-note">“{ask.note}”</p>}
      {saying ? (
        <div className="mw-ask-no">
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus
            placeholder={t('schedule.asks.answer.whyPh')} aria-label={t('schedule.asks.answer.why')} data-testid={`my-work-ask-reason-${ask.id}`} />
          <Button variant="primary" size="sm" tone="caution" busy={answer.isPending} onClick={() => void sayNo()} data-testid={`my-work-ask-no-send-${ask.id}`}>
            {t('schedule.asks.answer.sayNoSend', { name: askerName })}
          </Button>
          <Button variant="link" size="sm" onClick={() => { setSaying(false); setReason('') }} data-testid={`my-work-ask-no-cancel-${ask.id}`}>{t('schedule.cancel')}</Button>
        </div>
      ) : (
        <div className="mw-ask-actions">
          <Button variant="primary" size="sm" onClick={() => navigate(`/schedule?ask=${ask.id}`)} data-testid={`my-work-ask-answer-${ask.id}`}>{t('myWork.asks.answer')}</Button>
          {ask.deliverableId && ask.campaignId && (
            <Link className="btn btn-secondary btn-sm" to={`/campaigns/${ask.campaignId}?piece=${ask.deliverableId}&task=${ask.subTaskId}`} data-testid={`my-work-ask-brief-${ask.id}`}>{t('myWork.asks.brief')}</Link>
          )}
          <Button variant="link" size="sm" tone="caution" onClick={() => setSaying(true)} data-testid={`my-work-ask-no-${ask.id}`}>{t('myWork.asks.sayNo')}</Button>
          <span className="mw-ask-hint">{t('myWork.asks.hint')}</span>
        </div>
      )}
      {error && <p className="form-error" role="alert" data-testid={`my-work-ask-error-${ask.id}`}>{error}</p>}
    </article>
  )
}
