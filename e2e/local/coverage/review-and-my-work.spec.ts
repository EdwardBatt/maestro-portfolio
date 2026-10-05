import { test, expect, type Browser, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { authFile, PEOPLE } from '../fixtures'
import { rows } from '../helpers/db'
import { fillSingleJobToReview, approveSingleJob, releaseSingleJob, type ReleasedJob, nextToReview, pickJobLanguages } from '../helpers/single-job'
import { addTaskOnPanel, approveTaskList, assignOnSchedule, workingDayFor } from '../helpers/piece'

/**
 * Coverage — the review panel, the deliverable's inputs and requirements, the manual thread's
 * Resolve, the Pipeline, and My Work's remaining controls (I49: ReviewPanel 11, ExternalInputs 6,
 * RequiredInput 3, TaskReviewThread 2, PipelinePage 2, ExtensionControl 1, TaskListApproval 1,
 * MyWorkPanel 1, SingleJobWizard 1, SimilarJobsDialog 1).
 *
 * B2 is mocked: the bucket answers every GET with a small PNG, whatever was "uploaded", so a
 * video or a PDF version renders its controls without a real file behind it.
 *
 * The DEPUTY does the work here, not the maker: the long-lived local database has given the
 * maker ~250 live tasks, and My Work breaks past ~200 (a 414 on the reviewers read — I49.75).
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
type Task = { id: string; title: string; status: string }
const tasksOf = (d: string) => rows<Task>('sub_tasks', `select=id,title,status&deliverable_id=eq.${d}&order=sort_order.asc`)
/**
 * A deliverable's uploaded versions, ordered by `version` — the column that actually counts up.
 *
 * It was ordered by `created_at` and callers indexed it by POSITION (I54.24). Four files are
 * uploaded here within a second or two of each other, and two rows written in the same instant
 * carry the same stamp — at which point the order is whatever Postgres feels like, `[1]` is not
 * necessarily the PDF, and the test fails claiming the wrong file came back.
 */
const versionsOf = (d: string) => rows<{ id: string; content_type: string | null; round: number; version: number }>('media_records', `select=id,content_type,round,version&deliverable_id=eq.${d}&order=version.asc`)

/** The version uploaded as a given kind of file — what each assertion below actually means. */
async function versionOfType(d: string, contentType: string) {
  const v = (await versionsOf(d)).find((x) => x.content_type === contentType)
  expect(v, `a ${contentType} version of ${d}`).toBeTruthy()
  return v!
}

let job: ReleasedJob
let tasks: Task[]

test.describe('Coverage — review, inputs, requirements, pipeline, My Work', () => {
  test.beforeAll(async ({ browser }) => {
    const am = await as(browser, 'am')
    job = await releaseSingleJob(am, { title: `Cov review ${Date.now()}`, department: 'Creative', type: 'Social Advertisement' })
    await am.context().close()
    // Since ADR-0132 (I71.1): the list is approved and the tasks added on the piece's panel; the Schedule gives each
    // to the person, with its hours, reviewer and review mode.
    const lead = await as(browser, 'lead')
    await approveTaskList(lead, job)
    // Two tasks on the maker: one digital (the review panel), one manual (the thread).
    for (const [i, [title, mode]] of ([['Cov digital', 'digital'], ['Cov manual', 'manual']] as const).entries()) {
      const on = await workingDayFor(PEOPLE.deputy.email, 3 + i * 3)
      const taskId = await addTaskOnPanel(lead, job, title, on)
      // E11 (I59): assigned only with its hours.
      await assignOnSchedule(lead, job, { taskId, assignee: PEOPLE.deputy.email, reviewer: PEOPLE.lead.email, day: on, hours: 4, reviewMode: mode })
    }
    await lead.context().close()
    tasks = await tasksOf(job.deliverableId)
  })

  test('the deliverable: something we are waiting on (add, every field, save, toggle), a task’s required input (pick, add, remove)', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await lead.goto(`/deliverables?open=${job.deliverableId}`)
    await expect(lead.getByTestId('external-inputs-none')).toBeVisible()
    await lead.getByTestId('external-input-add').click()
    await expect(lead.getByTestId('external-input-form')).toBeVisible()
    await lead.getByTestId('external-input-description').fill('Logo files from the client')
    await lead.getByTestId('external-input-awaited-from').fill('Northwind marketing')
    await lead.getByTestId('external-input-save').click()
    await expect(lead.getByTestId('external-inputs-list')).toContainText('Logo files from the client')
    const [input] = await rows<{ id: string; description: string; awaited_from: string | null; satisfied_at: string | null }>('deliverable_pending_inputs', `select=id,description,awaited_from,satisfied_at&deliverable_id=eq.${job.deliverableId}`)
    expect(input.awaited_from).toBe('Northwind marketing')
    expect(input.satisfied_at).toBeNull()
    // Arrived → the clock stops. Cleared once (I59): no Reopen — the database refuses un-ticking it,
    // so something awaited again is registered as a new input.
    const satisfiedAt = async () => {
      const [r] = await rows<{ satisfied_at: string | null }>('deliverable_pending_inputs', `select=satisfied_at&id=eq.${input.id}`)
      return r ? r.satisfied_at : 'missing'
    }
    await lead.getByTestId(`external-input-arrived-${input.id}`).click()
    await expect.poll(satisfiedAt).toMatch(/^20/)
    await expect(lead.getByTestId(`external-input-arrived-${input.id}`)).toHaveCount(0)
    await expect(lead.getByTestId(`external-input-${input.id}`)).toContainText('Logo files from the client')

    // A task's required input: pick the thing we are waiting on, add it, then remove it. Since ADR-0132 d.8 the
    // deliverable window is retired; a task's own row, with its Required input cell, is on the task's page for
    // whoever manages its work (I71.1).
    const t0 = tasks[0]
    await lead.goto(`/my-work/task/${t0.id}`)
    // The task page also lists the task's requirements in its own part; the row's cell is the one pressed here.
    const row = lead.getByTestId('task-page-manage')
    await expect(row).toBeVisible({ timeout: 15_000 })
    // "Nothing" is said only while the deliverable has no input at all; it has one now, so the
    // cell offers the picker instead.
    await expect(row.getByTestId(`required-input-${t0.id}`)).toBeVisible()
    await row.getByTestId(`requirement-add-${t0.id}`).click()
    const picker = row.getByTestId(`requirement-picker-${t0.id}`)
    await expect(picker).toBeVisible()
    // The picker offers TASKS (this task waits for that one); the outside input is linked by its
    // own control. Pick the next task on the same list.
    await picker.selectOption(tasks[1].id)
    await expect.poll(async () => (await rows<{ id: string }>('sub_task_dependencies', `select=id&sub_task_id=eq.${t0.id}`)).length).toBe(1)
    const [dep] = await rows<{ id: string }>('sub_task_dependencies', `select=id&sub_task_id=eq.${t0.id}`)
    await expect(row.getByTestId(`requirement-${dep.id}`)).toBeVisible()
    await row.getByTestId(`requirement-remove-${dep.id}`).click()
    await expect.poll(async () => (await rows<{ id: string }>('sub_task_dependencies', `select=id&sub_task_id=eq.${t0.id}`)).length).toBe(0)
    await lead.context().close()
  })

  test('the review panel: Upload (the label), image / video / PDF / other versions and their anchors, a comment with jump and resolve, download', async ({ browser }) => {
    const digital = tasks.find((t) => t.title === 'Cov digital')!
    const maker = await as(browser, 'deputy')
    await mockBucket(maker)
    await maker.goto('/my-work')
    await maker.getByTestId(`my-work-start-${digital.id}`).click()
    // I59.11: this round's upload and Send are on the task's own page (the Submit dialog is retired).
    await maker.getByTestId(`my-work-open-${digital.id}`).click()
    await expect(maker.getByTestId('task-page-file')).toBeVisible()

    // Upload through the labelled control (a file chooser), not by setting the hidden input.
    const chooser = maker.waitForEvent('filechooser')
    await maker.getByTestId('review-upload').click()
    await (await chooser).setFiles({ name: 'cut.mp4', mimeType: 'video/mp4', buffer: PNG })
    await expect.poll(async () => (await versionsOf(job.deliverableId)).length).toBe(1)
    // Video: mark the moment, drop it.
    await expect(maker.getByTestId('review-mark-time')).toBeVisible({ timeout: 15_000 })
    await maker.getByTestId('review-mark-time').click()
    await expect(maker.getByTestId('review-drop-time')).toBeVisible()
    await maker.getByTestId('review-drop-time').click()
    await expect(maker.getByTestId('review-mark-time')).toBeVisible()

    // PDF: a page anchor.
    const chooser2 = maker.waitForEvent('filechooser')
    await maker.getByTestId('review-upload').click()
    await (await chooser2).setFiles({ name: 'deck.pdf', mimeType: 'application/pdf', buffer: PNG })
    await expect.poll(async () => (await versionsOf(job.deliverableId)).length).toBe(2)
    await expect(maker.getByTestId('review-page-anchor')).toBeVisible({ timeout: 15_000 })
    await maker.getByTestId('review-page-input').fill('3')
    await maker.getByTestId('comment-body').fill('Page three: the footer is wrong.')
    await maker.getByTestId('comment-submit').click()
    const pdf = await versionOfType(job.deliverableId, 'application/pdf')
    await expect.poll(async () => (await rows<{ page: number | null }>('review_feedback', `select=page&media_record_id=eq.${pdf.id}`)).length).toBe(1)
    expect((await rows<{ page: number | null }>('review_feedback', `select=page&media_record_id=eq.${pdf.id}`))[0].page).toBe(3)

    // Other (no viewer): the fallback says why and offers Download.
    const chooser3 = maker.waitForEvent('filechooser')
    await maker.getByTestId('review-upload').click()
    await (await chooser3).setFiles({ name: 'source.zip', mimeType: 'application/zip', buffer: PNG })
    await expect.poll(async () => (await versionsOf(job.deliverableId)).length).toBe(3)
    await expect(maker.getByTestId('review-fallback')).toBeVisible({ timeout: 15_000 })
    await expect(maker.getByTestId('review-download')).toHaveAttribute('href', /dl=1/)
    // `review-external` needs a version with an external review link; nothing in the product sets
    // one yet (I48.18) — asserted absent.
    await expect(maker.getByTestId('review-external')).toHaveCount(0)

    // Image: a comment, jumped to and resolved.
    const chooser4 = maker.waitForEvent('filechooser')
    await maker.getByTestId('review-upload').click()
    await (await chooser4).setFiles({ name: 'final.png', mimeType: 'image/png', buffer: PNG })
    await expect.poll(async () => (await versionsOf(job.deliverableId)).length).toBe(4)
    await expect(maker.getByTestId('review-img')).toBeVisible({ timeout: 15_000 })
    await maker.getByTestId('review-composer').getByTestId('comment-body').fill('General note on the image.')
    await maker.getByTestId('comment-submit').click()
    const v4 = await versionOfType(job.deliverableId, 'image/png')
    await expect.poll(async () => (await rows<{ id: string }>('review_feedback', `select=id&media_record_id=eq.${v4.id}`)).length).toBe(1)
    const [c] = await rows<{ id: string; resolved: boolean }>('review_feedback', `select=id,resolved&media_record_id=eq.${v4.id}`)
    await maker.getByTestId(`comment-jump-${c.id}`).click()
    await maker.getByTestId(`comment-resolve-${c.id}`).click()
    await expect.poll(async () => (await rows<{ resolved: boolean }>('review_feedback', `select=resolved&id=eq.${c.id}`))[0].resolved).toBe(true)
    await maker.getByTestId(`my-work-submit-${digital.id}`).click()
    // ADR-0106 (I59.20): a round sent minutes after Start is untimed — the warning, then Send anyway.
    await maker.getByTestId('untimed-send').click()
    await expect(maker.getByTestId('task-page-status')).toHaveAttribute('data-status', 'review')
    await maker.context().close()

    // I52.12: a deliverable is never reviewed — its TASK is. The lead opens the task's review from
    // its row; the versions are that task's, read-only for somebody who is not its reviewer in turn
    // (download, no upload — ADR-0058 d.1). The row is on the task's page since ADR-0132 d.8 retired the
    // deliverable window (I71.1).
    const lead = await as(browser, 'lead')
    await mockBucket(lead)
    await lead.goto(`/my-work/task/${digital.id}`)
    await expect(lead.getByTestId('task-page-manage')).toBeVisible({ timeout: 15_000 })
    await expect(lead.getByTestId('task-page-manage').getByTestId('review-rail')).toHaveCount(0)   // no deliverable-level panel
    await lead.getByTestId(`subtask-review-open-${digital.id}`).click()
    const modal = lead.getByTestId(`subtask-review-modal-${digital.id}`)
    await expect(modal).toBeVisible()
    await expect(modal.getByRole('heading', { level: 2 })).toHaveText('Cov digital')
    // The lead is its reviewer and it is in review: THIS task's four versions, the newest open —
    // but never an upload, which is the maker's on My Work.
    await expect(modal.getByTestId('review-rail')).toBeVisible()
    await expect(modal.locator('[data-testid^="review-version-"]:not([data-testid*="-time-"])')).toHaveCount(4)
    await expect(modal.getByTestId('review-img')).toBeVisible({ timeout: 15_000 })
    await expect(modal.getByTestId('review-upload')).toHaveCount(0)
    await lead.getByTestId(`subtask-review-close-${digital.id}`).click()
    await lead.context().close()

    // Somebody who is NOT its reviewer (Traffic) gets the same task read-only: download, nothing else.
    const traffic = await as(browser, 'traffic')
    await mockBucket(traffic)
    await traffic.goto(`/my-work/task/${digital.id}`)
    await traffic.getByTestId(`subtask-review-open-${digital.id}`).click()
    const ro = traffic.getByTestId(`subtask-review-modal-${digital.id}`)
    await expect(ro.getByTestId('review-download-inline')).toBeVisible({ timeout: 15_000 })
    await expect(ro.getByTestId('review-upload')).toHaveCount(0)
    await expect(ro.getByTestId('comment-submit')).toHaveCount(0)
    await traffic.getByTestId(`subtask-review-close-${digital.id}`).click()
    await traffic.context().close()
  })

  test('the manual thread: the reviewer resolves a note; the maker asks for more time and withdraws it', async ({ browser }) => {
    const manual = tasks.find((t) => t.title === 'Cov manual')!
    const maker = await as(browser, 'deputy')
    await maker.goto('/my-work')
    // I59.11: Open goes to the task's own page — reachable by keyboard.
    const href = await maker.getByTestId(`my-work-open-${manual.id}`).getAttribute('href')
    expect(href).toBe(`/my-work/task/${manual.id}`)
    await maker.getByTestId(`my-work-open-${manual.id}`).focus()
    await maker.keyboard.press('Enter')
    await expect(maker).toHaveURL(new RegExp(`/my-work/task/${manual.id}$`))
    // Start is at the page's foot as well as on the card.
    await maker.getByTestId(`my-work-start-${manual.id}`).click()
    await maker.getByTestId(`task-review-composer-${manual.id}`).getByTestId(`task-comment-body-${manual.id}`).fill('Done on set.')
    await maker.getByTestId(`task-comment-submit-${manual.id}`).click()
    await expect(maker.getByTestId(`task-review-gate-${manual.id}`)).toContainText(/you can submit/i)
    await maker.getByTestId(`my-work-submit-${manual.id}`).click()
    // ADR-0106 (I59.20): a round sent minutes after Start is untimed — the warning, then Send anyway.
    await maker.getByTestId('untimed-send').click()
    await expect(maker.getByTestId('task-page-status')).toHaveAttribute('data-status', 'review')
    await maker.context().close()

    const lead = await as(browser, 'lead')
    await lead.goto('/my-work')
    await lead.getByTestId(`awaiting-review-open-${manual.id}`).click()
    const [note] = await rows<{ id: string }>('review_feedback', `select=id&sub_task_id=eq.${manual.id}`)
    await lead.getByTestId(`task-comment-resolve-${note.id}`).click()
    await expect.poll(async () => (await rows<{ resolved: boolean }>('review_feedback', `select=resolved&id=eq.${note.id}`))[0].resolved).toBe(true)
    await lead.getByTestId(`task-comment-resolve-${note.id}`).click()
    await expect.poll(async () => (await rows<{ resolved: boolean }>('review_feedback', `select=resolved&id=eq.${note.id}`))[0].resolved).toBe(false)
    await lead.context().close()

    // Ask for more time on the digital task (still open), then withdraw the ask. ADR-0141 d.5 retired the per-task
    // extension: a maker asks HER LEAD for more time on her task's page (I74.17), and nothing else is raised.
    const digital = tasks.find((t) => t.title === 'Cov digital')!
    const maker2 = await as(browser, 'deputy')
    await maker2.goto(`/my-work/task/${digital.id}`)
    expect(await maker2.getByTestId(`my-work-extension-${digital.id}-ask`).count(), 'the retired extension is not offered').toBe(0)
    await maker2.getByTestId('task-more-time-open').click()
    await maker2.getByTestId('task-more-time-day').fill(new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10))
    await maker2.getByTestId('task-more-time-note').fill('More work than planned.')
    await maker2.getByTestId('task-more-time-send').click()
    const pendingAsks = () => rows<{ id: string }>('sub_task_time_asks', `select=id&sub_task_id=eq.${digital.id}&status=eq.pending`)
    await expect.poll(async () => (await pendingAsks()).length).toBe(1)
    expect(await rows('sub_task_extension_requests', `select=request_id&sub_task_id=eq.${digital.id}&is_pending=eq.true`), 'no extension request').toEqual([])
    await maker2.getByTestId('task-more-time-withdraw').click()
    await expect.poll(async () => (await pendingAsks()).length).toBe(0)
    await maker2.context().close()
  })

  test('the Pipeline: pick a campaign, open a card', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await lead.goto('/pipeline')
    await lead.getByTestId('pipeline-campaign').selectOption({ label: job.title })
    await lead.getByTestId(`pipeline-card-${job.deliverableId}`).click()
    // ADR-0132 d.8 (I71.1): the card opens the piece on its campaign page, its panel open.
    await expect(lead).toHaveURL(new RegExp(`/campaigns/${job.campaignId}\\?.*piece=${job.deliverableId}`), { timeout: 20_000 })
    await expect(lead.getByTestId('piece-panel')).toBeVisible()
    await lead.context().close()
  })

  test('a single job with a risk note: the owner dismisses the reminder; a lookalike offers Open; a released job offers Open', async ({ browser }) => {
    const title = `Cov risk ${Date.now()}`
    const am = await as(browser, 'am')
    await am.goto('/campaigns/new-job')
    // SJ-v3-01 (22 Sep): the client and the kind of brief come first, on their own screen.
    await am.getByTestId('sj-client').selectOption({ label: 'Northwind Beverages' })
    await am.getByTestId('sj-words').fill('One static, fast.')
    await am.getByTestId('sj-brief-card-single_execution').click()
    await am.getByTestId('sj-next').click()
    await expect(am.getByTestId('sj-brief')).toBeVisible()
    await am.getByTestId('sj-field-task').fill('Design one static.')
    await am.getByTestId('sj-risk').fill('The client has not sent the logo files.')
    await am.getByTestId('sj-next').click()
    await expect(am.getByTestId('sj-request')).toBeVisible()
    await am.getByTestId('sj-title').fill(title)
    await am.getByTestId('sj-due').fill(new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10))
    await am.getByTestId('sj-department').getByRole('radio', { name: 'Creative' }).click()
    await pickJobLanguages(am)
    await nextToReview(am)
    const id = await approveSingleJob(am)
    // Open the released job again in the builder: it says so and offers the page.
    await am.goto(`/campaigns/new-job?job=${id}`)
    await expect(am.getByTestId('sj-released-note')).toBeVisible()
    await am.getByTestId('sj-released-open').click()
    await expect(am).toHaveURL(new RegExp(`/campaigns/${id}$`))
    await am.context().close()

    const [d] = await rows<{ id: string }>('deliverables', `select=id,streams!inner(campaign_id)&streams.campaign_id=eq.${id}`)
    const lead = await as(browser, 'lead')
    await lead.goto(`/deliverables?open=${d.id}`)
    await expect(lead.getByTestId('piece-panel-risk')).toContainText('logo files')
    await lead.getByTestId('piece-panel-risk-dismiss').click()
    await expect(lead.getByTestId('piece-panel-risk')).toHaveCount(0)
    await lead.context().close()

    // A second job that LOOKS like it (titles are unique per client, so a near-name): the
    // lookalike dialog offers to OPEN the existing one.
    const am2 = await as(browser, 'am')
    // S1 fires on Next from who and when (22 Sep), not on Open.
    await fillSingleJobToReview(am2, { title: `${title} again`, department: 'Creative', keepPrompt: true })
    await expect(am2.getByTestId('sj-similar-dialog')).toBeVisible({ timeout: 30_000 })
    // The job's name opens the existing job in a NEW tab, so the request being typed is not lost.
    const popup = am2.context().waitForEvent('page')
    await am2.getByTestId(`sj-similar-open-${id}`).click()
    const opened = await popup
    await expect(opened).toHaveURL(new RegExp(`/campaigns/${id}$`))
    await expect(am2.getByTestId('sj-similar-dialog')).toBeVisible()
    await am2.context().close()
  })
})
