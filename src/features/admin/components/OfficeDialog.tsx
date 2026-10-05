import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCreateOffice, useUpdateOffice, type OfficeRow } from '../api/org-api'
import { Modal } from '../../../components/Modal'
import { Button } from '../../../components/Button'

/** Curated IANA zones (Meridian's three offices first) + common regional/major ones. */
const TIMEZONES = [
  'Asia/Baghdad',
  'Asia/Dubai',
  'Africa/Cairo',
  'Asia/Riyadh',
  'Asia/Amman',
  'Asia/Beirut',
  'Asia/Kuwait',
  'Asia/Qatar',
  'Europe/Istanbul',
  'Europe/London',
  'UTC',
]

/** ISO weekday numbers (1=Mon..7=Sun) with their i18n label keys. */
const DAYS: { iso: number; key: string }[] = [
  { iso: 1, key: 'mon' },
  { iso: 2, key: 'tue' },
  { iso: 3, key: 'wed' },
  { iso: 4, key: 'thu' },
  { iso: 5, key: 'fri' },
  { iso: 6, key: 'sat' },
  { iso: 7, key: 'sun' },
]

/**
 * Create / edit an office (L1.5): name, IANA timezone, and the working week
 * (ADR-0005 — ISO weekday numbers). Writes are RLS-governed (organization:manage).
 * The working week matters because it drives the grid's non-working-day shading.
 */
export function OfficeDialog({
  office,
  onClose,
  onSaved,
  onError,
}: {
  office: OfficeRow | null
  onClose: () => void
  onSaved: () => void
  onError: (err: unknown) => void
}) {
  const { t } = useTranslation()
  const create = useCreateOffice()
  const update = useUpdateOffice()

  const [name, setName] = useState(office?.name ?? '')
  const [timezone, setTimezone] = useState(office?.timezone ?? 'Asia/Baghdad')
  const [days, setDays] = useState<number[]>(office?.workingDays ?? [1, 2, 3, 4, 5])
  const [error, setError] = useState<string | null>(null)

  const pending = create.isPending || update.isPending
  // Keep an unusual saved timezone available in the list.
  const tzOptions = office && !TIMEZONES.includes(office.timezone) ? [office.timezone, ...TIMEZONES] : TIMEZONES

  function toggleDay(iso: number) {
    setDays((ds) => (ds.includes(iso) ? ds.filter((x) => x !== iso) : [...ds, iso].sort((a, b) => a - b)))
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) return setError(t('admin.org.officeNameRequired'))
    if (days.length === 0) return setError(t('admin.org.workingDaysRequired'))
    const args = { name, timezone, workingDays: days }
    const done = { onSuccess: onSaved, onError }
    if (office) update.mutate({ id: office.id, ...args }, done)
    else create.mutate(args, done)
  }

  return (
    <Modal onClose={onClose} card={false}>
      <form className="dialog" role="dialog" aria-modal="true" aria-label={t('admin.org.offices')}
        data-testid="office-dialog" onSubmit={submit}>
        <h2>{office ? t('admin.org.editOffice') : t('admin.org.newOffice')}</h2>

        <div className="dialog-row">
          <label>
            {t('admin.org.officeName')}
            <input value={name} onChange={(e) => setName(e.target.value)} data-testid="office-name" />
          </label>
          <label>
            {t('admin.org.timezone')}
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)} data-testid="office-timezone">
              {tzOptions.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </label>
        </div>

        <fieldset className="day-picker" data-testid="office-days">
          <legend>{t('admin.org.workingDays')}</legend>
          {DAYS.map((d) => (
            <label key={d.iso} className={days.includes(d.iso) ? 'on' : ''}>
              <input type="checkbox" checked={days.includes(d.iso)} onChange={() => toggleDay(d.iso)} data-testid={`office-day-${d.iso}`} />
              <span>{t(`admin.org.days.${d.key}`)}</span>
            </label>
          ))}
        </fieldset>

        {error && <p className="form-error" role="alert" data-testid="office-error">{error}</p>}

        <div className="dialog-actions">
          <Button variant="secondary" onClick={onClose} data-testid="office-cancel">{t('schedule.cancel')}</Button>
          <Button variant="primary" type="submit" disabled={pending} data-testid="office-submit">
            {pending ? t('admin.resources.saving') : t('admin.resources.save')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
