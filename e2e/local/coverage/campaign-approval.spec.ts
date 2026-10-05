import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { attemptWrite, rows, userIdOf } from '../helpers/db'

/**
 * Who may approve a campaign, and who may say who its account manager is (I52.16 / I52.17,
 * Edward 17 Sep, from production): a campaign whose row named the Account Director although the
 * client's manager created it — she could not approve, and neither could a Power Admin, because the
 * screen offered Approve to the one resolved name only. Now: Approve is offered to everyone the
 * database admits; the manager can be corrected on the page by the same people; a department lead
 * gets neither.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}

let campaignId: string
const name = `Approval ${Date.now()}`

test.describe('Campaign approval — the people the database admits', () => {
  test.beforeAll(async () => {
    // The production shape, made directly: pending, on the AM's client, the row naming the AD.
    const [client] = await rows<{ id: string; tenant_id: string }>('clients', `select=id,tenant_id&name=eq.Northwind%20Beverages`)
    const res = await attemptWrite('POST', 'campaigns', 'select=id', {
      tenant_id: client.tenant_id, client_id: client.id, name, status: 'pending_approval', kind: 'campaign',
      account_manager_id: await userIdOf(PEOPLE.ad.email),
    })
    expect(res.status, res.text).toBe(201)
    campaignId = (JSON.parse(res.text) as { id: string }[])[0].id
  })

  test('the client\'s own manager is refused while the row names somebody else — and a department lead is offered nothing', async ({ browser }) => {
    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${campaignId}`)
    await expect(am.getByTestId('campaign-account-manager-name')).toHaveText(PEOPLE.ad.name)
    await expect(am.getByTestId('campaign-approve')).toHaveCount(0)
    await expect(am.getByTestId('campaign-approve-denied')).toContainText(PEOPLE.ad.name)
    await expect(am.getByTestId('campaign-account-manager-change')).toHaveCount(0)
    await am.context().close()

    const lead = await as(browser, 'lead')
    await lead.goto(`/campaigns/${campaignId}`)
    await expect(lead.getByTestId('campaign-approve')).toHaveCount(0)
    await expect(lead.getByTestId('campaign-account-manager-change')).toHaveCount(0)
    await lead.context().close()
  })

  test('a Power Admin is offered Approve, and corrects the manager to the client\'s; she then approves', async ({ browser }) => {
    const admin = await as(browser, 'admin')
    await admin.goto(`/campaigns/${campaignId}`)
    await expect(admin.getByTestId('campaign-approve')).toBeVisible()   // the backup that was required
    // Cancel changes nothing.
    await admin.getByTestId('campaign-account-manager-change').click()
    await admin.getByTestId('campaign-account-manager-select').selectOption({ label: PEOPLE.am.name })
    await admin.getByTestId('campaign-account-manager-cancel').click()
    await expect(admin.getByTestId('campaign-account-manager-name')).toHaveText(PEOPLE.ad.name)
    // Save corrects it, in the database and on the page.
    await admin.getByTestId('campaign-account-manager-change').click()
    await admin.getByTestId('campaign-account-manager-select').selectOption({ label: PEOPLE.am.name })
    await admin.getByTestId('campaign-account-manager-save').click()
    await expect(admin.getByTestId('campaign-banner')).toContainText(/account manager changed/i)
    await admin.getByTestId('campaign-banner-close').click()
    await expect(admin.getByTestId('campaign-account-manager-name')).toHaveText(PEOPLE.am.name)
    expect((await rows<{ account_manager_id: string }>('campaigns', `select=account_manager_id&id=eq.${campaignId}`))[0].account_manager_id).toBe(await userIdOf(PEOPLE.am.email))
    await admin.context().close()

    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${campaignId}`)
    await am.getByTestId('campaign-approve').click()
    await expect.poll(async () => (await rows<{ status: string }>('campaigns', `select=status&id=eq.${campaignId}`))[0].status).toBe('approved')
    await expect(am.getByTestId('campaign-approve')).toHaveCount(0)
    await am.context().close()
  })

  test('changing the client’s account manager reaches its open campaigns (I52.19); the new manager approves', async ({ browser }) => {
    // A second pending campaign on Northwind (whose manager is `am`), naming that manager.
    const [client] = await rows<{ id: string; tenant_id: string; account_manager_id: string }>('clients', `select=id,tenant_id,account_manager_id&name=eq.Northwind%20Beverages`)
    const res = await attemptWrite('POST', 'campaigns', 'select=id', {
      tenant_id: client.tenant_id, client_id: client.id, name: `Follows ${Date.now()}`, status: 'pending_approval', kind: 'campaign',
      account_manager_id: client.account_manager_id,
    })
    expect(res.status, res.text).toBe(201)
    const follows = (JSON.parse(res.text) as { id: string }[])[0].id

    // Traffic changes the client's manager on its Basics step (ADR-0123, CL-v3-01) — nothing else.
    const traffic = await as(browser, 'traffic')
    await traffic.goto(`/clients/${client.id}/register?step=1`)
    // The seed writes its clients after the migration that gave every client a country; Basics asks for one.
    if (!(await traffic.getByTestId('client-country').inputValue())) await traffic.getByTestId('client-country').selectOption('IQ')
    await traffic.getByTestId('client-am').selectOption(await userIdOf(PEOPLE.am2.email))
    await traffic.getByTestId('client-next').click()
    await expect(traffic).toHaveURL(/register\?step=2/)
    await traffic.context().close()

    // The campaign followed, and its new manager is the one offered Approve.
    await expect.poll(async () => (await rows<{ account_manager_id: string }>('campaigns', `select=account_manager_id&id=eq.${follows}`))[0].account_manager_id).toBe(await userIdOf(PEOPLE.am2.email))
    const am2 = await as(browser, 'am2')
    await am2.goto(`/campaigns/${follows}`)
    await expect(am2.getByTestId('campaign-account-manager-name')).toHaveText(PEOPLE.am2.name)
    await am2.getByTestId('campaign-approve').click()
    await expect.poll(async () => (await rows<{ status: string }>('campaigns', `select=status&id=eq.${follows}`))[0].status).toBe('approved')
    await am2.context().close()
    // and the old manager no longer is
    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${follows}`)
    await expect(am.getByTestId('campaign-account-manager-name')).toHaveText(PEOPLE.am2.name)
    await am.context().close()

    // Northwind's manager back to `am` — the seed's shape, which every other family relies on; the
    // service role writes it with no actor, and the trigger moves this test's campaign back too.
    await attemptWrite('PATCH', 'clients', `id=eq.${client.id}`, { account_manager_id: client.account_manager_id })
  })
})
