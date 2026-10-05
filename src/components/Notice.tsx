import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Spinner } from './Button'
import { ReportErrorButton } from './ReportErrorButton'
import { describeCause } from '../lib/errors/report'

/**
 * What an action says when it finishes, and what it shows while it runs — in front of the person,
 * not beside the thing they were already looking at.
 *
 * `I12.9` established this for one case: a booking refusal moved from a strip above the grid to a
 * centred `alertdialog`, because *"a refusal is a decision about that person, not a page status
 * line."* Every other surface kept an inline paragraph, so the same event reported itself two
 * different ways depending on which screen you were on. Edward, 29 Aug: processing, failure and
 * success all belong in a dialog.
 *
 * **Why the testId prop exists.** Each caller passes the `data-testid` its inline paragraph already
 * carried, so a suite asserting `getByTestId('wizard-error')` keeps passing and keeps asserting the
 * MESSAGE. Moving 77 messages into dialogs should not quietly rewrite what 44 test files check.
 *
 * Presentation only (AGENTS.md §4): these take strings and booleans. They do not know what a
 * mutation is, and they decide nothing about whether an action was allowed.
 */

export type NoticeKind = 'error' | 'success' | 'info'

export function NoticeDialog({
  kind,
  title,
  message,
  testId,
  closeLabel,
  onClose,
  reportable,
  reportContext,
  reportWhere,
  reportCause,
}: {
  kind: NoticeKind
  /** Optional heading. Defaults to a phrase for the kind, so no caller has to invent one. */
  title?: string
  message: string
  /** The `data-testid` the inline paragraph used to carry. Keeps existing suites meaningful. */
  testId?: string
  closeLabel?: string
  onClose: () => void
  /** ADR-0092 d.3: offer "Report to your administrator" on an error. The button (ReportErrorButton)
   *  owns the send, so this component stays presentational. */
  reportable?: boolean
  reportContext?: string
  reportWhere?: string
  /** I48.39: whatever was thrown. The dialog shows the friendly sentence; the REPORT carries this,
   *  rendered by `describeCause` — code, server message, detail, hint. Without it the administrator
   *  gets the sentence and nothing else, which is what happened on 15 Sep. */
  reportCause?: unknown
}) {
  const { t } = useTranslation()
  const closeRef = useRef<HTMLButtonElement>(null)

  // Focus the only actionable control. An alert nobody can dismiss from the keyboard is worse
  // than the inline paragraph it replaced.
  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const heading = title ?? t(`notice.${kind}Title`)

  // `notice-backdrop`: an alert sits ABOVE whatever it interrupts. Raised from inside another
  // dialog (the deliverable detail, say) it used to land BEHIND it in the same layer — visible to
  // a test, covered for the person, its Report button unreachable (found by P3, 15 Sep).
  return (
    <div className="dialog-backdrop notice-backdrop" role="presentation" onClick={onClose}>
      <div
        className={`dialog notice-dialog notice-${kind}`}
        // `alertdialog`, not `dialog`: this interrupts to report something that already happened.
        role="alertdialog"
        aria-modal="true"
        aria-label={heading}
        onClick={(e) => e.stopPropagation()}
        data-testid={testId ? `${testId}-dialog` : 'notice-dialog'}
      >
        <h2>{heading}</h2>
        {/* The message keeps the caller's original testid, so what the suites assert is unchanged. */}
        <p data-testid={testId}>{message}</p>
        <div className="dialog-actions">
          {reportable && kind === 'error' && (
            <ReportErrorButton
              message={message}
              context={reportContext}
              where={reportWhere}
              code={describeCause(reportCause).code}
              cause={describeCause(reportCause).cause || undefined}
              testId={testId ? `${testId}-report` : 'notice-report'}
            />
          )}
          <Button variant="secondary" ref={closeRef} onClick={onClose} data-testid={testId ? `${testId}-close` : 'notice-close'}>
            {closeLabel ?? t('notice.close')}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * The blocking spinner shown while an action is in flight.
 *
 * `Button` puts a spinner *in* the control, which is right for a save you can watch complete.
 * This is for the rest: a write that takes seconds, spans several requests, or leaves the screen
 * in a state nobody should act on until it lands. It blocks the surface deliberately — a second
 * click during a slow write is the failure `I12.9` was raised for.
 *
 * No close button, on purpose. It disappears when the work does. A dismissible progress dialog
 * invites somebody to dismiss it and then wonder whether the thing happened.
 */
export function BusyDialog({ text, testId = 'busy-dialog' }: { text: string; testId?: string }) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        className="dialog notice-dialog busy-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-busy="true"
        aria-label={text}
        data-testid={testId}
      >
        <Spinner />
        <p data-testid={`${testId}-text`}>{text}</p>
      </div>
    </div>
  )
}
