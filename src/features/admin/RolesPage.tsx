import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NewRoleDialog } from './components/NewRoleDialog'
import {
  useRolesAdmin,
  usePermissionCatalog,
  useRoleGrants,
  useRoleHolderCounts,
  useToggleGrant,
  useUpdateRole,
  type RoleRow,
} from './api/roles-api'
import { ROLE_SCOPES, isWidening, scopeHintKey, scopeLabelKey } from './lib/role-scope.ts'
import { isBuiltInRole, roleDescription, roleName } from '../../lib/roles/role-text.ts'
import type { RoleScope } from '../../app/permissions'
import { NoticeDialog } from '../../components/Notice'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/Button'

// I66.7: every page a role can land on; /admin now opens the Dashboard (ADR-0122 d.6), so it is not offered.
const ROUTE_OPTIONS = ['/my-work', '/dashboard', '/campaigns', '/schedule', '/team', '/portal']

/**
 * Roles & permissions (L1.11, ADR-0008): the rules screen. Left — the
 * tenant's roles; right — the selected role's details and its deny-by-default
 * grants matrix. System roles (Power Admin, Client Portal) render read-only:
 * the database fences them, the UI explains them.
 *
 * REACH (ADR-0041). A role's permissions are only half of what it can do; the other half is how far
 * they go, and until now this screen never showed it — the column defaulted to the whole
 * organisation, so a role created here silently spanned the company. Reach is now on the list, on
 * the form, and changing it on a live role costs a confirmation naming how many people hold it,
 * because it changes what all of them can touch the moment it saves.
 */
export function RolesPage() {
  const { t } = useTranslation()
  const roles = useRolesAdmin()
  const catalog = usePermissionCatalog()
  const updateRole = useUpdateRole()
  const holders = useRoleHolderCounts()
  const toggleGrant = useToggleGrant()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [banner, setBanner] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  /** Held until the reach change is confirmed — see onDetailSave. */
  const [pendingSave, setPendingSave] = useState<
    { name: string; description: string | null; defaultRoute: string; scope: RoleScope } | null
  >(null)

  const selected: RoleRow | null = roles.data?.find((r) => r.id === selectedId) ?? null
  const grants = useRoleGrants(selectedId)

  // select the first role once loaded
  useEffect(() => {
    if (!selectedId && roles.data?.length) setSelectedId(roles.data[0].id)
  }, [roles.data, selectedId])

  /** catalog grouped by resource for matrix rows */
  const grouped = useMemo(() => {
    const map = new Map<string, { action: string; description: string }[]>()
    for (const entry of catalog.data ?? []) {
      const list = map.get(entry.resource) ?? []
      list.push({ action: entry.action, description: entry.description })
      map.set(entry.resource, list)
    }
    return [...map.entries()]
  }, [catalog.data])

  function onToggle(resource: string, action: string, granted: boolean) {
    if (!selected) return
    setBanner(null)
    toggleGrant.mutate(
      { roleId: selected.id, resource, action, granted },
      {
        onSuccess: () => setBanner({ kind: 'ok', text: t('admin.roles.saved') }),
        onError: () => setBanner({ kind: 'error', text: t('admin.roles.updateFailed') }),
      },
    )
  }

  function saveDetail(
    patch: { name: string; description: string | null; defaultRoute: string; scope: RoleScope },
  ) {
    if (!selected) return
    setBanner(null)
    updateRole.mutate(
      { roleId: selected.id, ...patch },
      {
        onSuccess: () => setBanner({ kind: 'ok', text: t('admin.roles.saved') }),
        onError: () => setBanner({ kind: 'error', text: t('admin.roles.updateFailed') }),
      },
    )
  }

  function onDetailSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!selected) return
    const form = new FormData(e.currentTarget)
    // A built-in role renders its name and description as text rather than inputs, so the form
    // carries neither — the stored values are sent back untouched. Reading them as '' would either
    // abort the save on the empty-name guard or blank the description on the way past.
    const name = String(form.get('name') ?? selected.name).trim()
    if (!name) return
    const patch = {
      name,
      description: form.has('description')
        ? String(form.get('description') ?? '').trim() || null
        : selected.description,
      defaultRoute: String(form.get('defaultRoute') ?? selected.defaultRoute),
      scope: String(form.get('scope') ?? selected.scope) as RoleScope,
    }
    // ADR-0041 d.3: reach is the one field here that changes what OTHER people can do, and it takes
    // effect the moment it saves. Everything else on this form is cosmetic by comparison, so only
    // this one stops to ask — and it says how many people it is about to affect.
    if (patch.scope !== selected.scope) {
      setPendingSave(patch)
      return
    }
    saveDetail(patch)
  }

  function onArchiveToggle() {
    if (!selected) return
    setBanner(null)
    updateRole.mutate(
      { roleId: selected.id, status: selected.status === 'active' ? 'archived' : 'active' },
      {
        onSuccess: () => setBanner({ kind: 'ok', text: t('admin.roles.saved') }),
        onError: () => setBanner({ kind: 'error', text: t('admin.roles.archiveFailed') }),
      },
    )
  }

  if (roles.isLoading) return <p data-testid="roles-loading">…</p>
  if (roles.isError) return <p className="form-error">{t('admin.roles.loadFailed')}</p>

  return (
    <section data-testid="surface-roles">
      <header className="schedule-bar">
        <h1>{t('admin.roles.title')}</h1>
        <Button variant="primary" onClick={() => setCreating(true)} data-testid="role-create-open">
          + {t('admin.roles.newRole')}
        </Button>
      </header>

      {/* Edward, 29 Aug: an action reports what it did in front of the person, not as
          a strip above the page. Same rule `I12.9` set for the schedule refusal. */}
      {banner && (
        <NoticeDialog
          kind={banner.kind === 'error' ? 'error' : 'success'}
          message={banner.text}
          testId="roles-banner"
          onClose={() => setBanner(null)}
        />
      )}

      <div className="roles-layout">
        <ul className="roles-list" data-testid="roles-list">
          {(roles.data ?? []).map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className={`roles-list-item ${r.id === selectedId ? 'active' : ''} ${r.status === 'archived' ? 'archived' : ''}`}
                onClick={() => setSelectedId(r.id)}
                data-testid={`role-item-${r.key}`}
              >
                <span>{roleName(t, r)}</span>
                <span className="badge badge-reach" data-testid={`role-reach-${r.key}`}>
                  {t(scopeLabelKey(r.scope))}
                </span>
                {r.isSystem && <span className="badge badge-system">{t('admin.roles.system')}</span>}
                {r.status === 'archived' && <span className="badge badge-inactive">{t('admin.roles.archived')}</span>}
              </button>
            </li>
          ))}
        </ul>

        {selected && (
          <div className="roles-detail">
            <form onSubmit={onDetailSave} className="roles-detail-form" data-testid="role-detail-form">
              <div className="dialog-row">
                {/* A built-in role's name and description are product copy and follow the interface
                    language (see lib/role-text) — Edward, 6 Sep, reading English on the Arabic
                    Roles screen. They are shown rather than typed, because a stored rename and a
                    translation cannot both be right and the stored one would read correctly in one
                    language only. Everything that decides what the role can DO stays editable. */}
                {isBuiltInRole(selected.key) ? (
                  <div className="role-builtin-name">
                    <span className="muted">{t('admin.roles.name')}</span>
                    <p data-testid="role-name-fixed">
                      {roleName(t, selected)}{' '}
                      <span className="badge badge-system">{t('admin.roles.builtIn')}</span>
                    </p>
                  </div>
                ) : (
                  <label>
                    {t('admin.roles.name')}
                    <input name="name" key={selected.id} defaultValue={selected.name} data-testid="role-name" />
                  </label>
                )}
                <label>
                  {t('admin.roles.defaultRoute')}
                  <select name="defaultRoute" key={`dr-${selected.id}`} defaultValue={selected.defaultRoute} disabled={selected.isSystem} data-testid="role-default-route">
                    {ROUTE_OPTIONS.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </label>
              </div>
              {isBuiltInRole(selected.key) ? (
                <div className="role-builtin-description">
                  <span className="muted">{t('admin.roles.description')}</span>
                  <p data-testid="role-description-fixed">{roleDescription(t, selected) ?? '—'}</p>
                  <p className="muted" data-testid="role-builtin-note">{t('admin.roles.builtInNote')}</p>
                </div>
              ) : (
                <label>
                  {t('admin.roles.description')}
                  <input name="description" key={`d-${selected.id}`} defaultValue={selected.description ?? ''} data-testid="role-description" />
                </label>
              )}
              <label>
                {t('admin.roles.reach')}
                <select
                  name="scope"
                  key={`sc-${selected.id}`}
                  defaultValue={selected.scope}
                  disabled={selected.isSystem}
                  data-testid="role-scope"
                >
                  {ROLE_SCOPES.map((sc) => (
                    <option key={sc} value={sc}>{t(scopeLabelKey(sc))}</option>
                  ))}
                </select>
              </label>
              <p className="muted" data-testid="role-scope-hint">{t(scopeHintKey(selected.scope))}</p>
              {!selected.isSystem && (
                <div className="dialog-actions">
                  {selected.status === 'active' ? (
                    <Button variant="link" className="danger" icon="archive" onClick={onArchiveToggle} data-testid="role-archive">
                      {t('admin.roles.archive')}
                    </Button>
                  ) : (
                    <Button variant="link" icon="undo" onClick={onArchiveToggle} data-testid="role-archive">
                      {t('admin.roles.restore')}
                    </Button>
                  )}
                  <Button variant="primary" type="submit" disabled={updateRole.isPending} data-testid="role-save">
                    {t('schedule.save')}
                  </Button>
                </div>
              )}
              {selected.isSystem && (
                <p className="muted" data-testid="role-system-note">
                  {selected.key === 'power_admin' ? t('admin.roles.powerAdminNote') : t('admin.roles.portalNote')}
                </p>
              )}
            </form>

            <h2 className="grants-heading">{t('admin.roles.grants')}</h2>
            <table className="data-table grants-matrix" data-testid="grants-matrix">
              <thead>
                <tr>
                  <th>{t('admin.roles.area')}</th>
                  <th>{t('admin.roles.ability')}</th>
                  <th>{t('admin.roles.granted')}</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map(([resource, actions]) =>
                  actions.map((a, i) => {
                    const key = `${resource}:${a.action}`
                    return (
                      <tr key={key}>
                        {i === 0 && <td rowSpan={actions.length} className="grants-resource">{resource}</td>}
                        <td>
                          <span className="grants-action">{a.action}</span>
                          <span className="muted grants-desc"> — {a.description}</span>
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            checked={grants.data?.has(key) ?? false}
                            disabled={selected.isSystem || grants.isLoading || toggleGrant.isPending}
                            onChange={(e) => onToggle(resource, a.action, e.target.checked)}
                            aria-label={`${selected.name} ${key}`}
                            data-testid={`grant-${resource}-${a.action}`}
                          />
                        </td>
                      </tr>
                    )
                  }),
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating && (
        <NewRoleDialog
          roles={roles.data ?? []}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            setSelectedId(id)
          }}
        />
      )}

      {/* ADR-0041 d.3: reach takes effect immediately for everyone holding the role, so the
          confirmation says who it is about to affect rather than asking "are you sure?" into the
          void. Widening is called out separately — it hands people authority they did not have. */}
      {pendingSave && selected && (
        <Modal onClose={() => setPendingSave(null)} card={false}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t('admin.roles.reachConfirm.title')}
           
            data-testid="role-reach-confirm"
          >
            <h2>{t('admin.roles.reachConfirm.title')}</h2>
            <p>
              {t('admin.roles.reachConfirm.body', {
                role: selected.name,
                from: t(scopeLabelKey(selected.scope)),
                to: t(scopeLabelKey(pendingSave.scope)),
              })}
            </p>
            <p data-testid="role-reach-holders">
              {t('admin.roles.reachConfirm.holders', {
                count: holders.data?.get(selected.id) ?? 0,
              })}
            </p>
            {isWidening(selected.scope, pendingSave.scope) && (
              <p className="form-error" data-testid="role-reach-widening">
                {t('admin.roles.reachConfirm.widening')}
              </p>
            )}
            <div className="dialog-actions">
              <Button
                variant="link"
                onClick={() => setPendingSave(null)}
                data-testid="role-reach-cancel"
              >
                {t('schedule.cancel')}
              </Button>
              <Button
                variant="primary"
                disabled={updateRole.isPending}
                onClick={() => {
                  saveDetail(pendingSave)
                  setPendingSave(null)
                }}
                data-testid="role-reach-confirm-save"
              >
                {t('admin.roles.reachConfirm.confirm')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  )
}
