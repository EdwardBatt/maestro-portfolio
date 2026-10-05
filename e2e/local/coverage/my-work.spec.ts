import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows } from '../helpers/db'
import { releaseSingleJob, type ReleasedJob } from '../helpers/single-job'
import { addTaskOnPanel, approveTaskList, assignOnSchedule, workingDayFor } from '../helpers/piece'

/**
 * Coverage — My Work, restyled (ADR-0105 d.1–d.2, I59.10, Figma M1 / NY-*): Needs you and its new
 * sources, the five lists, the task card's chips and Open, Completed folded, and the side menu.
 *
 * Every new control is pressed by one person who may, and its absence asserted for one who may not
 * (ADR-0095): the owner is offered Assign, a team member is not; the maker is told what is new on
 * them and what came back, the owner is not; opening a task, or Later, marks it seen on the server
 * (I59, `sub_tasks.assignee_seen_at`) — gone from New on you on every device.
 *
 * The DEPUTY does the maker's part (the long-lived local database has given the maker ~250 live
 * tasks — review-and-my-work.spec.ts says why).
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}
type Task = { id: string; title: string; status: string }
const tasksOf = (d: string) => rows<Task>('sub_tasks', `select=id,title,status&deliverable_id=eq.${d}&order=sort_order.asc`)

let job: ReleasedJob

/** Today on the Baghdad calendar the suite runs in (`timezoneId` in playwright.local.config.ts). */
function baghdadToday(): string {
  return new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10)
}

// One job, built once, and the tests build on each other's tasks (the side-menu test opens a task the
// deputy was given above). Serial, so a failure stops the run here instead of re-running beforeAll on
// a new worker and handing the later tests a fresh job with nobody on it.
test.describe.configure({ mode: 'serial' })

test.describe('Coverage — My Work (I59.10)', () => {
  test.beforeAll(async ({ browser }) => {
    const am = await as(browser, 'am')
    job = await releaseSingleJob(am, { title: `Cov my work ${Date.now()}`, department: 'Creative', type: 'Social Advertisement' })
    await am.context().close()
    // The owner (the Creative lead) approves the generated task list on the piece's panel (ADR-0132; I71.1) —
    // nobody is on any task yet.
    const lead = await as(browser, 'lead')
    await approveTaskList(lead, job)
    await lead.context().close()
  })

  test('Assign: the owner is asked to assign the tasks nobody has, and it opens the Schedule filtered; a team member is not asked', async ({ browser }) => {
    const [piece] = await rows<{ department_id: string; streams: { campaign_id: string } }>('deliverables', `select=department_id,streams(campaign_id)&id=eq.${job.deliverableId}`)
    const unassigned = (await rows<{ id: string }>('sub_tasks', `select=id&deliverable_id=eq.${job.deliverableId}&assignee_id=is.null&status=neq.cancelled`)).length
    expect(unassigned, 'the generated task list leaves every task unassigned').toBeGreaterThan(0)

    const lead = await as(browser, 'lead')
    await lead.goto('/my-work')
    await expect(lead.getByTestId('needs-you-panel')).toBeVisible()
    const card = lead.getByTestId(`needs-you-assign-${job.deliverableId}`)
    await expect(card).toBeVisible()
    await expect(lead.getByTestId(`needs-you-kind-${job.deliverableId}`)).toHaveText('Assign')
    await expect(lead.getByTestId(`needs-you-assign-count-${job.deliverableId}`)).toContainText(String(unassigned))
    await lead.getByTestId(`needs-you-open-assign-${job.deliverableId}`).click()
    await expect(lead).toHaveURL(new RegExp(`/schedule\\?campaign=${piece.streams.campaign_id}&dept=${piece.department_id}`))
    await lead.context().close()

    // A team member owns nothing, so is never asked to assign it (ADR-0105 d.2: the owner's list only).
    const maker = await as(browser, 'deputy')
    await maker.goto('/my-work')
    await expect(maker.getByTestId('surface-my-work')).toBeVisible()
    await expect(maker.getByTestId(`needs-you-assign-${job.deliverableId}`)).toHaveCount(0)
    await maker.context().close()
  })

  test('New on you: the maker is told, Open goes to the task page (and marks it seen), Later marks it seen on the server; the chips open the brief and the Library folder', async ({ browser }) => {
    // The owner gives two tasks to the deputy — the product's own doors since ADR-0132: the piece's panel adds
    // each by name and due date, the Schedule gives it to the person with its hours and reviewer (I71.1).
    // One to Open, one to put off with Later (opening a task marks it seen, I59).
    const lead = await as(browser, 'lead')
    const title = `Cov new on you ${Date.now()}`
    const laterTitle = `${title} (later)`
    for (const [i, t] of [title, laterTitle].entries()) {
      const on = await workingDayFor(PEOPLE.deputy.email, 3 + i * 3)
      const taskId = await addTaskOnPanel(lead, job, t, on)
      // E11 (I59): assigned only with its hours.
      await assignOnSchedule(lead, job, { taskId, assignee: PEOPLE.deputy.email, reviewer: PEOPLE.lead.email, day: on, hours: 4 })
    }
    await lead.context().close()
    const task = (await tasksOf(job.deliverableId)).find((t) => t.title === title)!
    const laterTask = (await tasksOf(job.deliverableId)).find((t) => t.title === laterTitle)!
    expect(task).toBeTruthy()
    expect(laterTask).toBeTruthy()
    const seenAt = async (id: string) => (await rows<{ assignee_seen_at: string | null }>('sub_tasks', `select=assignee_seen_at&id=eq.${id}`))[0]?.assignee_seen_at ?? null
    expect(await seenAt(task.id), 'a task just given is unseen').toBeNull()

    const maker = await as(browser, 'deputy')
    await maker.goto('/my-work')
    const item = maker.getByTestId(`needs-you-new_on_you-${task.id}`)
    await expect(item).toBeVisible()
    await expect(maker.getByTestId(`needs-you-kind-${task.id}`)).toHaveText('New on you')
    // The card is in its list too, with Open to the task's page.
    await expect(maker.getByTestId(`my-work-item-${task.id}`)).toBeVisible()
    await expect(maker.getByTestId(`my-work-open-${task.id}`)).toHaveAttribute('href', `/my-work/task/${task.id}`)

    // Open, from Needs you.
    await maker.getByTestId(`needs-you-open-new_on_you-${task.id}`).click()
    await expect(maker).toHaveURL(new RegExp(`/my-work/task/${task.id}$`))
    await expect(maker.getByTestId('task-page-title')).toContainText(title)
    // Opening it is seeing it — on the server, so it has left New on you everywhere.
    await expect.poll(() => seenAt(task.id)).not.toBeNull()
    await maker.getByTestId('task-page-back').click()
    await expect(maker.getByTestId(`needs-you-new_on_you-${task.id}`)).toHaveCount(0)

    // The chips: the brief opens its part of the task page; the folder opens the Library on it.
    await maker.getByTestId(`my-work-chip-brief-${task.id}`).click()
    await expect(maker).toHaveURL(new RegExp(`/my-work/task/${task.id}#task-brief$`))
    await expect(maker.getByTestId('task-page-brief')).toBeVisible()
    await maker.goto('/my-work')
    const folderChip = maker.getByTestId(`my-work-chip-folder-${task.id}`)
    await expect(folderChip).toBeVisible()
    await folderChip.click()
    await expect(maker).toHaveURL(/\/library\?client=.+&folder=.+/)
    await expect(maker.getByTestId('surface-library')).toBeVisible()
    await expect(maker.locator('.lb-crumbs')).toBeVisible()

    // No Later button (Edward, 26 Sep). Opening the task marks it seen on the server — so the card
    // is gone on another device too (a fresh browser context stands in for the phone).
    await maker.goto('/my-work')
    await expect(maker.getByTestId(`needs-you-new_on_you-${laterTask.id}`)).toBeVisible()
    await expect(maker.getByTestId(`needs-you-later-${laterTask.id}`)).toHaveCount(0)
    await maker.goto(`/my-work/task/${laterTask.id}`)
    await expect(maker.getByTestId('task-page')).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => seenAt(laterTask.id), { timeout: 15_000 }).not.toBeNull()
    await maker.goto('/my-work')
    await expect(maker.getByTestId(`needs-you-new_on_you-${laterTask.id}`)).toHaveCount(0)
    await expect.poll(() => seenAt(laterTask.id)).not.toBeNull()
    await maker.context().close()
    const phone = await as(browser, 'deputy')
    await phone.goto('/my-work')
    await expect(phone.getByTestId(`my-work-item-${laterTask.id}`)).toBeVisible()
    await expect(phone.getByTestId(`needs-you-new_on_you-${laterTask.id}`)).toHaveCount(0)
    await phone.context().close()

    // Somebody else's work is never "new on" the owner.
    const owner = await as(browser, 'lead')
    await owner.goto('/my-work')
    await expect(owner.getByTestId('surface-my-work')).toBeVisible()
    await expect(owner.getByTestId(`needs-you-new_on_you-${task.id}`)).toHaveCount(0)
    await owner.context().close()
  })

  test('the lists: a task in review waits on someone else; approved, it is in Completed, folded shut and opened by its toggle', async ({ browser }) => {
    // A manual task on the deputy, done and approved through the product.
    // Added on the piece's panel, given out on the Schedule (ADR-0132; I71.1).
    const lead = await as(browser, 'lead')
    const title = `Cov completed ${Date.now()}`
    const on = await workingDayFor(PEOPLE.deputy.email, 7)
    const manualId = await addTaskOnPanel(lead, job, title, on)
    // E11 (I59): assigned only with its hours.
    await assignOnSchedule(lead, job, { taskId: manualId, assignee: PEOPLE.deputy.email, reviewer: PEOPLE.lead.email, day: on, hours: 4, reviewMode: 'manual' })
    // And one due TODAY, so Today has something to show — it shows only when it does (I59 Track 6). Booked on today,
    // so today is its committed due day (I41.2).
    const todayTitle = `Cov due today ${Date.now()}`
    const todayId = await addTaskOnPanel(lead, job, todayTitle, baghdadToday())
    await assignOnSchedule(lead, job, { taskId: todayId, assignee: PEOPLE.deputy.email, reviewer: PEOPLE.lead.email, day: baghdadToday(), hours: 2 })
    await lead.context().close()
    const task = (await tasksOf(job.deliverableId)).find((t) => t.title === title)!
    const todayTask = (await tasksOf(job.deliverableId)).find((t) => t.title === todayTitle)!
    expect(todayTask, 'the task due today was created').toBeTruthy()

    const maker = await as(browser, 'deputy')
    await maker.goto(`/my-work/task/${task.id}`)
    await maker.getByTestId(`my-work-start-${task.id}`).click()
    await maker.getByTestId(`task-comment-body-${task.id}`).fill('Done on the call.')
    await maker.getByTestId(`task-comment-submit-${task.id}`).click()
    await maker.getByTestId(`my-work-submit-${task.id}`).click()
    // ADR-0106 (I59.20): a round sent minutes after Start is untimed — the warning, then Send anyway.
    await maker.getByTestId('untimed-send').click()
    await expect(maker.getByTestId('task-page-status')).toHaveAttribute('data-status', 'review')
    await maker.goto('/my-work')
    // With somebody else: the list names who holds it.
    await expect(maker.getByTestId('waiting-tasks-panel').getByTestId(`my-work-item-${task.id}`)).toBeVisible()
    await expect(maker.getByTestId(`my-work-waiting-on-${task.id}`)).toContainText(PEOPLE.lead.name)
    await expect(maker.getByTestId('today-tasks-panel').getByTestId(`my-work-item-${todayTask.id}`)).toBeVisible()
    // The task in review is NOT today's: it is with somebody else.
    await expect(maker.getByTestId('today-tasks-panel').getByTestId(`my-work-item-${task.id}`)).toHaveCount(0)
    await expect(maker.getByTestId('exceptions-panel')).toBeVisible()
    await expect(maker.getByTestId('attendance-widget')).toBeVisible()
    await expect(maker.getByTestId('news-feed')).toBeVisible()
    await expect(maker.getByTestId('my-work-greeting')).toBeVisible()
    await maker.context().close()

    const reviewer = await as(browser, 'lead')
    await reviewer.goto('/my-work')
    await reviewer.getByTestId(`awaiting-review-open-${task.id}`).click()
    await reviewer.getByTestId(`awaiting-review-approve-${task.id}`).click()
    await expect.poll(async () => (await rows<{ status: string }>('sub_tasks', `select=status&id=eq.${task.id}`))[0].status).toBe('done')
    await reviewer.context().close()

    const maker2 = await as(browser, 'deputy')
    await maker2.goto('/my-work')
    const completed = maker2.getByTestId('completed-tasks-panel')
    await expect(completed).toBeVisible()
    await expect(completed.getByTestId(`my-work-item-${task.id}`)).toBeHidden() // folded shut
    await maker2.getByTestId('completed-tasks-toggle').click()
    await expect(completed.getByTestId(`my-work-item-${task.id}`)).toBeVisible()
    await maker2.context().close()
  })

  test('the side menu keeps every item, marks My Work current on a task page, and names the person at the foot', async ({ browser }) => {
    const maker = await as(browser, 'deputy')
    const [task] = await rows<{ id: string }>('sub_tasks', `select=id&deliverable_id=eq.${job.deliverableId}&assignee_id=not.is.null&limit=1`)
    await maker.goto(`/my-work/task/${task.id}`)
    await expect(maker.getByTestId('nav-my-work')).toHaveClass(/active/)
    await expect(maker.getByTestId('user-menu')).toContainText(PEOPLE.deputy.name)
    await maker.getByTestId('nav-my-work').click()
    await expect(maker.getByTestId('surface-my-work')).toBeVisible()
    await maker.context().close()
  })
})
