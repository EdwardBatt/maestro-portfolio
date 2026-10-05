import { test, expect, type Browser, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { authFile, PEOPLE } from '../fixtures'
import { rows, userIdOf } from '../helpers/db'
import { releaseSingleJob, type ReleasedJob } from '../helpers/single-job'
import { addTaskOnPanel, approveTaskList, assignOnSchedule, workingDayFor } from '../helpers/piece'

/**
 * Coverage — the rules beside the file on the review screen (I59.29 / ADR-0112 d.1, Q26b) and the
 * notification sound switch by the bell (I59.28 / ADR-0113 d.4, Q19).
 *
 * Rules: Traffic registers a client with one DO and one DON'T; the AM releases a single job for it
 * (the rules are snapshotted into the brief); the department lead approves the task list and adds a
 * digital task for the deputy with himself as reviewer; the deputy uploads and sends it; the lead
 * opens the task's review and reads both rules beside the file — as lines, with nothing to tick.
 * The "may not": Traffic, who is not its reviewer, opens the same review read-only and still reads
 * the rules (shown to whoever reviews against them), with no comment box.
 *
 * The pin controls (Mark done / Undo / Reply / Re-open) are NOT pressed here: no surface passes
 * `pinActions` until the task page is built (I59.11), so they sit in e2e/coverage-baseline.json with
 * that reason.
 *
 * B2 is mocked exactly as review-and-my-work.spec.ts does it.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}
const here = path.dirname(fileURLToPath(import.meta.url))
const PNG = readFileSync(path.join(here, '..', 'retest-redesign', 'dummy-artwork.png'))
const BUCKET = 'https://b2.local.test'
async function mockBucket(page: Page) {
  await page.route(`${BUCKET}/**`, async (route) => {
    if (route.request().method() === 'PUT') return route.fulfill({ status: 200, body: '' })
    return route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
  })
  await page.route('**/functions/v1/review-media', async (route) => {
    const body = route.request().postDataJSON() as { op: string; fileName?: string; mediaRecordId?: string }
    if (body.op === 'upload') {
      const objectKey = `e2e/${Date.now()}-${body.fileName}`
      return route.fulfill({ json: { uploadUrl: `${BUCKET}/put/${objectKey}`, objectKey } })
    }
    return route.fulfill({ json: { viewUrl: `${BUCKET}/get/${body.mediaRecordId}`, downloadUrl: `${BUCKET}/get/${body.mediaRecordId}?dl=1` } })
  })
}

const stamp = Date.now()
const CLIENT = `Cov rules client ${stamp}`
const DO_RULE = `Logo top right ${stamp}`
const DONT_RULE = `Never red on the pack ${stamp}`

test.describe('Coverage — rules beside the file, the sound switch', () => {
  test('the sound switch: on by default, off is remembered on this device, on again', async ({ browser }) => {
    const page = await as(browser, 'deputy')
    await page.goto('/my-work')
    const sw = page.getByTestId('notif-chime-switch')
    await expect(sw).toHaveAttribute('role', 'switch')
    // A fresh context has nothing stored: on.
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(await page.evaluate(() => localStorage.getItem('maestro.notificationChime'))).toBe('off')
    await page.reload()
    await expect(page.getByTestId('notif-chime-switch')).toHaveAttribute('aria-checked', 'false')
    await page.getByTestId('notif-chime-switch').click()
    await expect(page.getByTestId('notif-chime-switch')).toHaveAttribute('aria-checked', 'true')
    expect(await page.evaluate(() => localStorage.getItem('maestro.notificationChime'))).toBe('on')
    await page.context().close()
  })

  test('the reviewer reads the piece’s rules beside the file; somebody who is not its reviewer reads them read-only', async ({ browser }) => {
    test.setTimeout(240_000)
    // 1. A client with one DO and one DON'T, registered and activated by the account director (ADR-0123 d.1 —
    //    only the director activates; a job can be raised only for an active client).
    const ad = await as(browser, 'ad')
    await ad.goto('/clients/new')
    await ad.getByTestId('client-name').fill(CLIENT)
    await ad.getByTestId('client-country').selectOption('IQ')
    await ad.getByTestId('client-am').selectOption(await userIdOf(PEOPLE.am.email))
    await ad.getByTestId('client-next').click()
    await expect(ad).toHaveURL(/\/clients\/[0-9a-f-]{36}\/register\?step=2/)
    const clientId = ad.url().match(/\/clients\/([0-9a-f-]{36})\//)![1]
    await ad.goto(`/clients/${clientId}/register?step=4`)
    await ad.getByTestId('client-rule-new-kind-do').click()
    await ad.getByTestId('client-rule-new-text').fill(DO_RULE)
    await ad.getByTestId('client-rule-add').click()
    await expect(ad.getByTestId('client-rule-0')).toContainText(DO_RULE)
    await ad.getByTestId('client-rule-new-kind-dont').click()
    await ad.getByTestId('client-rule-new-text').fill(DONT_RULE)
    await ad.getByTestId('client-rule-add').click()
    await expect(ad.getByTestId('client-rule-1')).toContainText(DONT_RULE)
    await ad.goto(`/clients/${clientId}/register?step=6`)
    await ad.getByTestId('client-activate').click()
    await expect(ad).toHaveURL(new RegExp(`/clients/${clientId}$`))
    await ad.context().close()

    // 2. A released single job for it — the rules are snapshotted into the brief.
    const am = await as(browser, 'am')
    const job: ReleasedJob = await releaseSingleJob(am, { title: `Cov rules ${stamp}`, department: 'Creative', client: CLIENT })
    await am.context().close()

    // 3. The lead approves the list and adds a digital task for the deputy, reviewed by himself — since ADR-0132
    //    (I71.1) on the piece's panel, and given to the deputy on the Schedule. The job has no type, so its list is
    //    empty and the panel offers no approval until it holds a task: added first, then approved (ADR-0132 d.4 —
    //    a list never approved waits for its owner, whoever added to it).
    const lead = await as(browser, 'lead')
    const on = await workingDayFor(PEOPLE.deputy.email, 3)
    const added = await addTaskOnPanel(lead, job, 'Cov rules digital', on)
    await approveTaskList(lead, job)
    // E11 (I59): assigned only with its hours.
    await assignOnSchedule(lead, job, { taskId: added, assignee: PEOPLE.deputy.email, reviewer: PEOPLE.lead.email, day: on, hours: 4, reviewMode: 'digital' })
    await lead.context().close()
    const [task] = await rows<{ id: string }>('sub_tasks', `select=id&deliverable_id=eq.${job.deliverableId}&title=eq.${encodeURIComponent('Cov rules digital')}`)
    expect(task).toBeTruthy()

    // 4. The deputy starts it, uploads a file and sends it.
    const maker = await as(browser, 'deputy')
    await mockBucket(maker)
    await maker.goto('/my-work')
    await maker.getByTestId(`my-work-start-${task!.id}`).click()
    // I59.11: this round's upload and Send are on the task's own page (the Submit dialog is retired).
    await maker.getByTestId(`my-work-open-${task!.id}`).click()
    await expect(maker.getByTestId('task-page-file')).toBeVisible()
    const chooser = maker.waitForEvent('filechooser')
    await maker.getByTestId('task-page-file').getByTestId('review-upload').click()
    await (await chooser).setFiles({ name: 'final.png', mimeType: 'image/png', buffer: PNG })
    await expect.poll(async () => (await rows('media_records', `select=id&sub_task_id=eq.${task!.id}`)).length).toBe(1)
    await maker.getByTestId(`my-work-submit-${task!.id}`).click()
    // ADR-0106 (I59.20): sent a minute after Start, the round is untimed — warned first; Send anyway.
    await expect(maker.getByTestId('untimed-dialog')).toBeVisible()
    await maker.getByTestId('untimed-send').click()
    await expect.poll(async () => (await rows<{ status: string }>('sub_tasks', `select=status&id=eq.${task!.id}`))[0]?.status).toBe('review')
    await maker.context().close()

    // 5. The reviewer: both rules, beside the file, as lines — nothing to tick. The task's row (and its review) is on
    //    the task's page since ADR-0132 d.8 retired the deliverable window (I71.1).
    const reviewer = await as(browser, 'lead')
    await mockBucket(reviewer)
    await reviewer.goto(`/my-work/task/${task!.id}`)
    await reviewer.getByTestId(`subtask-review-open-${task!.id}`).click()
    const modal = reviewer.getByTestId(`subtask-review-modal-${task!.id}`)
    await expect(modal.getByTestId('review-img')).toBeVisible({ timeout: 15_000 })
    const rules = modal.getByTestId('review-comments').getByTestId('review-rules')
    await expect(rules).toContainText(DO_RULE)
    await expect(rules).toContainText(DONT_RULE)
    await expect(rules.getByRole('checkbox')).toHaveCount(0)
    await expect(rules.getByRole('button')).toHaveCount(0)
    await reviewer.getByTestId(`subtask-review-close-${task!.id}`).click()
    await reviewer.context().close()

    // 6. Not its reviewer (Traffic): read-only, no comment box — the rules still beside the file.
    const ro = await as(browser, 'traffic')
    await mockBucket(ro)
    await ro.goto(`/my-work/task/${task!.id}`)
    await ro.getByTestId(`subtask-review-open-${task!.id}`).click()
    const roModal = ro.getByTestId(`subtask-review-modal-${task!.id}`)
    await expect(roModal.getByTestId('review-download-inline')).toBeVisible({ timeout: 15_000 })
    await expect(roModal.getByTestId('comment-submit')).toHaveCount(0)
    await expect(roModal.getByTestId('review-rules')).toContainText(DONT_RULE)
    await ro.getByTestId(`subtask-review-close-${task!.id}`).click()
    await ro.context().close()
  })
})
