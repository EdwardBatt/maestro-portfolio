import { test, expect } from '@playwright/test'
import { authFile } from '../fixtures'
import { rows } from '../helpers/db'

/**
 * I73.4 — the campaign form's account manager box offered the department and team leads (the deliverable
 * owners) instead of the account managers. It offers the holders of account_manager:manage, as the campaign
 * page's own "Change" does.
 */
test('the campaign form offers account managers as the account manager, not team leads', async ({ browser }) => {
  const managers = await rows<{ id: string; display_name: string }>('user_profiles', 'select=id,display_name,roles!inner(key)&roles.key=eq.account_manager&is_active=eq.true')
  const leads = await rows<{ id: string; display_name: string }>('user_profiles', 'select=id,display_name,roles!inner(key)&roles.key=in.(department_lead,team_lead)&is_active=eq.true')
  expect(managers.length, 'the tenant has account managers').toBeGreaterThan(0)
  expect(leads.length, 'the tenant has leads to leave out').toBeGreaterThan(0)
  const ctx = await browser.newContext({ storageState: authFile('am') })
  const page = await ctx.newPage()
  await page.goto('/campaigns/new')
  await page.getByTestId('wizard-account-manager').click()
  const list = page.getByTestId('wizard-account-manager-list')
  // Each option by its person's id: a name regex also matched "Dev Account Mgr 2" for "Dev Account Mgr" (strict mode).
  for (const m of managers) await expect(list.getByTestId(`wizard-account-manager-option-${m.id}`), m.display_name).toBeVisible()
  for (const l of leads) await expect(list.getByTestId(`wizard-account-manager-option-${l.id}`), l.display_name).toHaveCount(0)
  await ctx.close()
})
