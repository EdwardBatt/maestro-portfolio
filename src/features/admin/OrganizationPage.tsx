import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useCreateDepartment,
  useCreateTeam,
  useDeleteDepartment,
  useDeleteTeam,
  useDeleteOffice,
  useDepartmentsAdmin,
  useSetDepartmentProduction,
  useOfficesAdmin,
  useRenameDepartment,
  useRenameTeam,
  useTeamsAdmin,
  type DepartmentRow,
  type OfficeRow,
  type TeamRow,
} from './api/org-api'
import { OfficeDialog } from './components/OfficeDialog'
import { SchedulingSettingsSection } from './components/SchedulingSettingsSection'
import { EscalationSettingsSection } from './components/EscalationSettingsSection'
import { NoticeDialog } from '../../components/Notice'
import { Button, IconButton, DeleteButton } from '../../components/Button'

const DAY_ABBR: Record<number, string> = { 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat', 7: 'sun' }

/**
 * Organization administration (L1.5 + ADR-0009). Departments, and Teams nested
 * within them (Department → Team → people). Writes are RLS-governed
 * (organization:manage) and audited by trigger.
 */
export function OrganizationPage() {
  const { t } = useTranslation()
  const departments = useDepartmentsAdmin()
  const createDept = useCreateDepartment()
  const renameDept = useRenameDepartment()
  const deleteDept = useDeleteDepartment()
  const setProduction = useSetDepartmentProduction()
  const teams = useTeamsAdmin()
  const createTeam = useCreateTeam()
  const renameTeam = useRenameTeam()
  const deleteTeam = useDeleteTeam()
  const offices = useOfficesAdmin()
  const deleteOffice = useDeleteOffice()

  const [banner, setBanner] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [armedId, setArmedId] = useState<string | null>(null)
  const [teamEditingId, setTeamEditingId] = useState<string | null>(null)
  const [teamArmedId, setTeamArmedId] = useState<string | null>(null)
  const [officeDialog, setOfficeDialog] = useState<{ mode: 'create' } | { mode: 'edit'; office: OfficeRow } | null>(null)
  const [officeArmedId, setOfficeArmedId] = useState<string | null>(null)

  const ok = (key: string) => setBanner({ kind: 'ok', text: t(key) })
  const fail = (err: unknown, dupKey = 'admin.org.updateFailed') => {
    const code = (err as { code?: string }).code
    setBanner({ kind: 'error', text: t(code === '23505' ? 'admin.org.duplicate' : dupKey) })
  }

  function onAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const name = String(new FormData(form).get('name') ?? '').trim()
    if (!name) return
    setBanner(null)
    createDept.mutate(name, { onSuccess: () => { form.reset(); ok('admin.org.saved') }, onError: (err) => fail(err) })
  }

  function onRename(d: DepartmentRow, name: string) {
    setEditingId(null)
    if (!name.trim() || name.trim() === d.name) return
    setBanner(null)
    renameDept.mutate({ id: d.id, name }, { onSuccess: () => ok('admin.org.saved'), onError: (err) => fail(err) })
  }

  function onDelete(d: DepartmentRow) {
    if (armedId !== d.id) { setArmedId(d.id); return }
    setArmedId(null)
    setBanner(null)
    deleteDept.mutate(d.id, { onSuccess: () => ok('admin.org.deleted'), onError: (err) => fail(err, 'admin.org.inUse') })
  }

  function onAddTeam(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    const departmentId = String(fd.get('departmentId') ?? '')
    const name = String(fd.get('name') ?? '').trim()
    if (!departmentId || !name) return
    setBanner(null)
    createTeam.mutate({ departmentId, name }, { onSuccess: () => { form.reset(); ok('admin.org.saved') }, onError: (err) => fail(err) })
  }

  function onRenameTeam(tm: TeamRow, name: string) {
    setTeamEditingId(null)
    if (!name.trim() || name.trim() === tm.name) return
    setBanner(null)
    renameTeam.mutate({ id: tm.id, name }, { onSuccess: () => ok('admin.org.saved'), onError: (err) => fail(err) })
  }

  function onDeleteTeam(tm: TeamRow) {
    if (teamArmedId !== tm.id) { setTeamArmedId(tm.id); return }
    setTeamArmedId(null)
    setBanner(null)
    deleteTeam.mutate(tm.id, { onSuccess: () => ok('admin.org.deleted'), onError: (err) => fail(err, 'admin.org.inUse') })
  }

  function onDeleteOffice(o: OfficeRow) {
    if (officeArmedId !== o.id) { setOfficeArmedId(o.id); return }
    setOfficeArmedId(null)
    setBanner(null)
    deleteOffice.mutate(o.id, { onSuccess: () => ok('admin.org.deleted'), onError: (err) => fail(err, 'admin.org.inUse') })
  }

  if (departments.isLoading) return <p data-testid="org-loading">…</p>
  if (departments.isError) return <p className="form-error">{t('admin.org.loadFailed')}</p>

  return (
    <section data-testid="surface-organization">
      <header className="schedule-bar">
        <h1>{t('admin.org.title')}</h1>
      </header>

      {/* Edward, 29 Aug: an action reports what it did in front of the person, not as
          a strip above the page. Same rule `I12.9` set for the schedule refusal. */}
      {banner && (
        <NoticeDialog
          kind={banner.kind === 'error' ? 'error' : 'success'}
          message={banner.text}
          testId="org-banner"
          onClose={() => setBanner(null)}
        />
      )}

      {/* I41.10 — the scheduling numbers, admin-adjustable (ADR-0075 d.5). */}
      <SchedulingSettingsSection
        onSaved={() => ok('admin.org.scheduling.saved')}
        onError={(err) =>
          fail(err, (err as { code?: string }).code === '42501' ? 'admin.org.scheduling.refused' : 'admin.org.scheduling.saveFailed')
        }
      />

      {/* I59.24 / ADR-0108: the escalation rules, the over-capacity and untimed numbers, and the
          tenant's filler words (ADR-0111 d.3) — beside the scheduling rules, behind the same grant. */}
      <EscalationSettingsSection
        onSaved={(key) => ok(key)}
        onError={(_err, key) => setBanner({ kind: 'error', text: t(key) })}
      />

      <h2 className="org-section-heading">{t('admin.org.offices')}</h2>
      <p className="muted">{t('admin.org.officesIntro')}</p>

      <table className="data-table" data-testid="offices-table">
        <thead>
          <tr>
            <th>{t('admin.org.officeName')}</th>
            <th>{t('admin.org.timezone')}</th>
            <th>{t('admin.org.workingDays')}</th>
            <th>{t('admin.org.people')}</th>
            <th>{t('admin.org.resources')}</th>
            <th>{t('admin.users.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {(offices.data ?? []).map((o) => (
            <tr key={o.id} data-testid={`office-row-${o.id}`}>
              <td>{o.name}</td>
              <td>{o.timezone}</td>
              <td>{o.workingDays.map((d) => t(`admin.org.days.${DAY_ABBR[d]}`)).join(' ')}</td>
              <td>{o.memberCount}</td>
              <td>{o.resourceCount}</td>
              <td className="row-actions">
                <IconButton icon="edit" label={t('admin.resources.edit')} onClick={() => setOfficeDialog({ mode: 'edit', office: o })} data-testid={`office-edit-${o.id}`} />
                <DeleteButton armed={officeArmedId === o.id} label={t('admin.org.delete')} confirm={t('admin.org.confirmDelete')} disabled={deleteOffice.isPending} onClick={() => onDeleteOffice(o)} data-testid={`office-delete-${o.id}`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="org-add-form">
        <Button variant="primary" icon="plus" onClick={() => setOfficeDialog({ mode: 'create' })} data-testid="office-add">
          {t('admin.org.newOffice')}
        </Button>
      </div>

      {officeDialog && (
        <OfficeDialog
          key={officeDialog.mode === 'edit' ? officeDialog.office.id : 'create'}
          office={officeDialog.mode === 'edit' ? officeDialog.office : null}
          onClose={() => setOfficeDialog(null)}
          onSaved={() => { setOfficeDialog(null); ok('admin.org.saved') }}
          onError={(err) => fail(err)}
        />
      )}

      <h2 className="org-section-heading">{t('admin.org.departments')}</h2>
      <p className="muted">{t('admin.org.departmentsIntro')}</p>

      <table className="data-table" data-testid="departments-table">
        <thead>
          <tr>
            <th>{t('admin.org.departmentName')}</th>
            <th>{t('admin.org.people')}</th>
            <th>{t('admin.org.resources')}</th>
            <th>{t('admin.org.production')}</th>
            <th>{t('admin.users.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {(departments.data ?? []).map((d) => (
            <tr key={d.id} data-testid={`dept-row-${d.id}`}>
              <td>
                {editingId === d.id ? (
                  <input
                    defaultValue={d.name}
                    autoFocus
                    data-testid={`dept-edit-${d.id}`}
                    onBlur={(e) => onRename(d, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onRename(d, (e.target as HTMLInputElement).value)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                  />
                ) : (
                  d.name
                )}
              </td>
              <td>{d.memberCount}</td>
              <td>{d.resourceCount}</td>
              <td>
                {/* ADR-0115: off keeps the department and its people out of the Schedule, the Team page
                    and every work picker; reviewers and approvers keep them. */}
                <label className="check" title={t(d.isProduction ? 'admin.org.productionHintOn' : 'admin.org.productionHintOff')}>
                  <input
                    type="checkbox"
                    checked={d.isProduction}
                    disabled={setProduction.isPending}
                    onChange={() => {
                      // The box shows the SAVED value, so it snaps back until the save lands; the new
                      // value is taken here, once, and the message is worded from it — not from the box.
                      const next = !d.isProduction
                      setProduction.mutate(
                        { id: d.id, isProduction: next },
                        {
                          onSuccess: () => ok(next ? 'admin.org.productionOn' : 'admin.org.productionOff'),
                          onError: (err) => {
                            const x = err as { hint?: string; details?: string }
                            setBanner({
                              kind: 'error',
                              text: x.hint === 'department_has_live_work'
                                ? t('admin.org.productionRefused', { name: d.name, detail: x.details ?? '' })
                                : t('admin.org.updateFailed'),
                            })
                          },
                        },
                      )
                    }}
                    data-testid={`dept-production-${d.id}`}
                  />
                  {t('admin.org.productionLabel')}
                </label>
              </td>
              <td className="row-actions">
                <IconButton icon="edit" label={t('admin.org.rename')} onClick={() => setEditingId(d.id)} data-testid={`dept-rename-${d.id}`} />
                <DeleteButton armed={armedId === d.id} label={t('admin.org.delete')} confirm={t('admin.org.confirmDelete')} disabled={deleteDept.isPending} onClick={() => onDelete(d)} data-testid={`dept-delete-${d.id}`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form className="org-add-form" onSubmit={onAdd} data-testid="dept-add-form">
        <input name="name" placeholder={t('admin.org.newDepartment')} data-testid="dept-add-name" />
        <Button variant="primary" icon="plus" type="submit" disabled={createDept.isPending} data-testid="dept-add-submit">
          {t('admin.org.add')}
        </Button>
      </form>

      <h2 className="org-section-heading">{t('admin.org.teams')}</h2>
      <p className="muted">{t('admin.org.teamsIntro')}</p>

      <table className="data-table" data-testid="teams-table">
        <thead>
          <tr>
            <th>{t('admin.org.teamName')}</th>
            <th>{t('admin.org.departmentName')}</th>
            <th>{t('admin.org.people')}</th>
            <th>{t('admin.users.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {(teams.data ?? []).map((tm) => (
            <tr key={tm.id} data-testid={`team-row-${tm.id}`}>
              <td>
                {teamEditingId === tm.id ? (
                  <input
                    defaultValue={tm.name}
                    autoFocus
                    data-testid={`team-edit-${tm.id}`}
                    onBlur={(e) => onRenameTeam(tm, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onRenameTeam(tm, (e.target as HTMLInputElement).value)
                      if (e.key === 'Escape') setTeamEditingId(null)
                    }}
                  />
                ) : (
                  tm.name
                )}
              </td>
              <td>{tm.departmentName}</td>
              <td>{tm.memberCount}</td>
              <td className="row-actions">
                <IconButton icon="edit" label={t('admin.org.rename')} onClick={() => setTeamEditingId(tm.id)} data-testid={`team-rename-${tm.id}`} />
                <DeleteButton armed={teamArmedId === tm.id} label={t('admin.org.delete')} confirm={t('admin.org.confirmDelete')} disabled={deleteTeam.isPending} onClick={() => onDeleteTeam(tm)} data-testid={`team-delete-${tm.id}`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form className="org-add-form" onSubmit={onAddTeam} data-testid="team-add-form">
        <select name="departmentId" defaultValue="" data-testid="team-add-department">
          <option value="" disabled>{t('admin.org.selectDepartment')}</option>
          {(departments.data ?? []).map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <input name="name" placeholder={t('admin.org.newTeam')} data-testid="team-add-name" />
        <Button variant="primary" icon="plus" type="submit" disabled={createTeam.isPending} data-testid="team-add-submit">
          {t('admin.org.add')}
        </Button>
      </form>
    </section>
  )
}
