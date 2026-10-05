import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows, userIdOf } from '../helpers/db'
import { clearMailbox, expectMail, readMailHtml } from '../helpers/mailpit'
import { dueInTwoWeeks, fillSingleJobToReview, pickJobLanguages } from '../helpers/single-job'

/**
 * docs/RETEST-REDESIGN.md — L: cross-cutting (ADR-0092 error reporting and processing feedback,
 * I48.10 plain errors, I48.12 one dialog chrome, RTL, role landings, AI + email against the real
 * keys).
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}

/** A PostgREST-shaped failure for an RPC the screen is about to call — the way an outage arrives. */
async function failRpc(page: Page, rpc: string, delayMs = 400) {
  await page.route(`**/rest/v1/rpc/${rpc}`, async (route) => {
    await new Promise((r) => setTimeout(r, delayMs))
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'XX000', message: 'connection to the database was lost', details: null, hint: null }),
    })
  })
}

/** Let a request through, but only after a delay long enough to see the "please wait" modal. */
async function slow(page: Page, pattern: string, delayMs = 900) {
  await page.route(pattern, async (route) => {
    const response = await route.fetch()
    await new Promise((r) => setTimeout(r, delayMs))
    await route.fulfill({ response })
  })
}

test.describe('Section L — cross-cutting', () => {
  test('L1/L3 — a system error says "That did not work" in plain words, and Report sends it to the Power Admins by email', async ({ browser }) => {
    await clearMailbox()
    const am = await as(browser, 'am')
    const [northwind] = await rows<{ id: string }>('campaigns', `select=id&name=eq.${encodeURIComponent('Northwind Summer Launch')}`)
    await failRpc(am, 'close_out_campaign')
    await am.goto('/campaigns')
    await am.getByTestId('campaigns-scope-all').click()
    await am.getByTestId(`campaign-menu-${northwind.id}`).click()
    await am.getByTestId(`campaign-close-out-${northwind.id}`).click()
    // L2: the please-wait while it is in flight …
    await expect(am.getByTestId('campaigns-busy')).toBeVisible()
    // L3: … then the plain error — heading, what happened, what state, what to do.
    const dialog = am.getByTestId('campaigns-banner-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('h2')).toHaveText('That did not work')
    await expect(dialog.locator('h2')).not.toContainText(/something went wrong/i)
    await expect(am.getByTestId('campaigns-banner')).toContainText(/could not be closed out/i)
    await expect(am.getByTestId('campaigns-banner')).toContainText(/unchanged/i)
    await expect(am.getByTestId('campaigns-banner')).toContainText(/try again, or report this/i)
    // The campaign is indeed unchanged.
    const [c] = await rows<{ status: string }>('campaigns', `select=status&id=eq.${northwind.id}`)
    expect(c.status).toBe('approved')

    // L1: report it. The Power Admin gets the email; the dialog says Sent.
    const report = am.getByTestId('campaigns-banner-report')
    await expect(report).toBeVisible()
    await report.click()
    await expect(am.getByTestId('campaigns-banner-report-done')).toContainText(/sent to your administrator/i)
    const mail = await expectMail(PEOPLE.admin.email, /error reported by/i)
    const html = await readMailHtml(mail.ID)
    expect(html).toContain('could not be closed out')
    expect(html).toContain(PEOPLE.am.email)
    // Closes on Esc like every other dialog.
    await am.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await am.context().close()
  })

  test('L3 — a validation refusal is plain too, and is NOT reportable (ADR-0092 d.3)', async ({ browser }) => {
    // The duplicate-name refusal on a single job: a sentence the person can act on, no Report.
    const am = await as(browser, 'am')
    const title = `L3 twin ${Date.now()}`
    await fillSingleJobToReview(am, { title, department: 'Creative' })
    await am.goto('/campaigns/new-job')
    // The Figma's order (22 Sep): the words on screen 1, the brief, then who and when — where the
    // title is typed and the unique-name refusal lands.
    await am.getByTestId('sj-client').selectOption({ label: 'Northwind Beverages' })
    await am.getByTestId('sj-words').fill('The same job, typed twice.')
    await am.getByTestId('sj-brief-card-single_execution').click()
    await am.getByTestId('sj-next').click()
    await expect(am.getByTestId('sj-brief')).toBeVisible()
    await am.getByTestId('sj-field-task').fill('Design three social statics.')
    await am.getByTestId('sj-next').click()
    await expect(am.getByTestId('sj-request')).toBeVisible()
    await am.getByTestId('sj-title').fill(title)
    await am.getByTestId('sj-due').fill(dueInTwoWeeks())
    await am.getByTestId('sj-department').getByRole('radio', { name: 'Creative' }).click()
    await pickJobLanguages(am)
    await am.getByTestId('sj-next').click()
    const dialog = am.getByTestId('sj-error-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('h2')).toHaveText('That did not work')
    await expect(am.getByTestId('sj-error')).toContainText(/name|already/i)
    await expect(am.getByTestId('sj-error-report')).toHaveCount(0)
    await am.context().close()
  })

  test('L2 — long actions block behind a please-wait: brief ingestion, release, a version upload', async ({ browser }) => {
    const am = await as(browser, 'am')
    // Brief ingestion (the model call, mocked slow).
    await am.route('**/functions/v1/ingest-brief', async (route) => {
      await new Promise((r) => setTimeout(r, 900))
      await route.fulfill({ json: { fields: { task: 'Three statics.' }, oversized: [] } })
    })
    await am.goto('/campaigns/new-job')
    await am.getByTestId('sj-client').selectOption({ label: 'Northwind Beverages' })
    await am.getByTestId('sj-words').fill('Three social statics for the summer range.')
    await am.getByTestId('sj-brief-card-single_execution').click()
    await am.getByTestId('sj-next').click()
    await expect(am.getByTestId('sj-brief')).toBeVisible()
    await am.getByTestId('brief-ingest-toggle-mode').click()
    await am.getByTestId('brief-ingest-paste').fill('Three social statics for the summer range, 1080 square.')
    await am.getByTestId('brief-ingest-run').click()
    const ingestBusy = am.getByTestId('brief-ingest-busy')
    await expect(ingestBusy).toBeVisible()
    await expect(ingestBusy.locator('button')).toHaveCount(0) // no close: it goes when the work does
    await expect(ingestBusy).toHaveCount(0, { timeout: 15_000 })
    await expect(am.getByTestId('sj-field-task')).toHaveValue('Three statics.')
    await am.context().close()

    // Release (the approval RPC, slowed) — on a job filled to its review step.
    const am2 = await as(browser, 'am')
    await fillSingleJobToReview(am2, { title: `L2 release ${Date.now()}`, department: 'Creative' })
    await slow(am2, '**/rest/v1/rpc/approve_campaign*')
    await am2.getByTestId('sj-approve').click()
    const similar = am2.getByTestId('sj-similar-dialog')
    const releasing = am2.getByTestId('sj-busy-release')
    const first = await Promise.race([
      similar.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'prompt' as const),
      releasing.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'busy' as const),
    ])
    if (first === 'prompt') await am2.getByTestId('sj-similar-separate').click()
    await expect(releasing).toBeVisible()
    await expect(releasing.locator('button')).toHaveCount(0)
    await expect(am2).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/, { timeout: 30_000 })
    await expect(releasing).toHaveCount(0)
    await am2.context().close()
  })

  test('L3a — one dialog chrome: Esc, outside-click, focus inside — across the product\'s dialogs', async ({ browser }) => {
    test.setTimeout(240_000)
    const [office] = await rows<{ id: string }>('offices', `select=id&name=eq.Baghdad`)
    const makerId = await userIdOf(PEOPLE.maker.email)
    const [northwind] = await rows<{ id: string }>('campaigns', `select=id&name=eq.${encodeURIComponent('Northwind Summer Launch')}`)
    const [deliverable] = await rows<{ id: string }>('deliverables', `select=id,streams!inner(campaign_id)&streams.campaign_id=eq.${northwind.id}&state=neq.archived&limit=1`)
    const [makerTask] = await rows<{ id: string }>(
      'sub_tasks',
      // A task on a deliverable: the task page offers 'I am blocked' only there.
      `select=id&assignee_id=eq.${makerId}&status=in.(todo,in_progress)&deliverable_id=not.is.null&order=created_at.desc&limit=1`,
    )

    type Case = { who: keyof typeof PEOPLE; url: string; open: string; dialog: string; label: string }
    const cases: Case[] = [
      { who: 'admin', url: '/admin/users', open: 'invite-open', dialog: 'invite-dialog', label: 'invite user' },
      { who: 'admin', url: '/admin/users', open: `perms-${makerId}`, dialog: 'user-perms-dialog', label: 'user permissions' },
      { who: 'admin', url: '/admin/roles', open: 'role-create-open', dialog: 'new-role-dialog', label: 'new role' },
      { who: 'admin', url: '/admin/organization', open: `office-edit-${office.id}`, dialog: 'office-dialog', label: 'edit office' },
      { who: 'admin', url: '/admin/resources', open: 'resource-new', dialog: 'resource-dialog', label: 'resource' },
      { who: 'admin', url: '/people/leave', open: 'leave-add', dialog: 'leave-dialog', label: 'leave' },
      { who: 'admin', url: '/people/leave', open: 'closure-add', dialog: 'closure-dialog', label: 'closure' },
      { who: 'am', url: '/campaigns', open: 'feedback-open', dialog: 'feedback-dialog', label: 'send feedback' },
      // The deliverable window is retired; its piece opens in the campaign page's drawer (I71.1, ADR-0132 d.8).
      { who: 'am', url: `/campaigns/${northwind.id}`, open: `campaign-deliverable-open-${deliverable.id}`, dialog: 'piece-drawer', label: 'deliverable drawer' },
      ...(makerTask
        // The extension request is retired (ADR-0141 d.5) and its replacement is an inline form; the task page's block dialog stands in.
        ? [{ who: 'maker' as const, url: `/my-work/task/${makerTask.id}`, open: 'task-page-blocked-open', dialog: 'block-dialog', label: 'I am blocked' }]
        : []),
    ]
    expect(makerTask, 'a live maker task on a deliverable for the block dialog').toBeTruthy()

    for (const c of cases) {
      const page = await as(browser, c.who)
      await page.goto(c.url)
      const opener = page.getByTestId(c.open)
      const dialog = page.getByTestId(c.dialog)
      // Esc
      await opener.click()
      await expect(dialog, `${c.label}: opens`).toBeVisible()
      const focusedInside = await page.evaluate(
        (id) => !!document.activeElement && !!document.activeElement.closest(`[data-testid="${id}"]`),
        c.dialog,
      )
      expect(focusedInside, `${c.label}: focus lands inside`).toBe(true)
      await page.keyboard.press('Escape')
      await expect(dialog, `${c.label}: Esc closes`).toHaveCount(0)
      // Outside-click
      await opener.click()
      await expect(dialog).toBeVisible()
      await page.locator('.dialog-backdrop').last().click({ position: { x: 4, y: 4 } })
      await expect(dialog, `${c.label}: outside-click closes`).toHaveCount(0)
      await page.context().close()
    }
  })

  test('L4 — Arabic: the layout mirrors and the new strings read in Arabic', async ({ browser }) => {
    const am = await as(browser, 'am')
    await am.goto('/campaigns')
    await expect(am.getByTestId('campaigns-cards')).toBeVisible()
    await am.getByTestId('locale-toggle').click()
    await expect(am.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(am.locator('html')).toHaveAttribute('lang', /^ar/)
    // The new strings: search, the scope switch, the status badge, close-out — in Arabic script.
    await expect(am.getByTestId('campaigns-search')).toHaveAttribute('placeholder', /[؀-ۿ]/)
    await expect(am.getByTestId('campaigns-scope-mine')).toContainText(/[؀-ۿ]/)
    await am.getByTestId('campaigns-scope-all').click()
    const [northwind] = await rows<{ id: string }>('campaigns', `select=id&name=eq.${encodeURIComponent('Northwind Summer Launch')}`)
    await expect(am.getByTestId(`campaign-status-${northwind.id}`)).toContainText(/[؀-ۿ]/)
    await am.getByTestId(`campaign-menu-${northwind.id}`).click()
    await expect(am.getByTestId(`campaign-close-out-${northwind.id}`)).toContainText(/[؀-ۿ]/)
    await am.keyboard.press('Escape')
    // Numbers stay Western digits under Arabic (the progress count on the card), and the new
    // job's door and its buttons read in Arabic too. In-app navigation: the choice is per session.
    await expect(am.getByTestId(`campaign-progress-${northwind.id}`)).toContainText(/\d/)
    await expect(am.getByTestId(`campaign-progress-${northwind.id}`)).not.toContainText(/[٠-٩]/)
    await am.getByTestId('campaigns-new-brief').click()
    await expect(am.getByTestId('new-request-door')).toContainText(/[؀-ۿ]/)
    await am.getByTestId('new-request-single-job').click()
    await expect(am.getByTestId('sj-brief-type')).toBeVisible()
    await expect(am.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(am.getByTestId('sj-next')).toContainText(/[؀-ۿ]/)
    await am.getByTestId('locale-toggle').click()
    await expect(am.locator('html')).toHaveAttribute('dir', 'ltr')
    await am.context().close()
  })

  test('L5 — each role lands on its own route and cannot reach the admin surfaces it has no grant for', async ({ browser }) => {
    test.setTimeout(180_000)
    const roles = await rows<{ key: string; default_route: string }>('roles', 'select=key,default_route')
    const routeOf = new Map(roles.map((r) => [r.key, r.default_route]))
    const tags = Object.keys(PEOPLE) as (keyof typeof PEOPLE)[]
    for (const tag of tags) {
      const page = await as(browser, tag)
      await page.goto('/')
      const expected = routeOf.get(PEOPLE[tag].role)!
      await expect(page, `${tag} (${PEOPLE[tag].role}) lands on ${expected}`).toHaveURL(new RegExp(`${expected.replace('/', '\\/')}(\\/|\\?|$)`))
      await page.context().close()
    }
    // Leakage: a maker has no admin.users grant — the surface is refused and the nav item absent.
    for (const tag of ['maker', 'animator', 'writer', 'editor', 'producer'] as const) {
      const page = await as(browser, tag)
      await page.goto('/admin/users')
      await expect(page.getByTestId('surface-users'), `${tag}: no users surface`).toHaveCount(0)
      await expect(page).not.toHaveURL(/\/admin\/users/)
      await expect(page.getByTestId('nav-admin-users')).toHaveCount(0)
      await page.context().close()
    }
    // And the Power Admin does reach it.
    const admin = await as(browser, 'admin')
    await admin.goto('/admin/users')
    await expect(admin.getByTestId('surface-users')).toBeVisible()
    await admin.context().close()
  })

  test('L6 — brief ingestion against the configured model key; notification email against the local transport', async ({ browser }) => {
    test.setTimeout(120_000)
    // No mock: the real `ingest-brief` (OpenAI, ADR-0049) reads a pasted brief into the fields.
    const am = await as(browser, 'am')
    await am.goto('/campaigns/new-job')
    // SJ-v3-01 (22 Sep): the client and the kind of brief come first, on their own screen.
    await am.getByTestId('sj-client').selectOption({ label: 'Northwind Beverages' })
    await am.getByTestId('sj-words').fill('Three social statics for the summer range.')
    await am.getByTestId('sj-brief-card-single_execution').click()
    await am.getByTestId('sj-next').click()
    await expect(am.getByTestId('sj-brief')).toBeVisible()
    await am.getByTestId('brief-ingest-toggle-mode').click()
    await am.getByTestId('brief-ingest-paste').fill(
      'Please produce three social media statics (1080x1080) for the Northwind summer range launch. ' +
        'Use the new summer key visual as reference. Copy: "Cold before you get there." No competitor logos. Due end of month.',
    )
    await am.getByTestId('brief-ingest-run').click()
    await expect(am.getByTestId('brief-ingest-busy')).toHaveCount(0, { timeout: 90_000 })
    await expect(am.getByTestId('brief-ingest-error')).toHaveCount(0)
    await expect(am.getByTestId('sj-field-task')).not.toHaveValue('', { timeout: 10_000 })
    await am.context().close()

    // Email: the report-error path through the local transport, proved here on its own so this
    // step does not depend on L1 having run (or on the mailbox it cleared).
    await clearMailbox()
    const am2 = await as(browser, 'am')
    const [northwind] = await rows<{ id: string }>('campaigns', `select=id&name=eq.${encodeURIComponent('Northwind Summer Launch')}`)
    await failRpc(am2, 'close_out_campaign')
    await am2.goto('/campaigns')
    await am2.getByTestId('campaigns-scope-all').click()
    await am2.getByTestId(`campaign-menu-${northwind.id}`).click()
    await am2.getByTestId(`campaign-close-out-${northwind.id}`).click()
    await am2.getByTestId('campaigns-banner-report').click()
    await expect(am2.getByTestId('campaigns-banner-report-done')).toContainText(/sent to your administrator/i)
    const mail = await expectMail(PEOPLE.admin.email, /error reported by/i)
    expect(mail.From.Address).toBeTruthy()
    await am2.context().close()
  })
})
