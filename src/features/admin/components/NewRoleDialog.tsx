import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCreateRole, type RoleRow } from '../api/roles-api'
import { DEFAULT_ROLE_SCOPE, ROLE_SCOPES, scopeHintKey, scopeLabelKey } from '../lib/role-scope.ts'
import type { RoleScope } from '../../../app/permissions'
import { Modal } from '../../../components/Modal'
import { Button } from '../../../components/Button'

const ROUTE_OPTIONS = ['/my-work', '/dashboard', '/campaigns', '/schedule', '/team']

/**
 * Create a role (L1.11). Deny-by-default: a fresh role holds NO grants until
 * ticked in the matrix — unless it starts as a copy of an existing role (the
 * "role of one" pattern: duplicate, adjust, assign).
 *
 * Reach is deny-by-default too, since ADR-0041. It used to be absent from this form entirely, so a
 * role took the column default — the WHOLE ORGANISATION — without anyone choosing it. It now starts
 * at "only themselves" and has to be widened on purpose. Copying another role copies its grants,
 * never its reach: the two are separate decisions and conflating them is how you inherit authority
 * you never looked at.
 */
export function NewRoleDialog({
  roles,
  onClose,
  onCreated,
}: {
  roles: RoleRow[]
  onClose: () => void
  onCreated: (roleId: string) => void
}) {
  const { t } = useTranslation()
  const createRole = useCreateRole()
  const [copyFrom, setCopyFrom] = useState('')
  const [defaultRoute, setDefaultRoute] = useState('/my-work')
  const [scope, setScope] = useState<RoleScope>(DEFAULT_ROLE_SCOPE)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const form = new FormData(e.currentTarget)
    const name = String(form.get('name') ?? '').trim()
    if (!name) {
      setError(t('admin.roles.nameRequired'))
      return
    }
    try {
      const id = await createRole.mutateAsync({
        name,
        description: String(form.get('description') ?? '').trim() || undefined,
        defaultRoute,
        scope,
        copyFromRoleId: copyFrom || null,
      })
      onCreated(id)
    } catch (err) {
      const code = (err as { code?: string }).code
      setError(t(code === '23505' ? 'admin.roles.duplicate' : 'admin.roles.createFailed'))
    }
  }

  return (
    <Modal onClose={onClose} card={false}>
      <form className="dialog" role="dialog" aria-modal="true" aria-label={t('admin.roles.newRole')}
        data-testid="new-role-dialog" onSubmit={onSubmit}>
        <h2>{t('admin.roles.newRole')}</h2>
        <p className="muted">{t('admin.roles.newRoleIntro')}</p>

        <label>
          {t('admin.roles.name')}
          <input name="name" data-testid="new-role-name" />
        </label>
        <label>
          {t('admin.roles.description')}
          <input name="description" data-testid="new-role-description" />
        </label>

        <div className="dialog-row">
          <label>
            {t('admin.roles.copyFrom')}
            <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} data-testid="new-role-copy">
              <option value="">{t('admin.roles.copyNone')}</option>
              {roles
                .filter((r) => r.status === 'active' && r.key !== 'client_portal')
                .map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
            </select>
          </label>
          <label>
            {t('admin.roles.defaultRoute')}
            <select value={defaultRoute} onChange={(e) => setDefaultRoute(e.target.value)} data-testid="new-role-route">
              {ROUTE_OPTIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
        </div>

        <label>
          {t('admin.roles.reach')}
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as RoleScope)}
            data-testid="new-role-scope"
          >
            {ROLE_SCOPES.map((s) => (
              <option key={s} value={s}>{t(scopeLabelKey(s))}</option>
            ))}
          </select>
        </label>
        <p className="muted" data-testid="new-role-scope-hint">{t(scopeHintKey(scope))}</p>

        {error && <p className="form-error" role="alert" data-testid="new-role-error">{error}</p>}

        <div className="dialog-actions">
          <Button variant="secondary" onClick={onClose} data-testid="new-role-cancel">
            {t('schedule.cancel')}
          </Button>
          <Button variant="primary" type="submit" disabled={createRole.isPending} data-testid="new-role-submit">
            {createRole.isPending ? t('admin.roles.creating') : t('admin.roles.create')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
