import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { DateField } from '../../../components/DateField'
import { Modal } from '../../../components/Modal'
import { formatCalendarDay, iraqDay } from '../../../lib/time/iraq'
import { classifyWriteFailure } from '../../../lib/errors/classify'
import { useAskDeliverableChange, usePieceAskContext, usePieceChangeAsks } from '../api/change-asks-api'
import { askReady, askRefusal, askToShow, CHANGE_ASK_KINDS, pastPieceDue, type ChangeAskKind } from '../lib/change-ask'

/**
 * **Ask Inas to change the deliverable** — Figma CP-06 (1954:4177), ADR-0141 d.2, I74.14.
 *
 * The one form. Anyone who works on the piece and may not change it — its owner and the leads of its department —
 * asks the account manager here: what isn't right (pick all that apply), the new hours and due day, and why
 * (required, she reads it). Nothing changes until she answers; the booked tasks keep their dates.
 *
 * Opened from two places with the same signature: the piece header ("Ask Inas to change it"), and any move of a task
 * past the piece's due date — the Schedule's drag, the Team page's, a task's Edit — already filled in with that day
 * (`initialDueDay`) and the task that moved (`fromSubTaskId`), so nobody asks twice.
 *
 * The database decides who may ask and words every refusal (`hint`): the account manager's own side is told to change
 * it directly, one ask waits per piece, a maker is sent to her own lead. The form says the refusal in place and never
 * blocks what the server allows.
 */
export interface ChangeAskDialogProps {
  deliverableId: string
  fromSubTaskId?: string
  initialDueDay?: string
  onClose: () => void
  testId?: string
}

export function ChangeAskDialog({ deliverableId, fromSubTaskId, initialDueDay, onClose, testId = 'change-ask' }: ChangeAskDialogProps) {
  const { t, i18n } = useTranslation()
  const loc = i18n.language === 'ar' ? 'ar' : 'en'
  const ctx = usePieceAskContext(deliverableId, loc)
  const asks = usePieceChangeAsks(deliverableId)
  const send = useAskDeliverableChange()
  const piece = ctx.data ?? null
  const pieceDueDay = piece?.dueAt ? iraqDay(piece.dueAt) : null
  const am = piece?.accountManagerName ?? t('changeAsk.theAm')

  const [kinds, setKinds] = useState<ChangeAskKind[]>(initialDueDay ? ['due_date'] : [])
  const [dueDay, setDueDay] = useState(initialDueDay ?? '')
  const [hours, setHours] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const pending = askToShow(asks.data ?? [])
  const alreadyWaiting = pending?.status === 'pending' ? pending : null
  const movedTask = fromSubTaskId ? piece?.tasks.find((x) => x.id === fromSubTaskId) ?? null : null
  const ready = askReady({ kinds, reason, dueDay, hours }) && !alreadyWaiting
  const toggle = (k: ChangeAskKind) => setKinds((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k]))

  function submit() {
    if (!ready || send.isPending) return
    setError(null)
    send.mutate(
      {
        deliverableId,
        kinds,
        reason,
        dueDay: kinds.includes('due_date') && dueDay ? dueDay : null,
        hours: kinds.includes('hours') && hours.trim() ? Number(hours) : null,
        fromSubTaskId: fromSubTaskId ?? null,
      },
      {
        onSuccess: () => onClose(),
        onError: (err) => {
          const r = askRefusal(err)
          setError(r ? t(r.key, { name: r.name ?? am }) : classifyWriteFailure(err, t('changeAsk.failed'), t('changeAsk.outsideReach'), t).text)
        },
      },
    )
  }

  const eyebrow = [piece?.name, piece?.code].filter(Boolean).join(' · ')

  return (
    <Modal onClose={() => !send.isPending && onClose()} labelledById={`${testId}-title`} testId={testId}>
      <div className="change-ask" data-testid={`${testId}-body`}>
        {eyebrow && <p className="change-ask-eyebrow" dir="auto">{eyebrow}</p>}
        <h2 id={`${testId}-title`} className="change-ask-title">{t('changeAsk.title', { name: am })}</h2>
        {movedTask && initialDueDay && pastPieceDue(initialDueDay, pieceDueDay) ? (
          <p className="change-ask-lede" data-testid={`${testId}-moved`}>
            {t('changeAsk.moved', {
              task: movedTask.title,
              day: formatCalendarDay(initialDueDay, loc),
              piece: piece?.name ?? '',
              due: pieceDueDay ? formatCalendarDay(pieceDueDay, loc) : '—',
            })}
          </p>
        ) : (
          <p className="change-ask-lede">{t('changeAsk.lede')}</p>
        )}

        {alreadyWaiting && (
          <p className="change-ask-note is-warn" role="status" data-testid={`${testId}-waiting`}>
            {t('changeAsk.alreadyWaiting', { name: am, who: alreadyWaiting.askedByName ?? '—' })}
          </p>
        )}

        <div className="change-ask-group">
          <p className="change-ask-label" id={`${testId}-kinds-label`}>{t('changeAsk.whatLabel')}</p>
          <div className="change-ask-kinds" role="group" aria-labelledby={`${testId}-kinds-label`} data-testid={`${testId}-kinds`}>
            {CHANGE_ASK_KINDS.map((k) => {
              const on = kinds.includes(k)
              return (
                <button
                  key={k}
                  type="button"
                  className={`change-ask-kind${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  onClick={() => toggle(k)}
                  data-testid={`${testId}-kind-${k}`}
                >
                  {on && <span aria-hidden="true" className="change-ask-tick">✓</span>}
                  {t(`changeAsk.kind.${k}`)}
                </button>
              )
            })}
          </div>
        </div>

        {(kinds.includes('hours') || kinds.includes('due_date')) && (
          <div className="change-ask-values">
            {kinds.includes('hours') && (
              <label className="change-ask-group">
                <span className="change-ask-label">
                  {piece?.hours != null ? t('changeAsk.hoursNow', { hours: piece.hours }) : t('changeAsk.hoursLabel')}
                </span>
                <span className="change-ask-hours">
                  <input
                    type="number"
                    min={0.5}
                    step={0.5}
                    inputMode="decimal"
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                    data-testid={`${testId}-hours`}
                  />
                  <span className="muted">{t('changeAsk.hoursUnit')}</span>
                </span>
              </label>
            )}
            {kinds.includes('due_date') && (
              <div className="change-ask-group">
                <span className="change-ask-label">
                  {pieceDueDay ? t('changeAsk.dueNow', { date: formatCalendarDay(pieceDueDay, loc) }) : t('changeAsk.dueLabel')}
                </span>
                <DateField
                  value={dueDay}
                  min={iraqDay(Date.now())}
                  onChange={setDueDay}
                  aria-label={t('changeAsk.dueLabel')}
                  data-testid={`${testId}-due`}
                />
              </div>
            )}
          </div>
        )}

        <label className="change-ask-group">
          <span className="change-ask-label">{t('changeAsk.whyLabel', { name: am })}</span>
          <textarea
            rows={3}
            dir="auto"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            data-testid={`${testId}-reason`}
          />
        </label>

        {error && <p className="form-error" role="alert" data-testid={`${testId}-error`}>{error}</p>}

        <div className="change-ask-actions">
          <Button variant="primary" busy={send.isPending} disabled={!ready || send.isPending} onClick={submit} data-testid={`${testId}-send`}>
            {t('changeAsk.send', { name: am })}
          </Button>
          <button type="button" className="change-ask-cancel" onClick={onClose} disabled={send.isPending} data-testid={`${testId}-cancel`}>
            {t('common.cancel')}
          </button>
          <span className="change-ask-foot">{t('changeAsk.foot')}</span>
        </div>
      </div>
    </Modal>
  )
}
