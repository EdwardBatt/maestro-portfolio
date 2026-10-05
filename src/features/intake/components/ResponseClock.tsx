import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatMoment } from '../../../lib/time/iraq'
import { elapsedSince } from '../lib/single-job'

/**
 * How long the client has been waiting — from the arrival a person CONFIRMED on the receipt
 * (ADR-0082 d.10, ADR-0085 d.5), never from when the form was opened.
 *
 * Shown small on SJ-02 and SJ-03 ("running since …") and large on SJ-04, where the gap ends.
 * Presentation only: the start is the receipt's `received_at`, the arithmetic is `elapsedSince`,
 * and nothing here is stored — the receipts are the record (ADR-0066).
 */
export function ResponseClock({
  startIso,
  prominent = false,
  variant = 'line',
  testId = 'response-clock',
}: {
  /** The confirmed arrival. Null while nothing has been confirmed — the clock says so. */
  startIso: string | null
  prominent?: boolean
  /** `chip` renders the amber pill the frames put in the wizard head; `line` the inline paragraph. */
  variant?: 'line' | 'chip'
  testId?: string
}) {
  const { t, i18n } = useTranslation()
  const [now, setNow] = useState(() => Date.now())

  // A clock that does not move reads as a timestamp. One tick a minute is enough for a number
  // that is stated in minutes.
  useEffect(() => {
    if (!startIso) return
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [startIso])

  const elapsed = startIso ? elapsedSince(startIso, now) : null
  const locale = i18n.language === 'ar' ? 'ar' : 'en'

  if (!startIso || !elapsed) {
    if (variant === 'chip') {
      return (
        <span className="clock-chip clock-chip-idle" data-testid={testId}>
          {t('intake.clock.notStarted')}
        </span>
      )
    }
    return (
      <p className={prominent ? 'intake-clock intake-clock-prominent' : 'intake-clock'} data-testid={testId}>
        <span>{t('intake.clock.notStarted')}</span>
      </p>
    )
  }

  const parts: string[] = []
  if (elapsed.days > 0) parts.push(t('intake.clock.days', { n: elapsed.days }))
  if (elapsed.days > 0 || elapsed.hours > 0) parts.push(t('intake.clock.hours', { n: elapsed.hours }))
  parts.push(t('intake.clock.minutes', { n: elapsed.minutes }))
  const old = elapsed.days >= 1
  const when = formatMoment(startIso, locale)

  // The arrival time always shows. A future arrival (the entered time is later than now — a
  // screenshot's clock ahead of ours, or a mis-typed time) is said plainly rather than shown as a
  // stuck "0 minutes"; a just-confirmed one reads "just now" rather than "0 minutes ago".
  const elapsedText = parts.join(' ')
  const headline = elapsed.future
    ? t('campaigns.receipt.receivedFuture', { when })
    : elapsed.totalMinutes === 0
      ? t('campaigns.receipt.justNow', { when })
      : t('campaigns.receipt.sinceShort', { elapsed: elapsedText, when })

  if (variant === 'chip') {
    return (
      <span className={`clock-chip${elapsed.future ? ' clock-chip-idle' : ''}`} data-testid={testId}>
        <span data-testid={`${testId}-elapsed`}>{headline}</span>
      </span>
    )
  }

  return (
    <p
      className={[prominent ? 'intake-clock intake-clock-prominent' : 'intake-clock', old ? 'is-old' : '']
        .filter(Boolean)
        .join(' ')}
      data-testid={testId}
    >
      {elapsed.future || elapsed.totalMinutes === 0 ? (
        <strong data-testid={`${testId}-elapsed`}>{headline}</strong>
      ) : (
        <>
          <strong data-testid={`${testId}-elapsed`}>{elapsedText}</strong>
          <span>{t('intake.clock.since', { when })}</span>
        </>
      )}
    </p>
  )
}
