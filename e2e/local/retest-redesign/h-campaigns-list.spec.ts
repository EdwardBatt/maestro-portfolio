import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows } from '../helpers/db'
import { releaseSingleJob, fillSingleJobToReview } from '../helpers/single-job'

/**
 * docs/RETEST-REDESIGN.md — H: the campaigns list (`/campaigns`, I40 + I48), rebuilt as CG-00's
 * cards (I57.3, 24 Sep): Mine / All, filters, a smart search, the status badge and the alert
 * badges, the write actions in each card's menu.
 * Runs as the Account Manager; H5 switches to a maker and the CEO.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}

const idOf = async (name: string) =>
  (await rows<{ id: string }>('campaigns', `select=id&name=eq.${encodeURIComponent(name)}`))[0].id

test.describe('Section H — the campaigns list', () => {
  test.use({ storageState: authFile('am') })

  test('H1 — search finds a campaign by name, brand, client, a piece and a person; no match is one plain line', async ({ page }) => {
    const northwind = await idOf('Northwind Summer Launch')
    const harbour = await idOf('Harbour Line Rebrand')
    await page.goto('/campaigns')
    await page.getByTestId('campaigns-scope-all').click()
    await expect(page.getByTestId('campaigns-cards')).toBeVisible()
    const search = page.getByTestId('campaigns-search')
    const card = (id: string) => page.getByTestId(`campaign-row-${id}`)
    // by name
    await search.fill('Summer Launch')
    await expect(card(northwind)).toBeVisible()
    await expect(card(harbour)).toHaveCount(0)
    // by brand
    await search.fill('Northwind')
    await expect(card(northwind)).toBeVisible()
    // by client
    await search.fill('Harbour Line Logistics')
    await expect(card(harbour)).toBeVisible()
    await expect(card(northwind)).toHaveCount(0)
    // by a piece on it (I57.3) — a piece name only Northwind carries
    await search.fill('key visual - summer range')
    await expect(card(northwind)).toBeVisible()
    await expect(card(harbour)).toHaveCount(0)
    // by a person — the account manager
    await search.fill(PEOPLE.am.name)
    await expect(card(northwind)).toBeVisible()
    // no match: one line, not the empty CTA
    await search.fill('zzz-nothing-matches-this')
    await expect(page.getByTestId('campaigns-no-matches')).toContainText('No campaigns match')
    await expect(page.getByTestId('campaigns-empty-cta')).toHaveCount(0)
  })

  test('H2 — the list opens on Mine; All shows everyone\'s; the filters narrow it', async ({ page }) => {
    const northwind = await idOf('Northwind Summer Launch')
    const harbour = await idOf('Harbour Line Rebrand')
    await page.goto('/campaigns')
    await expect(page.getByTestId('campaigns-scope-mine')).toHaveAttribute('aria-pressed', 'true')
    // The account manager manages Northwind, so it is Mine.
    await expect(page.getByTestId(`campaign-row-${northwind}`)).toBeVisible()
    await page.getByTestId('campaigns-scope-all').click()
    await expect(page.getByTestId('campaigns-scope-all')).toHaveAttribute('aria-pressed', 'true')

    await page.getByTestId('campaigns-filter-client').selectOption('Harbour Line Logistics')
    await expect(page.getByTestId(`campaign-row-${harbour}`)).toBeVisible()
    await expect(page.getByTestId(`campaign-row-${northwind}`)).toHaveCount(0)
    await page.getByTestId('campaigns-filter-client').selectOption('')

    await page.getByTestId('campaigns-filter-am').selectOption(PEOPLE.am.name)
    await expect(page.getByTestId(`campaign-row-${northwind}`)).toBeVisible()
    for (const line of await page.locator('[data-testid^="campaign-line-"]').allTextContents()) {
      expect(line).toContain(PEOPLE.am.name)
    }
    await page.getByTestId('campaigns-filter-am').selectOption('')

    await page.getByTestId('campaigns-filter-status').selectOption('pending_approval')
    const statuses = await page.locator('[data-testid^="campaign-status-"]').allTextContents()
    expect(statuses.length).toBeGreaterThan(0)
    for (const s of statuses) expect(s).toMatch(/Pending approval/)
  })

  test('H2b — a person on no campaign sees All, with one line saying so', async ({ browser }) => {
    // The Account Director manages nothing and holds no task in the seed — Mine is empty, and the
    // page must not be. If a run made them part of a campaign, the premise is gone: say so.
    const p = await as(browser, 'ad')
    await p.goto('/campaigns')
    await expect(p.getByTestId('campaigns-cards')).toBeVisible()
    await expect(p.getByTestId('campaigns-mine-fallback'), 'the AD has no campaign of their own').toBeVisible()
    await p.context().close()
  })

  test('H3/H4 — Open on every card; the menu offers Promote on a single job and Close out on an approved campaign; the card line', async ({ page }) => {
    const job = await releaseSingleJob(page, { title: `H3 job ${Date.now()}`, department: 'Creative' })
    await page.goto('/campaigns')
    await expect(page.getByTestId('campaigns-cards')).toBeVisible()
    const cards = page.locator('[data-testid^="campaign-row-"]')
    await expect(cards.first()).toBeVisible()
    const n = Math.min(await cards.count(), 25)
    expect(n).toBeGreaterThan(1)
    for (let i = 0; i < n; i++) {
      const id = (await cards.nth(i).getAttribute('data-testid'))!.replace('campaign-row-', '')
      await expect(page.getByTestId(`campaign-action-open-${id}`)).toBeVisible()
    }
    await page.getByTestId(`campaign-menu-${job.campaignId}`).click()
    await expect(page.getByTestId(`campaign-promote-${job.campaignId}`)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId(`campaign-promote-${job.campaignId}`)).toHaveCount(0)

    const northwind = await idOf('Northwind Summer Launch')
    await page.getByTestId(`campaign-menu-${northwind}`).click()
    await expect(page.getByTestId(`campaign-close-out-${northwind}`)).toBeVisible()
    await expect(page.getByTestId(`campaign-promote-${northwind}`)).toHaveCount(0)
    await page.keyboard.press('Escape')

    // H4 — the line says whose it is and when: the client, the account manager, a DAY (no time).
    const line = page.getByTestId(`campaign-line-${northwind}`)
    await expect(line).toContainText('Northwind')
    await expect(line).toContainText(PEOPLE.am.name)
    await expect(line).not.toContainText(/\d{2}:\d{2}/)
    await expect(page.getByTestId(`campaign-status-${northwind}`)).toContainText('Approved')
  })

  test('H4b — a released job whose task list nobody has approved carries that badge, and no unassigned-task alarm', async ({ page }) => {
    const job = await releaseSingleJob(page, { title: `H4b job ${Date.now()}`, department: 'Creative', type: 'Social Advertisement' })
    await page.goto('/campaigns')
    await expect(page.getByTestId(`campaign-task-lists-${job.campaignId}`)).toContainText('1 task list to approve')
    // Its tasks cannot be assigned before the list is approved (ADR-0090): not an alarm.
    await expect(page.getByTestId(`campaign-alert-unassigned-${job.campaignId}`)).toHaveCount(0)
    await expect(page.getByTestId(`campaign-progress-${job.campaignId}`)).toContainText('0 of 1')
  })

  test('H5 — read-only for non-managers: visible, no New and no card menu', async ({ browser }) => {
    for (const tag of ['maker', 'ceo'] as const) {
      const p = await as(browser, tag)
      await p.goto('/campaigns')
      await expect(p.getByTestId('campaigns-cards'), `${tag} sees the list`).toBeVisible()
      await expect(p.locator('[data-testid^="campaign-action-open-"]').first()).toBeVisible()
      await expect(p.getByTestId('campaigns-new-brief'), `${tag}: no New`).toHaveCount(0)
      await expect(p.locator('[data-testid^="campaign-menu-"]'), `${tag}: no menu`).toHaveCount(0)
      await expect(p.locator('[data-testid^="campaign-draft-discard-"]'), `${tag}: no Discard`).toHaveCount(0)
      await p.context().close()
    }
  })

  test('H6/H7/H9 — close-out is refused while work is open, succeeds once settled, is reversible, and shows please-wait', async ({ page }) => {
    // A single job whose one deliverable has no tasks: refused while it is still in progress …
    const job = await releaseSingleJob(page, { title: `H6 close ${Date.now()}`, department: 'Creative' })
    await page.goto('/campaigns')
    await page.getByTestId(`campaign-menu-${job.campaignId}`).click()
    await page.getByTestId(`campaign-close-out-${job.campaignId}`).click()
    await expect(page.getByTestId('campaigns-banner')).toContainText(/still has work in progress/)
    await page.getByTestId('campaigns-banner-close').click()
    await expect(page.getByTestId(`campaign-row-${job.campaignId}`)).toBeVisible()

    // … then archive the deliverable (nothing under it), and close out succeeds.
    await page.goto(`/deliverables?campaign=${job.campaignId}`)
    await expect(page.getByTestId(`deliverable-row-${job.deliverableId}`)).toBeVisible()
    await page.getByTestId(`deliverable-archive-${job.deliverableId}`).click()
    // ADR-0080 d.7: the confirmation appears only when live tasks would be called off with it.
    const confirm = page.getByTestId('deliverable-archive-confirm-confirm')
    if (await confirm.isVisible({ timeout: 2_000 }).catch(() => false)) await confirm.click()
    await expect(page.getByTestId(`deliverable-archive-${job.deliverableId}`)).toHaveCount(0)
    const [archived] = await rows<{ state: string }>('deliverables', `select=state&id=eq.${job.deliverableId}`)
    expect(archived.state).toBe('archived')

    await page.goto('/campaigns')
    await page.getByTestId('campaigns-scope-all').click()
    // H9: the please-wait. The local RPC answers in milliseconds, so it is held back long enough to be seen.
    await page.route('**/rest/v1/rpc/close_out_campaign*', async (route) => {
      const response = await route.fetch()
      await new Promise((r) => setTimeout(r, 800))
      await route.fulfill({ response })
    })
    await page.getByTestId(`campaign-menu-${job.campaignId}`).click()
    await page.getByTestId(`campaign-close-out-${job.campaignId}`).click()
    await expect(page.getByTestId('campaigns-busy')).toBeVisible()
    await expect(page.getByTestId(`campaign-row-${job.campaignId}`)).toHaveCount(0)
    const [closed] = await rows<{ status: string; closed_by: string | null }>('campaigns', `select=status,closed_by&id=eq.${job.campaignId}`)
    expect(closed.status).toBe('closed')
    expect(closed.closed_by).toBeTruthy()

    // H7 — show closed → the card is back with Reopen; reopening returns it to the active list.
    await page.getByTestId('campaigns-show-closed').check()
    await expect(page.getByTestId(`campaign-row-${job.campaignId}`)).toBeVisible()
    await page.route('**/rest/v1/rpc/reopen_campaign*', async (route) => {
      const response = await route.fetch()
      await new Promise((r) => setTimeout(r, 800))
      await route.fulfill({ response })
    })
    await page.getByTestId(`campaign-menu-${job.campaignId}`).click()
    await page.getByTestId(`campaign-reopen-${job.campaignId}`).click()
    await expect(page.getByTestId('campaigns-busy')).toBeVisible()
    await expect(page.getByTestId(`campaign-status-${job.campaignId}`)).toContainText('Approved')
    await page.getByTestId(`campaign-menu-${job.campaignId}`).click()
    await expect(page.getByTestId(`campaign-reopen-${job.campaignId}`)).toHaveCount(0)
    await expect(page.getByTestId(`campaign-close-out-${job.campaignId}`)).toBeVisible()
    const [reopened] = await rows<{ status: string }>('campaigns', `select=status&id=eq.${job.campaignId}`)
    expect(reopened.status).toBe('approved')
  })

  test('H8 — drafts are listed apart; resume and discard work', async ({ page }) => {
    const title = `H8 draft ${Date.now()}`
    await fillSingleJobToReview(page, { title, department: 'Creative' })
    await page.getByTestId('sj-cancel').click()
    await page.getByTestId('sj-cancel-confirm').click()
    await expect(page).toHaveURL(/\/campaigns\/?$/)
    const [draft] = await rows<{ id: string }>('campaigns', `select=id&name=eq.${encodeURIComponent(title)}`)
    await expect(page.getByTestId('campaigns-drafts')).toBeVisible()
    const row = page.getByTestId(`campaign-draft-row-${draft.id}`)
    await expect(row).toBeVisible()
    await expect(page.getByTestId(`campaign-row-${draft.id}`)).toHaveCount(0)
    // Resume opens the job where it was; Discard is two-step and removes the draft.
    await expect(page.getByTestId(`campaign-draft-resume-${draft.id}`)).toHaveAttribute('href', `/campaigns/new-job?job=${draft.id}`)
    const discard = page.getByTestId(`campaign-draft-discard-${draft.id}`)
    await discard.click()
    await discard.click()
    await expect(row).toHaveCount(0)
    const gone = await rows<{ id: string }>('campaigns', `select=id&id=eq.${draft.id}`)
    expect(gone).toHaveLength(0)
  })
})
