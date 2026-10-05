import { test, expect, type Page } from '@playwright/test'
import { rows } from '../helpers/db'
import {
  API, ANON, PEOPLE, as, tokenOf, rpcAs, rpcRaw, idOf, taskRow, bookingsOf, requestsOn, toldAbout,
  makeApprovedPiece, assignAs, workday, at, type Tag, type TaskRow,
} from '../helpers/i74'

/**
 * Coverage — the one task editor and the task's pop-up on the Schedule (ADR-0140 d.1–d.3, d.5; I74.7–I74.9, I74.11).
 *
 * A Creative single job is released by the account manager (Inas in the demo data); its owner, the Creative
 * department lead (Fadia), approves the list. Its tasks are given out through `update_task_assignment` and placed by
 * `subtask-schedule` — the doors the editors call — so each has a chip on the Schedule:
 *
 *   T0  Zubaida (maker), started by her            — the started-task rules
 *   T1  Zubaida                                     — Cancel this booking (keep, then yes) and who is told
 *   T2  the Content writer, given by Traffic      — another team's task: Traffic edits it; the owner's day move is an ASK
 *   T3  Zubaida                                     — Take them off, then (re-given) Remove this task
 *   X   a task the owner adds                     — what it waits for, set and cleared
 *
 * ALLOWED: the owner edits every field (title, hours, notes, waits-for) and the database shows it; Traffic edits a task
 * of any team; a started task's days move after "Move it". REFUSED: removing a started task (not offered, and the
 * server says task_started); moving a started task's days without the say-so (task_started, nothing moves);
 * `save_sub_task` moving another team's days (use_update_task_assignment, nothing moves); the owner's move of another
 * team's days is not applied — it is a pending request to their lead. Cancelling a booking tells the assignee and
 * their team lead, NOT the account manager.
 */
test.use({ actionTimeout: 15_000 })
test.describe.configure({ mode: 'serial' })

const iraqDayOf = (iso: string) => new Date(Date.parse(iso) + 3 * 3_600_000).toISOString().slice(0, 10)

/** Place a given task on the calendar the way the editors do after an assignment (`subtask-schedule`). */
async function scheduleAs(tag: Tag, subTaskId: string) {
  const res = await fetch(`${API}/functions/v1/subtask-schedule`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${await tokenOf(tag)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ subTaskId }),
  })
  expect(res.status, `subtask-schedule as ${tag}: ${await res.text()}`).toBeLessThan(300)
  await expect.poll(async () => (await bookingsOf(subTaskId)).length, { timeout: 15_000 }).toBeGreaterThan(0)
}

/** Open a task's chip on the Schedule; the pop-up is the one task editor. */
async function openPopup(page: Page, subTaskId: string, view: 'team' | 'master' = 'team') {
  const [b] = await bookingsOf(subTaskId)
  expect(b, `task ${subTaskId} has a booking`).toBeTruthy()
  await page.goto(`/schedule?on=${iraqDayOf(b!.starts_at)}${view === 'master' ? '&view=master' : ''}`)
  const chip = page.getByTestId(`booking-${b!.id}`)
  await expect(chip).toBeVisible({ timeout: 20_000 })
  await chip.click()
  await expect(page.getByTestId('task-popup')).toBeVisible()
  await expect(page.getByTestId('edit-task')).toBeVisible({ timeout: 15_000 })
}

/** Click one day twice in a DatesPicker — whatever the picker's next end, it ends on that one day. */
async function pickOneDay(page: Page, pickerTestId: string, isoDay: string) {
  const day = page.getByTestId(`${pickerTestId}-day-${isoDay}`)
  await day.click()
  await day.click()
  await expect(page.getByTestId(`${pickerTestId}-from`)).toHaveText(/.+/)
  await page.getByTestId(`${pickerTestId}-done`).click()
}

let job: { campaignId: string; deliverableId: string }
let T: TaskRow[]
let X: string
const stamp = Date.now()

test.describe('The one task editor and the Schedule pop-up (ADR-0140)', () => {
  test.beforeAll(async ({ browser }) => {
    const made = await makeApprovedPiece(browser, `Task editor ${stamp}`, { approve: false })
    job = made.job
    // The owner approves the list (the door the panel's Approve calls) — nobody is given work before it (d.4).
    await rpcAs('lead', 'approve_deliverable_tasks', { p_deliverable: job.deliverableId })
    T = made.tasks
    expect(T.length, 'the Social Advertisement list has four tasks').toBeGreaterThanOrEqual(4)

    expect((await assignAs('lead', T[0]!.id, 'maker', 'tl', workday(3))).outcome).toBe('assigned')
    expect((await assignAs('lead', T[1]!.id, 'maker', 'tl', workday(3))).outcome).toBe('assigned')
    expect((await assignAs('traffic', T[2]!.id, 'writer', 'content', workday(5))).outcome).toBe('assigned')
    expect((await assignAs('lead', T[3]!.id, 'maker', 'tl', workday(4))).outcome).toBe('assigned')
    await scheduleAs('lead', T[0]!.id)
    await scheduleAs('lead', T[1]!.id)
    await scheduleAs('traffic', T[2]!.id)
    await scheduleAs('lead', T[3]!.id)
    await rpcAs('maker', 'sub_task_start', { p_id: T[0]!.id })
    expect((await taskRow(T[0]!.id)).status).toBe('in_progress')

    // X: a task the owner adds by hand (the panel's add calls save_sub_task the same way); it waits for nothing.
    X = await rpcAs<string>('lead', 'save_sub_task', {
      p_sub_task: null, p_deliverable: job.deliverableId, p_title: `Extra step ${stamp}`, p_reviewers: null, p_sla_hours: 1,
    })
    expect(X).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('Traffic edits a task of another team from its chip — the title is saved', async ({ browser }) => {
    const traffic = await as(browser, 'traffic')
    await openPopup(traffic, T[2]!.id, 'master')
    const title = `Copy lines ${stamp}`
    await traffic.getByTestId('edit-task-title').fill(title)
    await traffic.getByTestId('edit-task-save').click()
    // I74.32 (Edward, 4 Oct): Save closes the pop-up.
    await expect(traffic.getByTestId('edit-dialog')).toHaveCount(0, { timeout: 15_000 })
    await expect.poll(async () => (await taskRow(T[2]!.id)).title).toBe(title)
    await traffic.context().close()
  })

  test('may NOT: save_sub_task is no back door — another team\'s days are refused, nothing moves', async () => {
    const before = await taskRow(T[2]!.id)
    const res = await rpcRaw('lead', 'save_sub_task', {
      p_sub_task: T[2]!.id, p_deliverable: job.deliverableId, p_title: before.title, p_reviewers: null,
      p_starts_at: at(workday(12), 9), p_due_at: at(workday(12), 17),
    })
    expect(res.status).toBe(403)
    expect(res.text).toContain('use_update_task_assignment')
    const after = await taskRow(T[2]!.id)
    expect({ s: after.starts_at, d: after.due_at, a: after.assignee_id }).toEqual({ s: before.starts_at, d: before.due_at, a: before.assignee_id })
  })

  test('the owner moves another team\'s task days in the editor — it becomes an ask to their lead; the days stay', async ({ browser }) => {
    const before = await taskRow(T[2]!.id)
    const bookingsBefore = (await bookingsOf(T[2]!.id)).map((b) => b.id).sort()
    const lead = await as(browser, 'lead')
    await lead.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
    await expect(lead.getByTestId('piece-panel-tasks')).toBeVisible({ timeout: 20_000 })
    await lead.getByTestId(`piece-panel-tasks-edit-${T[2]!.id}`).click()
    await expect(lead.getByTestId('task-editor-dialog-form')).toBeVisible({ timeout: 15_000 })
    await lead.getByTestId('task-editor-dialog-form-dates').click()
    await pickOneDay(lead, 'task-editor-dialog-form-dates-picker', workday(12))
    await lead.getByTestId('task-editor-dialog-form-save').click()
    // I74.32 (Edward, 4 Oct): Save closes the window; what happened is read from the database.
    await expect(lead.getByTestId('task-editor-dialog-form')).toHaveCount(0, { timeout: 15_000 })
    await expect.poll(async () => (await requestsOn(T[2]!.id)).length, { timeout: 15_000 }).toBeGreaterThan(0)

    const [req] = await requestsOn(T[2]!.id)
    expect(req, 'a request is on the task').toBeTruthy()
    expect(req!.status).toBe('pending')
    expect(req!.requested_by).toBe(await idOf('lead'))
    const after = await taskRow(T[2]!.id)
    expect({ s: after.starts_at, d: after.due_at, a: after.assignee_id }, 'nothing moved until the lead answers')
      .toEqual({ s: before.starts_at, d: before.due_at, a: before.assignee_id })
    expect((await bookingsOf(T[2]!.id)).map((b) => b.id).sort()).toEqual(bookingsBefore)
    await lead.context().close()
  })

  test('what a task waits for: the owner ticks one, saves, then "starts any time" clears it', async ({ browser }) => {
    const deps = async () => (await rows<{ depends_on_sub_task_id: string }>('sub_task_dependencies', `select=depends_on_sub_task_id&sub_task_id=eq.${X}`)).map((d) => d.depends_on_sub_task_id)
    expect(await deps(), 'the added task waits for nothing').toEqual([])
    const lead = await as(browser, 'lead')
    await lead.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
    await lead.getByTestId(`piece-panel-tasks-edit-${X}`).click()
    const form = 'task-editor-dialog-form'
    await expect(lead.getByTestId(form)).toBeVisible({ timeout: 15_000 })
    await lead.getByTestId(`${form}-waits-${T[3]!.id}`).click()
    await lead.getByTestId(`${form}-save`).click()
    await expect.poll(deps).toEqual([T[3]!.id])
    // I74.32: Save closes the window.
    await expect(lead.getByTestId(form)).toHaveCount(0, { timeout: 15_000 })

    await lead.getByTestId(`piece-panel-tasks-edit-${X}`).click()
    await expect(lead.getByTestId(`${form}-waits-${T[3]!.id}`)).toHaveAttribute('aria-pressed', 'true')
    await lead.getByTestId(`${form}-waits-none`).click()
    await lead.getByTestId(`${form}-save`).click()
    await expect.poll(deps).toEqual([])
    await lead.context().close()
  })

  test('a started task: Remove is not offered, and the server refuses it (task_started)', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await openPopup(lead, T[0]!.id)
    await expect(lead.getByTestId('edit-task-no-remove')).toBeVisible()
    expect(await lead.getByTestId('edit-remove-task').count()).toBe(0)
    await lead.getByTestId('edit-close').click()
    await lead.context().close()

    const res = await rpcRaw('lead', 'remove_sub_task', { p_sub_task: T[0]!.id })
    expect(res.status).toBe(400)
    expect(res.text).toContain('task_started')
    expect((await taskRow(T[0]!.id)).status).toBe('in_progress')
  })

  test('a started task\'s days: refused without the say-so; the pop-up asks, and "Move it" moves them', async ({ browser }) => {
    const before = await taskRow(T[0]!.id)
    const refused = await rpcRaw('lead', 'update_task_assignment', {
      p_sub_task: T[0]!.id, p_title: before.title, p_assignee: await idOf('maker'),
      p_starts_at: at(workday(9), 9), p_due_at: at(workday(9), 17),
    })
    expect(refused.status).toBe(400)
    expect(refused.text).toContain('task_started')
    expect((await taskRow(T[0]!.id)).starts_at, 'nothing moved').toBe(before.starts_at)

    const lead = await as(browser, 'lead')
    await openPopup(lead, T[0]!.id)
    await lead.getByTestId('edit-task-dates').click()
    await pickOneDay(lead, 'edit-task-dates-picker', workday(9))
    // The pop-up knows it has started: it asks before anything is sent, and Save waits behind the question.
    // I74.42: the product names people in full, never by first name.
    await expect(lead.getByTestId('edit-task-started')).toContainText(`${PEOPLE.maker.name} has started this.`)
    expect(await lead.getByTestId('edit-task-save').count()).toBe(0)
    expect((await taskRow(T[0]!.id)).starts_at).toBe(before.starts_at)
    await lead.getByTestId('edit-task-move-anyway').click()
    await expect.poll(async () => iraqDayOf((await taskRow(T[0]!.id)).starts_at!)).toBe(workday(9))
    expect((await taskRow(T[0]!.id)).assignee_id).toBe(await idOf('maker'))
    await lead.context().close()
  })

  test('the hours step down and save; Edit all tasks opens every task and saves the one picked', async ({ browser }) => {
    const before = await taskRow(T[1]!.id)
    expect(before.sla_hours, 'given with 2 hours').toBe(2)
    const lead = await as(browser, 'lead')
    await openPopup(lead, T[1]!.id)
    await lead.getByTestId('edit-task-less').click()
    await expect(lead.getByTestId('edit-task-hours')).toHaveText('1h')
    await lead.getByTestId('edit-task-save').click()
    await expect.poll(async () => Number((await taskRow(T[1]!.id)).sla_hours)).toBe(1)
    // I74.32: Save closes the pop-up — open it again for Edit all tasks.
    await expect(lead.getByTestId('edit-dialog')).toHaveCount(0, { timeout: 15_000 })
    await openPopup(lead, T[1]!.id)

    await lead.getByTestId('edit-all-tasks').click()
    await expect(lead.getByTestId('edit-all-list')).toBeVisible()
    await lead.getByTestId(`edit-all-pick-${T[3]!.id}`).click()
    const renamed = `Resize ${stamp}`
    await lead.getByTestId('edit-all-form-title').fill(renamed)
    await lead.getByTestId('edit-all-form-save').click()
    await expect.poll(async () => (await taskRow(T[3]!.id)).title).toBe(renamed)
    await lead.getByTestId('edit-all-close').click()
    await expect(lead.getByTestId('edit-all')).toHaveCount(0)

    // Open the piece: the campaign page, on this piece and this task.
    await lead.getByTestId('edit-open-piece').click()
    await expect(lead).toHaveURL(new RegExp(`/campaigns/${job.campaignId}\\?piece=${job.deliverableId}&task=${T[1]!.id}`))
    await expect(lead.getByTestId('piece-panel')).toBeVisible({ timeout: 20_000 })
    await lead.context().close()
  })

  test('Cancel this booking: Keep changes nothing; Yes takes Zubaida off — she and her team lead are told, not the account manager', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await openPopup(lead, T[1]!.id)
    // Remove is asked inline too — Keep leaves the task as it is.
    await lead.getByTestId('edit-remove-task').click()
    await expect(lead.getByTestId('edit-remove-ask')).toBeVisible()
    await lead.getByTestId('edit-remove-keep').click()
    await expect(lead.getByTestId('edit-remove-ask')).toHaveCount(0)

    await lead.getByTestId('edit-cancel-booking').click()
    await expect(lead.getByTestId('edit-cancel-ask')).toBeVisible()
    await lead.getByTestId('edit-cancel-keep').click()
    await expect(lead.getByTestId('edit-cancel-ask')).toHaveCount(0)
    expect((await taskRow(T[1]!.id)).assignee_id).toBe(await idOf('maker'))
    expect((await bookingsOf(T[1]!.id)).length).toBeGreaterThan(0)

    await lead.getByTestId('edit-cancel-booking').click()
    await lead.getByTestId('edit-cancel-yes').click()
    await expect(lead.getByTestId('task-popup')).toHaveCount(0)
    await expect.poll(async () => (await taskRow(T[1]!.id)).assignee_id).toBeNull()
    const after = await taskRow(T[1]!.id)
    expect(after.status, 'back to To book').toBe('todo')
    expect(after.starts_at, 'its days kept').not.toBeNull()
    expect(await bookingsOf(T[1]!.id)).toEqual([])
    const told = (await toldAbout('task_unassigned', T[1]!.id)).sort()
    expect(told).toEqual([await idOf('maker'), await idOf('tl')].sort())
    expect(told).not.toContain(await idOf('am'))
    await lead.context().close()
  })

  test('the task page carries the editor: the owner\'s note is saved', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await lead.goto(`/my-work/task/${T[3]!.id}`)
    await expect(lead.getByTestId('task-page-editor')).toBeVisible({ timeout: 20_000 })
    await lead.getByTestId('task-page-editor-notes').fill('Use the square crop.')
    await lead.getByTestId('task-page-editor-save').click()
    await expect.poll(async () => (await rows<{ description: string | null }>('sub_tasks', `select=description&id=eq.${T[3]!.id}`))[0]!.description).toBe('Use the square crop.')
    await lead.context().close()
  })

  test('Take them off in the editor; then, given again, Remove this task calls it off and frees the calendar', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await openPopup(lead, T[3]!.id)
    await lead.getByTestId('edit-task-take-off').click()
    await expect(lead.getByTestId('edit-task-who')).toContainText('Pick a person')
    await lead.getByTestId('edit-task-save').click()
    await expect.poll(async () => (await taskRow(T[3]!.id)).assignee_id).toBeNull()
    expect(await bookingsOf(T[3]!.id)).toEqual([])
    expect((await toldAbout('task_unassigned', T[3]!.id)).sort()).toEqual([await idOf('maker'), await idOf('tl')].sort())
    // I74.32: Save closed the pop-up.
    await expect(lead.getByTestId('edit-dialog')).toHaveCount(0, { timeout: 15_000 })

    expect((await assignAs('lead', T[3]!.id, 'maker', 'tl', workday(4))).outcome).toBe('assigned')
    await scheduleAs('lead', T[3]!.id)
    await openPopup(lead, T[3]!.id)
    await lead.getByTestId('edit-remove-task').click()
    await lead.getByTestId('edit-remove-yes').click()
    await expect(lead.getByTestId('task-popup')).toHaveCount(0)
    // It had a person, so it keeps its record: called off, not deleted (remove_sub_task).
    await expect.poll(async () => (await taskRow(T[3]!.id)).status).toBe('cancelled')
    expect(await bookingsOf(T[3]!.id)).toEqual([])
    await lead.context().close()
  })
})

