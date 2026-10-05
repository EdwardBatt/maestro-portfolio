import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { reportError } from '../lib/errors/report'
import { Button } from './Button'

/**
 * The "Report to your administrator" action on an error dialog (ADR-0092 d.3 / I48.11). It owns the
 * one call — sending the failure to the tenant's Power Admin(s) via the report-error function — so
 * `NoticeDialog` itself stays presentational and merely renders this when a dialog is reportable.
 *
 * Its own local state (no QueryClient needed, so it renders in any dialog). It says what happened:
 * reporting, then sent (or that nobody is set up to receive it) or a plain failure, and cannot be
 * pressed twice.
 */
type State = 'idle' | 'sending' | 'sent' | 'none' | 'failed'

export function ReportErrorButton({
  message,
  context,
  code,
  where,
  cause,
  testId = 'notice-report',
}: {
  message: string
  context?: string
  code?: string
  where?: string
  /** I48.39: the technical cause, from `describeCause`. */
  cause?: string
  testId?: string
}) {
  const { t } = useTranslation()
  const [state, setState] = useState<State>('idle')

  if (state === 'sent' || state === 'none') {
    return (
      <span className="muted" data-testid={`${testId}-done`}>
        {state === 'sent' ? t('notice.reported') : t('notice.reportNoRecipients')}
      </span>
    )
  }

  async function send() {
    setState('sending')
    try {
      const result = await reportError({ message, context, code, where, cause })
      setState(result.sent > 0 ? 'sent' : 'none')
    } catch {
      setState('failed')
    }
  }

  return (
    <Button
      variant="secondary"
      disabled={state === 'sending'}
      onClick={() => void send()}
      data-testid={testId}
    >
      {state === 'sending' ? t('notice.reporting') : state === 'failed' ? t('notice.reportFailed') : t('notice.report')}
    </Button>
  )
}
