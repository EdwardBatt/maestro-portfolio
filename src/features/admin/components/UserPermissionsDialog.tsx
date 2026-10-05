import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePermissionCatalog, useRoleGrants } from '../api/roles-api'
import { useDepartments, useTeams, type AdminUser } from '../api/admin-api'
import {
  useUserGrants,
  useUserScopeGrants,
  useSetUserGrant,
  useAddScopeGrant,
  useRemoveScopeGrant,
  type GrantEffect,
} from '../api/user-grants-api'
import { roleName } from '../../../lib/roles/role-text'
import { Modal } from '../../../components/Modal'
import { Button, IconButton } from '../../../components/Button'

/**
 * Per-user permission & scope editor (L6.4b, ADR-0036). The role sets the
 * baseline (read-only here — edit it on the Roles screen); this dialog manages
 * the OVERLAY for one person: allow-adds, deny-removes (deny wins), and additive
 * department/team scope targets. Only reachable for holders of user_grants:manage
 * (Power Admin for now) and never for yourself — the DB enforces both regardless.
 */

// The two grants the DB refuses to deny (chk_user_grants_no_deny_admin) — deny is
// disabled in the UI too so a manager can't try and get an opaque error.
const UN_DENIABLE = new Set(['user_grants:manage', 'roles:manage'])

export function UserPermissionsDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const { t } = useTranslation()
  const catalog = usePermissionCatalog()
  const roleGrants = useRoleGrants(user.roleId)
  const userGrants = useUserGrants(user.id)
  const scopeGrants = useUserScopeGrants(user.id)
  const departments = useDepartments()
  const teams = useTeams()
  const setGrant = useSetUserGrant()
  const addScope = useAddScopeGrant()
  const removeScope = useRemoveScopeGrant()

  const [error, setError] = useState<string | null>(null)
  const [scopePick, setScopePick] = useState('') // 'dept:<id>' | 'team:<id>'

  const grouped = useMemo(() => {
    const map = new Map<string, { action: string; description: string }[]>()
    for (const entry of catalog.data ?? []) {
      const list = map.get(entry.resource) ?? []
      list.push({ action: entry.action, description: entry.description })
      map.set(entry.resource, list)
    }
    return [...map.entries()]
  }, [catalog.data])

  const deptName = (id: string) => departments.data?.find((d) => d.id === id)?.name ?? id
  const team = (id: string) => teams.data?.find((tm) => tm.id === id)
  const grantedDeptIds = new Set((scopeGrants.data ?? []).map((g) => g.departmentId).filter(Boolean) as string[])
  const grantedTeamIds = new Set((scopeGrants.data ?? []).map((g) => g.teamId).filter(Boolean) as string[])

  function setOverride(resource: string, action: string, effect: GrantEffect | 'none') {
    setError(null)
    setGrant.mutate({ userId: user.id, resource, action, effect }, { onError: () => setError(t('admin.userPerms.saveFailed')) })
  }

  function onAddScope() {
    if (!scopePick) return
    setError(null)
    const [kind, id] = scopePick.split(':')
    addScope.mutate(
      { userId: user.id, departmentId: kind === 'dept' ? id : null, teamId: kind === 'team' ? id : null },
      { onSuccess: () => setScopePick(''), onError: () => setError(t('admin.userPerms.saveFailed')) },
    )
  }

  const loading = catalog.isLoading || roleGrants.isLoading || userGrants.isLoading

  return (
    <Modal onClose={onClose} card={false}>
      <div
        className="dialog dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-label={t('admin.userPerms.title', { name: user.displayName })}
        data-testid="user-perms-dialog"
       
      >
        <h2>{t('admin.userPerms.title', { name: user.displayName })}</h2>
        <p className="muted">{t('admin.userPerms.intro')}</p>
        <p className="muted" data-testid="user-perms-role">{t('admin.userPerms.roleBaseline', {
          role: roleName(t, { key: user.roleKey, name: user.roleName }) || '—',
        })}</p>

        {error && <p className="form-error" role="alert" data-testid="user-perms-error">{error}</p>}

        {loading ? (
          <p data-testid="user-perms-loading">…</p>
        ) : (
          <>
            <table className="data-table grants-matrix" data-testid="user-perms-matrix">
              <thead>
                <tr>
                  <th>{t('admin.userPerms.area')}</th>
                  <th>{t('admin.userPerms.ability')}</th>
                  <th>{t('admin.userPerms.fromRole')}</th>
                  <th>{t('admin.userPerms.override')}</th>
                  <th>{t('admin.userPerms.effective')}</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map(([resource, actions]) =>
                  actions.map((a, i) => {
                    const key = `${resource}:${a.action}`
                    const inRole = roleGrants.data?.has(key) ?? false
                    const override = userGrants.data?.get(key) // 'allow' | 'deny' | undefined
                    const effective = (inRole || override === 'allow') && override !== 'deny'
                    return (
                      <tr key={key}>
                        {i === 0 && <td rowSpan={actions.length} className="grants-resource">{resource}</td>}
                        <td>
                          <span className="grants-action">{a.action}</span>
                          <span className="muted grants-desc"> — {a.description}</span>
                        </td>
                        <td>{inRole ? t('admin.userPerms.granted') : '—'}</td>
                        <td>
                          <select
                            value={override ?? 'inherit'}
                            disabled={setGrant.isPending}
                            onChange={(e) => setOverride(resource, a.action, e.target.value as GrantEffect | 'none')}
                            aria-label={`${user.displayName} ${key} ${t('admin.userPerms.override')}`}
                            data-testid={`override-${resource}-${a.action}`}
                          >
                            <option value="inherit">{t('admin.userPerms.inherit')}</option>
                            <option value="allow">{t('admin.userPerms.allow')}</option>
                            <option value="deny" disabled={UN_DENIABLE.has(key)}>
                              {t('admin.userPerms.deny')}
                            </option>
                          </select>
                        </td>
                        <td>
                          <span
                            className={`badge ${effective ? 'badge-active' : 'badge-inactive'}`}
                            data-testid={`effective-${resource}-${a.action}`}
                          >
                            {effective ? t('admin.userPerms.yes') : t('admin.userPerms.no')}
                          </span>
                        </td>
                      </tr>
                    )
                  }),
                )}
              </tbody>
            </table>

            <h3 className="grants-heading">{t('admin.userPerms.scopeTitle')}</h3>
            <p className="muted">{t('admin.userPerms.scopeIntro')}</p>
            <ul className="scope-grant-list" data-testid="scope-grant-list">
              {(scopeGrants.data ?? []).length === 0 && <li className="muted">{t('admin.userPerms.scopeEmpty')}</li>}
              {(scopeGrants.data ?? []).map((g) => (
                <li key={g.id} data-testid={`scope-grant-${g.id}`}>
                  <span className="badge badge-scope">
                    {g.departmentId
                      ? t('admin.userPerms.scopeDept', { name: deptName(g.departmentId) })
                      : t('admin.userPerms.scopeTeam', {
                          name: (() => {
                            const tm = team(g.teamId as string)
                            return tm ? (tm.departmentName ? `${tm.name} · ${tm.departmentName}` : tm.name) : g.teamId
                          })(),
                        })}
                  </span>
                  <IconButton
                    icon="trash"
                    danger
                    size="sm"
                    label={t('admin.userPerms.remove')}
                    disabled={removeScope.isPending}
                    onClick={() => removeScope.mutate({ userId: user.id, id: g.id })}
                    data-testid={`scope-remove-${g.id}`}
                  />
                </li>
              ))}
            </ul>
            <div className="dialog-row">
              <label>
                {t('admin.userPerms.scopeAdd')}
                <select value={scopePick} onChange={(e) => setScopePick(e.target.value)} data-testid="scope-pick">
                  <option value="">{t('admin.userPerms.scopePick')}</option>
                  <optgroup label={t('admin.userPerms.deptGroup')}>
                    {(departments.data ?? [])
                      .filter((d) => !grantedDeptIds.has(d.id))
                      .map((d) => (
                        <option key={d.id} value={`dept:${d.id}`}>{d.name}</option>
                      ))}
                  </optgroup>
                  <optgroup label={t('admin.userPerms.teamGroup')}>
                    {(teams.data ?? [])
                      .filter((tm) => !grantedTeamIds.has(tm.id))
                      .map((tm) => (
                        <option key={tm.id} value={`team:${tm.id}`}>
                          {tm.departmentName ? `${tm.name} · ${tm.departmentName}` : tm.name}
                        </option>
                      ))}
                  </optgroup>
                </select>
              </label>
              <Button variant="primary" size="sm" disabled={!scopePick || addScope.isPending} onClick={onAddScope} data-testid="scope-add">
                {t('admin.userPerms.scopeAdd')}
              </Button>
            </div>
          </>
        )}

        <div className="dialog-actions">
          <Button variant="secondary" onClick={onClose} data-testid="user-perms-close">
            {t('admin.userPerms.close')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
