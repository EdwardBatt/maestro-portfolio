import { expect, type Page } from '@playwright/test'
import { rows, userIdOf } from './db'

/**
 * A campaign piece's work, done where it is done since ADR-0132 (30 Sep): the campaign page's piece panel
 * (`/campaigns/<id>?piece=<id>`) approves the task list and adds a task by its name and due date, unassigned;
 * assigning stays on the Schedule (d.2 — the booking dialog asks for the person, the reviewer, the review mode
 * and the hours). `/deliverables?open=<id>` forwards a campaign piece there (d.8), so the old window's
 * `task-list-approve` / `subtask-add-open` are not on the page any more (I71.1).
 *
 * People are picked by id, never by a typed name (the demo scripts rename them).
 */

export interface PieceRef { campaignId: string; deliverableId: string }

/** A write on the campaign page answers with a notice in front of the page; it must be a SUCCESS, and closed. */
export async function closeCampaignBanner(page: Page): Promise<void> {
  const dialog = page.getByTestId('campaign-banner-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).not.toContainText(/outside your reach|could not|did not work|refused/i)
  await page.getByTestId('campaign-banner-close').click()
  await expect(dialog).toHaveCount(0)
}

/** The owner approves the piece's task list on its panel (ADR-0140: `piece-panel-tasks-approve`); the database must say so. */
export async function approveTaskList(page: Page, job: PieceRef): Promise<void> {
  await page.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
  await expect(page.getByTestId('piece-panel')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('piece-panel-tasks-approve').click()
  await closeCampaignBanner(page)
  // Approved, the list's foot offers the Schedule instead of the approval.
  await expect(page.getByTestId('piece-panel-tasks-open-schedule')).toBeVisible()
  await expect(page.getByTestId('piece-panel-tasks-approve')).toHaveCount(0)
  await expect
    .poll(async () => (await rows<{ tasks_approved_at: string | null }>('deliverables', `select=tasks_approved_at&id=eq.${job.deliverableId}`))[0]!.tasks_approved_at)
    .not.toBeNull()
}

/**
 * A task added on the panel by its name (ADR-0140: `piece-panel-tasks-add` → name → Add), unassigned; its due day
 * is then set through `save_sub_task` as the signed-in person — the door the task editor's Save uses for an
 * unheld task's days — since the panel's add line takes a name only. Returns the task's id.
 */
export async function addTaskOnPanel(page: Page, job: PieceRef, title: string, dueDay: string): Promise<string> {
  if (!/\/campaigns\/[0-9a-f-]{36}\?.*piece=/.test(page.url()) || !page.url().includes(job.deliverableId)) {
    await page.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
  }
  await expect(page.getByTestId('piece-panel')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('piece-panel-tasks-add').click()
  await page.getByTestId('piece-panel-tasks-add-name').fill(title)
  await page.getByTestId('piece-panel-tasks-add-save').click()
  await expect
    .poll(async () => (await rows<{ id: string }>('sub_tasks', `select=id&deliverable_id=eq.${job.deliverableId}&title=eq.${encodeURIComponent(title)}`)).length, { timeout: 15_000 })
    .toBe(1)
  const [task] = await rows<{ id: string; assignee_id: string | null }>('sub_tasks', `select=id,assignee_id&deliverable_id=eq.${job.deliverableId}&title=eq.${encodeURIComponent(title)}`)
  expect(task!.assignee_id, `${title} is added unassigned`).toBeNull()
  // The due day, as the person on the page (their saved session's token).
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('sb-127-auth-token')
    return raw ? (JSON.parse(raw) as { access_token: string }).access_token : null
  })
  expect(token, 'the page is signed in').toBeTruthy()
  const res = await fetch('http://127.0.0.1:54321/rest/v1/rpc/save_sub_task', {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      p_sub_task: task!.id, p_deliverable: job.deliverableId, p_title: title, p_reviewers: null, p_description: null,
      p_sla_hours: null, p_starts_at: `${dueDay}T06:00:00.000Z`, p_due_at: `${dueDay}T15:00:00.000Z`, p_review_mode: null,
    }),
  })
  expect(res.status, `save_sub_task: ${await res.text()}`).toBeLessThan(300)
  await expect(page.getByTestId(`piece-panel-tasks-row-${task!.id}`)).toBeVisible()
  return task!.id
}

const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

/** ISO weekday, 1 = Monday … 7 = Sunday — the numbering `offices.working_days` uses. */
const isoWeekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay() || 7

/** A Baghdad calendar day, `offset` days from today (the suite runs in Asia/Baghdad). */
export function baghdadDay(offset: number): string {
  return new Date(Date.now() + 3 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10)
}

/** The first day on or after `offset` days out that the person's office works. */
export async function workingDayFor(email: string, offset: number): Promise<string> {
  const { office } = await resourceOf(email)
  let n = offset
  while (!office.working_days.includes(isoWeekday(baghdadDay(n)))) n++
  return baghdadDay(n)
}

async function resourceOf(email: string) {
  const uid = await userIdOf(email)
  const [resource] = await rows<{ id: string; office_id: string; warn_at_pct: number }>('resources', `select=id,office_id,warn_at_pct&user_id=eq.${uid}&is_active=eq.true`)
  expect(resource, `${email} is a bookable resource`).toBeTruthy()
  const [office] = await rows<{ working_days: number[] }>('offices', `select=working_days&id=eq.${resource!.office_id}`)
  return { uid, resource: resource!, office: office! }
}

export interface Assignment {
  taskId: string
  /** The person given the task (a seeded address). */
  assignee: string
  /** The reviewer appointed (a seeded address). */
  reviewer: string
  day: string
  hours: number
  reviewMode?: 'digital' | 'manual'
}

/**
 * Give a waiting task to a person from the Schedule's `+` on their day (ADR-0060, the one door that assigns),
 * with a reviewer, the hours and — when asked — the review mode. A day the office does not work, a closure, the
 * person's leave or a day already loaded past their warning line is warned about first (warn-and-allow,
 * ADR-0061 d.2): whether it must be is worked out from the database BEFORE the press, so the helper expects one
 * outcome and fails on the other. The task must end up on the person, due on the day booked.
 */
export async function assignOnSchedule(page: Page, job: PieceRef, a: Assignment): Promise<void> {
  const { uid, resource, office } = await resourceOf(a.assignee)
  const reviewer = await userIdOf(a.reviewer)
  const closures = await rows('office_closures', `select=id&office_id=eq.${resource.office_id}&starts_on=lte.${a.day}&ends_on=gte.${a.day}`)
  const leave = await rows('resource_unavailability', `select=id&resource_id=eq.${resource.id}&starts_at=lt.${a.day}T23:59:59%2B03:00&ends_at=gt.${a.day}T00:00:00%2B03:00`)
  const booked = await rows<{ load_pct: number | null }>('bookings', `select=load_pct&resource_id=eq.${resource.id}&state=eq.confirmed&starts_at=lt.${a.day}T23:59:59%2B03:00&ends_at=gt.${a.day}T00:00:00%2B03:00`)
  const load = booked.reduce((sum, b) => sum + (b.load_pct ?? 0), 0) + a.hours * 12.5
  const warns = !office.working_days.includes(isoWeekday(a.day)) || closures.length > 0 || leave.length > 0 || load > resource.warn_at_pct

  await page.goto(`/schedule?on=${a.day}`)
  await expect(page.getByTestId('schedule-grid')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId(`cell-${resource.id}-${a.day}`).hover()
  await page.getByTestId(`add-${resource.id}-${a.day}`).click()
  const dialog = page.getByTestId('booking-dialog')
  await expect(dialog).toBeVisible()
  await page.getByTestId('booking-project').selectOption(job.campaignId)
  await page.getByTestId('booking-deliverable-select').selectOption(job.deliverableId)
  await page.getByTestId('booking-subtask-select').selectOption(a.taskId)
  // The task's own reviewer may already be in the picker; the one asked for must be on it either way.
  const reviewerRow = page.getByTestId(`booking-project-reviewer-row-${reviewer}`)
  if ((await reviewerRow.count()) === 0) await page.getByTestId('booking-project-reviewer-add').selectOption(reviewer)
  await expect(reviewerRow).toBeVisible()
  if (a.reviewMode) await page.getByTestId('booking-review-mode').selectOption(a.reviewMode)
  await expect(page.getByTestId('booking-date')).toHaveValue(a.day)
  await page.getByTestId('booking-hours').fill(String(a.hours))
  await page.getByTestId('booking-submit').click()
  if (warns) {
    await expect(page.getByTestId('booking-submit')).toHaveText(/Proceed anyway/)
    await page.getByTestId('booking-submit').click()
  }
  await expect(dialog).toHaveCount(0, { timeout: 20_000 })
  await expect
    .poll(async () => (await rows<{ assignee_id: string | null }>('sub_tasks', `select=assignee_id&id=eq.${a.taskId}`))[0]!.assignee_id)
    .toBe(uid)
  const reviewers = await rows<{ user_id: string }>('sub_task_reviewers', `select=user_id&sub_task_id=eq.${a.taskId}`)
  expect(reviewers.map((r) => r.user_id), 'the reviewer asked for is appointed').toContain(reviewer)
}
