import { test, expect } from '@playwright/test'
import { attemptWrite, rows } from '../helpers/db'
import { PEOPLE, as, at, idOf, makeApprovedPiece, resourceIdOf, rpcAs, workday } from '../helpers/i74'

/**
 * Coverage — the two older windows that still open for work made before I66.10 (29 Sep) switched ad-hoc work off:
 *
 *   * the Deliverables page's window (`DeliverableDetail`) for an AD-HOC deliverable — one with no campaign. A campaign
 *     piece forwards to its campaign page (ADR-0132 d.8); ad-hoc work keeps this window, one task laid out directly;
 *   * the booking's own edit dialog (`EditBookingDialog`'s fields) for a task booking that carries no piece — the
 *     shape older bookings have — where a request out on the task is shown and its ASKER can withdraw it
 *     (`edit-withdraw-request`). A task booking WITH a piece opens the task pop-up instead (ADR-0140).
 *
 * Neither shape can be made through today's screens: the ad-hoc door is gone from the booking dialog (I66.10) and every
 * booking the product writes now carries its piece (`subtask-schedule`). So the ad-hoc job is made through the door the
 * old dialog called (`create_adhoc_deliverable`, still granted, as the team lead), and the piece-less booking is put on
 * the record through the service role — the one staged state here, standing for the rows production already holds.
 *
 *   ALLOWED  a team lead opens the ad-hoc window and reads its task's resources; the asker withdraws her request
 *            from the booking's dialog — the request is withdrawn, by her.
 *   REFUSED  a team member is not let onto the Deliverables page at all (no toggle anywhere); somebody else opening the
 *            same booking sees the request, and is offered no Withdraw.
 */
test.use({ actionTimeout: 15_000 })
test.describe.configure({ mode: 'serial' })

const COPY = 'd0000000-0000-4000-8000-00000000d105'
let deliverableId: string
let subTaskId: string
const onDay = workday(5)

test.describe('Older windows that still open (ad-hoc work, piece-less bookings)', () => {
  test.beforeAll(async () => {
    const [made] = await rpcAs<{ sub_task_id: string; deliverable_id: string }[]>('tl', 'create_adhoc_deliverable', {
      p_assignee: await idOf('maker'),
      p_title: `Legacy ad-hoc ${Date.now()}`,
      p_hours: 2,
      p_starts_at: at(onDay, 9),
      p_due_at: at(onDay, 17),
      p_reviewer: await idOf('tl'),
    })
    expect(made, 'the ad-hoc job is made').toBeTruthy()
    deliverableId = made!.deliverable_id
    subTaskId = made!.sub_task_id
    const [d] = await rows<{ stream_id: string | null }>('deliverables', `select=stream_id&id=eq.${deliverableId}`)
    expect(d!.stream_id, 'ad-hoc: no campaign behind it').toBeNull()
  })

  test('the ad-hoc window: a team lead sees the task’s resources in the open (one task, no table); a team member is not let in', async ({ browser }) => {
    const tl = await as(browser, 'tl')
    await tl.goto(`/deliverables?open=${deliverableId}`)
    await expect(tl.getByTestId('deliverable-detail-dialog')).toBeVisible({ timeout: 20_000 })
    await expect(tl).toHaveURL(/\/deliverables/)
    // ADR-0058 d.8: ad-hoc work is exactly one task, so its controls are laid out directly — the resources open.
    await expect(tl.getByTestId(`adhoc-task-${subTaskId}`)).toBeVisible()
    await expect(tl.getByTestId(`task-resources-${subTaskId}`)).toBeVisible()
    await tl.context().close()

    // May NOT: the maker holds no project_tasks:manage — the page sends her to her own landing.
    const maker = await as(browser, 'maker')
    await maker.goto(`/deliverables?open=${deliverableId}`)
    await expect(maker).not.toHaveURL(/\/deliverables/, { timeout: 20_000 })
    expect(await maker.getByTestId('surface-deliverables').count()).toBe(0)
    await maker.context().close()
  })

  test('a `/deliverables?task=` link: a campaign task lands on its piece on the campaign page; an ad-hoc task stays here, on the Ad-hoc tab', async ({ browser }) => {
    test.setTimeout(120_000)
    const { job, tasks } = await makeApprovedPiece(browser, `Task link ${Date.now()}`, { approve: false })
    const task = tasks[0]!
    const tl = await as(browser, 'tl')
    await tl.goto(`/deliverables?task=${task.id}`)
    await expect(tl).toHaveURL(new RegExp(`/campaigns/${job.campaignId}\\?(?=.*piece=${job.deliverableId})(?=.*task=${task.id})`), { timeout: 20_000 })
    await expect(tl.getByTestId('piece-panel')).toBeVisible()
    await expect(tl.getByTestId(`piece-panel-tasks-row-${task.id}`)).toHaveAttribute('data-marked', 'true')

    // Ad-hoc work has no campaign to go to: the link opens its window here, on the Ad-hoc tab.
    await tl.goto(`/deliverables?task=${subTaskId}`)
    await expect(tl.getByTestId('deliverable-detail-dialog')).toBeVisible({ timeout: 20_000 })
    await expect(tl).toHaveURL(new RegExp(`/deliverables\\?task=${subTaskId}`))
    await expect(tl.getByTestId(`adhoc-task-${subTaskId}`)).toBeVisible()
    await expect(tl.getByTestId('deliverables-tab-adhoc')).toHaveAttribute('aria-pressed', 'true')
    await tl.context().close()
  })

  test('a piece-less booking\'s dialog: the asker withdraws her request; somebody else is offered no Withdraw', async ({ browser }) => {
    // The piece-less booking older work carries (deliverable_id empty) — staged; see the header.
    const [t] = await rows<{ tenant_id: string; title: string }>('sub_tasks', `select=tenant_id,title&id=eq.${subTaskId}`)
    const staged = await attemptWrite('POST', 'bookings', '', {
      tenant_id: t!.tenant_id, resource_id: await resourceIdOf('maker'), booked_by: await idOf('tl'),
      sub_task_id: subTaskId, deliverable_id: null, state: 'confirmed',
      starts_at: at(onDay, 9), ends_at: at(onDay, 11), load_pct: 25, notes: t!.title,
    })
    expect(staged.status, staged.text).toBeLessThan(300)
    const [booking] = JSON.parse(staged.text) as { id: string }[]

    // The team lead asks Copy for the writer to take it (outside her team: an ask, ADR-0139).
    const requestId = await rpcAs<string>('tl', 'request_task_booking', {
      p_sub_task: subTaskId, p_team: COPY, p_assignee: await idOf('writer'), p_hours: 2, p_needed_by: onDay, p_note: 'Legacy job, can Copy take it?',
    })
    const status = async () => (await rows<{ status: string; decided_by: string | null }>('sub_task_assignment_requests', `select=status,decided_by&id=eq.${requestId}`))[0]!

    // May NOT: the Creative department lead opens the same booking — he reads where it stands, no Withdraw.
    const lead = await as(browser, 'lead')
    await lead.goto(`/schedule?on=${onDay}&view=master`)
    await lead.getByTestId(`booking-${booking!.id}`).click()
    await expect(lead.getByTestId('edit-dialog')).toBeVisible()
    await expect(lead.getByTestId('edit-pending-request')).toContainText(PEOPLE.tl.name)
    expect(await lead.getByTestId('edit-withdraw-request').count()).toBe(0)
    await lead.context().close()
    expect((await status()).status).toBe('pending')

    // MAY: the asker withdraws it from the dialog.
    const tl = await as(browser, 'tl')
    await tl.goto(`/schedule?on=${onDay}&view=master`)
    await tl.getByTestId(`booking-${booking!.id}`).click()
    await expect(tl.getByTestId('edit-dialog')).toBeVisible()
    await expect(tl.getByTestId('edit-pending-request')).toContainText(PEOPLE.tl.name)
    await tl.getByTestId('edit-withdraw-request').click()
    await expect.poll(async () => (await status()).status).toBe('withdrawn')
    expect((await status()).decided_by).toBe(await idOf('tl'))
    await expect(tl.getByTestId('edit-pending-request')).toHaveCount(0)
    await tl.context().close()
  })

  test('a piece-less task booking\'s fields: the team lead edits title, hours, end date, review mode and assignee, then cancels the task; a team member is refused', async ({ browser }) => {
    test.setTimeout(120_000)
    const day = workday(7)
    const end = workday(8)
    const job = await adhocWithBooking(`Legacy fields ${Date.now()}`, day)
    const deputy = await idOf('deputy')
    const task = async () => (await rows<{ title: string; assignee_id: string; review_mode: string; sla_hours: number; due_at: string; status: string }>(
      'sub_tasks', `select=title,assignee_id,review_mode,sla_hours,due_at,status&id=eq.${job.subTaskId}`))[0]!
    const before = await task()
    expect(before.review_mode).toBe('digital')

    // May NOT: the maker holds no project_tasks:manage — the dialog says so up front; Save and Cancel task are dead.
    const maker = await as(browser, 'maker')
    await maker.goto(`/schedule?on=${day}&view=master`)
    await maker.getByTestId(`booking-${job.bookingId}`).click()
    await expect(maker.getByTestId('edit-dialog')).toBeVisible()
    await expect(maker.getByTestId('edit-denied')).toBeVisible()
    await expect(maker.getByTestId('edit-save')).toBeDisabled()
    await expect(maker.getByTestId('edit-cancel-task')).toBeDisabled()
    await maker.context().close()
    expect(await task()).toEqual(before)

    // MAY: the team lead (Design, in reach of the task and of the deputy) edits every task field and saves.
    const tl = await as(browser, 'tl')
    await tl.goto(`/schedule?on=${day}&view=master`)
    await tl.getByTestId(`booking-${job.bookingId}`).click()
    const dialog = tl.getByTestId('edit-dialog')
    await expect(dialog).toBeVisible()
    // A task booking shows the task's fields, not a reservation's.
    await expect(tl.getByTestId('edit-resource')).toHaveCount(0)
    await expect(tl.getByTestId('edit-notes')).toHaveCount(0)
    await expect(tl.getByTestId('edit-save')).toBeEnabled({ timeout: 15_000 })
    await tl.getByTestId('edit-title').fill(`${before.title} (edited)`)
    await tl.getByTestId('edit-hours').fill('3')
    await tl.getByTestId('edit-end-date').fill(end)
    await tl.getByTestId('edit-review-mode').selectOption('manual')
    await tl.getByTestId('edit-assignee').selectOption(deputy)
    await expect(tl.getByTestId('edit-denied')).toHaveCount(0)
    await expect(tl.getByTestId('edit-will-request')).toHaveCount(0)
    await tl.getByTestId('edit-save').click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(async () => (await task()).assignee_id).toBe(deputy)
    const after = await task()
    expect(after.title).toBe(`${before.title} (edited)`)
    expect(after.review_mode).toBe('manual')
    expect(after.sla_hours).toBe(6) // 3 h a day over the two working days
    expect(iraqDayOf(after.due_at)).toBe(end)
    const live = await liveBookings(job.subTaskId)
    expect(live.length).toBeGreaterThan(0)
    expect(live.every((b) => b.resource_id === job.deputyResource)).toBe(true)
    expect(live.some((b) => iraqDayOf(b.starts_at) === end)).toBe(true)

    // MAY: cancel a task from its piece-less booking — asked first, then cancelled, every booking freed. (A second
    // job: the save above re-wrote the first one's bookings WITH their piece, so they now open the task pop-up.)
    const other = await adhocWithBooking(`Legacy cancel ${Date.now()}`, day)
    await tl.goto(`/schedule?on=${day}&view=master`)
    await tl.getByTestId(`booking-${other.bookingId}`).click()
    await expect(dialog).toBeVisible()
    await tl.getByTestId('edit-cancel-task').click()
    await expect(tl.getByTestId('edit-cancel-confirm-dialog')).toBeVisible()
    await tl.getByTestId('edit-cancel-confirm-confirm').click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(async () => (await rows<{ status: string }>('sub_tasks', `select=status&id=eq.${other.subTaskId}`))[0]!.status).toBe('cancelled')
    expect(await liveBookings(other.subTaskId)).toHaveLength(0)
    await tl.context().close()
  })

  test('a reservation with no task: the team lead moves it to another resource and writes its title and notes; somebody out of reach is refused', async ({ browser }) => {
    test.setTimeout(90_000)
    const day = workday(9)
    // A plain reservation (no task, no piece) — the shape older bookings have; staged, see the header.
    const [t] = await rows<{ tenant_id: string }>('sub_tasks', `select=tenant_id&id=eq.${subTaskId}`)
    const staged = await attemptWrite('POST', 'bookings', '', {
      tenant_id: t!.tenant_id, resource_id: await resourceIdOf('maker'), booked_by: await idOf('tl'),
      sub_task_id: null, deliverable_id: null, state: 'confirmed', title: `Reservation ${Date.now()}`,
      starts_at: at(day, 9), ends_at: at(day, 11), load_pct: 25, notes: 'held',
    })
    expect(staged.status, staged.text).toBeLessThan(300)
    const [booking] = JSON.parse(staged.text) as { id: string; title: string }[]
    const row = async () => (await rows<{ resource_id: string; title: string; notes: string; state: string }>(
      'bookings', `select=resource_id,title,notes,state&id=eq.${booking!.id}`))[0]!
    const before = await row()

    // May NOT: the Copy team lead has no reach over a Design maker's booking — refused up front, nothing written.
    const copy = await as(browser, 'copytl')
    await copy.goto(`/schedule?on=${day}&view=master`)
    await copy.getByTestId(`booking-${booking!.id}`).click()
    await expect(copy.getByTestId('edit-dialog')).toBeVisible()
    await expect(copy.getByTestId('edit-denied')).toBeVisible()
    await expect(copy.getByTestId('edit-save')).toBeDisabled()
    await copy.context().close()
    expect(await row()).toEqual(before)

    // MAY: the team lead reads the reservation's own fields (no task fields) and changes them.
    const tl = await as(browser, 'tl')
    await tl.goto(`/schedule?on=${day}&view=master`)
    await tl.getByTestId(`booking-${booking!.id}`).click()
    const dialog = tl.getByTestId('edit-dialog')
    await expect(dialog).toBeVisible()
    await expect(tl.getByTestId('edit-assignee')).toHaveCount(0)
    await expect(tl.getByTestId('edit-review-mode')).toHaveCount(0)
    await expect(tl.getByTestId('edit-end-date')).toHaveCount(0)
    await expect(tl.getByTestId('edit-cancel-task')).toHaveCount(0)
    const deputyResource = await resourceIdOf('deputy')
    await tl.getByTestId('edit-resource').selectOption(deputyResource)
    await tl.getByTestId('edit-title').fill(`${booking!.title} (moved)`)
    await tl.getByTestId('edit-notes').fill('held for the deputy')
    await expect(tl.getByTestId('edit-denied')).toHaveCount(0)
    await tl.getByTestId('edit-save').click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(async () => (await row()).resource_id).toBe(deputyResource)
    const after = await row()
    expect(after.title).toBe(`${booking!.title} (moved)`)
    expect(after.notes).toBe('held for the deputy')
    expect(after.state).toBe('confirmed')
    await tl.context().close()
  })
})

/** The Iraq calendar day of an instant (the app's working day, UTC+3). */
function iraqDayOf(iso: string): string {
  return new Date(Date.parse(iso) + 3 * 3_600_000).toISOString().slice(0, 10)
}

async function liveBookings(subTask: string) {
  return rows<{ id: string; resource_id: string; starts_at: string }>(
    'bookings', `select=id,resource_id,starts_at&sub_task_id=eq.${subTask}&state=in.(soft_hold,tentative,confirmed)&order=starts_at`)
}

/** A fresh ad-hoc job on the maker (the old dialog's door, as the team lead) and its piece-less booking (staged). */
async function adhocWithBooking(title: string, day: string) {
  const [made] = await rpcAs<{ sub_task_id: string; deliverable_id: string }[]>('tl', 'create_adhoc_deliverable', {
    p_assignee: await idOf('maker'), p_title: title, p_hours: 2,
    p_starts_at: at(day, 9), p_due_at: at(day, 17), p_reviewer: await idOf('tl'),
  })
  expect(made, 'the ad-hoc job is made').toBeTruthy()
  const [t] = await rows<{ tenant_id: string }>('sub_tasks', `select=tenant_id&id=eq.${made!.sub_task_id}`)
  const staged = await attemptWrite('POST', 'bookings', '', {
    tenant_id: t!.tenant_id, resource_id: await resourceIdOf('maker'), booked_by: await idOf('tl'),
    sub_task_id: made!.sub_task_id, deliverable_id: null, state: 'confirmed',
    starts_at: at(day, 9), ends_at: at(day, 11), load_pct: 25, notes: title,
  })
  expect(staged.status, staged.text).toBeLessThan(300)
  const [booking] = JSON.parse(staged.text) as { id: string }[]
  return { subTaskId: made!.sub_task_id, bookingId: booking!.id, deputyResource: await resourceIdOf('deputy') }
}
