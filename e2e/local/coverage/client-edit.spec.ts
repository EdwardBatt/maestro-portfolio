import { test, expect } from '@playwright/test'
import { authFile } from '../fixtures'
import { rows } from '../helpers/db'

/**
 * Coverage — I69 (Edward, 30 Sep): a client's account manager is named on the list and the page, and an
 * active client has an "Edit client" that opens its registration steps and a way back to the page.
 *
 * `traffic` holds clients:manage (the "may"); `maker` holds neither and is offered no Edit.
 */
test.describe('Coverage — a client names its account manager and can be edited', () => {
  test('the list and the page name the account manager; Edit client opens Basics; Back returns to the client', async ({ browser }) => {
    const [client] = await rows<{ id: string; name: string; account_manager_id: string }>(
      'clients',
      'select=id,name,account_manager_id&status=eq.active&is_internal=is.false&account_manager_id=not.is.null&order=name&limit=1',
    )
    expect(client, 'a local active client with an account manager').toBeTruthy()
    const [am] = await rows<{ display_name: string }>('user_profiles', `select=display_name&id=eq.${client!.account_manager_id}`)

    const page = await (await browser.newContext({ storageState: authFile('traffic') })).newPage()
    await page.goto('/clients?tab=all')
    await expect(page.getByTestId(`client-am-${client!.id}`)).toHaveText(am!.display_name)

    await page.goto(`/clients/${client!.id}`)
    await expect(page.getByTestId('client-am-chip')).toContainText(am!.display_name)
    await page.getByTestId('client-edit').click()
    await expect(page).toHaveURL(new RegExp(`/clients/${client!.id}/register\\?step=1`))
    await expect(page.getByTestId('client-wizard')).toHaveAttribute('data-step', '1')
    // An active client is not a draft: no "save it as a draft" note, no draft footer.
    await expect(page.getByTestId('client-wizard')).not.toContainText(/as a draft|draft client/i)

    await page.getByTestId('client-edit-back').click()
    await expect(page).toHaveURL(new RegExp(`/clients/${client!.id}$`))
    await expect(page.getByTestId('client-page')).toBeVisible()
  })

  test('someone who may not manage clients is offered no Edit', async ({ browser }) => {
    const [client] = await rows<{ id: string }>('clients', 'select=id&status=eq.active&is_internal=is.false&order=name&limit=1')
    const page = await (await browser.newContext({ storageState: authFile('maker') })).newPage()
    await page.goto(`/clients/${client!.id}`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('client-edit')).toHaveCount(0)
  })
})
