import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows, userIdOf } from '../helpers/db'
import { releaseSingleJob } from '../helpers/single-job'

/**
 * Coverage — I61.12: the Team Member dashboard's "My deliverables" (ADR-0122, Figma H DB-M) — the Today /
 * Tomorrow / This week tabs and a row, which opens the task's own page.
 *
 * The fixture is made through the product. The account manager releases a single job; its owner (the
 * Creative lead) approves the task list, and Traffic gives three of its generated tasks to the planner from
 * the Schedule (the one door that assigns, ADR-0060), each booked on one
 * day — today, tomorrow and the first Baghdad working day from the day after tomorrow on. A one-day booking
 * lands on the day picked, and that day is the task's committed due date (I41.2), which the list
 * buckets by. A day the office does not work, or one with a closure or leave on it, warns first
 * (warn-and-allow, ADR-0061 d.2): whether it must is worked out from the database BEFORE the press, so the
 * test expects one outcome and fails on the other. The piece is closed at the end, which calls off its
 * bookings, so a later run finds the planner's days as this one did.
 *
 * "This week" is read with the week chip on NEXT week, so the third task is inside it whatever weekday the
 * run falls on (a Thursday's current week has no working day after tomorrow).
 *
 * Who may: `planner` (a team member with no lead — the Team Member view; no other spec books the planner).
 * Who may not: `lead`, whose dashboard is the department view and carries no "My deliverables". People are
 * picked by id, never by a typed name (the demo scripts rename them).
 */
test.use({ actionTimeout: 15_000 })

async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}

/** A Baghdad calendar day, `offset` days from today (the suite runs in Asia/Baghdad). */
function baghdadDay(offset: number): string {
  return new Date(Date.now() + 3 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10)
}
/** ISO weekday, 1 = Monday … 7 = Sunday — the numbering `offices.working_days` uses. */
const isoWeekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay() || 7
const iraqDayOf = (iso: string) => new Date(Date.parse(iso) + 3 * 3_600_000).toISOString().slice(0, 10)

test.describe('Coverage — the Team Member dashboard’s My deliverables (I61.12, ADR-0122)', () => {
  test('Today, Tomorrow and This week each list their own task; a row opens the task; a lead’s dashboard has no such list', async ({ browser }) => {
    test.setTimeout(240_000)
    const stamp = Date.now()

    const planner = await userIdOf(PEOPLE.planner.email)
    const [resource] = await rows<{ id: string; office_id: string; warn_at_pct: number }>('resources', `select=id,office_id,warn_at_pct&user_id=eq.${planner}&is_active=eq.true`)
    expect(resource, 'the planner is a bookable resource').toBeTruthy()
    const [office] = await rows<{ working_days: number[] }>('offices', `select=working_days&id=eq.${resource!.office_id}`)
    const works = (day: string) => office!.working_days.includes(isoWeekday(day))
    /** Whether a booking on `day` is warned about first: a day off, an office closure, the planner's leave. */
    async function warnsOn(day: string): Promise<boolean> {
      if (!works(day)) return true
      const closures = await rows('office_closures', `select=id&office_id=eq.${resource!.office_id}&starts_on=lte.${day}&ends_on=gte.${day}`)
      const leave = await rows('resource_unavailability', `select=id&resource_id=eq.${resource!.id}&starts_at=lt.${day}T23:59:59%2B03:00&ends_at=gt.${day}T00:00:00%2B03:00`)
      // Load: what is already confirmed on that day, plus this hour, past the warning line (load-based, ADR-0061).
      const booked = await rows<{ load_pct: number | null }>('bookings', `select=load_pct&resource_id=eq.${resource!.id}&state=eq.confirmed&starts_at=lt.${day}T23:59:59%2B03:00&ends_at=gt.${day}T00:00:00%2B03:00`)
      const load = booked.reduce((sum, b) => sum + (b.load_pct ?? 0), 0) + 12.5
      return closures.length > 0 || leave.length > 0 || load > resource!.warn_at_pct
    }

    let later = 2
    while (!works(baghdadDay(later))) later++
    const days = { today: baghdadDay(0), tomorrow: baghdadDay(1), week: baghdadDay(later) } as const

    const am = await as(browser, 'am')
    const job = await releaseSingleJob(am, { title: `Cov dashboard ${stamp}`, department: 'Creative', type: 'Social Advertisement' })
    await am.context().close()

    // Its owner, the Creative lead, approves the task list on the campaign page — the second gate
    // (ADR-0100): only then can its work be handed out.
    const owner = await as(browser, 'lead')
    await owner.goto(`/campaigns/${job.campaignId}`)
    await owner.getByTestId(`campaign-task-lists-approve-${job.deliverableId}`).click()
    await expect(owner.getByTestId(`campaign-task-lists-accepted-${job.deliverableId}`)).toBeVisible()
    await expect.poll(async () => (await rows<{ tasks_approved_at: string | null }>('deliverables', `select=tasks_approved_at&id=eq.${job.deliverableId}`))[0]!.tasks_approved_at).not.toBeNull()
    await owner.context().close()

    // The generated list: three of its tasks are given out, one per day.
    const generated = await rows<{ id: string; title: string }>('sub_tasks', `select=id,title&deliverable_id=eq.${job.deliverableId}&assignee_id=is.null&status=neq.cancelled&order=sort_order.asc`)
    expect(generated.length, 'the type’s workflow gives the piece at least three tasks').toBeGreaterThanOrEqual(3)
    const tasks = [
      { key: 'today', ...generated[0]!, day: days.today },
      { key: 'tomorrow', ...generated[1]!, day: days.tomorrow },
      { key: 'week', ...generated[2]!, day: days.week },
    ] as const

    // Traffic books each on the planner, on its day.
    const traffic = await as(browser, 'traffic')
    for (const t of tasks) {
      const warn = await warnsOn(t.day)
      await traffic.goto(`/schedule?on=${t.day}`)
      await expect(traffic.getByTestId('schedule-grid')).toBeVisible()
      await traffic.getByTestId(`cell-${resource!.id}-${t.day}`).hover()
      await traffic.getByTestId(`add-${resource!.id}-${t.day}`).click()
      const dialog = traffic.getByTestId('booking-dialog')
      await expect(dialog).toBeVisible()
      await traffic.getByTestId('booking-project').selectOption(job.campaignId)
      await traffic.getByTestId('booking-deliverable-select').selectOption(job.deliverableId)
      await traffic.getByTestId('booking-subtask-select').selectOption(t.id)
      await traffic.getByTestId('booking-project-reviewer-add').selectOption({ index: 1 })
      await expect(traffic.getByTestId('booking-date')).toHaveValue(t.day)
      await traffic.getByTestId('booking-hours').fill('1')
      await traffic.getByTestId('booking-submit').click()
      if (warn) {
        // A day off (or closed) is booked when asked twice — warn-and-allow.
        await expect(traffic.getByTestId('booking-submit')).toHaveText(/Proceed anyway/)
        await traffic.getByTestId('booking-submit').click()
      }
      await expect(dialog).toHaveCount(0, { timeout: 20_000 })
    }
    await traffic.context().close()

    const made = await rows<{ id: string; assignee_id: string | null; committed_due_at: string | null }>(
      'sub_tasks', `select=id,assignee_id,committed_due_at&deliverable_id=eq.${job.deliverableId}`,
    )
    for (const t of tasks) {
      const row = made.find((r) => r.id === t.id)!
      expect(row.assignee_id, `${t.key} is the planner's`).toBe(planner)
      expect(row.committed_due_at && iraqDayOf(row.committed_due_at), `${t.key} is due on its booked day`).toBe(t.day)
    }
    const [today, tomorrow, week] = tasks.map((t) => t.id) as [string, string, string]

    // The lead may not: the department view carries no "My deliverables" and none of its tabs.
    const lead = await as(browser, 'lead')
    await lead.goto('/dashboard')
    await expect(lead.getByTestId('surface-role-dashboard')).toHaveAttribute('data-view', 'department')
    await expect(lead.getByTestId('db-panel-my-deliverables')).toHaveCount(0)
    await expect(lead.getByTestId('db-tab-today')).toHaveCount(0)
    await lead.context().close()

    // The planner may: each tab lists its own day's task and not the others'.
    const page = await as(browser, 'planner')
    await page.goto('/dashboard')
    await expect(page.getByTestId('surface-role-dashboard')).toHaveAttribute('data-view', 'member')
    const panel = page.getByTestId('db-panel-my-deliverables')
    await expect(panel).toBeVisible()

    await page.getByTestId('db-tab-tomorrow').click()
    await expect(page.getByTestId('db-tab-tomorrow')).toHaveAttribute('aria-selected', 'true')
    await expect(panel.getByTestId(`db-mine-${tomorrow}`)).toContainText(tasks[1].title)
    await expect(panel.getByTestId(`db-mine-${today}`)).toHaveCount(0)
    await expect(panel.getByTestId(`db-mine-${week}`)).toHaveCount(0)

    await page.getByTestId('db-tab-today').click()
    await expect(page.getByTestId('db-tab-today')).toHaveAttribute('aria-selected', 'true')
    await expect(panel.getByTestId(`db-mine-${today}`)).toContainText(tasks[0].title)
    await expect(panel.getByTestId(`db-mine-${tomorrow}`)).toHaveCount(0)
    await expect(panel.getByTestId(`db-mine-${week}`)).toHaveCount(0)

    // This week, on next week's chip: the third task, not today's or tomorrow's.
    await page.getByTestId('db-week-choice').selectOption('1')
    await page.getByTestId('db-tab-week').click()
    await expect(page.getByTestId('db-tab-week')).toHaveAttribute('aria-selected', 'true')
    await expect(panel.getByTestId(`db-mine-${week}`)).toContainText(tasks[2].title)
    await expect(panel.getByTestId(`db-mine-${today}`)).toHaveCount(0)
    await expect(panel.getByTestId(`db-mine-${tomorrow}`)).toHaveCount(0)

    // A row opens the task's own page.
    await panel.getByTestId(`db-mine-${week}`).click()
    await expect(page).toHaveURL(new RegExp(`/my-work/task/${week}$`))
    await expect(page.getByTestId('task-page-title')).toContainText(tasks[2].title)
    await page.context().close()

    // Put back: the account manager closes the piece, which calls off its work — the planner's bookings
    // end, so the next run finds the planner's days as empty as this one did.
    const am2 = await as(browser, 'am')
    await am2.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
    await am2.getByTestId('piece-panel-close-piece').click()
    await expect(am2.getByTestId('piece-panel-close-confirm-dialog')).toBeVisible()
    await am2.getByTestId('piece-panel-close-confirm-confirm').click()
    await expect.poll(async () => (await rows<{ state: string }>('deliverables', `select=state&id=eq.${job.deliverableId}`))[0]!.state).toBe('archived')
    await expect.poll(async () => (await rows('bookings', `select=id&sub_task_id=in.(${today},${tomorrow},${week})&state=in.(soft_hold,tentative,confirmed)`)).length).toBe(0)
    await am2.context().close()
  })
})
