import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import {
  useAssignableRoles,
  useDepartments,
  useInviteUser,
  useOffices,
  useTeams,
} from '../api/admin-api'
import { randomNickname } from '../../../lib/nickname/generate'
import { Modal } from '../../../components/Modal'
import { Button, IconButton } from '../../../components/Button'

const InviteInput = z.object({
  email: z.string().trim().email(),
  displayName: z.string().trim().min(1).max(120),
})

/**
 * Invite a teammate (L1.1, ADR-0008 / ADR-0011). The Edge Function creates the
 * auth user with server-set claims (tenant + role id) and sends the invite
 * email; the invitee lands on /set-password. Role comes from the tenant's roles
 * TABLE; job title and department are org-chart facts on the profile.
 *
 * ADR-0011: an internal user is a bookable resource by default. The "Also a
 * bookable resource" toggle (default ON) auto-creates a human resource with a
 * fun, unique nickname (editable here, 🎲 reroll); the old manual "Link to
 * Resource" dropdown is gone — pre-existing links are managed from Resources.
 */
export function InviteUserDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const invite = useInviteUser()
  const roles = useAssignableRoles()
  const offices = useOffices()
  const departments = useDepartments()
  const teams = useTeams()

  const defaultRole = roles.data?.find((r) => r.key === 'team_member')?.id ?? ''
  const [roleId, setRoleId] = useState('')
  const [locale, setLocale] = useState<'en' | 'ar'>('en')
  const [officeId, setOfficeId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [teamId, setTeamId] = useState('')

  // A team belongs to a department (ADR-0014). Offer only teams under the chosen
  // department; picking a department clears a now-mismatched team.
  const teamOptions = (teams.data ?? []).filter((tm) => !departmentId || tm.departmentId === departmentId)
  function onDepartmentChange(next: string) {
    setDepartmentId(next)
    if (teamId && next && !(teams.data ?? []).some((tm) => tm.id === teamId && tm.departmentId === next)) {
      setTeamId('')
    }
  }
  const [asResource, setAsResource] = useState(true)
  const [nickname, setNickname] = useState(() => randomNickname())
  const [error, setError] = useState<string | null>(null)

  const effectiveRoleId = roleId || defaultRole

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const form = new FormData(e.currentTarget)
    const parsed = InviteInput.safeParse({
      email: form.get('email'),
      displayName: form.get('displayName'),
    })
    if (!parsed.success) {
      setError(t(parsed.error.issues[0]?.path[0] === 'email' ? 'auth.invalidEmail' : 'admin.users.nameRequired'))
      return
    }
    if (!effectiveRoleId) {
      setError(t('admin.users.roleRequired'))
      return
    }
    const jobTitle = String(form.get('jobTitle') ?? '').trim()
    try {
      await invite.mutateAsync({
        ...parsed.data,
        roleId: effectiveRoleId,
        locale,
        officeId: officeId || null,
        departmentId: departmentId || null,
        teamId: teamId || null,
        jobTitle: jobTitle || null,
        asResource,
        nickname: asResource ? nickname.trim() || null : null,
      })
      onClose()
    } catch (err) {
      const code = (err as { code?: string }).code
      const exists = code === 'email_exists' || code === 'create_failed'
      setError(t(exists ? 'admin.users.inviteExists' : 'admin.users.inviteFailed'))
    }
  }

  return (
    <Modal onClose={onClose} card={false}>
      <form className="dialog" role="dialog" aria-modal="true" aria-label={t('admin.users.invite')}
        data-testid="invite-dialog" onSubmit={onSubmit}>
        <h2>{t('admin.users.invite')}</h2>
        <p className="muted">{t('admin.users.inviteIntro')}</p>

        <label>
          {t('auth.email')}
          <input name="email" type="email" data-testid="invite-email" />
        </label>
        <div className="dialog-row">
          <label>
            {t('admin.users.displayName')}
            <input name="displayName" data-testid="invite-name" />
          </label>
          <label>
            {t('admin.users.jobTitle')}
            <input name="jobTitle" data-testid="invite-job-title" />
          </label>
        </div>

        <div className="dialog-row">
          <label>
            {t('admin.users.role')}
            <select value={effectiveRoleId} onChange={(e) => setRoleId(e.target.value)} data-testid="invite-role">
              {(roles.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </label>
          <label>
            {t('admin.users.department')}
            <select value={departmentId} onChange={(e) => onDepartmentChange(e.target.value)} data-testid="invite-department">
              <option value="">{t('admin.users.noDepartment')}</option>
              {(departments.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="dialog-row">
          <label>
            {t('admin.users.team')}
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)} data-testid="invite-team">
              <option value="">{t('admin.users.noTeam')}</option>
              {teamOptions.map((tm) => (
                <option key={tm.id} value={tm.id}>
                  {tm.departmentName ? `${tm.name} · ${tm.departmentName}` : tm.name}
                </option>
              ))}
            </select>
          </label>
          {departmentId === '' && (
            <p className="muted hint">{t('admin.users.teamPickDepartmentHint')}</p>
          )}
        </div>

        <div className="dialog-row">
          <label>
            {t('admin.users.office')}
            <select value={officeId} onChange={(e) => setOfficeId(e.target.value)} data-testid="invite-office">
              <option value="">{t('admin.users.noOffice')}</option>
              {(offices.data ?? []).map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </label>
          <label>
            {t('admin.users.locale')}
            <select value={locale} onChange={(e) => setLocale(e.target.value as 'en' | 'ar')} data-testid="invite-locale">
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </select>
          </label>
        </div>

        <fieldset className="invite-resource" data-testid="invite-resource-fieldset">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={asResource}
              onChange={(e) => setAsResource(e.target.checked)}
              data-testid="invite-as-resource"
            />
            <span>{t('admin.users.asResource')}</span>
          </label>
          <p className="muted hint">{t('admin.users.asResourceHint')}</p>
          {asResource && (
            <label>
              {t('admin.users.nickname')}
              <span className="nickname-row">
                <input
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  data-testid="invite-nickname"
                  maxLength={60}
                />
                <IconButton
                  icon="dice"
                  size="sm"
                  className="reroll"
                  label={t('admin.users.rerollNickname')}
                  onClick={() => setNickname(randomNickname())}
                  data-testid="invite-nickname-reroll"
                />
              </span>
            </label>
          )}
        </fieldset>

        {error && <p className="form-error" role="alert" data-testid="invite-error">{error}</p>}

        <div className="dialog-actions">
          <Button variant="secondary" onClick={onClose} data-testid="invite-cancel">
            {t('schedule.cancel')}
          </Button>
          <Button variant="primary" type="submit" disabled={invite.isPending} data-testid="invite-submit">
            {invite.isPending ? t('admin.users.inviting') : t('admin.users.sendInvite')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
