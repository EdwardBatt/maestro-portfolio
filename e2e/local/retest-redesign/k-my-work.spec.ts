import { test, expect, type Browser, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { authFile, PEOPLE } from '../fixtures'
import { rows, slaEvents, userIdOf, waitForNotification } from '../helpers/db'
import { releaseSingleJob, type ReleasedJob } from '../helpers/single-job'

/**
 * docs/RETEST-REDESIGN.md — K: My Work & deliverables (ADR-0077 containers, ADR-0080 archiving,
 * ADR-0075 d.9 the promised date, I41.8/I41.10 arithmetic).
 *
 * Fixtures: two typed Creative single jobs, task lists approved. Job ONE has one task booked on the
 * maker TODAY in manual mode (K1, K2, K4 — start, timer, submit, approve, the container closes).
 * Job TWO has one task booked next week in digital mode (K3 — a version upload and pinned
 * feedback; K7 — the extension arithmetic; K5 — archiving calls it off). K6 uses the seeded
 * Northwind campaign, the one with a go-live.
 *
 * B2 is not configured locally, so the two presign functions and the bucket are MOCKED: the
 * product's own row writes (`media_records`, `assets`) still happen against the real database.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}

const here = path.dirname(fileURLToPath(import.meta.url))
const PNG_PATH = path.join(here, 'dummy-artwork.png') // 240×160, so a pin can land inside it
const PNG = readFileSync(PNG_PATH)
const BUCKET = 'https://b2.local.test'

/** Stand in for B2 and the two presigning functions (`review-media`, `asset-url`). */
async function mockBucket(page: Page) {
  await page.route(`${BUCKET}/**`, async (route) => {
    if (route.request().method() === 'PUT') return route.fulfill({ status: 200, body: '' })
    return route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
  })
  await page.route('**/functions/v1/review-media', async (route) => {
    const body = route.request().postDataJSON() as { op: string; fileName?: string; mediaRecordId?: string }
    await new Promise((r) => setTimeout(r, 300))
    if (body.op === 'upload') {
      const objectKey = `e2e/${Date.now()}-${body.fileName}`
      return route.fulfill({ json: { uploadUrl: `${BUCKET}/put/${objectKey}`, objectKey } })
    }
    return route.fulfill({ json: { viewUrl: `${BUCKET}/get/${body.mediaRecordId}`, downloadUrl: `${BUCKET}/get/${body.mediaRecordId}?dl=1` } })
  })
  await page.route('**/functions/v1/asset-url', async (route) => {
    const body = route.request().postDataJSON() as { op: string; fileName?: string; folderId?: string }
    await new Promise((r) => setTimeout(r, 300))
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

/** Today in Baghdad, and the Sunday `weeksOut` weeks ahead. */
const baghdadToday = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10)
function sundayOut(weeksOut: number): string {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + 7 * weeksOut + ((7 - d.getUTCDay()) % 7))
  return d.toISOString().slice(0, 10)
}
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
const isBaghdadWorkingDay = (iso: string) => ![5, 6].includes(new Date(`${iso}T12:00:00Z`).getUTCDay())

async function openAdd(page: Page, resourceId: string, isoDate: string) {
  await page.goto(`/schedule?on=${isoDate}`)
  await expect(page.getByTestId('schedule-grid')).toBeVisible()
  const cell = page.getByTestId(`cell-${resourceId}-${isoDate}`)
  await expect(cell).toBeVisible()
  await cell.hover()
  await page.getByTestId(`add-${resourceId}-${isoDate}`).click()
  await expect(page.getByTestId('booking-dialog')).toBeVisible()
}

async function book(page: Page) {
  const dialog = page.getByTestId('booking-dialog')
  const submit = page.getByTestId('booking-submit')
  await submit.click()
  const outcome = await Promise.race([
    dialog.waitFor({ state: 'detached', timeout: 20_000 }).then(() => 'closed' as const),
    submit.filter({ hasText: /Proceed anyway/ }).waitFor({ state: 'visible', timeout: 20_000 }).then(() => 'warned' as const),
  ])
  if (outcome === 'warned') {
    await expect(page.getByTestId('booking-error')).toHaveCount(0)
    await submit.click()
    await expect(dialog).toHaveCount(0)
  }
}

async function bookTask(page: Page, jobTitle: string, resourceId: string, day: string, taskTitle: string, mode: 'manual' | 'digital') {
  await openAdd(page, resourceId, day)
  const toggle = page.getByTestId('mode-project')
  if (await toggle.count()) await toggle.check()
  await page.getByTestId('booking-project').selectOption({ label: jobTitle })
  await page.getByTestId('booking-deliverable-select').selectOption({ index: 1 })
  await page.getByTestId('booking-subtask-select').selectOption({ label: taskTitle })
  await page.getByTestId('booking-project-reviewer-add').selectOption({ label: PEOPLE.lead.name })
  await page.getByTestId('booking-review-mode').selectOption(mode)
  await page.getByTestId('booking-hours').fill('4')
  await book(page)
}

/** ADR-0132 d.8: the owner approves the task list in the piece's panel on the campaign page. */
async function approveTaskList(browser: Browser, deliverableId: string) {
  const lead = await as(browser, 'lead')
  const [d] = await rows<{ streams: { campaign_id: string } }>('deliverables', `select=streams!inner(campaign_id)&id=eq.${deliverableId}`)
  await lead.goto(`/campaigns/${d.streams.campaign_id}?piece=${deliverableId}`)
  // ADR-0140: the list's own Approve on the panel's task list; approved, its foot offers the Schedule.
  await lead.getByTestId('piece-panel-tasks-approve').click()
  await expect(lead.getByTestId('piece-panel-tasks-open-schedule')).toBeVisible()
  await lead.context().close()
}

type Task = { id: string; title: string }
let one: ReleasedJob
let two: ReleasedJob
let taskOne: Task
let taskTwo: Task
let makerResource: string
let makerId: string
const today = baghdadToday()
const todayIsWorking = isBaghdadWorkingDay(today)
const farDay = shift(sundayOut(0), 1) // the Monday of next week: inside the job's two-week window, so the arithmetic has days to count

test.describe('Section K — My Work & deliverables', () => {
  test.beforeAll(async ({ browser }) => {
    const am = await as(browser, 'am')
    one = await releaseSingleJob(am, { title: `K one ${Date.now()}`, department: 'Creative', type: 'Social Advertisement' })
    two = await releaseSingleJob(am, { title: `K two ${Date.now()}`, department: 'Creative', type: 'Social Advertisement' })
    await am.context().close()
    await approveTaskList(browser, one.deliverableId)
    await approveTaskList(browser, two.deliverableId)
    ;[taskOne] = await rows<Task>('sub_tasks', `select=id,title&deliverable_id=eq.${one.deliverableId}&order=sort_order.asc`)
    ;[taskTwo] = await rows<Task>('sub_tasks', `select=id,title&deliverable_id=eq.${two.deliverableId}&order=sort_order.asc`)
    const [r] = await rows<{ id: string }>('resources', `select=id&name=eq.${encodeURIComponent(PEOPLE.maker.name)}&is_active=eq.true`)
    makerResource = r.id
    makerId = await userIdOf(PEOPLE.maker.email)

    const traffic = await as(browser, 'traffic')
    // Job ONE's task today when today is a working day (Fri/Sat have no cell to book), else the next Sunday.
    await bookTask(traffic, one.title, makerResource, todayIsWorking ? today : sundayOut(1), taskOne.title, 'manual')
    await bookTask(traffic, two.title, makerResource, farDay, taskTwo.title, 'digital')
    await traffic.context().close()
  })

  test('K1 — My Work lists the assigned tasks, today apart from the rest; Start opens a timer, Submit closes it', async ({ browser }) => {
    const maker = await as(browser, 'maker')
    await maker.goto('/my-work')
    const itemOne = maker.getByTestId(`my-work-item-${taskOne.id}`)
    const itemTwo = maker.getByTestId(`my-work-item-${taskTwo.id}`)
    await expect(itemOne).toBeVisible()
    await expect(itemTwo).toBeVisible()
    // Today's vs the rest: the task due today sits in "Tasks for today", the far one in This week or
    // Later (I59.10 split "Upcoming" at Saturday).
    if (todayIsWorking) await expect(maker.getByTestId('today-tasks-panel').getByTestId(`my-work-item-${taskOne.id}`)).toBeVisible()
    await expect(maker.locator('[data-testid="week-tasks-panel"], [data-testid="later-tasks-panel"]').getByTestId(`my-work-item-${taskTwo.id}`)).toBeVisible()
    await expect(itemOne.getByTestId(`my-work-people-${taskOne.id}`)).toContainText(PEOPLE.lead.name)

    // Start (on the card): in_progress, and a timer is open. Send is on the task's page (I59.11).
    await maker.getByTestId(`my-work-start-${taskOne.id}`).click()
    await maker.getByTestId(`my-work-open-${taskOne.id}`).click()
    await expect(maker.getByTestId(`my-work-submit-${taskOne.id}`)).toBeVisible()
    const [started] = await rows<{ status: string }>('sub_tasks', `select=status&id=eq.${taskOne.id}`)
    expect(started.status).toBe('in_progress')
    const open = await rows<{ id: string; started_at: string; submitted_at: string | null }>('task_time_entries', `select=id,started_at,submitted_at&sub_task_id=eq.${taskOne.id}&user_id=eq.${makerId}`)
    expect(open).toHaveLength(1)
    expect(open[0].submitted_at).toBeNull()

    // Send (manual: the note IS the artefact): review, and the timer is closed.
    await expect(maker.getByTestId(`my-work-submit-${taskOne.id}`)).toBeDisabled()
    await maker.getByTestId(`task-comment-body-${taskOne.id}`).fill('Direction agreed with the team lead on the call.')
    await maker.getByTestId(`task-comment-submit-${taskOne.id}`).click()
    await expect(maker.getByTestId(`task-review-gate-${taskOne.id}`)).toContainText(/you can submit/i)
    await maker.getByTestId(`my-work-submit-${taskOne.id}`).click()
    // ADR-0106 (I59.20): a round sent minutes after Start is untimed — the warning, then Send anyway.
    await maker.getByTestId('untimed-send').click()
    await expect(maker.getByTestId('task-page-status')).toHaveAttribute('data-status', 'review')
    await expect.poll(async () => (await rows<{ status: string }>('sub_tasks', `select=status&id=eq.${taskOne.id}`))[0].status).toBe('review')
    const [closed] = await rows<{ submitted_at: string | null; minutes: number | null }>('task_time_entries', `select=submitted_at,minutes&id=eq.${open[0].id}`)
    expect(closed.submitted_at).toBeTruthy()
    expect(closed.minutes).not.toBeNull()
    await maker.context().close()
  })

  test('K2/K4 — approval signs the task off; the container closes when nothing under it is unsettled; Completed lists it', async ({ browser }) => {
    // ADR-0077 d.2 rolls an IN-PROGRESS container up. Since the 14 Sep addendum (d.7) STARTING ANY
    // TASK moves a still-draft container to in_progress on its own — the maker did that in K1 — so
    // there is no Start left for the account manager to press (I53.13: this used to press one).
    const am = await as(browser, 'am')
    await am.goto(`/deliverables?campaign=${one.campaignId}`)
    await expect(am.getByTestId(`deliverable-row-${one.deliverableId}`)).toBeVisible()
    await expect(am.getByTestId(`deliverable-start-${one.deliverableId}`)).toHaveCount(0)
    expect((await rows<{ state: string }>('deliverables', `select=state&id=eq.${one.deliverableId}`))[0].state).toBe('in_progress')
    await am.context().close()

    // The reviewer approves the maker's task.
    const lead = await as(browser, 'lead')
    await lead.goto('/my-work')
    await lead.getByTestId(`awaiting-review-open-${taskOne.id}`).click()
    await expect(lead.getByTestId(`awaiting-review-modal-${taskOne.id}`)).toBeVisible()
    await lead.getByTestId(`awaiting-review-approve-${taskOne.id}`).click()
    await expect(lead.getByTestId(`awaiting-review-modal-${taskOne.id}`)).toHaveCount(0)

    const [task] = await rows<{ status: string; approved_at: string | null }>('sub_tasks', `select=status,approved_at&id=eq.${taskOne.id}`)
    expect(task.status).toBe('done')
    expect(task.approved_at).toBeTruthy()
    const signed = await waitForNotification(PEOPLE.maker.email, 'signed_off', 8_000, taskOne.id)
    expect(signed.entity_id).toBe(taskOne.id)
    // ADR-0118 d.1: approved only when EVERY task is done or cancelled — the planned steps nobody was given
    // hold it open.
    const stateOf = async () => (await rows<{ state: string }>('deliverables', `select=state&id=eq.${one.deliverableId}`))[0].state
    expect(await stateOf()).toBe('in_progress')

    // The lead cancels the steps nobody needs. The last one settled closes the container — the ADR-0118
    // addendum (I65.4, Edward 28 Sep "A"): before it, this order left the piece In progress for good.
    // ADR-0132: in the piece's panel on the campaign page.
    await lead.goto(`/campaigns/${one.campaignId}?piece=${one.deliverableId}`)
    const rest = await rows<{ id: string }>('sub_tasks', `select=id&deliverable_id=eq.${one.deliverableId}&id=neq.${taskOne.id}&status=neq.cancelled`)
    expect(rest.length, 'the list has other tasks').toBeGreaterThan(0)
    for (const r of rest) {
      // ADR-0140 / I74.11: an unbooked task's ✕ removes it with an undo window (no question first).
      await lead.getByTestId(`piece-panel-tasks-remove-${r.id}`).click()
      await expect(lead.getByTestId('piece-panel-tasks-undo')).toBeVisible()
      await expect(lead.getByTestId('campaign-banner')).toHaveCount(0)   // no refusal, no failure
      // A task nobody was given is a plan: removing it deletes it; one that was given out is kept, cancelled.
      await expect.poll(async () => (await rows<{ status: string }>('sub_tasks', `select=status&id=eq.${r.id}`)).every((x) => x.status === 'cancelled'), { timeout: 20_000 }).toBe(true)
    }
    await lead.context().close()
    await expect.poll(stateOf).toBe('approved')

    const maker = await as(browser, 'maker')
    await maker.goto('/my-work')
    // I59.10: Completed is folded shut — "Completed (N)" opens it.
    await maker.getByTestId('completed-tasks-toggle').click()
    await expect(maker.getByTestId('completed-tasks-panel').getByTestId(`my-work-item-${taskOne.id}`)).toBeVisible()
    await expect(maker.getByTestId('today-tasks-panel').getByTestId(`my-work-item-${taskOne.id}`)).toHaveCount(0)
    await expect(maker.locator('[data-testid="week-tasks-panel"], [data-testid="later-tasks-panel"], [data-testid="waiting-tasks-panel"]').getByTestId(`my-work-item-${taskOne.id}`)).toHaveCount(0)
    await maker.context().close()
  })

  test('K3 — internal review: a version is uploaded, the reviewer pins feedback on it, and requests changes', async ({ browser }) => {
    // The maker uploads round one's file on the task's page (I59.11) and sends it.
    const maker = await as(browser, 'maker')
    await mockBucket(maker)
    await maker.goto('/my-work')
    await maker.getByTestId(`my-work-start-${taskTwo.id}`).click()
    await maker.getByTestId(`my-work-open-${taskTwo.id}`).click()
    await expect(maker.getByTestId('task-page-file')).toBeVisible()
    await expect(maker.getByTestId(`my-work-submit-needs-file-${taskTwo.id}`)).toBeVisible()
    await expect(maker.getByTestId(`my-work-submit-${taskTwo.id}`)).toBeDisabled()
    await maker.getByTestId('review-file').setInputFiles(PNG_PATH)
    const versions = () => rows<{ id: string; sub_task_id: string; round: number }>('media_records', `select=id,sub_task_id,round&deliverable_id=eq.${two.deliverableId}&order=created_at.desc`)
    await expect.poll(async () => (await versions()).length).toBe(1)
    const [v1] = await versions()
    expect(v1.sub_task_id).toBe(taskTwo.id) // the artefact belongs to the task (ADR-0058 d.1)
    await expect(maker.getByTestId(`review-version-${v1.id}`)).toBeVisible()
    await expect(maker.getByTestId('review-img')).toBeVisible()
    await expect(maker.getByTestId(`my-work-submit-needs-file-${taskTwo.id}`)).toHaveCount(0)
    await maker.getByTestId(`my-work-submit-${taskTwo.id}`).click()
    // ADR-0106 (I59.20): a round sent minutes after Start is untimed — the warning, then Send anyway.
    await maker.getByTestId('untimed-send').click()
    await expect(maker.getByTestId('task-page-status')).toHaveAttribute('data-status', 'review')
    await expect.poll(async () => (await rows<{ status: string }>('sub_tasks', `select=status&id=eq.${taskTwo.id}`))[0].status).toBe('review')
    await maker.context().close()

    // The reviewer pins a comment on the image and sends it back.
    const lead = await as(browser, 'lead')
    await mockBucket(lead)
    await lead.goto('/my-work')
    await lead.getByTestId(`awaiting-review-open-${taskTwo.id}`).click()
    await expect(lead.getByTestId(`awaiting-review-modal-${taskTwo.id}`)).toBeVisible()
    const img = lead.getByTestId('review-img')
    await expect(img).toBeVisible()
    await img.click({ position: { x: 20, y: 20 } })
    await expect(lead.getByTestId('review-pin-pending')).toBeVisible()
    await lead.getByTestId('comment-body').fill('Logo is clipped at the top-left.')
    await lead.getByTestId('comment-submit').click()
    const commentsOf = () => rows<{ id: string; pos_x: number | null; pos_y: number | null; resolved: boolean | null }>(
      'review_feedback',
      `select=id,pos_x,pos_y,resolved&media_record_id=eq.${v1.id}`,
    )
    await expect.poll(async () => (await commentsOf()).length).toBe(1)
    const comments = await commentsOf()
    expect(comments[0].pos_x).not.toBeNull()
    expect(comments[0].pos_y).not.toBeNull()
    await expect(lead.getByTestId(`review-pin-${comments[0].id}`)).toBeVisible()
    await expect(lead.getByTestId(`review-comment-${comments[0].id}`)).toContainText('Logo is clipped')
    await lead.getByTestId(`awaiting-review-request-changes-${taskTwo.id}`).click()
    await expect(lead.getByTestId(`awaiting-review-modal-${taskTwo.id}`)).toHaveCount(0)
    await lead.context().close()
    const [sentBack] = await rows<{ status: string }>('sub_tasks', `select=status&id=eq.${taskTwo.id}`)
    expect(sentBack.status).toBe('todo')
    await waitForNotification(PEOPLE.maker.email, 'changes_requested', 8_000, taskTwo.id)

    // The maker reads the pinned feedback on the task's page — the M4 arrangement (I59.11): the
    // previous version with its pin, and the pin in To fix.
    const maker2 = await as(browser, 'maker')
    await mockBucket(maker2)
    await maker2.goto('/my-work')
    await maker2.getByTestId(`my-work-open-${taskTwo.id}`).click()
    await expect(maker2.getByTestId('task-page-changes')).toBeVisible()
    // M4 (E16): the pin sits on the previous file and in To fix — not in an embedded review panel.
    await expect(maker2.getByTestId(`task-page-prev-pin-${comments[0].id}`)).toBeVisible()
    await expect(maker2.getByTestId(`task-page-pin-${comments[0].id}`)).toContainText('Logo is clipped')
    await maker2.getByTestId('task-page-back').click()
    await expect(maker2.getByTestId('surface-my-work')).toBeVisible()
    await maker2.context().close()
  })

  // I74 (3 Oct): retired with the per-task extension (ADR-0141 d.5). The arithmetic it reads lived in the maker's
  // request dialog, which no longer opens — a new ask is refused (extension_retired) and asking for more time goes to
  // the maker's own lead (more-time.spec.ts). Nothing on a reachable screen shows this arithmetic any more.
  test.skip('K7 — extension arithmetic reads the review buffer from Scheduling rules and skips declared closures', async ({ browser }) => {
    test.setTimeout(180_000) // six sign-ins, two settings round-trips
    const control = `my-work-extension-${taskTwo.id}`
    const dlg = `${control}-request`
    const asked = shift(farDay, 1) // the Tuesday of the booked week
    const closureDay = shift(farDay, 2) // the Wednesday after it — inside the window the arithmetic counts
    const daysOf = (text: string) => Number(/Leaves (\d+) working days/.exec(text)?.[1])
    const bufferOf = (text: string) => Number(/(?:with|the) (\d+) needed for review/.exec(text)?.[1])

    async function readArithmetic(): Promise<{ text: string; severity: string }> {
      const maker = await as(browser, 'maker')
      // I59.11: the ask is on the task's own page.
      await maker.goto(`/my-work/task/${taskTwo.id}`)
      await maker.getByTestId(`${control}-ask`).click()
      await expect(maker.getByTestId(`${dlg}-dialog`)).toBeVisible()
      await maker.getByTestId(`${dlg}-day`).fill(asked)
      const line = maker.getByTestId(`${dlg}-arithmetic`)
      await expect(line).toBeVisible()
      // The line renders on the Iraq default first and again once the office calendar and the
      // settings have landed; read it only once two consecutive reads agree.
      let text = (await line.textContent()) ?? ''
      for (let i = 0; i < 10; i++) {
        await maker.waitForTimeout(700)
        const again = (await line.textContent()) ?? ''
        if (again === text) break
        text = again
      }
      const out = { text, severity: (await line.getAttribute('data-severity')) ?? '' }
      await maker.keyboard.press('Escape')
      await maker.context().close()
      return out
    }
    async function setBuffer(days: number) {
      const admin = await as(browser, 'admin')
      await admin.goto('/admin/organization')
      await expect(admin.getByTestId('scheduling-settings-form')).toBeVisible()
      const field = admin.getByTestId('scheduling-review-buffer')
      if ((await field.inputValue()) === String(days)) { await admin.context().close(); return } // Save is off until something changes
      await field.fill(String(days))
      await admin.getByTestId('scheduling-settings-save').click()
      await expect.poll(async () => (await rows<{ review_buffer_working_days: number }>('tenant_reminder_settings', 'select=review_buffer_working_days'))[0].review_buffer_working_days).toBe(days)
      await admin.context().close()
    }

    await setBuffer(1) // the default — stated, so a previous run's setting cannot leak in
    const before = await readArithmetic()
    expect(before.text, before.text).toMatch(/Leaves \d+ working days/)
    expect(bufferOf(before.text)).toBe(1)
    expect(daysOf(before.text)).toBeGreaterThan(1)

    await setBuffer(3)
    const withBuffer = await readArithmetic()
    expect(bufferOf(withBuffer.text)).toBe(3)
    expect(daysOf(withBuffer.text)).toBe(daysOf(before.text)) // the days are the same; what they are measured against changed

    // A closure on a working day inside the window takes one working day off the count.
    const admin = await as(browser, 'admin')
    await admin.goto('/people/leave')
    await admin.getByTestId('closure-add').click()
    const dialog = admin.getByTestId('closure-dialog')
    await dialog.getByTestId('closure-office').selectOption({ label: 'Baghdad' })
    await dialog.getByTestId('closure-kind').selectOption('public_holiday')
    const closureName = `K7 closure ${Date.now()}`
    await dialog.getByTestId('closure-name').fill(closureName)
    await dialog.getByTestId('closure-start').fill(closureDay)
    await dialog.getByTestId('closure-end').fill(closureDay)
    await dialog.getByTestId('closure-submit').click()
    await expect(admin.getByTestId('closures-table')).toContainText(closureName)
    await admin.context().close()
    const withClosure = await readArithmetic()
    expect(daysOf(withClosure.text)).toBe(daysOf(before.text) - 1)

    // Put the organisation back the way it was.
    const admin2 = await as(browser, 'admin')
    await admin2.goto('/people/leave')
    const [closure] = await rows<{ id: string }>('office_closures', `select=id&name=eq.${encodeURIComponent(closureName)}`)
    const del = admin2.getByTestId(`closure-delete-${closure.id}`)
    await del.click()
    await del.click() // two-step delete
    await expect(admin2.getByTestId(`closure-row-${closure.id}`)).toHaveCount(0)
    await admin2.context().close()
    await setBuffer(1)
  })

  test('K5 — archiving a job calls off the work under it', async ({ browser }) => {
    const am = await as(browser, 'am')
    await am.goto(`/deliverables?campaign=${two.campaignId}`)
    await expect(am.getByTestId(`deliverable-row-${two.deliverableId}`)).toBeVisible()
    // With live work under it the action reads "Cancel job", and the confirmation names that work (ADR-0080 d.7).
    await am.getByTestId(`deliverable-cancelJob-${two.deliverableId}`).click()
    const confirm = am.getByTestId('deliverable-archive-confirm-confirm')
    await expect(confirm).toBeVisible()
    await confirm.click()
    await expect(am.getByTestId(`deliverable-cancelJob-${two.deliverableId}`)).toHaveCount(0)
    await am.context().close()

    const [d] = await rows<{ state: string }>('deliverables', `select=state&id=eq.${two.deliverableId}`)
    expect(d.state).toBe('archived')
    const [t] = await rows<{ status: string }>('sub_tasks', `select=status&id=eq.${taskTwo.id}`)
    expect(t.status).toBe('cancelled')
    expect(await rows('bookings', `select=id&sub_task_id=eq.${taskTwo.id}`)).toHaveLength(0)
    const told = await waitForNotification(PEOPLE.maker.email, 'cancelled', 8_000, taskTwo.id)
    expect(told.entity_id).toBe(taskTwo.id)

    const maker = await as(browser, 'maker')
    await maker.goto('/my-work')
    await expect(maker.getByTestId('today-tasks-panel')).toBeVisible()
    // Gone from every list (I59.10 split "Upcoming" into This week and Later).
    await expect(maker.getByTestId(`my-work-item-${taskTwo.id}`)).toHaveCount(0)
    await maker.context().close()
  })

  test('K6 — change the promised date: the arithmetic with hours, evidence asked for but never required (E5), override recorded, after go-live warns', async ({ browser }) => {
    const [northwind] = await rows<{ id: string; go_live_at: string }>('campaigns', `select=id,go_live_at&name=eq.${encodeURIComponent('Northwind Summer Launch')}`)
    const goLive = northwind.go_live_at.slice(0, 10)
    const [deliverable] = await rows<{ id: string; due_at: string | null }>('deliverables', `select=id,due_at,streams!inner(campaign_id)&streams.campaign_id=eq.${northwind.id}&name=eq.${encodeURIComponent('Key visual - summer range')}`)

    const am = await as(browser, 'am')
    await mockBucket(am)
    await am.goto(`/campaigns/${northwind.id}`)
    await am.getByTestId('campaign-tab-grid').click()
    // CG-E1 (I57.11): the date is changed from the piece's Edit dialog — its Due field opens the
    // evidenced dialog, and closing that hands back to Edit.
    // ADR-0132 d.3: the grid's Edit opens the panel; a date the CLIENT asked for goes by "The client asked for a
    // change", the Edit dialog whose Due opens the evidenced dialog walked here.
    await am.getByTestId(`campaign-deliverable-edit-${deliverable.id}`).click()
    await am.getByTestId('piece-panel-client-change').click()
    await am.getByTestId('campaign-deliverable-form-due').click()
    const prefix = 'deliverable-due-change'
    await expect(am.getByTestId(`${prefix}-dialog`)).toBeVisible()
    // Esc closes it, back to Edit; reopened for the rest.
    await am.keyboard.press('Escape')
    await expect(am.getByTestId(`${prefix}-dialog`)).toHaveCount(0)
    await expect(am.getByTestId('campaign-deliverable-form')).toBeVisible()
    await am.getByTestId('campaign-deliverable-form-due').click()
    await expect(am.getByTestId(`${prefix}-dialog`)).toBeVisible()

    // After go-live (ADR-0093): a warning naming the client's agreement — not a refusal. The evidence
    // is asked for and never blocks (I59 E5, relaxing ADR-0088 d.7a): Save is on without it.
    await am.getByTestId(`${prefix}-day`).fill(shift(goLive, 3))
    const late = am.getByTestId(`${prefix}-warning`)
    await expect(late).toHaveAttribute('data-severity', 'after_go_live')
    await expect(late).toContainText(/client's agreement/)
    await expect(am.getByTestId(`${prefix}-evidence-hint`)).toBeVisible()
    await expect(am.getByTestId(`${prefix}-save`)).toBeEnabled()

    // Inside the window: the last working day before go-live leaves fewer days than the rule asks —
    // the tight/impossible line, now with hours.
    let tightDay = shift(goLive, -1)
    while (!isBaghdadWorkingDay(tightDay)) tightDay = shift(tightDay, -1)
    // A previous run may have left it exactly there ("that is already the promised date"): move it
    // to a comfortable day first — no warning, no override — so the change below is a change.
    const iraqDay = (iso: string) => new Date(Date.parse(iso) + 3 * 3_600_000).toISOString().slice(0, 10)
    if (deliverable.due_at && iraqDay(deliverable.due_at) === tightDay) {
      await am.getByTestId(`${prefix}-day`).fill(shift(goLive, -12))
      await expect(am.getByTestId(`${prefix}-warning`)).toHaveCount(0)
      await am.getByTestId(`${prefix}-evidence`).setInputFiles(PNG_PATH)
      await am.getByTestId(`${prefix}-save`).click()
      await expect(am.getByTestId(`${prefix}-dialog`)).toHaveCount(0)
      deliverable.due_at = (await rows<{ due_at: string }>('deliverables', `select=due_at&id=eq.${deliverable.id}`))[0].due_at
      await am.getByTestId('campaign-deliverable-form-due').click()
      await expect(am.getByTestId(`${prefix}-dialog`)).toBeVisible()
    }
    await am.getByTestId(`${prefix}-day`).fill(tightDay)
    const warning = am.getByTestId(`${prefix}-warning`)
    await expect(warning).toBeVisible()
    const severity = await warning.getAttribute('data-severity')
    expect(['tight', 'impossible']).toContain(severity)
    await expect(warning).toContainText(/\d+h of work outstanding against \d+h/)
    // E5: no evidence does not stop the save; here it is attached, so the change is logged with it.
    await expect(am.getByTestId(`${prefix}-save`)).toBeEnabled()
    await am.getByTestId(`${prefix}-evidence`).setInputFiles(PNG_PATH)
    await am.getByTestId(`${prefix}-note`).fill('Client agreed the later date on the call.')
    await am.getByTestId(`${prefix}-save`).click()
    await expect(am.getByTestId(`${prefix}-dialog`)).toHaveCount(0)
    await am.getByTestId('campaign-deliverable-form-cancel').click()
    await am.context().close()

    const [after] = await rows<{ due_at: string | null }>('deliverables', `select=due_at&id=eq.${deliverable.id}`)
    expect(after.due_at).not.toBe(deliverable.due_at)
    expect(new Date(Date.parse(after.due_at!) + 3 * 3_600_000).toISOString().slice(0, 10)).toBe(tightDay)
    const overrides = await slaEvents(deliverable.id, 'due_date_override')
    expect(overrides.length).toBeGreaterThan(0)
    expect(overrides[0].payload).toMatchObject({ severity })
  })

  test('K6b — the go-live day is impossible and a later day is after go-live: both warn, both save, both are recorded (ADR-0093)', async ({ browser }) => {
    const [northwind] = await rows<{ id: string; go_live_at: string }>('campaigns', `select=id,go_live_at&name=eq.${encodeURIComponent('Northwind Summer Launch')}`)
    const goLive = new Date(Date.parse(northwind.go_live_at) + 3 * 3_600_000).toISOString().slice(0, 10) // the Iraq day
    const [deliverable] = await rows<{ id: string; due_at: string | null }>('deliverables', `select=id,due_at,streams!inner(campaign_id)&streams.campaign_id=eq.${northwind.id}&name=eq.${encodeURIComponent('Social statics')}`)
    const iraqDay = (iso: string) => new Date(Date.parse(iso) + 3 * 3_600_000).toISOString().slice(0, 10)
    const prefix = 'deliverable-due-change'
    const am = await as(browser, 'am')
    await mockBucket(am)
    await am.goto(`/campaigns/${northwind.id}`)
    await am.getByTestId('campaign-tab-grid').click()

    async function moveTo(day: string, severity: 'impossible' | 'after_go_live') {
      await am.getByTestId(`campaign-deliverable-edit-${deliverable.id}`).click()
      await am.getByTestId('piece-panel-client-change').click()   // the client's route (ADR-0132 d.3)
      await am.getByTestId('campaign-deliverable-form-due').click()
      await expect(am.getByTestId(`${prefix}-dialog`)).toBeVisible()
      await am.getByTestId(`${prefix}-day`).fill(day)
      await expect(am.getByTestId(`${prefix}-warning`)).toHaveAttribute('data-severity', severity)
      await am.getByTestId(`${prefix}-evidence`).setInputFiles(PNG_PATH)
      await am.getByTestId(`${prefix}-save`).click()
      await expect(am.getByTestId(`${prefix}-error`)).toHaveCount(0)
      await expect(am.getByTestId(`${prefix}-dialog`)).toHaveCount(0)
      await am.getByTestId('campaign-deliverable-form-cancel').click()
      const [after] = await rows<{ due_at: string }>('deliverables', `select=due_at&id=eq.${deliverable.id}`)
      expect(iraqDay(after.due_at)).toBe(day)
      const overrides = await slaEvents(deliverable.id, 'due_date_override')
      expect(overrides[0]?.payload).toMatchObject({ severity })
    }
    // A previous run may have left the date on one of these days; the other is then a change.
    const current = deliverable.due_at ? iraqDay(deliverable.due_at) : ''
    if (current !== goLive) await moveTo(goLive, 'impossible')
    await moveTo(shift(goLive, 2), 'after_go_live')
    if (current === goLive) await moveTo(goLive, 'impossible')
    await am.context().close()
  })
})
