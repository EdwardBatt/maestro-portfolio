import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { classifyExtension } from '../../../lib/deadlines/extension-arithmetic'
import { useExtensionContext } from '../../../lib/deadlines/use-extension-context'
import { formatDeadline, iraqDay } from '../../../lib/time/iraq'
import { isRefused, useRequestExtension, type ExtensionAttribution } from '../api/extensions-api'
import { arithmeticText } from '../lib/extension-text'
import { Modal } from '../../../components/Modal'
import { DateField } from '../../../components/DateField'

/**
 * Asking for a deadline extension (ADR-0088 d.2, d.4, d.7).
 *
 * A request is a date, a reason and who the time is charged to — all three required, and the
 * reason is the TEXT OF THE ASK, not a justification bolted beside it (d.4). The arithmetic is shown
 * before sending, in ADR-0075 d.9's shape: fine, tight, or at risk — and the one date that cannot
 * be asked for (after go-live) is said so before the round trip, though the server refuses it too.
 *
 * The dialog knows nothing about who may ask: the caller decides whether to show the button, and
 * the RPC decides again. A refusal comes back as a sentence.
 */
export interface ExtensionRequestDialogProps {
  subTaskId: string
  taskTitle: string
  committedDueAt: string | null
  deliverableDueAt: string | null
  goLiveAt: string | null
  approverName: string | null
  /** Pre-fill the date — from a save whose plan ended past the commitment (d.10). */
  initialDay?: string | null
  /** A line explaining why the dialog opened on its own (d.10's offer). */
  offerText?: string | null
  onClose: () => void
  testId?: string
}

export function ExtensionRequestDialog({
  subTaskId,
  taskTitle,
  committedDueAt,
  deliverableDueAt,
  goLiveAt,
  approverName,
  initialDay,
  offerText,
  onClose,
  testId = 'extension-request',
}: ExtensionRequestDialogProps) {
  const { t, i18n } = useTranslation()
  const request = useRequestExtension()
  const [day, setDay] = useState(initialDay ?? '')
  const [reason, setReason] = useState('')
  const [attribution, setAttribution] = useState<ExtensionAttribution>('assignee')
  const [error, setError] = useState<string | null>(null)
  const loc = i18n.language === 'ar' ? 'ar' : 'en'

  const extensionContext = useExtensionContext({ subTaskId })
  const arithmetic = day
    ? classifyExtension({ requestedDay: day, deliverableDueAt, goLiveAt, ...extensionContext })
    : null
  // ADR-0093: a date after go-live is asked for like any other — the account manager decides.
  const canSend = day.length > 0 && reason.trim().length > 0

  function send() {
    setError(null)
    request.mutate(
      { subTaskId, toDay: day, reason: reason.trim(), attributedTo: attribution },
      {
        onSuccess: onClose,
        onError: (err) =>
          setError(
            isRefused(err)
              ? t('deadlineExtension.refused')
              : (err as Error).message || t('deadlineExtension.failed'),
          ),
      },
    )
  }

  return (
    <Modal onClose={onClose} card={false}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('deadlineExtension.askTitle')}
        data-testid={`${testId}-dialog`}
      >
        <h2>{t('deadlineExtension.askTitle')}</h2>
        <p className="muted">{taskTitle}</p>
        {offerText && <p className="cell-warn" data-testid={`${testId}-offer`}>{offerText}</p>}
        <p className="muted" data-testid={`${testId}-intro`}>
          {/* No committed date yet is said in words, never as a dash (25 Sep). */}
          {committedDueAt
            ? approverName
              ? t('deadlineExtension.askIntro', { date: formatDeadline(committedDueAt, loc), approver: approverName })
              : t('deadlineExtension.askIntroNoApprover', { date: formatDeadline(committedDueAt, loc) })
            : approverName
              ? t('deadlineExtension.askIntroUndated', { approver: approverName })
              : t('deadlineExtension.askIntroUndatedNoApprover')}
        </p>

        <label>
          {t('deadlineExtension.newDate')}
          <DateField
           
            value={day}
            min={committedDueAt ? iraqDay(committedDueAt) : undefined}
            onChange={(v) => setDay(v)}
            data-testid={`${testId}-day`}
          />
        </label>

        {arithmetic && (
          <p
            className={arithmetic.severity === 'fine' ? 'muted' : 'cell-warn'}
            data-testid={`${testId}-arithmetic`}
            data-severity={arithmetic.severity}
          >
            {arithmeticText(arithmetic, !!deliverableDueAt, t)}
          </p>
        )}

        <label>
          {t('deadlineExtension.reason')}
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            data-testid={`${testId}-reason`}
          />
          <span className="field-hint">{t('deadlineExtension.reasonHint')}</span>
        </label>

        <fieldset className="radio-group" data-testid={`${testId}-attribution`}>
          <legend className="field-label">{t('deadlineExtension.attribution')}</legend>
          {(['assignee', 'client', 'dependency'] as const).map((a) => (
            <label key={a} className="check">
              <input
                type="radio"
                name={`${testId}-attribution`}
                value={a}
                checked={attribution === a}
                onChange={() => setAttribution(a)}
                data-testid={`${testId}-attribution-${a}`}
              />
              {t(`deadlineExtension.attribution_${a}`)}
            </label>
          ))}
        </fieldset>

        {error && (
          <p className="form-error" role="alert" data-testid={`${testId}-error`}>{error}</p>
        )}

        <div className="dialog-actions">
          <Button variant="secondary" onClick={onClose} data-testid={`${testId}-cancel`}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            busy={request.isPending}
            disabled={!canSend || request.isPending}
            onClick={send}
            data-testid={`${testId}-send`}
          >
            {request.isPending ? t('deadlineExtension.sending') : t('deadlineExtension.send')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
