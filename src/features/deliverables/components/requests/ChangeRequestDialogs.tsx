import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../../components/Button'
import { formatIraqDate } from '../../../../lib/time/iraq'
import { readStoredCost } from '../../../campaigns/lib/change-request'
import { useAnswerChangeRequest, useResolveChangeRequest } from '../../api/requests-api'
import type { ChangeLine, ChangeRequestRow } from '../../lib/needs-you-requests'
import { errorText } from '../../lib/requests-text'
import { RequestDialog } from './RequestDialog'
import { DateField } from '../../../../components/DateField'

function ValueText({ line, side }: { line: ChangeLine; side: 'from' | 'to' }) {
  const { i18n } = useTranslation()
  const loc = i18n.language.startsWith('ar') ? 'ar' : 'en'
  const raw = side === 'from' ? line.from : line.to
  const shown = side === 'from' ? line.fromLabel : line.toLabel
  if (raw == null) return <>—</>
  if (line.field === 'due') {
    const at = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00Z` : raw
    return <>{Number.isFinite(Date.parse(at)) ? formatIraqDate(at, loc) : raw}</>
  }
  return <>{shown ?? raw}</>
}

/** What changes, before → after, one row per field (ADR-0110 d.1). */
export function ChangeLines({ lines, testId }: { lines: readonly ChangeLine[]; testId: string }) {
  const { t } = useTranslation()
  return (
    <table className="rq-changes" data-testid={`${testId}-changes`}>
      <tbody>
        {lines.map((l) => (
          <tr key={l.field} data-testid={`${testId}-change-${l.field}`}>
            <th scope="row">{t(`requests.field.${l.field}`)}</th>
            <td><ValueText line={l} side="from" /></td>
            <td aria-hidden="true">→</td>
            <td><b><ValueText line={l} side="to" /></b></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * What it costs, as the requester's screen worked it out and sent it (`cost`, ADR-0110 d.1 — "work
 * lost, new landing date"). Read by the names Edit's change request stores (`costFigures` /
 * `readStoredCost` in campaigns/lib/change-request — started_tasks, booked_hours, timed_hours,
 * lands_on) and said in the same sentences Edit showed the requester; nothing is computed here. Any
 * other figure is shown as it came, under its own name. Who asked says whether a revision round is
 * spent (the client) or nothing is (us).
 */
export function ChangeCost({ request, testId }: { request: ChangeRequestRow; testId: string }) {
  const { t, i18n } = useTranslation()
  const loc = i18n.language.startsWith('ar') ? 'ar' : 'en'
  const cost = readStoredCost(request.cost)
  const show = (v: unknown) => (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v))
  const day = (d: string) => {
    const at = /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T12:00:00Z` : d
    return Number.isFinite(Date.parse(at)) ? formatIraqDate(at, loc) : d
  }
  return (
    <div className="rq-cost" data-testid={`${testId}-cost`}>
      <p data-testid={`${testId}-asked-by`}>
        {t(`requests.change.askedBy_${request.askedBy === 'client' ? 'client' : 'us'}`)} ·{' '}
        {request.askedBy === 'client' ? t('requests.change.spendsRound') : t('requests.change.countsNothing')}
      </p>
      {!cost ? (
        <p className="muted" data-testid={`${testId}-cost-none`}>{t('requests.change.noCost')}</p>
      ) : (
        <>
          <p data-testid={`${testId}-cost-work`}>
            {cost.startedTasks === 0
              ? t('changeRequest.costNone')
              : t('changeRequest.costTotal', { count: cost.startedTasks, booked: cost.bookedHours, timed: cost.timedHours })}
          </p>
          {cost.landsOn && (
            <p data-testid={`${testId}-cost-lands`}>{t('changeRequest.landsOn', { date: day(cost.landsOn) })}</p>
          )}
          {cost.other.length > 0 && (
            <dl className="rq-facts">
              {cost.other.map(([k, v]) => (
                <div key={k} data-testid={`${testId}-cost-${k}`}>
                  <dt>{k}</dt>
                  <dd>{show(v)}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
    </div>
  )
}

/** See what it costs (plan View 3): the change and its cost, read only. */
export function ChangeCostDialog({ request, onClose, testId = 'change-cost' }: { request: ChangeRequestRow; onClose: () => void; testId?: string }) {
  const { t } = useTranslation()
  return (
    <RequestDialog
      testId={testId}
      title={t('requests.change.costTitle')}
      subtitle={[request.deliverableName, request.campaignName].filter(Boolean).join(' · ')}
      told={null}
      onClose={onClose}
      actions={<Button variant="secondary" onClick={onClose} data-testid={`${testId}-close`}>{t('requests.close')}</Button>}
    >
      <ChangeLines lines={request.changes} testId={testId} />
      <ChangeCost request={request} testId={testId} />
    </RequestDialog>
  )
}

/**
 * Change request, the owner decides (plan View 6, ADR-0110 d.2): before → after, what it costs, who
 * asked. Accept (the change applies) · Decline (a reason) · Push back (your words, and a date if you
 * have one). The requester is told.
 */
export function ChangeDecideDialog({ request, onClose, testId = 'change-decide' }: { request: ChangeRequestRow; onClose: () => void; testId?: string }) {
  const { t } = useTranslation()
  const answer = useAnswerChangeRequest()
  const [mode, setMode] = useState<'accept' | 'decline' | 'push_back'>('accept')
  const [text, setText] = useState('')
  const [date, setDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const ready = mode === 'accept' || text.trim().length > 0

  function send() {
    setError(null)
    answer.mutate(
      { requestId: request.id, answer: mode, text: mode === 'accept' ? null : text, date: mode === 'push_back' ? date || null : null },
      { onSuccess: onClose, onError: (e) => setError(errorText(e, t('requests.failed'))) },
    )
  }

  return (
    <RequestDialog
      testId={testId}
      title={t('requests.change.decideTitle', { who: request.requestedByName ?? '—' })}
      subtitle={[request.deliverableName, request.campaignName].filter(Boolean).join(' · ')}
      told={request.requestedByName}
      error={error}
      onClose={onClose}
      actions={
        <>
          <Button
            variant={mode === 'decline' ? 'danger' : mode === 'push_back' ? 'secondary' : 'primary'}
            tone={mode === 'accept' ? 'change' : 'caution'}
            busy={answer.isPending}
            disabled={!ready || answer.isPending}
            onClick={send}
            data-testid={`${testId}-send`}
          >
            {t(`requests.change.answer_${mode}`)}
          </Button>
          <Button variant="secondary" onClick={onClose} data-testid={`${testId}-cancel`}>{t('common.cancel')}</Button>
        </>
      }
    >
      <ChangeLines lines={request.changes} testId={testId} />
      <ChangeCost request={request} testId={testId} />
      <fieldset className="radio-group" data-testid={`${testId}-mode`}>
        {(['accept', 'decline', 'push_back'] as const).map((m) => (
          <label key={m} className="check">
            <input type="radio" name={`${testId}-mode`} checked={mode === m} onChange={() => setMode(m)} data-testid={`${testId}-mode-${m}`} />
            {t(`requests.change.answer_${m}`)}
          </label>
        ))}
      </fieldset>
      {mode !== 'accept' && (
        <label>
          {mode === 'decline' ? t('requests.change.reason') : t('requests.change.counter')}
          <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} data-testid={`${testId}-text`} dir="auto" />
        </label>
      )}
      {mode === 'push_back' && (
        <label>
          {t('requests.change.counterDate')}
          <DateField value={date} onChange={(v) => setDate(v)} data-testid={`${testId}-date`} />
        </label>
      )}
    </RequestDialog>
  )
}

/**
 * Push-back, the account manager answers (plan View 6, ADR-0110 d.3, Q23): your request beside her
 * counter. Accept her version (the change applies with her date and words) · Withdraw (nothing
 * changes, no round spent). There is no insist. The owner is told.
 */
export function ChangeCounterDialog({
  request,
  initialMode = 'accept_counter',
  onClose,
  testId = 'change-counter',
}: {
  request: ChangeRequestRow
  initialMode?: 'accept_counter' | 'withdraw'
  onClose: () => void
  testId?: string
}) {
  const { t, i18n } = useTranslation()
  const loc = i18n.language.startsWith('ar') ? 'ar' : 'en'
  const resolve = useResolveChangeRequest()
  const [mode, setMode] = useState<'accept_counter' | 'withdraw'>(initialMode)
  const [error, setError] = useState<string | null>(null)

  function send() {
    setError(null)
    resolve.mutate({ requestId: request.id, resolution: mode }, { onSuccess: onClose, onError: (e) => setError(errorText(e, t('requests.failed'))) })
  }

  return (
    <RequestDialog
      testId={testId}
      title={t('requests.counter.title')}
      subtitle={[request.deliverableName, request.campaignName].filter(Boolean).join(' · ')}
      told={request.answeredByName}
      error={error}
      onClose={onClose}
      actions={
        <>
          <Button
            variant={mode === 'accept_counter' ? 'arrow' : 'secondary'}
            tone={mode === 'accept_counter' ? 'change' : undefined}
            busy={resolve.isPending}
            disabled={resolve.isPending}
            onClick={send}
            data-testid={`${testId}-send`}
          >
            {mode === 'accept_counter' ? t('requests.counter.accept') : t('requests.counter.withdraw')}
          </Button>
          <Button variant="secondary" onClick={onClose} data-testid={`${testId}-cancel`}>{t('common.cancel')}</Button>
        </>
      }
    >
      <div className="rq-side-by-side">
        <section data-testid={`${testId}-yours`}>
          <h3 className="task-page-sub">{t('requests.counter.yours')}</h3>
          <ChangeLines lines={request.changes} testId={testId} />
        </section>
        <section data-testid={`${testId}-hers`}>
          <h3 className="task-page-sub">{t('requests.counter.hers', { who: request.answeredByName ?? '—' })}</h3>
          <p dir="auto">{request.counterText}</p>
          {request.counterDate && (
            <p className="muted" data-testid={`${testId}-date`}>
              {t('requests.counter.herDate', { date: formatIraqDate(`${request.counterDate}T12:00:00Z`, loc) })}
            </p>
          )}
        </section>
      </div>
      <fieldset className="radio-group" data-testid={`${testId}-mode`}>
        <label className="check">
          <input type="radio" name={`${testId}-mode`} checked={mode === 'accept_counter'} onChange={() => setMode('accept_counter')} data-testid={`${testId}-mode-accept`} />
          {t('requests.counter.accept')}
        </label>
        <label className="check">
          <input type="radio" name={`${testId}-mode`} checked={mode === 'withdraw'} onChange={() => setMode('withdraw')} data-testid={`${testId}-mode-withdraw`} />
          {t('requests.counter.withdraw')}
        </label>
      </fieldset>
    </RequestDialog>
  )
}
