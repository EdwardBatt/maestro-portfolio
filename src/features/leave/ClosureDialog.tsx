import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, ModalFooter, ModalHeader } from '../../components/Modal'
import { Button } from '../../components/Button'
import {
  useClosureOffices,
  useCreateClosure,
  useUpdateClosure,
  type ClosureKind,
  type OfficeClosure,
} from './api/leave-api'
import { DateField } from '../../components/DateField'

const KINDS: ClosureKind[] = ['public_holiday', 'company_closed']

/**
 * Declare or edit an office closure (ADR-0079 d.7): a public holiday or a company-closed day.
 *
 * The form asks for an OFFICE, not a person — that is the visible shape of d.1. Whole days in the
 * office's own calendar, entered by hand (d.8: no import; Eid is confirmed by announcement close to
 * the day, and a feed that is usually right is worse than none).
 */
export function ClosureDialog({
  entry,
  onClose,
  onSaved,
  onError,
}: {
  entry: OfficeClosure | null
  onClose: () => void
  /** Called with the saved row's id so the page can list what is now stranded (d.6). */
  /** The saved row's id and its name — the page names the stranded list after it. */
  onSaved: (id: string, name: string) => void
  onError: (err: unknown) => void
}) {
  const { t } = useTranslation()
  const offices = useClosureOffices()
  const create = useCreateClosure()
  const update = useUpdateClosure()

  const [officeId, setOfficeId] = useState(entry?.officeId ?? '')
  const [kind, setKind] = useState<ClosureKind>(entry?.kind ?? 'public_holiday')
  const [name, setName] = useState(entry?.name ?? '')
  const [startsOn, setStartsOn] = useState(entry?.startsOn ?? '')
  const [endsOn, setEndsOn] = useState(entry?.endsOn ?? '')
  const [error, setError] = useState<string | null>(null)

  const pending = create.isPending || update.isPending
  const officeList = offices.data ?? []
  // One office only: nothing to choose, so it is chosen.
  const effectiveOffice = officeId || (officeList.length === 1 ? officeList[0].id : '')

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!effectiveOffice) return setError(t('leave.closures.officeRequired'))
    if (!name.trim()) return setError(t('leave.closures.nameRequired'))
    if (!startsOn) return setError(t('leave.datesRequired'))
    const end = endsOn || startsOn
    if (end < startsOn) return setError(t('leave.endBeforeStart'))
    const args = { officeId: effectiveOffice, kind, name, startsOn, endsOn: end }
    const done = { onSuccess: (row: { id: string }) => onSaved(row.id, name), onError }
    if (entry) update.mutate({ id: entry.id, ...args }, done)
    else create.mutate(args, done)
  }

  return (
    <Modal onClose={onClose} labelledById="closure-title" testId="closure-dialog">
      <form onSubmit={submit}>
        <ModalHeader
          id="closure-title"
          eyebrow={t('leave.closures.eyebrow')}
          title={entry ? t('leave.closures.edit') : t('leave.closures.new')}
          subtitle={t('leave.closures.subtitle')}
        />
        <div className="modal-body">
          <div className="dialog-row">
            <label>
              {t('leave.closures.office')}
              <select value={effectiveOffice} onChange={(e) => setOfficeId(e.target.value)} data-testid="closure-office">
                <option value="" disabled>{t('leave.closures.selectOffice')}</option>
                {officeList.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </label>
            <label>
              {t('leave.kind')}
              <select value={kind} onChange={(e) => setKind(e.target.value as ClosureKind)} data-testid="closure-kind">
                {KINDS.map((k) => (
                  <option key={k} value={k}>{t(`leave.closures.kinds.${k}`)}</option>
                ))}
              </select>
            </label>
          </div>

          <label>
            {t('leave.closures.name')}
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('leave.closures.namePlaceholder')} data-testid="closure-name" />
          </label>

          <div className="dialog-row">
            <label>
              {t('leave.from')}
              <DateField value={startsOn} onChange={(v) => setStartsOn(v)} data-testid="closure-start" />
            </label>
            <label>
              {t('leave.to')}
              <DateField value={endsOn} onChange={(v) => setEndsOn(v)} data-testid="closure-end" />
            </label>
          </div>

          {error && <p className="form-error" role="alert" data-testid="closure-error">{error}</p>}
        </div>
        <ModalFooter note={t('leave.closures.note')}>
          <Button type="submit" variant="primary" busy={pending} data-testid="closure-submit">
            {entry ? t('admin.resources.save') : t('leave.closures.declare')}
          </Button>
          <Button variant="secondary" onClick={onClose} data-testid="closure-cancel">
            {t('common.cancel')}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  )
}
