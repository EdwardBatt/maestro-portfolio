import { test, expect, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows, waitForNotification } from '../helpers/db'
import { nextToReview, pickJobLanguages } from '../helpers/single-job'

/**
 * docs/RETEST-REDESIGN.md — E: the duplicate check and the extra doors (ADR-0086).
 * Runs as the Account Manager. The similarity check is trigram-based (`similar_open_jobs`), so the
 * twin's title shares the whole stem with a different tail.
 */
function dueInTwoWeeks(): string {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + 14 + ((7 - d.getUTCDay()) % 7))
  return d.toISOString().slice(0, 10)
}

async function toReview(page: Page, title: string, client = 'Northwind Beverages', keepPrompt = false) {
  await page.goto('/campaigns/new-job')
  // SJ-v3-01 (22 Sep): the client and the kind of brief come first, on their own screen.
  await page.getByTestId('sj-client').selectOption({ label: client })
  await page.getByTestId('sj-words').fill('Luma S2 proposal deck and key visual.')
  await page.getByTestId('sj-brief-card-single_execution').click()
  await page.getByTestId('sj-next').click()
  await expect(page.getByTestId('sj-brief')).toBeVisible()
  await page.getByTestId('sj-field-task').fill('Design the S2 proposal deck.')
  await page.getByTestId('sj-next').click()
  await expect(page.getByTestId('sj-request')).toBeVisible()
  await page.getByTestId('sj-title').fill(title)
  await page.getByTestId('sj-due').fill(dueInTwoWeeks())
  await page.getByTestId('sj-department').getByRole('radio', { name: 'Creative' }).click()
  await pickJobLanguages(page)
  await nextToReview(page, keepPrompt)
}

/** Approve; if the similar-jobs prompt appears (earlier runs leave lookalikes behind), keep it separate. */
async function release(page: Page) {
  await page.getByTestId('sj-approve').click()
  const prompt = page.getByTestId('sj-similar-dialog')
  const outcome = await Promise.race([
    prompt.waitFor({ state: 'visible', timeout: 10_000 }).then(() => 'prompt' as const),
    page.waitForURL(/\/campaigns\/[0-9a-f-]{36}$/, { timeout: 30_000 }).then(() => 'released' as const),
  ])
  if (outcome === 'prompt') {
    await page.getByTestId('sj-similar-separate').click()
    await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/, { timeout: 30_000 })
  }
  return page.url().split('/').pop()!
}

test.describe('Section E — duplicate check & the extra doors', () => {
  test.use({ storageState: authFile('am') })

  test('E1 — a job that looks like an open one is shown; ATTACH moves it onto the twin and tells the owner', async ({ page }) => {
    const stem = `Luma S2 Proposal ${Date.now()}`
    // The original, released.
    await toReview(page, `${stem} deck`)
    const originalId = await release(page)

    // A near-twin: on Next from who and when (S1, 22 Sep) the check runs and lists the original.
    await toReview(page, `${stem} deck v2`, undefined, true)
    const dialog = page.getByTestId('sj-similar-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Check this first')
    await expect(dialog).toContainText('Northwind Beverages already has a job that looks like this')
    await expect(page.getByTestId('sj-similar-list')).toContainText(`${stem} deck`)
    await expect(page.getByTestId('sj-similar-why')).toBeVisible()

    await page.getByTestId('sj-similar-attach').click()
    await expect(page).toHaveURL(new RegExp(`/campaigns/${originalId}$`), { timeout: 30_000 })

    // The draft is gone, the original now carries two deliverables, and its owner was told.
    const gone = await rows<{ id: string }>('campaigns', `select=id&name=eq.${encodeURIComponent(`${stem} deck v2`)}`)
    expect(gone).toHaveLength(0)
    const dels = await rows<{ id: string }>('deliverables', `select=id,streams!inner(campaign_id)&streams.campaign_id=eq.${originalId}`)
    expect(dels).toHaveLength(2)
    const notif = await waitForNotification(PEOPLE.lead.email, 'deliverable_added')
    expect(notif.entity_type).toBe('deliverable')
  })

  test('E1b — PROCEED releases it as its own job; and an exact duplicate title is refused at step 2', async ({ page }) => {
    const stem = `Luma S3 Proposal ${Date.now()}`
    await toReview(page, `${stem} deck`)
    await release(page)

    await toReview(page, `${stem} deck v2`, undefined, true)
    const dialog = page.getByTestId('sj-similar-dialog')
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('sj-similar-list')).toContainText(`${stem} deck`)
    const separate = page.getByTestId('sj-similar-separate')
    await expect(separate).toBeEnabled()
    await separate.click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('sj-review')).toBeVisible()
    await page.getByTestId('sj-approve').click()
    await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/, { timeout: 30_000 })
    const both = await rows<{ id: string; status: string }>('campaigns', `select=id,status&name=like.${encodeURIComponent(`${stem}*`)}`)
    expect(both.map((c) => c.status)).toEqual(['approved', 'approved'])

    // The one hard refusal: the same title again (unique per tenant) is reported at Next, not later.
    await page.goto('/campaigns/new-job')
    // SJ-v3-01 (22 Sep): the client and the kind of brief come first, on their own screen.
    await page.getByTestId('sj-client').selectOption({ label: 'Northwind Beverages' })
    await page.getByTestId('sj-words').fill('Again.')
    await page.getByTestId('sj-brief-card-single_execution').click()
    await page.getByTestId('sj-next').click()
    await expect(page.getByTestId('sj-brief')).toBeVisible()
    await page.getByTestId('sj-field-task').fill('Design the S2 proposal deck.')
    await page.getByTestId('sj-next').click()
    await expect(page.getByTestId('sj-request')).toBeVisible()
    await page.getByTestId('sj-title').fill(`${stem} deck`)
    await page.getByTestId('sj-due').fill(dueInTwoWeeks())
    await page.getByTestId('sj-department').getByRole('radio', { name: 'Creative' }).click()
    await pickJobLanguages(page)
    await page.getByTestId('sj-next').click()
    const err = page.getByTestId('sj-error')
    await expect(err).toBeVisible()
    await expect(err).toContainText(/already|name/i)
  })

  test('E2 — Promote flips a released job to a campaign, with a please-wait, and opens the campaign page', async ({ page }) => {
    const title = `E2 promote ${Date.now()}`
    await toReview(page, title)
    const id = await release(page)

    await page.goto('/campaigns')
    await page.getByTestId('campaigns-scope-all').click()
    const row = page.getByTestId(`campaign-row-${id}`)
    await expect(row).toBeVisible()
    await expect(page.getByTestId(`campaign-kind-${id}`)).toContainText(/single job|job/i)
    await page.getByTestId(`campaign-menu-${id}`).click()
    await page.getByTestId(`campaign-promote-${id}`).click()
    const dialog = page.getByTestId('campaign-promote')
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('campaign-promote-detail')).toContainText(/one.way|cannot be undone|can't be undone/i)
    await page.getByTestId('campaign-promote-confirm').click()
    // The please-wait shows while the RPC runs; on a fast local stack it can be gone before the
    // assertion runs, so either the modal or the landing counts as "it went with a please-wait".
    await Promise.race([
      page.getByTestId('campaigns-busy').waitFor({ state: 'visible', timeout: 10_000 }),
      page.waitForURL(new RegExp(`/campaigns/${id}$`), { timeout: 30_000 }),
    ])
    await expect(page).toHaveURL(new RegExp(`/campaigns/${id}$`), { timeout: 30_000 })

    const [c] = await rows<{ kind: string }>('campaigns', `select=kind&id=eq.${id}`)
    expect(c.kind).toBe('campaign')
    await page.goto('/campaigns')
    await page.getByTestId('campaigns-scope-all').click()
    await page.getByTestId(`campaign-menu-${id}`).click()
    await expect(page.getByTestId(`campaign-close-out-${id}`)).toBeVisible()
    await expect(page.getByTestId(`campaign-promote-${id}`)).toHaveCount(0)
  })

  test('E3 — Add brand from the request adds a brand inline, on a client that had none', async ({ page }) => {
    await page.goto('/campaigns/new-job')
    await page.getByTestId('sj-client').selectOption({ label: 'Orphan Trading' })
    await page.getByTestId('sj-brand').selectOption('__add_brand__')
    const dialog = page.getByTestId('add-brand-dialog')
    await expect(dialog).toBeVisible()
    const name = `Orphan Brand ${Date.now()}`
    await page.getByTestId('add-brand-name').fill(name)
    await page.getByTestId('add-brand-submit').click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('sj-brand')).toContainText(name)
    const [brand] = await rows<{ id: string; client_id: string }>('brands', `select=id,client_id&name=eq.${encodeURIComponent(name)}`)
    const [client] = await rows<{ id: string }>('clients', `select=id&name=eq.${encodeURIComponent('Orphan Trading')}`)
    expect(brand.client_id).toBe(client.id)
    await expect(page.getByTestId('sj-brand')).toHaveValue(brand.id)
  })
})
