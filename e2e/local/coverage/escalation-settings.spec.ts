import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows } from '../helpers/db'
import { fillSingleJobToReview } from '../helpers/single-job'

/**
 * Coverage — Admin → Organization → Escalations (I59.24 / ADR-0108 + addendum; I59.20 the untimed
 * minutes; I59.27 / ADR-0111 the filler words) and the filler refusal at release (ADR-0111 d.2, E10).
 *
 * `admin` (Power Admin, organization:manage) is the "may": edits a rule's hours, roles and people,
 * the over-capacity percentage and the untimed minutes, saves once; adds and removes a filler word.
 * `lead` (no admin.* grant) may not open the page. The AM "may not" release a brief that says only
 * filler: warned beside the field before, refused in words at release.
 *
 * Every value changed here is put back in `afterEach` — through the screen, as it was changed — so a
 * failure half-way never leaves the tenant escalating on the wrong clock (the M1 lesson).
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}
/** A save answers with the org page's "Done" dialog (ADR-0092 d.2): read it as a success, close it. */
async function clear(page: Page) {
  const dialog = page.getByTestId('org-banner-dialog')
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await expect(dialog).not.toContainText(/could not|only someone/i)
  await page.getByTestId('org-banner-close').click()
  await expect(page.locator('.notice-dialog')).toHaveCount(0)
}

type Rule = { id: string; kind: string; hours: number; role_ids: string[]; relative: string[] }
const ruleOf = async (kind: string) => (await rows<Rule>('tenant_escalation_rules', `select=id,kind,hours,role_ids,relative&kind=eq.${kind}`))[0]!
const timings = async () =>
  (await rows<{ over_capacity_pct: number; untimed_threshold_minutes: number }>('tenant_reminder_settings', 'select=over_capacity_pct,untimed_threshold_minutes'))[0]!

let before: { blocked: Rule; extensionAm: Rule; pct: number; minutes: number } | null = null

/** Put a rule back to what it was, through the screen. */
async function restoreRule(page: Page, was: Rule) {
  const kind = was.kind
  await page.getByTestId(`escalation-hours-${kind}`).fill(String(was.hours))
  const now = await ruleOf(kind)
  for (const id of now.role_ids.filter((x) => !was.role_ids.includes(x))) {
    await page.getByTestId(`escalation-role-remove-${kind}-${id}`).click()
  }
  for (const id of was.role_ids.filter((x) => !now.role_ids.includes(x))) {
    await page.getByTestId(`escalation-role-add-${kind}`).selectOption(id)
  }
  for (const p of ['owner', 'account_manager', 'owner_department_lead', 'assignee_team_lead', 'reviewers']) {
    const box = page.getByTestId(`escalation-person-${kind}-${p}`)
    if ((await box.isChecked()) !== was.relative.includes(p)) await box.click()
  }
}

test.describe('Coverage — escalation settings and filler words', () => {
  test.afterEach(async ({ browser }) => {
    if (!before) return
    const admin = await as(browser, 'admin')
    await admin.goto('/admin/organization')
    await expect(admin.getByTestId('escalation-settings-form')).toBeVisible()
    await restoreRule(admin, before.blocked)
    await restoreRule(admin, before.extensionAm)
    await admin.getByTestId('escalation-over-capacity').fill(String(before.pct))
    await admin.getByTestId('escalation-untimed-minutes').fill(String(before.minutes))
    const save = admin.getByTestId('escalation-settings-save')
    if (await save.isEnabled()) {
      await save.click()
      await clear(admin)
    }
    await admin.context().close()
    before = null
  })

  test('may: a rule’s hours, roles and people, the over-capacity % and untimed minutes — one Save, and they land', async ({ browser }) => {
    const blocked = await ruleOf('blocked')
    const extensionAm = await ruleOf('extension_am')
    const t = await timings()
    before = { blocked, extensionAm, pct: t.over_capacity_pct, minutes: t.untimed_threshold_minutes }

    const admin = await as(browser, 'admin')
    await admin.goto('/admin/organization')
    const form = admin.getByTestId('escalation-settings-form')
    await expect(form).toBeVisible()
    // Every kind the tenant has is a row — the E8 split included once its migration is in.
    await expect(admin.getByTestId('escalation-row-unassigned')).toBeVisible()
    await expect(admin.getByTestId('escalation-row-blocked')).toBeVisible()
    await expect(admin.getByTestId('escalation-hours-blocked')).toHaveValue(String(blocked.hours))
    await expect(admin.getByTestId('escalation-settings-save')).toBeDisabled()

    // Blocked: 30 hours, the Traffic Manager added, the assignee's team lead added.
    const [traffic] = await rows<{ id: string }>('roles', 'select=id&key=eq.scheduler')
    await admin.getByTestId('escalation-hours-blocked').fill('30')
    if (!blocked.role_ids.includes(traffic!.id)) {
      await admin.getByTestId('escalation-role-add-blocked').selectOption(traffic!.id)
    }
    await expect(admin.getByTestId(`escalation-role-blocked-${traffic!.id}`)).toBeVisible()
    const teamLead = admin.getByTestId('escalation-person-blocked-assignee_team_lead')
    if (!(await teamLead.isChecked())) await teamLead.click()
    await expect(teamLead).toBeChecked()
    await admin.getByTestId('escalation-over-capacity').fill('125')
    await admin.getByTestId('escalation-untimed-minutes').fill('20')
    await expect(admin.getByTestId('escalation-settings-save')).toBeEnabled()
    await admin.getByTestId('escalation-settings-save').click()
    await clear(admin)

    const after = await ruleOf('blocked')
    expect(after.hours).toBe(30)
    expect(after.role_ids).toContain(traffic!.id)
    expect(after.relative).toContain('assignee_team_lead')
    const t2 = await timings()
    expect(t2.over_capacity_pct).toBe(125)
    expect(t2.untimed_threshold_minutes).toBe(20)

    // A role taken off again: the chip's remove.
    await admin.getByTestId(`escalation-role-remove-blocked-${traffic!.id}`).click()
    await expect(admin.getByTestId(`escalation-role-blocked-${traffic!.id}`)).toHaveCount(0)
    await admin.getByTestId('escalation-settings-save').click()
    await clear(admin)
    expect((await ruleOf('blocked')).role_ids).not.toContain(traffic!.id)
    await admin.context().close()
  })

  test('E9: a rule with no roles and no people says "reaches nobody" once saved', async ({ browser }) => {
    const blocked = await ruleOf('blocked')
    const extensionAm = await ruleOf('extension_am')
    const t = await timings()
    before = { blocked, extensionAm, pct: t.over_capacity_pct, minutes: t.untimed_threshold_minutes }

    const admin = await as(browser, 'admin')
    await admin.goto('/admin/organization')
    await expect(admin.getByTestId('escalation-settings-form')).toBeVisible()
    for (const id of extensionAm.role_ids) await admin.getByTestId(`escalation-role-remove-extension_am-${id}`).click()
    for (const p of extensionAm.relative) await admin.getByTestId(`escalation-person-extension_am-${p}`).click()
    await admin.getByTestId('escalation-settings-save').click()
    await clear(admin)
    const now = await ruleOf('extension_am')
    expect(now.role_ids).toEqual([])
    expect(now.relative).toEqual([])
    await admin.reload()
    await expect(admin.getByTestId('escalation-nobody-extension_am')).toContainText(/Reaches nobody — escalated to Traffic instead/)
    await admin.context().close()
  })

  test('filler words: the built-ins are shown and have no remove; the tenant’s own word is added, then removed (armed, confirmed)', async ({ browser }) => {
    const word = `covfiller${Date.now()}`
    const admin = await as(browser, 'admin')
    await admin.goto('/admin/organization')
    await expect(admin.getByTestId('filler-words-built-in')).toContainText('tbd')
    await expect(admin.getByTestId('filler-words-built-in').getByRole('button')).toHaveCount(0)
    await admin.getByTestId('filler-word-form').getByTestId('filler-word-input').fill(`  ${word.toUpperCase()} `)
    await admin.getByTestId('filler-word-add').click()
    await clear(admin)
    const [row] = await rows<{ id: string; word: string }>('tenant_filler_words', `select=id,word&word=eq.${word}`)
    expect(row?.word).toBe(word) // stored lower-case and trimmed

    // The same word again is refused in words.
    await admin.getByTestId('filler-word-input').fill(word)
    await admin.getByTestId('filler-word-add').click()
    await expect(admin.getByTestId('org-banner')).toContainText(/already on the list/i)
    await admin.getByTestId('org-banner-close').click()

    await admin.getByTestId(`filler-word-remove-${row!.id}`).click()
    await expect(admin.getByTestId(`filler-word-remove-${row!.id}`)).toHaveAttribute('data-armed', 'true')
    await admin.getByTestId(`filler-word-remove-${row!.id}`).click()
    await clear(admin)
    expect(await rows('tenant_filler_words', `select=id&id=eq.${row!.id}`)).toHaveLength(0)
    await admin.context().close()
  })

  test('may not: a department lead cannot open the page', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await lead.goto('/admin/organization')
    await expect(lead).not.toHaveURL(/\/admin\/organization$/)
    await expect(lead.getByTestId('escalation-settings-form')).toHaveCount(0)
    await lead.context().close()
  })

  test('filler at release: warned beside the field, then refused in words naming the field and its text', async ({ browser }) => {
    const am = await as(browser, 'am')
    // The warning, before any press: every field with text is checked (E10).
    await am.goto('/campaigns/new-job')
    await am.getByTestId('sj-client').selectOption({ label: 'Northwind Beverages' })
    await am.getByTestId('sj-words').fill('Three social statics for the summer range.')
    await am.getByTestId('sj-brief-card-single_execution').click()
    await am.getByTestId('sj-next').click()
    await expect(am.getByTestId('sj-brief')).toBeVisible()
    await am.getByTestId('sj-field-task').fill('TBD')
    await expect(am.getByTestId('sj-field-task-filler')).toContainText('“TBD” is placeholder text')
    await am.getByTestId('sj-field-task').fill('Design three social statics.')
    await expect(am.getByTestId('sj-field-task-filler')).toHaveCount(0)
    await am.getByTestId('sj-risk').fill('...')
    await expect(am.getByTestId('sj-risk-filler')).toBeVisible()
    await am.context().close()

    // The refusal: the database is the gate, and it names the field and the text.
    const am2 = await as(browser, 'am')
    await fillSingleJobToReview(am2, { title: `Cov filler ${Date.now()}`, department: 'Creative', task: 'XYZ 123' })
    await am2.getByTestId('sj-approve').click()
    // Earlier runs leave lookalikes: the similar-job prompt may come first — keep them separate.
    const prompt = am2.getByTestId('sj-similar-dialog')
    const error = am2.getByTestId('sj-error')
    const first = await Promise.race([
      prompt.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'prompt' as const),
      error.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'error' as const),
    ])
    if (first === 'prompt') await am2.getByTestId('sj-similar-separate').click()
    await expect(am2.getByTestId('sj-error')).toContainText(/still says 'XYZ 123' — write the real/i)
    // An answer, not a failure: nothing to report.
    await expect(am2.getByTestId('sj-error-dialog').getByRole('button', { name: /report/i })).toHaveCount(0)
    await am2.context().close()
  })
})
