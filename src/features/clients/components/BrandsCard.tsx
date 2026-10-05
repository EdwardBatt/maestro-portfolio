import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DeleteButton } from '../../../components/Button'
import { isDuplicateBrandName } from '../../../lib/brands'
import { useBrandFiles, useBrands, useCreateBrand, useDeleteBrand, useUpdateBrand, type BrandRow } from '../api/clients-api'
import { Card, Chip, FieldLabel } from './parts'

/**
 * The brands of one client (CL-v3-02; the Brands tab of CV-02). A brand has a name and a short name
 * (ADR-0123 d.7) and four folders made the moment it is saved (ADR-0022). Anyone who manages clients
 * adds, renames and removes them; the database refuses a name the client already has.
 */
export function BrandsCard({ clientId, clientName, canEdit }: { clientId: string; clientName: string; canEdit: boolean }) {
  const { t } = useTranslation()
  const brands = useBrands()
  const files = useBrandFiles(clientId)
  const create = useCreateBrand()
  const update = useUpdateBrand()
  const remove = useDeleteBrand()
  const [name, setName] = useState('')
  const [short, setShort] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const mine = (brands.data ?? []).filter((b) => b.clientId === clientId)
  const fail = (e: unknown) => setError(t(isDuplicateBrandName(e) ? 'clients.brands.duplicate' : 'clients.saveFailed'))

  function add() {
    if (!name.trim()) return
    setError(null)
    create.mutate({ clientId, name, shortName: short }, {
      onSuccess: () => { setName(''); setShort('') },
      onError: fail,
    })
  }

  const last = mine[mine.length - 1]

  return (
    <Card
      title={t('clients.brands.title')}
      chip={<Chip tone="neutral">{t('clients.wizard.skippable')}</Chip>}
      count={t('clients.wizard.added', { count: mine.length })}
      testId="client-brands"
    >
      {mine.map((b) => (
        <div key={b.id} className="cl-item" data-testid={`client-brand-${b.id}`}>
          <span className="cl-swatch" aria-hidden="true" />
          {editing === b.id ? (
            <BrandEdit
              brand={b}
              busy={update.isPending || remove.isPending}
              onSave={(n, s) => update.mutate({ id: b.id, name: n, shortName: s }, { onSuccess: () => setEditing(null), onError: fail })}
              onRemove={() => remove.mutate(b.id, { onSuccess: () => setEditing(null), onError: () => setError(t('clients.brands.inUse')) })}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <>
              <div className="cl-item-text">
                <span className="cl-item-name">{b.name}</span>
                <span className="cl-item-meta">
                  {b.shortName
                    ? t('clients.brands.shortMeta', { short: b.shortName, shown: `${clientName} · ${b.shortName}` })
                    : t('clients.brands.noShortMeta', { shown: `${clientName} · ${b.name}` })}
                </span>
              </div>
              {canEdit && (
                <button type="button" className="cl-link" onClick={() => setEditing(b.id)} data-testid={`client-brand-edit-${b.id}`}>
                  {t('clients.edit')}
                </button>
              )}
            </>
          )}
        </div>
      ))}

      {last && <Folders folders={files.data?.get(last.id)?.folders ?? []} />}

      {canEdit && (
        <div className="cl-add">
          <div className="cl-field">
            <FieldLabel label={t('clients.brands.addAnother')} htmlFor="client-brand-name" />
            <input
              id="client-brand-name"
              className="cl-input"
              value={name}
              placeholder={t('clients.brands.namePlaceholder')}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') add() }}
              data-testid="client-brand-name"
            />
          </div>
          <div className="cl-field">
            <FieldLabel label={t('clients.brands.shortName')} htmlFor="client-brand-short" />
            <input
              id="client-brand-short"
              className="cl-input"
              value={short}
              placeholder="…"
              onChange={(e) => setShort(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') add() }}
              data-testid="client-brand-short"
            />
            <span className="cl-hint">{t('clients.brands.shortHint')}</span>
          </div>
          <button type="button" className="cl-back cl-add-go" onClick={add} disabled={!name.trim() || create.isPending} data-testid="client-brand-add">
            {t('clients.brands.add')}
          </button>
        </div>
      )}
      {error && <p className="cl-error" role="alert" data-testid="client-brands-error">{error}</p>}
      <p className="cl-footnote">
        {last ? t('clients.brands.foldersNote', { client: clientName, brand: last.shortName || last.name }) : t('clients.brands.foldersNoteNone')}
      </p>
    </Card>
  )
}

function Folders({ folders }: { folders: readonly { id: string; name: string; files: number }[] }) {
  const { t } = useTranslation()
  if (folders.length === 0) return null
  return (
    <div className="cl-folders" data-testid="client-brand-folders">
      {folders.map((f) => (
        <div key={f.id} className={`cl-folder${f.files > 0 ? ' has-files' : ''}`}>
          <span className="cl-folder-icon" aria-hidden="true" />
          <span className="cl-folder-name">{f.name}</span>
          <span className="cl-folder-count">{f.files > 0 ? t('clients.brands.files', { count: f.files }) : t('clients.brands.empty')}</span>
        </div>
      ))}
    </div>
  )
}

function BrandEdit({ brand, busy, onSave, onRemove, onCancel }: {
  brand: BrandRow
  busy: boolean
  onSave: (name: string, short: string | null) => void
  onRemove: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(brand.name)
  const [short, setShort] = useState(brand.shortName ?? '')
  const [armed, setArmed] = useState(false)
  return (
    <div className="cl-item-edit">
      <div className="cl-field">
        <FieldLabel label={t('clients.brands.name')} htmlFor={`brand-name-${brand.id}`} />
        <input id={`brand-name-${brand.id}`} className="cl-input" value={name} onChange={(e) => setName(e.target.value)} data-testid={`client-brand-edit-name-${brand.id}`} />
      </div>
      <div className="cl-field">
        <FieldLabel label={t('clients.brands.shortName')} htmlFor={`brand-short-${brand.id}`} />
        <input id={`brand-short-${brand.id}`} className="cl-input" value={short} onChange={(e) => setShort(e.target.value)} data-testid={`client-brand-edit-short-${brand.id}`} />
      </div>
      <button type="button" className="cl-link" disabled={busy || !name.trim()} onClick={() => onSave(name, short || null)} data-testid={`client-brand-save-${brand.id}`}>
        {t('clients.save')}
      </button>
      <button type="button" className="cl-link" onClick={onCancel}>{t('clients.cancel')}</button>
      <DeleteButton
        armed={armed}
        label={t('clients.brands.remove')}
        confirm={t('clients.confirmRemove')}
        disabled={busy}
        onClick={() => (armed ? onRemove() : setArmed(true))}
        data-testid={`client-brand-remove-${brand.id}`}
      />
    </div>
  )
}
