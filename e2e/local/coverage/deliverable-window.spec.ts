import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows } from '../helpers/db'
import { releaseSingleJob } from '../helpers/single-job'

/**
 * I66.13 (Edward, 29 Sep) — the link a Needs-you card opens (`/deliverables?open=`) offers what the card asks for:
 * the task list's approval, and "Close this deliverable" (asked first, then the piece is archived).
 *
 * Since ADR-0132 d.8 (30 Sep) that link forwards a campaign piece — a single job is one — to its campaign page with
 * the piece's panel open, and the panel carries both (I71.1). The link is still the one followed here.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}

test('the link a card opens offers the task-list approval and Close, and Close closes it', async ({ browser }) => {
  test.setTimeout(120_000)
  const am = await as(browser, 'am')
  const job = await releaseSingleJob(am, { title: `Cov window ${Date.now()}`, department: 'Creative', type: 'Social Advertisement' })
  await am.context().close()

  const lead = await as(browser, 'lead')
  await lead.goto(`/deliverables?open=${job.deliverableId}`)
  await expect(lead).toHaveURL(new RegExp(`/campaigns/${job.campaignId}\\?.*piece=${job.deliverableId}`), { timeout: 20_000 })
  await expect(lead.getByTestId('piece-panel')).toBeVisible()
  await expect(lead.getByTestId('piece-panel-tasks-approve')).toBeVisible()
  await lead.getByTestId('piece-panel-close-piece').click()
  await expect(lead.getByTestId('piece-panel-close-confirm-dialog')).toBeVisible()
  await lead.getByTestId('piece-panel-close-confirm-confirm').click()
  await expect
    .poll(async () => (await rows<{ state: string }>('deliverables', `select=state&id=eq.${job.deliverableId}`))[0]!.state, { timeout: 20_000 })
    .toBe('archived')
  await lead.context().close()
})
