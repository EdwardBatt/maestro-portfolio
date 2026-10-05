import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows, userIdOf } from '../helpers/db'
import { releaseSingleJob, type ReleasedJob } from '../helpers/single-job'
import { approveTaskList } from '../helpers/piece'

/**
 * Coverage — answering a booking request raised BEFORE ADR-0098 (`I57.28`).
 *
 * Since 22 Sep a lead or an account manager schedules anyone, so no seeded role can raise a
 * request any more: everybody who holds `bookings:create` reaches everybody. But requests raised
 * before that day may still be waiting in production, and the five controls that answer one — the
 * request chip on the grid, the request dialog's reason, Approve and Close, and the requester's
 * Withdraw in the booking dialog — are the only way to clear them.
 *
 * **The request row is planted, and that is deliberate** (Edward, 25 Sep: "test them"). The rule
 * in `helpers/db.ts` — never seed through the back door what the product should create — assumes
 * the product can still create it. It cannot, so the plant stands in for history: the row is
 * exactly what `update_task_assignment` wrote before 22 Sep. Everything after the plant is the
 * real app on the real database: the RPCs, their authority tests and `subtask-schedule`.
 *
 * Actors: `tl` (Creative team lead) asked, before 22 Sep, for the Content writer; `content`
 * (Content's department lead) answers for the writer's calendar.
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
async function resourceIdOf(name: string): Promise<string> {
  const [r] = await rows<{ id: string }>('resources', `select=id&name=eq.${encodeURIComponent(name)}&is_active=eq.true`)
  expect(r, `resource ${name}`).toBeTruthy()
  return r.id
}

const API = 'http://127.0.0.1:54321'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
async function tokenOf(tag: keyof typeof PEOPLE): Promise<string> {
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email: PEOPLE[tag].email, password: 'devpassword' }),
  })
  return ((await res.json()) as { access_token: string }).access_token
}
const SERVICE_KEY =
  process.env.E2E_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

/** A request as `update_task_assignment` wrote one before ADR-0098. History, not product — see above. */
async function plantOldRequest(task: { id: string; title: string }, on: string): Promise<string> {
  const [t] = await rows<{ tenant_id: string }>('sub_tasks', `select=tenant_id&id=eq.${task.id}`)
  const res = await fetch(`${API}/rest/v1/sub_task_assignment_requests`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      tenant_id: t.tenant_id,
      sub_task_id: task.id,
      resource_id: writer,
      assignee_id: writerUser,
      requested_by: tlUser,
      requested_at: `${shift(on, -7)}T09:00:00Z`,
      title: task.title,
      starts_at: `${on}T05:00:00Z`,
      due_at: `${on}T14:00:00Z`,
      hours: 4,
      // The booking dialog never let a request go without a reviewer, so no real one lacks it.
      reviewers: [{ user_id: leadUser, is_mandatory: true }],
      review_mode: 'digital',
    }),
  })
  if (!res.ok) throw new Error(`plant: ${res.status} ${await res.text()}`)
  const [row] = (await res.json()) as { id: string }[]
  return row.id
}

type Request = { status: string; decided_by: string | null; reason: string | null }
const requestRow = async (id: string) =>
  (await rows<Request>('sub_task_assignment_requests', `select=status,decided_by,reason&id=eq.${id}`))[0]

let job: ReleasedJob
let tasks: { id: string; title: string }[]
let writer: string, writerUser: string, tlUser: string, contentUser: string, leadUser: string
const day = sundayOut(5)

test.describe.configure({ mode: 'serial' })

test.describe('Coverage — an old booking request is answered (I57.28)', () => {
  test.beforeAll(async ({ browser }) => {
    const am = await as(browser, 'am')
    job = await releaseSingleJob(am, { title: `Old request ${Date.now()}`, department: 'Creative', type: 'Social Advertisement' })
    await am.context().close()
    // The owner approves the task list on the piece's panel (ADR-0132 d.2; I71.1).
    const lead = await as(browser, 'lead')
    await approveTaskList(lead, job)
    await lead.context().close()
    tasks = await rows<{ id: string; title: string }>('sub_tasks', `select=id,title&deliverable_id=eq.${job.deliverableId}&order=sort_order.asc,id.asc`)
    expect(tasks.length, 'the job has at least two tasks').toBeGreaterThanOrEqual(2)
    writer = await resourceIdOf(PEOPLE.writer.name)
    ;[writerUser, tlUser, contentUser, leadUser] = await Promise.all([PEOPLE.writer, PEOPLE.tl, PEOPLE.content, PEOPLE.lead].map((p) => userIdOf(p.email)))

    // Task 0 is booked on the maker, so it has a booking whose dialog can show the request.
    const traffic = await as(browser, 'traffic')
    const maker = await resourceIdOf(PEOPLE.maker.name)
    await traffic.goto(`/schedule?on=${day}`)
    const cell = traffic.getByTestId(`cell-${maker}-${day}`)
    await cell.hover()
    await traffic.getByTestId(`add-${maker}-${day}`).click()
    const mode = traffic.getByTestId('mode-project')
    if (await mode.count()) await mode.check()
    await traffic.getByTestId('booking-project').selectOption({ label: job.title })
    await traffic.getByTestId('booking-deliverable-select').selectOption({ index: 1 })
    await traffic.getByTestId('booking-subtask-select').selectOption({ label: tasks[0].title })
    await traffic.getByTestId('booking-project-reviewer-add').selectOption({ label: PEOPLE.lead.name })
    await traffic.getByTestId('booking-hours').fill('4')
    const submit = traffic.getByTestId('booking-submit')
    await submit.click()
    // Warn-and-allow (ADR-0061): an over-capacity day asks once more; anything else must close.
    if (await submit.filter({ hasText: /Proceed anyway/ }).isVisible({ timeout: 3_000 }).catch(() => false)) await submit.click()
    await expect(traffic.getByTestId('booking-dialog')).toHaveCount(0, { timeout: 20_000 })
    await traffic.context().close()
    await expect
      .poll(async () => (await rows('bookings', `select=id&sub_task_id=eq.${tasks[0].id}&state=in.(soft_hold,tentative,confirmed)`)).length)
      .toBe(1)
  })

  test('the requester withdraws it from her Schedule\'s "Asked of other teams" (ADR-0139 d.4)', async ({ browser }) => {
    const requestId = await plantOldRequest(tasks[0], day)

    // The booking dialog no longer carries the request (TaskPopup, ADR-0140); the asker's own card does.
    const tl = await as(browser, 'tl')
    await tl.goto(`/schedule?on=${day}`)
    await tl.getByTestId(`ask-withdraw-${requestId}`).click()
    await expect.poll(async () => (await requestRow(requestId)).status).toBe('withdrawn')
    expect((await requestRow(requestId)).decided_by).toBe(tlUser)
    await expect(tl.getByTestId(`ask-withdraw-${requestId}`)).toHaveCount(0)
    await tl.context().close()

    // Only the requester is offered it: the writer's department lead is not.
    const again = await plantOldRequest(tasks[0], day)
    const content = await as(browser, 'content')
    await content.goto(`/schedule?on=${day}`)
    await expect(content.getByTestId(`request-${again}`)).toBeVisible()
    expect(await content.getByTestId(`ask-withdraw-${again}`).count()).toBe(0)
    await content.context().close()
    // Left pending would hold the next test's task; this one is closed the way it was opened.
    const tl2 = await as(browser, 'tl')
    await tl2.goto(`/schedule?on=${day}`)
    await tl2.getByTestId(`ask-withdraw-${again}`).click()
    await expect.poll(async () => (await requestRow(again)).status).toBe('withdrawn')
    await tl2.context().close()
  })

  test('the writer’s Team Leader opens the chip, closes it, then answers it — booked, the task is the writer’s (ADR-0139 d.3)', async ({ browser }) => {
    const requestId = await plantOldRequest(tasks[1], day)
    // May NOT: the department lead is not who answers while the Team Leader can (d.3) — refused in words, nothing changed.
    const refused = await fetch(`${API}/rest/v1/rpc/answer_task_request`, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${await tokenOf('content')}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_request: requestId, p_answer: 'book', p_assignee: writerUser }),
    })
    expect(refused.status).toBe(403)
    expect(await refused.text()).toContain('not_the_answerer')
    expect((await requestRow(requestId)).status).toBe('pending')

    const copytl = await as(browser, 'copytl')
    await copytl.goto(`/schedule?on=${day}`)
    // One day asked for, so one chip, on the writer's row on that day.
    const chip = copytl.getByTestId(`cell-${writer}-${day}`).getByTestId(`request-${requestId}`)
    await expect(chip).toBeVisible()
    await expect(copytl.getByTestId(`request-${requestId}`)).toHaveCount(1)

    // Close changes nothing.
    await chip.click()
    await expect(copytl.getByTestId('request-dialog')).toBeVisible()
    await expect(copytl.getByTestId('request-summary')).toContainText(PEOPLE.tl.name)
    await expect(copytl.getByTestId('request-summary')).toContainText(tasks[1].title)
    await copytl.getByTestId('request-close').click()
    await expect(copytl.getByTestId('request-dialog')).toHaveCount(0)
    expect((await requestRow(requestId)).status).toBe('pending')

    // Answer opens the one answer window; Book gives it to the writer.
    await chip.click()
    await copytl.getByTestId('request-answer').click()
    await expect(copytl.getByTestId('answer-ask-book')).toBeVisible()
    await copytl.getByTestId('answer-ask-book').click()
    await expect(copytl.getByTestId('answer-ask-book')).toHaveCount(0, { timeout: 20_000 })

    await expect.poll(async () => (await requestRow(requestId)).status).toBe('approved')
    const [task] = await rows<{ assignee_id: string | null }>('sub_tasks', `select=assignee_id&id=eq.${tasks[1].id}`)
    expect(task.assignee_id).toBe(writerUser)
    await expect
      .poll(async () => (await rows<{ resource_id: string }>('bookings', `select=resource_id&sub_task_id=eq.${tasks[1].id}&state=in.(soft_hold,tentative,confirmed)`)).map((b) => b.resource_id))
      .toContain(writer)
    await copytl.reload()
    await expect(copytl.getByTestId(`request-${requestId}`)).toHaveCount(0)
    await copytl.context().close()
  })
})
