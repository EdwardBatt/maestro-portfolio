import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { authFile, PEOPLE } from '../fixtures'
import { rows } from '../helpers/db'
import { nextToReview, pickJobLanguages } from '../helpers/single-job'

/**
 * docs/RETEST-REDESIGN.md — B: Single job, the request (SJ-02, ADR-0083), and since 22 Sep the
 * screen before it — B0, SJ-v3-01 "What are we making?" (Figma `B · SINGLE JOB — BRIEF FIRST`).
 * Runs as the Account Manager. Every title carries a timestamp (campaign names are unique).
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const RECEIPT = path.join(here, 'dummy-receipt.png')

/** A working day (Sunday) two weeks out, YYYY-MM-DD. */
function dueInTwoWeeks(): string {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + 14 + ((7 - d.getUTCDay()) % 7))
  return d.toISOString().slice(0, 10)
}

/** The receipt is written before Next moves on (I48.41) — polling kept as a harmless margin. */
async function receiptFor(campaignId: string, timeoutMs = 8_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const [r] = await rows<{ received_at: string; asset_id: string | null }>(
      'campaign_brief_receipts',
      `select=received_at,asset_id&campaign_id=eq.${campaignId}`,
    )
    if (r) return r
    await new Promise((res) => setTimeout(res, 250))
  }
  throw new Error(`no campaign_brief_receipts row for ${campaignId} within ${timeoutMs}ms`)
}

/** Open the flow, answer SJ-v3-01 (client, words, the kind of brief) and SJ-v3-02 (the one required
 *  field) to reach who and when — the Figma's order, 22 Sep. */
async function openRequest(page: Page, client = 'Northwind Beverages', briefType = 'single_execution') {
  await page.goto('/campaigns/new-job')
  await page.getByTestId('sj-client').selectOption({ label: client })
  await page.getByTestId('sj-words').fill('Three social statics for the summer range, Arabic first.')
  await page.getByTestId(`sj-brief-card-${briefType}`).click()
  await page.getByTestId('sj-next').click()
  await expect(page.getByTestId('sj-brief')).toBeVisible()
  await page.getByTestId('sj-field-task').fill('Design three social statics.')
  await page.getByTestId('sj-next').click()
  await expect(page.getByTestId('sj-request')).toBeVisible()
}

async function fillRequest(page: Page, title: string, department = 'Creative') {
  await page.getByTestId('sj-title').fill(title)
  await page.getByTestId('sj-due').fill(dueInTwoWeeks())
  await page.getByTestId('sj-department').getByRole('radio', { name: department }).click()
  await pickJobLanguages(page)
}

test.describe('Section B — single job: the request', () => {
  test.use({ storageState: authFile('am') })

  test('B0 — SJ-v3-01: every usable template is a card; search narrows; a campaign is one link away', async ({ page }) => {
    await page.goto('/campaigns/new-job')
    await expect(page.getByTestId('sj-brief-type')).toBeVisible()
    await expect(page.getByTestId('sj-step-dot-1')).toContainText('Type of brief')
    // The tenant's OWN list — every active template with fields, not a fixed six.
    const usable = (await rows<{ brief_type: string; name_en: string; fields: unknown[] }>(
      'brief_templates',
      'select=brief_type,name_en,fields&is_active=eq.true',
    )).filter((t) => t.fields.length > 0)
    expect(usable.length).toBeGreaterThan(6)
    for (const t of usable) {
      await expect(page.getByTestId(`sj-brief-card-${t.brief_type}`)).toContainText(t.name_en)
    }
    // Nothing chosen yet: the button is greyed (Edward, 26 Sep). A brief picked with no client is
    // refused with the client named.
    await expect(page.getByTestId('sj-next')).toContainText('Start the brief')
    await expect(page.getByTestId('sj-next')).toBeDisabled()
    await page.getByTestId('sj-brief-card-single_execution').click()
    await expect(page.getByTestId('sj-next')).toBeEnabled()
    await page.getByTestId('sj-next').click()
    const err = page.getByTestId('sj-error')
    await expect(err).toContainText('Client')
    await expect(err).not.toContainText('Kind of brief')
    await page.getByTestId('sj-error-close').click()
    // The search narrows the grid; an empty match is a line, not a dead end.
    await page.getByTestId('sj-brief-search').fill('execution')
    await expect(page.getByTestId('sj-brief-card-single_execution')).toBeVisible()
    await expect(page.getByTestId('sj-brief-card-social_calendar')).toHaveCount(0)
    await page.getByTestId('sj-brief-search').fill('zzzz-nothing')
    await expect(page.getByTestId('sj-brief-empty')).toContainText('Nothing matches')
    await page.getByTestId('sj-brief-search').fill('')
    // A pressed card is the choice and names the Next button. INHERITS counts the client profile's rules.
    await page.getByTestId('sj-client').selectOption({ label: 'Northwind Beverages' })
    await expect(page.getByTestId('sj-inherits')).toContainText(/dos-and-don’ts rule/)
    await page.getByTestId('sj-brief-card-social_calendar').click()
    await expect(page.getByTestId('sj-brief-card-social_calendar')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('sj-next')).toContainText('Start the Social Media Brief')
    // More than one deliverable → the campaign wizard.
    await expect(page.getByTestId('sj-start-campaign')).toHaveAttribute('href', '/campaigns/new')
    await page.getByTestId('sj-start-campaign').click()
    await expect(page).toHaveURL(/\/campaigns\/new$/)
  })

  test('B1 — Next with blanks NAMES each missing field', async ({ page }) => {
    await openRequest(page)
    await page.getByTestId('sj-next').click()
    const err = page.getByTestId('sj-error')
    await expect(err).toBeVisible()
    for (const field of ['Job title', 'Due date', 'Which department']) {
      await expect(err).toContainText(field)
    }
    await expect(err).not.toContainText('marked *')
    await page.getByTestId('sj-error-close').click()
    await expect(err).toHaveCount(0)
  })

  test('B2 — "who asked" is free text, kept verbatim — on screen 1 since 22 Sep', async ({ page }) => {
    await page.goto('/campaigns/new-job')
    const asked = page.getByTestId('sj-asked-by')
    // A text input, not a picker. Since I62 it SUGGESTS the client's people (a datalist) — a suggestion only:
    // whatever is typed is kept.
    await expect(asked).toHaveJSProperty('tagName', 'INPUT')
    await expect(asked).toHaveAttribute('list', 'sj-asked-by-people')
    await expect(asked).not.toHaveAttribute('type', /date|number|email/)
    await asked.fill('Layla Hassan, brand manager (WhatsApp)')
    await expect(asked).toHaveValue('Layla Hassan, brand manager (WhatsApp)')
  })

  test('B3 — the due date is typed; nothing proposes one', async ({ page }) => {
    await openRequest(page)
    const due = page.getByTestId('sj-due')
    await expect(due).toHaveAttribute('type', 'date')
    await expect(due).toHaveValue('')
    const day = dueInTwoWeeks()
    await due.fill(day)
    await expect(due).toHaveValue(day)
  })

  test('B4 — the receipt: a screenshot is filed and the arrival persists across Next/Back and a reload; a manual arrival persists too', async ({ page }) => {
    const title = `B4 receipt ${Date.now()}`
    // The receipt is on screen 1 since 22 Sep, beside "For whom". Attach the screenshot there. The
    // model read may or may not extract a time from a 1×1 PNG; the arrival is typed by hand either
    // way, which is what the clock starts from.
    await page.goto('/campaigns/new-job')
    await page.getByTestId('sj-client').selectOption({ label: 'Northwind Beverages' })
    await page.getByTestId('receipt-file').setInputFiles(RECEIPT)
    await expect(page.getByTestId('receipt-preview')).toBeVisible()
    await expect(page.getByTestId('receipt-reading')).toHaveCount(0, { timeout: 30_000 })
    await page.getByTestId('receipt-date').fill('2026-09-10')
    await page.getByTestId('receipt-time').fill('09:15')
    await page.getByTestId('receipt-confirm').check()
    await expect(page.getByTestId('sj-clock')).toBeVisible()
    await page.getByTestId('sj-words').fill('Three social statics for the summer range, Arabic first.')
    await page.getByTestId('sj-brief-card-single_execution').click()
    await page.getByTestId('sj-next').click()
    await expect(page.getByTestId('sj-brief')).toBeVisible()
    // Locally B2 is not configured, so the screenshot's FILING fails and ADR-0092 d.5 says so out
    // loud (never silently) — the arrival is saved regardless. Close it.
    const filing = page.getByTestId('sj-error')
    if (await filing.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await expect(filing).toContainText(/screenshot could not be filed/)
      await page.getByTestId('sj-error-close').click()
    }
    await page.getByTestId('sj-field-task').fill('Design three social statics.')
    await page.getByTestId('sj-next').click()
    await expect(page.getByTestId('sj-request')).toBeVisible()
    await fillRequest(page, title)

    // Next → Back → Back → Back: still there.
    await nextToReview(page)
    await page.getByTestId('sj-back').click()
    await expect(page.getByTestId('sj-request')).toBeVisible()
    await page.getByTestId('sj-back').click()
    await expect(page.getByTestId('sj-brief')).toBeVisible()
    await page.getByTestId('sj-back').click()
    await expect(page.getByTestId('sj-brief-type')).toBeVisible()
    await expect(page.getByTestId('receipt-date')).toHaveValue('2026-09-10')
    await expect(page.getByTestId('receipt-time')).toHaveValue('09:15')
    await expect(page.getByTestId('receipt-confirm')).toBeChecked()

    // Reload via the draft (the URL carries no id until resumed): the arrival was persisted.
    const [draft] = await rows<{ id: string }>('campaigns', `select=id&name=eq.${encodeURIComponent(title)}`)
    expect(draft, 'the draft exists after Next').toBeTruthy()
    await page.goto(`/campaigns/new-job?job=${draft.id}`)
    await expect(page.getByTestId('surface-single-job')).toBeVisible()
    await expect(page.getByTestId('sj-clock')).toBeVisible()
    const receipt = await receiptFor(draft.id)
    expect(receipt.received_at).toContain('2026-09-10')
  })

  test('B4b — a MANUAL arrival with no screenshot persists too', async ({ page }) => {
    const title = `B4 manual ${Date.now()}`
    await page.goto('/campaigns/new-job')
    await page.getByTestId('sj-client').selectOption({ label: 'Northwind Beverages' })
    await page.getByTestId('receipt-manual').click()
    await page.getByTestId('receipt-date').fill('2026-09-11')
    await page.getByTestId('receipt-time').fill('14:00')
    await page.getByTestId('receipt-confirm').check()
    await expect(page.getByTestId('sj-clock')).toBeVisible()
    await page.getByTestId('sj-words').fill('Three social statics for the summer range, Arabic first.')
    await page.getByTestId('sj-brief-card-single_execution').click()
    await page.getByTestId('sj-next').click()
    await expect(page.getByTestId('sj-brief')).toBeVisible()
    // The draft exists from this Next under a provisional name; the title names it on who and when.
    await page.getByTestId('sj-field-task').fill('Design three social statics.')
    await page.getByTestId('sj-next').click()
    await expect(page.getByTestId('sj-request')).toBeVisible()
    await fillRequest(page, title)
    await nextToReview(page)
    const [draft] = await rows<{ id: string }>('campaigns', `select=id&name=eq.${encodeURIComponent(title)}`)
    const receipt = await receiptFor(draft.id)
    expect(receipt.received_at).toContain('2026-09-11')
    expect(receipt.asset_id).toBeNull()
  })

  test('B5 — a department WITH a lead names the lead, with the load for the due week', async ({ page }) => {
    await openRequest(page)
    await page.getByTestId('sj-due').fill(dueInTwoWeeks())
    await page.getByTestId('sj-department').getByRole('radio', { name: 'Creative' }).click()
    await pickJobLanguages(page)
    await expect(page.getByTestId('sj-owner-name')).toHaveText(PEOPLE.lead.name)
    await expect(page.getByTestId('sj-owner-load')).toContainText(/for the week it is due/)
    await expect(page.getByTestId('sj-owner-load')).toContainText('Creative')
  })

  test('B6 — Production (no lead) offers its TWO team leads; Strategy (nobody senior) still captures the job', async ({ page }) => {
    await openRequest(page)
    await fillRequest(page, `B6 production ${Date.now()}`, 'Production')
    // A drop-down since 27 Sep: "Choose a team lead…" and the two, nothing chosen.
    const pick = page.getByTestId('sj-owner-select')
    await expect(pick).toBeVisible()
    await expect(pick).toHaveValue('')
    await expect(pick.locator('option')).toHaveCount(3)
    await expect(pick.locator('option', { hasText: PEOPLE.studiotl.name })).toHaveCount(1)
    await expect(pick.locator('option', { hasText: PEOPLE.edittl.name })).toHaveCount(1)
    await expect(page.getByTestId('sj-owner-none')).toHaveCount(0)

    // Strategy: no lead, no team lead — the notice, and the request still goes through to review.
    await page.getByTestId('sj-department').getByRole('radio', { name: 'Strategy' }).click()
    await pickJobLanguages(page)
    await expect(page.getByTestId('sj-owner-none')).toBeVisible()
    await expect(page.getByTestId('sj-owner-select')).toHaveCount(0)
    await nextToReview(page)
  })

  test('B6b — with Production chosen, release is blocked until a team lead is named', async ({ page }) => {
    await openRequest(page)
    await fillRequest(page, `B6 owner gate ${Date.now()}`, 'Production')
    await nextToReview(page)
    await page.getByTestId('sj-approve').click()
    const err = page.getByTestId('sj-error')
    await expect(err).toBeVisible()
    await expect(err).toContainText(/name a team lead as the owner/i)
  })

  test('B8 — SJ-v3-04: which team, the lead row, the count-back strip, priority; a short date is NOT a block (S2)', async ({ page }) => {
    await openRequest(page)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Who makes it, and when do they need it by?')
    await page.getByTestId('sj-department').getByRole('radio', { name: 'Creative' }).click()
    await pickJobLanguages(page)
    await expect(page.getByTestId('sj-owner')).toContainText(`${PEOPLE.lead.name} · Department lead`)
    await expect(page.getByTestId('sj-owner-load')).toContainText(/Team at \d+%/)
    // A Thursday two weeks out: the strip runs from the Sunday to the Thursday, then the weekend.
    const due = dueInTwoWeeks()
    await page.getByTestId('sj-due').fill(due)
    await expect(page.getByTestId('sj-countback')).toContainText('Maestro counted it back for you')
    await expect(page.getByTestId('sj-countback')).toContainText('Sunday to Thursday')
    await expect(page.getByTestId(`sj-day-${due}`)).toContainText('due')
    await page.getByTestId('sj-priority').getByRole('radio', { name: 'High' }).click()
    await expect(page.getByTestId('sj-priority-high')).toHaveAttribute('aria-checked', 'true')
    // S2: yesterday leaves no working days — not a block. More time returns; Continue goes on
    // tagged reduced scope, and the review says so.
    const title = `B8 short ${Date.now()}`
    await page.getByTestId('sj-title').fill(title)
    await page.getByTestId('sj-due').fill('2026-01-08')
    await page.getByTestId('sj-next').click()
    const short = page.getByTestId('sj-short-dialog')
    await expect(short).toBeVisible()
    await expect(short).toContainText('Not a block')
    await expect(page.getByTestId('sj-short-has')).toContainText('0 working days')
    await page.getByTestId('sj-short-more-time').click()
    await expect(short).toHaveCount(0)
    await page.getByTestId('sj-next').click()
    await expect(short).toBeVisible()
    await page.getByTestId('sj-short-continue').click()
    await expect(page.getByTestId('sj-review')).toBeVisible()
    await expect(page.getByTestId('sj-review-reduced-scope')).toContainText('Reduced scope')
    await expect(page.getByTestId('sj-review')).toContainText('High')
    const [draft] = await rows<{ brief: { request: { reducedScope: boolean; priority: string } } }>('campaigns', `select=brief&name=eq.${encodeURIComponent(title)}`)
    expect(draft.brief.request.reducedScope).toBe(true)
    expect(draft.brief.request.priority).toBe('high')
  })

  test('B7 — the capacity shown is for the DUE week, not this week', async ({ page }) => {
    await openRequest(page)
    await page.getByTestId('sj-department').getByRole('radio', { name: 'Creative' }).click()
    await pickJobLanguages(page)
    await expect(page.getByTestId('sj-owner-load')).toContainText(/this week/)
    await page.getByTestId('sj-due').fill(dueInTwoWeeks())
    await expect(page.getByTestId('sj-owner-load')).toContainText(/for the week it is due/)
    await expect(page.getByTestId('sj-owner-load')).not.toContainText(/this week/)
  })
})
