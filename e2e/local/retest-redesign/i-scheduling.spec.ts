import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows, waitForNotification } from '../helpers/db'
import { releaseSingleJob, type ReleasedJob } from '../helpers/single-job'
import { approveTaskList } from '../helpers/piece'
import { clearMailbox, expectMail } from '../helpers/mailpit'

/**
 * docs/RETEST-REDESIGN.md — I: scheduling & bookings (`/schedule`; ADR-0078 working days, I48.5 ad-hoc). I3
 * (ADR-0098, reversed by ADR-0139) and I4 (ADR-0088/0109 extensions, retired by ADR-0141) are retired below.
 *
 * Fixture: one typed Creative single job (four tasks), task list approved by the lead, so its
 * tasks are assignable. Every booking lands in a fresh future week so runs do not collide.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}

/** The Sunday `weeksOut` weeks ahead — a working day in Baghdad and the start of its week. */
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

/** Open the New-booking dialog on a person's cell. The + is hover-revealed (opacity), so hover first. */
async function openAdd(page: Page, resourceId: string, isoDate: string) {
  await page.goto(`/schedule?on=${isoDate}`)
  await expect(page.getByTestId('schedule-grid')).toBeVisible()
  const cell = page.getByTestId(`cell-${resourceId}-${isoDate}`)
  await expect(cell).toBeVisible()
  await cell.hover()
  await page.getByTestId(`add-${resourceId}-${isoDate}`).click()
  await expect(page.getByTestId('booking-dialog')).toBeVisible()
}

/** Project mode: the job → its deliverable → a task → a reviewer (a reviewed task needs one, ADR-0089). */
async function pickTask(page: Page, taskTitle: string, hours: string) {
  // The Project/Ad-hoc toggle exists only where ad-hoc is possible (a person in reach); out of
  // reach the dialog is project-only.
  const mode = page.getByTestId('mode-project')
  if (await mode.count()) await mode.check()
  await page.getByTestId('booking-project').selectOption({ label: job.title })
  await page.getByTestId('booking-deliverable-select').selectOption({ index: 1 })
  await page.getByTestId('booking-subtask-select').selectOption({ label: taskTitle })
  await page.getByTestId('booking-project-reviewer-add').selectOption({ label: PEOPLE.lead.name })
  await page.getByTestId('booking-hours').fill(hours)
}

/** Book. A capacity/day-off finding is warn-and-allow (ADR-0061): the first press shows it, the second proceeds. */
async function book(page: Page) {
  const dialog = page.getByTestId('booking-dialog')
  const submit = page.getByTestId('booking-submit')
  await submit.click()
  const outcome = await Promise.race([
    dialog.waitFor({ state: 'detached', timeout: 20_000 }).then(() => 'closed' as const),
    submit.filter({ hasText: /Proceed anyway/ }).waitFor({ state: 'visible', timeout: 20_000 }).then(() => 'warned' as const),
  ])
  if (outcome === 'warned') {
    await expect(page.getByTestId('booking-error')).toHaveCount(0)
    await submit.click()
    await expect(dialog).toHaveCount(0)
  }
}

let job: ReleasedJob
let tasks: { id: string; title: string }[]
let maker: string

test.describe('Section I — scheduling & bookings', () => {
  test.beforeAll(async ({ browser }) => {
    const am = await as(browser, 'am')
    job = await releaseSingleJob(am, { title: `I sched ${Date.now()}`, department: 'Creative', type: 'Social Advertisement' })
    await am.context().close()
    const lead = await as(browser, 'lead')
    // The task list is approved on the campaign piece panel now (I71.1, ADR-0140); the Creative lead may (I74.51).
    await approveTaskList(lead, job)
    await lead.context().close()
    tasks = await rows<{ id: string; title: string }>('sub_tasks', `select=id,title&deliverable_id=eq.${job.deliverableId}&order=sort_order.asc`)
    expect(tasks.length).toBeGreaterThanOrEqual(3)
    maker = await resourceIdOf(PEOPLE.maker.name)
    await clearMailbox()
  })

  test('I1 — the booking dialogs close on outside-click and on Esc', async ({ browser }) => {
    const traffic = await as(browser, 'traffic')
    const day = sundayOut(2)
    await openAdd(traffic, maker, day)
    await traffic.keyboard.press('Escape')
    await expect(traffic.getByTestId('booking-dialog')).toHaveCount(0)
    await openAdd(traffic, maker, day)
    await traffic.locator('.dialog-backdrop').click({ position: { x: 5, y: 5 } })
    await expect(traffic.getByTestId('booking-dialog')).toHaveCount(0)
    await traffic.context().close()
  })

  test('I2 — assigning a task creates the booking and the assignment in one step; the person is told', async ({ browser }) => {
    const traffic = await as(browser, 'traffic')
    const day = sundayOut(2)
    await openAdd(traffic, maker, day)
    await pickTask(traffic, tasks[0].title, '4')
    await book(traffic)

    const [t] = await rows<{ assignee_id: string | null; status: string }>('sub_tasks', `select=assignee_id,status&id=eq.${tasks[0].id}`)
    const [makerUser] = await rows<{ id: string }>('user_profiles', `select=id&email=eq.${encodeURIComponent(PEOPLE.maker.email)}`)
    expect(t.assignee_id).toBe(makerUser.id)
    const bookings = await rows<{ id: string; resource_id: string }>('bookings', `select=id,resource_id&sub_task_id=eq.${tasks[0].id}`)
    expect(bookings).toHaveLength(1)
    expect(bookings[0].resource_id).toBe(maker)
    await expect(traffic.getByTestId(`booking-${bookings[0].id}`)).toBeVisible()

    // Told, in the inbox and by email.
    const notif = await waitForNotification(PEOPLE.maker.email, 'assigned')
    expect(notif.label).toBe(tasks[0].title)
    await expectMail(PEOPLE.maker.email, /assigned|task/i)

    // I1 (edit dialog): opens from the chip, closes on Esc.
    await traffic.getByTestId(`booking-${bookings[0].id}`).click()
    await expect(traffic.getByTestId('edit-dialog')).toBeVisible()
    await traffic.keyboard.press('Escape')
    await expect(traffic.getByTestId('edit-dialog')).toHaveCount(0)
    await traffic.context().close()
  })

  // I3 retired (5 Oct). Its premise — "a lead or an account manager books anybody, cross-department, directly"
  // (ADR-0098) — was reversed by ADR-0139 (3 Oct): a team lead books her own team, a department lead his
  // department, Traffic / Power Admin anyone; the account manager books nobody, and a pick outside your reach is
  // an ask to that team's lead. Covered, with its refusals, by coverage/schedule-booking.spec.ts — "MAY NOT: the
  // account manager books nobody …" (her pick is an ask, nothing booked, the direct door asks too) and "MAY NOT:
  // … the Creative lead asks Content for the writer — each an ask to that team's lead" — and by
  // coverage/schedule-asks.spec.ts (who answers the ask, who may not).

  // I4 retired (5 Oct). The per-task deadline extension it walked (ask → owner forwards → account manager
  // decides; ADR-0109) is retired by ADR-0141: the door refuses with `extension_retired` and the task page has no
  // Ask — coverage/change-ask.spec.ts "may NOT: the retired per-task extension". What replaced it is covered there
  // too: a maker asks her own lead for more time (coverage/more-time.spec.ts, ADR-0141 d.5), and only the
  // account manager changes a deliverable's due date, through the change form (coverage/change-ask.spec.ts).

  test('I5 — a multi-day booking keeps the span it was committed to, on working days only', async ({ browser }) => {
    const traffic = await as(browser, 'traffic')
    const start = sundayOut(4) // Sunday
    await openAdd(traffic, maker, start)
    await pickTask(traffic, tasks[3].title, '3')
    await traffic.getByTestId('booking-end-date').fill(shift(start, 6)) // through Saturday: Fri/Sat are days off
    // I41.2: the day off pushed the end — the dialog says where the work actually ends, before Book.
    await expect(traffic.getByTestId('booking-ends-on')).toBeVisible()
    await book(traffic)

    const bookings = await rows<{ starts_at: string }>('bookings', `select=starts_at&sub_task_id=eq.${tasks[3].id}&order=starts_at.asc`)
    // ADR-0078 d.1: "Sunday to Saturday" is SEVEN days of work, and a day of work is a working day —
    // so the repeats step over Friday and Saturday and land on the following Sunday and Monday.
    expect(bookings).toHaveLength(7)
    const days = bookings.map((b) => new Date(b.starts_at).getUTCDay())
    expect(days).not.toContain(5) // no Friday
    expect(days).not.toContain(6) // no Saturday
    const [t] = await rows<{ committed_starts_at: string; committed_due_at: string; starts_at: string; due_at: string }>(
      'sub_tasks',
      `select=committed_starts_at,committed_due_at,starts_at,due_at&id=eq.${tasks[3].id}`,
    )
    expect(t.committed_starts_at).toBe(t.starts_at)
    // ADR-0075 d.3a (20 Sep): the promise is close of business — 18:00 Iraq, 15:00Z — on the due
    // DAY, never the hour the placed booking ends; a booking is a day and hours, not a clock time.
    expect(t.committed_due_at.slice(0, 10)).toBe(t.due_at.slice(0, 10))
    expect(t.committed_due_at).toMatch(/T15:00:00/)
    expect(t.due_at.slice(0, 10)).toBe(shift(start, 8)) // the last day the work was PLACED on (the Monday after)
    await traffic.context().close()
  })

  test('I6 — ad-hoc work is switched off: on a person, only a task from a project is offered (I66.10)', async ({ browser }) => {
    const tl = await as(browser, 'tl')
    await openAdd(tl, maker, shift(sundayOut(5), 1))
    await expect(tl.getByTestId('mode-adhoc')).toHaveCount(0)
    await expect(tl.getByTestId('booking-adhoc-text')).toHaveCount(0)
    await expect(tl.getByTestId('booking-adhoc-reviewer')).toHaveCount(0)
    await expect(tl.getByTestId('booking-project')).toBeVisible()
    await tl.context().close()
  })
})
