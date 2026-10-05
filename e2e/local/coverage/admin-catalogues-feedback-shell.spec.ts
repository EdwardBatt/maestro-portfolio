import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows, userIdOf } from '../helpers/db'

/**
 * Coverage — Admin catalogues (workflow templates and their steps, resources, brief templates with
 * department assignment, deliverable types and attributes, the audit log), Send feedback and its
 * admin page, the shell's remaining controls and the dev "view as" panel (I49: WorkflowTemplatesPage
 * 28, ResourcesPage 17, BriefTemplatesPage 12, DeliverableTypesPage 11, AuditPage 5,
 * SendFeedbackDialog 6, FeedbackAdminPage 5, AppShell 3, DevPanel 7).
 *
 * `admin` is the "may" throughout; `lead` is not offered these pages. The brief-template
 * assignment here is also what makes the department-brief controls reachable (I49.74).
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}
async function clear(page: Page) {
  const dialog = page.locator('.notice-dialog').first()
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await expect(dialog).not.toContainText(/did not work|could not|outside your reach/i)
  await dialog.locator('[data-testid$="-close"]').first().click()
  await expect(page.locator('.notice-dialog')).toHaveCount(0)
}
async function clearIf(page: Page) {
  const dialog = page.locator('.notice-dialog').first()
  if (await dialog.isVisible({ timeout: 2_500 }).catch(() => false)) {
    await expect(dialog).not.toContainText(/did not work|could not|outside your reach/i)
    await dialog.locator('[data-testid$="-close"]').first().click()
  }
  await expect(page.locator('.notice-dialog')).toHaveCount(0)
}
/** The dev "View as" button floats over the bottom of long admin pages and takes the click meant
 *  for a Create button beneath it (I49.80). Out of the way for these tests. */
const hideDevFab = (page: Page) => page.addStyleTag({ content: '.dev-panel{display:none!important}' })
const stamp = Date.now()
const code = `COV${String(stamp).slice(-6)}`

test.describe('Coverage — admin catalogues, feedback, shell', () => {
  test('Workflow templates: a new template, rename (cancel, save), toggle; a step with every field, edit (cancel, save), reorder, toggle, remove', async ({ browser }) => {
    const admin = await as(browser, 'admin')
    await admin.goto('/admin/workflow-templates')
    await expect(admin.getByTestId('surface-workflow-templates')).toBeVisible()
    await hideDevFab(admin)
    await admin.getByTestId('workflow-add-form').getByTestId('workflow-new-code').fill(code)
    await admin.getByTestId('workflow-new-name-en').fill(`Cov workflow ${stamp}`)
    await admin.getByTestId('workflow-new-name-ar').fill('سير عمل')
    await admin.getByTestId('workflow-new-submit').click()
    await clearIf(admin)
    await expect.poll(async () => (await rows<{ id: string }>('workflow_templates', `select=id&code=eq.${code}`)).length).toBe(1)
    const [wf] = await rows<{ id: string; is_active: boolean }>('workflow_templates', `select=id,is_active&code=eq.${code}`)

    // Rename: cancel keeps the name; save changes it.
    await admin.getByTestId(`workflow-rename-${code}`).click()
    await admin.getByTestId('workflow-edit-name-en').fill('Not saved')
    await admin.getByTestId('workflow-edit-cancel').click()
    expect((await rows<{ name_en: string }>('workflow_templates', `select=name_en&id=eq.${wf.id}`))[0].name_en).toBe(`Cov workflow ${stamp}`)
    await admin.getByTestId(`workflow-rename-${code}`).click()
    await admin.getByTestId('workflow-edit-name-en').fill(`Cov workflow ${stamp} edited`)
    await admin.getByTestId('workflow-edit-name-ar').fill('سير عمل معدل')
    await admin.getByTestId('workflow-edit-save').click()
    await clearIf(admin)
    await expect.poll(async () => (await rows<{ name_en: string }>('workflow_templates', `select=name_en&id=eq.${wf.id}`))[0].name_en).toBe(`Cov workflow ${stamp} edited`)

    // Open it; two steps with every field; edit the first (cancel, then save); reorder; toggle; remove.
    await admin.getByTestId(`workflow-open-${code}`).click()
    await expect(admin.getByTestId('workflow-no-steps')).toBeVisible()
    for (const [en, ar, hours, mode] of [['Shoot', 'تصوير', '8', 'manual'], ['Edit', 'مونتاج', '4', 'digital']] as const) {
      await admin.getByTestId('workflow-step-new-en').fill(en)
      await admin.getByTestId('workflow-step-new-ar').fill(ar)
      await admin.getByTestId('workflow-step-new-hours').fill(hours)
      await admin.getByTestId('workflow-step-new-review-mode').selectOption(mode)
      await admin.getByTestId('workflow-step-new-submit').click()
      await clearIf(admin)
    }
    const steps = () => rows<{ id: string; title_en: string; sort_order: number; default_hours: number | null; review_mode: string; is_active: boolean }>('workflow_steps', `select=id,title_en,sort_order,default_hours,review_mode,is_active&template_id=eq.${wf.id}&order=sort_order.asc`)
    await expect.poll(async () => (await steps()).length).toBe(2)
    let [shoot, edit] = await steps()
    expect(shoot.default_hours).toBe(8)
    expect(shoot.review_mode).toBe('manual')
    expect(edit.review_mode).toBe('digital')

    await admin.getByTestId(`workflow-step-edit-${shoot.id}`).click()
    await admin.getByTestId('workflow-step-edit-en').fill('Not saved')
    await admin.getByTestId('workflow-step-cancel').click()
    expect((await steps())[0].title_en).toBe('Shoot')
    await admin.getByTestId(`workflow-step-edit-${shoot.id}`).click()
    await admin.getByTestId('workflow-step-edit-en').fill('Shoot day')
    await admin.getByTestId('workflow-step-edit-ar').fill('يوم التصوير')
    await admin.getByTestId('workflow-step-edit-hours').fill('10')
    await admin.getByTestId('workflow-step-edit-review-mode').selectOption('digital')
    await admin.getByTestId('workflow-step-save').click()
    await clearIf(admin)
    await expect.poll(async () => (await steps())[0].title_en).toBe('Shoot day')
    ;[shoot] = await steps()
    expect(shoot.default_hours).toBe(10)
    expect(shoot.review_mode).toBe('digital')

    await admin.getByTestId(`workflow-step-down-${shoot.id}`).click()
    await clearIf(admin)
    await expect.poll(async () => (await steps())[0].id).toBe(edit.id)
    await admin.getByTestId(`workflow-step-up-${shoot.id}`).click()
    await clearIf(admin)
    await expect.poll(async () => (await steps())[0].id).toBe(shoot.id)

    await admin.getByTestId(`workflow-step-toggle-${edit.id}`).click()
    await clearIf(admin)
    await expect.poll(async () => (await steps()).find((s) => s.id === edit.id)!.is_active).toBe(false)
    admin.once('dialog', (d) => void d.accept()) // the browser asks by name
    await admin.getByTestId(`workflow-step-remove-${edit.id}`).click()
    await clearIf(admin)
    await expect.poll(async () => (await steps()).length).toBe(1)

    // The template's own toggle.
    await admin.getByTestId(`workflow-toggle-${code}`).click()
    await clearIf(admin)
    await expect.poll(async () => (await rows<{ is_active: boolean }>('workflow_templates', `select=is_active&id=eq.${wf.id}`))[0].is_active).toBe(!wf.is_active)
    await admin.context().close()
  })

  test('Resources: a new equipment resource with every field (cancel, then create), edit with the rates, a human linked and unlinked, toggle', async ({ browser }) => {
    const admin = await as(browser, 'admin')
    await admin.goto('/admin/resources')
    await expect(admin.getByTestId('surface-resources')).toBeVisible()
    await hideDevFab(admin)

    await admin.getByTestId('resource-new').click()
    const dialog = admin.getByTestId('resource-dialog')
    await expect(dialog).toBeVisible()
    await admin.getByTestId('resource-name').fill('Not saved')
    await admin.getByTestId('resource-cancel').click()
    await expect(dialog).toHaveCount(0)

    await admin.getByTestId('resource-new').click()
    await admin.getByTestId('resource-kind').selectOption('equipment')
    await admin.getByTestId('resource-name').fill(`Cov camera ${stamp}`)
    const nick = await admin.getByTestId('resource-nickname').inputValue()
    await admin.getByTestId('resource-nickname-reroll').click()
    await expect(admin.getByTestId('resource-nickname')).not.toHaveValue(nick)
    await admin.getByTestId('resource-nickname').fill(`cam${String(stamp).slice(-4)}`)
    // Ceiling and warn-at belong to the load-based model; the pool size to the pooled one.
    await admin.getByTestId('resource-capacity').selectOption('load_based')
    await admin.getByTestId('resource-ceiling').fill('110')
    await admin.getByTestId('resource-warn').fill('90')
    await admin.getByTestId('resource-capacity').selectOption('pooled')
    await admin.getByTestId('resource-pool').fill('3')
    await admin.getByTestId('resource-approval').check()
    const [creative] = await rows<{ id: string }>('departments', `select=id&name=eq.Creative`)
    await admin.getByTestId('resource-department').selectOption(creative.id)
    const [design] = await rows<{ id: string }>('teams', `select=id&name=eq.Design`)
    await admin.getByTestId('resource-team').selectOption(design.id)
    const [baghdad] = await rows<{ id: string }>('offices', `select=id&name=eq.Baghdad`)
    await admin.getByTestId('resource-office').selectOption(baghdad.id)
    await admin.getByTestId('resource-cost').fill('25')
    await admin.getByTestId('resource-charge').fill('60')
    await admin.getByTestId('resource-currency').fill('USD')
    await admin.getByTestId('resource-submit').click()
    await expect(dialog).toHaveCount(0)
    await clearIf(admin)
    await expect.poll(async () => (await rows<{ id: string }>('resources', `select=id&name=eq.${encodeURIComponent(`Cov camera ${stamp}`)}`)).length).toBe(1)
    const [r] = await rows<{ id: string; kind: string; capacity_model: string; pool_size: number | null; load_ceiling_pct: number; warn_at_pct: number; requires_approval: boolean; department_id: string; team_id: string; office_id: string; is_active: boolean }>('resources', `select=id,kind,capacity_model,pool_size,load_ceiling_pct,warn_at_pct,requires_approval,department_id,team_id,office_id,is_active&name=eq.${encodeURIComponent(`Cov camera ${stamp}`)}`)
    expect(r.kind).toBe('equipment')
    expect(r.capacity_model).toBe('pooled')
    expect(r.pool_size).toBe(3)
    expect(r.requires_approval).toBe(true)
    expect(r.department_id).toBe(creative.id)
    expect(r.team_id).toBe(design.id)
    expect(r.office_id).toBe(baghdad.id)
    const [rate] = await rows<{ cost_rate: number; charge_rate: number; currency: string }>('resources', `select=cost_rate,charge_rate,currency&id=eq.${r.id}`)
    expect(Number(rate.cost_rate)).toBe(25)
    expect(Number(rate.charge_rate)).toBe(60)
    expect(rate.currency).toBe('USD')

    // Edit: reopened filled; a change lands.
    await admin.getByTestId(`resource-edit-${r.id}`).click()
    await expect(admin.getByTestId('resource-name')).toHaveValue(`Cov camera ${stamp}`)
    await admin.getByTestId('resource-capacity').selectOption('load_based')
    await admin.getByTestId('resource-ceiling').fill('120')
    await admin.getByTestId('resource-warn').fill('95')
    await admin.getByTestId('resource-submit').click()
    await expect(dialog).toHaveCount(0)
    await clear(admin)
    await expect.poll(async () => Number((await rows<{ load_ceiling_pct: number }>('resources', `select=load_ceiling_pct&id=eq.${r.id}`))[0].load_ceiling_pct)).toBe(120)
    expect(Number((await rows<{ warn_at_pct: number }>('resources', `select=warn_at_pct&id=eq.${r.id}`))[0].warn_at_pct)).toBe(95)

    // Toggle active: the first click arms the button ("Confirm…"), the second does it.
    await admin.getByTestId(`resource-toggle-${r.id}`).click()
    await expect(admin.getByTestId(`resource-toggle-${r.id}`)).toContainText(/confirm/i)
    await admin.getByTestId(`resource-toggle-${r.id}`).click()
    await clear(admin)
    await expect.poll(async () => (await rows<{ is_active: boolean }>('resources', `select=is_active&id=eq.${r.id}`))[0].is_active).toBe(false)

    // A human resource: the planner's row, unlinked from its login and linked back. A prior run
    // that stopped half-way leaves it unlinked, so the row is found by name and the order adapts.
    const plannerId = await userIdOf(PEOPLE.planner.email)
    const [planner] = await rows<{ id: string; user_id: string | null }>('resources', `select=id,user_id&name=eq.${encodeURIComponent('Dev Planner')}`)
    const link = async () => {
      await admin.getByTestId(`resource-edit-${planner.id}`).click()
      await admin.getByTestId('resource-link-select').selectOption(plannerId) // saves on change
      await expect(dialog).toHaveCount(0)
      await clear(admin)
      await expect.poll(async () => (await rows<{ user_id: string | null }>('resources', `select=user_id&id=eq.${planner.id}`))[0].user_id).toBe(plannerId)
    }
    if (!planner.user_id) await link()
    await admin.getByTestId(`resource-edit-${planner.id}`).click()
    await expect(admin.getByTestId('resource-link')).toBeVisible()
    await admin.getByTestId('resource-unlink').click() // saves on its own and closes the dialog
    await expect(dialog).toHaveCount(0)
    await clear(admin)
    await expect.poll(async () => (await rows<{ user_id: string | null }>('resources', `select=user_id&id=eq.${planner.id}`))[0].user_id).toBeNull()
    await link()
    await admin.context().close()
  })

  test('Brief templates: a new template, edit its fields (add / relabel / remove / cancel / save), a second one started from it, assign to a department and make it the default', async ({ browser }) => {
    const admin = await as(browser, 'admin')
    await admin.goto('/admin/brief-templates')
    await expect(admin.getByTestId('brief-templates')).toBeVisible()
    const briefType = `cov_${String(stamp).slice(-6)}`
    await hideDevFab(admin)
    await admin.getByTestId('brief-template-new-name').fill(briefType)
    // I54.3 — both languages, always (Edward, 23 Sep). A template created with an English name
    // only showed that name to an Arabic reader for ever: nothing could set the other half.
    await admin.getByTestId('brief-template-new-name-ar').fill('قالب التغطية')
    await admin.getByTestId('brief-template-new-submit').click()
    await clearIf(admin)
    await expect.poll(async () => (await rows<{ id: string }>('brief_templates', `select=id&brief_type=eq.${briefType}`)).length).toBe(1)
    const [tpl] = await rows<{ id: string; fields: { key: string }[]; name_ar: string | null }>('brief_templates', `select=id,fields,name_ar&brief_type=eq.${briefType}`)
    expect(tpl.fields).toEqual([])
    expect(tpl.name_ar).toBe('قالب التغطية')

    // It arrives empty and says so; two fields added in the editor (I49.81 A): the key is made
    // from the English label and shown first, a duplicate is refused in words, Save stores both.
    await admin.getByTestId(`brief-template-edit-${briefType}`).click()
    await expect(admin.getByTestId('brief-template-editor')).toBeVisible()
    await expect(admin.getByTestId('brief-template-editor-empty')).toBeVisible()
    await expect(admin.getByTestId('brief-template-field-add')).toBeDisabled()
    await admin.getByTestId('brief-template-field-new-en').fill('Goal')
    await expect(admin.getByTestId('brief-template-field-new-key')).toHaveText('goal')
    await admin.getByTestId('brief-template-field-new-ar').fill('الغاية')
    await admin.getByTestId('brief-template-field-new-guidance').fill('What success looks like.')
    await admin.getByTestId('brief-template-field-add').click()
    await expect(admin.getByTestId('brief-template-field-en-goal')).toHaveValue('Goal')
    await expect(admin.getByTestId('brief-template-editor-empty')).toHaveCount(0)
    await admin.getByTestId('brief-template-field-new-en').fill('Goal')
    await admin.getByTestId('brief-template-field-add').click()
    await expect(admin.getByTestId('brief-template-field-add-error')).toContainText('goal')
    await admin.getByTestId('brief-template-field-new-en').fill('Audience')
    await admin.getByTestId('brief-template-field-new-ar').fill('الجمهور')
    await admin.getByTestId('brief-template-field-add').click()
    await expect(admin.getByTestId('brief-template-field-en-audience')).toBeVisible()
    await admin.getByTestId('brief-template-save').click()
    await clearIf(admin)
    await expect.poll(async () => ((await rows<{ fields: { key: string }[] }>('brief_templates', `select=fields&id=eq.${tpl.id}`))[0].fields).map((f) => f.key)).toEqual(['goal', 'audience'])
    await expect(admin.getByTestId(`brief-template-empty-${briefType}`)).toHaveCount(0)

    // Edit its fields: the first field's labels and guidance; remove the last; cancel, then save.
    await admin.getByTestId(`brief-template-edit-${briefType}`).click()
    await expect(admin.getByTestId('brief-template-editor')).toBeVisible()
    const firstKey = (await admin.locator('[data-testid^="brief-template-field-en-"]').first().getAttribute('data-testid'))!.replace('brief-template-field-en-', '')
    await admin.getByTestId(`brief-template-field-en-${firstKey}`).fill('Objective')
    await admin.getByTestId(`brief-template-field-ar-${firstKey}`).fill('الهدف')
    await admin.getByTestId(`brief-template-field-guidance-${firstKey}`).fill('One line on what success looks like.')
    await admin.getByTestId('brief-template-cancel').click()
    const unchanged = (await rows<{ fields: { key: string; labelEn?: string; label_en?: string }[] }>('brief_templates', `select=fields&id=eq.${tpl.id}`))[0].fields
    expect(JSON.stringify(unchanged)).not.toContain('Objective')
    await admin.getByTestId(`brief-template-edit-${briefType}`).click()
    await admin.getByTestId(`brief-template-field-en-${firstKey}`).fill('Objective')
    await admin.getByTestId(`brief-template-field-ar-${firstKey}`).fill('الهدف')
    await admin.getByTestId(`brief-template-field-guidance-${firstKey}`).fill('One line on what success looks like.')
    // SJ-v3-02: the tick that puts a field among "1 · The essentials" on the brief page.
    await admin.getByTestId(`brief-template-field-essential-${firstKey}`).check()
    const removeButtons = admin.locator('[data-testid^="brief-template-field-remove-"]')
    if ((await removeButtons.count()) > 1) {
      const lastKey = (await removeButtons.last().getAttribute('data-testid'))!.replace('brief-template-field-remove-', '')
      await admin.getByTestId(`brief-template-field-remove-${lastKey}`).click()
    }
    // I54.3 — rename it and describe it, in both languages, in the same save. The description is
    // the line the card shows on the first screen of the single-job flow, and until 23 Sep there
    // was no way to set it at all.
    await admin.getByTestId('brief-template-name-en').fill('Coverage Brief')
    await admin.getByTestId('brief-template-name-ar').fill('بريف التغطية')
    await admin.getByTestId('brief-template-description-en').fill('What this brief is for, in one line.')
    await admin.getByTestId('brief-template-description-ar').fill('ما هذا البريف، في سطر واحد.')
    await admin.getByTestId('brief-template-save').click()
    await clearIf(admin)
    await expect.poll(async () => JSON.stringify((await rows<{ fields: unknown }>('brief_templates', `select=fields&id=eq.${tpl.id}`))[0].fields)).toContain('Objective')
    const after = (await rows<{ fields: { key: string; essential?: boolean }[] }>('brief_templates', `select=fields&id=eq.${tpl.id}`))[0].fields
    expect(after.map((f) => f.key)).toEqual(['goal']) // relabelled, not re-keyed
    expect(after[0].essential).toBe(true)
    // Renamed in both languages, described in both — and the KEY did not move, which is what makes
    // renaming safe to offer on every template, the seeded twelve included.
    const named = (await rows<{ brief_type: string; name_en: string; name_ar: string | null; description_en: string | null; description_ar: string | null }>(
      'brief_templates', `select=brief_type,name_en,name_ar,description_en,description_ar&id=eq.${tpl.id}`))[0]
    expect(named.brief_type).toBe(briefType)
    expect(named.name_en).toBe('Coverage Brief')
    expect(named.name_ar).toBe('بريف التغطية')
    expect(named.description_en).toBe('What this brief is for, in one line.')
    expect(named.description_ar).toBe('ما هذا البريف، في سطر واحد.')

    // Assign to Creative and Content and make it their default (I49.74's fixture). A department
    // with one brief writes it unasked, so "make default" is only offered once it has two: a
    // second template of this test's own gives Creative the choice whatever the database held.
    const other = `${briefType}_b`
    await admin.getByTestId('brief-template-new-name').fill(other)
    // Started from the first template (I49.81 B): it arrives with that one's fields.
    await admin.getByTestId('brief-template-new-copy').selectOption(tpl.id)
    await admin.getByTestId('brief-template-new-submit').click()
    await clearIf(admin)
    await expect.poll(async () => (await rows<{ id: string }>('brief_templates', `select=id&brief_type=eq.${other}`)).length).toBe(1)
    expect(((await rows<{ fields: { key: string }[] }>('brief_templates', `select=fields&brief_type=eq.${other}`))[0].fields).map((f) => f.key)).toEqual(['goal'])
    const [creative] = await rows<{ id: string }>('departments', `select=id&name=eq.Creative`)
    const [content] = await rows<{ id: string }>('departments', `select=id&name=eq.Content`)
    const assigned = (d: string, t: string) => rows<{ is_default: boolean }>('department_brief_templates', `select=is_default&department_id=eq.${d}&brief_template_id=eq.${t}`)
    await admin.getByTestId(`brief-template-assign-open-${other}`).click()
    // A controlled box: it ticks once the server has answered, so click rather than check.
    await admin.getByTestId(`brief-template-assign-${other}-${creative.id}`).click()
    await expect.poll(async () => (await assigned(creative.id, (await rows<{ id: string }>('brief_templates', `select=id&brief_type=eq.${other}`))[0].id)).length).toBe(1)
    await admin.getByTestId(`brief-template-assign-open-${briefType}`).click()
    for (const d of [creative, content]) {
      await admin.getByTestId(`brief-template-assign-${briefType}-${d.id}`).click()
      await expect.poll(async () => (await assigned(d.id, tpl.id)).length).toBe(1)
    }
    // Creative now has two, so the choice is offered; the click makes this one the default.
    await admin.getByTestId(`brief-template-default-${briefType}-${creative.id}`).click()
    await clearIf(admin)
    await expect.poll(async () => (await assigned(creative.id, tpl.id))[0]?.is_default).toBe(true)
    await expect(admin.getByTestId(`brief-template-is-default-${briefType}-${creative.id}`)).toBeVisible()
    // Content may or may not have others (earlier runs leave templates behind): where it does,
    // the same control is offered and works there too.
    const contentDefault = admin.getByTestId(`brief-template-default-${briefType}-${content.id}`)
    if (await contentDefault.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await contentDefault.click()
      await clearIf(admin)
      await expect.poll(async () => (await assigned(content.id, tpl.id))[0]?.is_default).toBe(true)
    }
    await admin.context().close()
  })

  test('Deliverable types: search and the category filter, edit a type (cancel, save), its workflow, toggle; an attribute value toggled', async ({ browser }) => {
    const admin = await as(browser, 'admin')
    await admin.goto('/admin/deliverable-types')
    await expect(admin.getByTestId('deliverable-types-table')).toBeVisible()
    await hideDevFab(admin)
    await admin.getByTestId('add-type-form').getByTestId('add-type-code').fill(code)
    await admin.getByTestId('add-type-name-en').fill(`Cov type ${stamp}`)
    await admin.getByTestId('add-type-name-ar').fill('نوع')
    const cat = admin.getByTestId('add-type-category')
    const cats = await cat.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean))
    await cat.selectOption(cats[0])
    await admin.getByTestId('add-type-submit').click()
    await clearIf(admin)
    await expect.poll(async () => (await rows<{ id: string }>('deliverable_types', `select=id&code=eq.${code}`)).length).toBe(1)

    await admin.getByTestId('type-search').fill(`Cov type ${stamp}`)
    await expect(admin.getByTestId(`deliverable-type-${code}`)).toBeVisible()
    await expect(admin.getByTestId('type-count')).toContainText('1')
    await admin.getByTestId('type-filter-category').selectOption(cats[cats.length - 1])
    if (cats.length > 1) await expect(admin.getByTestId(`deliverable-type-${code}`)).toHaveCount(0)
    await admin.getByTestId('type-filter-category').selectOption('')
    await admin.getByTestId('type-search').fill('')
    await admin.getByTestId('type-search').fill(code)

    await admin.getByTestId(`type-edit-${code}`).click()
    await admin.getByTestId('type-edit-name-en').fill('Not saved')
    await admin.getByTestId('type-edit-cancel').click()
    expect((await rows<{ name_en: string }>('deliverable_types', `select=name_en&code=eq.${code}`))[0].name_en).toBe(`Cov type ${stamp}`)
    await admin.getByTestId(`type-edit-${code}`).click()
    await admin.getByTestId('type-edit-name-en').fill(`Cov type ${stamp} edited`)
    await admin.getByTestId('type-edit-name-ar').fill('نوع معدل')
    await admin.getByTestId('type-edit-save').click()
    await clearIf(admin)
    await expect.poll(async () => (await rows<{ name_en: string }>('deliverable_types', `select=name_en&code=eq.${code}`))[0].name_en).toBe(`Cov type ${stamp} edited`)

    const wfSel = admin.getByTestId(`type-workflow-${code}`)
    const wfs = await wfSel.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean))
    await wfSel.selectOption(wfs[0])
    await clearIf(admin)
    await expect.poll(async () => (await rows<{ default_workflow_template_id: string | null }>('deliverable_types', `select=default_workflow_template_id&code=eq.${code}`))[0].default_workflow_template_id).toBe(wfs[0])
    await admin.getByTestId(`type-toggle-${code}`).click()
    await clearIf(admin)
    await expect.poll(async () => (await rows<{ is_active: boolean }>('deliverable_types', `select=is_active&code=eq.${code}`))[0].is_active).toBe(false)

    // Attributes: pick one, toggle its first value off and on.
    const picker = admin.getByTestId('attribute-picker')
    const attrs = await picker.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean))
    await picker.selectOption(attrs[0])
    await expect(admin.getByTestId('attribute-values-table')).toBeVisible()
    const toggle = admin.locator('[data-testid^="attribute-toggle-"]').first()
    const vcode = (await toggle.getAttribute('data-testid'))!.replace('attribute-toggle-', '')
    const before = (await rows<{ is_active: boolean }>('deliverable_attribute_values', `select=is_active&code=eq.${vcode}&attribute=eq.${attrs[0]}`))[0].is_active
    await admin.getByTestId(`attribute-toggle-${vcode}`).click()
    await clearIf(admin)
    await expect.poll(async () => (await rows<{ is_active: boolean }>('deliverable_attribute_values', `select=is_active&code=eq.${vcode}&attribute=eq.${attrs[0]}`))[0].is_active).toBe(!before)
    await admin.getByTestId(`attribute-toggle-${vcode}`).click()
    await clearIf(admin)
    await expect.poll(async () => (await rows<{ is_active: boolean }>('deliverable_attribute_values', `select=is_active&code=eq.${vcode}&attribute=eq.${attrs[0]}`))[0].is_active).toBe(before)
    await admin.context().close()
  })

  test('Audit: the entity filter, the date range, Clear, More', async ({ browser }) => {
    const admin = await as(browser, 'admin')
    await admin.goto('/admin/audit')
    await expect(admin.getByTestId('audit-table')).toBeVisible()
    const all = (await admin.getByTestId('audit-count').textContent()) ?? ''
    const ent = admin.getByTestId('audit-entity-filter')
    // Each option carries its own event count — "Booking (12)" — which is what makes it possible to
    // choose one that is guaranteed to NARROW the list. The first option does not: filtering to it
    // changes nothing whenever every audit row happens to be of that one kind, which is exactly
    // the state a freshly seeded database is in. This test failed that way on 23 Sep (I54.24) and
    // the fault was the assumption, not the screen.
    const options = await ent.locator('option').evaluateAll((os) =>
      os
        .map((o) => ({
          value: (o as HTMLOptionElement).value,
          count: Number(/\((\d+)\)\s*$/.exec(o.textContent ?? '')?.[1] ?? '0'),
        }))
        .filter((o) => o.value),
    )
    const total = Number(/\d+/.exec(all)?.[0] ?? '0')
    const narrowing = options.find((o) => o.count > 0 && o.count < total)
    if (narrowing) {
      await ent.selectOption(narrowing.value)
      await expect(admin.getByTestId('audit-count')).not.toHaveText(all)
    } else if (options.length) {
      // Only one kind of thing has been audited, so nothing can narrow. The filter is still
      // exercised — it must apply and must not empty the table — rather than skipped silently.
      await ent.selectOption(options[0].value)
      await expect(ent).toHaveValue(options[0].value)
      await expect(admin.locator('[data-testid="audit-table"] tbody tr').first()).toBeVisible()
    }
    const today = new Date().toISOString().slice(0, 10)
    await admin.getByTestId('audit-from').fill(today)
    await admin.getByTestId('audit-to').fill(today)
    await admin.getByTestId('audit-clear').click()
    await expect(ent).toHaveValue('')
    await expect(admin.getByTestId('audit-from')).toHaveValue('')
    // More is always there to press: provisioning a tenant alone writes a couple of thousand audit
    // rows (the roles, grants and catalogues `seed_tenant_roles` creates), so every tenant — a
    // freshly reset one included — holds more than one page. Checked first, so a failure below is
    // the screen's and not the data's.
    const firstTwoPages = await rows<{ id: string }>('audit_events', 'select=id&tenant_id=eq.d0000000-0000-4000-8000-000000000001&limit=401')
    expect(firstTwoPages.length, 'the log holds more than one page (200) of events').toBeGreaterThan(200)
    const more = admin.getByTestId('audit-more')
    await expect(more).toBeVisible()
    const rowsBefore = await admin.locator('[data-testid="audit-table"] tbody tr').count()
    expect(rowsBefore).toBe(200)
    await more.click()
    // The next page, in full. A provisioning run stamps its thousands of rows with ONE instant, and
    // a cursor on the time alone skipped them all — More loaded nothing (I59.38).
    await expect
      .poll(async () => admin.locator('[data-testid="audit-table"] tbody tr').count())
      .toBe(Math.min(400, firstTwoPages.length))
    await admin.context().close()
  })

  test('Send feedback from the shell (cancel, then send); the admin resolves it (cancel, confirm) and reopens it; Dashboard nav; the dev "view as" panel', async ({ browser }) => {
    const admin = await as(browser, 'admin')
    await admin.goto('/my-work')
    await admin.getByTestId('feedback-open').click()
    const dlg = admin.getByTestId('feedback-dialog')
    await expect(dlg).toBeVisible()
    await admin.getByTestId('feedback-message').fill('Not sent')
    await admin.getByTestId('feedback-cancel').click()
    await expect(dlg).toHaveCount(0)
    await admin.getByTestId('feedback-open').click()
    await admin.getByTestId('feedback-category').selectOption('idea')
    await admin.getByTestId('feedback-message').fill(`Cov feedback ${stamp}`)
    await admin.getByTestId('feedback-submit').click()
    await expect(admin.getByTestId('feedback-sent')).toBeVisible()
    await admin.getByTestId('feedback-close').click()
    await expect(dlg).toHaveCount(0)
    await expect.poll(async () => (await rows<{ id: string; category: string }>('app_feedback', `select=id,category&message=eq.${encodeURIComponent(`Cov feedback ${stamp}`)}`)).length).toBe(1)
    const [fb] = await rows<{ id: string; category: string }>('app_feedback', `select=id,category&message=eq.${encodeURIComponent(`Cov feedback ${stamp}`)}`)
    expect(fb.category).toBe('idea')

    await admin.goto('/admin/feedback')
    await expect(admin.getByTestId(`feedback-row-${fb.id}`)).toBeVisible()
    await admin.getByTestId(`feedback-resolve-${fb.id}`).click()
    await admin.getByTestId(`feedback-note-${fb.id}`).fill('Not resolved yet')
    await admin.getByTestId(`feedback-cancel-${fb.id}`).click()
    expect((await rows<{ status: string }>('app_feedback', `select=status&id=eq.${fb.id}`))[0].status).not.toBe('resolved')
    await admin.getByTestId(`feedback-resolve-${fb.id}`).click()
    await admin.getByTestId(`feedback-note-${fb.id}`).fill('Done in the coverage run.')
    await admin.getByTestId(`feedback-confirm-${fb.id}`).click()
    await clearIf(admin)
    await expect.poll(async () => (await rows<{ status: string; resolution_note: string | null }>('app_feedback', `select=status,resolution_note&id=eq.${fb.id}`))[0].status).toBe('resolved')
    await admin.getByTestId(`feedback-reopen-${fb.id}`).click()
    await clearIf(admin)
    await expect.poll(async () => (await rows<{ status: string }>('app_feedback', `select=status&id=eq.${fb.id}`))[0].status).not.toBe('resolved')

    // The shell: Dashboard in the nav; the dev "view as" panel (real Power Admin only) — pick a
    // role, apply, the preview banner, exit.
    await admin.getByTestId('nav-dashboard').click()
    await expect(admin).toHaveURL(/\/admin$|\/dashboard/)
    await admin.getByTestId('dev-fab').click()
    await expect(admin.getByTestId('dev-panel')).toBeVisible()
    const roleSel = admin.getByTestId('dev-role')
    const roleOptions = await roleSel.locator('option').evaluateAll((os) => os.map((o) => ({ v: (o as HTMLOptionElement).value, t: o.textContent ?? '' })))
    await roleSel.selectOption(roleOptions.find((o) => /Team Member/.test(o.t))!.v)
    const deptSel = admin.getByTestId('dev-department')
    const depts = await deptSel.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean))
    if (depts.length) await deptSel.selectOption(depts[0])
    const teamSel = admin.getByTestId('dev-team')
    const teams = await teamSel.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean))
    if (teams.length) await teamSel.selectOption(teams[0])
    await admin.getByTestId('dev-apply').click()
    await expect(admin.getByTestId('preview-banner')).toBeVisible()
    await admin.getByTestId('preview-banner-exit').click()
    await expect(admin.getByTestId('preview-banner')).toHaveCount(0)
    // Apply again; this time leave through the panel's own Exit.
    await admin.getByTestId('dev-fab').click()
    await admin.getByTestId('dev-role').selectOption(roleOptions.find((o) => /Team Member/.test(o.t))!.v)
    await admin.getByTestId('dev-apply').click()
    await expect(admin.getByTestId('preview-banner')).toBeVisible()
    await admin.getByTestId('dev-fab').click()
    await admin.getByTestId('dev-exit').click()
    await expect(admin.getByTestId('preview-banner')).toHaveCount(0)
    await admin.getByTestId('dev-fab').click()
    await admin.getByTestId('dev-close').click()
    await expect(admin.getByTestId('dev-fab')).toBeVisible() // closed: the button is back
    await admin.context().close()
  })

  test('may NOT: a department lead is not offered the catalogues', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    for (const path of ['/admin/workflow-templates', '/admin/resources', '/admin/brief-templates', '/admin/deliverable-types', '/admin/feedback']) {
      await lead.goto(path)
      await expect(lead).not.toHaveURL(new RegExp(`${path}$`))
    }
    await expect(lead.getByTestId('dev-fab')).toHaveCount(0)
    await lead.context().close()
  })
})
