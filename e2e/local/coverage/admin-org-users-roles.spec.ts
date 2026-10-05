import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows, userIdOf } from '../helpers/db'
import { expectMail, clearMailbox } from '../helpers/mailpit'

/**
 * Coverage — Admin: Organization (departments, teams, offices), Users (filters, invite with every
 * field, role / department / office / team, permissions overrides and scope grants, password reset,
 * deactivate / reactivate), Roles (new role with every field, edit, grants, reach change with its
 * confirmation, archive), SLA profiles (I49: OrganizationPage 16, OfficeDialog 6, UsersPage 13,
 * InviteUserDialog 14, UserPermissionsDialog 5, RolesPage 12, NewRoleDialog 8, SlaProfilesPage 7).
 *
 * `admin` (Power Admin) is the "may"; `lead` (department lead, no admin.* grant) may not open any
 * of these pages.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}
/** Every write answers with a "Done" dialog (ADR-0092 d.2): wait for it, read it as a success, close it. */
async function clear(page: Page) {
  const dialog = page.locator('.notice-dialog').first()
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await expect(dialog).not.toContainText(/did not work|could not|outside your reach/i)
  await dialog.locator('[data-testid$="-close"]').first().click()
  await expect(page.locator('.notice-dialog')).toHaveCount(0)
}
/** The users page answers some writes with a dialog and some with an inline banner. */
async function clearIf(page: Page) {
  const dialog = page.locator('.notice-dialog').first()
  if (await dialog.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await expect(dialog).not.toContainText(/did not work|could not|outside your reach/i)
    await dialog.locator('[data-testid$="-close"]').first().click()
  }
  await expect(page.locator('.notice-dialog')).toHaveCount(0)
}
const stamp = Date.now()

test.describe('Coverage — admin: organization, users, roles, SLA profiles', () => {
  test('Organization: a department added / renamed / deleted; a team likewise; an office with its days and timezone, edited, deleted', async ({ browser }) => {
    const admin = await as(browser, 'admin')
    await admin.goto('/admin/organization')
    await expect(admin.getByTestId('surface-organization')).toBeVisible()

    // Department.
    await admin.getByTestId('dept-add-form').getByTestId('dept-add-name').fill(`Cov dept ${stamp}`)
    await admin.getByTestId('dept-add-submit').click()
    await clear(admin)
    await expect.poll(async () => (await rows<{ id: string }>('departments', `select=id&name=eq.${encodeURIComponent(`Cov dept ${stamp}`)}`)).length).toBe(1)
    const [dept] = await rows<{ id: string }>('departments', `select=id&name=eq.${encodeURIComponent(`Cov dept ${stamp}`)}`)
    await admin.getByTestId(`dept-rename-${dept.id}`).click()
    await admin.getByTestId(`dept-edit-${dept.id}`).fill(`Cov dept ${stamp} renamed`)
    await admin.getByTestId(`dept-edit-${dept.id}`).press('Enter')
    await clear(admin)
    await expect.poll(async () => (await rows<{ name: string }>('departments', `select=name&id=eq.${dept.id}`))[0].name).toBe(`Cov dept ${stamp} renamed`)

    // Team under it.
    await admin.getByTestId('team-add-form').getByTestId('team-add-department').selectOption(dept.id)
    await admin.getByTestId('team-add-name').fill(`Cov team ${stamp}`)
    await admin.getByTestId('team-add-submit').click()
    await clear(admin)
    await expect.poll(async () => (await rows<{ id: string }>('teams', `select=id&department_id=eq.${dept.id}`)).length).toBe(1)
    const [team] = await rows<{ id: string }>('teams', `select=id&department_id=eq.${dept.id}`)
    await admin.getByTestId(`team-rename-${team.id}`).click()
    await admin.getByTestId(`team-edit-${team.id}`).fill(`Cov team ${stamp} renamed`)
    await admin.getByTestId(`team-edit-${team.id}`).press('Enter')
    await clear(admin)
    await expect.poll(async () => (await rows<{ name: string }>('teams', `select=name&id=eq.${team.id}`))[0].name).toBe(`Cov team ${stamp} renamed`)
    await admin.getByTestId(`team-delete-${team.id}`).click()
    await admin.getByTestId(`team-delete-${team.id}`).click()
    await clear(admin)
    await expect.poll(async () => (await rows<{ id: string }>('teams', `select=id&id=eq.${team.id}`)).length).toBe(0)
    await admin.getByTestId(`dept-delete-${dept.id}`).click()
    await admin.getByTestId(`dept-delete-${dept.id}`).click()
    await clear(admin)
    await expect.poll(async () => (await rows<{ id: string }>('departments', `select=id&id=eq.${dept.id}`)).length).toBe(0)

    // Office: the dialog with name, timezone and the working days; then edit; then delete.
    await admin.getByTestId('office-add').click()
    const dialog = admin.getByTestId('office-dialog')
    await expect(dialog).toBeVisible()
    await admin.getByTestId('office-name').fill(`Cov office ${stamp}`)
    const tz = admin.getByTestId('office-timezone')
    const tzValues = await tz.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))
    await tz.selectOption(tzValues.find((v) => /Cairo/.test(v)) ?? tzValues[0])
    // Untick Sunday, tick Saturday: a Mon–Sat week.
    await admin.getByTestId('office-day-1').uncheck()
    await admin.getByTestId('office-day-7').check()
    await admin.getByTestId('office-submit').click()
    await expect(dialog).toHaveCount(0)
    await clear(admin)
    await expect.poll(async () => (await rows<{ id: string }>('offices', `select=id&name=eq.${encodeURIComponent(`Cov office ${stamp}`)}`)).length).toBe(1)
    const [office] = await rows<{ id: string; timezone: string; working_days: number[] }>('offices', `select=id,timezone,working_days&name=eq.${encodeURIComponent(`Cov office ${stamp}`)}`)
    expect(office.working_days).not.toContain(1)
    expect(office.working_days).toContain(7)
    await admin.getByTestId(`office-edit-${office.id}`).click()
    await expect(admin.getByTestId('office-name')).toHaveValue(`Cov office ${stamp}`)
    await admin.getByTestId('office-name').fill(`Cov office ${stamp} edited`)
    await admin.getByTestId('office-cancel').click()
    await expect(dialog).toHaveCount(0)
    expect((await rows<{ name: string }>('offices', `select=name&id=eq.${office.id}`))[0].name).toBe(`Cov office ${stamp}`)
    await admin.getByTestId(`office-edit-${office.id}`).click()
    await admin.getByTestId('office-name').fill(`Cov office ${stamp} edited`)
    await admin.getByTestId('office-submit').click()
    await clear(admin)
    await expect.poll(async () => (await rows<{ name: string }>('offices', `select=name&id=eq.${office.id}`))[0].name).toBe(`Cov office ${stamp} edited`)
    await admin.getByTestId(`office-delete-${office.id}`).click()
    await admin.getByTestId(`office-delete-${office.id}`).click()
    await clear(admin)
    await expect.poll(async () => (await rows<{ id: string }>('offices', `select=id&id=eq.${office.id}`)).length).toBe(0)
    await admin.context().close()
  })

  test('Users: the filters and Clear; invite with every field (reroll, cancel, submit); role / department / office / team; permissions; reset; deactivate and reactivate', async ({ browser }) => {
    const admin = await as(browser, 'admin')
    await admin.goto('/admin/users')
    await expect(admin.getByTestId('users-table')).toBeVisible()
    const makerId = await userIdOf(PEOPLE.maker.email)
    const writerId = await userIdOf(PEOPLE.writer.email)
    const [creative] = await rows<{ id: string }>('departments', `select=id&name=eq.Creative`)
    const [design] = await rows<{ id: string }>('teams', `select=id&name=eq.Design`)
    const [baghdad] = await rows<{ id: string }>('offices', `select=id&name=eq.Baghdad`)

    // Filters, one by one, then Clear.
    await admin.getByTestId('users-filter-search').fill(PEOPLE.maker.name)
    await expect(admin.getByTestId(`status-${makerId}`)).toBeVisible()
    await expect(admin.getByTestId(`status-${writerId}`)).toHaveCount(0)
    await admin.getByTestId('users-filter-clear').click()
    await expect(admin.getByTestId(`status-${writerId}`)).toBeVisible()
    await admin.getByTestId('users-filter-department').selectOption(creative.id)
    await expect(admin.getByTestId(`status-${writerId}`)).toHaveCount(0)
    await admin.getByTestId('users-filter-team').selectOption(design.id)
    await expect(admin.getByTestId(`status-${makerId}`)).toBeVisible()
    await admin.getByTestId('users-filter-clear').click()
    await admin.getByTestId('users-filter-office').selectOption(baghdad.id)
    await expect(admin.getByTestId(`status-${await userIdOf(PEOPLE.editor.email)}`)).toHaveCount(0) // Dubai
    await admin.getByTestId('users-filter-clear').click()
    const roleSel = admin.getByTestId('users-filter-role')
    const roleValues = await roleSel.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean))
    await roleSel.selectOption(roleValues[0])
    await admin.getByTestId('users-filter-clear').click()
    await expect(admin.getByTestId(`status-${makerId}`)).toBeVisible()

    // Invite: open, every field, the nickname reroll, Cancel (nothing sent), then a real invite.
    await admin.getByTestId('invite-open').click()
    const invite = admin.getByTestId('invite-dialog')
    await expect(invite).toBeVisible()
    await admin.getByTestId('invite-name').fill(`Cov Invitee ${stamp}`)
    const nick = await admin.getByTestId('invite-nickname').inputValue()
    await admin.getByTestId('invite-nickname-reroll').click()
    await expect(admin.getByTestId('invite-nickname')).not.toHaveValue(nick)
    await admin.getByTestId('invite-cancel').click()
    await expect(invite).toHaveCount(0)
    const email = `maestro.dev+cov${stamp}@example.test`
    await clearMailbox()
    await admin.getByTestId('invite-open').click()
    await admin.getByTestId('invite-email').fill(email)
    await admin.getByTestId('invite-name').fill(`Cov Invitee ${stamp}`)
    await admin.getByTestId('invite-nickname').fill(`cov${stamp % 1000}`)
    await admin.getByTestId('invite-job-title').fill('Junior designer')
    const inviteRoles = await admin.getByTestId('invite-role').locator('option').evaluateAll((os) => os.map((o) => ({ v: (o as HTMLOptionElement).value, t: o.textContent ?? '' })))
    await admin.getByTestId('invite-role').selectOption(inviteRoles.find((o) => /Team Member/.test(o.t))!.v)
    await admin.getByTestId('invite-department').selectOption(creative.id)
    await admin.getByTestId('invite-team').selectOption(design.id)
    await admin.getByTestId('invite-office').selectOption(baghdad.id)
    await admin.getByTestId('invite-locale').selectOption('ar')
    await admin.getByTestId('invite-as-resource').check()
    await admin.getByTestId('invite-submit').click()
    await expect(invite).toHaveCount(0)
    await clearIf(admin)
    await expect.poll(async () => (await rows<{ id: string }>('user_profiles', `select=id&display_name=eq.${encodeURIComponent(`Cov Invitee ${stamp}`)}`)).length, { timeout: 20_000 }).toBe(1)
    const [invitee] = await rows<{ id: string; department_id: string; team_id: string; office_id: string; locale: string; job_title: string | null }>('user_profiles', `select=id,department_id,team_id,office_id,locale,job_title&display_name=eq.${encodeURIComponent(`Cov Invitee ${stamp}`)}`)
    expect(invitee.department_id).toBe(creative.id)
    expect(invitee.team_id).toBe(design.id)
    expect(invitee.office_id).toBe(baghdad.id)
    expect(invitee.locale).toBe('ar')
    expect(invitee.job_title).toBe('Junior designer')
    expect(await rows('resources', `select=id&user_id=eq.${invitee.id}`)).toHaveLength(1)
    await expectMail(email, /invited/i)

    // On the invitee's row: role, department, office, team changes; permissions; reset; deactivate.
    await admin.getByTestId('users-filter-search').fill(`Cov Invitee ${stamp}`)
    const roleOptions = await admin.getByTestId(`role-${invitee.id}`).locator('option').evaluateAll((os) => os.map((o) => ({ v: (o as HTMLOptionElement).value, t: o.textContent ?? '' })))
    const teamLeadRole = roleOptions.find((o) => /Team Leader/.test(o.t))!.v
    await admin.getByTestId(`role-${invitee.id}`).selectOption(teamLeadRole)
    await clearIf(admin)
    await expect.poll(async () => (await rows<{ role_id: string }>('user_profiles', `select=role_id&id=eq.${invitee.id}`))[0].role_id).toBe(teamLeadRole)
    const [content] = await rows<{ id: string }>('departments', `select=id&name=eq.Content`)
    await admin.getByTestId(`department-${invitee.id}`).selectOption(content.id)
    await clearIf(admin)
    await expect.poll(async () => (await rows<{ department_id: string }>('user_profiles', `select=department_id&id=eq.${invitee.id}`))[0].department_id).toBe(content.id)
    const [copy] = await rows<{ id: string }>('teams', `select=id&name=eq.Copy`)
    await admin.getByTestId(`team-${invitee.id}`).selectOption(copy.id)
    await clearIf(admin)
    await expect.poll(async () => (await rows<{ team_id: string }>('user_profiles', `select=team_id&id=eq.${invitee.id}`))[0].team_id).toBe(copy.id)
    const [dubai] = await rows<{ id: string }>('offices', `select=id&name=eq.Dubai`)
    await admin.getByTestId(`office-${invitee.id}`).selectOption(dubai.id)
    await clearIf(admin)
    await expect.poll(async () => (await rows<{ office_id: string }>('user_profiles', `select=office_id&id=eq.${invitee.id}`))[0].office_id).toBe(dubai.id)

    // Permissions: one override, one scope grant added and removed, close.
    await admin.getByTestId(`perms-${invitee.id}`).click()
    const perms = admin.getByTestId('user-perms-dialog')
    await expect(perms).toBeVisible()
    await expect(admin.getByTestId('user-perms-matrix')).toBeVisible()
    // The grant tables are private (ADR-0037) — read the effect back from the matrix's own cell.
    const overrideId = 'override-schedule-view'
    const effectiveId = 'effective-schedule-view'
    await expect(admin.getByTestId('override-schedule-view')).toBeVisible()
    const before = ((await admin.getByTestId(effectiveId).textContent()) ?? '').trim()
    // Flip the effect: an allow where the role says No, a deny where it says Yes.
    const flip = /^no$/i.test(before) ? 'allow' : 'deny'
    await admin.getByTestId(overrideId).selectOption(flip)
    await clearIf(admin)
    await expect(admin.getByTestId(overrideId)).toHaveValue(flip)
    await expect(admin.getByTestId(effectiveId)).not.toHaveText(before)
    await admin.getByTestId(overrideId).selectOption('inherit')
    await clearIf(admin)
    await expect(admin.getByTestId(effectiveId)).toHaveText(before)
    await expect(admin.getByTestId(overrideId)).toHaveValue('inherit')
    await admin.getByTestId('scope-pick').selectOption({ index: 1 })
    await admin.getByTestId('scope-add').click()
    await expect.poll(async () => (await rows<{ id: string }>('user_scope_grants', `select=id&user_id=eq.${invitee.id}`)).length).toBe(1)
    const [grant] = await rows<{ id: string }>('user_scope_grants', `select=id&user_id=eq.${invitee.id}`)
    await admin.getByTestId(`scope-remove-${grant.id}`).click()
    await expect.poll(async () => (await rows<{ id: string }>('user_scope_grants', `select=id&user_id=eq.${invitee.id}`)).length).toBe(0)
    await admin.getByTestId('user-perms-close').click()
    await expect(perms).toHaveCount(0)

    // Password reset: the mail goes out.
    await clearMailbox()
    await admin.getByTestId(`reset-${invitee.id}`).click()
    await clearIf(admin)
    await expectMail(email, /reset|password|code/i)

    // Deactivate (armed twice — the button relabels to "confirm?"), then reactivate.
    await admin.getByTestId(`toggle-active-${invitee.id}`).click()
    await admin.getByTestId(`toggle-active-${invitee.id}`).click()
    await clearIf(admin)
    await expect.poll(async () => (await rows<{ is_active: boolean }>('user_profiles', `select=is_active&id=eq.${invitee.id}`))[0].is_active).toBe(false)
    await admin.getByTestId(`toggle-active-${invitee.id}`).click()
    await clearIf(admin)
    await expect.poll(async () => (await rows<{ is_active: boolean }>('user_profiles', `select=is_active&id=eq.${invitee.id}`))[0].is_active).toBe(true)
    await admin.context().close()
  })

  test('Roles: a new role with every field (cancel, then create); edit name / description / route; a grant; a reach change with its confirmation; archive', async ({ browser }) => {
    const admin = await as(browser, 'admin')
    await admin.goto('/admin/roles')
    await expect(admin.getByTestId('roles-list')).toBeVisible()

    await admin.getByTestId('role-create-open').click()
    const dlg = admin.getByTestId('new-role-dialog')
    await expect(dlg).toBeVisible()
    await admin.getByTestId('new-role-name').fill('Not created')
    await admin.getByTestId('new-role-cancel').click()
    await expect(dlg).toHaveCount(0)
    await admin.getByTestId('role-create-open').click()
    await admin.getByTestId('new-role-name').fill(`Cov role ${stamp}`)
    await admin.getByTestId('new-role-description').fill('A role the coverage run creates.')
    await admin.getByTestId('new-role-scope').selectOption('department')
    const routeSel = admin.getByTestId('new-role-route')
    const routes = await routeSel.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean))
    await routeSel.selectOption(routes[0])
    const copySel = admin.getByTestId('new-role-copy')
    const copies = await copySel.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean))
    if (copies.length) await copySel.selectOption(copies[0])
    await admin.getByTestId('new-role-submit').click()
    await expect(dlg).toHaveCount(0)
    await expect.poll(async () => (await rows<{ id: string; key: string; scope: string }>('roles', `select=id,key,scope&name=eq.${encodeURIComponent(`Cov role ${stamp}`)}`)).length).toBe(1)
    const [role] = await rows<{ id: string; key: string; scope: string }>('roles', `select=id,key,scope&name=eq.${encodeURIComponent(`Cov role ${stamp}`)}`)
    expect(role.scope).toBe('department')

    // Select it in the list; edit; a grant; save.
    await admin.getByTestId(`role-item-${role.key}`).click()
    await expect(admin.getByTestId('role-detail-form')).toBeVisible()
    await admin.getByTestId('role-name').fill(`Cov role ${stamp} edited`)
    await admin.getByTestId('role-description').fill('Edited by the coverage run.')
    await admin.getByTestId('role-default-route').selectOption(routes[routes.length - 1])
    await admin.getByTestId('role-save').click()
    await clear(admin)
    await expect.poll(async () => (await rows<{ name: string; default_route: string }>('roles', `select=name,default_route&id=eq.${role.id}`))[0].name).toBe(`Cov role ${stamp} edited`)
    // A grant is its own write: ticking it saves at once.
    const grantBox = admin.getByTestId('grant-bookings-create')
    const wasChecked = await grantBox.isChecked()
    await grantBox.click()
    await clear(admin)
    await expect.poll(async () => (await rows<{ resource: string }>('role_grants', `select=resource&role_id=eq.${role.id}&resource=eq.bookings&action=eq.create`)).length > 0).toBe(!wasChecked)

    // Reach: widening to tenant asks first — Cancel keeps it; confirm saves it.
    await admin.getByTestId('role-scope').selectOption('tenant')
    await admin.getByTestId('role-save').click()
    await expect(admin.getByTestId('role-reach-confirm')).toBeVisible()
    await admin.getByTestId('role-reach-cancel').click()
    await expect(admin.getByTestId('role-reach-confirm')).toHaveCount(0)
    expect((await rows<{ scope: string }>('roles', `select=scope&id=eq.${role.id}`))[0].scope).toBe('department')
    await admin.getByTestId('role-save').click()
    await admin.getByTestId('role-reach-confirm-save').click()
    await clear(admin)
    await expect.poll(async () => (await rows<{ scope: string }>('roles', `select=scope&id=eq.${role.id}`))[0].scope).toBe('tenant')

    // Archive.
    await admin.getByTestId('role-archive').click()
    await clear(admin)
    await expect.poll(async () => (await rows<{ status: string }>('roles', `select=status&id=eq.${role.id}`))[0].status).toBe('archived')
    await admin.context().close()
  })

  test('SLA profiles: add with every field, cancel an edit, edit, and the default', async ({ browser }) => {
    const admin = await as(browser, 'admin')
    await admin.goto('/sla-profiles')
    await expect(admin.getByTestId('surface-sla-profiles')).toBeVisible()
    // The seed carries no SLA profile, and the database is long-lived across runs: the tenant's
    // one default is made here if it is not already there (may), so the second one can be refused.
    const hasDefault = (await rows<{ id: string }>('sla_profiles', 'select=id&is_default=eq.true')).length > 0
    if (!hasDefault) {
      await admin.getByTestId('sla-form').getByTestId('sla-name').fill(`Cov SLA default ${stamp}`)
      await admin.getByTestId('sla-hours').fill('24')
      await admin.getByTestId('sla-default').check()
      await admin.getByTestId('sla-submit').click()
      await clear(admin)
      await expect.poll(async () => (await rows<{ id: string }>('sla_profiles', 'select=id&is_default=eq.true')).length).toBe(1)
    }
    await admin.getByTestId('sla-form').getByTestId('sla-name').fill(`Cov SLA ${stamp}`)
    await admin.getByTestId('sla-hours').fill('36')
    // A second default for the same work type is refused, in words (may not).
    await admin.getByTestId('sla-default').check()
    await admin.getByTestId('sla-submit').click()
    const refusal = admin.locator('.notice-dialog').first()
    await expect(refusal).toContainText(/already has a default/i)
    await refusal.locator('[data-testid$="-close"]').first().click()
    await admin.getByTestId('sla-default').uncheck()
    await admin.getByTestId('sla-submit').click()
    await clear(admin)
    await expect.poll(async () => (await rows<{ id: string; turnaround_hours: number; is_default: boolean }>('sla_profiles', `select=id,turnaround_hours,is_default&name=eq.${encodeURIComponent(`Cov SLA ${stamp}`)}`)).length).toBe(1)
    const [p] = await rows<{ id: string; turnaround_hours: number; is_default: boolean }>('sla_profiles', `select=id,turnaround_hours,is_default&name=eq.${encodeURIComponent(`Cov SLA ${stamp}`)}`)
    expect(p.turnaround_hours).toBe(36)
    expect(p.is_default).toBe(false)
    await admin.getByTestId(`sla-edit-${p.id}`).click()
    await expect(admin.getByTestId('sla-name')).toHaveValue(`Cov SLA ${stamp}`)
    await admin.getByTestId('sla-hours').fill('48')
    await admin.getByTestId('sla-cancel').click()
    expect((await rows<{ turnaround_hours: number }>('sla_profiles', `select=turnaround_hours&id=eq.${p.id}`))[0].turnaround_hours).toBe(36)
    await admin.getByTestId(`sla-edit-${p.id}`).click()
    await admin.getByTestId('sla-hours').fill('48')
    await admin.getByTestId('sla-submit').click()
    await clear(admin)
    await expect.poll(async () => (await rows<{ turnaround_hours: number; is_default: boolean }>('sla_profiles', `select=turnaround_hours,is_default&id=eq.${p.id}`))[0].turnaround_hours).toBe(48)
    await admin.context().close()
  })

  test('may NOT: a department lead is not offered the admin pages', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    for (const path of ['/admin/organization', '/admin/users', '/admin/roles']) {
      await lead.goto(path)
      await expect(lead).not.toHaveURL(new RegExp(`${path}$`))
    }
    await lead.context().close()
  })
})
