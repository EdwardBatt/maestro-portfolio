import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabaseUntyped } from '../lib/supabase'
import { useDevPreview } from './dev-preview'
import { useAuth } from './auth-context'
import { useDepartments, useTeams } from '../features/admin/api/admin-api'
import { Button, IconButton } from '../components/Button'

/**
 * Dev "View as role" panel (removable). Visible ONLY to a real holder of `dev_view:view` (ADR-0120 addendum).
 * Applies a client-side preview of any role + team + department so the UI/UX
 * can be reviewed without logging in and out. Writes are blocked while a preview
 * is active (preview-guard); RLS on the real JWT is unaffected. To remove this
 * feature: delete DevPanel + dev-preview + preview-guard and their wiring.
 */
function useAllRoles() {
  return useQuery({
    queryKey: ['dev-all-roles'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabaseUntyped.from('roles').select('id, key, name').eq('status', 'active').order('name')
      if (error) throw error
      return (data ?? []) as { id: string; key: string; name: string }[]
    },
  })
}

export function DevPanel() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { canUseDevPanel, viewAsPeople, active, preview, setPreview, clear } = useDevPreview()
  const { viewAs, startViewAs, stopViewAs } = useAuth()
  const queryClient = useQueryClient()
  const [personId, setPersonId] = useState('')
  const [personError, setPersonError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const roles = useAllRoles()
  const departments = useDepartments()
  const teams = useTeams()

  const [open, setOpen] = useState(false)
  const [roleId, setRoleId] = useState(preview.roleId ?? '')
  const [departmentId, setDepartmentId] = useState(preview.departmentId ?? '')
  const [teamId, setTeamId] = useState(preview.teamId ?? '')

  if (!canUseDevPanel) return null

  const teamOptions = (teams.data ?? []).filter((tm) => !departmentId || tm.departmentId === departmentId)

  // ADR-0120: the database checks the caller and records the view, then answers with who they are.
  async function viewAsPerson() {
    if (!personId) return
    setPersonError(null)
    setStarting(true)
    const { data, error } = await supabaseUntyped.rpc('view_as_start', { p_user: personId })
    setStarting(false)
    if (error) return setPersonError(error.message)
    const d = data as { id: string; email: string | null; name: string; app_metadata: Record<string, unknown> }
    clear()
    startViewAs({ id: d.id, email: d.email, name: d.name, appMetadata: d.app_metadata ?? {} })
    queryClient.clear() // nothing loaded as the admin may show as the person
    setOpen(false)
    navigate('/')
  }
  function exitPerson() {
    stopViewAs()
    queryClient.clear()
    setPersonId('')
    setOpen(false)
    navigate('/')
  }

  function apply() {
    if (!roleId) return
    setPreview({ roleId, teamId: teamId || null, departmentId: departmentId || null })
    setOpen(false)
    navigate('/') // land on the previewed role's default route (permissions is preview-aware)
  }
  function exit() {
    clear()
    setRoleId('')
    setTeamId('')
    setDepartmentId('')
    setOpen(false)
    navigate('/')
  }

  return (
    <div className="dev-panel" data-testid="dev-panel">
      {!open ? (
        <button type="button" className={`dev-fab${active || viewAs ? ' active' : ''}`} onClick={() => setOpen(true)} data-testid="dev-fab">
          {viewAs ? t('dev.viewingShort', { name: viewAs.name }) : active ? t('dev.previewingShort') : t('dev.open')}
        </button>
      ) : viewAs ? (
        <div className="dev-pop" role="dialog" aria-label={t('dev.title')}>
          <div className="dev-pop-head">
            <strong>{t('dev.viewingAs', { name: viewAs.name })}</strong>
            <IconButton icon="close" label={t('schedule.cancel')} onClick={() => setOpen(false)} data-testid="dev-close" />
          </div>
          <p className="muted hint">{t('dev.personHint')}</p>
          <div className="dev-actions">
            <Button variant="secondary" onClick={exitPerson} data-testid="dev-person-exit">{t('dev.exitPerson')}</Button>
          </div>
        </div>
      ) : (
        <div className="dev-pop" role="dialog" aria-label={t('dev.title')}>
          <div className="dev-pop-head">
            <strong>{t('dev.title')}</strong>
            <IconButton icon="close" label={t('schedule.cancel')} onClick={() => setOpen(false)} data-testid="dev-close" />
          </div>
          <label>
            {t('dev.person')}
            <select value={personId} onChange={(e) => { setPersonId(e.target.value); setPersonError(null) }} data-testid="dev-person">
              <option value="">{t('dev.selectPerson')}</option>
              {/* ADR-0120 addendum: only the people in the viewer's reach, never themselves — the database's list. */}
              {viewAsPeople.map((p) => (
                <option key={p.id} value={p.id}>{p.role ? `${p.name} · ${p.role}` : p.name}</option>
              ))}
            </select>
          </label>
          <p className="muted hint">{t('dev.personHint')}</p>
          {personError && <p className="form-error" role="alert" data-testid="dev-person-error">{personError}</p>}
          <div className="dev-actions">
            <Button variant="primary" disabled={!personId} busy={starting} onClick={() => void viewAsPerson()} data-testid="dev-person-apply">{t('dev.viewAsPerson')}</Button>
          </div>
          <p className="dev-section"><strong>{t('dev.roleSection')}</strong></p>
          <p className="muted hint">{t('dev.hint')}</p>

          <label>
            {t('dev.role')}
            <select value={roleId} onChange={(e) => setRoleId(e.target.value)} data-testid="dev-role">
              <option value="">{t('dev.selectRole')}</option>
              {(roles.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </label>
          <label>
            {t('dev.department')}
            <select value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setTeamId('') }} data-testid="dev-department">
              <option value="">{t('dev.none')}</option>
              {(departments.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>
          <label>
            {t('dev.team')}
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)} data-testid="dev-team">
              <option value="">{t('dev.none')}</option>
              {teamOptions.map((tm) => (
                <option key={tm.id} value={tm.id}>{tm.departmentName ? `${tm.name} · ${tm.departmentName}` : tm.name}</option>
              ))}
            </select>
          </label>

          <div className="dev-actions">
            {active && (
              <Button variant="secondary" onClick={exit} data-testid="dev-exit">{t('dev.exit')}</Button>
            )}
            <Button variant="primary" disabled={!roleId} onClick={apply} data-testid="dev-apply">{t('dev.apply')}</Button>
          </div>
        </div>
      )}
    </div>
  )
}
