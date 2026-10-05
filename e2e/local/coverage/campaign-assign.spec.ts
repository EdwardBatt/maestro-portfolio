import { test, expect, type Page } from '@playwright/test'
import { rows } from '../helpers/db'
import { closeCampaignBanner } from '../helpers/piece'
import {
  PEOPLE, as, rpcAs, rpcRaw, idOf, resourceIdOf, taskRow, bookingsOf, requestsOn, makeApprovedPiece, workday, type TaskRow,
} from '../helpers/i74'

/**
 * Coverage — the piece's tasks on the campaign page (ADR-0140 d.1, d.3, d.4; I74.10–I74.12; Figma N CP-01…CP-12).
 *
 * A Creative single job is released by the account manager (Inas); its owner, the Creative department lead (Fadia),
 * works its list on the piece panel (`/campaigns/<id>?piece=<id>`, `piece-panel-tasks-*`):
 *
 *   before approval — no Who and no Dates on any row; hours step and save; add your own; remove with undo; waits-for;
 *                     then Approve.
 *   once approved   — Who + Dates per row, hours staged, "checked by" when the task has no reviewer, Save books it;
 *                     tick-and-give (select all, clear, two rows to one person on one day); Ask another team (the
 *                     Content team's lead decides) is a request, nothing booked; a started row shows 🔒 instead of ✕,
 *                     its day move asks first and "Move it" moves it; a booked row's ✕ asks inline (Keep, then Yes).
 *
 * REFUSED: a team member (Zubaida) sees the rows read-only — no Who, no pencil, no ✕, no ticks, no Save — and the server
 * refuses her assignment (bookings:create), nothing changed.
 */
test.use({ actionTimeout: 15_000 })
test.describe.configure({ mode: 'serial' })

const COPY_TEAM = 'd0000000-0000-4000-8000-00000000d105'
const P = 'piece-panel-tasks'
const iraqDayOf = (iso: string) => new Date(Date.parse(iso) + 3 * 3_600_000).toISOString().slice(0, 10)
const stamp = Date.now()

let job: { campaignId: string; deliverableId: string }
let T: TaskRow[]
let own: string

async function openPanel(page: Page) {
  await page.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
  await expect(page.getByTestId(P)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId(`${P}-row-${T[0]!.id}`)).toBeVisible({ timeout: 15_000 })
}

/** Click one day twice in a DatesPicker — whatever the picker's next end, it ends on that one day. */
async function pickOneDay(page: Page, pickerTestId: string, isoDay: string) {
  const day = page.getByTestId(`${pickerTestId}-day-${isoDay}`)
  await day.click()
  await day.click()
  await page.getByTestId(`${pickerTestId}-done`).click()
  await expect(page.getByTestId(pickerTestId)).toHaveCount(0)
}

const reviewersOf = async (id: string) =>
  (await rows<{ user_id: string }>('sub_task_reviewers', `select=user_id&sub_task_id=eq.${id}`)).map((r) => r.user_id)
const depsOf = async (id: string) =>
  (await rows<{ depends_on_sub_task_id: string }>('sub_task_dependencies', `select=depends_on_sub_task_id&sub_task_id=eq.${id}`)).map((d) => d.depends_on_sub_task_id)

test.describe('The piece panel assigns once the list is approved (ADR-0140)', () => {
  test.beforeAll(async ({ browser }) => {
    const made = await makeApprovedPiece(browser, `Campaign assign ${stamp}`, { approve: false })
    job = made.job
    T = made.tasks
    expect(T.length, 'the Social Advertisement list has four tasks').toBeGreaterThanOrEqual(4)
  })

  test('before approval: the suggested list carries no Who; hours, add your own, remove with undo, waits-for; then Approve', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await openPanel(lead)
    expect(await lead.getByTestId(`${P}-who-${T[0]!.id}`).count(), 'no Who before approval').toBe(0)
    expect(await lead.getByTestId(`${P}-dates-${T[0]!.id}`).count(), 'no Dates before approval').toBe(0)
    await expect(lead.getByTestId(`${P}-status-${T[0]!.id}`)).toHaveAttribute('data-status', 'suggested')

    // Hours step down and save at once on the suggested list.
    const h0 = Number((await taskRow(T[1]!.id)).sla_hours)
    await lead.getByTestId(`${P}-less-${T[1]!.id}`).click()
    await expect.poll(async () => Number((await taskRow(T[1]!.id)).sla_hours)).toBe(Math.max(0.5, h0 - 1))

    // Add your own (three letters or more).
    const ownTitle = `Own step ${stamp}`
    await lead.getByTestId(`${P}-add`).click()
    await lead.getByTestId(`${P}-add-name`).fill(ownTitle)
    await lead.getByTestId(`${P}-add-save`).click()
    await expect.poll(async () => (await rows('sub_tasks', `select=id&deliverable_id=eq.${job.deliverableId}&title=eq.${encodeURIComponent(ownTitle)}`)).length).toBe(1)
    own = (await rows<{ id: string }>('sub_tasks', `select=id&deliverable_id=eq.${job.deliverableId}&title=eq.${encodeURIComponent(ownTitle)}`))[0]!.id
    await expect(lead.getByTestId(`${P}-row-${own}`)).toBeVisible()

    // Remove with undo: the row goes at once, Undo brings it back, and nothing is sent after the undo window.
    await lead.getByTestId(`${P}-remove-${own}`).click()
    await expect(lead.getByTestId(`${P}-undo`)).toBeVisible()
    await expect(lead.getByTestId(`${P}-row-${own}`)).toHaveCount(0)
    await lead.getByTestId(`${P}-undo-button`).click()
    await expect(lead.getByTestId(`${P}-row-${own}`)).toBeVisible()
    await lead.waitForTimeout(9_000) // the 8-second undo window (UNDO_MS) — the remove must never be sent
    expect((await rows('sub_tasks', `select=id&id=eq.${own}`)).length, 'the undone task is still there').toBe(1)

    // What it waits for: the first task.
    expect(await depsOf(own)).toEqual([])
    await lead.getByTestId(`${P}-waits-${own}`).click()
    await lead.getByTestId(`${P}-waits-picker-${T[0]!.id}`).click()
    await expect.poll(() => depsOf(own)).toEqual([T[0]!.id])
    await lead.keyboard.press('Escape')
    await expect(lead.getByTestId(`${P}-waits-pop`)).toHaveCount(0)

    await lead.getByTestId(`${P}-approve`).click()
    await closeCampaignBanner(lead)
    await expect
      .poll(async () => (await rows<{ tasks_approved_at: string | null }>('deliverables', `select=tasks_approved_at&id=eq.${job.deliverableId}`))[0]!.tasks_approved_at)
      .not.toBeNull()
    await lead.context().close()
  })

  test('once approved, the owner books a row: Who, Dates, hours, checked by — Save gives it to Zubaida on that day', async ({ browser }) => {
    expect(await reviewersOf(T[0]!.id), 'a fresh workflow task has no reviewer yet').toEqual([])
    const before = Number((await taskRow(T[0]!.id)).sla_hours)
    const day = workday(3)
    const lead = await as(browser, 'lead')
    await openPanel(lead)
    await lead.getByTestId(`${P}-who-${T[0]!.id}`).click()
    await lead.getByTestId(`${P}-people-${await resourceIdOf('maker')}`).click()
    await expect(lead.getByTestId(`${P}-who-${T[0]!.id}`)).toContainText(PEOPLE.maker.name.split(' ')[0]!)
    await lead.getByTestId(`${P}-dates-${T[0]!.id}`).click()
    await pickOneDay(lead, `${P}-dates-picker`, day)
    await lead.getByTestId(`${P}-less-${T[0]!.id}`).click()
    await lead.getByTestId(`${P}-reviewer-line`).click()
    await lead.getByTestId(`${P}-reviewer`).selectOption(await idOf('tl'))
    await lead.getByTestId(`${P}-save`).click()
    await closeCampaignBanner(lead)

    await expect.poll(async () => (await taskRow(T[0]!.id)).assignee_id).toBe(await idOf('maker'))
    const t0 = await taskRow(T[0]!.id)
    expect(iraqDayOf(t0.starts_at!)).toBe(day)
    expect(Number(t0.sla_hours)).toBe(Math.max(0.5, before - 1))
    expect(await reviewersOf(T[0]!.id)).toContain(await idOf('tl'))
    await expect.poll(async () => (await bookingsOf(T[0]!.id)).length, { timeout: 15_000 }).toBeGreaterThan(0)
    await expect(lead.getByTestId(`${P}-status-${T[0]!.id}`)).toHaveAttribute('data-status', 'booked')
    await lead.context().close()
  })

  test('tick and give: select all, clear, then two rows to Zubaida on one day — both booked', async ({ browser }) => {
    const day = workday(4)
    const lead = await as(browser, 'lead')
    await openPanel(lead)
    await lead.getByTestId(`${P}-select-all`).check()
    await expect(lead.getByTestId(`${P}-bulk`)).toBeVisible()
    await lead.getByTestId(`${P}-bulk-clear`).click()
    await expect(lead.getByTestId(`${P}-bulk`)).toHaveCount(0)
    await expect(lead.getByTestId(`${P}-select-${T[1]!.id}`)).not.toBeChecked()

    // A task with no hours cannot be given out (E11): both rows are given hours first, so the give can book both.
    for (const t of [T[1]!, T[2]!]) {
      if ((await taskRow(t.id)).sla_hours == null) {
        await lead.getByTestId(`${P}-more-${t.id}`).click()
        await expect(lead.getByTestId(`${P}-hours-${t.id}`)).not.toHaveText('—')
      }
    }
    await lead.getByTestId(`${P}-select-${T[1]!.id}`).check()
    await lead.getByTestId(`${P}-select-${T[2]!.id}`).check()
    await lead.getByTestId(`${P}-bulk-who`).click()
    await lead.getByTestId(`${P}-bulk-people-${await resourceIdOf('maker')}`).click()
    await lead.getByTestId(`${P}-bulk-day`).click()
    await lead.getByTestId(`${P}-bulk-day-picker-day-${day}`).click()
    await lead.getByTestId(`${P}-bulk-apply`).click()
    await expect(lead.getByTestId(`${P}-bulk-line`)).toBeVisible()
    await lead.getByTestId(`${P}-reviewer`).selectOption(await idOf('tl'))
    await lead.getByTestId(`${P}-save`).click()
    await closeCampaignBanner(lead)

    const maker = await idOf('maker')
    for (const t of [T[1]!, T[2]!]) {
      await expect.poll(async () => (await taskRow(t.id)).assignee_id).toBe(maker)
      expect(iraqDayOf((await taskRow(t.id)).starts_at!)).toBe(day)
    }
    expect((await taskRow(T[3]!.id)).assignee_id, 'the unticked row is untouched').toBeNull()
    await lead.context().close()
  })

  test('Ask another team: the Content team\'s lead decides — a request, nothing booked, the row says asked', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await openPanel(lead)
    // An ask names who checks the task (20261003180000): the owner gives the task its reviewer first, through the
    // door the task editor's Reviewers save uses. The panel's own refusal without one is the last test below.
    const tl = await idOf('tl')
    const ownRow = await taskRow(own)
    await rpcAs('lead', 'save_sub_task', { p_sub_task: own, p_deliverable: ownRow.deliverable_id, p_title: ownRow.title, p_reviewers: [{ user_id: tl, is_mandatory: true }] })
    await lead.reload()
    await expect(lead.getByTestId(`${P}-row-${own}`)).toBeVisible({ timeout: 15_000 })
    await lead.getByTestId(`${P}-who-${own}`).click()
    await lead.getByTestId(`${P}-people-ask-other`).click()
    await lead.getByTestId(`${P}-people-ask-team`).selectOption(COPY_TEAM)
    await lead.getByTestId(`${P}-people-ask-anyone`).click()
    await closeCampaignBanner(lead)

    const [req] = await requestsOn(own)
    expect(req, 'a request is on the task').toBeTruthy()
    expect({ status: req!.status, team: req!.team_id, by: req!.requested_by, person: req!.assignee_id })
      .toEqual({ status: 'pending', team: COPY_TEAM, by: await idOf('lead'), person: null })
    expect((await taskRow(own)).assignee_id).toBeNull()
    expect(await bookingsOf(own)).toEqual([])
    await expect(lead.getByTestId(`${P}-asked-${own}`)).toContainText('Copy · asked')
    await lead.context().close()
  })

  test('a started row: 🔒 instead of ✕; its day move asks first, and "Move it" moves it', async ({ browser }) => {
    await rpcAs('maker', 'sub_task_start', { p_id: T[0]!.id })
    const before = await taskRow(T[0]!.id)
    const day = workday(9)
    const lead = await as(browser, 'lead')
    await openPanel(lead)
    await expect(lead.getByTestId(`${P}-locked-${T[0]!.id}`)).toBeVisible()
    expect(await lead.getByTestId(`${P}-remove-${T[0]!.id}`).count()).toBe(0)

    await lead.getByTestId(`${P}-dates-${T[0]!.id}`).click()
    await pickOneDay(lead, `${P}-dates-picker`, day)
    await lead.getByTestId(`${P}-save`).click()
    await expect(lead.getByTestId(`${P}-started-${T[0]!.id}`)).toBeVisible()
    expect((await taskRow(T[0]!.id)).starts_at, 'nothing moved before the say-so').toBe(before.starts_at)
    await lead.getByTestId(`${P}-move-anyway-${T[0]!.id}`).click()
    await expect.poll(async () => iraqDayOf((await taskRow(T[0]!.id)).starts_at!)).toBe(day)
    expect((await taskRow(T[0]!.id)).assignee_id).toBe(await idOf('maker'))
    await lead.context().close()
  })

  test('a booked row\'s ✕ asks inline: Keep leaves it; Yes calls it off and frees Zubaida\'s day', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await openPanel(lead)
    await lead.getByTestId(`${P}-remove-${T[1]!.id}`).click()
    await expect(lead.getByTestId(`${P}-remove-ask-${T[1]!.id}`)).toBeVisible()
    await lead.getByTestId(`${P}-remove-keep-${T[1]!.id}`).click()
    await expect(lead.getByTestId(`${P}-remove-ask-${T[1]!.id}`)).toHaveCount(0)
    expect((await taskRow(T[1]!.id)).status).toBe('todo')
    expect((await taskRow(T[1]!.id)).assignee_id).toBe(await idOf('maker'))

    await lead.getByTestId(`${P}-remove-${T[1]!.id}`).click()
    await lead.getByTestId(`${P}-remove-yes-${T[1]!.id}`).click()
    await expect.poll(async () => (await taskRow(T[1]!.id)).status).toBe('cancelled')
    expect(await bookingsOf(T[1]!.id)).toEqual([])
    await lead.context().close()
  })

  test('Edit all tasks opens the one editor over the piece; Open the Schedule goes there', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await openPanel(lead)
    await lead.getByTestId(`${P}-edit-all`).click()
    await expect(lead.getByTestId('task-editor-dialog-list')).toBeVisible({ timeout: 15_000 })
    await expect(lead.getByTestId(`task-editor-dialog-pick-${T[2]!.id}`)).toBeVisible()
    await lead.getByTestId('task-editor-dialog-close').click()
    await expect(lead.getByTestId('task-editor-dialog')).toHaveCount(0)
    await lead.getByTestId(`${P}-open-schedule`).click()
    await expect(lead).toHaveURL(/\/schedule/)
    await expect(lead.getByTestId('surface-schedule')).toBeVisible({ timeout: 20_000 })
    await lead.context().close()
  })

  test('may NOT: a team member sees the rows read-only, and the server refuses her assignment', async ({ browser }) => {
    // A team member reads the piece in its drawer — "The whole story", each task with who has it — and is given no
    // editor at all: none of the panel's assigning controls exist for her.
    const maker = await as(browser, 'maker')
    await maker.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
    const id = T[2]!.id
    await expect(maker.getByTestId('piece-drawer')).toBeVisible({ timeout: 20_000 })
    await expect(maker.getByTestId(`piece-drawer-task-${id}`)).toContainText(T[2]!.title)
    await expect(maker.getByTestId(`piece-drawer-task-${id}`)).toContainText(PEOPLE.maker.name)
    for (const tid of ['piece-panel', P, `${P}-who-${id}`, `${P}-dates-${id}`, `${P}-edit-${id}`, `${P}-remove-${id}`, `${P}-select-${id}`, `${P}-select-all`, `${P}-save`, `${P}-edit-all`, `${P}-add`, 'piece-drawer-edit']) {
      expect(await maker.getByTestId(tid).count(), `${tid} is not offered to a team member`).toBe(0)
    }
    await maker.context().close()

    const before = await taskRow(id)
    const res = await rpcRaw('maker', 'update_task_assignment', {
      p_sub_task: id, p_title: before.title, p_assignee: await idOf('tl'),
      p_starts_at: before.starts_at, p_due_at: before.due_at,
    })
    expect(res.status).toBe(403)
    expect(res.text).toMatch(/requires project-task management permission/)
    const after = await taskRow(id)
    expect({ a: after.assignee_id, s: after.starts_at }).toEqual({ a: before.assignee_id, s: before.starts_at })
  })

  test('an ask from the panel for a task nobody checks is refused until "Checked by" is picked — then it goes, carrying the reviewer', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await openPanel(lead)
    // A task of the owner's own, added on the panel: nobody checks it yet.
    const title = `Unchecked ask ${Date.now()}`
    await lead.getByTestId(`${P}-add`).click()
    await lead.getByTestId(`${P}-add-name`).fill(title)
    await lead.getByTestId(`${P}-add-save`).click()
    await expect.poll(async () => (await rows<{ id: string }>('sub_tasks', `select=id&deliverable_id=eq.${job.deliverableId}&title=eq.${encodeURIComponent(title)}`)).length).toBe(1)
    const [{ id }] = await rows<{ id: string }>('sub_tasks', `select=id&deliverable_id=eq.${job.deliverableId}&title=eq.${encodeURIComponent(title)}`)
    expect(await rows('sub_task_reviewers', `select=user_id&sub_task_id=eq.${id}`)).toEqual([])

    await lead.getByTestId(`${P}-who-${id}`).click()
    await lead.getByTestId(`${P}-people-ask-other`).click()
    await lead.getByTestId(`${P}-people-ask-team`).selectOption(COPY_TEAM)
    await lead.getByTestId(`${P}-people-ask-anyone`).click()
    await expect(lead.getByTestId('campaign-banner-dialog')).toContainText('Pick who checks the work first.')
    await lead.getByTestId('campaign-banner-close').click()
    expect(await requestsOn(id), 'nothing is asked without a reviewer').toEqual([])
    // The UI never blocks: the pick the refusal asks for is on the panel to make — picked, the ask goes, carrying the
    // reviewer; the task is not touched until a lead books it (I74.53).
    await expect(lead.getByTestId(`${P}-reviewer`)).toBeVisible()
    await lead.getByTestId(`${P}-reviewer`).selectOption(await idOf('tl'))
    await lead.getByTestId(`${P}-who-${id}`).click()
    await lead.getByTestId(`${P}-people-ask-other`).click()
    await lead.getByTestId(`${P}-people-ask-team`).selectOption(COPY_TEAM)
    await lead.getByTestId(`${P}-people-ask-anyone`).click()
    await closeCampaignBanner(lead)
    await expect.poll(async () => (await requestsOn(id)).length).toBe(1)
    const [req] = await requestsOn(id)
    expect({ status: req!.status, team: req!.team_id, by: req!.requested_by, person: req!.assignee_id })
      .toEqual({ status: 'pending', team: COPY_TEAM, by: await idOf('lead'), person: null })
    const [carried] = await rows<{ reviewers: { user_id: string }[] }>('sub_task_assignment_requests', `select=reviewers&id=eq.${req!.id}`)
    expect(carried!.reviewers.map((r) => r.user_id), 'the ask carries who checks it').toEqual([await idOf('tl')])
    expect(await rows('sub_task_reviewers', `select=user_id&sub_task_id=eq.${id}`), 'the task is untouched until booked').toEqual([])
    expect((await taskRow(id)).assignee_id).toBeNull()
    expect(await bookingsOf(id)).toEqual([])
    await expect(lead.getByTestId(`${P}-asked-${id}`)).toContainText('Copy · asked')
    await lead.context().close()
  })
})
