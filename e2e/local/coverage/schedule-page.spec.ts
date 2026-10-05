import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows, userIdOf } from '../helpers/db'
import { releaseSingleJob, type ReleasedJob } from '../helpers/single-job'
import { approveTaskList } from '../helpers/piece'

/**
 * Coverage — the Schedule page and the edit-booking dialog (I49: SchedulePage 18 controls,
 * EditBookingDialog 11). Same rule as deliverables-page.spec.ts: one who MAY, one who MAY NOT,
 * outcomes read from the database.
 *
 * Actors: `traffic` (tenant reach) for the toolbar, filters, the reassign and the task's pop-up
 * (ADR-0140 — the old edit-booking fields are gone); `tl` (Design team lead) for the ask path — a
 * task dragged onto somebody in another team becomes an ASK to that team's Team Leader (ADR-0139);
 * `lead` (Creative department lead) books his department directly and is told an outsider is an
 * ask; `maker` (team member) is refused in words and offered nothing to write.
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
/** The Sunday that starts the CURRENT week (today, when today is Sunday). */
function thisSunday(): string {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - d.getUTCDay())
  return d.toISOString().slice(0, 10)
}
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
async function resourceIdOf(name: string): Promise<string> {
  const [r] = await rows<{ id: string }>('resources', `select=id&name=eq.${encodeURIComponent(name)}&is_active=eq.true`)
  expect(r, `resource ${name}`).toBeTruthy()
  return r.id
}
async function openAdd(page: Page, resourceId: string, isoDate: string) {
  await page.goto(`/schedule?on=${isoDate}`)
  await expect(page.getByTestId('schedule-grid')).toBeVisible()
  const cell = page.getByTestId(`cell-${resourceId}-${isoDate}`)
  await expect(cell).toBeVisible()
  await cell.hover()
  await page.getByTestId(`add-${resourceId}-${isoDate}`).click()
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
    await submit.click()
    await expect(dialog).toHaveCount(0)
  }
}
async function drag(page: Page, bookingId: string, resourceId: string, isoDate: string) {
  const dt = await page.evaluateHandle(() => new DataTransfer())
  await page.getByTestId(`booking-${bookingId}`).dispatchEvent('dragstart', { dataTransfer: dt })
  const cell = page.getByTestId(`cell-${resourceId}-${isoDate}`)
  await cell.dispatchEvent('dragover', { dataTransfer: dt })
  await cell.dispatchEvent('drop', { dataTransfer: dt })
  await proceedIfWarned(page)
}
/** A drop that finds the day over capacity (or off) warns first — warn-and-allow (ADR-0061). */
async function proceedIfWarned(page: Page) {
  const warn = page.getByTestId('drop-warning-confirm')
  if (await warn.isVisible({ timeout: 2_000 }).catch(() => false)) await warn.click()
}
type Booking = { id: string; resource_id: string; starts_at: string; ends_at: string; notes: string | null }

/**
 * The task's LIVE bookings (I54.19).
 *
 * This used to read every row for the task, cancelled ones included, and callers took `[0]`. A
 * reassignment does not edit a booking — it writes a new row and cancels the old — so from the
 * first reassignment onwards the task has two rows, both starting on the same day, and `[0]` of a
 * list ordered by start time was a coin toss. The suite failed about half the time on a full run
 * and always passed when the file ran alone, which is exactly how a shared-database race presents.
 *
 * The three live states are the ones the grid itself draws (`useScheduleBookings`).
 */
const bookingsOf = (subTaskId: string) =>
  rows<Booking>('bookings', `select=id,resource_id,starts_at,ends_at,notes&sub_task_id=eq.${subTaskId}&state=in.(soft_hold,tentative,confirmed)&order=starts_at.asc`)

/**
 * The task's one live booking, waited for rather than grabbed.
 *
 * Between cancelling the old row and writing the new one there is a moment with none, and the
 * busier the shared database is by the time this file runs, the wider it gets.
 */
async function liveBooking(subTaskId: string): Promise<Booking> {
  let last: Booking[] = []
  await expect
    .poll(async () => (last = await bookingsOf(subTaskId)).length, { timeout: 15_000 })
    .toBe(1)
  return last[0]
}

let job: ReleasedJob
let tasks: { id: string; title: string }[]
let maker: string, animator: string, writer: string, planner: string
const day = sundayOut(4)

test.describe('Coverage — Schedule page', () => {
  test.beforeAll(async ({ browser }) => {
    const am = await as(browser, 'am')
    job = await releaseSingleJob(am, { title: `Cov schedule ${Date.now()}`, department: 'Creative', type: 'Social Advertisement' })
    await am.context().close()
    // The owner approves the task list on the piece's panel (ADR-0132 d.2; I71.1).
    const lead = await as(browser, 'lead')
    await approveTaskList(lead, job)
    await lead.context().close()
    tasks = await rows<{ id: string; title: string }>('sub_tasks', `select=id,title&deliverable_id=eq.${job.deliverableId}&order=sort_order.asc`)
    ;[maker, animator, writer, planner] = await Promise.all([PEOPLE.maker, PEOPLE.animator, PEOPLE.writer, PEOPLE.planner].map((p) => resourceIdOf(p.name)))

    // One booking to work with: task 0 on the maker, on `day`.
    const traffic = await as(browser, 'traffic')
    await openAdd(traffic, maker, day)
    const mode = traffic.getByTestId('mode-project')
    if (await mode.count()) await mode.check()
    await traffic.getByTestId('booking-project').selectOption({ label: job.title })
    await traffic.getByTestId('booking-deliverable-select').selectOption({ index: 1 })
    await traffic.getByTestId('booking-subtask-select').selectOption({ label: tasks[0].title })
    await traffic.getByTestId('booking-project-reviewer-add').selectOption({ label: PEOPLE.lead.name })
    await traffic.getByTestId('booking-hours').fill('4')
    await book(traffic)
    await traffic.context().close()
    expect(await bookingsOf(tasks[0].id)).toHaveLength(1)
  })

  test('toolbar: zoom, navigation, the view switcher, New booking', async ({ browser }) => {
    const traffic = await as(browser, 'traffic')
    await traffic.goto(`/schedule?on=${day}`)
    await expect(traffic.getByTestId('schedule-grid')).toBeVisible()
    const cols = () => traffic.locator(`[data-testid^="cell-${maker}-"]`).count()

    // Zoom: 7 / 14 / 28 columns.
    await traffic.getByTestId('zoom-fortnight').click()
    await expect.poll(cols).toBe(14)
    await traffic.getByTestId('zoom-month').click()
    await expect.poll(cols).toBe(28)
    await traffic.getByTestId('zoom-week').click()
    await expect.poll(cols).toBe(7)

    // Navigation: next moves the week on, prev back, today returns to the current week.
    await expect(traffic.getByTestId(`cell-${maker}-${day}`)).toBeVisible()
    await traffic.getByTestId('nav-next').click()
    await expect(traffic.getByTestId(`cell-${maker}-${shift(day, 7)}`)).toBeVisible()
    await expect(traffic.getByTestId(`cell-${maker}-${day}`)).toHaveCount(0)
    await traffic.getByTestId('nav-prev').click()
    await expect(traffic.getByTestId(`cell-${maker}-${day}`)).toBeVisible()
    await traffic.getByTestId('nav-today').click()
    await expect(traffic.getByTestId(`cell-${maker}-${thisSunday()}`)).toBeVisible()

    // Views: each tab selects; "mine" shows only my own row; "project" asks for a project.
    for (const v of ['master', 'mine', 'project', 'month']) {
      await traffic.getByTestId(`view-${v}`).click()
      await expect(traffic.getByTestId(`view-${v}`)).toHaveAttribute('aria-selected', 'true')
    }
    await traffic.getByTestId('view-mine').click()
    await expect(traffic.getByTestId(`row-${await resourceIdOf(PEOPLE.traffic.name)}`)).toBeVisible()
    await expect(traffic.getByTestId(`row-${maker}`)).toHaveCount(0)
    await traffic.getByTestId('view-project').click()
    await expect(traffic.getByTestId('schedule-pick-project')).toBeVisible()
    await traffic.goto(`/schedule?on=${day}&view=project`)
    await traffic.getByTestId('filter-project').selectOption({ label: job.title })
    // The people booked on this job, and nobody else (I49.71: the campaign is worked out from
    // the booking's deliverable on read — the column nothing writes is no longer relied on).
    await expect(traffic.getByTestId(`row-${maker}`)).toBeVisible()
    await expect(traffic.getByTestId(`row-${writer}`)).toHaveCount(0)
    await traffic.getByTestId('view-master').click()

    // New booking with no cell chosen: the dialog opens with the resource to pick; Cancel closes.
    await traffic.getByTestId('new-booking').click()
    await expect(traffic.getByTestId('booking-dialog')).toBeVisible()
    await expect(traffic.getByTestId('booking-resource')).toBeVisible()
    await traffic.getByTestId('booking-cancel').click()
    await expect(traffic.getByTestId('booking-dialog')).toHaveCount(0)
    await traffic.context().close()
  })

  test('filters: who, kind, department, team, office, and Clear', async ({ browser }) => {
    const traffic = await as(browser, 'traffic')
    await traffic.goto(`/schedule?on=${day}`)
    await expect(traffic.getByTestId(`row-${maker}`)).toBeVisible()
    await expect(traffic.getByTestId(`row-${writer}`)).toBeVisible()

    await traffic.getByTestId('filter-who').fill(PEOPLE.maker.name)
    await expect(traffic.getByTestId(`row-${maker}`)).toBeVisible()
    await expect(traffic.getByTestId(`row-${writer}`)).toHaveCount(0)
    await traffic.getByTestId('filter-clear').click()
    await expect(traffic.getByTestId('filter-who')).toHaveValue('')
    await expect(traffic.getByTestId(`row-${writer}`)).toBeVisible()

    await traffic.getByTestId('filter-kind').selectOption('equipment')
    await expect(traffic.getByTestId(`row-${maker}`)).toHaveCount(0)
    await traffic.getByTestId('filter-kind').selectOption('human')
    await expect(traffic.getByTestId(`row-${maker}`)).toBeVisible()

    await traffic.getByTestId('filter-department').selectOption({ label: 'Creative' })
    await expect(traffic.getByTestId(`row-${maker}`)).toBeVisible()
    await expect(traffic.getByTestId(`row-${writer}`)).toHaveCount(0)
    await traffic.getByTestId('filter-team').selectOption({ label: 'Design' })
    await expect(traffic.getByTestId(`row-${maker}`)).toBeVisible()
    await expect(traffic.getByTestId(`row-${animator}`)).toHaveCount(0) // Motion, not Design
    await traffic.getByTestId('filter-clear').click()
    await expect(traffic.getByTestId(`row-${animator}`)).toBeVisible()

    const editor = await resourceIdOf(PEOPLE.editor.name) // Dubai
    await traffic.getByTestId('filter-office').selectOption({ label: 'Baghdad' })
    await expect(traffic.getByTestId(`row-${maker}`)).toBeVisible()
    await expect(traffic.getByTestId(`row-${editor}`)).toHaveCount(0)
    await traffic.getByTestId('filter-clear').click()
    await expect(traffic.getByTestId(`row-${editor}`)).toBeVisible()
    await traffic.context().close()
  })

  test('reassign by drag: the confirmation, Cancel keeps it, Apply moves the booking and the task', async ({ browser }) => {
    const traffic = await as(browser, 'traffic')
    await traffic.goto(`/schedule?on=${day}`)
    const b = await liveBooking(tasks[0].id)
    await drag(traffic, b.id, animator, day)
    const confirm = traffic.getByTestId('reassign-confirm')
    await expect(confirm).toBeVisible()
    await expect(traffic.getByTestId('reassign-body')).toContainText(PEOPLE.animator.name)
    await traffic.getByTestId('reassign-cancel').click()
    await expect(confirm).toHaveCount(0)
    expect((await liveBooking(tasks[0].id)).resource_id).toBe(maker)

    await drag(traffic, b.id, animator, day)
    await traffic.getByTestId('reassign-confirm-apply').click()
    await proceedIfWarned(traffic)
    await expect(confirm).toHaveCount(0)
    await expect.poll(async () => (await bookingsOf(tasks[0].id))[0]?.resource_id).toBe(animator)
    const [task] = await rows<{ assignee_id: string }>('sub_tasks', `select=assignee_id&id=eq.${tasks[0].id}`)
    expect(task.assignee_id).toBe(await userIdOf(PEOPLE.animator.email))
    // And back, so the edit test finds it on the maker. A reassignment writes a NEW booking row
    // (the old one is cancelled), so the chip carries a new id.
    const moved = await liveBooking(tasks[0].id)
    await drag(traffic, moved.id, maker, day)
    await traffic.getByTestId('reassign-confirm-apply').click()
    await proceedIfWarned(traffic)
    await expect.poll(async () => (await bookingsOf(tasks[0].id))[0]?.resource_id).toBe(maker)
    await traffic.context().close()
  })

  test('a task\'s pop-up: every field, Save closes it, Close discards; a move past the due date opens the change form; cancel the booking; remove the task', async ({ browser }) => {
    // ADR-0140 d.1/d.5, I74.32, ADR-0141 d.2. A task's chip opens its pop-up — the one task editor.
    const traffic = await as(browser, 'traffic')
    const b = await liveBooking(tasks[0].id)
    expect(b.resource_id, 'the reassign test above left task 0 on the maker').toBe(maker)
    const before = (await rows<{ review_mode: string; sla_hours: number }>('sub_tasks', `select=review_mode,sla_hours&id=eq.${tasks[0].id}`))[0]
    expect(Number(before.sla_hours), 'booked with 4 hours').toBe(4)
    const otherMode = before.review_mode === 'manual' ? 'digital' : 'manual'
    await traffic.goto(`/schedule?on=${day}`)
    await traffic.getByTestId(`booking-${b.id}`).click()
    const popup = traffic.getByTestId('edit-dialog')
    await expect(popup).toBeVisible()
    await expect(traffic.getByTestId('edit-task')).toBeVisible({ timeout: 15_000 })

    // Every field but the days, in one save: title, notes, hours (4 → 6), review mode, and the person (→ the animator).
    await traffic.getByTestId('edit-task-title').fill(`${tasks[0].title} (edited)`)
    await traffic.getByTestId('edit-task-notes').fill('Square crop first.')
    await traffic.getByTestId('edit-task-more').click()
    await traffic.getByTestId('edit-task-more').click()
    await expect(traffic.getByTestId('edit-task-hours')).toHaveText('6h')
    await traffic.getByTestId(`edit-task-review-${otherMode}`).click()
    await traffic.getByTestId('edit-task-who').click()
    await traffic.getByTestId(`edit-task-people-${animator}`).click()
    await expect(traffic.getByTestId('edit-task-who')).toContainText(PEOPLE.animator.name)
    await traffic.getByTestId('edit-task-save').click()
    // I74.32: Save closes the pop-up.
    await expect(popup).toHaveCount(0, { timeout: 15_000 })
    await expect.poll(async () => (await bookingsOf(tasks[0].id))[0]?.resource_id, { timeout: 15_000 }).toBe(animator)
    const [task] = await rows<{ title: string; description: string | null; assignee_id: string; review_mode: string; sla_hours: number }>('sub_tasks', `select=title,description,assignee_id,review_mode,sla_hours&id=eq.${tasks[0].id}`)
    expect(task.title).toBe(`${tasks[0].title} (edited)`)
    expect(task.description).toBe('Square crop first.')
    expect(task.assignee_id).toBe(await userIdOf(PEOPLE.animator.email))
    expect(task.review_mode).toBe(otherMode)
    expect(Number(task.sla_hours)).toBe(6)

    // The days, widened to the next day. The piece is due before `day`, so the move lands past its due date: the
    // task moves and the change form opens in the pop-up, filled with that day (ADR-0141 d.2) — the pop-up stays.
    const [d] = await rows<{ due_at: string }>('deliverables', `select=due_at&id=eq.${job.deliverableId}`)
    expect(d.due_at.slice(0, 10) < day, 'the piece is due before the booked day').toBe(true)
    const onAnimator = await liveBooking(tasks[0].id)
    await traffic.getByTestId(`booking-${onAnimator.id}`).click()
    await expect(traffic.getByTestId('edit-task')).toBeVisible({ timeout: 15_000 })
    await traffic.getByTestId('edit-task-dates').click()
    await traffic.getByTestId(`edit-task-dates-picker-day-${shift(day, 1)}`).click()
    await expect(traffic.getByTestId('edit-task-dates-picker-from')).not.toHaveText('—')
    await expect(traffic.getByTestId('edit-task-dates-picker-to')).not.toHaveText(await traffic.getByTestId('edit-task-dates-picker-from').innerText())
    await traffic.getByTestId('edit-task-dates-picker-done').click()
    await traffic.getByTestId('edit-task-save').click()
    const changeAsk = traffic.getByTestId('change-ask')
    await expect(changeAsk).toBeVisible({ timeout: 15_000 })
    await expect(traffic.getByTestId('change-ask-moved')).toBeVisible()
    await expect(popup).toBeVisible()
    await expect.poll(async () => (await bookingsOf(tasks[0].id)).some((x) => x.starts_at.slice(0, 10) === shift(day, 1)), { timeout: 15_000 }).toBe(true)
    await traffic.getByTestId('change-ask-cancel').click()
    await expect(changeAsk).toHaveCount(0)
    await traffic.getByTestId('edit-close').click()
    await expect(popup).toHaveCount(0)

    // Close without saving: nothing is written.
    const after = await bookingsOf(tasks[0].id)
    await traffic.getByTestId(`booking-${after[0].id}`).click()
    await expect(traffic.getByTestId('edit-task')).toBeVisible({ timeout: 15_000 })
    await traffic.getByTestId('edit-task-title').fill('discarded')
    await traffic.getByTestId('edit-close').click()
    await expect(popup).toHaveCount(0)
    expect((await rows<{ title: string }>('sub_tasks', `select=title&id=eq.${tasks[0].id}`))[0].title).toBe(`${tasks[0].title} (edited)`)

    // Cancel this booking (ADR-0140 d.5): Keep changes nothing; Yes takes the person off and the task goes back to
    // To book, its days kept; the person and their team lead are told, not the account manager.
    await traffic.getByTestId(`booking-${after[0].id}`).click()
    await traffic.getByTestId('edit-cancel-booking').click()
    await expect(traffic.getByTestId('edit-cancel-ask')).toBeVisible()
    await traffic.getByTestId('edit-cancel-keep').click()
    await expect(traffic.getByTestId('edit-cancel-ask')).toHaveCount(0)
    expect((await bookingsOf(tasks[0].id)).length).toBeGreaterThan(0)
    await traffic.getByTestId('edit-cancel-booking').click()
    await traffic.getByTestId('edit-cancel-yes').click()
    await expect(popup).toHaveCount(0)
    await expect.poll(async () => (await rows<{ assignee_id: string | null }>('sub_tasks', `select=assignee_id&id=eq.${tasks[0].id}`))[0].assignee_id).toBeNull()
    const [unbooked] = await rows<{ status: string; starts_at: string | null }>('sub_tasks', `select=status,starts_at&id=eq.${tasks[0].id}`)
    expect(unbooked.status, 'back to To book').toBe('todo')
    expect(unbooked.starts_at, 'its days kept').not.toBeNull()
    expect(await bookingsOf(tasks[0].id)).toHaveLength(0)
    const told = await rows<{ user_id: string }>('notifications', `select=user_id&type=eq.task_unassigned&entity_id=eq.${tasks[0].id}`)
    expect(told.map((n) => n.user_id).sort()).toEqual([await userIdOf(PEOPLE.animator.email), await userIdOf(PEOPLE.motiontl.email)].sort())

    // Remove this task (SC-27), from another booking: asked inline, Keep leaves it; Yes calls it off and frees the calendar.
    await openAdd(traffic, maker, shift(day, 2))
    const mode = traffic.getByTestId('mode-project')
    if (await mode.count()) await mode.check()
    await traffic.getByTestId('booking-project').selectOption({ label: job.title })
    await traffic.getByTestId('booking-deliverable-select').selectOption({ index: 1 })
    await traffic.getByTestId('booking-subtask-select').selectOption({ label: tasks[1].title })
    await traffic.getByTestId('booking-project-reviewer-add').selectOption({ label: PEOPLE.lead.name })
    await traffic.getByTestId('booking-hours').fill('2')
    await book(traffic)
    const b1 = await liveBooking(tasks[1].id)
    await traffic.getByTestId(`booking-${b1.id}`).click()
    await traffic.getByTestId('edit-remove-task').click()
    await expect(traffic.getByTestId('edit-remove-ask')).toBeVisible()
    await traffic.getByTestId('edit-remove-keep').click()
    await expect(traffic.getByTestId('edit-remove-ask')).toHaveCount(0)
    expect((await rows<{ status: string }>('sub_tasks', `select=status&id=eq.${tasks[1].id}`))[0].status).toBe('todo')
    await traffic.getByTestId('edit-remove-task').click()
    await traffic.getByTestId('edit-remove-yes').click()
    await expect(popup).toHaveCount(0)
    // It had a person, so it keeps its record: called off, not deleted.
    await expect.poll(async () => (await rows<{ status: string }>('sub_tasks', `select=status&id=eq.${tasks[1].id}`))[0].status).toBe('cancelled')
    expect(await bookingsOf(tasks[1].id)).toHaveLength(0)
    await traffic.context().close()
  })

  test('a team lead drags her task onto somebody in another team: it is an ASK to that team\'s Team Leader; nothing moves (ADR-0139)', async ({ browser }) => {
    // Task 2 on the maker (the team lead's own team), then dragged onto the Content writer (team Copy).
    const traffic = await as(browser, 'traffic')
    await openAdd(traffic, maker, shift(day, 3))
    const mode = traffic.getByTestId('mode-project')
    if (await mode.count()) await mode.check()
    await traffic.getByTestId('booking-project').selectOption({ label: job.title })
    await traffic.getByTestId('booking-deliverable-select').selectOption({ index: 1 })
    await traffic.getByTestId('booking-subtask-select').selectOption({ label: tasks[2].title })
    await traffic.getByTestId('booking-project-reviewer-add').selectOption({ label: PEOPLE.lead.name })
    await traffic.getByTestId('booking-hours').fill('2')
    await book(traffic)
    await traffic.context().close()
    const b2 = await liveBooking(tasks[2].id)
    expect(b2.resource_id).toBe(maker)
    const makerUser = await userIdOf(PEOPLE.maker.email)
    expect((await rows<{ assignee_id: string }>('sub_tasks', `select=assignee_id&id=eq.${tasks[2].id}`))[0].assignee_id).toBe(makerUser)
    expect(await rows('sub_task_assignment_requests', `select=id&sub_task_id=eq.${tasks[2].id}`)).toHaveLength(0)

    // Her Schedule opens on her own team (d.6): the maker is on it, the writer is not; Everyone shows the writer.
    const tl = await as(browser, 'tl')
    await tl.goto(`/schedule?on=${day}`)
    await expect(tl.getByTestId('view-team')).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 })
    await expect(tl.getByTestId(`row-${maker}`)).toBeVisible()
    await expect(tl.getByTestId(`row-${writer}`)).toHaveCount(0)
    await tl.getByTestId('view-master').click()
    await expect(tl.getByTestId('view-master')).toHaveAttribute('aria-selected', 'true')
    await expect(tl.getByTestId(`row-${writer}`)).toBeVisible()

    await drag(tl, b2.id, writer, shift(day, 3))
    await expect(tl.getByTestId('reassign-confirm')).toBeVisible()
    // The request sentence, not the plain "reassigns the work" one.
    await expect(tl.getByTestId('reassign-body')).toContainText(/sends a request/i)
    await expect(tl.getByTestId('reassign-body')).not.toContainText(/reassigns the work/i)
    await tl.getByTestId('reassign-confirm-apply').click()
    await proceedIfWarned(tl)
    await expect(tl.getByTestId('reassign-confirm')).toHaveCount(0)
    await expect(tl.getByTestId('schedule-notice')).toContainText(/Request sent/)
    await expect(tl.getByTestId('schedule-banner')).toHaveCount(0)

    // The database: one pending request, asked by the team lead, of the writer's team; the task keeps its person and days.
    type Req = { id: string; status: string; requested_by: string; team_id: string | null }
    let req: Req | undefined
    await expect.poll(async () => {
      ;[req] = await rows<Req>('sub_task_assignment_requests', `select=id,status,requested_by,team_id&sub_task_id=eq.${tasks[2].id}`)
      return req?.status
    }, { timeout: 15_000 }).toBe('pending')
    expect(req!.requested_by).toBe(await userIdOf(PEOPLE.tl.email))
    const [copy] = await rows<{ id: string }>('teams', `select=id&name=eq.Copy`)
    expect(req!.team_id).toBe(copy.id)
    // The Copy team's Team Leader is the one asked (d.3) — not the Content department lead, not the writer.
    const asked = await rows<{ user_id: string }>('notifications', `select=user_id&type=eq.assignment_requested&detail->>request_id=eq.${req!.id}`)
    expect(asked.map((n) => n.user_id)).toEqual([await userIdOf(PEOPLE.copytl.email)])
    const still = await liveBooking(tasks[2].id)
    expect({ id: still.id, r: still.resource_id, s: still.starts_at }).toEqual({ id: b2.id, r: maker, s: b2.starts_at })
    expect((await rows<{ assignee_id: string }>('sub_tasks', `select=assignee_id&id=eq.${tasks[2].id}`))[0].assignee_id).toBe(makerUser)
    await tl.context().close()
  })

  test('may NOT: a team member pressing + is refused in words and cannot drag; a department lead books his own department directly and is told a person outside it is an ask', async ({ browser }) => {
    const animatorDay = () => rows<{ id: string }>('bookings', `select=id&resource_id=eq.${animator}&state=in.(soft_hold,tentative,confirmed)&starts_at=gte.${day}T00:00:00Z&starts_at=lt.${shift(day, 1)}T00:00:00Z`)
    const bookedBefore = (await animatorDay()).map((x) => x.id).sort()

    // A team member holds no booking grant: her Schedule opens on Everyone, the + answers with the worded refusal,
    // no booking window opens, and a task chip is not draggable.
    const member = await as(browser, 'maker')
    await member.goto(`/schedule?on=${day}`)
    await expect(member.getByTestId('schedule-grid')).toBeVisible()
    await expect(member.getByTestId('view-master')).toHaveAttribute('aria-selected', 'true')
    await member.getByTestId(`cell-${animator}-${day}`).hover()
    await member.getByTestId(`add-${animator}-${day}`).click()
    const refusal = member.getByTestId('schedule-refusal')
    await expect(refusal).toBeVisible()
    await expect(member.getByTestId('schedule-refusal-body')).not.toContainText(/policy|violates/i)
    await expect(member.getByTestId('booking-dialog')).toHaveCount(0)
    await member.getByTestId('schedule-refusal-close').click()
    await expect(refusal).toHaveCount(0)
    const b2 = await liveBooking(tasks[2].id) // left on the maker by the ask above
    await expect(member.getByTestId(`booking-${b2.id}`)).toBeVisible()
    await expect(member.getByTestId(`booking-${b2.id}`)).not.toHaveAttribute('draggable', 'true')
    await member.context().close()
    expect((await animatorDay()).map((x) => x.id).sort(), 'nothing was booked').toEqual(bookedBefore)

    // A department lead (Creative). His own department books directly: the window opens without the "sent for
    // approval" line. A person outside it (Strategy's planner, on Everyone) is an ask (ADR-0139 d.1): the window
    // says so before anything is sent. Neither is refused.
    const lead = await as(browser, 'lead')
    await lead.goto(`/schedule?on=${day}`)
    await expect(lead.getByTestId(`row-${animator}`)).toBeVisible({ timeout: 20_000 })
    await expect(lead.getByTestId(`row-${planner}`)).toHaveCount(0)
    await lead.getByTestId(`cell-${animator}-${day}`).hover()
    await lead.getByTestId(`add-${animator}-${day}`).click()
    await expect(lead.getByTestId('booking-dialog')).toBeVisible()
    await expect(lead.getByTestId('schedule-refusal')).toHaveCount(0)
    await expect(lead.getByTestId('booking-project')).toBeVisible()
    // I66.10: ad-hoc work is switched off — a person is only given a task from a project.
    await expect(lead.getByTestId('mode-adhoc')).toHaveCount(0)
    await lead.getByTestId('booking-project').selectOption({ label: job.title })
    await expect(lead.getByTestId('booking-will-request')).toHaveCount(0)
    await lead.getByTestId('booking-cancel').click()
    await expect(lead.getByTestId('booking-dialog')).toHaveCount(0)

    await lead.getByTestId('view-master').click()
    await expect(lead.getByTestId(`row-${planner}`)).toBeVisible()
    await lead.getByTestId(`cell-${planner}-${day}`).hover()
    await lead.getByTestId(`add-${planner}-${day}`).click()
    await expect(lead.getByTestId('booking-dialog')).toBeVisible()
    await expect(lead.getByTestId('schedule-refusal')).toHaveCount(0)
    await lead.getByTestId('booking-project').selectOption({ label: job.title })
    await expect(lead.getByTestId('booking-will-request')).toBeVisible()
    await lead.getByTestId('booking-cancel').click()
    await expect(lead.getByTestId('booking-dialog')).toHaveCount(0)
    await lead.context().close()
    expect((await animatorDay()).map((x) => x.id).sort(), 'Cancel booked nothing').toEqual(bookedBefore)
    expect(await rows('bookings', `select=id&resource_id=eq.${planner}&sub_task_id=in.(${tasks.map((x) => x.id).join(',')})&state=neq.cancelled`)).toHaveLength(0)
  })

  // I49.70: a team member holds no booking grant, so "+ New booking" is not offered — a control
  // belonging to another role is absent, not dead (AGENTS.md role leakage). The lead above is.
  test('a team member is not offered New booking (I49.70)', async ({ browser }) => {
    const member = await as(browser, 'maker')
    await member.goto(`/schedule?on=${day}`)
    await expect(member.getByTestId('schedule-grid')).toBeVisible()
    await expect(member.getByTestId('new-booking')).toHaveCount(0)
    await member.context().close()
  })

  test('I74.30: a team member is not offered "Your team" — her Schedule opens on Everyone, and a ?view=team link falls back to it; a team lead still opens on Your team', async ({ browser }) => {
    const member = await as(browser, 'maker')
    await member.goto('/schedule')
    await expect(member.getByTestId('view-switcher')).toBeVisible({ timeout: 20_000 })
    await expect(member.getByTestId('view-team')).toHaveCount(0)
    await expect(member.getByTestId('view-master')).toHaveAttribute('aria-selected', 'true')
    await member.goto('/schedule?view=team')
    await expect(member.getByTestId('view-switcher')).toBeVisible({ timeout: 20_000 })
    await expect(member.getByTestId('view-team')).toHaveCount(0)
    await expect(member.getByTestId('view-master')).toHaveAttribute('aria-selected', 'true')
    await member.context().close()

    const lead = await as(browser, 'tl')
    await lead.goto('/schedule')
    await expect(lead.getByTestId('view-switcher')).toBeVisible({ timeout: 20_000 })
    await expect(lead.getByTestId('view-team')).toHaveAttribute('aria-selected', 'true')
    await expect(lead.getByTestId('view-master')).toHaveAttribute('aria-selected', 'false')
    await lead.context().close()
  })

})
