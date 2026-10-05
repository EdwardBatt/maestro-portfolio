import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { useAuth } from '../../app/auth-context'
import { usePermissions } from '../../app/permissions'
import { InviteUserDialog } from './components/InviteUserDialog'
import { UserPermissionsDialog } from './components/UserPermissionsDialog'
import { roleName } from '../../lib/roles/role-text'
import {
  useAssignableRoles,
  useDepartments,
  useOffices,
  useSendPasswordReset,
  useTeams,
  useUpdateUser,
  useUsers,
  useUserStatus,
  type AdminUser,
} from './api/admin-api'
import { Button } from '../../components/Button'
import { handoverKeys, useLeavingPeople } from './api/handover-api'
import { useQueryClient } from '@tanstack/react-query'
import { handoverHref } from '../../lib/navigation/handover-link'

const COL_COUNT = 10

/** Distinct {id,name} pairs, sorted by name — for the filter dropdowns (mirrors the schedule). */
function distinct(pairs: [string | null, string | null][]): { id: string; name: string }[] {
  const m = new Map<string, string>()
  for (const [id, name] of pairs) if (id) m.set(id, name ?? id)
  return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Users administration (L1.1, reworked for ADR-0008). Role and activation
 * changes go through the update-user Edge Function — the only writer that
 * keeps the JWT claim and the profile row in step. Roles come from the roles
 * TABLE (admin-defined rows); department and job title are org-chart facts.
 *
 * The roster is grouped by department → team and carries the same shareable
 * URL-state filter bar as the schedule (department / team / office / role) plus
 * a text search.
 */
export function UsersPage() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const { can } = usePermissions()
  const users = useUsers()
  const roles = useAssignableRoles()
  const offices = useOffices()
  const departments = useDepartments()
  const teams = useTeams()
  const status = useUserStatus()
  const updateUser = useUpdateUser()
  const sendReset = useSendPasswordReset()

  const [inviting, setInviting] = useState(false)
  const [banner, setBanner] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  /** two-step deactivate: first click arms, second click fires */
  const [armedId, setArmedId] = useState<string | null>(null)
  const qc = useQueryClient()
  // ADR-0133: who is Leaving, and how much they still hold.
  const leavingPeople = useLeavingPeople()
  const leaving = useMemo(() => new Map((leavingPeople.data ?? []).map((p) => [p.id, p])), [leavingPeople.data])
  /** ADR-0036: per-user permission & scope overlay editor (user_grants:manage only) */
  const [permsUser, setPermsUser] = useState<AdminUser | null>(null)

  // Filter state lives in the URL (shareable links), same pattern as the schedule.
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const fDept = params.get('dept') ?? ''
  const fTeam = params.get('team') ?? ''
  const fOffice = params.get('office') ?? ''
  const fRole = params.get('role') ?? ''

  const setParam = useCallback(
    (key: string, val: string) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (val) next.set(key, val)
          else next.delete(key)
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  // Department + team change atomically (a team belongs to a department): two separate setParam
  // calls share the same pre-update snapshot, so clearing team would clobber setting dept.
  const setDeptFilter = useCallback(
    (val: string) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (val) next.set('dept', val)
          else next.delete('dept')
          next.delete('team')
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  const clearFilters = useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const k of ['q', 'dept', 'team', 'office', 'role']) next.delete(k)
        return next
      },
      { replace: true },
    )
  }, [setParams])

  const selfId = session?.user.id

  function mutate(args: Parameters<typeof updateUser.mutate>[0], okKey: string) {
    setBanner(null)
    updateUser.mutate(args, {
      onSuccess: () => {
        setBanner({ kind: 'ok', text: t(okKey) })
        // ADR-0133: deactivating starts Leaving (or completes at once when they hold nothing); reactivating ends it.
        void qc.invalidateQueries({ queryKey: handoverKeys.all })
        void qc.invalidateQueries({ queryKey: ['people'] })
      },
      onError: (err) => {
        const code = (err as { code?: string }).code
        setBanner({
          kind: 'error',
          text: t(code === 'cannot_lockout_self' ? 'admin.users.cannotLockoutSelf' : 'admin.users.updateFailed'),
        })
      },
    })
  }

  function onToggleActive(u: AdminUser) {
    // ADR-0133 d.7: a Leaving person is reactivated, not deactivated again — the hand-over stops.
    const active = u.isActive && !leaving.has(u.id)
    if (active && armedId !== u.id) {
      setArmedId(u.id) // arm — the button relabels to "confirm?" and says what will happen
      return
    }
    setArmedId(null)
    mutate({ userId: u.id, active: !active }, active ? 'admin.users.deactivated' : 'admin.users.reactivated')
  }

  function onSendReset(u: AdminUser) {
    if (!u.email) return
    setBanner(null)
    sendReset.mutate(u.email, {
      onSuccess: () => setBanner({ kind: 'ok', text: t('admin.users.resetSent') }),
      onError: () => setBanner({ kind: 'error', text: t('admin.users.updateFailed') }),
    })
  }

  const all = useMemo(() => users.data ?? [], [users.data])

  // Filter dropdown options, derived from the actual roster (stay in step with who exists).
  const deptOptions = useMemo(() => distinct(all.map((u) => [u.departmentId, u.departmentName])), [all])
  const teamOptions = useMemo(
    () => distinct(all.filter((u) => !fDept || u.departmentId === fDept).map((u) => [u.teamId, u.teamName])),
    [all, fDept],
  )
  const officeOptions = useMemo(() => distinct(all.map((u) => [u.officeId, u.officeName])), [all])
  // Built-in role names follow the interface language (lib/roles/role-text), so the filter
  // list and the search haystack below must use the same words the table shows.
  const roleOptions = useMemo(
    () => distinct(all.map((u) => [u.roleId, roleName(t, { key: u.roleKey, name: u.roleName })])),
    [all, t],
  )

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return all.filter((u) => {
      if (fDept && u.departmentId !== fDept) return false
      if (fTeam && u.teamId !== fTeam) return false
      if (fOffice && u.officeId !== fOffice) return false
      if (fRole && u.roleId !== fRole) return false
      if (needle) {
        const hay = [u.displayName, u.email, u.jobTitle,
          roleName(t, { key: u.roleKey, name: u.roleName }),
          u.departmentName, u.teamName, u.officeName]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [all, q, fDept, fTeam, fOffice, fRole, t])

  // Sort by department → team → name (unassigned last), then tag group boundaries so the body
  // can interleave a header row whenever the (department, team) pair changes.
  const rows = useMemo(() => {
    const HI = '￿'
    // Sort by NAME for readable ordering, but break ties by ID so that two distinct groups sharing
    // a display name (e.g. two "Operations" departments) stay contiguous — the boundary key below is
    // id-based, so equal-named-but-different-id rows must not interleave.
    const sorted = [...filtered].sort(
      (a, b) =>
        (a.departmentName ?? HI).localeCompare(b.departmentName ?? HI) ||
        (a.departmentId ?? HI).localeCompare(b.departmentId ?? HI) ||
        (a.teamName ?? HI).localeCompare(b.teamName ?? HI) ||
        (a.teamId ?? HI).localeCompare(b.teamId ?? HI) ||
        a.displayName.localeCompare(b.displayName),
    )
    const out: ({ kind: 'header'; key: string; label: string } | { kind: 'user'; u: AdminUser })[] = []
    let prev = '' // no group key is ever empty, so the first row always opens a header
    for (const u of sorted) {
      const gk = `${u.departmentId ?? ''}|${u.teamId ?? ''}`
      if (gk !== prev) {
        const deptLabel = u.departmentName ?? t('admin.users.unassignedDept')
        out.push({ kind: 'header', key: gk, label: u.teamName ? `${deptLabel} · ${u.teamName}` : deptLabel })
        prev = gk
      }
      out.push({ kind: 'user', u })
    }
    return out
  }, [filtered, t])

  if (users.isLoading) return <p data-testid="users-loading">…</p>
  if (users.isError) return <p className="form-error">{t('admin.users.loadFailed')}</p>

  // Everyone in the table was invited; "pending" are the active accounts that haven't
  // completed signup yet (known-not-activated — unknown status is not counted).
  const invitedCount = all.length
  const pendingCount = all.filter((u) => u.isActive && status.data?.[u.id]?.activated === false).length
  const anyFilter = !!(q || fDept || fTeam || fOffice || fRole)

  return (
    <section data-testid="surface-users">
      <header className="schedule-bar">
        <h1>{t('admin.users.title')}</h1>
        <Button variant="primary" onClick={() => setInviting(true)} data-testid="invite-open">
          + {t('admin.users.invite')}
        </Button>
      </header>

      <p className="muted users-counts">
        <span data-testid="users-invited-count">{t('admin.users.invitedTotal', { count: invitedCount })}</span>
        {' · '}
        <span data-testid="users-pending-count">{t('admin.users.pendingTotal', { count: pendingCount })}</span>
        {anyFilter && (
          <>
            {' · '}
            <span data-testid="users-showing-count">
              {t('admin.users.showing', { shown: filtered.length, total: all.length })}
            </span>
          </>
        )}
      </p>

      {/* Shareable URL-state filter bar (mirrors the schedule). */}
      <div className="filter-bar" data-testid="users-filter-bar">
        <label>
          {t('admin.users.filters.search')}
          <input
            type="search"
            value={q}
            onChange={(e) => setParam('q', e.target.value)}
            placeholder={t('admin.users.filters.searchPlaceholder')}
            data-testid="users-filter-search"
          />
        </label>
        <label>
          {t('admin.users.department')}
          <select value={fDept} onChange={(e) => setDeptFilter(e.target.value)} data-testid="users-filter-department">
            <option value="">{t('admin.users.filters.all')}</option>
            {deptOptions.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <label>
          {t('admin.users.team')}
          <select value={fTeam} onChange={(e) => setParam('team', e.target.value)} data-testid="users-filter-team">
            <option value="">{t('admin.users.filters.all')}</option>
            {teamOptions.map((tm) => (
              <option key={tm.id} value={tm.id}>{tm.name}</option>
            ))}
          </select>
        </label>
        <label>
          {t('admin.users.office')}
          <select value={fOffice} onChange={(e) => setParam('office', e.target.value)} data-testid="users-filter-office">
            <option value="">{t('admin.users.filters.all')}</option>
            {officeOptions.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </label>
        <label>
          {t('admin.users.role')}
          <select value={fRole} onChange={(e) => setParam('role', e.target.value)} data-testid="users-filter-role">
            <option value="">{t('admin.users.filters.all')}</option>
            {roleOptions.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </label>
        {anyFilter && (
          <Button variant="link" onClick={clearFilters} data-testid="users-filter-clear">
            {t('admin.users.filters.clear')}
          </Button>
        )}
      </div>

      {banner && (
        <p className={banner.kind === 'error' ? 'form-error' : 'form-ok'} role={banner.kind === 'error' ? 'alert' : 'status'} data-testid="users-banner">
          {banner.text}
        </p>
      )}

      {filtered.length === 0 ? (
        <p className="muted" data-testid="users-empty">{t('admin.users.noMatches')}</p>
      ) : (
        <table className="data-table" data-testid="users-table">
          <thead>
            <tr>
              <th>{t('admin.users.displayName')}</th>
              <th>{t('auth.email')}</th>
              <th>{t('admin.users.role')}</th>
              <th>{t('admin.users.jobTitle')}</th>
              <th>{t('admin.users.department')}</th>
              <th>{t('admin.users.team')}</th>
              <th>{t('admin.users.office')}</th>
              <th>{t('admin.users.status')}</th>
              <th>{t('admin.users.signup')}</th>
              <th>{t('admin.users.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              if (row.kind === 'header') {
                return (
                  <tr key={`h-${row.key}`} className="group-row" data-testid={`user-group-${row.key}`}>
                    <th colSpan={COL_COUNT} scope="colgroup">{row.label}</th>
                  </tr>
                )
              }
              const u = row.u
              const isSelf = u.id === selfId
              return (
                <tr key={u.id} className={u.isActive ? '' : 'row-inactive'} data-testid={`user-row-${u.id}`}>
                  <td>
                    {u.displayName}
                    {isSelf && <span className="muted"> · {t('admin.users.you')}</span>}
                  </td>
                  <td>{u.email ?? '—'}</td>
                  <td>
                    <select
                      value={u.roleId}
                      disabled={isSelf || updateUser.isPending}
                      onChange={(e) => mutate({ userId: u.id, roleId: e.target.value }, 'admin.users.roleChanged')}
                      aria-label={t('admin.users.role')}
                      data-testid={`role-${u.id}`}
                    >
                      {(roles.data ?? []).map((r) => (
                        <option key={r.id} value={r.id}>{roleName(t, r)}</option>
                      ))}
                      {!roles.data?.some((r) => r.id === u.roleId) && (
                        <option value={u.roleId}>
                          {roleName(t, { key: u.roleKey, name: u.roleName }) || '—'}
                        </option>
                      )}
                    </select>
                  </td>
                  <td>{u.jobTitle ?? '—'}</td>
                  <td>
                    <select
                      value={u.departmentId ?? ''}
                      disabled={updateUser.isPending}
                      onChange={(e) => mutate({ userId: u.id, departmentId: e.target.value || null }, 'admin.users.saved')}
                      aria-label={t('admin.users.department')}
                      data-testid={`department-${u.id}`}
                    >
                      <option value="">{t('admin.users.noDepartment')}</option>
                      {(departments.data ?? []).map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {(() => {
                      // A team belongs to a department (ADR-0014). Offer only teams
                      // under this user's department; if the current team belongs to
                      // a different department (e.g. the department was changed but
                      // the team wasn't), flag it and keep it visible for reselection.
                      const inDept = (teams.data ?? []).filter((tm) => !u.departmentId || tm.departmentId === u.departmentId)
                      const current = (teams.data ?? []).find((tm) => tm.id === u.teamId)
                      const mismatch = !!u.teamId && current != null && current.departmentId !== (u.departmentId ?? null)
                      return (
                        <div className="team-cell">
                          <select
                            value={u.teamId ?? ''}
                            className={mismatch ? 'select-warn' : ''}
                            disabled={updateUser.isPending}
                            onChange={(e) => mutate({ userId: u.id, teamId: e.target.value || null }, 'admin.users.saved')}
                            aria-label={t('admin.users.team')}
                            data-testid={`team-${u.id}`}
                          >
                            <option value="">{t('admin.users.noTeam')}</option>
                            {mismatch && current && (
                              <option value={current.id}>
                                ⚠ {current.departmentName ? `${current.name} · ${current.departmentName}` : current.name}
                              </option>
                            )}
                            {inDept.map((tm) => (
                              <option key={tm.id} value={tm.id}>
                                {tm.departmentName ? `${tm.name} · ${tm.departmentName}` : tm.name}
                              </option>
                            ))}
                          </select>
                          {mismatch && (
                            <span className="cell-warn" title={t('admin.users.teamMismatchHint')} data-testid={`team-mismatch-${u.id}`}>
                              ⚠ {t('admin.users.teamMismatch')}
                            </span>
                          )}
                        </div>
                      )
                    })()}
                  </td>
                  <td>
                    <select
                      value={u.officeId ?? ''}
                      disabled={updateUser.isPending}
                      onChange={(e) => mutate({ userId: u.id, officeId: e.target.value || null }, 'admin.users.saved')}
                      aria-label={t('admin.users.office')}
                      data-testid={`office-${u.id}`}
                    >
                      <option value="">{t('admin.users.noOffice')}</option>
                      {(offices.data ?? []).map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {(() => {
                      // Tri-state lifecycle: deactivated (is_active off) → pending (invited but
                      // not yet signed in, per list-user-status) → active. If the status function
                      // isn't available the signup state is unknown, so we fall back to active
                      // rather than mislabel everyone pending.
                      const s = status.data?.[u.id]
                      // ADR-0133 d.1: Leaving — access gone, work still to hand over; the list is one click away.
                      const left = leaving.get(u.id)
                      if (u.isActive && left) {
                        return (
                          <span className="users-leaving">
                            <span className="badge badge-pending" data-testid={`status-${u.id}`}>{t('admin.users.leaving', { n: left.itemsRemaining })}</span>
                            <Link to={handoverHref(u.id)} className="users-leaving-link" data-testid={`handover-link-${u.id}`}>{t('admin.users.openHandover')}</Link>
                          </span>
                        )
                      }
                      const state = !u.isActive ? 'inactive' : s && !s.activated ? 'pending' : 'active'
                      const cls = state === 'active' ? 'badge-active' : state === 'pending' ? 'badge-pending' : 'badge-inactive'
                      const key = state === 'active' ? 'admin.users.active' : state === 'pending' ? 'admin.users.pending' : 'admin.users.inactive'
                      return <span className={`badge ${cls}`} data-testid={`status-${u.id}`}>{t(key)}</span>
                    })()}
                  </td>
                  <td>
                    {(() => {
                      const s = status.data?.[u.id]
                      if (!s) return <span className="muted">—</span> // function not deployed / loading
                      return s.activated ? (
                        <span
                          className="badge badge-active"
                          title={s.lastSignInAt ? t('admin.users.lastActive', { date: s.lastSignInAt.slice(0, 10) }) : undefined}
                          data-testid={`signup-${u.id}`}
                        >
                          {t('admin.users.activated')}
                        </span>
                      ) : (
                        <span className="badge badge-pending" data-testid={`signup-${u.id}`}>
                          {t('admin.users.pendingSignup')}
                        </span>
                      )
                    })()}
                  </td>
                  <td className="row-actions">
                    {can('user_grants:manage') && !isSelf && u.roleKey !== 'client_portal' && (
                      <Button
                        variant="secondary" size="sm"
                        onClick={() => setPermsUser(u)}
                        data-testid={`perms-${u.id}`}
                      >
                        {t('admin.userPerms.open')}
                      </Button>
                    )}
                    <Button
                      variant="secondary" size="sm"
                      disabled={!u.email || sendReset.isPending}
                      onClick={() => onSendReset(u)}
                      data-testid={`reset-${u.id}`}
                    >
                      {t('admin.users.sendReset')}
                    </Button>
                    <Button
                      variant={u.isActive && !leaving.has(u.id) ? 'danger' : 'secondary'} size="sm"
                      disabled={isSelf || updateUser.isPending}
                      onClick={() => onToggleActive(u)}
                      data-testid={`toggle-active-${u.id}`}
                    >
                      {u.isActive && !leaving.has(u.id)
                        ? armedId === u.id
                          ? t('admin.users.confirmDeactivate')
                          : t('admin.users.deactivate')
                        : t('admin.users.reactivate')}
                    </Button>
                    {armedId === u.id && (
                      <span className="users-deactivate-note" role="note" data-testid={`deactivate-note-${u.id}`}>{t('admin.users.deactivateNote')}</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {inviting && <InviteUserDialog onClose={() => setInviting(false)} />}
      {permsUser && <UserPermissionsDialog user={permsUser} onClose={() => setPermsUser(null)} />}
    </section>
  )
}
