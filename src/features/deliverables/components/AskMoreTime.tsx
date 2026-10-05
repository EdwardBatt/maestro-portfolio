import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { useAuth } from '../../../app/auth-context'
import { iraqDay, formatIraqDate } from '../../../lib/time/iraq'
import { namedRefusal, refusalSentence } from '../../../lib/errors/classify'
import { askHintKey } from '../../../lib/task-asks/asks'
import { useAskMoreTime, useMyLead, useMyTimeAsk, useWithdrawMoreTime } from '../../../lib/task-asks/api'

const DAY = 86_400_000
const isoPlus = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)

/**
 * "Ask Fadia for more time" (I74.17, mock-up 9, ADR-0141 d.5): the maker asks her own lead to move her
 * task's due day. It lands in the lead's Asks on the Schedule ("Zubaida wants Thursday too"); a yes that
 * runs past the piece's due date becomes the one change form to the account manager — asked once.
 * Replaces the per-task extension request, which no longer raises (hint `extension_retired`).
 */
export function AskMoreTime({ subTaskId, dueAt }: { subTaskId: string; dueAt: string | null }) {
  const { t, i18n } = useTranslation()
  const loc = i18n.language.startsWith('ar') ? 'ar' : 'en'
  const { session } = useAuth()
  const me = session?.user.id ?? null
  const lead = useMyLead(me)
  const latest = useMyTimeAsk(subTaskId, me)
  const ask = useAskMoreTime()
  const withdraw = useWithdrawMoreTime()
  const due = dueAt ? iraqDay(dueAt) : iraqDay(Date.now())
  const [open, setOpen] = useState(false)
  const [day, setDay] = useState(isoPlus(due, 1))
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const leadName = lead.data?.name ?? null
  const words = (iso: string) => formatIraqDate(`${iso}T12:00:00Z`, loc)

  const fail = (e: unknown) => {
    const hk = askHintKey(e)
    setError((hk ? t(hk) : null) ?? namedRefusal(e, t) ?? refusalSentence(e as { code?: string; message?: string }) ?? (e as { message?: string }).message ?? t('schedule.asks.failed'))
  }

  const pending = latest.data?.status === 'pending' ? latest.data : null
  if (pending) {
    return (
      <span className="task-more-time is-pending" data-testid="task-more-time-pending">
        <span>{leadName ? t('myWork.asks.time.waiting', { lead: leadName, day: words(pending.toDay) }) : t('myWork.asks.time.waitingNoName', { day: words(pending.toDay) })}</span>
        <Button variant="link" size="sm" tone="caution" busy={withdraw.isPending} onClick={() => withdraw.mutate(pending.id, { onError: fail })} data-testid="task-more-time-withdraw">
          {t('schedule.asks.sent.withdraw')}
        </Button>
        {error && <span className="form-error" role="alert">{error}</span>}
      </span>
    )
  }

  const answered = latest.data && (latest.data.status === 'given' || latest.data.status === 'refused') ? latest.data : null
  if (!open) {
    return (
      <>
        <Button variant="secondary" onClick={() => setOpen(true)} data-testid="task-more-time-open">
          {leadName ? t('myWork.asks.time.button', { lead: leadName }) : t('myWork.asks.time.buttonNoName')}
        </Button>
        {answered && (
          <span className="task-more-time-answer muted" data-testid="task-more-time-answer">
            {answered.status === 'given'
              ? t('myWork.asks.time.given', { day: words(answered.toDay) })
              : t('myWork.asks.time.refused', { reason: answered.answerNote ?? '' })}
          </span>
        )}
      </>
    )
  }

  return (
    <div className="task-more-time" data-testid="task-more-time">
      <label>
        <span className="field-label">{t('myWork.asks.time.until')}</span>
        <input type="date" value={day} min={isoPlus(due, 1)} onChange={(e) => setDay(e.target.value)} data-testid="task-more-time-day" />
      </label>
      <label>
        <span className="field-label">{t('myWork.asks.time.why')}</span>
        <textarea rows={2} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={t('myWork.asks.time.whyPh')} data-testid="task-more-time-note" />
      </label>
      {error && <p className="form-error" role="alert" data-testid="task-more-time-error">{error}</p>}
      <span className="task-more-time-actions">
        <Button variant="primary" busy={ask.isPending}
          onClick={() => { setError(null); ask.mutate({ subTaskId, toDay: day, note }, { onSuccess: () => setOpen(false), onError: fail }) }}
          data-testid="task-more-time-send">
          {leadName ? t('myWork.asks.time.button', { lead: leadName }) : t('myWork.asks.time.buttonNoName')}
        </Button>
        <Button variant="link" onClick={() => setOpen(false)} data-testid="task-more-time-cancel">{t('schedule.cancel')}</Button>
      </span>
    </div>
  )
}
