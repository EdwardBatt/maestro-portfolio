import { test, expect } from '@playwright/test'

/**
 * Production smoke suite (L5.1). Three layers, degrading gracefully:
 *  1. Deploy integrity — ALWAYS runs, no credentials needed. Catches a broken
 *     build/deploy (blank page, missing bundle, failed boot).
 *  2. Authenticated smoke — runs when E2E_EMAIL / E2E_PASSWORD are set.
 *  3. Role-scope leakage — runs when E2E_CREATIVE_EMAIL / E2E_CREATIVE_PASSWORD
 *     are set: a team member must see no admin controls (§2.3 structural test).
 *
 * The book→proceed→move→cancel loop is covered by the manual run sheet (§2);
 * automating it reliably needs a seeded, disposable dataset — a Phase-2 follow-up.
 * Wire the env vars as CI secrets (ideally against a STAGING project, not prod).
 */

const { E2E_EMAIL, E2E_PASSWORD, E2E_CREATIVE_EMAIL, E2E_CREATIVE_PASSWORD } = process.env

async function signIn(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(email)
  await page.getByTestId('login-password').fill(password)
  await page.getByTestId('login-submit').click()
  // The app shell (logo + user menu) is present on every authenticated surface,
  // regardless of the role's landing route.
  await expect(page.getByTestId('shell-home')).toBeVisible({ timeout: 15_000 })
}

test('deploy integrity — login page renders', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByTestId('login-form')).toBeVisible()
  await expect(page.getByTestId('login-email')).toBeVisible()
  await expect(page.getByTestId('login-password')).toBeVisible()
  await expect(page.getByTestId('login-submit')).toBeVisible()
})

test('authenticated smoke — sign in, land in app, sign out', async ({ page }) => {
  test.skip(!E2E_EMAIL || !E2E_PASSWORD, 'set E2E_EMAIL / E2E_PASSWORD to run')
  await signIn(page, E2E_EMAIL!, E2E_PASSWORD!)
  await expect(page.getByTestId('user-menu')).toBeVisible()

  await page.getByTestId('user-menu-toggle').click()
  await page.getByTestId('sign-out').click()
  await expect(page.getByTestId('login-form')).toBeVisible({ timeout: 15_000 })
})

test('role-scope leakage — a team member sees no admin controls', async ({ page }) => {
  test.skip(!E2E_CREATIVE_EMAIL || !E2E_CREATIVE_PASSWORD, 'set E2E_CREATIVE_EMAIL / E2E_CREATIVE_PASSWORD to run')
  await signIn(page, E2E_CREATIVE_EMAIL!, E2E_CREATIVE_PASSWORD!)
  // Grant-driven nav (ADR-0008): admin routes must be absent, not merely hidden.
  await expect(page.locator('a[href="/admin/users"]')).toHaveCount(0)
  await expect(page.locator('a[href="/admin/roles"]')).toHaveCount(0)
  await expect(page.locator('a[href="/admin/resources"]')).toHaveCount(0)
  // Direct navigation is also refused (the guard, not just the nav).
  await page.goto('/admin/users')
  await expect(page.getByTestId('surface-users')).toHaveCount(0)
})
