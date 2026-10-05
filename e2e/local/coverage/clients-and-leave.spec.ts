import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE, OFFICES } from '../fixtures'
import { rows, userIdOf } from '../helpers/db'

/**
 * Coverage — Clients (the register form with every field, edit, delete; brands add / rename /
 * delete) and People → Leave (an entry with every field, edit, delete; a closure edited, the
 * dialog cancelled) (I49: ClientForm 23, ClientsPage 10, LeaveDialog 6, LeavePage 3,
 * ClosureDialog 1).
 *
 * `traffic` (clients:manage since 13 Sep) is the "may" for clients; `admin` for leave
 * (leave:manage). `maker` is offered neither.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}
function sundayOut(weeksOut: number): string {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + 7 * weeksOut + ((7 - d.getUTCDay()) % 7))
  return d.toISOString().slice(0, 10)
}
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
/** Every write on these pages answers with a "Done" dialog (ADR-0092 d.2): wait for it, read it as
 *  a success, close it — so the next press is not swallowed by its backdrop. */
async function clear(page: Page) {
  const dialog = page.locator('.notice-dialog').first()
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await expect(dialog).not.toContainText(/did not work|could not|outside your reach/i)
  await dialog.locator('[data-testid$="-close"]').first().click()
  await expect(page.locator('.notice-dialog')).toHaveCount(0)
}

test.describe('Coverage — clients and leave', () => {
  // I62 (ADR-0123): the one-page client form this walked is replaced by the six-step registration (Figma J).
  // Its browser test is owed with the rest of I62's — automated tests on hold (Edward, 27 Sep).
  test.skip('register a client with every field (e-commerce fields included), cancel a second, edit it, add / rename / delete a brand, delete the client', async ({ browser }) => {
    const name = `Cov client ${Date.now()}`
    const traffic = await as(browser, 'traffic')
    await traffic.goto('/clients')
    await traffic.getByTestId('client-register').click()
    const form = traffic.getByTestId('client-form')
    await expect(form).toBeVisible()
    await traffic.getByTestId('client-form-name').fill(name)
    await traffic.getByTestId('client-form-am').selectOption(await userIdOf(PEOPLE.am2.email))
    await traffic.getByTestId('client-form-odoo').fill('ODOO-42')
    // Business types: e-commerce opens the shop section, app the app section; retail stays ticked too.
    await traffic.getByTestId('client-form-type-ecommerce').check()
    await traffic.getByTestId('client-form-type-app').check()
    await traffic.getByTestId('client-form-type-retail').check()
    await traffic.getByTestId('client-form-whatTheySell').fill('Cold drinks')
    await traffic.getByTestId('client-form-usp').fill('Coldest in town')
    await traffic.getByTestId('client-form-digitalPresence').fill('Instagram, TikTok')
    await traffic.getByTestId('client-form-salesProcess').fill('Order online, deliver same day')
    await traffic.getByTestId('client-form-bestSellers').fill('Lemon, cola')
    await traffic.getByTestId('client-form-pastLessons').fill('Summer sells; winter does not')
    await traffic.getByTestId('client-form-economics').fill('Thin margins')
    await traffic.getByTestId('client-form-seasonality').fill('Peaks in July')
    await traffic.getByTestId('client-form-primaryAction').fill('Buy now')
    await traffic.getByTestId('client-form-productCount').fill('120')
    await traffic.getByTestId('client-form-avgOrderValue').fill('35')
    await traffic.getByTestId('client-form-returnsRate').fill('2')
    await traffic.getByTestId('client-form-dailyCapacity').fill('400')
    await traffic.getByTestId('client-form-userCounts').fill('12k monthly')
    await traffic.getByTestId('client-form-catalogConnection').fill('Shopify feed')
    await traffic.getByTestId('client-form-accessContact').fill('Ali, ops')
    // Dos and don'ts (SJ-v3): two rules, one flipped to DON'T, a third added then removed.
    await traffic.getByTestId('client-form-rule-add').click()
    await traffic.getByTestId('client-form-rule-text-0').fill('Arabic leads. English is never the master.')
    await traffic.getByTestId('client-form-rule-do-0').click()
    await traffic.getByTestId('client-form-rule-add').click()
    await traffic.getByTestId('client-form-rule-text-1').fill('Never "lottery".')
    await traffic.getByTestId('client-form-rule-dont-1').click()
    await traffic.getByTestId('client-form-rule-add').click()
    await traffic.getByTestId('client-form-rule-remove-2').click()
    await expect(traffic.getByTestId('client-form-rule-text-2')).toHaveCount(0)
    await traffic.getByTestId('client-form-submit').click()
    await expect(form).toHaveCount(0)
    await clear(traffic)
    const [c] = await rows<{ id: string; account_manager_id: string; odoo_analytic_code: string | null; profile: Record<string, unknown> }>('clients', `select=id,account_manager_id,odoo_analytic_code,profile&name=eq.${encodeURIComponent(name)}`)
    expect(c.account_manager_id).toBe(await userIdOf(PEOPLE.am2.email))
    expect(c.odoo_analytic_code).toBe('ODOO-42')
    const profile = c.profile as { businessTypes: string[]; whatTheySell: string; ecommerce: { productCount: string | number } }
    expect(profile.businessTypes).toEqual(expect.arrayContaining(['ecommerce', 'app', 'retail']))
    expect(profile.whatTheySell).toBe('Cold drinks')
    expect(String(profile.ecommerce.productCount)).toBe('120')
    expect((c.profile as { rules: { kind: string; text: string }[] }).rules).toEqual([
      { kind: 'do', text: 'Arabic leads. English is never the master.' },
      { kind: 'dont', text: 'Never "lottery".' },
    ])

    // Cancel a second registration: nothing written.
    await traffic.getByTestId('client-register').click()
    await traffic.getByTestId('client-form-name').fill(`${name} not saved`)
    await traffic.getByTestId('client-form-cancel').click()
    await expect(form).toHaveCount(0)
    expect(await rows('clients', `select=id&name=eq.${encodeURIComponent(name + ' not saved')}`)).toHaveLength(0)

    // Edit: the pencil reopens the form filled; a change lands.
    await traffic.getByTestId(`client-edit-${c.id}`).click()
    await expect(traffic.getByTestId('client-form-name')).toHaveValue(name)
    await traffic.getByTestId('client-form-usp').fill('Coldest in the country')
    await traffic.getByTestId('client-form-submit').click()
    await clear(traffic)
    await expect.poll(async () => ((await rows<{ profile: { usp: string } }>('clients', `select=profile&id=eq.${c.id}`))[0].profile.usp)).toBe('Coldest in the country')

    // Brands: add, rename, delete.
    await traffic.getByTestId('brand-add-form').getByTestId('brand-add-client').selectOption(c.id)
    await traffic.getByTestId('brand-add-name').fill('Cov brand')
    await traffic.getByTestId('brand-add-submit').click()
    await clear(traffic)
    await expect.poll(async () => (await rows<{ id: string }>('brands', `select=id&client_id=eq.${c.id}`)).length).toBe(1)
    const [b] = await rows<{ id: string; name: string }>('brands', `select=id,name&client_id=eq.${c.id}`)
    await traffic.getByTestId(`brand-rename-${b.id}`).click()
    await traffic.getByTestId(`brand-edit-${b.id}`).fill('Cov brand, renamed')
    await traffic.getByTestId(`brand-edit-${b.id}`).press('Enter')
    await clear(traffic)
    await expect.poll(async () => (await rows<{ name: string }>('brands', `select=name&id=eq.${b.id}`))[0].name).toBe('Cov brand, renamed')
    await traffic.getByTestId(`brand-delete-${b.id}`).click()
    await traffic.getByTestId(`brand-delete-${b.id}`).click()
    await clear(traffic)
    await expect.poll(async () => (await rows<{ id: string }>('brands', `select=id&id=eq.${b.id}`)).length).toBe(0)

    // Delete the client (armed twice).
    await traffic.getByTestId(`client-delete-${c.id}`).click()
    await traffic.getByTestId(`client-delete-${c.id}`).click()
    await clear(traffic)
    await expect.poll(async () => (await rows<{ id: string }>('clients', `select=id&id=eq.${c.id}`)).length).toBe(0)
    await traffic.context().close()

    // A team member is not offered the register button.
    const maker = await as(browser, 'maker')
    await maker.goto('/clients')
    await expect(maker.getByTestId('client-register')).toHaveCount(0)
    await maker.context().close()
  })

  test('leave: an entry with every field, edit it, delete it; a closure edited; the closure dialog cancelled', async ({ browser }) => {
    const admin = await as(browser, 'admin')
    await admin.goto('/people/leave')
    await expect(admin.getByTestId('surface-leave')).toBeVisible()
    const start = sundayOut(8)
    const end = shift(start, 2)

    await admin.getByTestId('leave-add').click()
    const dialog = admin.getByTestId('leave-dialog')
    await expect(dialog).toBeVisible()
    const resource = dialog.getByTestId('leave-resource')
    const writerResource = (await rows<{ id: string }>('resources', `select=id&name=eq.${encodeURIComponent(PEOPLE.writer.name)}&is_active=eq.true`))[0].id
    await resource.selectOption(writerResource)
    const category = dialog.getByTestId('leave-category')
    const cats = await category.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean))
    await category.selectOption(cats[cats.length - 1])
    await dialog.getByTestId('leave-start').fill(start)
    await dialog.getByTestId('leave-end').fill(end)
    await dialog.getByTestId('leave-reason').fill('Cov annual leave')
    await dialog.getByTestId('leave-submit').click()
    await expect(dialog).toHaveCount(0)
    await clear(admin)
    const entries = () => rows<{ id: string; starts_at: string; ends_at: string; reason: string | null; category: string | null }>('resource_unavailability', `select=id,starts_at,ends_at,reason,category&resource_id=eq.${writerResource}&order=created_at.desc`)
    await expect.poll(async () => (await entries()).some((e) => e.reason === 'Cov annual leave')).toBe(true)
    const e = (await entries()).find((x) => x.reason === 'Cov annual leave')!
    expect(e.starts_at.slice(0, 10)).toBe(start)
    expect(e.ends_at.slice(0, 10) >= end).toBe(true)
    expect(e.category).toBe(cats[cats.length - 1])

    // Edit: the pencil reopens it filled; a change lands.
    await admin.getByTestId(`leave-edit-${e.id}`).click()
    await expect(dialog.getByTestId('leave-reason')).toHaveValue('Cov annual leave')
    await dialog.getByTestId('leave-end').fill(shift(start, 3))
    await dialog.getByTestId('leave-submit').click()
    await expect(dialog).toHaveCount(0)
    await clear(admin)
    await expect.poll(async () => (await entries()).find((x) => x.id === e.id)!.ends_at.slice(0, 10) >= shift(start, 3)).toBe(true)

    // Delete (armed twice).
    await admin.getByTestId(`leave-delete-${e.id}`).click()
    await admin.getByTestId(`leave-delete-${e.id}`).click()
    await expect.poll(async () => (await entries()).some((x) => x.id === e.id)).toBe(false)
    await clear(admin)

    // A closure: open the dialog and Cancel (nothing written); then edit an existing one.
    await admin.getByTestId('closure-add').click()
    await expect(admin.getByTestId('closure-dialog')).toBeVisible()
    await admin.getByTestId('closure-name').fill('Not saved')
    await admin.getByTestId('closure-cancel').click()
    await expect(admin.getByTestId('closure-dialog')).toHaveCount(0)
    expect(await rows('office_closures', `select=id&name=eq.${encodeURIComponent('Not saved')}`)).toHaveLength(0)
    const cname = `Cov closure ${Date.now()}`
    await admin.getByTestId('closure-add').click()
    await admin.getByTestId('closure-office').selectOption({ label: OFFICES.dubai })
    await admin.getByTestId('closure-kind').selectOption({ index: 1 })
    await admin.getByTestId('closure-name').fill(cname)
    await admin.getByTestId('closure-start').fill(sundayOut(9))
    await admin.getByTestId('closure-end').fill(sundayOut(9))
    await admin.getByTestId('closure-submit').click()
    await expect(admin.getByTestId('closure-dialog')).toHaveCount(0)
    await clear(admin)
    const [cl] = await rows<{ id: string }>('office_closures', `select=id&name=eq.${encodeURIComponent(cname)}`)
    await admin.getByTestId(`closure-edit-${cl.id}`).click()
    await expect(admin.getByTestId('closure-name')).toHaveValue(cname)
    await admin.getByTestId('closure-name').fill(`${cname} (edited)`)
    await admin.getByTestId('closure-submit').click()
    await clear(admin)
    await expect.poll(async () => (await rows<{ name: string }>('office_closures', `select=name&id=eq.${cl.id}`))[0].name).toBe(`${cname} (edited)`)
    await admin.getByTestId(`closure-delete-${cl.id}`).click()
    await admin.getByTestId(`closure-delete-${cl.id}`).click()
    await expect.poll(async () => (await rows<{ id: string }>('office_closures', `select=id&id=eq.${cl.id}`)).length).toBe(0)
    await clear(admin)
    await admin.context().close()

    // Leave is HR's page (I48.30): a team member is not offered it.
    const maker = await as(browser, 'maker')
    await maker.goto('/people/leave')
    await expect(maker.getByTestId('surface-leave')).toHaveCount(0)
    await maker.context().close()
  })
})
