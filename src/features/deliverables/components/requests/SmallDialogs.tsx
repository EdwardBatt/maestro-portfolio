import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../../components/Button'
import { computeLeadTime } from '../../../../lib/campaigns/lead-time'
import { useWorkCalendar, useWorkClientId } from '../../../../lib/calendar/client-calendar'
import { suggestedNames, useClientPeople } from '../../../../lib/clients/people'
import { formatCalendarDay, iraqDay } from '../../../../lib/time/iraq'
import { isRealDay } from '../../../../lib/time/real-day'
import { ACK_VIA, useClearInput, useRecordScopeAcknowledgement, type AckVia } from '../../api/requests-api'
import type { ScopeRow } from '../../lib/needs-you-requests'
import { errorText } from '../../lib/requests-text'
import { RequestDialog } from './RequestDialog'

/**
 * Untimed round (plan View 6, ADR-0106 d.2): "You did not time this task. Its full allocated time
 * (32h) will be recorded and a KPI penalty may apply." Send anyway · Cancel. Sending anyway records
 * the allocation, marked untimed; the reviewers are told as on any send, and the owner that it was
 * untimed (`untimed_round`).
 */
export function UntimedDialog({
  allocatedHours,
  reviewerNames,
  busy,
  error,
  onSend,
  onCancel,
  testId = 'untimed',
}: {
  allocatedHours: number | null
  reviewerNames: string | null
  busy: boolean
  error: string | null
  onSend: () => void
  onCancel: () => void
  testId?: string
}) {
  const { t } = useTranslation()
  return (
    <RequestDialog
      testId={testId}
      title={t('requests.untimed.title')}
      told={[reviewerNames, t('requests.untimed.ownerTold')].filter(Boolean).join(' · ')}
      error={error}
      onClose={onCancel}
      actions={
        <>
          <Button variant="primary" busy={busy} disabled={busy} onClick={onSend} data-testid={`${testId}-send`}>
            {t('requests.untimed.sendAnyway')}
          </Button>
          <Button variant="secondary" onClick={onCancel} data-testid={`${testId}-cancel`}>{t('common.cancel')}</Button>
        </>
      }
    >
      <p className="cell-warn" data-testid={`${testId}-text`}>
        {allocatedHours != null ? t('requests.untimed.text', { hours: allocatedHours }) : t('requests.untimed.textNoHours')}
      </p>
    </RequestDialog>
  )
}

/**
 * Mark received (plan View 6, Q16): confirms the input has arrived; the input is cleared. Whoever
 * waited on it is told by the server (the addendum's `task_unblocked`).
 */
export function MarkReceivedDialog({
  inputId,
  what,
  from,
  piece,
  onClose,
  testId = 'received',
}: {
  inputId: string
  what: string
  from: string | null
  piece: string | null
  onClose: () => void
  testId?: string
}) {
  const { t } = useTranslation()
  const clear = useClearInput()
  const [error, setError] = useState<string | null>(null)
  return (
    <RequestDialog
      testId={testId}
      title={t('requests.received.title')}
      subtitle={piece}
      told={t('requests.received.told')}
      error={error}
      onClose={onClose}
      actions={
        <>
          <Button
            variant="primary"
            busy={clear.isPending}
            disabled={clear.isPending}
            onClick={() => clear.mutate(inputId, { onSuccess: onClose, onError: (e) => setError(errorText(e, t('requests.failed'))) })}
            data-testid={`${testId}-send`}
          >
            {t('requests.received.confirm')}
          </Button>
          <Button variant="secondary" onClick={onClose} data-testid={`${testId}-cancel`}>{t('common.cancel')}</Button>
        </>
      }
    >
      <p data-testid={`${testId}-what`}>
        <span dir="auto">{what}</span>
        {from ? <span className="muted"> · {t('requests.received.from', { who: from })}</span> : null}
      </p>
    </RequestDialog>
  )
}

/** A `datetime-local` value for now, in the browser's clock (the field the person edits). */
function nowLocal(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * Record the acknowledgement (plan View 3, Q33; SJ-v3-S2): the client's answer to a reduced scope,
 * recorded on the job — who answered, how, when, what they said (`scope_acknowledgements`). The two
 * numbers it records (the days the type needs, the working days the job had when it was taken) are
 * counted with the intake's own rule (`computeLeadTime`), from the job's creation day; the form
 * never asks for them. Nobody is sent a message: it is a record.
 */
export function ScopeAckDialog({ job, onClose, testId = 'scope-ack' }: { job: ScopeRow; onClose: () => void; testId?: string }) {
  const { t } = useTranslation()
  const record = useRecordScopeAcknowledgement()
  const [by, setBy] = useState('')
  const [via, setVia] = useState<AckVia>('whatsapp')
  const [at, setAt] = useState(nowLocal)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  // ADR-0123 d.3: counted on the client's working week.
  const { calendar } = useWorkCalendar({ campaignId: job.campaignId })
  // ADR-0123 d.4: the client's people, those who sign off first; a typed name is still accepted.
  const { clientId } = useWorkClientId({ campaignId: job.campaignId })
  const signers = suggestedNames(useClientPeople(clientId).data ?? [], 'signsOff')
  const lead = job.dueAt ? computeLeadTime(iraqDay(job.dueAt), job.leadTimeHours, iraqDay(job.createdAt), calendar) : null
  // I66.8: a mistyped moment (a five-digit year) is caught here, never handed to toISOString.
  const atOk = isRealDay(at.slice(0, 10)) && !Number.isNaN(Date.parse(at))
  const ready = !!lead && by.trim().length > 0 && atOk

  function send() {
    if (!lead) return
    setError(null)
    record.mutate(
      {
        campaignId: job.campaignId,
        needsDays: lead.needsDays,
        hasDays: lead.hasDays,
        by,
        via,
        at: new Date(at).toISOString(),
        note,
      },
      { onSuccess: onClose, onError: (e) => setError(errorText(e, t('requests.failed'))) },
    )
  }

  return (
    <RequestDialog
      testId={testId}
      title={t('requests.scope.title')}
      subtitle={job.name}
      told={null}
      error={error}
      onClose={onClose}
      actions={
        <>
          <Button variant="primary" busy={record.isPending} disabled={!ready || record.isPending} onClick={send} data-testid={`${testId}-send`}>
            {t('requests.scope.record')}
          </Button>
          <Button variant="secondary" onClick={onClose} data-testid={`${testId}-cancel`}>{t('common.cancel')}</Button>
        </>
      }
    >
      {lead ? (
        <p className="muted" data-testid={`${testId}-days`}>{t('requests.scope.days', { needs: lead.needsDays, has: lead.hasDays })}</p>
      ) : (
        <p className="form-error" data-testid={`${testId}-no-date`}>{t('requests.scope.noDate')}</p>
      )}
      <label>
        {t('requests.scope.by')}
        <input type="text" value={by} onChange={(e) => setBy(e.target.value)} list={`${testId}-people`} data-testid={`${testId}-by`} dir="auto" />
        <datalist id={`${testId}-people`} data-testid={`${testId}-people`}>
          {signers.map((n) => <option key={n} value={n} />)}
        </datalist>
      </label>
      <label>
        {t('requests.scope.via')}
        <select value={via} onChange={(e) => setVia(e.target.value as AckVia)} data-testid={`${testId}-via`}>
          {ACK_VIA.map((v) => (
            <option key={v} value={v}>{t(`requests.scope.viaOption.${v}`)}</option>
          ))}
        </select>
      </label>
      <label>
        {t('requests.scope.at')}
        <span className="date-field">
          <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} aria-invalid={(!!at && !atOk) || undefined} data-testid={`${testId}-at`} />
          {atOk && <span className="date-field-day">{`${formatCalendarDay(at.slice(0, 10))}, ${at.slice(11, 16)}`}</span>}
          {!!at && !atOk && <span className="field-error" role="alert" data-testid={`${testId}-at-wrong`}>{t('dateField.wrong')}</span>}
        </span>
      </label>
      <label>
        {t('requests.scope.note')}
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} data-testid={`${testId}-note`} dir="auto" />
      </label>
    </RequestDialog>
  )
}
