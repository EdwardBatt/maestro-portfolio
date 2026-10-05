import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { DateField } from '../../../components/DateField'
import { Modal } from '../../../components/Modal'
import { classifyWriteFailure } from '../../../lib/errors/classify'
import { formatCalendarDay, formatIraqDateTime, iraqDay } from '../../../lib/time/iraq'
import { useAnswerDeliverableChange, usePieceAskContext } from '../api/change-asks-api'
import { askRefusal, kindsToMakeInThePiece, type ChangeAskAnswer, type ChangeAskRow } from '../lib/change-ask'

/**
 * The account manager answers an ask (ADR-0141 d.4, I74.15) — from her Needs you, or from the piece.
 *
 * **Accept** applies what was asked: the due day moves (through the same write as her own edit, so the owner is told
 * and the deadline log keeps it) and the hours are recorded. **Change it** applies her own day and hours instead.
 * **Keep it as it is** needs her reason, which goes to the asker. The piece's assignees are told of an applied change.
 *
 * Only the due date is applied by an answer. Hours are recorded only (a deliverable has no hours of its own), and the
 * other kinds — format, language, quantity, the brief — are recorded too: she makes them in the piece herself, and the
 * dialog says so. The database decides who may answer and refuses anyone else in the account manager's name.
 */
export function ChangeAskAnswerDialog({
  ask,
  initialAnswer = 'accept',
  onClose,
  testId = 'change-answer',
}: {
  ask: ChangeAskRow
  initialAnswer?: ChangeAskAnswer
  onClose: () => void
  testId?: string
}) {
  const { t, i18n } = useTranslation()
  const loc = i18n.language === 'ar' ? 'ar' : 'en'
  const ctx = usePieceAskContext(ask.deliverableId, loc)
  const answer = useAnswerDeliverableChange()
  const piece = ctx.data ?? null
  const pieceDueDay = piece?.dueAt ? iraqDay(piece.dueAt) : null
  const [mode, setMode] = useState<ChangeAskAnswer>(initialAnswer)
  const [dueDay, setDueDay] = useState(ask.requestedDueDay ?? '')
  const [hours, setHours] = useState(ask.requestedHours != null ? String(ask.requestedHours) : '')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inThePiece = kindsToMakeInThePiece(ask.kinds)

  const hoursNum = hours.trim() === '' ? null : Number(hours)
  const ready =
    mode === 'keep' ? note.trim() !== ''
      : mode === 'change' ? (hoursNum == null || (Number.isFinite(hoursNum) && hoursNum > 0))
        : true

  function submit() {
    if (!ready || answer.isPending) return
    setError(null)
    answer.mutate(
      {
        askId: ask.id,
        answer: mode,
        dueDay: mode === 'change' ? (dueDay || null) : null,
        hours: mode === 'change' ? hoursNum : null,
        note: note.trim() || null,
      },
      {
        onSuccess: () => onClose(),
        onError: (err) => {
          const r = askRefusal(err)
          setError(r ? t(r.key, { name: r.name ?? piece?.accountManagerName ?? t('changeAsk.theAm') }) : classifyWriteFailure(err, t('changeAsk.failed'), t('changeAsk.outsideReach'), t).text)
        },
      },
    )
  }

  const asked = [
    ask.requestedHours != null ? t('changeAsk.answer.askedHours', { hours: ask.requestedHours, now: piece?.hours ?? '—' }) : null,
    ask.requestedDueDay
      ? t('changeAsk.answer.askedDue', { date: formatCalendarDay(ask.requestedDueDay, loc), now: pieceDueDay ? formatCalendarDay(pieceDueDay, loc) : '—' })
      : null,
  ].filter((x): x is string => !!x)

  return (
    <Modal onClose={() => !answer.isPending && onClose()} labelledById={`${testId}-title`} testId={testId}>
      <div className="change-ask" data-testid={`${testId}-body`}>
        <p className="change-ask-eyebrow" dir="auto">{[piece?.campaignName, piece?.name, piece?.code].filter(Boolean).join(' · ')}</p>
        <h2 id={`${testId}-title`} className="change-ask-title">
          {t('changeAsk.answer.title', { who: ask.askedByName ?? '—' })}
        </h2>
        <p className="change-ask-lede">
          {t('changeAsk.answer.sent', { when: formatIraqDateTime(ask.createdAt, loc) })}
          {ask.escalatedAt ? ` · ${t('changeAsk.answer.escalated')}` : ''}
        </p>

        <div className="change-ask-summary" data-testid={`${testId}-summary`}>
          <p className="change-ask-label">{t('changeAsk.answer.whatLabel')}</p>
          <p>{ask.kinds.map((k) => t(`changeAsk.kind.${k}`)).join(' · ')}</p>
          {asked.map((line) => <p key={line} className="change-ask-asked">{line}</p>)}
          <p className="change-ask-label">{t('changeAsk.answer.whyLabel')}</p>
          <p dir="auto" data-testid={`${testId}-reason`}>“{ask.reason}”</p>
        </div>

        {inThePiece.length > 0 && (
          <p className="change-ask-note" data-testid={`${testId}-in-piece`}>
            {t('changeAsk.answer.inThePiece', { kinds: inThePiece.map((k) => t(`changeAsk.kind.${k}`)).join(', ') })}
          </p>
        )}

        <div className="change-ask-kinds" role="radiogroup" aria-label={t('changeAsk.answer.title', { who: ask.askedByName ?? '—' })}>
          {(['accept', 'change', 'keep'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              className={`change-ask-kind${mode === m ? ' is-on' : ''}`}
              onClick={() => setMode(m)}
              data-testid={`${testId}-mode-${m}`}
            >
              {mode === m && <span aria-hidden="true" className="change-ask-tick">✓</span>}
              {t(`changeAsk.answer.mode.${m}`)}
            </button>
          ))}
        </div>

        {mode === 'change' && (
          <div className="change-ask-values">
            <label className="change-ask-group">
              <span className="change-ask-label">{t('changeAsk.hoursLabel')}</span>
              <span className="change-ask-hours">
                <input type="number" min={0.5} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} data-testid={`${testId}-hours`} />
                <span className="muted">{t('changeAsk.hoursUnit')}</span>
              </span>
            </label>
            <div className="change-ask-group">
              <span className="change-ask-label">{t('changeAsk.dueLabel')}</span>
              <DateField value={dueDay} min={iraqDay(Date.now())} onChange={setDueDay} aria-label={t('changeAsk.dueLabel')} data-testid={`${testId}-due`} />
            </div>
          </div>
        )}

        <label className="change-ask-group">
          <span className="change-ask-label">
            {mode === 'keep' ? t('changeAsk.answer.keepWhy', { who: ask.askedByName ?? '—' }) : t('changeAsk.answer.noteLabel')}
          </span>
          <textarea rows={2} dir="auto" value={note} onChange={(e) => setNote(e.target.value)} data-testid={`${testId}-note`} />
        </label>

        {error && <p className="form-error" role="alert" data-testid={`${testId}-error`}>{error}</p>}

        <div className="change-ask-actions">
          <Button
            variant="primary"
            tone={mode === 'keep' ? 'caution' : 'approve'}
            busy={answer.isPending}
            disabled={!ready || answer.isPending}
            onClick={submit}
            data-testid={`${testId}-submit`}
          >
            {t(`changeAsk.answer.submit.${mode}`)}
          </Button>
          <button type="button" className="change-ask-cancel" onClick={onClose} disabled={answer.isPending} data-testid={`${testId}-cancel`}>
            {t('common.cancel')}
          </button>
          <span className="change-ask-foot">{t('changeAsk.answer.foot')}</span>
        </div>
      </div>
    </Modal>
  )
}
