import { test, expect, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows, waitForNotification } from '../helpers/db'
import { nextToReview, pickJobLanguages } from '../helpers/single-job'

/**
 * docs/RETEST-REDESIGN.md — D: Single job, review & release (SJ-04, ADR-0085).
 * Runs as the Account Manager against Creative (lead = Dev Dept Lead, the owner).
 */
function dueInTwoWeeks(): string {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + 14 + ((7 - d.getUTCDay()) % 7))
  return d.toISOString().slice(0, 10)
}

async function toReview(page: Page, title: string) {
  await page.goto('/campaigns/new-job')
  // SJ-v3-01 (22 Sep): the client and the kind of brief come first, on their own screen.
  await page.getByTestId('sj-client').selectOption({ label: 'Northwind Beverages' })
  await page.getByTestId('sj-asked-by').fill('Layla Hassan')
  await page.getByTestId('sj-words').fill('We need a thing, quickly, for the summer range.')
  await page.getByTestId('sj-brief-card-single_execution').click()
  await page.getByTestId('sj-next').click()
  await expect(page.getByTestId('sj-brief')).toBeVisible()
  await page.getByTestId('sj-field-task').fill('Design three social statics for the summer range.')
  await page.getByTestId('sj-next').click()
  await expect(page.getByTestId('sj-request')).toBeVisible()
  await page.getByTestId('sj-title').fill(title)
  await page.getByTestId('sj-due').fill(dueInTwoWeeks())
  await page.getByTestId('sj-department').getByRole('radio', { name: 'Creative' }).click()
  await pickJobLanguages(page)
  await nextToReview(page)
}

test.describe('Section D — single job: review & release', () => {
  test.use({ storageState: authFile('am') })

  test('D1 — the review shows the request, the brief, and where it lands', async ({ page }) => {
    const title = `D1 review ${Date.now()}`
    await toReview(page, title)
    await expect(page.getByTestId('sj-review-title')).toHaveText(title)
    await expect(page.getByTestId('sj-review-words')).toContainText('We need a thing, quickly')
    await expect(page.getByTestId('sj-review-came-in')).toContainText('Layla Hassan')
    // The Figma's cards: the deliverable in the hue, how it came in, the brief; this goes to, rules, attached.
    await expect(page.getByTestId('sj-review-request')).toContainText('1 deliverable')
    await expect(page.getByTestId('sj-review-rules')).toContainText('Locked')
    await expect(page.getByTestId('sj-review-attached')).toBeVisible()
    await expect(page.getByTestId('sj-review-field-task')).toHaveText('Design three social statics for the summer range.')
    await expect(page.getByTestId('sj-review-destination')).toBeVisible()
    await expect(page.getByTestId('sj-review-where')).toContainText('Creative')
    await expect(page.getByTestId('sj-review-where')).toContainText(PEOPLE.lead.name)
    // Both halves can be sent back to.
    await expect(page.getByTestId('sj-review-edit-request')).toBeVisible()
    await expect(page.getByTestId('sj-review-edit-brief')).toBeVisible()
  })

  test('D2/D3 — Approve releases in one press: released, approved, brief approved with it, owner notified', async ({ page }) => {
    const title = `D2 release ${Date.now()}`
    await toReview(page, title)
    // The release is held for a moment on its way back (the real call, answered late), so the
    // blocking modal is on screen long enough to be seen: on a fresh database the release answers
    // in a few milliseconds and the modal came and went between two checks. As L2 does.
    await page.route('**/rest/v1/rpc/approve_campaign*', async (route) => {
      const response = await route.fetch()
      await new Promise((r) => setTimeout(r, 900))
      await route.fulfill({ response })
    })
    await page.getByTestId('sj-approve').click()

    // A long-lived local database holds lookalikes by now (E1): "keep it separate" when asked.
    const prompt = page.getByTestId('sj-similar-dialog')
    const busy = page.getByTestId('sj-busy-release')
    const first = await Promise.race([
      prompt.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'prompt' as const),
      busy.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'busy' as const),
    ])
    if (first === 'prompt') await page.getByTestId('sj-similar-separate').click()
    // The blocking modal, then the campaign page.
    await expect(busy).toBeVisible()
    await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/, { timeout: 30_000 })
    await expect(page.getByTestId('campaign-tabs')).toBeVisible()

    // The row: a single job, approved, with one stream, one deliverable owned by the lead.
    const [job] = await rows<{ id: string; status: string; kind: string; approved_at: string | null }>(
      'campaigns',
      `select=id,status,kind,approved_at&name=eq.${encodeURIComponent(title)}`,
    )
    expect(job.kind).toBe('single_job')
    expect(job.status).toBe('approved')
    expect(job.approved_at).toBeTruthy()
    const dels = await rows<{ id: string; owner_user_id: string; state: string }>(
      'deliverables',
      `select=id,owner_user_id,state,streams!inner(campaign_id)&streams.campaign_id=eq.${job.id}`,
    )
    expect(dels).toHaveLength(1)
    const [lead] = await rows<{ id: string }>('user_profiles', `select=id&email=eq.${encodeURIComponent(PEOPLE.lead.email)}`)
    expect(dels[0].owner_user_id).toBe(lead.id)

    // D3 — the single-execution brief is approved with the job; the department writes no second one.
    const briefs = await rows<{ brief_type: string; approved_at: string | null }>(
      'campaign_briefs',
      `select=brief_type,approved_at&campaign_id=eq.${job.id}`,
    )
    expect(briefs).toHaveLength(1)
    expect(briefs[0].brief_type).toBe('single_execution')
    expect(briefs[0].approved_at).toBeTruthy()

    // The owner is told once, on the JOB (I53.19, 21 Sep — one row per owner; the job's page
    // points at its deliverable).
    const notif = await waitForNotification(PEOPLE.lead.email, 'campaign_approved', 8_000, job.id)
    expect(notif.entity_type).toBe('campaign')
    expect(notif.entity_id).toBe(job.id)
  })

  test('D4 — Cancel leaves the job under Drafts and says so', async ({ page }) => {
    const title = `D4 cancel ${Date.now()}`
    await toReview(page, title)
    await page.getByTestId('sj-cancel').click()
    const confirm = page.getByTestId('sj-cancel-dialog')
    await expect(confirm).toBeVisible()
    await expect(confirm).toContainText(/draft/i)
    await page.getByTestId('sj-cancel-confirm').click()
    await expect(page).toHaveURL(/\/campaigns\/?$/)

    const [draft] = await rows<{ id: string; status: string }>('campaigns', `select=id,status&name=eq.${encodeURIComponent(title)}`)
    expect(draft.status).toBe('draft')
    await expect(page.getByTestId(`campaign-draft-row-${draft.id}`)).toBeVisible()
    await expect(page.getByTestId(`campaign-draft-resume-${draft.id}`)).toBeVisible()
  })
})
