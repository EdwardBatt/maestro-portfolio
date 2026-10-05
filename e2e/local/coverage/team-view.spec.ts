import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { attemptWrite, rows, userIdOf } from '../helpers/db'
import { releaseSingleJob, type ReleasedJob } from '../helpers/single-job'
import { addTaskOnPanel, approveTaskList } from '../helpers/piece'
import { rpcAs } from '../helpers/i74'

/**
 * Coverage — the team / department view (I59.12, I59.13, ADR-0105 d.4 / d.5), every new control
 * pressed (ADR-0095): the week arrows, the four figures, the four tabs, the filter, the workstream
 * filter, the department picker, the drag onto a person and the L6 / L7 warnings, By person's name
 * and By piece's Move / Assign. Outcomes are read from the database.
 *
 * I59 follow-ups: a team's "Nobody yet" is only work on pieces a team member OWNS (E1); By piece's
 * "For" is real time in the current state (E2); a Nobody-yet drop the drag cannot finish (no usable
 * reviewer) opens the Schedule's assignment dialog pre-filled (settled 25 Sep).
 *
 * Actors: `lead` (Creative department lead) drives the department view and the drag; `tl` (Design
 * team lead) proves the team scope; `admin` (no department of their own) uses the picker; `maker`
 * (a team member) is offered no team view at all.
 *
 * The work is a single job released for Creative, whose task list the lead approves — so its tasks
 * are unassigned Creative work, the department view's "Nobody yet" row (ADR-0100).
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
/** The Sunday a day's week starts on — the view's own spine. */
const sundayOf = (iso: string) => shift(iso, -new Date(`${iso}T12:00:00Z`).getUTCDay())

async function resourceIdOf(name: string): Promise<string> {
  const [r] = await rows<{ id: string }>('resources', `select=id&name=eq.${encodeURIComponent(name)}&is_active=eq.true`)
  expect(r, `resource ${name}`).toBeTruthy()
  return r.id
}
type Task = { id: string; title: string; assignee_id: string | null; starts_at: string | null; due_at: string | null; committed_due_at: string | null }
const taskRow = async (id: string) => (await rows<Task>('sub_tasks', `select=id,title,assignee_id,starts_at,due_at,committed_due_at&id=eq.${id}`))[0]!

/** A drag the way the timeline hears it: the bar's dragstart writes the task id, the cell reads it. */
async function drag(page: Page, taskId: string, resourceId: string, isoDate: string) {
  const dt = await page.evaluateHandle(() => new DataTransfer())
  await page.getByTestId(`tv-bar-${taskId}`).dispatchEvent('dragstart', { dataTransfer: dt })
  const cell = page.getByTestId(`tv-cell-${resourceId}-${isoDate}`)
  await cell.dispatchEvent('dragover', { dataTransfer: dt })
  await cell.dispatchEvent('drop', { dataTransfer: dt })
}

let job: ReleasedJob
let tasks: Task[]
let week: string
let maker: string, animator: string, makerUser: string

test.describe.configure({ mode: 'serial' })

test.describe('Coverage — team / department view', () => {
  test.beforeAll(async ({ browser }) => {
    const am = await as(browser, 'am')
    job = await releaseSingleJob(am, { title: `Cov team view ${Date.now()}`, department: 'Creative', type: 'Social Advertisement' })
    await am.context().close()
    const lead = await as(browser, 'lead')
    // ADR-0140 (I71.1): the list is approved on the piece's panel; the old window is retired.
    await approveTaskList(lead, job)
    // E11 (I59): a task is assigned only with its hours, and the workflow's tasks come with none —
    // a drag of one from Nobody yet opens the assignment dialog to ask for them (the last test here
    // covers that dialog). The drags below are of work that HAS its hours: three tasks the lead
    // adds to the job, unassigned, on the piece panel's add line, then given 4 hours and the lead as reviewer
    // through save_sub_task as the lead (the task editor's door) — the add line takes a name only.
    // 'Cov team waiting' is left for the reviewer-drop test alone — the others are moved by L6/L7.
    // The week the work is planned in (the workflow's first task); the added tasks are dated inside it.
    const [first] = await rows<Task>('sub_tasks', `select=id,title,assignee_id,starts_at,due_at,committed_due_at&deliverable_id=eq.${job.deliverableId}&order=sort_order.asc&limit=1`)
    week = sundayOf((first?.starts_at ?? new Date(Date.now() + 21 * 86_400_000).toISOString()).slice(0, 10))
    const leadUser = await userIdOf(PEOPLE.lead.email)
    const added = ['Cov team 1', 'Cov team 2', 'Cov team 3', 'Cov team waiting']
    for (const title of added) {
      const id = await addTaskOnPanel(lead, job, title, shift(week, 4))
      await rpcAs('lead', 'save_sub_task', {
        p_sub_task: id, p_deliverable: job.deliverableId, p_title: title,
        p_reviewers: [{ user_id: leadUser, is_mandatory: true }], p_sla_hours: 4,
      })
    }
    await lead.context().close()
    const all = await rows<Task>('sub_tasks', `select=id,title,assignee_id,starts_at,due_at,committed_due_at&deliverable_id=eq.${job.deliverableId}&order=sort_order.asc`)
    tasks = added.slice(0, 3).map((title) => all.find((t) => t.title === title)!)
    expect(all.some((t) => t.title === 'Cov team waiting'), 'the reviewer-drop test has its own task').toBe(true)
    expect(tasks.every(Boolean), 'the three tasks with hours were added').toBe(true)
    ;[maker, animator] = await Promise.all([resourceIdOf(PEOPLE.maker.name), resourceIdOf(PEOPLE.animator.name)])
    makerUser = await userIdOf(PEOPLE.maker.email)
  })

  test('a team lead sees their team only; a team member is offered no team view', async ({ browser }) => {
    const tl = await as(browser, 'tl')
    await tl.goto(`/team?on=${week}`)
    await expect(tl.getByTestId('team-timeline')).toBeVisible()
    await expect(tl.getByTestId(`team-row-${maker}`)).toBeVisible() // Design
    await expect(tl.getByTestId(`team-row-${animator}`)).toHaveCount(0) // Motion
    await expect(tl.getByTestId('team-department-picker')).toHaveCount(0)
    // E1: the job's unassigned work is on the team's Nobody yet only if its piece's OWNER is in the
    // team — a task's own placement does not put it there.
    const [piece] = await rows<{ owner_user_id: string | null }>('deliverables', `select=owner_user_id&id=eq.${job.deliverableId}`)
    const [owner] = piece?.owner_user_id
      ? await rows<{ team_id: string | null }>('user_profiles', `select=team_id&id=eq.${piece.owner_user_id}`)
      : []
    const [tlProfile] = await rows<{ team_id: string | null }>('user_profiles', `select=team_id&email=eq.${encodeURIComponent(PEOPLE.tl.email)}`)
    const ownedInTeam = owner?.team_id != null && owner.team_id === tlProfile?.team_id
    await expect(tl.getByTestId('team-row-nobody')).toBeVisible()
    await expect(tl.getByTestId('team-row-nobody').getByTestId(`tv-bar-${tasks[0]!.id}`)).toHaveCount(ownedInTeam ? 1 : 0)
    await tl.context().close()

    const member = await as(browser, 'maker')
    await member.goto('/team')
    await expect(member.getByTestId('team-timeline')).toHaveCount(0)
    await expect(member.getByTestId('team-kpis')).toHaveCount(0)
    await member.context().close()
  })

  test('department view: week arrows, figures open their tab filtered, the four tabs', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await lead.goto(`/team?on=${week}`)
    await expect(lead.getByTestId('team-row-nobody')).toBeVisible()
    await expect(lead.getByTestId(`tv-bar-${tasks[0]!.id}`)).toBeVisible()
    // Both teams sit under their own heading in a department view.
    await expect(lead.getByTestId(`team-row-${maker}`)).toBeVisible()
    await expect(lead.getByTestId(`team-row-${animator}`)).toBeVisible()

    const title = lead.getByTestId('team-title')
    const before = await title.textContent()
    await lead.getByTestId('team-week-next').click()
    await expect(title).not.toHaveText(before!)
    await lead.getByTestId('team-week-prev').click()
    await expect(title).toHaveText(before!)
    await lead.getByTestId('team-week-today').click()
    await expect(title).toContainText(/this week/)
    await lead.goto(`/team?on=${week}`)

    await lead.getByTestId('team-figure-unassigned').click()
    await expect(lead.getByTestId('team-filter')).toBeVisible()
    await expect(lead.getByTestId(`team-piece-${tasks[0]!.id}`)).toBeVisible()
    await lead.getByTestId('team-filter-clear').click()
    await expect(lead.getByTestId('team-filter')).toHaveCount(0)
    await lead.getByTestId('team-figure-review').click()
    await expect(lead.getByTestId('team-filter')).toBeVisible()
    await lead.getByTestId('team-figure-at-risk').click()
    await expect(lead.getByTestId('team-filter')).toBeVisible()
    await lead.getByTestId('team-figure-team').click()
    await expect(lead.getByTestId('team-load')).toBeVisible()

    await lead.getByTestId('team-tab-person').click()
    await expect(lead.getByTestId('team-by-person')).toBeVisible()
    await lead.getByTestId('team-tab-piece').click()
    await expect(lead.getByTestId('team-by-piece')).toBeVisible()
    await lead.getByTestId('team-tab-load').click()
    await expect(lead.getByTestId('team-load-sentence-0')).toBeVisible()
    await lead.getByTestId('team-tab-timeline').click()
    await expect(lead.getByTestId('team-timeline')).toBeVisible()
    await lead.context().close()
  })

  test('dragging from Nobody yet onto a person assigns it, through the Schedule\'s assignment', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await lead.goto(`/team?on=${week}`)
    const t = tasks[0]!
    await drag(lead, t.id, maker, week)
    // A clean drop asks once — Cancel moves nothing…
    const confirm = lead.getByTestId('team-assign-confirm')
    const warned = lead.getByTestId('team-move-warning-dialog')
    await expect(confirm.or(warned)).toBeVisible()
    if (await warned.isVisible()) await lead.getByTestId('team-move-warning-confirm').click()
    else {
      await lead.getByTestId('team-assign-confirm-cancel').click()
      expect((await taskRow(t.id)).assignee_id).toBeNull()
      await drag(lead, t.id, maker, week)
      await lead.getByTestId('team-assign-confirm-apply').click()
    }
    await expect.poll(async () => (await taskRow(t.id)).assignee_id, { timeout: 20_000 }).toBe(makerUser)
    await lead.context().close()
  })

  test('L6: a move past the committed date warns — Cancel, Ask for the extension, Keep the date, Move it anyway', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await lead.goto(`/team?on=${week}`)
    const t = tasks[0]!
    const committed = (await taskRow(t.id)).committed_due_at
    expect(committed, 'assignment committed a date (ADR-0075 d.3)').toBeTruthy()
    // Thursday of the week, or the day after the commitment if that is later in the week.
    const late = shift(week, 4)
    const bar = lead.getByTestId(`tv-bar-${t.id}`)
    await expect(bar).toBeVisible()

    await drag(lead, t.id, maker, late)
    await expect(lead.getByTestId('team-move-warning-dialog')).toBeVisible()
    await lead.getByTestId('team-move-warning-cancel').click()
    await expect(lead.getByTestId('team-move-warning-dialog')).toHaveCount(0)

    // ADR-0141 d.2 / d.5 (I74.14, I74.16): the per-task extension is retired — a move that ends after the deliverable's
    // due date asks the account manager through the one change form, filled in with the day it would land on.
    // Its Cancel sends nothing and the task stays where it was.
    const before = (await taskRow(t.id)).starts_at
    await drag(lead, t.id, maker, late)
    await lead.getByTestId('team-move-warning-extension').click()
    await expect(lead.getByTestId('team-change-ask')).toBeVisible()
    await expect(lead.getByTestId('team-change-ask-moved')).toBeVisible()
    await lead.getByTestId('team-change-ask-cancel').click()
    await expect(lead.getByTestId('team-change-ask')).toHaveCount(0)
    expect((await taskRow(t.id)).starts_at).toBe(before)

    await drag(lead, t.id, maker, late)
    await lead.getByTestId('team-move-warning-keep-date').click()
    await expect(lead.getByTestId('team-move-warning-room')).toBeVisible()
    // Someone the room list offers who is one of the seeded people with an office — not merely the
    // first row: a long-lived local database also holds people other specs made with no office, who
    // can be given the task but are booked on no day (the scheduler has no working week for them),
    // so the moved task has no bar to drag afterwards. Exactly the seeded, fully set-up people count.
    const offered = await lead.locator('[data-testid^="team-move-warning-keep-date-"]').evaluateAll((els) =>
      els.map((e) => (e.getAttribute('data-testid') ?? '').replace('team-move-warning-keep-date-', '')))
    const seededNames = Object.values(PEOPLE).map((p) => p.name)
    const withOffice = await rows<{ id: string; name: string }>('resources', `select=id,name&office_id=not.is.null&id=in.(${offered.join(',')})`)
    // …and not the task's reviewer, whom the database refuses as its assignee (no self-review).
    const reviewerUsers = (await rows<{ user_id: string }>('sub_task_reviewers', `select=user_id&sub_task_id=eq.${t.id}`)).map((r) => r.user_id)
    const offeredRes = await rows<{ id: string; user_id: string | null }>('resources', `select=id,user_id&id=in.(${offered.join(',')})`)
    const picked = offered.find((id) =>
      withOffice.some((r) => r.id === id && seededNames.includes(r.name as never)) &&
      !reviewerUsers.includes(offeredRes.find((r) => r.id === id)?.user_id ?? ''))
    expect(picked, 'the room list offers a seeded person with an office who does not review the task').toBeTruthy()
    await lead.getByTestId(`team-move-warning-keep-date-${picked!}`).click()
    const [pickedRes] = await rows<{ user_id: string }>('resources', `select=user_id&id=eq.${picked!}`)
    await expect.poll(async () => (await taskRow(t.id)).assignee_id, { timeout: 20_000 }).toBe(pickedRes!.user_id)

    await lead.reload()
    await drag(lead, t.id, picked!, late)
    await lead.getByTestId('team-move-warning-confirm').click() // Move it anyway
    await expect.poll(async () => (await taskRow(t.id)).starts_at?.slice(0, 10), { timeout: 20_000 }).toBe(late)
    await lead.context().close()
  })

  test('L7: onto someone already full — give it to the freest person instead', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await lead.goto(`/team?on=${week}`)
    const [a, b] = [tasks[1]!, tasks[2] ?? tasks[1]!]
    // Fill the maker's Sunday with one task, then drop a second on the same day.
    await drag(lead, a.id, maker, week)
    const first = lead.getByTestId('team-assign-confirm-apply').or(lead.getByTestId('team-move-warning-confirm'))
    await first.click()
    await expect.poll(async () => (await taskRow(a.id)).assignee_id, { timeout: 20_000 }).toBe(makerUser)
    // Book the maker's Sunday full through the Schedule's own dialog — a whole day of the job's last
    // task (ad-hoc work is switched off, I66.10) — so the drop below lands over their ceiling on any
    // database, a fresh one included (a 4h task alone never fills a day).
    // The filler is a task nobody holds yet — the dialog offers only those, and earlier tests here give some out.
    const [filler] = await rows<{ id: string; title: string }>('sub_tasks',
      `select=id,title&deliverable_id=eq.${job.deliverableId}&assignee_id=is.null&status=neq.cancelled&workflow_step_id=not.is.null&id=not.in.(${a.id},${b.id})&order=sort_order&limit=1`)
    expect(filler, 'an unassigned task to fill the day with').toBeTruthy()
    await lead.goto(`/schedule?on=${week}`)
    await expect(lead.getByTestId('schedule-grid')).toBeVisible()
    await lead.getByTestId(`cell-${maker}-${week}`).hover()
    await lead.getByTestId(`add-${maker}-${week}`).click()
    await expect(lead.getByTestId('booking-dialog')).toBeVisible()
    await lead.getByTestId('booking-project').selectOption({ label: job.title })
    await lead.getByTestId('booking-deliverable-select').selectOption({ index: 1 })
    await lead.getByTestId('booking-subtask-select').selectOption({ label: filler!.title })
    // The filler is the first unassigned task — a workflow step, which carries no reviewer until it is given out.
    await lead.getByTestId('booking-project-reviewer-add').selectOption({ label: PEOPLE.lead.name })
    await lead.getByTestId('booking-hours').fill('8')
    await lead.getByTestId('booking-confirmed').check()
    const submit = lead.getByTestId('booking-submit')
    await submit.click()
    // A day already holding work warns first ("Proceed anyway"); the second press books it.
    const booked = await Promise.race([
      lead.getByTestId('booking-dialog').waitFor({ state: 'detached', timeout: 20_000 }).then(() => true),
      submit.filter({ hasText: /Proceed anyway/ }).waitFor({ state: 'visible', timeout: 20_000 }).then(() => false),
    ])
    if (!booked) {
      await submit.click()
      await expect(lead.getByTestId('booking-dialog')).toHaveCount(0, { timeout: 20_000 })
    }
    await lead.goto(`/team?on=${week}`)
    await drag(lead, b.id === a.id ? tasks[0]!.id : b.id, maker, week)
    await expect(lead.getByTestId('team-move-warning-dialog')).toBeVisible()
    await lead.getByTestId('team-move-warning-instead').click()
    await expect.poll(async () => (await taskRow(b.id === a.id ? tasks[0]!.id : b.id)).assignee_id, { timeout: 20_000 }).not.toBe(makerUser)
    await lead.context().close()
  })

  test('a drop from Nobody yet onto the task\'s own reviewer opens the assignment dialog, pre-filled', async ({ browser }) => {
    // Its own task, added in beforeAll with the lead as reviewer and never moved by the tests above
    // (the workflow's own tasks carry no reviewer; the other three are assigned by L6/L7). Until
    // 25 Sep this read "the first unassigned task", which held only while L6 failed early.
    const unassigned = await rows<Task>('sub_tasks', `select=id,title,assignee_id,starts_at,due_at,committed_due_at&deliverable_id=eq.${job.deliverableId}&assignee_id=is.null&title=eq.${encodeURIComponent('Cov team waiting')}`)
    expect(unassigned.length, 'a task nobody has yet').toBe(1)
    // A maker never reviews their own work, so the drag cannot assign it to its reviewer: the
    // dialog opens instead, with the task chosen, for the reviewer to be changed.
    let waiting: Task | undefined
    let target: string | undefined
    for (const candidate of unassigned) {
      const reviewers = await rows<{ user_id: string }>('sub_task_reviewers', `select=user_id&sub_task_id=eq.${candidate.id}`)
      for (const r of reviewers) {
        const [res] = await rows<{ id: string }>('resources', `select=id&user_id=eq.${r.user_id}&is_active=eq.true`)
        if (res) { target = res.id; break }
      }
      if (target) { waiting = candidate; break }
    }
    expect(target, 'a task nobody has yet whose reviewer has a row on the view').toBeTruthy()
    const lead = await as(browser, 'lead')
    await lead.goto(`/team?on=${week}`)
    await expect(lead.getByTestId(`team-row-${target}`)).toBeVisible()
    await expect(lead.getByTestId(`tv-bar-${waiting!.id}`)).toBeVisible()
    await drag(lead, waiting!.id, target!, week)
    await expect(lead.getByTestId('booking-dialog')).toBeVisible()
    await expect(lead.getByTestId('team-assign-confirm')).toHaveCount(0)
    await expect(lead.getByTestId('booking-subtask-select')).toHaveValue(waiting!.id)
    await expect(lead.getByTestId('booking-date')).toHaveValue(week)
    await lead.getByTestId('booking-cancel').click()
    await expect(lead.getByTestId('booking-dialog')).toHaveCount(0)
    expect((await taskRow(waiting!.id)).assignee_id, 'Cancel assigns nothing').toBeNull()
    await lead.context().close()
  })

  test('By person opens the Schedule on the person; By piece\'s Move and Assign open it filtered', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await lead.goto(`/team?on=${week}&tab=person`)
    await lead.getByTestId(`team-person-open-${maker}`).click()
    await expect(lead).toHaveURL(/\/schedule\?who=/)
    await expect(lead.getByTestId('schedule-grid')).toBeVisible()

    await lead.goto(`/team?on=${week}&tab=piece`)
    // By piece lists the job's tasks: the one the drags assigned has Move, the rest have Assign.
    const moved = tasks[0]!.id
    await lead.getByTestId(`team-piece-move-${moved}`).click()
    await expect(lead).toHaveURL(/\/schedule\?view=project&campaign=/)
    await expect(lead.getByTestId('schedule-grid')).toBeVisible()
    await lead.goto(`/team?on=${week}&tab=piece`)
    const waiting = (await rows<Task>('sub_tasks', `select=id,title,assignee_id,starts_at,due_at,committed_due_at&deliverable_id=eq.${job.deliverableId}&assignee_id=is.null`))[0]
    expect(waiting, 'a task nobody has yet').toBeTruthy()
    // E2: "For" is real time in the current state — the task list was approved minutes ago, the
    // moved task was assigned minutes ago.
    await expect(lead.getByRole('columnheader', { name: 'For' })).toBeVisible()
    await expect(lead.getByTestId(`team-piece-for-${waiting!.id}`)).toHaveText(/^(under 1h|\d+h)$/)
    await expect(lead.getByTestId(`team-piece-for-${moved}`)).toHaveText(/^Assigned · (under 1h|\d+h)$/)
    await lead.getByTestId(`team-piece-assign-${waiting!.id}`).click()
    await expect(lead).toHaveURL(/\/schedule\?dept=/)
    await lead.context().close()
  })

  test('the workstream filter fades every other workstream', async ({ browser }) => {
    // A piece joins a group through the product (ADR-0099), then shows on the timeline in that group's
    // colour and under the filter. On the seeded CAMPAIGN, not this file's single job: a single job
    // has no workstream (ADR-0099 d.11), and its page offers none. The seeded Key visual's Creative
    // tasks have nobody and no dates, so they sit on "Nobody yet" in any week — once its task list is
    // approved (I59.59: work with nobody on it shows only when it can be handed out), which its owner does
    // here. Put back after: the list unapproved, the piece in its seeded workstream (never out of all of
    // them, ADR-0116 d.3) — other suites read Northwind as the seed made it.
    const am = await as(browser, 'am')
    const group = `TV walk ${Date.now()}`
    const [creative] = await rows<{ id: string }>('departments', 'select=id&name=eq.Creative')
    const [northwind] = await rows<{ id: string }>('campaigns', `select=id&name=eq.${encodeURIComponent('Northwind Summer Launch')}`)
    const [kv] = await rows<{ id: string }>('deliverables', `select=id,streams!inner(campaign_id)&streams.campaign_id=eq.${northwind!.id}&name=eq.${encodeURIComponent('Key visual - summer range')}`)
    const kvTasks = await rows<{ id: string }>('sub_tasks', `select=id&deliverable_id=eq.${kv!.id}&assignee_id=is.null&status=not.in.("done","cancelled")&order=sort_order.asc`)
    expect(kvTasks.length, 'the seeded Key visual has work nobody has yet').toBeGreaterThan(0)
    const [kvBefore] = await rows<{ workstream_id: string; tasks_approved_at: string | null }>('deliverables', `select=workstream_id,tasks_approved_at&id=eq.${kv!.id}`)
    if (!kvBefore!.tasks_approved_at) {
      const owner = await as(browser, 'tl')
      // A campaign piece's list is approved on the campaign page (ADR-0100), not on /deliverables.
      await owner.goto(`/campaigns/${northwind!.id}`)
      await owner.getByTestId('campaign-tab-grid').click()
      await owner.getByTestId(`campaign-task-lists-approve-${kv!.id}`).click()
      await expect(owner.getByTestId(`campaign-task-lists-accepted-${kv!.id}`)).toBeVisible()
      await owner.context().close()
    }
    await am.goto(`/campaigns/${northwind!.id}`)
    await am.getByTestId('campaign-tab-grid').click()
    await am.getByTestId('campaign-workstreams-add').click()
    await am.getByTestId('campaign-workstreams-name').fill(group)
    await am.getByTestId('campaign-workstreams-department').selectOption(creative!.id)
    await am.getByTestId('campaign-workstreams-save').click()
    let ws: { id: string } | undefined
    await expect.poll(async () => (ws = (await rows<{ id: string }>('workstreams', `select=id&campaign_id=eq.${northwind!.id}&name=eq.${encodeURIComponent(group)}`))[0])?.id).toBeTruthy()
    await am.getByTestId(`campaign-workstreams-move-${kv!.id}`).selectOption(ws!.id)
    await expect.poll(async () => (await rows<{ workstream_id: string | null }>('deliverables', `select=workstream_id&id=eq.${kv!.id}`))[0]?.workstream_id).toBe(ws!.id)

    const lead = await as(browser, 'lead')
    await lead.goto(`/team?on=${week}`)
    // The bars are coloured by status since I67.3 (the key lists statuses, not workstreams); the filter offers the group.
    await expect(lead.getByTestId('team-workstream-filter').locator(`option[value="${ws!.id}"]`)).toHaveCount(1)
    await lead.getByTestId('team-workstream-filter').selectOption(ws!.id)
    await expect(lead.getByTestId(`tv-bar-${kvTasks[0]!.id}`)).not.toHaveClass(/tv-bar-faded/)
    // …and this file's work, in no workstream, is faded.
    await expect(lead.getByTestId(`tv-bar-${tasks[0]!.id}`)).toHaveClass(/tv-bar-faded/)
    await lead.getByTestId('team-workstream-filter').selectOption('')
    await expect(lead.getByTestId(`tv-bar-${tasks[0]!.id}`)).not.toHaveClass(/tv-bar-faded/)
    await lead.context().close()

    // Put Northwind back as it was: the piece in its own workstream again, the group removed, the list as it was.
    await am.getByTestId(`campaign-workstreams-move-${kv!.id}`).selectOption(kvBefore!.workstream_id)
    await expect.poll(async () => (await rows<{ workstream_id: string | null }>('deliverables', `select=workstream_id&id=eq.${kv!.id}`))[0]?.workstream_id).toBe(kvBefore!.workstream_id)
    await am.getByTestId(`campaign-workstreams-remove-${ws!.id}`).click()
    await am.getByTestId('campaign-workstreams-confirm-remove-confirm').click()
    await expect.poll(async () => (await rows('workstreams', `select=id&id=eq.${ws!.id}`)).length).toBe(0)
    await am.context().close()
    if (!kvBefore!.tasks_approved_at) {
      const back = await attemptWrite('PATCH', 'deliverables', `id=eq.${kv!.id}`, { tasks_approved_at: null, tasks_approved_by: null })
      expect(back.status, back.text).toBeLessThan(300)
    }
  })

  test('a role with no department of its own picks one', async ({ browser }) => {
    const admin = await as(browser, 'admin')
    await admin.goto('/team')
    const picker = admin.getByTestId('team-department-picker')
    await expect(picker).toBeVisible()
    const [content] = await rows<{ id: string }>('departments', 'select=id&name=eq.Content')
    await picker.selectOption(content!.id)
    await expect(admin.getByTestId('team-title')).toContainText('Content')
    await expect(admin.getByTestId(`team-row-${await resourceIdOf(PEOPLE.writer.name)}`)).toBeVisible()
    await expect(admin.getByTestId(`team-row-${maker}`)).toHaveCount(0)
    await admin.context().close()
  })
})
