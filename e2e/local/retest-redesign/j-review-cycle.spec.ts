import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { attemptWrite, rows, userIdOf, waitForNotification } from '../helpers/db'
import { releaseSingleJob, type ReleasedJob } from '../helpers/single-job'
import { approveTaskList } from '../helpers/piece'

/**
 * docs/RETEST-REDESIGN.md — J: the review cycle (ADR-0089: one required reviewer, the others
 * answer before they approve; ADR-0059 manual review mode).
 *
 * Fixture: one typed Creative single job, task list approved, and two of its tasks booked on the
 * maker by Traffic in MANUAL review mode (the artefact is the maker's note, so no file upload is
 * needed). Task A carries three reviewers — the department lead (required) and two team leads
 * (optional); task B carries the lead alone, for the late appointment in J3.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}

function sundayOut(weeksOut: number): string {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + 7 * weeksOut + ((7 - d.getUTCDay()) % 7))
  return d.toISOString().slice(0, 10)
}
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

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

/** Book a task on the maker in manual mode with the named reviewers (the first added is the required one). */
async function bookManual(page: Page, resourceId: string, day: string, taskTitle: string, reviewerNames: string[]) {
  await openAdd(page, resourceId, day)
  const mode = page.getByTestId('mode-project')
  if (await mode.count()) await mode.check()
  await page.getByTestId('booking-project').selectOption({ label: job.title })
  await page.getByTestId('booking-deliverable-select').selectOption({ index: 1 })
  await page.getByTestId('booking-subtask-select').selectOption({ label: taskTitle })
  for (const name of reviewerNames) await page.getByTestId('booking-project-reviewer-add').selectOption({ label: name })
  await page.getByTestId('booking-review-mode').selectOption('manual')
  await page.getByTestId('booking-hours').fill('4')
  await book(page)
}

/** The maker starts the task (from todo), writes this round's note and submits it for review. */
async function makerSubmits(page: Page, taskId: string, note: string) {
  await page.goto('/my-work')
  await expect(page.getByTestId(`my-work-item-${taskId}`)).toBeVisible()
  // I59.11: the note and Send are on the task's own page (the Submit dialog is retired).
  await page.getByTestId(`my-work-open-${taskId}`).click()
  await expect(page.getByTestId('task-page')).toBeVisible()
  const start = page.getByTestId(`my-work-start-${taskId}`)
  if (await start.count()) await start.click()
  const submit = page.getByTestId(`my-work-submit-${taskId}`)
  await expect(submit).toBeVisible()
  await page.getByTestId(`task-comment-body-${taskId}`).fill(note)
  await page.getByTestId(`task-comment-submit-${taskId}`).click()
  await expect(page.getByTestId(`task-review-gate-${taskId}`)).toContainText(/you can submit/i)
  await expect(submit).toBeEnabled()
  await submit.click()
  // ADR-0106 (I59.20): sent seconds after Start — under the tenant's untimed threshold — the round
  // is untimed, so the warning comes first, every time here; Send anyway records it as untimed.
  await expect(page.getByTestId('untimed-dialog')).toBeVisible()
  await page.getByTestId('untimed-send').click()
  await expect(page.getByTestId('task-page-status')).toHaveAttribute('data-status', 'review')
  await expect.poll(async () => (await rows<{ status: string }>('sub_tasks', `select=status&id=eq.${taskId}`))[0].status).toBe('review')
}

/** Open the review modal on My Work as the signed-in reviewer. */
async function openReview(page: Page, taskId: string) {
  await page.goto('/my-work')
  await expect(page.getByTestId('needs-you-panel')).toBeVisible()
  await page.getByTestId(`awaiting-review-open-${taskId}`).click()
  await expect(page.getByTestId(`awaiting-review-modal-${taskId}`)).toBeVisible()
}

type ReviewerRow = { id: string; user_id: string; is_mandatory: boolean; approved_at: string | null; responded_at: string | null; response: string | null }
const reviewerRows = (taskId: string) =>
  rows<ReviewerRow>('sub_task_reviewers', `select=id,user_id,is_mandatory,approved_at,responded_at,response&sub_task_id=eq.${taskId}&order=created_at.asc`)

let job: ReleasedJob
let tasks: { id: string; title: string }[]
let taskA: { id: string; title: string }
let taskB: { id: string; title: string }
let maker: string
let ids: Record<'lead' | 'tl' | 'motiontl' | 'deputy' | 'maker', string>

test.describe('Section J — review cycle', () => {
  // J2 → J3 → J4 are one review cycle on one job: J4 reads the feedback_collected J2's last answer raised.
  // Without serial mode a failure restarts the worker, beforeAll makes a NEW job, and the later tests
  // fail on a fixture they never set up (the 5 Oct run: J4 "no feedback_collected" after J3 failed).
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ browser }) => {
    const am = await as(browser, 'am')
    job = await releaseSingleJob(am, { title: `J review ${Date.now()}`, department: 'Creative', type: 'Social Advertisement' })
    await am.context().close()
    const lead = await as(browser, 'lead')
    // The task list is approved on the campaign piece panel now (I71.1, ADR-0140); the Creative lead may (I74.51).
    await approveTaskList(lead, job)
    await lead.context().close()
    tasks = await rows<{ id: string; title: string }>('sub_tasks', `select=id,title&deliverable_id=eq.${job.deliverableId}&order=sort_order.asc`)
    expect(tasks.length).toBeGreaterThanOrEqual(2)
    ;[taskA, taskB] = tasks
    const [r] = await rows<{ id: string }>('resources', `select=id&name=eq.${encodeURIComponent(PEOPLE.maker.name)}&is_active=eq.true`)
    maker = r.id
    ids = {
      lead: await userIdOf(PEOPLE.lead.email),
      tl: await userIdOf(PEOPLE.tl.email),
      motiontl: await userIdOf(PEOPLE.motiontl.email),
      deputy: await userIdOf(PEOPLE.deputy.email),
      maker: await userIdOf(PEOPLE.maker.email),
    }

    const traffic = await as(browser, 'traffic')
    const day = sundayOut(6)
    await bookManual(traffic, maker, day, taskA.title, [PEOPLE.lead.name, PEOPLE.tl.name, PEOPLE.motiontl.name])
    await bookManual(traffic, maker, shift(day, 1), taskB.title, [PEOPLE.lead.name])
    await traffic.context().close()
  })

  test('J1 — one reviewer is required by definition; several with none marked are refused', async ({ browser }) => {
    // Three appointed, exactly one required — the first added, which the picker marked.
    const a = await reviewerRows(taskA.id)
    expect(a.map((r) => r.user_id).sort()).toEqual([ids.lead, ids.tl, ids.motiontl].sort())
    expect(a.filter((r) => r.is_mandatory).map((r) => r.user_id)).toEqual([ids.lead])
    // A lone reviewer is the required one whether or not anybody ticked it (d.2).
    const b = await reviewerRows(taskB.id)
    expect(b).toHaveLength(1)
    expect(b[0].user_id).toBe(ids.lead)
    expect(b[0].is_mandatory).toBe(true)

    // The picker will not untick the last required mark (d.3): tick the other first.
    const traffic = await as(browser, 'traffic')
    const [booking] = await rows<{ id: string }>('bookings', `select=id&sub_task_id=eq.${taskA.id}`)
    await traffic.goto(`/schedule?on=${sundayOut(6)}`)
    await traffic.getByTestId(`booking-${booking.id}`).click()
    await expect(traffic.getByTestId('edit-dialog')).toBeVisible()
    const leadMark = traffic.getByTestId(`edit-task-reviewer-mandatory-${ids.lead}`)
    await expect(leadMark).toBeChecked()
    await expect(leadMark).toBeDisabled()
    await traffic.getByTestId(`edit-task-reviewer-mandatory-${ids.tl}`).check()
    await expect(leadMark).toBeEnabled()
    await traffic.keyboard.press('Escape')
    await expect(traffic.getByTestId('edit-dialog')).toHaveCount(0)
    await traffic.context().close()

    // And the database refuses the state the picker cannot reach: three reviewers, none marked.
    const res = await attemptWrite('PATCH', 'sub_task_reviewers', `sub_task_id=eq.${taskA.id}&user_id=eq.${ids.lead}`, { is_mandatory: false })
    expect(res.status, res.text).toBeGreaterThanOrEqual(400)
    expect(res.text).toMatch(/23514|must be marked required/)
    const after = await reviewerRows(taskA.id)
    expect(after.filter((r) => r.is_mandatory).map((r) => r.user_id)).toEqual([ids.lead])
  })

  test('J2 — optional reviewers answer, do not approve; the required approval is a hard wait on every answer', async ({ browser }) => {
    const makerPage = await as(browser, 'maker')
    await makerPage.goto('/my-work')
    await expect(makerPage.getByTestId(`my-work-review-mode-${taskA.id}`)).toBeVisible() // manual, said on the row
    await makerSubmits(makerPage, taskA.id, 'Shot four setups, all approved on set.')
    await makerPage.context().close()
    // Everyone appointed is told — I52 Action 4: the row names the TASK, and the required reviewer
    // (the lead) is asked to review while the optional ones (tl, motiontl) are asked for feedback.
    const nLead = await waitForNotification(PEOPLE.lead.email, 'review_requested', 8_000, taskA.id)
    expect(nLead.entity_id).toBe(taskA.id)
    for (const tag of ['tl', 'motiontl'] as const) {
      const n = await waitForNotification(PEOPLE[tag].email, 'feedback_requested', 8_000, taskA.id)
      expect(n.entity_id).toBe(taskA.id)
    }

    // The required reviewer: Approve withheld, naming who has not answered; no Done.
    const lead = await as(browser, 'lead')
    await openReview(lead, taskA.id)
    await expect(lead.getByTestId(`awaiting-review-mine-mandatory-${taskA.id}`)).toBeVisible()
    const waiting = lead.getByTestId(`awaiting-review-waiting-for-answers-${taskA.id}`)
    await expect(waiting).toContainText(PEOPLE.tl.name)
    await expect(waiting).toContainText(PEOPLE.motiontl.name)
    await expect(lead.getByTestId(`awaiting-review-approve-${taskA.id}`)).toBeDisabled()
    await expect(lead.getByTestId(`awaiting-review-respond-${taskA.id}`)).toHaveCount(0)
    await lead.context().close()

    // An optional reviewer: no Approve; leaves feedback, then Done reads "feedback left".
    const tl = await as(browser, 'tl')
    await openReview(tl, taskA.id)
    await expect(tl.getByTestId(`awaiting-review-approve-${taskA.id}`)).toHaveCount(0)
    const done = tl.getByTestId(`awaiting-review-respond-${taskA.id}`)
    await expect(done).toContainText(/no comment/i)
    await tl.getByTestId(`task-comment-body-${taskA.id}`).fill('Setup 3 is soft — please check focus on the wide.')
    await tl.getByTestId(`task-comment-submit-${taskA.id}`).click()
    await expect(done).toContainText(/feedback left/i)
    await done.click()
    await expect(tl.getByTestId(`awaiting-review-modal-${taskA.id}`)).toHaveCount(0)
    await tl.context().close()
    let rowsA = await reviewerRows(taskA.id)
    const tlRow = rowsA.find((r) => r.user_id === ids.tl)!
    expect(tlRow.response).toBe('feedback')
    expect(tlRow.responded_at).toBeTruthy()
    expect(tlRow.approved_at).toBeNull()
    // One answer in, one still out: the required reviewer has NOT been told the round is complete.
    const early = await rows('notifications', `select=id&type=eq.feedback_collected&user_id=eq.${ids.lead}&entity_id=eq.${job.deliverableId}`)
    expect(early).toHaveLength(0)

    // The other optional reviewer answers with no comment — the last answer.
    const motion = await as(browser, 'motiontl')
    await openReview(motion, taskA.id)
    const done2 = motion.getByTestId(`awaiting-review-respond-${taskA.id}`)
    await expect(done2).toContainText(/no comment/i)
    await done2.click()
    await expect(motion.getByTestId(`awaiting-review-modal-${taskA.id}`)).toHaveCount(0)
    await motion.context().close()
    rowsA = await reviewerRows(taskA.id)
    expect(rowsA.find((r) => r.user_id === ids.motiontl)!.response).toBe('no_comment')
    const [task] = await rows<{ status: string }>('sub_tasks', `select=status&id=eq.${taskA.id}`)
    expect(task.status).toBe('review') // answers complete nothing
  })

  test('J3 — a reviewer appointed after submit is told; the picker corrects the reviewers', async ({ browser }) => {
    const makerPage = await as(browser, 'maker')
    await makerSubmits(makerPage, taskB.id, 'Print proofs checked against the brand sheet.')
    await makerPage.context().close()
    await waitForNotification(PEOPLE.lead.email, 'review_requested', 8_000, taskB.id)

    // Traffic reopens the booking and adds the deputy as an optional reviewer.
    const traffic = await as(browser, 'traffic')
    const [booking] = await rows<{ id: string }>('bookings', `select=id&sub_task_id=eq.${taskB.id}`)
    await traffic.goto(`/schedule?on=${shift(sundayOut(6), 1)}`)
    await traffic.getByTestId(`booking-${booking.id}`).click()
    await expect(traffic.getByTestId('edit-dialog')).toBeVisible()
    await traffic.getByTestId('edit-task-reviewer-add').selectOption({ label: PEOPLE.deputy.name })
    await expect(traffic.getByTestId(`edit-task-reviewer-mandatory-${ids.deputy}`)).not.toBeChecked()
    await traffic.getByTestId('edit-task-save').click()
    await expect(traffic.getByTestId('edit-dialog')).toHaveCount(0)
    let b = await reviewerRows(taskB.id)
    expect(b.map((r) => r.user_id).sort()).toEqual([ids.lead, ids.deputy].sort())
    // Told, though the task was already in review when they were appointed (ADR-0089 d.10).
    const told = await waitForNotification(PEOPLE.deputy.email, 'feedback_requested', 8_000, taskB.id)
    expect(told.entity_id).toBe(taskB.id)   // an optional reviewer, on the task (I52 Action 4)

    // The deputy is now a hard wait for the lead …
    const lead = await as(browser, 'lead')
    await openReview(lead, taskB.id)
    await expect(lead.getByTestId(`awaiting-review-waiting-for-answers-${taskB.id}`)).toContainText(PEOPLE.deputy.name)
    await expect(lead.getByTestId(`awaiting-review-approve-${taskB.id}`)).toBeDisabled()
    await lead.context().close()

    // … and the picker takes them off again: the correction is on the record and the wait is gone.
    await traffic.getByTestId(`booking-${booking.id}`).click()
    await expect(traffic.getByTestId('edit-dialog')).toBeVisible()
    await traffic.getByTestId(`edit-task-reviewer-remove-${ids.deputy}`).click()
    await traffic.getByTestId('edit-task-save').click()
    await expect(traffic.getByTestId('edit-dialog')).toHaveCount(0)
    await traffic.context().close()
    b = await reviewerRows(taskB.id)
    expect(b.map((r) => r.user_id)).toEqual([ids.lead])

    const lead2 = await as(browser, 'lead')
    await openReview(lead2, taskB.id)
    await expect(lead2.getByTestId(`awaiting-review-waiting-for-answers-${taskB.id}`)).toHaveCount(0)
    await expect(lead2.getByTestId(`awaiting-review-approve-${taskB.id}`)).toBeEnabled()
    await lead2.context().close()
  })

  test('J4 — request-changes round-trips; feedback_collected reaches the required reviewer on the last answer; approval completes', async ({ browser }) => {
    // The last answer of J2 told the lead the round was complete.
    const collected = await waitForNotification(PEOPLE.lead.email, 'feedback_collected', 8_000, taskA.id)
    expect(collected.entity_id).toBe(taskA.id)   // on the task (I52 Action 11)

    // The lead sends it back on the team lead's unresolved comment: todo, next revision, maker told,
    // every answer cleared (an answer belongs to a version — d.8).
    const [before] = await rows<{ revision_number: number }>('sub_tasks', `select=revision_number&id=eq.${taskA.id}`)
    const lead = await as(browser, 'lead')
    await openReview(lead, taskA.id)
    await expect(lead.getByTestId(`awaiting-review-waiting-for-answers-${taskA.id}`)).toHaveCount(0)
    await expect(lead.getByTestId(`awaiting-review-approve-${taskA.id}`)).toBeEnabled()
    await lead.getByTestId(`awaiting-review-request-changes-${taskA.id}`).click()
    await expect(lead.getByTestId(`awaiting-review-modal-${taskA.id}`)).toHaveCount(0)
    await lead.context().close()
    const [reopened] = await rows<{ status: string; revision_number: number }>('sub_tasks', `select=status,revision_number&id=eq.${taskA.id}`)
    expect(reopened.status).toBe('todo')
    expect(reopened.revision_number).toBe(before.revision_number + 1)
    const changes = await waitForNotification(PEOPLE.maker.email, 'changes_requested')
    expect(changes.entity_id).toBe(taskA.id)
    for (const r of await reviewerRows(taskA.id)) {
      expect(r.responded_at, `${r.user_id} answer cleared`).toBeNull()
      expect(r.approved_at).toBeNull()
    }

    // Round two: the maker resubmits, both optional reviewers answer, the lead is told again.
    const makerPage = await as(browser, 'maker')
    await makerPage.goto('/my-work')
    // I59.10: the maker is told in Needs you — "Changes came back" (the row's Review feedback retired).
    await expect(makerPage.getByTestId(`needs-you-changes_back-${taskA.id}`)).toBeVisible()
    await makerSubmits(makerPage, taskA.id, 'Re-shot setup 3 with focus checked on the wide.')
    await makerPage.context().close()
    for (const tag of ['tl', 'motiontl'] as const) {
      const p = await as(browser, tag)
      await openReview(p, taskA.id)
      await p.getByTestId(`awaiting-review-respond-${taskA.id}`).click()
      await expect(p.getByTestId(`awaiting-review-modal-${taskA.id}`)).toHaveCount(0)
      await p.context().close()
    }
    await expect.poll(async () =>
      (await rows('notifications', `select=id&type=eq.feedback_collected&user_id=eq.${ids.lead}&entity_id=eq.${taskA.id}`)).length,
    ).toBe(2)

    // The completing approval.
    const lead2 = await as(browser, 'lead')
    await openReview(lead2, taskA.id)
    await lead2.getByTestId(`awaiting-review-approve-${taskA.id}`).click()
    await expect(lead2.getByTestId(`awaiting-review-modal-${taskA.id}`)).toHaveCount(0)
    await expect(lead2.getByTestId(`awaiting-review-item-${taskA.id}`)).toHaveCount(0)
    await lead2.context().close()
    const [done] = await rows<{ status: string }>('sub_tasks', `select=status&id=eq.${taskA.id}`)
    expect(done.status).toBe('done')
    const signed = await waitForNotification(PEOPLE.maker.email, 'signed_off')
    expect(signed.entity_id).toBe(taskA.id)
  })
})
