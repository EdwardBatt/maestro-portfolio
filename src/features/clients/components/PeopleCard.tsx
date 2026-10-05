import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DeleteButton } from '../../../components/Button'
import {
  REACH,
  useAddContact,
  useClientContacts,
  useDeleteContact,
  useUpdateContact,
  type ContactRow,
  type Reach,
} from '../api/clients-api'
import avatar from '../assets/contact-avatar.svg'
import { Card, Chip, FieldLabel, MultiSelect } from './parts'

/**
 * The people at the client (CL-v3-03; the People tab of CV-02) — records, not logins (ADR-0123 d.4).
 * Each says how to reach them and three things: may ask for work (REQUESTER), signs off (APPROVER),
 * is copied (COPIED). The three chips on a row are its switches.
 */
export function PeopleCard({ clientId, canEdit }: { clientId: string; canEdit: boolean }) {
  const { t } = useTranslation()
  const contacts = useClientContacts(clientId)
  const add = useAddContact()
  const update = useUpdateContact()
  const remove = useDeleteContact()
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [reach, setReach] = useState<Reach[]>(['whatsapp', 'email'])
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rows = contacts.data ?? []
  const reachOptions = REACH.map((r) => ({ value: r, label: t(`clients.people.reach.${r}`) }))
  const fail = () => setError(t('clients.saveFailed'))

  function addOne() {
    if (!name.trim()) return
    setError(null)
    add.mutate(
      { clientId, sortOrder: rows.length, name, roleTitle: role, reach, canRequest: true, signsOff: false, isCopied: false },
      { onSuccess: () => { setName(''); setRole('') }, onError: fail },
    )
  }

  const flag = (c: ContactRow, key: 'canRequest' | 'signsOff' | 'isCopied', label: string, id: string) => (
    <button
      type="button"
      className={`cl-chip ${c[key] ? 'tone-purple' : 'tone-off'}`}
      aria-pressed={c[key]}
      disabled={!canEdit || update.isPending}
      onClick={() => update.mutate({ ...c, clientId, [key]: !c[key] }, { onError: fail })}
      data-testid={`client-contact-${id}-${c.id}`}
    >
      {label}
    </button>
  )

  return (
    <Card
      title={t('clients.people.title')}
      chip={<Chip tone="neutral">{t('clients.wizard.skippable')}</Chip>}
      count={t('clients.wizard.added', { count: rows.length })}
      testId="client-people"
    >
      {rows.map((c) => (
        <div key={c.id} className="cl-item is-person" data-testid={`client-contact-${c.id}`}>
          <img className="cl-avatar" src={avatar} width={32} height={32} alt="" />
          {editing === c.id ? (
            <ContactEdit
              contact={c}
              reachOptions={reachOptions}
              busy={update.isPending || remove.isPending}
              onSave={(patch) => update.mutate({ ...c, ...patch, clientId }, { onSuccess: () => setEditing(null), onError: fail })}
              onRemove={() => remove.mutate({ id: c.id, clientId }, { onSuccess: () => setEditing(null), onError: fail })}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <>
              <div className="cl-item-text">
                <span className="cl-item-name">{c.name}</span>
                <span className="cl-item-meta">{[c.roleTitle, ...c.reach.map((r) => t(`clients.people.reach.${r}`))].filter(Boolean).join(' · ')}</span>
              </div>
              {flag(c, 'canRequest', t('clients.people.requester'), 'requester')}
              {flag(c, 'signsOff', t('clients.people.approver'), 'approver')}
              {flag(c, 'isCopied', t('clients.people.copied'), 'copied')}
              {canEdit && (
                <button type="button" className="cl-link" onClick={() => setEditing(c.id)} data-testid={`client-contact-edit-${c.id}`}>
                  {t('clients.edit')}
                </button>
              )}
            </>
          )}
        </div>
      ))}

      {canEdit && (
        <div className="cl-add">
          <div className="cl-field">
            <FieldLabel label={t('clients.people.name')} htmlFor="client-contact-name" />
            <input id="client-contact-name" className="cl-input" value={name} placeholder="…" onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addOne() }} data-testid="client-contact-name" />
          </div>
          <div className="cl-field">
            <FieldLabel label={t('clients.people.role')} htmlFor="client-contact-role" />
            <input id="client-contact-role" className="cl-input" value={role} placeholder="…" onChange={(e) => setRole(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addOne() }} data-testid="client-contact-role" />
          </div>
          <div className="cl-field">
            <FieldLabel label={t('clients.people.reachOn')} htmlFor="client-contact-reach" />
            <MultiSelect id="client-contact-reach" values={reach} options={reachOptions} onChange={setReach} placeholder="…" testId="client-contact-reach" />
            <span className="cl-hint">{t('clients.people.reachHint')}</span>
          </div>
          <button type="button" className="cl-back cl-add-go" onClick={addOne} disabled={!name.trim() || add.isPending} data-testid="client-contact-add">
            {t('clients.people.add')}
          </button>
        </div>
      )}
      {error && <p className="cl-error" role="alert">{error}</p>}
      <p className="cl-footnote">{t('clients.people.note')}</p>
    </Card>
  )
}

function ContactEdit({ contact, reachOptions, busy, onSave, onRemove, onCancel }: {
  contact: ContactRow
  reachOptions: { value: Reach; label: string }[]
  busy: boolean
  onSave: (patch: { name: string; roleTitle: string | null; reach: Reach[] }) => void
  onRemove: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(contact.name)
  const [role, setRole] = useState(contact.roleTitle ?? '')
  const [reach, setReach] = useState<Reach[]>(contact.reach)
  const [armed, setArmed] = useState(false)
  return (
    <div className="cl-item-edit">
      <div className="cl-field">
        <FieldLabel label={t('clients.people.name')} htmlFor={`contact-name-${contact.id}`} />
        <input id={`contact-name-${contact.id}`} className="cl-input" value={name} onChange={(e) => setName(e.target.value)} data-testid={`client-contact-edit-name-${contact.id}`} />
      </div>
      <div className="cl-field">
        <FieldLabel label={t('clients.people.role')} htmlFor={`contact-role-${contact.id}`} />
        <input id={`contact-role-${contact.id}`} className="cl-input" value={role} onChange={(e) => setRole(e.target.value)} />
      </div>
      <div className="cl-field">
        <FieldLabel label={t('clients.people.reachOn')} htmlFor={`contact-reach-${contact.id}`} />
        <MultiSelect id={`contact-reach-${contact.id}`} values={reach} options={reachOptions} onChange={setReach} placeholder="…" testId={`client-contact-edit-reach-${contact.id}`} />
      </div>
      <button type="button" className="cl-link" disabled={busy || !name.trim()} onClick={() => onSave({ name, roleTitle: role || null, reach })} data-testid={`client-contact-save-${contact.id}`}>
        {t('clients.save')}
      </button>
      <button type="button" className="cl-link" onClick={onCancel}>{t('clients.cancel')}</button>
      <DeleteButton
        armed={armed}
        label={t('clients.people.remove')}
        confirm={t('clients.confirmRemove')}
        disabled={busy}
        onClick={() => (armed ? onRemove() : setArmed(true))}
        data-testid={`client-contact-remove-${contact.id}`}
      />
    </div>
  )
}
