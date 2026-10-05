import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { attemptWrite, rows, userIdOf } from '../helpers/db'

/**
 * Coverage — ADR-0133 (I70): deactivating someone who still holds work. They become Leaving: access gone, a
 * "Leaving — N to hand over" status with a link to their hand-over page; the page lists what they hold, each
 * item handed to a chosen person; Back returns to Users. Reactivating stops the hand-over (d.7) — which is how
 * this test puts the person back.
 *
 * `admin` deactivates (admin.users); the person is `am2`, an account manager holding clients, campaigns and a
 * workstream in the local data — one client is handed over, so they are still Leaving when reactivated. (Someone who
 * holds nothing completes at once, d.4.)
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  return (await browser.newContext({ storageState: authFile(tag) })).newPage()
}
async function clearIf(page: Page) {
  const dialog = page.locator('.notice-dialog').first()
  if (await dialog.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await expect(dialog).not.toContainText(/did not work|could not|outside your reach/i)
    await dialog.locator('[data-testid$="-close"]').first().click()
  }
  await expect(page.locator('.notice-dialog')).toHaveCount(0)
}

/** Put a person back (ADR-0133 d.7) through the same button the tests press — one press when not active-and-staying. */
async function reactivateIfNeeded(browser: Browser, tag: 'am2' | 'animator') {
  const id = await userIdOf(PEOPLE[tag].email)
  const [p] = await rows<{ is_active: boolean; leaving_since: string | null }>('user_profiles', `select=is_active,leaving_since&id=eq.${id}`)
  if (p && p.is_active && p.leaving_since === null) return
  const admin = await as(browser, 'admin')
  await admin.goto('/admin/users')
  await admin.getByTestId(`toggle-active-${id}`).click()
  await clearIf(admin)
  await expect.poll(async () => (await rows<{ is_active: boolean; leaving_since: string | null }>('user_profiles', `select=is_active,leaving_since&id=eq.${id}`))[0])
    .toMatchObject({ is_active: true, leaving_since: null })
  await admin.context().close()
}

/** The client the first test hands away from am2 — given back afterwards (see giveClientBack). */
let handedClient: string | null = null

/**
 * Put the handed-over client back with am2 through the client's own Edit (the same field the hand-over writes,
 * ADR-0133 d.3). Later specs rely on am2 holding it: schedule-booking I74.28 releases a Luma Retail job as am2, and
 * retest-redesign H2b needs the Account Director (the hand-over's first pick) to manage nothing.
 */
async function giveClientBack() {
  if (!handedClient) return
  const am2 = await userIdOf(PEOPLE.am2.email)
  const [c] = await rows<{ account_manager_id: string }>('clients', `select=account_manager_id&id=eq.${handedClient}`)
  if (c?.account_manager_id === am2) return
  // Clean-up, not a test: the account manager is put back directly. The client's Edit page cannot be used — the seed's
  // Luma Retail has no country, which that page now requires (ADR-0123), so its Save stays off.
  const w = await attemptWrite('PATCH', 'clients', `id=eq.${handedClient}`, { account_manager_id: am2 })
  expect(w.status, `give the client back: ${w.text}`).toBeLessThan(300)
}

test.describe('Coverage — a leaving person\'s work is handed over', () => {
  // A failed run must not leave either person deactivated, or am2's client with someone else, for the specs after this
  // file (schedule-booking, schedule-page, retest-redesign h-campaigns-list).
  test.afterAll(async ({ browser }) => {
    // Three trips through the screens (two reactivations, the client given back) do not fit the 60 s default for a hook,
    // and a clean-up that stops half-way leaves the next files on the wrong account manager.
    test.setTimeout(180_000)
    await reactivateIfNeeded(browser, 'am2')
    await reactivateIfNeeded(browser, 'animator')
    await giveClientBack()
  })

  test('deactivate → Leaving with the list; hand one item over; Back to Users; reactivate', async ({ browser }) => {
    const writer = await userIdOf(PEOPLE.am2.email)
    const admin = await as(browser, 'admin')
    await admin.goto('/admin/users')

    // Armed once: the button asks to confirm and says what will happen; confirmed: they become Leaving.
    await admin.getByTestId(`toggle-active-${writer}`).click()
    await expect(admin.getByTestId(`deactivate-note-${writer}`)).toContainText(/lose access/i)
    await admin.getByTestId(`toggle-active-${writer}`).click()
    await clearIf(admin)
    await expect.poll(async () => (await rows<{ leaving_since: string | null }>('user_profiles', `select=leaving_since&id=eq.${writer}`))[0]?.leaving_since ?? null)
      .not.toBeNull()

    await expect(admin.getByTestId(`status-${writer}`)).toContainText(/Leaving/)
    await admin.getByTestId(`handover-link-${writer}`).click()
    await expect(admin).toHaveURL(new RegExp(`/people/handover/${writer}$`))
    await expect(admin.getByTestId('surface-handover')).toBeVisible()

    // One item handed over: its row leaves the list.
    const firstGo = admin.locator('[data-testid^="handover-go-client-"]').first()
    const goId = await firstGo.getAttribute('data-testid')
    expect(goId, 'the writer holds at least one item in the local data').toBeTruthy()
    const suffix = goId!.replace('handover-go-', '')
    handedClient = suffix.replace('client-', '')
    const pick = admin.getByTestId(`handover-pick-${suffix}`)
    await pick.focus()
    await admin.locator(`[data-testid^="handover-pick-${suffix}-option-"]`).first().click()
    await admin.getByTestId(`handover-go-${suffix}`).click()
    await expect(admin.getByTestId(`handover-row-${suffix}`)).toHaveCount(0, { timeout: 15_000 })
    const [moved] = await rows<{ account_manager_id: string }>('clients', `select=account_manager_id&id=eq.${handedClient}`)
    expect(moved?.account_manager_id, 'the client went to the person picked').not.toBe(writer)

    // Back names Users and returns there.
    await expect(admin.getByTestId('handover-back')).toContainText(/Users/)
    await admin.getByTestId('handover-back').click()
    await expect(admin).toHaveURL(/\/admin\/users/)

    // Reactivating a Leaving person stops the hand-over (d.7) and puts them back.
    await admin.getByTestId(`toggle-active-${writer}`).click()
    await clearIf(admin)
    await expect.poll(async () => (await rows<{ is_active: boolean; leaving_since: string | null }>('user_profiles', `select=is_active,leaving_since&id=eq.${writer}`))[0])
      .toMatchObject({ is_active: true, leaving_since: null })
    await admin.context().close()
  })

  /** I70 follow-up: a task with no reviewer; the row asks for one, as the Schedule's dialog does. */
  // RETIRED 5 Oct (Edward, A; I74.56): "a task with no reviewer takes one on the hand-over row". Since 20260827100000 the
  // deferred trigger `sub_task_reviewer_required` refuses any assigned, live task without a reviewer, for every caller —
  // so the state this step repairs can no longer be made, through the product or in a test, without switching the
  // database's own checks off. The step (20260930143000) stays for tasks from before August; production can be checked
  // with the query in TASKS.md I74.56.
})
