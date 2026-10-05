import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { authFile } from '../fixtures'
import { nextToReview, pickJobLanguages } from '../helpers/single-job'

/**
 * docs/RETEST-REDESIGN.md — C: Single job, the brief (SJ-03, ADR-0084).
 *
 * `ingest-brief` is a model call: it is MOCKED at the network edge with a 500 ms delay so the
 * blocking "Reading the document…" modal is observable and the run does not depend on OpenAI.
 * Everything downstream of the response — the Keep markers, the review gate — is the real app.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const RECEIPT = path.join(here, 'dummy-receipt.png')

function dueInTwoWeeks(): string {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + 14 + ((7 - d.getUTCDay()) % 7))
  return d.toISOString().slice(0, 10)
}

async function toBrief(page: Page) {
  await page.goto('/campaigns/new-job')
  // SJ-v3-01 (22 Sep): the client and the kind of brief come first, on their own screen.
  await page.getByTestId('sj-client').selectOption({ label: 'Northwind Beverages' })
  await page.getByTestId('sj-words').fill('Three social statics for the summer range.')
  await page.getByTestId('sj-brief-card-single_execution').click()
  await page.getByTestId('sj-next').click()
  await expect(page.getByTestId('sj-brief')).toBeVisible()
}

/** From the brief on to who and when and the review — the title is typed there. */
async function briefToReview(page: Page, stem: string) {
  await page.getByTestId('sj-next').click()
  await expect(page.getByTestId('sj-request')).toBeVisible()
  await page.getByTestId('sj-title').fill(`${stem} ${Date.now()}`)
  await page.getByTestId('sj-due').fill(dueInTwoWeeks())
  await page.getByTestId('sj-department').getByRole('radio', { name: 'Creative' }).click()
  await pickJobLanguages(page)
  await nextToReview(page)
}

/** Mock the model: two fields filled, after a delay long enough to see the modal. */
async function mockIngest(page: Page, fields: Record<string, string>, delayMs = 500) {
  await page.route('**/functions/v1/ingest-brief', async (route) => {
    await new Promise((r) => setTimeout(r, delayMs))
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ fields, oversized: [] }) })
  })
}

async function pasteAndRun(page: Page, text: string) {
  await page.getByTestId('brief-ingest-toggle-mode').click()
  await page.getByTestId('brief-ingest-paste').fill(text)
  await page.getByTestId('brief-ingest-run').click()
}

test.describe('Section C — single job: the brief', () => {
  test.use({ storageState: authFile('am') })

  test('C1 — the single_execution fields, empty, with guidance', async ({ page }) => {
    await toBrief(page)
    for (const key of ['deliverableType', 'task', 'reference', 'specs', 'copy', 'restrictions']) {
      const field = page.getByTestId(`sj-field-${key}`)
      await expect(field).toBeVisible()
      await expect(field).toHaveValue('')
    }
    await expect(page.getByTestId('brief-ingest-intro')).toBeVisible()
    await expect(page.getByTestId('sj-brief-words')).toContainText('Three social statics')
    // SJ-v3-02 (22 Sep): the page is titled after the template; the rail names its four parts and
    // counts what is filled; the first four fields are the essentials, the rest follow.
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Execution Brief')
    await expect(page.getByTestId('sj-brief-essentials')).toContainText('Deliverable Type')
    await expect(page.getByTestId('sj-brief-rest')).toContainText('Restrictions')
    await expect(page.getByTestId('sj-brief-nav-essentials')).toContainText('0 of 4')
    await page.getByTestId('sj-field-task').fill('Design three social statics.')
    await expect(page.getByTestId('sj-brief-nav-essentials')).toContainText('1 of 4')
    await page.getByTestId('sj-brief-nav-rest').click()
    await expect(page.getByTestId('sj-brief-rest')).toBeInViewport()
    await page.getByTestId('sj-brief-nav-rules').click()
    await expect(page.getByTestId('sj-brief-rules')).toContainText(/no dos and don’ts on its profile|Inherited · [1-9]/)
    await page.getByTestId('sj-brief-nav-attachments').click()
    await expect(page.getByTestId('sj-attachments')).toBeInViewport()
    await page.getByTestId('sj-brief-nav-essentials').click()
    await expect(page.getByTestId('sj-brief-essentials')).toBeInViewport()
    // "Autosaved": the brief is written while it is typed, and the page says so.
    await expect(page.getByTestId('sj-brief-save-state')).toContainText('Saved', { timeout: 5_000 })
  })

  test('C2 — ingesting shows a blocking "Reading the document…" modal, then says what it filled', async ({ page }) => {
    await mockIngest(page, { task: 'Design three social statics.', specs: '1080×1350, Arabic first.' })
    await toBrief(page)
    await pasteAndRun(page, 'Please design three social statics, 1080x1350, Arabic first.')

    await expect(page.getByTestId('brief-ingest-busy')).toBeVisible()
    await expect(page.getByTestId('brief-ingest-busy')).toHaveCount(0, { timeout: 15_000 })

    const status = page.getByTestId('brief-ingest-status')
    await expect(status).toContainText('Filled 2 fields from the brief')
    await expect(status).toContainText('Keep')
    await expect(page.getByTestId('sj-field-task')).toHaveValue('Design three social statics.')
    await expect(page.getByTestId('sj-field-specs')).toHaveValue('1080×1350, Arabic first.')
  })

  test('C3 — machine-filled fields carry Keep; Next → review is refused until each is kept', async ({ page }) => {
    await mockIngest(page, { task: 'Design three social statics.', copy: 'Cold before you get there.' })
    await toBrief(page)
    await pasteAndRun(page, 'Brief text.')
    await expect(page.getByTestId('brief-ingest-busy')).toHaveCount(0, { timeout: 15_000 })

    await expect(page.getByTestId('sj-filled-mark-task')).toBeVisible()
    await expect(page.getByTestId('sj-filled-mark-copy')).toBeVisible()
    await expect(page.getByTestId('sj-unreviewed')).toContainText('2')

    // Next with both unconfirmed → the modal, not a silently disabled button.
    await page.getByTestId('sj-next').click()
    const blocked = page.getByTestId('sj-review-blocked')
    await expect(blocked).toBeVisible()
    await expect(blocked).toContainText(/All brief fields must be confirmed by clicking .Keep./)
    await page.getByTestId('sj-review-blocked-close').click()
    await expect(blocked).toHaveCount(0)

    // Keep one, edit the other (an edit confirms it too), then Next advances.
    await page.getByTestId('sj-filled-keep-task').click()
    await expect(page.getByTestId('sj-filled-mark-task')).toHaveCount(0)
    await page.getByTestId('sj-field-copy').fill('Cold before you get there — every frame.')
    await expect(page.getByTestId('sj-unreviewed')).toHaveCount(0)
    await briefToReview(page, 'C to review')
  })

  test('C4 — "what could stop this" is optional; The Task is the only mandatory field', async ({ page }) => {
    await toBrief(page)
    await page.getByTestId('sj-next').click()
    const err = page.getByTestId('sj-error')
    await expect(err).toBeVisible()
    await expect(err).toContainText('“The Task” is the one field this brief cannot go without')
    await page.getByTestId('sj-error-close').click()

    await page.getByTestId('sj-field-task').fill('Design three social statics.')
    await expect(page.getByTestId('sj-risk')).toHaveValue('')
    await briefToReview(page, 'C to review')
  })

  test('C5 — an attachment files into the job\'s References folder (or says plainly that it could not)', async ({ page }) => {
    await toBrief(page)
    const panel = page.getByTestId('sj-attachments')
    await expect(panel).toBeVisible()
    await page.getByTestId('sj-attachments-input').setInputFiles(RECEIPT)
    // With B2 configured the file is listed as filed; without it (this machine) the failure is
    // SAID (ADR-0092 d.5) and the job still proceeds — never a silent nothing.
    const filed = page.getByTestId('sj-attachments-filed')
    const failed = page.getByTestId('sj-attachments-failed')
    await expect(filed.or(failed)).toBeVisible({ timeout: 20_000 })
    if (await failed.isVisible()) await expect(failed).toContainText(/could not be filed|permission/i)
    await page.getByTestId('sj-field-task').fill('Design three social statics.')
    await briefToReview(page, 'C to review')
  })
})
