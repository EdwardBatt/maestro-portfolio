import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '../../components/Modal'
import {
  useCreateLeave,
  useLeaveResources,
  useUpdateLeave,
  type LeaveCategory,
  type LeaveEntry,
  type LeaveKind,
} from './api/leave-api'
import { Button } from '../../components/Button'
import { DateField } from '../../components/DateField'

// 'holiday' is gone from here (ADR-0079): a holiday belongs to the OFFICE and is declared on the
// closures side of the page. Editing a legacy holiday row keeps its kind; nothing new is written.
const KINDS: LeaveKind[] = ['leave']
const CATEGORIES: LeaveCategory[] = ['planned', 'emergency', 'sick', 'unpaid']

/** timestamptz ISO → the YYYY-MM-DD a date input expects. */
const toDateInput = (iso: string) => iso.slice(0, 10)

/**
 * Record / edit a leave or holiday entry (L1.7, ADR-0013). Writes a
 * `resource_unavailability` row via the `leave:manage` grant. Category
 * (planned/emergency/sick/unpaid) applies to leave only — holidays clear it.
 * Day-precision dates: start of the first day to end of the last (inclusive).
 */
export function LeaveDialog({
  entry,
  onClose,
  onSaved,
  onError,
}: {
  entry: LeaveEntry | null
  onClose: () => void
  onSaved: () => void
  onError: (err: unknown) => void
}) {
  const { t } = useTranslation()
  const resources = useLeaveResources()
  const create = useCreateLeave()
  const update = useUpdateLeave()

  const [resourceId, setResourceId] = useState(entry?.resourceId ?? '')
  const [kind, setKind] = useState<LeaveKind>(entry?.kind ?? 'leave')
  const [category, setCategory] = useState<LeaveCategory>(entry?.category ?? 'planned')
  const [startDate, setStartDate] = useState(entry ? toDateInput(entry.startsAt) : '')
  const [endDate, setEndDate] = useState(entry ? toDateInput(entry.endsAt) : '')
  const [reason, setReason] = useState(entry?.reason ?? '')
  const [error, setError] = useState<string | null>(null)

  const pending = create.isPending || update.isPending

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!resourceId) return setError(t('leave.resourceRequired'))
    if (!startDate || !endDate) return setError(t('leave.datesRequired'))
    if (endDate < startDate) return setError(t('leave.endBeforeStart'))
    const args = {
      resourceId,
      kind,
      category: kind === 'leave' ? category : null,
      startsAt: `${startDate}T00:00:00`,
      endsAt: `${endDate}T23:59:59`,
      reason,
    }
    const done = { onSuccess: onSaved, onError }
    if (entry) update.mutate({ id: entry.id, ...args }, done)
    else create.mutate(args, done)
  }

  const kinds: LeaveKind[] = entry?.kind === 'holiday' ? [...KINDS, 'holiday'] : KINDS

  return (
    <Modal onClose={onClose} card={false}>
      <form className="dialog" role="dialog" aria-modal="true" aria-label={t('leave.title')}
        data-testid="leave-dialog" onSubmit={submit}>
        <h2>{entry ? t('leave.editEntry') : t('leave.newEntry')}</h2>

        <div className="dialog-row">
          <label>
            {t('leave.person')}
            <select value={resourceId} onChange={(e) => setResourceId(e.target.value)} data-testid="leave-resource">
              <option value="" disabled>{t('leave.selectPerson')}</option>
              {(resources.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </label>
          <label>
            {t('leave.kind')}
            <select value={kind} onChange={(e) => setKind(e.target.value as LeaveKind)} data-testid="leave-kind">
              {kinds.map((k) => (
                <option key={k} value={k}>{t(`leave.kinds.${k}`)}</option>
              ))}
            </select>
          </label>
        </div>

        {kind === 'leave' && (
          <label>
            {t('leave.category')}
            <select value={category} onChange={(e) => setCategory(e.target.value as LeaveCategory)} data-testid="leave-category">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{t(`leave.categories.${c}`)}</option>
              ))}
            </select>
          </label>
        )}

        <div className="dialog-row">
          <label>
            {t('leave.from')}
            <DateField value={startDate} onChange={(v) => setStartDate(v)} data-testid="leave-start" />
          </label>
          <label>
            {t('leave.to')}
            <DateField value={endDate} onChange={(v) => setEndDate(v)} data-testid="leave-end" />
          </label>
        </div>

        <label>
          {t('leave.reason')}
          <input value={reason} onChange={(e) => setReason(e.target.value)} data-testid="leave-reason" />
        </label>

        {error && <p className="form-error" role="alert" data-testid="leave-error">{error}</p>}

        <div className="dialog-actions">
          <Button variant="secondary" onClick={onClose} data-testid="leave-cancel">{t('schedule.cancel')}</Button>
          <Button variant="primary" type="submit" disabled={pending} data-testid="leave-submit">
            {pending ? t('admin.resources.saving') : t('admin.resources.save')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
