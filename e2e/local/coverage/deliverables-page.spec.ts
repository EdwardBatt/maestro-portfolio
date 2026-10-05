import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows, userIdOf } from '../helpers/db'
import { clearMailbox, expectMail, expectNoMail } from '../helpers/mailpit'
import { releaseSingleJob, type ReleasedJob } from '../helpers/single-job'
import { addTaskOnPanel, approveTaskList, assignOnSchedule, workingDayFor } from '../helpers/piece'

/**
 * Coverage — the Deliverables page and the deliverable detail (I49.3: 27 controls).
 *
 * The rule (I49.0): every control is used by one person who MAY and one who MAY NOT, and the
 * outcome is checked in the database, not just on the screen. A refusal is worded and offers no
 * Report. This file is the pattern for the other 63 screens.
 *
 * Actors: `am` releases a Creative single job; `lead` (Creative dept lead) OWNS its deliverable and
 * is the "may" for every task-list control; `traffic` for the owner-change controls
 * (deliverable_owner:manage); `maker` (Creative) does a task so a reviewer has something to send
 * back; `content` (Content dept lead — the grant, not the reach) is the "may not"; `writer`
 * (Content team member) is not offered the controls at all.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}
type Task = { id: string; title: string; status: string; sort_order: number; assignee_id: string | null; due_at: string | null; review_mode: string; sla_hours: number | null; department_id: string | null }
const tasksOf = (deliverableId: string) =>
  rows<Task>('sub_tasks', `select=id,title,status,sort_order,assignee_id,due_at,review_mode,sla_hours,department_id&deliverable_id=eq.${deliverableId}&order=sort_order.asc`)
const dueIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
/** Every write on this page answers with a "Done" dialog (ADR-0092 d.2); it must be closed before
 *  the next press, and its being a SUCCESS is part of what is asserted. */
async function done(page: Page) {
  const banner = page.getByTestId('deliverables-banner')
  await expect(banner).toBeVisible()
  await expect(banner).not.toContainText(/outside your reach|could not|did not work/i)
  await page.getByTestId('deliverables-banner-close').click()
  await expect(page.getByTestId('deliverables-banner-dialog')).toHaveCount(0)
}

let job: ReleasedJob
let seeded: Task[]

test.describe('Coverage — Deliverables page', () => {
  test.beforeAll(async ({ browser }) => {
    const am = await as(browser, 'am')
    job = await releaseSingleJob(am, { title: `Cov deliverables ${Date.now()}`, department: 'Creative', type: 'Social Advertisement' })
    await am.context().close()
    // The owner approves the task list on the piece's panel (ADR-0132 d.2; I71.1).
    const lead = await as(browser, 'lead')
    await approveTaskList(lead, job)
    await lead.context().close()
    seeded = await tasksOf(job.deliverableId)
    expect(seeded.length).toBeGreaterThanOrEqual(2)
  })

  test('the page: tabs, the campaign picker, search with its count, a filter and its clear, opening a row', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await lead.goto('/deliverables')
    await expect(lead.getByTestId('surface-deliverables')).toBeVisible()

    // Tabs: ad-hoc shows no campaign picker; campaign shows it.
    await lead.getByTestId('deliverables-tab-adhoc').click()
    await expect(lead.getByTestId('deliverables-tab-adhoc')).toHaveAttribute('aria-pressed', 'true')
    await expect(lead.getByTestId('deliverables-campaign')).toHaveCount(0)
    await lead.getByTestId('deliverables-tab-campaign').click()
    await expect(lead.getByTestId('deliverables-campaign')).toBeVisible()

    // The picker lists the job; picking it shows its one deliverable.
    await lead.getByTestId('deliverables-campaign').selectOption({ label: job.title })
    const row = lead.getByTestId(`deliverable-row-${job.deliverableId}`)
    await expect(row).toBeVisible()

    // Search narrows and says how many are shown; a miss shows the group's empty line, never a blank.
    const search = lead.getByTestId('deliverables-search-live')
    await search.fill('no such deliverable zzz')
    await expect(lead.getByTestId('deliverables-search-count-live')).toContainText('0')
    await expect(lead.getByTestId('deliverable-group-empty-live')).toBeVisible()
    await search.fill('')
    await expect(row).toBeVisible()

    // A filter narrows by a value taken from the rows; Clear restores.
    const phase = lead.getByTestId('deliverable-filter-phase')
    await expect(phase).toBeVisible()
    const values = await phase.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean))
    expect(values.length).toBeGreaterThan(0)
    await phase.selectOption(values[0])
    await expect(lead.getByTestId('deliverable-filters-clear')).toBeVisible()
    await lead.getByTestId('deliverable-filters-clear').click()
    await expect(lead.getByTestId('deliverable-filters-clear')).toHaveCount(0)
    await expect(phase).toHaveValue('')

    // Open → a campaign's deliverable opens on its campaign page with the piece's panel (ADR-0132 d.8; I71.1),
    // never the retired window.
    await lead.getByTestId(`deliverable-open-${job.deliverableId}`).click()
    await expect(lead).toHaveURL(new RegExp(`/campaigns/${job.campaignId}\\?.*piece=${job.deliverableId}`), { timeout: 20_000 })
    await expect(lead.getByTestId('piece-panel')).toBeVisible()
    await expect(lead.getByTestId('deliverable-detail-dialog')).toHaveCount(0)
    await lead.context().close()
  })

  // I71.8 (Edward, 1 Oct, B): retired — it drives the retired deliverable window (ADR-0132 d.8); the task-scheduling rework brings its replacement. Here: the add form, reorder and the unassigned filter exist only on the retired window.
  test.skip('the owner adds a task with every field, edits it, cancels an edit, reorders, filters to unassigned', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await lead.goto(`/deliverables?open=${job.deliverableId}`)
    await expect(lead.getByTestId('deliverable-detail-dialog')).toBeVisible()

    // ---- Add: every field on the form. I51.5: the form is a dialog — opened, closed without saving
    // (nothing written), opened again; the name is the only field it insists on.
    await lead.getByTestId('subtask-add-open').click()
    await lead.getByTestId('subtask-title').fill('Never saved')
    await lead.getByTestId('subtask-add-cancel').click()
    await expect(lead.getByTestId('subtask-add-form')).toHaveCount(0)
    expect((await tasksOf(job.deliverableId)).some((t) => t.title === 'Never saved')).toBe(false)
    await lead.getByTestId('subtask-add-open').click()
    await lead.getByTestId('subtask-title').fill('Cov added task')
    await lead.getByTestId('subtask-assignee').selectOption({ label: PEOPLE.maker.name })
    await lead.getByTestId('subtask-reviewer-add').selectOption({ label: PEOPLE.tl.name })
    const sla = lead.getByTestId('subtask-sla-profile')
    const slaOptions = await sla.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean))
    if (slaOptions.length) await sla.selectOption(slaOptions[0])
    await lead.getByTestId('subtask-hours').fill('6')
    await lead.getByTestId('subtask-due').fill(dueIn(10))
    await lead.getByTestId('subtask-review-mode').selectOption('manual')
    await lead.getByTestId('subtask-add-submit').click()
    await done(lead)
    await expect.poll(async () => (await tasksOf(job.deliverableId)).some((t) => t.title === 'Cov added task')).toBe(true)
    const added = (await tasksOf(job.deliverableId)).find((t) => t.title === 'Cov added task')!
    expect(added.assignee_id).toBe(await userIdOf(PEOPLE.maker.email))
    expect(added.sla_hours).toBe(6)
    expect(added.review_mode).toBe('manual')
    expect(added.due_at?.slice(0, 10)).toBe(dueIn(10))
    expect(added.department_id).not.toBeNull()
    const reviewers = await rows<{ user_id: string; is_mandatory: boolean }>('sub_task_reviewers', `select=user_id,is_mandatory&sub_task_id=eq.${added.id}`)
    expect(reviewers).toEqual([{ user_id: await userIdOf(PEOPLE.tl.email), is_mandatory: true }])
    await expect(lead.getByTestId(`subtask-row-${added.id}`)).toBeVisible()
    await expect(lead.getByTestId(`subtask-review-mode-${added.id}`)).toContainText(/manual/i)

    // ---- Edit: pencil, change title / due / mode, save.
    await lead.getByTestId(`subtask-edit-${added.id}`).click()
    await lead.getByTestId(`subtask-edit-title-${added.id}`).fill('Cov added task v2')
    await lead.getByTestId(`subtask-edit-due-${added.id}`).fill(dueIn(12))
    await lead.getByTestId(`subtask-edit-review-mode-${added.id}`).selectOption('digital')
    await lead.getByTestId(`subtask-edit-save-${added.id}`).click()
    await done(lead)
    // The save moved the plan past the day committed at assignment (ADR-0088 d.10): the extension
    // request is OFFERED, pre-filled; declining it is the ordinary answer and the move stands.
    const offer = lead.getByTestId(`subtask-extension-offer-${added.id}-dialog`)
    await expect(offer).toBeVisible()
    await expect(lead.getByTestId(`subtask-extension-offer-${added.id}-day`)).toHaveValue(dueIn(12))
    await lead.getByTestId(`subtask-extension-offer-${added.id}-cancel`).click()
    await expect(offer).toHaveCount(0)
    await expect(lead.getByTestId(`subtask-edit-save-${added.id}`)).toHaveCount(0)
    await expect.poll(async () => (await tasksOf(job.deliverableId)).find((t) => t.id === added.id)!.title).toBe('Cov added task v2')
    const edited = (await tasksOf(job.deliverableId)).find((t) => t.id === added.id)!
    expect(edited.review_mode).toBe('digital')
    // The typed day was applied (the log says so) — and then, by ADR-0039, the task's span became
    // the envelope of its re-spread bookings, so its due date is the last booking's end, on or
    // before the day typed. Asserting the typed day on the row was wrong; it passed on 15 Sep
    // only because the spread happened to land on that day.
    const moves = await rows<{ payload: { due_at_to: string } }>('sla_events', `select=payload&sub_task_id=eq.${added.id}&event_type=eq.deadline_changed&order=created_at.asc`)
    expect(moves.some((m) => m.payload.due_at_to.slice(0, 10) === dueIn(12))).toBe(true)
    const lastBooking = await rows<{ ends_at: string }>('bookings', `select=ends_at&sub_task_id=eq.${added.id}&order=ends_at.desc&limit=1`)
    expect(edited.due_at).toBe(lastBooking[0]?.ends_at ?? edited.due_at)
    expect(edited.due_at!.slice(0, 10) <= dueIn(12)).toBe(true)

    // ---- Edit, then Cancel: nothing written.
    await lead.getByTestId(`subtask-edit-${added.id}`).click()
    await lead.getByTestId(`subtask-edit-title-${added.id}`).fill('Should not be saved')
    await lead.getByTestId(`subtask-edit-cancel-${added.id}`).click()
    await expect(lead.getByTestId(`subtask-edit-title-${added.id}`)).toHaveCount(0)
    await expect(lead.getByTestId(`subtask-row-${added.id}`)).toContainText('Cov added task v2')
    expect((await tasksOf(job.deliverableId)).find((t) => t.id === added.id)!.title).toBe('Cov added task v2')

    // ---- Reorder: the added task is last; up moves it, down moves it back. Dates untouched.
    const before = await tasksOf(job.deliverableId)
    expect(before[before.length - 1].id).toBe(added.id)
    await expect(lead.getByTestId(`subtask-move-down-${added.id}`)).toBeDisabled()
    // Reordering is silent — no "Done": the table itself is the confirmation.
    await lead.getByTestId(`subtask-move-up-${added.id}`).click()
    await expect.poll(async () => (await tasksOf(job.deliverableId)).findIndex((t) => t.id === added.id)).toBe(before.length - 2)
    expect((await tasksOf(job.deliverableId)).find((t) => t.id === added.id)!.due_at).toBe(edited.due_at)
    await lead.getByTestId(`subtask-move-down-${added.id}`).click()
    await expect.poll(async () => (await tasksOf(job.deliverableId)).findIndex((t) => t.id === added.id)).toBe(before.length - 1)
    await expect(lead.getByTestId(`subtask-move-up-${seeded[0].id}`)).toBeDisabled()

    // ---- Unassigned only: the added (assigned) task hides; the seeded (unassigned) ones stay.
    await expect(lead.getByTestId('deliverable-unassigned-count')).toContainText(String(seeded.length))
    await lead.getByTestId('deliverable-unassigned-filter').click()
    await expect(lead.getByTestId(`subtask-row-${added.id}`)).toHaveCount(0)
    await expect(lead.getByTestId(`subtask-row-${seeded[0].id}`)).toBeVisible()
    await lead.getByTestId('deliverable-unassigned-filter').click()
    await expect(lead.getByTestId(`subtask-row-${added.id}`)).toBeVisible()
    await lead.context().close()
  })

  test('resources on a task: add, remove', async ({ browser }) => {
    // The task page's Manage part carries the task's required resources open (ADR-0140 / I74.7 replaced the old row and
    // its toggle with the task editor; the resources stay on the page, compact). Its writes answer on the page itself,
    // so the database is the outcome.
    const task = seeded[0]
    const lead = await as(browser, 'lead')
    await lead.goto(`/my-work/task/${task.id}`)
    const row = lead.getByTestId('task-page-manage')
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(row.getByTestId(`task-resource-add-${task.id}`)).toBeVisible()
    const picker = row.getByTestId('task-resource-picker')
    const options = await picker.locator('option').evaluateAll((os) => os.map((o) => ({ v: (o as HTMLOptionElement).value, t: o.textContent ?? '' })).filter((o) => o.v))
    expect(options.length).toBeGreaterThan(0)
    await picker.selectOption(options[0].v)
    await row.getByTestId('task-resource-hours').fill('2')
    await row.getByTestId('task-resource-starts-on').fill(dueIn(8))
    await row.getByTestId('task-resource-add-submit').click()
    await expect.poll(async () => (await rows<{ id: string }>('sub_task_resources', `select=id&sub_task_id=eq.${task.id}`)).length).toBe(1)
    const [req] = await rows<{ id: string }>('sub_task_resources', `select=id&sub_task_id=eq.${task.id}`)
    await expect(row.getByTestId(`task-resource-${req.id}`)).toBeVisible()
    await row.getByTestId(`task-resource-remove-${req.id}`).click()
    await expect.poll(async () => (await rows<{ id: string }>('sub_task_resources', `select=id&sub_task_id=eq.${task.id}`)).length).toBe(0)
    await lead.context().close()
  })

  // I71.8 (Edward, 1 Oct, B): retired — it drives the retired deliverable window (ADR-0132 d.8); the task-scheduling rework brings its replacement. Here: it needs the previous test's task.
  test.skip('cancel with its confirmation, reinstate, remove a plan, remove an assigned task after its warning', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await lead.goto(`/deliverables?open=${job.deliverableId}`)
    const tasks = await tasksOf(job.deliverableId)
    const assigned = tasks.find((t) => t.title === 'Cov added task v2')!
    const plan = tasks.find((t) => t.assignee_id === null)!

    // Cancel an assigned task: the confirmation names the person; confirm → cancelled.
    await lead.getByTestId(`subtask-cancel-${assigned.id}`).click()
    const confirm = lead.getByTestId('subtask-cancel-confirm-dialog')
    await expect(confirm).toBeVisible()
    await expect(confirm).toContainText(PEOPLE.maker.name)
    await lead.getByTestId('subtask-cancel-confirm-cancel').click()
    await expect(confirm).toHaveCount(0)
    expect((await tasksOf(job.deliverableId)).find((t) => t.id === assigned.id)!.status).not.toBe('cancelled')
    await lead.getByTestId(`subtask-cancel-${assigned.id}`).click()
    await lead.getByTestId('subtask-cancel-confirm-confirm').click()
    await done(lead)
    await expect.poll(async () => (await tasksOf(job.deliverableId)).find((t) => t.id === assigned.id)!.status).toBe('cancelled')

    // Reinstate asks "assign to whom?" in the same step (I52.7). Cancel closes it, nothing changes.
    await lead.getByTestId(`subtask-reinstate-${assigned.id}`).click()
    const reinstate = lead.getByTestId('subtask-reinstate-form')
    await expect(reinstate).toBeVisible()
    await lead.getByTestId('subtask-reinstate-cancel').click()
    await expect(reinstate).toHaveCount(0)
    expect((await tasksOf(job.deliverableId)).find((t) => t.id === assigned.id)!.status).toBe('cancelled')

    // "Reinstate and assign" with nobody chosen is refused in words; the task's own reviewer is
    // already in the picker, so choosing the maker is all it takes. The maker gets the ordinary
    // "assigned" mail; nobody gets a "needs assigning" one.
    await clearMailbox()
    await lead.getByTestId(`subtask-reinstate-${assigned.id}`).click()
    await lead.getByTestId('subtask-reinstate-assign').click()
    await expect(lead.getByTestId('subtask-reinstate-error')).toBeVisible()
    await expect(lead.getByTestId(`subtask-reinstate-reviewer-row-${await userIdOf(PEOPLE.tl.email)}`)).toBeVisible()
    await lead.getByTestId('subtask-reinstate-assignee').selectOption({ label: PEOPLE.maker.name })
    await lead.getByTestId('subtask-reinstate-assign').click()
    await done(lead)
    await expect.poll(async () => (await tasksOf(job.deliverableId)).find((t) => t.id === assigned.id)!.status).toBe('todo')
    expect((await tasksOf(job.deliverableId)).find((t) => t.id === assigned.id)!.assignee_id).toBe(await userIdOf(PEOPLE.maker.email))
    await expectMail(PEOPLE.maker.email, /^New task: /)
    await expectNoMail(PEOPLE.tl.email)

    // Cancelled again and reinstated UNASSIGNED: back to todo with nobody on it (ADR-0068 d.5 —
    // the bookings are not recreated and the person is not restored), the cancel button returns,
    // and the lead in reach of the task — the Design team lead — is told it needs assigning. The
    // maker, who lost it, is not.
    await lead.getByTestId(`subtask-cancel-${assigned.id}`).click()
    await lead.getByTestId('subtask-cancel-confirm-confirm').click()
    await done(lead)
    await expect.poll(async () => (await tasksOf(job.deliverableId)).find((t) => t.id === assigned.id)!.status).toBe('cancelled')
    await clearMailbox()
    await lead.getByTestId(`subtask-reinstate-${assigned.id}`).click()
    await lead.getByTestId('subtask-reinstate-unassigned').click()
    await done(lead)
    await expect.poll(async () => (await tasksOf(job.deliverableId)).find((t) => t.id === assigned.id)!.status).toBe('todo')
    expect((await tasksOf(job.deliverableId)).find((t) => t.id === assigned.id)!.assignee_id).toBeNull()
    await expect(lead.getByTestId(`subtask-cancel-${assigned.id}`)).toBeVisible()
    await expectMail(PEOPLE.tl.email, /needs assigning/i)
    await expectNoMail(PEOPLE.maker.email)

    // Remove the reinstated task: it is unassigned and todo again, but it has history (the log
    // recorded its commitment), so Remove CANCELS it with the record kept — never a refusal
    // (I49.67). The notice says which happened.
    await lead.getByTestId(`subtask-remove-${assigned.id}`).click()
    const notice = lead.locator('.notice-dialog').first()
    await expect(notice).toBeVisible({ timeout: 15_000 })
    await expect(notice).toContainText(/cancelled/i)
    await expect(notice).not.toContainText(/could not|did not work/i)
    await notice.locator('[data-testid$="-close"]').first().click()
    await expect.poll(async () => (await tasksOf(job.deliverableId)).find((t) => t.id === assigned.id)?.status).toBe('cancelled')
    expect((await rows('sla_events', `select=id&sub_task_id=eq.${assigned.id}`)).length).toBeGreaterThan(0) // the record survives

    // Remove a task nobody was ever given: no dialog, the row is gone.
    await lead.getByTestId(`subtask-remove-${plan.id}`).click()
    await done(lead)
    await expect.poll(async () => (await tasksOf(job.deliverableId)).some((t) => t.id === plan.id)).toBe(false)

    // Remove an assigned task: the browser asks by name; dismiss keeps it, accept removes it —
    // and because somebody was given it, it is CANCELLED with its record kept, not deleted.
    await lead.getByTestId('subtask-add-open').click() // I51.5: the form is a dialog
    await lead.getByTestId('subtask-title').fill('Cov to remove')
    await lead.getByTestId('subtask-assignee').selectOption({ label: PEOPLE.maker.name })
    await lead.getByTestId('subtask-hours').fill('4') // E11 (I59): assigned only with its hours
    await lead.getByTestId('subtask-reviewer-add').selectOption({ label: PEOPLE.tl.name })
    await lead.getByTestId('subtask-add-submit').click()
    await done(lead)
    await expect.poll(async () => (await tasksOf(job.deliverableId)).some((t) => t.title === 'Cov to remove')).toBe(true)
    const given = (await tasksOf(job.deliverableId)).find((t) => t.title === 'Cov to remove')!
    lead.once('dialog', (d) => { expect(d.message()).toContain(PEOPLE.maker.name); void d.dismiss() })
    await lead.getByTestId(`subtask-remove-${given.id}`).click()
    await expect(lead.getByTestId(`subtask-row-${given.id}`)).toBeVisible()
    expect((await tasksOf(job.deliverableId)).find((t) => t.id === given.id)!.status).toBe('todo')
    lead.once('dialog', (d) => void d.accept())
    await lead.getByTestId(`subtask-remove-${given.id}`).click()
    await done(lead)
    await expect.poll(async () => (await tasksOf(job.deliverableId)).find((t) => t.id === given.id)?.status).toBe('cancelled')
    await lead.context().close()
  })

  test('a reviewer sends a submitted task back from the detail', async ({ browser }) => {
    // A manual task the deputy starts and submits, so there is something in review to send back.
    // (The maker's My Work no longer loads at all — I49.75 — so the deputy stands in here.)
    // Since ADR-0132 (I71.1): added on the piece's panel, given to the deputy on the Schedule.
    const lead = await as(browser, 'lead')
    const on = await workingDayFor(PEOPLE.deputy.email, 3)
    const added = await addTaskOnPanel(lead, job, 'Cov review task', on)
    // E11 (I59): assigned only with its hours.
    await assignOnSchedule(lead, job, { taskId: added, assignee: PEOPLE.deputy.email, reviewer: PEOPLE.lead.email, day: on, hours: 4, reviewMode: 'manual' })
    const task = (await tasksOf(job.deliverableId)).find((t) => t.title === 'Cov review task')!
    await lead.context().close()

    const maker = await as(browser, 'deputy')
    await maker.goto('/my-work')
    await maker.getByTestId(`my-work-start-${task.id}`).click()
    // I59.11: the note and Send are on the task's own page now.
    await maker.getByTestId(`my-work-open-${task.id}`).click()
    await expect(maker.getByTestId('task-page')).toBeVisible()
    await maker.getByTestId(`task-comment-body-${task.id}`).fill('Done on paper.')
    await maker.getByTestId(`task-comment-submit-${task.id}`).click()
    await expect(maker.getByTestId(`task-review-gate-${task.id}`)).toContainText(/you can submit/i)
    await maker.getByTestId(`my-work-submit-${task.id}`).click()
    // ADR-0106 (I59.20): a round sent minutes after Start is untimed — the warning, then Send anyway.
    await maker.getByTestId('untimed-send').click()
    await expect.poll(async () => (await tasksOf(job.deliverableId)).find((t) => t.id === task.id)!.status).toBe('review')
    await maker.context().close()

    const reviewer = await as(browser, 'lead')
    // Without a reason written, the send-back is refused in the server's own words (ADR-0030: a
    // change description is required) — not reportable, it is an instruction. The task's row, its send-back with
    // it, is on the task's page since ADR-0132 d.8 retired the deliverable window (I71.1); its outcome is the line
    // above the row.
    await reviewer.goto(`/my-work/task/${task.id}`)
    await reviewer.getByTestId(`subtask-request-changes-${task.id}`).click()
    const refusal = reviewer.getByTestId('task-page-manage-note')
    await expect(refusal).toContainText(/change description/i)
    await expect(refusal).toHaveClass(/form-error/)
    await expect(refusal.getByRole('button')).toHaveCount(0)   // no Report
    // The reason is written where the reviewer reads a manual task — My Work → Awaiting my review.
    await reviewer.goto('/my-work')
    await reviewer.getByTestId(`awaiting-review-open-${task.id}`).click()
    await reviewer.getByTestId(`task-comment-body-${task.id}`).fill('Not on paper — we need it in the deck.')
    await reviewer.getByTestId(`task-comment-submit-${task.id}`).click()
    await expect(reviewer.getByTestId(`task-review-thread-${task.id}`)).toContainText('Not on paper')
    // Now the row's button sends it back.
    await reviewer.goto(`/my-work/task/${task.id}`)
    await reviewer.getByTestId(`subtask-request-changes-${task.id}`).click()
    const sent = reviewer.getByTestId('task-page-manage-note')
    await expect(sent).toBeVisible()
    await expect(sent).toHaveClass(/notice-ok/)
    await expect.poll(async () => (await tasksOf(job.deliverableId)).find((t) => t.id === task.id)!.status).toBe('todo')
    await reviewer.context().close()
  })

  // I71.8 (Edward, 1 Oct, B): retired — it drives the retired deliverable window (ADR-0132 d.8); the task-scheduling rework brings its replacement. Here: the panel's owner field has no Cancel.
  test.skip('changing the owner: open the picker, cancel — nothing written', async ({ browser }) => {
    const traffic = await as(browser, 'traffic')
    await traffic.goto(`/deliverables?open=${job.deliverableId}`)
    await expect(traffic.getByTestId('deliverable-owner-name')).toContainText(PEOPLE.lead.name)
    await traffic.getByTestId('deliverable-owner-change').click()
    await expect(traffic.getByTestId('deliverable-owner-select')).toBeVisible()
    await traffic.getByTestId('deliverable-owner-select').selectOption({ label: PEOPLE.tl.name })
    await traffic.getByTestId('deliverable-owner-cancel').click()
    await expect(traffic.getByTestId('deliverable-owner-select')).toHaveCount(0)
    await expect(traffic.getByTestId('deliverable-owner-name')).toContainText(PEOPLE.lead.name)
    const [d] = await rows<{ owner_user_id: string }>('deliverables', `select=owner_user_id&id=eq.${job.deliverableId}`)
    expect(d.owner_user_id).toBe(await userIdOf(PEOPLE.lead.email))
    await traffic.context().close()
  })

  // I71.8 (Edward, 1 Oct, B): retired — it drives the retired deliverable window (ADR-0132 d.8); the task-scheduling rework brings its replacement. Here: its add and reorder steps exist only on the retired window.
  test.skip('may NOT: another department’s lead is refused in words on every write; a team member is not offered the controls', async ({ browser }) => {
    const tasks = await tasksOf(job.deliverableId)
    const target = tasks.find((t) => t.status !== 'cancelled')!
    const content = await as(browser, 'content')
    await content.goto(`/deliverables?open=${job.deliverableId}`)
    await expect(content.getByTestId('deliverable-detail-dialog')).toBeVisible()

    const refused = async () => {
      const banner = content.getByTestId('deliverables-banner')
      await expect(banner).toBeVisible()
      await expect(banner).toContainText(/outside your reach/i)
      await expect(banner).not.toContainText(/row-level security|violates|policy/i)
      await expect(content.getByTestId('deliverables-banner-report')).toHaveCount(0)
      await content.getByTestId('deliverables-banner-close').click()
    }
    // Add — submitted through the form itself (Enter in the title), as a keyboard user would.
    await content.getByTestId('subtask-add-open').click() // I51.5: the form is a dialog
    await content.getByTestId('subtask-title').fill('Not mine')
    await content.getByTestId('subtask-add-form').getByTestId('subtask-title').press('Enter')
    await refused()
    // Edit → save. Nothing is written, and the refusal says who has the rights: the deliverable's
    // owner, by name (I49.66 — it used to say "sub_task … not found" to somebody looking at it).
    await content.getByTestId(`subtask-edit-${target.id}`).click()
    await content.getByTestId(`subtask-edit-title-${target.id}`).fill('Renamed by an outsider')
    await content.getByTestId(`subtask-edit-save-${target.id}`).click()
    {
      const banner = content.getByTestId('deliverables-banner')
      await expect(banner).toBeVisible()
      await expect(banner).toContainText(/do not have the rights to edit this task/i)
      const [ownerRow] = await rows<{ display_name: string }>('user_profiles', `select=display_name&id=eq.${job.ownerUserId}`)
      await expect(banner).toContainText(ownerRow.display_name)
      await expect(banner).not.toContainText(/not found|row-level security|violates|policy/i)
      await expect(content.getByTestId('deliverables-banner-report')).toHaveCount(0)
      await content.getByTestId('deliverables-banner-close').click()
    }
    expect((await tasksOf(job.deliverableId)).find((t) => t.id === target.id)!.title).toBe(target.title)
    await content.getByTestId(`subtask-edit-cancel-${target.id}`).click()
    // Reorder, cancel, remove.
    const movable = tasks.filter((t) => t.status !== 'cancelled')
    if (movable.length > 1) {
      await content.getByTestId(`subtask-move-down-${movable[0].id}`).click()
      await refused()
    }
    await content.getByTestId(`subtask-cancel-${target.id}`).click()
    await content.getByTestId('subtask-cancel-confirm-confirm').click()
    await refused()
    expect((await tasksOf(job.deliverableId)).find((t) => t.id === target.id)!.status).toBe(target.status)
    content.once('dialog', (d) => void d.accept())
    await content.getByTestId(`subtask-remove-${target.id}`).click()
    await refused()
    expect((await tasksOf(job.deliverableId)).some((t) => t.id === target.id)).toBe(true)
    await content.context().close()

    // A team member is not offered the page at all: the guard sends them to their own work.
    const writer = await as(browser, 'writer')
    await writer.goto(`/deliverables?open=${job.deliverableId}`)
    await expect(writer).toHaveURL(/\/my-work/)
    await expect(writer.getByTestId('surface-deliverables')).toHaveCount(0)
    await expect(writer.getByTestId('deliverable-detail-dialog')).toHaveCount(0)
    await writer.context().close()
  })
})
