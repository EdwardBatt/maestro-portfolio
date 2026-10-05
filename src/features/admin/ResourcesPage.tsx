import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePermissions } from '../../app/permissions'
import { useDepartments, useOffices } from './api/admin-api'
import { useTeamsAdmin } from './api/org-api'
import {
  useCreateResource,
  useLinkableUsers,
  useResourcesAdmin,
  useSetResourceActive,
  useSetResourceUser,
  useUpdateResource,
  type AdminResource,
  type CapacityModel,
  type ResourceKind,
  type ResourceWriteArgs,
} from './api/resources-api'
import { randomNickname } from '../../lib/nickname/generate'
import { NoticeDialog } from '../../components/Notice'
import { Modal } from '../../components/Modal'
import { Button, IconButton } from '../../components/Button'

/**
 * Admin → Resources (L1.4, ADR-0011). CRUD over the scheduling spine: humans,
 * equipment and rooms, their capacity model, org placement, approval flag and
 * nickname. Humans are forced load_based (§4.1 / DB CHECK). Rates are shown
 * behind resources:manage as an interim guard (column-level protection is L1.6).
 * Direct RLS-governed writes (resources:manage); audited by trigger.
 */
export function ResourcesPage() {
  const { t } = useTranslation()
  const { can } = usePermissions()
  const resources = useResourcesAdmin()
  const setActive = useSetResourceActive()
  const teams = useTeamsAdmin()

  // teamId → parent departmentId, to flag resources whose team belongs to a
  // different department than the resource itself (ADR-0014).
  const teamDept = useMemo(() => {
    const m = new Map<string, string>()
    for (const tm of teams.data ?? []) m.set(tm.id, tm.departmentId)
    return m
  }, [teams.data])

  const [banner, setBanner] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'edit'; resource: AdminResource } | null>(null)
  const [armedId, setArmedId] = useState<string | null>(null)

  const showRates = can('resources:manage')

  const ok = (key: string) => setBanner({ kind: 'ok', text: t(key) })
  const fail = (err: unknown) => {
    const code = (err as { code?: string }).code
    setBanner({ kind: 'error', text: t(code === '23505' ? 'admin.resources.nicknameTaken' : 'admin.resources.saveFailed') })
  }

  function onToggleActive(r: AdminResource) {
    if (r.isActive && armedId !== r.id) { setArmedId(r.id); return }
    setArmedId(null)
    setBanner(null)
    setActive.mutate(
      { id: r.id, isActive: !r.isActive },
      { onSuccess: () => ok('admin.resources.saved'), onError: (err) => fail(err) },
    )
  }

  const capacityLabel = (r: AdminResource): string => {
    if (r.capacityModel === 'exclusive') return t('admin.resources.capacityModels.exclusive')
    if (r.capacityModel === 'pooled') return t('admin.resources.capacityPooled', { n: r.poolSize ?? '?' })
    return t('admin.resources.capacityLoad', { ceiling: r.loadCeilingPct ?? '?', warn: r.warnAtPct ?? '?' })
  }

  if (resources.isLoading) return <p data-testid="resources-loading">…</p>
  if (resources.isError) return <p className="form-error">{t('admin.resources.loadFailed')}</p>

  const rows = resources.data ?? []

  return (
    <section data-testid="surface-resources">
      <header className="schedule-bar">
        <h1>{t('admin.resources.title')}</h1>
        <Button variant="primary" onClick={() => setDialog({ mode: 'create' })} data-testid="resource-new">
          + {t('admin.resources.newResource')}
        </Button>
      </header>

      <p className="muted">{t('admin.resources.intro')}</p>

      {/* Edward, 29 Aug: an action reports what it did in front of the person, not as
          a strip above the page. Same rule `I12.9` set for the schedule refusal. */}
      {banner && (
        <NoticeDialog
          kind={banner.kind === 'error' ? 'error' : 'success'}
          message={banner.text}
          testId="resources-banner"
          onClose={() => setBanner(null)}
        />
      )}

      {rows.length === 0 ? (
        <p className="muted" data-testid="resources-empty">{t('admin.resources.empty')}</p>
      ) : (
        <table className="data-table" data-testid="resources-table">
          <thead>
            <tr>
              <th>{t('admin.resources.nickname')}</th>
              <th>{t('admin.resources.name')}</th>
              <th>{t('admin.resources.kind')}</th>
              <th>{t('admin.resources.capacity')}</th>
              <th>{t('admin.resources.department')}</th>
              <th>{t('admin.resources.team')}</th>
              <th>{t('admin.resources.office')}</th>
              <th>{t('admin.resources.linkedUser')}</th>
              <th>{t('admin.resources.bookableColumn')}</th>
              <th>{t('admin.users.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid={`resource-row-${r.id}`} className={r.isActive ? '' : 'row-inactive'}>
                <td>{r.nickname ?? '—'}</td>
                <td>{r.name}</td>
                <td>{t(`admin.resources.kinds.${r.kind}`)}</td>
                <td>{capacityLabel(r)}</td>
                <td>{r.departmentName ?? '—'}</td>
                <td>
                  {r.teamName ?? '—'}
                  {r.teamId && teamDept.has(r.teamId) && teamDept.get(r.teamId) !== (r.departmentId ?? null) && (
                    <span className="cell-warn" title={t('admin.users.teamMismatchHint')} data-testid={`resource-team-mismatch-${r.id}`}>
                      {' '}⚠ {t('admin.users.teamMismatch')}
                    </span>
                  )}
                </td>
                <td>{r.officeName ?? '—'}</td>
                <td>
                  {/* ADR-0061 d.8: a human resource with no login behind it can be booked and
                      belongs to nobody — no assignee, no notification, no My Work, and no
                      user-level switch can reach it. Said here rather than left to be discovered
                      by deactivating somebody and finding they are still on the grid. */}
                  {r.userName ?? (
                    r.kind === 'human'
                      ? <span className="cell-warn" title={t('admin.resources.unlinkedHint')} data-testid={`resource-unlinked-${r.id}`}>
                          ⚠ {t('admin.resources.unlinked')}
                        </span>
                      : '—'
                  )}
                </td>
                <td data-testid={`resource-bookable-${r.id}`}>
                  {r.isActive ? t('admin.resources.bookable') : t('admin.resources.notBookable')}
                </td>
                <td className="row-actions">
                  <IconButton icon="edit" label={t('admin.resources.edit')} onClick={() => setDialog({ mode: 'edit', resource: r })} data-testid={`resource-edit-${r.id}`} />
                  <Button variant={r.isActive ? 'danger' : 'secondary'} size="sm" disabled={setActive.isPending} onClick={() => onToggleActive(r)} data-testid={`resource-toggle-${r.id}`}>
                    {!r.isActive
                      ? t('admin.resources.makeBookable')
                      : armedId === r.id
                        ? t('admin.resources.confirmNotBookable')
                        : t('admin.resources.makeNotBookable')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {dialog && (
        <ResourceDialog
          key={dialog.mode === 'edit' ? dialog.resource.id : 'create'}
          resource={dialog.mode === 'edit' ? dialog.resource : null}
          showRates={showRates}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); ok('admin.resources.saved') }}
          onError={fail}
        />
      )}
    </section>
  )
}

function ResourceDialog({
  resource,
  showRates,
  onClose,
  onSaved,
  onError,
}: {
  resource: AdminResource | null
  showRates: boolean
  onClose: () => void
  onSaved: () => void
  onError: (err: unknown) => void
}) {
  const { t } = useTranslation()
  const departments = useDepartments()
  const offices = useOffices()
  const teams = useTeamsAdmin()
  const create = useCreateResource()
  const update = useUpdateResource()
  const linkable = useLinkableUsers()
  const setUser = useSetResourceUser()

  const [kind, setKind] = useState<ResourceKind>(resource?.kind ?? 'human')
  const [name, setName] = useState(resource?.name ?? '')
  const [nickname, setNickname] = useState(resource?.nickname ?? (resource ? '' : randomNickname()))
  const [capacityModel, setCapacityModel] = useState<CapacityModel>(resource?.capacityModel ?? 'load_based')
  const [poolSize, setPoolSize] = useState(String(resource?.poolSize ?? 2))
  const [ceiling, setCeiling] = useState(String(resource?.loadCeilingPct ?? 120))
  const [warn, setWarn] = useState(String(resource?.warnAtPct ?? 100))
  const [departmentId, setDepartmentId] = useState(resource?.departmentId ?? '')
  const [teamId, setTeamId] = useState(resource?.teamId ?? '')
  const [officeId, setOfficeId] = useState(resource?.officeId ?? '')
  const [requiresApproval, setRequiresApproval] = useState(resource?.requiresApproval ?? false)
  const [costRate, setCostRate] = useState(resource?.costRate == null ? '' : String(resource.costRate))
  const [chargeRate, setChargeRate] = useState(resource?.chargeRate == null ? '' : String(resource.chargeRate))
  const [currency, setCurrency] = useState(resource?.currency ?? 'USD')
  const [localError, setLocalError] = useState<string | null>(null)

  // Humans are always load_based (§4.1 / DB CHECK). Reflect that in the form.
  const effectiveModel: CapacityModel = kind === 'human' ? 'load_based' : capacityModel

  // Teams belong to departments — only offer teams within the chosen department.
  const teamOptions = useMemo(
    () => (teams.data ?? []).filter((tm) => !departmentId || tm.departmentId === departmentId),
    [teams.data, departmentId],
  )
  // Surface an existing team that belongs to a different department (ADR-0014)
  // rather than silently blanking it, so the admin can see and fix it.
  const currentTeam = (teams.data ?? []).find((tm) => tm.id === teamId)
  const teamMismatch = !!teamId && currentTeam != null && currentTeam.departmentId !== (departmentId || null)

  const pending = create.isPending || update.isPending

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLocalError(null)
    if (!name.trim()) { setLocalError(t('admin.resources.nameRequired')); return }
    if (effectiveModel === 'pooled' && (!Number(poolSize) || Number(poolSize) < 1)) {
      setLocalError(t('admin.resources.poolRequired')); return
    }
    if (effectiveModel === 'load_based') {
      const c = Number(ceiling), w = Number(warn)
      if (!c || !w || w > c) { setLocalError(t('admin.resources.loadRequired')); return }
    }
    const args: ResourceWriteArgs = {
      kind,
      name,
      nickname: nickname || null,
      capacityModel: effectiveModel,
      poolSize: effectiveModel === 'pooled' ? Number(poolSize) : null,
      loadCeilingPct: effectiveModel === 'load_based' ? Number(ceiling) : null,
      warnAtPct: effectiveModel === 'load_based' ? Number(warn) : null,
      costRate: costRate.trim() === '' ? null : Number(costRate),
      chargeRate: chargeRate.trim() === '' ? null : Number(chargeRate),
      currency: currency.trim() || 'USD',
      requiresApproval,
      departmentId: departmentId || null,
      teamId: teamId || null,
      officeId: officeId || null,
    }
    const onDone = { onSuccess: onSaved, onError }
    if (resource) update.mutate({ id: resource.id, ...args }, onDone)
    else create.mutate(args, onDone)
  }

  return (
    <Modal onClose={onClose} card={false}>
      <form className="dialog" role="dialog" aria-modal="true" aria-label={t('admin.resources.title')}
        data-testid="resource-dialog" onSubmit={submit}>
        <h2>{resource ? t('admin.resources.editResource') : t('admin.resources.newResource')}</h2>

        <div className="dialog-row">
          <label>
            {t('admin.resources.kind')}
            <select value={kind} onChange={(e) => setKind(e.target.value as ResourceKind)} data-testid="resource-kind">
              <option value="human">{t('admin.resources.kinds.human')}</option>
              <option value="equipment">{t('admin.resources.kinds.equipment')}</option>
              <option value="room">{t('admin.resources.kinds.room')}</option>
            </select>
          </label>
          <label>
            {t('admin.resources.name')}
            <input value={name} onChange={(e) => setName(e.target.value)} data-testid="resource-name" />
          </label>
        </div>

        <label>
          {t('admin.resources.nickname')}
          <span className="nickname-row">
            <input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={60} data-testid="resource-nickname"
              placeholder={t('admin.resources.nicknameOptional')} />
            <IconButton icon="dice" size="sm" className="reroll" label={t('admin.users.rerollNickname')}
              onClick={() => setNickname(randomNickname())} data-testid="resource-nickname-reroll" />
          </span>
        </label>

        <div className="dialog-row">
          <label>
            {t('admin.resources.capacity')}
            <select value={effectiveModel} disabled={kind === 'human'} onChange={(e) => setCapacityModel(e.target.value as CapacityModel)} data-testid="resource-capacity">
              <option value="load_based">{t('admin.resources.capacityModels.load_based')}</option>
              <option value="exclusive">{t('admin.resources.capacityModels.exclusive')}</option>
              <option value="pooled">{t('admin.resources.capacityModels.pooled')}</option>
            </select>
          </label>
          {effectiveModel === 'pooled' && (
            <label>
              {t('admin.resources.poolSize')}
              <input type="number" min={1} value={poolSize} onChange={(e) => setPoolSize(e.target.value)} data-testid="resource-pool" />
            </label>
          )}
          {effectiveModel === 'load_based' && (
            <>
              <label>
                {t('admin.resources.ceiling')}
                <input type="number" min={1} value={ceiling} onChange={(e) => setCeiling(e.target.value)} data-testid="resource-ceiling" />
              </label>
              <label>
                {t('admin.resources.warnAt')}
                <input type="number" min={1} value={warn} onChange={(e) => setWarn(e.target.value)} data-testid="resource-warn" />
              </label>
            </>
          )}
        </div>

        <div className="dialog-row">
          <label>
            {t('admin.resources.department')}
            <select value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setTeamId('') }} data-testid="resource-department">
              <option value="">{t('admin.users.noDepartment')}</option>
              {(departments.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label>
            {t('admin.resources.team')}
            <select value={teamId} className={teamMismatch ? 'select-warn' : ''} onChange={(e) => setTeamId(e.target.value)} data-testid="resource-team">
              <option value="">{t('admin.resources.noTeam')}</option>
              {teamMismatch && currentTeam && <option value={currentTeam.id}>⚠ {currentTeam.name}</option>}
              {teamOptions.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
            </select>
            {teamMismatch && <span className="cell-warn" data-testid="resource-team-mismatch-hint">⚠ {t('admin.users.teamMismatch')}</span>}
          </label>
          <label>
            {t('admin.resources.office')}
            <select value={officeId} onChange={(e) => setOfficeId(e.target.value)} data-testid="resource-office">
              <option value="">{t('admin.users.noOffice')}</option>
              {(offices.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
        </div>

        <label className="check">
          <input type="checkbox" checked={requiresApproval} onChange={(e) => setRequiresApproval(e.target.checked)} data-testid="resource-approval" />
          {t('admin.resources.requiresApproval')}
        </label>

        {showRates && (
          <div className="dialog-row" data-testid="resource-rates">
            <label>
              {t('admin.resources.costRate')}
              <input type="number" min={0} step="0.01" value={costRate} onChange={(e) => setCostRate(e.target.value)} data-testid="resource-cost" />
            </label>
            <label>
              {t('admin.resources.chargeRate')}
              <input type="number" min={0} step="0.01" value={chargeRate} onChange={(e) => setChargeRate(e.target.value)} data-testid="resource-charge" />
            </label>
            <label>
              {t('admin.resources.currency')}
              <input value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} data-testid="resource-currency" />
            </label>
          </div>
        )}

        {resource && (
          <fieldset className="invite-resource" data-testid="resource-link">
            <legend>{t('admin.resources.linkedUser')}</legend>
            {resource.userId ? (
              <div className="nickname-row">
                <span>{resource.userName ?? resource.userId}</span>
                <IconButton icon="unlink" danger size="sm" label={t('admin.resources.unlink')} onClick={() => setUser.mutate({ id: resource.id, userId: null }, { onSuccess: onSaved, onError })} data-testid="resource-unlink" />
              </div>
            ) : (
              <label>
                {t('admin.resources.linkUser')}
                <select
                  defaultValue=""
                  data-testid="resource-link-select"
                  onChange={(e) => { if (e.target.value) setUser.mutate({ id: resource.id, userId: e.target.value }, { onSuccess: onSaved, onError }) }}
                >
                  <option value="">{t('admin.resources.selectUser')}</option>
                  {(linkable.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
            )}
          </fieldset>
        )}

        {localError && <p className="form-error" role="alert" data-testid="resource-error">{localError}</p>}

        <div className="dialog-actions">
          <Button variant="secondary" onClick={onClose} data-testid="resource-cancel">{t('schedule.cancel')}</Button>
          <Button variant="primary" type="submit" disabled={pending} data-testid="resource-submit">
            {pending ? t('admin.resources.saving') : t('admin.resources.save')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
