import { test, expect, type Browser, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { authFile, PEOPLE } from '../fixtures'
import { rows } from '../helpers/db'
import { dueInTwoWeeks, releaseSingleJob, nextToReview, pickJobLanguages } from '../helpers/single-job'
import { addTaskOnPanel, workingDayFor } from '../helpers/piece'

/**
 * Section P — the two production failures of 15 Sep (I48.38, I48.42), and what now happens instead.
 *
 * P1 (ADR-0083 addendum d.13–d.16): an account manager who is NOT the client's captures a request
 * in full — text, arrival and screenshot — under a please-wait; at Approve they are refused by a
 * sentence that NAMES the client's account manager, the job stays whole, and that manager approves.
 * P2 (I48.42): the deliverable's owner adds an UNASSIGNED task to their list; a lead of another
 * department is refused in words, not in the database's, and is not offered a report for it.
 * P3 (I48.39): an unexpected failure's dialog offers Report, and the report carries the cause.
 *
 * B2 is not configured locally: `asset-url` and the bucket are mocked, slowly, so the please-wait
 * has something to wait for.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}

const here = path.dirname(fileURLToPath(import.meta.url))
const PNG = readFileSync(path.join(here, 'dummy-receipt.png'))
const BUCKET = 'https://b2.local.test'

async function mockBucket(page: Page, delayMs = 800) {
  await page.route(`${BUCKET}/**`, async (route) => {
    if (route.request().method() === 'PUT') return route.fulfill({ status: 200, body: '' })
    return route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
  })
  await page.route('**/functions/v1/asset-url', async (route) => {
    const body = route.request().postDataJSON() as { op: string; fileName?: string; folderId?: string }
    await new Promise((r) => setTimeout(r, delayMs))
    if (body.op === 'upload') {
      // Keyed as the real function keys it — tenant / client / folder — or the database refuses the row
      // ("a stored file must be inside its own tenant", 20261002130000).
      const [f] = await rows<{ tenant_id: string; client_id: string }>('asset_folders', `select=tenant_id,client_id&id=eq.${body.folderId}`)
      const objectKey = `${f!.tenant_id}/${f!.client_id}/${body.folderId}/${Date.now()}-${body.fileName}`
      return route.fulfill({ json: { uploadUrl: `${BUCKET}/put/${objectKey}`, objectKey, provider: 'b2' } })
    }
    return route.fulfill({ json: { url: `${BUCKET}/get/x` } })
  })
}

test.describe('Section P — capture by a colleague; the owner adds a task', () => {
  test('P1 — a non-account-manager captures everything; Approve names the account manager; the account manager approves', async ({ browser }) => {
    const title = `P1 capture ${Date.now()}`
    // am2 manages Luma Retail, not Northwind — the 15 Sep production case.
    const other = await as(browser, 'am2')
    await mockBucket(other)
    await other.goto('/campaigns/new-job')
    // SJ-v3-01 (22 Sep): the client and the kind of brief come first, on their own screen.
    await other.getByTestId('sj-client').selectOption({ label: 'Northwind Beverages' })
    // The receipt is on screen 1 (22 Sep).
    await other.getByTestId('receipt-file').setInputFiles(path.join(here, 'dummy-receipt.png'))
    await expect(other.getByTestId('receipt-preview')).toBeVisible()
    await expect(other.getByTestId('receipt-reading')).toHaveCount(0, { timeout: 30_000 })
    await other.getByTestId('receipt-date').fill('2026-09-14')
    await other.getByTestId('receipt-time').fill('10:04')
    await other.getByTestId('receipt-confirm').check()
    await other.getByTestId('sj-words').fill('The programmers campaign — we need to start on it now.')
    await other.getByTestId('sj-brief-card-single_execution').click()

    // I48.41: Next WAITS, under a please-wait, until the draft exists, the evidence is filed and the
    // receipt written — on the FIRST Next since 22 Sep, where the evidence lives.
    await other.getByTestId('sj-next').click()
    await expect(other.getByTestId('sj-busy-request')).toBeVisible()
    await expect(other.getByTestId('sj-brief')).toBeVisible()
    await expect(other.getByTestId('sj-busy-request')).toHaveCount(0)
    await expect(other.getByTestId('sj-error')).toHaveCount(0)
    await other.getByTestId('sj-field-task').fill('Three social statics.')
    await other.getByTestId('sj-next').click()
    await expect(other.getByTestId('sj-request')).toBeVisible()
    await other.getByTestId('sj-title').fill(title)
    await other.getByTestId('sj-due').fill(dueInTwoWeeks())
    await other.getByTestId('sj-department').getByRole('radio', { name: 'Creative' }).click()
    await pickJobLanguages(other)
    await nextToReview(other)

    // d.13: the receipt AND its screenshot are saved, by somebody who is not the client's AM.
    const [draft] = await rows<{ id: string; account_manager_id: string | null }>('campaigns', `select=id,account_manager_id&name=eq.${encodeURIComponent(title)}`)
    const [receipt] = await rows<{ asset_id: string | null; received_at: string }>('campaign_brief_receipts', `select=asset_id,received_at&campaign_id=eq.${draft.id}`)
    expect(receipt.received_at).toContain('2026-09-14')
    expect(receipt.asset_id).not.toBeNull()
    const [asset] = await rows<{ object_key: string | null }>('assets', `select=object_key&id=eq.${receipt.asset_id}`)
    expect(asset.object_key).toBeTruthy()

    // Approve: refused, NAMING the account manager (d.15). Not reportable.
    await other.getByTestId('sj-approve').click()
    // The duplicate check runs BEFORE the approval (ADR-0085 d.3): earlier runs left lookalikes.
    const lookalike = other.getByTestId('sj-similar-dialog')
    const refusal = other.getByTestId('sj-error')
    const first = await Promise.race([
      lookalike.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'prompt' as const),
      refusal.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'refused' as const),
    ])
    if (first === 'prompt') await other.getByTestId('sj-similar-separate').click()
    await expect(refusal).toBeVisible({ timeout: 30_000 })
    await expect(refusal).toContainText(PEOPLE.am.name)
    await expect(refusal).toContainText(/saved for them/i)
    await expect(other.getByTestId('sj-error-report')).toHaveCount(0)
    await other.context().close()

    // d.16: the job is whole for the account manager — they resume it and approve.
    const [still] = await rows<{ status: string }>('campaigns', `select=status&id=eq.${draft.id}`)
    expect(still.status).not.toBe('approved')
    const am = await as(browser, 'am')
    await am.goto(`/campaigns/new-job?job=${draft.id}`)
    await expect(am.getByTestId('sj-review')).toBeVisible()
    await expect(am.getByTestId('sj-clock')).toBeVisible()
    await am.getByTestId('sj-approve').click()
    const prompt = am.getByTestId('sj-similar-dialog')
    const outcome = await Promise.race([
      prompt.waitFor({ state: 'visible', timeout: 10_000 }).then(() => 'prompt' as const),
      am.waitForURL(/\/campaigns\/[0-9a-f-]{36}$/, { timeout: 30_000 }).then(() => 'released' as const),
    ])
    if (outcome === 'prompt') await am.getByTestId('sj-similar-separate').click()
    await expect(am).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/, { timeout: 30_000 })
    const [done] = await rows<{ status: string }>('campaigns', `select=status&id=eq.${draft.id}`)
    expect(done.status).toBe('approved')
    await am.context().close()
  })

  test('P2 — the owner adds an unassigned task to their list; another department is refused in words, with no report', async ({ browser }) => {
    const am = await as(browser, 'am')
    const job = await releaseSingleJob(am, { title: `P2 owner ${Date.now()}`, department: 'Creative', type: 'Social Advertisement' })
    await am.context().close()

    // The Creative lead owns it (ADR-0083 d.11) and adds a task with nobody on it yet — on the piece's panel since
    // ADR-0132 d.8 (I71.1): `/deliverables?open=` forwards there. The helper proves one row, unassigned.
    const lead = await as(browser, 'lead')
    await addTaskOnPanel(lead, job, 'Write the rationale', await workingDayFor(PEOPLE.lead.email, 3))
    await expect(lead.getByTestId('campaign-banner-dialog')).toHaveCount(0)
    const [dept] = await rows<{ id: string }>('departments', `select=id&name=eq.Creative`)
    const [added] = await rows<{ department_id: string | null }>('sub_tasks', `select=department_id&deliverable_id=eq.${job.deliverableId}&title=eq.${encodeURIComponent('Write the rationale')}`)
    expect(added.department_id).toBe(dept.id)
    await lead.context().close()

    // The Content lead has the grant but not the reach: refused in a sentence, not the database's,
    // and NOT offered Report — it is an answer, not a failure (I48.42, ADR-0092 d.3).
    // ADR-0132 d.8 (I71.1): the add is on the piece's panel; its answer is the campaign page's notice.
    const content = await as(browser, 'content')
    await content.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
    await expect(content.getByTestId('piece-panel')).toBeVisible({ timeout: 20_000 })
    await content.getByTestId('piece-panel-tasks-add').click()
    await content.getByTestId('piece-panel-tasks-add-name').fill('Not mine')
    await content.getByTestId('piece-panel-tasks-add-save').click()
    const banner = content.getByTestId('campaign-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText(/outside your reach/i)
    await expect(banner).not.toContainText(/row-level security/i)
    await expect(content.getByTestId('campaign-banner-report')).toHaveCount(0)
    expect(await rows('sub_tasks', `select=id&deliverable_id=eq.${job.deliverableId}&title=eq.${encodeURIComponent('Not mine')}`)).toHaveLength(0)
    await content.context().close()
  })

  test('P3 — an unexpected failure offers Report, and the report carries the cause', async ({ browser }) => {
    const am = await as(browser, 'am')
    const job = await releaseSingleJob(am, { title: `P3 report ${Date.now()}`, department: 'Creative', type: 'Social Advertisement' })
    await am.context().close()

    const lead = await as(browser, 'lead')
    // Break the write on the wire: the RPC answers 500 with a body PostgREST would never send.
    await lead.route('**/rest/v1/rpc/save_sub_task', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'disk full', details: 'pg_wal', hint: null }) }),
    )
    let reported: Record<string, unknown> | null = null
    await lead.route('**/functions/v1/report-error', (route) => {
      reported = route.request().postDataJSON() as Record<string, unknown>
      return route.fulfill({ json: { sent: 1 } })
    })
    // ADR-0132 d.8 (I71.1): the add is on the piece's panel (`save_sub_task`, stubbed above); the notice is the campaign page's.
    await lead.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
    await expect(lead.getByTestId('piece-panel')).toBeVisible({ timeout: 20_000 })
    await lead.getByTestId('piece-panel-tasks-add').click()
    await lead.getByTestId('piece-panel-tasks-add-name').fill('Will not save')
    await lead.getByTestId('piece-panel-tasks-add-save').click()
    const banner = lead.getByTestId('campaign-banner')
    await expect(banner).toBeVisible()
    await expect(banner).not.toContainText(/disk full/)
    await lead.getByTestId('campaign-banner-report').click()
    await expect(lead.getByTestId('campaign-banner-report-done')).toBeVisible()
    expect(reported).not.toBeNull()
    expect(reported!.where).toBe('Campaign')
    expect(reported!.code).toBe('XX000')
    expect(String(reported!.cause)).toContain('disk full')
    expect(String(reported!.cause)).toContain('pg_wal')
    await lead.context().close()
  })
})
