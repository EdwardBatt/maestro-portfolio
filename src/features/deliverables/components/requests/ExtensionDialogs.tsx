import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../../components/Button'
import { formatDeadline, iraqDay } from '../../../../lib/time/iraq'
import { useDecideExtensionStep, useForwardExtension, useOwnerDeclineExtension } from '../../api/requests-api'
import { extraDays, shorterBounds, type ExtensionStepRow } from '../../lib/needs-you-requests'
import { errorText, joinNames } from '../../lib/requests-text'
import { RequestDialog } from './RequestDialog'
import { DateField } from '../../../../components/DateField'

/** The request as both steps read it: the dates, the reason, who the time is charged to. */
function RequestFacts({ r, testId }: { r: ExtensionStepRow; testId: string }) {
  const { t, i18n } = useTranslation()
  const loc = i18n.language.startsWith('ar') ? 'ar' : 'en'
  const days = extraDays(r.fromAt, r.toAt)
  return (
    <dl className="rq-facts" data-testid={`${testId}-facts`}>
      <div>
        <dt>{t('requests.ext.dates')}</dt>
        <dd data-testid={`${testId}-dates`}>
          {r.fromAt ? formatDeadline(r.fromAt, loc) : t('requests.ext.noDateYet')} →{' '}
          {r.toAt ? formatDeadline(r.toAt, loc) : t('requests.ext.noDateYet')}
          {days ? ` · ${t('requests.ext.moreDays', { count: days })}` : ''}
        </dd>
      </div>
      <div>
        <dt>{t('requests.ext.reason')}</dt>
        <dd dir="auto">{r.reason ?? '—'}</dd>
      </div>
      <div>
        <dt>{t('requests.ext.chargedTo')}</dt>
        <dd>{r.attributedTo ? t(`deadlineExtension.attribution_${r.attributedTo}`) : '—'}</dd>
      </div>
      <div>
        <dt>{t('requests.ext.askedBy')}</dt>
        <dd>{r.requestedByName ?? '—'}</dd>
      </div>
    </dl>
  )
}

/**
 * Extension, the owner's step (plan View 6, ADR-0109 d.1 + addendum): the request, then "Fair:
 * forward it" with a note to the account manager — REQUIRED (the addendum) — or "Not fair: decline"
 * with a reason, which ends it and tells the maker.
 */
export function ExtensionOwnerDialog({
  request,
  initialMode = 'forward',
  onClose,
  testId = 'ext-owner',
}: {
  request: ExtensionStepRow
  initialMode?: 'forward' | 'decline'
  onClose: () => void
  testId?: string
}) {
  const { t } = useTranslation()
  const forward = useForwardExtension()
  const decline = useOwnerDeclineExtension()
  const [mode, setMode] = useState<'forward' | 'decline'>(initialMode)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const busy = forward.isPending || decline.isPending

  function send() {
    setError(null)
    const done = { onSuccess: onClose, onError: (e: unknown) => setError(errorText(e, t('requests.failed'))) }
    if (mode === 'forward') forward.mutate({ requestId: request.requestId, note: text }, done)
    else decline.mutate({ requestId: request.requestId, reason: text }, done)
  }

  return (
    <RequestDialog
      testId={testId}
      title={t('requests.extOwner.title')}
      subtitle={[request.taskTitle, request.deliverableName].filter(Boolean).join(' · ')}
      told={mode === 'forward' ? t('requests.extOwner.toldAm') : request.requestedByName}
      error={error}
      onClose={onClose}
      actions={
        <>
          <Button
            variant={mode === 'decline' ? 'danger' : 'primary'}
            tone={mode === 'decline' ? 'caution' : undefined}
            busy={busy}
            disabled={!text.trim() || busy}
            onClick={send}
            data-testid={`${testId}-send`}
          >
            {mode === 'forward' ? t('requests.extOwner.forward') : t('requests.extOwner.decline')}
          </Button>
          <Button variant="secondary" onClick={onClose} data-testid={`${testId}-cancel`}>{t('common.cancel')}</Button>
        </>
      }
    >
      <RequestFacts r={request} testId={testId} />
      <fieldset className="radio-group" data-testid={`${testId}-mode`}>
        <label className="check">
          <input type="radio" name={`${testId}-mode`} checked={mode === 'forward'} onChange={() => setMode('forward')} data-testid={`${testId}-mode-forward`} />
          {t('requests.extOwner.fair')}
        </label>
        <label className="check">
          <input type="radio" name={`${testId}-mode`} checked={mode === 'decline'} onChange={() => setMode('decline')} data-testid={`${testId}-mode-decline`} />
          {t('requests.extOwner.notFair')}
        </label>
      </fieldset>
      <label>
        {mode === 'forward' ? t('requests.extOwner.note') : t('requests.extOwner.reason')}
        <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} data-testid={`${testId}-text`} dir="auto" />
      </label>
    </RequestDialog>
  )
}

/**
 * Extension, the account manager's step (plan View 6, ADR-0109 d.2, d.3): the request and the
 * owner's note; Approve · Approve a shorter one (a day strictly after the current commitment and
 * strictly before the one asked — `shorterBounds`, the server's own bounds) · Refuse. The maker and
 * the owner are told (ADR-0109 d.3 and the addendum).
 */
export function ExtensionAmDialog({
  request,
  onClose,
  testId = 'ext-am',
}: {
  request: ExtensionStepRow
  onClose: () => void
  testId?: string
}) {
  const { t, i18n } = useTranslation()
  const loc = i18n.language.startsWith('ar') ? 'ar' : 'en'
  const decide = useDecideExtensionStep()
  const bounds = shorterBounds(request.fromAt ? iraqDay(request.fromAt) : null, request.toAt ? iraqDay(request.toAt) : null)
  const [mode, setMode] = useState<'approve' | 'shorter' | 'refuse'>('approve')
  const [day, setDay] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const dayOk = mode !== 'shorter' || (!!day && !!bounds && (!bounds.min || day >= bounds.min) && day <= bounds.max)

  function send() {
    setError(null)
    decide.mutate(
      { requestId: request.requestId, approve: mode !== 'refuse', note, toDay: mode === 'shorter' ? day : null },
      { onSuccess: onClose, onError: (e) => setError(errorText(e, t('requests.failed'))) },
    )
  }

  const label = mode === 'refuse' ? t('requests.extAm.refuse') : mode === 'shorter' ? t('requests.extAm.approveShorter') : t('requests.extAm.approve')

  return (
    <RequestDialog
      testId={testId}
      title={t('requests.extAm.title')}
      subtitle={[request.taskTitle, request.deliverableName].filter(Boolean).join(' · ')}
      told={joinNames([request.requestedByName, request.forwardedAt ? t('requests.extAm.theOwner') : null], t('requests.listAnd'), t('requests.listSep'))}
      error={error}
      onClose={onClose}
      actions={
        <>
          <Button
            variant={mode === 'refuse' ? 'danger' : 'primary'}
            tone={mode === 'refuse' ? 'caution' : 'approve'}
            busy={decide.isPending}
            disabled={!dayOk || decide.isPending}
            onClick={send}
            data-testid={`${testId}-send`}
          >
            {label}
          </Button>
          <Button variant="secondary" onClick={onClose} data-testid={`${testId}-cancel`}>{t('common.cancel')}</Button>
        </>
      }
    >
      <RequestFacts r={request} testId={testId} />
      {request.ownerNote && (
        <blockquote className="rq-quote" data-testid={`${testId}-owner-note`}>
          <b>{t('requests.extAm.ownerSaid')}</b> <span dir="auto">{request.ownerNote}</span>
        </blockquote>
      )}
      <p className="muted" data-testid={`${testId}-effect`}>
        {request.toAt ? t('requests.extAm.effect', { date: formatDeadline(request.toAt, loc) }) : null}
      </p>
      <fieldset className="radio-group" data-testid={`${testId}-mode`}>
        <label className="check">
          <input type="radio" name={`${testId}-mode`} checked={mode === 'approve'} onChange={() => setMode('approve')} data-testid={`${testId}-mode-approve`} />
          {t('requests.extAm.approve')}
        </label>
        {bounds && (
          <label className="check">
            <input type="radio" name={`${testId}-mode`} checked={mode === 'shorter'} onChange={() => setMode('shorter')} data-testid={`${testId}-mode-shorter`} />
            {t('requests.extAm.approveShorter')}
          </label>
        )}
        <label className="check">
          <input type="radio" name={`${testId}-mode`} checked={mode === 'refuse'} onChange={() => setMode('refuse')} data-testid={`${testId}-mode-refuse`} />
          {t('requests.extAm.refuse')}
        </label>
      </fieldset>
      {mode === 'shorter' && bounds && (
        <label>
          {t('requests.extAm.newDay')}
          <DateField
           
            value={day}
            min={bounds.min ?? undefined}
            max={bounds.max}
            onChange={(v) => setDay(v)}
            data-testid={`${testId}-day`}
          />
          <span className="field-hint">{t('requests.extAm.between')}</span>
        </label>
      )}
      <label>
        {t('requests.extAm.note')}
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} data-testid={`${testId}-note`} dir="auto" />
      </label>
    </RequestDialog>
  )
}
