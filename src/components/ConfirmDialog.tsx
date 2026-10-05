import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './Button'

/**
 * Asking before something destructive, in front of the person (ADR-0068 d.1).
 *
 * `NoticeDialog` reports what already happened; this asks whether it should. Same shell, so the
 * two read as one vocabulary rather than as two products — which is the defect `I12.9` was raised
 * for, where the same event reported itself differently depending on which screen you were on.
 *
 * WHY IT TAKES `detail` AND NOT JUST A MESSAGE. ADR-0068 d.2: a confirmation has to say what is
 * LOST, in numbers — the assignee, the dates, how many bookings are released. "Are you sure?" is a
 * click-through, and a dialog everybody dismisses without reading is worse than no dialog, because
 * it buys the illusion of a safeguard.
 *
 * Presentation only (`AGENTS.md` §4): strings and booleans in, a callback out. It knows nothing
 * about what is being confirmed.
 */
export interface ConfirmDialogProps {
  title: string
  /** The question. One sentence. */
  message: string
  /** What it costs, itemised. Rendered as a list; omit where genuinely nothing is lost. */
  detail?: readonly string[]
  confirmLabel: string
  /** `danger` reddens the confirm button — for anything that destroys work. */
  tone?: 'danger' | 'default'
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
  testId?: string
}

export function ConfirmDialog({
  title,
  message,
  detail,
  confirmLabel,
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
  testId = 'confirm',
}: ConfirmDialogProps) {
  const { t } = useTranslation()
  const cancelRef = useRef<HTMLButtonElement>(null)

  // Focus CANCEL, not confirm. A destructive dialog whose dangerous button is under the return key
  // is a slower version of no dialog at all.
  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="dialog notice-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        data-testid={`${testId}-dialog`}
      >
        <h2>{title}</h2>
        <p data-testid={`${testId}-message`}>{message}</p>
        {detail && detail.length > 0 && (
          <ul className="confirm-detail" data-testid={`${testId}-detail`}>
            {detail.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        <div className="dialog-actions">
          <Button ref={cancelRef} variant="secondary" onClick={onCancel} data-testid={`${testId}-cancel`}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            busy={busy}
            onClick={onConfirm}
            data-testid={`${testId}-confirm`}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
