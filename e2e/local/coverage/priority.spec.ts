import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows } from '../helpers/db'
import { releaseSingleJob, dueInTwoWeeks, type ReleasedJob } from '../helpers/single-job'
import { approveTaskList } from '../helpers/piece'

/**
 * I54.15 — priority, as a coloured symbol, on the three surfaces that had to show it: the
 * campaign's deliverable rows, the schedule chip, and My Work.
 *
 * Edward, 23 Sep: *"show as a symbol (exclamation icon for high priority)… use color coded
 * symbols"*, *"change low to Normal"*, *"order the work according to priority"*.
 *
 * Every state here is made THROUGH the product — two single jobs released by the account manager,
 * their tasks booked by traffic — because a fixture written through the back door proves nothing
 * about the screens (traps.md, "the fixture that lied"). The two jobs share a due date on purpose:
 * that is the only condition under which priority decides the order, and it is the thing most
 * likely to be got wrong.
 *
 * What is asserted, and why each one is here:
 *  - the mark carries `data-priority`, so the assertion never depends on a colour;
 *  - the word beside it reads **Normal**, never "Low";
 *  - on the GRID a normal chip carries no mark at all — the grid is the densest surface and normal
 *    is the common case — while its tooltip still names it;
 *  - on My Work the higher priority sits first when two tasks are due the same day.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}

async function resourceIdOf(name: string): Promise<string> {
  const [r] = await rows<{ id: string }>('resources', `select=id&name=eq.${encodeURIComponent(name)}&is_active=eq.true`)
  expect(r, `resource ${name}`).toBeTruthy()
  return r.id
}

const tasksOf = (deliverableId: string) =>
  rows<{ id: string; title: string }>('sub_tasks', `select=id,title&deliverable_id=eq.${deliverableId}&order=sort_order`)

const stamp = Date.now()
const DUE = dueInTwoWeeks()

let high: ReleasedJob
let normal: ReleasedJob

test.describe.configure({ mode: 'serial' })

test.describe('Priority reads as a symbol wherever the work appears (I54.15)', () => {
  test('two jobs are released with a priority, one high and one normal, due the same day', async ({ browser }) => {
    const am = await as(browser, 'am')
    high = await releaseSingleJob(am, {
      title: `PRIORITY high ${stamp}`,
      department: 'Creative',
      type: 'Key Visual',
      due: DUE,
      priority: 'high',
      task: 'The urgent one.',
    })
    normal = await releaseSingleJob(am, {
      title: `PRIORITY normal ${stamp}`,
      department: 'Creative',
      type: 'Key Visual',
      due: DUE,
      priority: 'low',
      task: 'The ordinary one.',
    })
    // The wizard's choice reached the deliverable — every assertion below reads this column.
    const stored = async (id: string) =>
      (await rows<{ priority: string | null }>('deliverables', `select=priority&id=eq.${id}`))[0].priority
    expect(await stored(high.deliverableId)).toBe('high')
    expect(await stored(normal.deliverableId)).toBe('low')
    await am.context().close()

    // ADR-0090 d.3a: work is not offered to the scheduler until the department has approved the
    // task list. Without this the booking dialog's Deliverable box holds nothing but its
    // placeholder — which is the gate doing its job, not a fault. Approved on the piece's panel (ADR-0132; I71.1).
    const lead = await as(browser, 'lead')
    for (const job of [high, normal]) await approveTaskList(lead, job)
    await lead.context().close()
  })

  test('the campaign page marks each deliverable, and says Normal rather than Low', async ({ browser }) => {
    const am = await as(browser, 'am')

    // The page opens on the Grid (CG-01, I57.4), where every piece is — one click at most.
    const openWorkTab = async (page: Page) => {
      await expect(page.getByTestId('campaign-tab-grid')).toBeVisible()
      await page.getByTestId('campaign-tab-grid').click()
    }

    await am.goto(`/campaigns/${high.campaignId}`)
    await openWorkTab(am)
    const highMark = am.getByTestId(`campaign-deliverable-priority-${high.deliverableId}`)
    await expect(highMark).toBeVisible()
    await expect(highMark).toHaveAttribute('data-priority', 'high')
    await expect(highMark).toHaveAttribute('title', 'High')

    await am.goto(`/campaigns/${normal.campaignId}`)
    await openWorkTab(am)
    const normalMark = am.getByTestId(`campaign-deliverable-priority-${normal.deliverableId}`)
    await expect(normalMark).toBeVisible()
    await expect(normalMark).toHaveAttribute('data-priority', 'low')
    // The word Edward renamed. If this ever reads "Low" again, the rename has been undone.
    await expect(normalMark).toHaveAttribute('title', 'Normal')
    await expect(normalMark).toContainText('Normal')

    await am.context().close()
  })

  test('the schedule marks a high chip, leaves a normal one clean, and names both on hover', async ({ browser }) => {
    const traffic = await as(browser, 'traffic')
    const makerResource = await resourceIdOf(PEOPLE.maker.name)

    // One task from each job, onto the same person, on the same day.
    for (const job of [high, normal]) {
      const tasks = await tasksOf(job.deliverableId)
      expect(tasks.length, `tasks under ${job.title}`).toBeGreaterThan(0)
      await traffic.goto(`/schedule?on=${DUE}`)
      await expect(traffic.getByTestId('schedule-grid')).toBeVisible()
      await traffic.getByTestId(`cell-${makerResource}-${DUE}`).hover()
      await traffic.getByTestId(`add-${makerResource}-${DUE}`).click()
      await expect(traffic.getByTestId('booking-dialog')).toBeVisible()
      const mode = traffic.getByTestId('mode-project')
      if (await mode.count()) await mode.check()
      await traffic.getByTestId('booking-project').selectOption({ label: job.title })
      await traffic.getByTestId('booking-deliverable-select').selectOption({ index: 1 })
      await traffic.getByTestId('booking-subtask-select').selectOption({ label: tasks[0].title })
      await traffic.getByTestId('booking-project-reviewer-add').selectOption({ label: PEOPLE.lead.name })
      await traffic.getByTestId('booking-hours').fill('2')
      const submit = traffic.getByTestId('booking-submit')
      await submit.click()
      const outcome = await Promise.race([
        traffic.getByTestId('booking-dialog').waitFor({ state: 'detached', timeout: 20_000 }).then(() => 'closed' as const),
        submit.filter({ hasText: /Proceed anyway/ }).waitFor({ state: 'visible', timeout: 20_000 }).then(() => 'warned' as const),
      ])
      // Capacity and day-off findings are warn-and-allow (ADR-0061): the second press proceeds.
      if (outcome === 'warned') await submit.click()
      await expect(traffic.getByTestId('booking-dialog')).toHaveCount(0)
    }

    await traffic.goto(`/schedule?on=${DUE}`)
    await expect(traffic.getByTestId('schedule-grid')).toBeVisible()
    const bookingFor = async (deliverableId: string) =>
      (await rows<{ id: string }>('bookings', `select=id&deliverable_id=eq.${deliverableId}`))[0]
    const highBooking = await bookingFor(high.deliverableId)
    const normalBooking = await bookingFor(normal.deliverableId)

    await expect(traffic.getByTestId(`booking-priority-${highBooking.id}`)).toHaveAttribute('data-priority', 'high')
    // Normal earns no mark on the grid: it is the common case, and a mark on every chip costs the
    // width the label needs while saying nothing.
    await expect(traffic.getByTestId(`booking-priority-${normalBooking.id}`)).toHaveCount(0)
    // It is still named in words on hover, so nothing is hidden — only un-shouted.
    await expect(traffic.getByTestId(`booking-${normalBooking.id}`).locator('..')).toContainText('Normal')

    await traffic.context().close()
  })

  test('My Work marks the row and puts the higher priority first on a shared due date', async ({ browser }) => {
    const maker = await as(browser, 'maker')
    await maker.goto('/my-work')
    // The panel, not `panel.or(empty)`: the empty state lives INSIDE the panel, so both resolve
    // once there is nothing to do and the `or` is a strict-mode violation rather than a wait.
    await expect(maker.getByTestId('today-tasks-panel')).toBeVisible({ timeout: 30_000 })

    const taskIdOf = async (deliverableId: string) =>
      (await rows<{ sub_task_id: string }>('bookings', `select=sub_task_id&deliverable_id=eq.${deliverableId}`))[0].sub_task_id
    const highTask = await taskIdOf(high.deliverableId)
    const normalTask = await taskIdOf(normal.deliverableId)

    await expect(maker.getByTestId(`my-work-item-${highTask}`)).toBeVisible()
    await expect(maker.getByTestId(`my-work-item-${normalTask}`)).toBeVisible()

    await expect(maker.getByTestId(`my-work-priority-${highTask}`)).toHaveAttribute('data-priority', 'high')
    await expect(maker.getByTestId(`my-work-priority-${normalTask}`)).toContainText('Normal')

    // Both are due the same day, so priority decides — and this is the assertion that would have
    // caught the list coming back in whatever order the database felt like.
    const order = await maker.locator('[data-testid^="my-work-item-"]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-testid')),
    )
    expect(order.indexOf(`my-work-item-${highTask}`)).toBeLessThan(order.indexOf(`my-work-item-${normalTask}`))

    await maker.context().close()
  })
})
