import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSaveSlaProfile, useSlaProfiles, type SlaProfile } from './api/sla-api'
import { NoticeDialog } from '../../components/Notice'
import { Button, IconButton } from '../../components/Button'

/**
 * SLA Profiles admin surface (ADR-0029, I7.3). List + create/edit reusable turnaround profiles.
 * Reached by sla_profiles:manage holders (leads + Power Admin). Attaching a profile to a
 * project/sub-task and the resolved "effective SLA" live on the Deliverables surface.
 *
 * I21 (ADR-0056 d.5): a profile carries NO axis. The work-type picker went with `work_types`, and
 * ADR-0053 d.4's department and deliverable-type pickers are `I20.3` — ⚠️-gated on ADR-0032 and not
 * agreed. So every profile is tenant-wide until that gate lifts, which is what
 * `app.effective_sla`'s remaining tiers resolve through. The screen says so rather than showing a
 * picker with nothing behind it (ADR-0056 d.14 assumed the gated columns would already exist).
 */
type Banner = { kind: 'ok' | 'error'; text: string }

export function SlaProfilesPage() {
  const { t } = useTranslation()
  const profiles = useSlaProfiles()
  const save = useSaveSlaProfile()

  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [hours, setHours] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(null)

  function reset() {
    setEditing(null); setName(''); setHours(''); setIsDefault(false)
  }
  function edit(p: SlaProfile) {
    setEditing(p.id); setName(p.name)
    setHours(p.turnaroundHours != null ? String(p.turnaroundHours) : ''); setIsDefault(p.isDefault)
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!name.trim()) return
    setBanner(null)
    save.mutate(
      {
        id: editing ?? undefined,
        name,
        turnaroundHours: hours ? Number(hours) : null,
        isDefault,
      },
      {
        onSuccess: () => { setBanner({ kind: 'ok', text: t('sla.saved') }); reset() },
        onError: (err) => {
          const code = (err as { code?: string }).code
          setBanner({ kind: 'error', text: t(code === '23505' ? 'sla.dupDefault' : 'sla.saveFailed') })
        },
      },
    )
  }

  const list = profiles.data ?? []

  return (
    <section data-testid="surface-sla-profiles">
      <header className="page-head">
        <h1>{t('sla.title')}</h1>
        <p className="muted">{t('sla.intro')}</p>
        {/* I21: said out loud rather than left for somebody to deduce from a missing dropdown. */}
        <p className="muted" data-testid="sla-no-axis">{t('sla.tenantWideOnly')}</p>
      </header>

      {banner && (
        <NoticeDialog
          kind={banner.kind === 'error' ? 'error' : 'success'}
          message={banner.text}
          testId="sla-banner"
          onClose={() => setBanner(null)}
        />
      )}

      {profiles.isLoading ? (
        <p className="muted" data-testid="sla-loading">…</p>
      ) : profiles.isError ? (
        <p className="form-error">{t('sla.loadFailed')}</p>
      ) : list.length === 0 ? (
        <div className="empty-state" data-testid="sla-empty"><p>{t('sla.empty')}</p></div>
      ) : (
        <table className="data-table" data-testid="sla-table">
          <thead>
            <tr>
              <th>{t('sla.colName')}</th>
              <th>{t('sla.colTurnaround')}</th>
              <th>{t('sla.colDefault')}</th>
              <th aria-label={t('sla.colActions')} />
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} data-testid={`sla-row-${p.id}`}>
                <td>{p.name}</td>
                <td>{p.turnaroundHours != null ? t('sla.hours', { n: p.turnaroundHours }) : '—'}</td>
                <td>{p.isDefault ? <span className="badge">{t('sla.default')}</span> : ''}</td>
                <td className="row-actions">
                  <IconButton icon="edit" label={t('sla.edit')} onClick={() => edit(p)} data-testid={`sla-edit-${p.id}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form className="org-add-form" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }} onSubmit={onSubmit} data-testid="sla-form">
        <h2 className="org-section-heading">{editing ? t('sla.editHeading') : t('sla.newHeading')}</h2>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('sla.colName')} data-testid="sla-name" />
        <input type="number" min="0.5" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} placeholder={t('sla.turnaroundPlaceholder')} data-testid="sla-hours" className="num-input" />
        <label className="check">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} data-testid="sla-default" />
          {t('sla.makeDefault')}
        </label>
        <Button variant="primary" type="submit" disabled={save.isPending} data-testid="sla-submit">
          {editing ? t('sla.save') : t('sla.add')}
        </Button>
        {editing && (
          <Button variant="secondary" onClick={reset} data-testid="sla-cancel">{t('schedule.cancel')}</Button>
        )}
      </form>
    </section>
  )
}
