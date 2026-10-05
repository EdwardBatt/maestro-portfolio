import { test, expect } from '@playwright/test'
import { authFile } from '../fixtures'
import { rows, userIdOf } from '../helpers/db'

/**
 * ADR-0137 (I73.2) — a live campaign is renamed on its page by its approval authority; a look-alike name
 * is refused as the wizard refuses it (ADR-0135); the campaign's Library folder follows. The walk renames
 * a campaign the account manager runs and puts its name back, so the long-lived database is left as found.
 */
test('the account manager renames a live campaign, its Library folder follows, a look-alike is refused', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: authFile('am') })
  const am = await ctx.newPage()
  const amId = await userIdOf('maestro.dev+am@example.test')
  const [mine] = await rows<{ id: string; name: string }>('campaigns', `select=id,name&account_manager_id=eq.${amId}&status=eq.approved&kind=eq.campaign&order=created_at&limit=1`)
  expect(mine, 'the account manager runs an approved campaign').toBeTruthy()
  const [other] = await rows<{ name: string }>('campaigns', `select=name&status=eq.approved&id=neq.${mine!.id}&limit=1`)
  const original = mine!.name
  const renamed = `${original} R${Date.now().toString().slice(-5)}`

  await am.goto(`/campaigns/${mine!.id}`)
  await am.getByTestId('campaign-rename-open').click()
  await am.getByTestId('campaign-rename-input').fill(renamed)
  await am.getByTestId('campaign-rename-save').click()
  await expect(am.locator('.cg-title')).toContainText(renamed)
  await expect.poll(async () => (await rows<{ name: string }>('asset_folders', `select=name&campaign_id=eq.${mine!.id}&kind=eq.campaign`))[0]?.name).toBe(renamed)

  // Another campaign's name in other capitals is taken (ADR-0135), said in the wizard's words.
  await am.getByTestId('campaign-rename-open').click()
  await am.getByTestId('campaign-rename-input').fill(other!.name.toUpperCase())
  await am.getByTestId('campaign-rename-save').click()
  await expect(am.getByTestId('campaign-rename-error')).toContainText('already exists')

  // Put it back.
  await am.getByTestId('campaign-rename-input').fill(original)
  await am.getByTestId('campaign-rename-save').click()
  await expect(am.locator('.cg-title')).toContainText(original)
  await expect.poll(async () => (await rows<{ name: string }>('campaigns', `select=name&id=eq.${mine!.id}`))[0]?.name).toBe(original)
  await ctx.close()
})
