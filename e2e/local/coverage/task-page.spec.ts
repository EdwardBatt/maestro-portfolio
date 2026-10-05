import { test, expect, type Browser, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { authFile, PEOPLE } from '../fixtures'
import { rows } from '../helpers/db'
import { releaseSingleJob, type ReleasedJob } from '../helpers/single-job'
import { addTaskOnPanel, approveTaskList, assignOnSchedule, workingDayFor } from '../helpers/piece'

/**
 * Coverage — the task page (ADR-0105 d.3, I59.11, Figma M2 / M4): `/my-work/task/:taskId`.
 *
 * The four pop-ups My Work's rows opened are gone; this proves their functions here, pressed by the
 * assignee (who may) and absent for somebody else who opens the link (who may not):
 * Your file (upload this round) → Send for review; the reviewer sends it back with a pin; the page
 * turns into M4 — the previous version, To fix, earlier rounds folded, Upload V2, Send V2 back;
 * Ask for more time at the foot; the reference files with Download and Download all; Open in
 * Deliverables for whoever manages tasks; back to My Work. On M4 the maker answers the pin (I59.29,
 * placed by Track 11): Reply (Cancel first), Mark done, Undo, done again — the To-fix list follows —
 * and the reviewer re-opens it from the review once V2 is back.
 *
 * B2 is mocked, as in review-and-my-work.spec.ts. The DEPUTY is the maker (see that file for why).
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
    // A real download link is signed with `response-content-disposition: attachment`
    // (supabase/functions/asset-url), so the browser saves the file and the page stays where it is.
    // Served without it, a click on Download NAVIGATES the tab to the image — not what production does.
    if (new URL(route.request().url()).searchParams.get('dl') === '1') {
      return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'content-disposition': 'attachment; filename="file.png"' }, body: PNG })
    }
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
  await page.route('**/functions/v1/asset-url', async (route) => {
    const body = route.request().postDataJSON() as { op: string; fileName?: string; assetId?: string; folderId?: string }
    if (body.op === 'upload') {
      // Keyed as the real function keys it — tenant / client / folder — or the database refuses the row
      // ("a stored file must be inside its own tenant", 20261002130000).
      const [f] = await rows<{ tenant_id: string; client_id: string }>('asset_folders', `select=tenant_id,client_id&id=eq.${body.folderId}`)
      const objectKey = `${f!.tenant_id}/${f!.client_id}/${body.folderId}/${Date.now()}-${body.fileName}`
      return route.fulfill({ json: { uploadUrl: `${BUCKET}/put/${objectKey}`, objectKey, provider: 'b2' } })
    }
    return route.fulfill({ json: { downloadUrl: `${BUCKET}/get/${body.assetId}?dl=1` } })
  })
}
type Task = { id: string; title: string; status: string }
const tasksOf = (d: string) => rows<Task>('sub_tasks', `select=id,title,status&deliverable_id=eq.${d}&order=sort_order.asc`)
const statusOf = async (id: string) => (await rows<{ status: string }>('sub_tasks', `select=status&id=eq.${id}`))[0]?.status
const versionsOf = (d: string, t: string) =>
  rows<{ id: string; round: number; version: number }>('media_records', `select=id,round,version&deliverable_id=eq.${d}&sub_task_id=eq.${t}&order=version.asc`)

let job: ReleasedJob
let task: Task

test.describe('Coverage — the task page (I59.11)', () => {
  test.beforeAll(async ({ browser }) => {
    const am = await as(browser, 'am')
    job = await releaseSingleJob(am, { title: `Cov task page ${Date.now()}`, department: 'Creative', type: 'Social Advertisement' })
    await am.context().close()
    // Since ADR-0132 (I71.1): approved and added on the piece's panel, given to the deputy on the Schedule.
    const lead = await as(browser, 'lead')
    await approveTaskList(lead, job)
    const on = await workingDayFor(PEOPLE.deputy.email, 3)
    const added = await addTaskOnPanel(lead, job, 'Cov page digital', on)
    // E11 (I59): assigned only with its hours.
    await assignOnSchedule(lead, job, { taskId: added, assignee: PEOPLE.deputy.email, reviewer: PEOPLE.lead.email, day: on, hours: 4, reviewMode: 'digital' })
    await lead.context().close()
    task = (await tasksOf(job.deliverableId)).find((t) => t.title === 'Cov page digital')!
  })

  test('M2: the header and the parts; Start; upload this round; Send for review — and read only for somebody else', async ({ browser }) => {
    const maker = await as(browser, 'deputy')
    await mockBucket(maker)
    await maker.goto(`/my-work/task/${task.id}`)
    await expect(maker.getByTestId('task-page-title')).toContainText('Cov page digital')
    await expect(maker.getByTestId('task-page-status')).toHaveAttribute('data-status', 'todo')
    await expect(maker.getByTestId('task-page-people')).toContainText(PEOPLE.lead.name)
    await expect(maker.getByTestId('task-page-step-todo')).toHaveAttribute('data-current', 'true')
    await expect(maker.getByTestId('task-page-brief')).toBeVisible()
    await expect(maker.getByTestId('task-page-attached')).toBeVisible()
    await expect(maker.getByTestId(`my-work-submit-${task.id}`)).toHaveCount(0) // not started: no Send

    await maker.getByTestId(`my-work-start-${task.id}`).click()
    await expect.poll(() => statusOf(task.id)).toBe('in_progress')
    await expect(maker.getByTestId('task-page-step-in_progress')).toHaveAttribute('data-current', 'true')
    await expect(maker.getByTestId('task-page-timer')).toBeVisible()
    await expect(maker.getByTestId(`my-work-submit-needs-file-${task.id}`)).toBeVisible()
    await expect(maker.getByTestId(`my-work-submit-${task.id}`)).toBeDisabled()

    const chooser = maker.waitForEvent('filechooser')
    await maker.getByTestId('task-page-file').getByTestId('review-upload').click()
    await (await chooser).setFiles({ name: 'v1.png', mimeType: 'image/png', buffer: PNG })
    await expect.poll(async () => (await versionsOf(job.deliverableId, task.id)).length).toBe(1)
    await expect(maker.getByTestId(`my-work-submit-needs-file-${task.id}`)).toHaveCount(0)
    await maker.context().close()

    // Somebody else who opens the link reads it: no Start, no Send, no upload, no ask. A team member — a lead
    // may edit the task here (I59.57), so is not "somebody else".
    const other = await as(browser, 'writer')
    await mockBucket(other)
    await other.goto(`/my-work/task/${task.id}`)
    await expect(other.getByTestId('task-page-not-yours')).toBeVisible()
    await expect(other.getByTestId(`my-work-submit-${task.id}`)).toHaveCount(0)
    await expect(other.getByTestId(`my-work-start-${task.id}`)).toHaveCount(0)
    await expect(other.getByTestId('task-page-file').getByTestId('review-upload')).toHaveCount(0)
    await expect(other.getByTestId(`my-work-extension-${task.id}-ask`)).toHaveCount(0)
    await other.context().close()

    const maker2 = await as(browser, 'deputy')
    await mockBucket(maker2)
    await maker2.goto(`/my-work/task/${task.id}`)
    await maker2.getByTestId(`my-work-submit-${task.id}`).click()
    // ADR-0106 (I59.20): sent a minute after Start, the round is untimed — the warning comes first,
    // naming the allocation; Send anyway records it, marked untimed.
    await expect(maker2.getByTestId('untimed-dialog')).toBeVisible()
    await expect(maker2.getByTestId('untimed-told')).toContainText(PEOPLE.lead.name)
    await maker2.getByTestId('untimed-send').click()
    await expect(maker2.getByTestId('task-page-status')).toHaveAttribute('data-status', 'review')
    // The entry's round is the task's revision_number — 0 on the first round (ADR-0030; `sub_task_start`).
    await expect.poll(async () => (await rows<{ untimed: boolean }>('task_time_entries', `select=untimed&sub_task_id=eq.${task.id}&round=eq.0`))[0]?.untimed).toBe(true)
    await expect.poll(() => statusOf(task.id)).toBe('review')
    await expect(maker2.getByTestId(`my-work-waiting-on-${task.id}`)).toContainText(PEOPLE.lead.name)
    await maker2.context().close()
  })

  test('M4: sent back with a pin — the previous version, To fix, earlier rounds folded, Upload V2, Send V2 back', async ({ browser }) => {
    // The reviewer pins the image and sends it back, from Needs you.
    const lead = await as(browser, 'lead')
    await mockBucket(lead)
    await lead.goto('/my-work')
    await lead.getByTestId(`awaiting-review-open-${task.id}`).click()
    const img = lead.getByTestId('review-img')
    await expect(img).toBeVisible({ timeout: 15_000 })
    await img.click({ position: { x: 20, y: 20 } })
    await lead.getByTestId('comment-body').fill('Logo bottom right.')
    await lead.getByTestId('comment-submit').click()
    const [v1] = await versionsOf(job.deliverableId, task.id)
    await expect.poll(async () => (await rows<{ id: string }>('review_feedback', `select=id&media_record_id=eq.${v1.id}`)).length).toBe(1)
    const [pin] = await rows<{ id: string }>('review_feedback', `select=id&media_record_id=eq.${v1.id}`)
    await lead.getByTestId(`awaiting-review-request-changes-${task.id}`).click()
    await expect.poll(() => statusOf(task.id)).toBe('todo')
    await lead.context().close()

    // Somebody who is not the assignee sees the same M4 page, and no Upload V2 or Start.
    const other = await as(browser, 'tl')
    await mockBucket(other)
    await other.goto(`/my-work/task/${task.id}`)
    await expect(other.getByTestId('task-page-changes')).toBeVisible()
    await expect(other.getByTestId('task-page-upload-next')).toHaveCount(0)
    await expect(other.getByTestId('task-page-upload-next-file')).toHaveCount(0)
    await expect(other.getByTestId(`my-work-start-${task.id}`)).toHaveCount(0)
    await other.context().close()

    // The maker: "Changes came back" in Needs you, which opens the page in its M4 arrangement.
    const maker = await as(browser, 'deputy')
    await mockBucket(maker)
    await maker.goto('/my-work')
    await expect(maker.getByTestId(`needs-you-changes_back-${task.id}`)).toBeVisible()
    await maker.getByTestId(`needs-you-open-changes_back-${task.id}`).click()
    await expect(maker.getByTestId('task-page-changes')).toBeVisible()
    await expect(maker.getByTestId('task-page-status')).toHaveAttribute('data-status', 'changes')
    await expect(maker.getByTestId('task-page-prev-version').getByTestId('review-img')).toBeVisible({ timeout: 15_000 })
    await expect(maker.getByTestId(`task-page-pin-${pin.id}`)).toContainText('Logo bottom right.')

    // Figma M4: the previous file itself, large, with the pin numbered on it.
    await expect(maker.getByTestId('task-page-prev-version').getByTestId(`task-page-prev-pin-${pin.id}`)).toHaveText('1')
    // I59.29: the maker answers the pin in the To fix list (Track 7's PinControls, placed per M4) —
    // Reply from the foot's "Reply to a pin", with Cancel first; Mark done; Undo their own done; done again.
    const doneAt = async () => (await rows<{ done_at: string | null }>('review_feedback', `select=done_at&id=eq.${pin.id}`))[0]?.done_at ?? null
    const prevPanel = maker.getByTestId('task-page-to-fix')
    await maker.getByTestId('task-page-reply-to-pin').click()
    await expect(prevPanel.getByTestId(`pin-reply-form-${pin.id}`)).toBeVisible()
    await prevPanel.getByTestId(`pin-reply-cancel-${pin.id}`).click()
    await expect(prevPanel.getByTestId(`pin-reply-form-${pin.id}`)).toHaveCount(0)
    await prevPanel.getByTestId(`pin-reply-open-${pin.id}`).click()
    await prevPanel.getByTestId(`pin-reply-body-${pin.id}`).fill('Moved to the bottom right in V2.')
    await prevPanel.getByTestId(`pin-reply-submit-${pin.id}`).click()
    await expect.poll(async () => (await rows<{ id: string }>('review_feedback', `select=id&parent_id=eq.${pin.id}`)).length).toBe(1)
    await expect(prevPanel.getByTestId(`pin-replies-${pin.id}`)).toContainText('Moved to the bottom right in V2.')
    await expect(prevPanel.locator(':scope > li')).toHaveCount(1) // a reply hangs under its pin, never a pin of its own
    await prevPanel.getByTestId(`pin-mark-done-${pin.id}`).click()
    await expect.poll(doneAt).not.toBeNull()
    await expect(maker.getByTestId(`task-page-pin-${pin.id}`)).toHaveAttribute('data-done', 'true')
    await expect(maker.getByTestId(`task-page-pin-done-${pin.id}`)).toContainText(PEOPLE.deputy.name)
    await prevPanel.getByTestId(`pin-undo-${pin.id}`).click()
    await expect.poll(doneAt).toBeNull()
    await expect(maker.getByTestId(`task-page-pin-${pin.id}`)).not.toHaveAttribute('data-done', 'true')
    await prevPanel.getByTestId(`pin-mark-done-${pin.id}`).click()
    await expect.poll(doneAt).not.toBeNull()
    await expect(prevPanel.getByTestId(`pin-error-${pin.id}`)).toHaveCount(0)
    await maker.getByTestId('task-page-rounds-toggle').click()
    await expect(maker.getByTestId('task-page-round-1')).toBeVisible()

    // Start the fresh round, upload V2 through the labelled control, send V2 back.
    await maker.getByTestId(`my-work-start-${task.id}`).click()
    await expect.poll(() => statusOf(task.id)).toBe('in_progress')
    await expect(maker.getByTestId(`my-work-submit-${task.id}`)).toBeDisabled()
    const chooser = maker.waitForEvent('filechooser')
    await maker.getByTestId('task-page-upload-next').click()
    await (await chooser).setFiles({ name: 'v2.png', mimeType: 'image/png', buffer: PNG })
    await expect.poll(async () => (await versionsOf(job.deliverableId, task.id)).map((v) => v.round)).toEqual([1, 2])
    await expect(maker.getByTestId('task-page-next-attached')).toBeVisible()
    // Send V2 back is warned the same way (ADR-0106 d.2): Cancel first sends nothing, then Send anyway.
    await maker.getByTestId(`my-work-submit-${task.id}`).click()
    await maker.getByTestId('untimed-cancel').click()
    await expect(maker.getByTestId('untimed-dialog')).toHaveCount(0)
    expect(await statusOf(task.id)).toBe('in_progress')
    await maker.getByTestId(`my-work-submit-${task.id}`).click()
    await maker.getByTestId('untimed-send').click()
    await expect.poll(() => statusOf(task.id)).toBe('review')
    await maker.context().close()

    // The reviewer re-opens the pin the maker marked done (ADR-0112 d.2), from the review of V2 —
    // on the version it was pinned on. The maker's Undo is theirs; Re-open is the reviewer's.
    const reviewer = await as(browser, 'lead')
    await mockBucket(reviewer)
    await reviewer.goto('/my-work')
    await reviewer.getByTestId(`awaiting-review-open-${task.id}`).click()
    await reviewer.getByTestId(`review-version-${v1.id}`).click()
    await expect(reviewer.getByTestId(`pin-done-${pin.id}`)).toBeVisible()
    await reviewer.getByTestId(`pin-reopen-${pin.id}`).click()
    await expect.poll(doneAt).toBeNull()
    await reviewer.context().close()
  })

  test('the foot: Ask your lead for more time and Withdraw; Open in Deliverables for whoever manages tasks; back to My Work', async ({ browser }) => {
    const maker = await as(browser, 'deputy')
    await maker.goto(`/my-work/task/${task.id}`)
    // ADR-0141 d.5 (I74.17): the retired extension is not offered; the maker asks her own lead for more time.
    expect(await maker.getByTestId(`my-work-extension-${task.id}-ask`).count(), 'the retired extension is not offered').toBe(0)
    await maker.getByTestId('task-more-time-open').click()
    await maker.getByTestId('task-more-time-day').fill(new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10))
    await maker.getByTestId('task-more-time-note').fill('The files came late.')
    await maker.getByTestId('task-more-time-send').click()
    const pending = () => rows<{ id: string }>('sub_task_time_asks', `select=id&sub_task_id=eq.${task.id}&status=eq.pending`)
    await expect.poll(async () => (await pending()).length).toBe(1)
    await expect(maker.getByTestId('task-more-time-pending')).toBeVisible()
    await maker.getByTestId('task-more-time-withdraw').click()
    await expect.poll(async () => (await pending()).length).toBe(0)
    await maker.getByTestId('task-page-back').click()
    await expect(maker.getByTestId('surface-my-work')).toBeVisible()
    await maker.context().close()

    const lead = await as(browser, 'lead')
    await lead.goto(`/my-work/task/${task.id}`)
    await lead.getByTestId('task-page-deliverable-link').click()
    // ADR-0132 d.6 / d.8 (I71.1): the campaign page, the piece's panel open on the task the lead came from.
    await expect(lead).toHaveURL(new RegExp(`/campaigns/${job.campaignId}\\?piece=${job.deliverableId}&task=${task.id}`))
    await expect(lead.getByTestId(`piece-panel-tasks-row-${task.id}`)).toHaveAttribute('data-marked', 'true')
    await lead.context().close()
  })

  test('Already attached: a reference file filed in the job’s References is listed with Download and Download all', async ({ browser }) => {
    const [piece] = await rows<{ streams: { campaign_id: string; campaigns: { client_id: string } } }>(
      'deliverables', `select=streams(campaign_id,campaigns(client_id))&id=eq.${job.deliverableId}`)
    const campaignId = piece.streams.campaign_id
    const [refs] = await rows<{ id: string }>('asset_folders', `select=id&campaign_id=eq.${campaignId}&kind=eq.asset_type&name=eq.References`)
    expect(refs, 'the job has a References folder').toBeTruthy()

    // Filed through the Library, by somebody who may (the Power Admin), opened on the folder by URL.
    const admin = await as(browser, 'admin')
    await mockBucket(admin)
    await admin.goto(`/library?client=${piece.streams.campaigns.client_id}&folder=${refs.id}`)
    // The Library's Upload opens the browser's file chooser (a detached input — there is no input in the page to fill).
    const chooser = admin.waitForEvent('filechooser')
    await admin.getByTestId('library-upload').click()
    await (await chooser).setFiles([
      { name: 'kv.png', mimeType: 'image/png', buffer: PNG },
      { name: 'icons.png', mimeType: 'image/png', buffer: PNG },
    ])
    await expect.poll(async () => (await rows<{ id: string }>('assets', `select=id&folder_id=eq.${refs.id}`)).length).toBeGreaterThanOrEqual(2)
    await admin.context().close()
    const files = await rows<{ id: string; name: string }>('assets', `select=id,name&folder_id=eq.${refs.id}&retention_state=eq.active`)

    const maker = await as(browser, 'deputy')
    await mockBucket(maker)
    const asked: string[] = []
    maker.on('request', (r) => { if (r.url().includes('/functions/v1/asset-url')) asked.push(r.postData() ?? '') })
    await maker.goto(`/my-work/task/${task.id}`)
    const first = files[0]!
    await expect(maker.getByTestId(`task-page-ref-${first.id}`)).toContainText(first.name)
    await maker.getByTestId(`task-page-ref-download-${first.id}`).click()
    await expect.poll(() => asked.length).toBe(1)
    await maker.getByTestId('task-page-ref-download-all').click()
    await expect.poll(() => asked.length).toBe(1 + files.length)
    await expect(maker.getByTestId('task-page-ref-error')).toHaveCount(0)
    // The card's Reference set chip exists now that the set does.
    await maker.goto('/my-work')
    await expect(maker.getByTestId(`my-work-chip-references-${task.id}`)).toBeVisible()
    await maker.context().close()
  })
})
