import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows } from '../helpers/db'
import { expectMail, clearMailbox, readMailHtml } from '../helpers/mailpit'

/**
 * Coverage — the doors: the login page's forgot-password switch and "remember me", the
 * set-password page end to end (a real invitee: email, code, resend, the reveal toggle, confirm,
 * submit, back), and the "permissions unavailable" guard with its Retry
 * (I49: LoginPage 3, SetPasswordPage 9, guards 1).
 *
 * The "may": a person the admin invited sets a password with a valid code and is let in. The
 * "may not": a wrong code is refused in words and opens nothing.
 *
 * The code is read FROM THE MAIL, the way a person would: the local stack sends the same
 * code-led templates production does (`supabase/email-templates/`, wired in `config.toml` —
 * I49.85, ADR-0012), so the mail is the proof rather than GoTrue's admin API.
 */

async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}
async function clearIf(page: Page) {
  const dialog = page.locator('.notice-dialog').first()
  if (await dialog.isVisible({ timeout: 2_500 }).catch(() => false)) {
    await expect(dialog).not.toContainText(/did not work|could not|outside your reach/i)
    await dialog.locator('[data-testid$="-close"]').first().click()
  }
  await expect(page.locator('.notice-dialog')).toHaveCount(0)
}
/**
 * The code the mail carries — the template shows it once per language in the boxed span, so the
 * first match is it. Six to ten digits: GoTrue's OTP length is configurable (L1.3).
 */
function codeInMail(html: string): string {
  const m = html.match(/>\s*(\d{6,10})\s*</)
  if (!m) throw new Error('the mail carries no code — is config.toml pointing at supabase/email-templates/?')
  return m[1]
}

const stamp = Date.now()
const inviteeEmail = `maestro.dev+door${stamp}@example.test`
const inviteeName = `Cov Door ${stamp}`
const newPassword = `Door-pass-${stamp}!`

test.describe('Coverage — login, set-password, the permissions guard', () => {
  test('the login page: Forgot password switches the form and Back returns; no "remember me" (I49.83)', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByTestId('login-form')).toBeVisible()
    // "Remember me" was removed on 16 Sep: it was read by nothing (I49.83). Everyone stays signed
    // in until they sign out.
    await expect(page.getByTestId('login-remember')).toHaveCount(0)
    await expect(page.getByText(/remember me/i)).toHaveCount(0)
    await page.getByTestId('forgot-toggle').click()
    await expect(page.getByTestId('forgot-back')).toBeVisible()
    await expect(page.getByTestId('login-password')).toHaveCount(0)
    await page.getByTestId('forgot-back').click()
    await expect(page.getByTestId('forgot-back')).toHaveCount(0)
    await expect(page.getByTestId('login-password')).toBeVisible()
    // Forgot with a real address: the reset mail goes out and the code screen opens with the
    // address carried over.
    await clearMailbox()
    await page.getByTestId('forgot-toggle').click()
    await page.getByTestId('login-email').fill(PEOPLE.planner.email)
    await page.getByTestId('login-submit').click()
    await expect(page).toHaveURL(/\/set-password$/)
    await expect(page.getByTestId('set-password-email')).toHaveValue(PEOPLE.planner.email)
    await expectMail(PEOPLE.planner.email, /reset your password/i)
    await page.getByTestId('set-password-back').click()
    await expect(page).toHaveURL(/\/login$/)
  })

  test('may: an invitee sets a password with the code (resend, reveal, confirm) and is let in; then signs in with it', async ({ browser, page }) => {
    // The invite, through the admin's own screen.
    const admin = await as(browser, 'admin')
    await admin.goto('/admin/users')
    await admin.getByTestId('invite-open').click()
    await expect(admin.getByTestId('invite-dialog')).toBeVisible()
    await admin.getByTestId('invite-email').fill(inviteeEmail)
    await admin.getByTestId('invite-name').fill(inviteeName)
    const roleOptions = await admin.getByTestId('invite-role').locator('option').evaluateAll((os) => os.map((o) => ({ v: (o as HTMLOptionElement).value, t: o.textContent ?? '' })))
    await admin.getByTestId('invite-role').selectOption(roleOptions.find((o) => /Team Member/.test(o.t))!.v)
    const [creative] = await rows<{ id: string }>('departments', `select=id&name=eq.Creative`)
    await admin.getByTestId('invite-department').selectOption(creative.id)
    await admin.getByTestId('invite-submit').click()
    await expect(admin.getByTestId('invite-dialog')).toHaveCount(0)
    await clearIf(admin)
    await expect.poll(async () => (await rows<{ id: string }>('user_profiles', `select=id&display_name=eq.${encodeURIComponent(inviteeName)}`)).length, { timeout: 20_000 }).toBe(1)
    await admin.context().close()

    // The invitee, signed out, on the set-password page from the invite link.
    await page.goto(`/set-password?flow=invite&email=${encodeURIComponent(inviteeEmail)}`)
    await expect(page.getByTestId('set-password-form')).toBeVisible()
    await expect(page.getByTestId('set-password-email')).toHaveValue(inviteeEmail)
    await page.getByTestId('set-password-email').fill(inviteeEmail.toUpperCase())
    await page.getByTestId('set-password-email').fill(inviteeEmail)

    // Resend: a fresh recovery mail goes out and the page says so.
    await clearMailbox()
    await page.getByTestId('set-password-resend').click()
    await expect(page.getByTestId('set-password-notice')).toBeVisible()
    const resent = await expectMail(inviteeEmail, /reset your password/i)

    // A wrong code is refused in words; nothing opens.
    await page.getByTestId('set-password-code').fill('000000')
    await page.getByTestId('set-password-input').fill(newPassword)
    await page.getByTestId('set-password-confirm').fill('not the same')
    await page.getByTestId('set-password-submit').click()
    await expect(page.getByTestId('set-password-error')).toContainText(/match/i)
    await page.getByTestId('set-password-confirm').fill(newPassword)
    await page.getByTestId('set-password-submit').click()
    await expect(page.getByTestId('set-password-error')).toContainText(/code/i)
    await expect(page).toHaveURL(/\/set-password/)

    // The reveal toggle shows what was typed.
    await expect(page.getByTestId('set-password-input')).toHaveAttribute('type', 'password')
    await page.getByTestId('set-password-toggle').click()
    await expect(page.getByTestId('set-password-input')).toHaveAttribute('type', 'text')
    await expect(page.getByTestId('set-password-confirm')).toHaveAttribute('type', 'text')
    await page.getByTestId('set-password-toggle').click()
    await expect(page.getByTestId('set-password-input')).toHaveAttribute('type', 'password')

    // The right code, read from the resent mail (the latest — resend replaced the invite's): in.
    await page.getByTestId('set-password-code').fill(codeInMail(await readMailHtml(resent.ID)))
    await page.getByTestId('set-password-submit').click()
    await expect(page).not.toHaveURL(/\/set-password|\/login/, { timeout: 20_000 })
    await expect(page.getByTestId('nav-dashboard')).toBeVisible()

    // Signed out, the new password signs in.
    await page.context().clearCookies()
    await page.evaluate(() => localStorage.clear())
    await page.goto('/login')
    await page.getByTestId('login-email').fill(inviteeEmail)
    await page.getByTestId('login-password').fill('wrong password')
    await page.getByTestId('login-submit').click()
    await expect(page.getByTestId('login-error')).toBeVisible()
    await page.getByTestId('login-password').fill(newPassword)
    await page.getByTestId('login-submit').click()
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 20_000 })
  })

  test('the permissions guard: when the grant read fails the page says so, and Retry loads it', async ({ browser }) => {
    const planner = await as(browser, 'planner')
    // Break the grant read (the role row) until Retry.
    let broken = true
    await planner.route('**/rest/v1/roles?*', async (route) => {
      if (broken) return route.abort('failed')
      return route.continue()
    })
    await planner.goto('/schedule')
    await expect(planner.getByTestId('permissions-unavailable')).toBeVisible({ timeout: 20_000 })
    broken = false
    await planner.getByTestId('permissions-retry').click()
    await expect(planner.getByTestId('permissions-unavailable')).toHaveCount(0, { timeout: 20_000 })
    await expect(planner.getByTestId('surface-schedule')).toBeVisible({ timeout: 20_000 })
    await planner.context().close()
  })
})
