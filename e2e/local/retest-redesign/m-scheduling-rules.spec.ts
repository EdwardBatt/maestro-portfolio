import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, OFFICES, PEOPLE } from '../fixtures'
import { rows } from '../helpers/db'
import { releaseSingleJob } from '../helpers/single-job'
import { approveTaskList } from '../helpers/piece'
import { mockProposal, ownTheWork, startCampaign, writeBrief } from '../helpers/campaign-wizard'

/**
 * docs/RETEST-REDESIGN.md — M: scheduling rules and office closures (ADR-0075 d.5, ADR-0079;
 * I41.10–I41.12). Extends e2e/local/closures.spec.ts to the whole section.
 *
 * The closure ("Eid") is declared on Baghdad for the Tuesday and Wednesday TWO weeks out — a week
 * no other spec books into — after an ad-hoc booking has been placed on that Tuesday, so the
 * stranded list has something to list. Everything declared here is removed at the end.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}

const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
/** The Tuesday two weeks out (a working day in both offices, so any shading is the closure's). */
function tuesdayTwoWeeksOut(): string {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  const toNextTue = ((2 - d.getUTCDay() + 7) % 7) + 14
  return new Date(d.getTime() + toNextTue * 86_400_000).toISOString().slice(0, 10)
}

async function resourceIdOf(name: string): Promise<string> {
  const [r] = await rows<{ id: string }>('resources', `select=id&name=eq.${encodeURIComponent(name)}&is_active=eq.true`)
  expect(r, `resource ${name}`).toBeTruthy()
  return r.id
}

async function openAdd(page: Page, resourceId: string, isoDate: string) {
  await page.goto(`/schedule?on=${isoDate}`)
  await expect(page.getByTestId('schedule-grid')).toBeVisible()
  const cell = page.getByTestId(`cell-${resourceId}-${isoDate}`)
  await expect(cell).toBeVisible()
  await cell.hover()
  await page.getByTestId(`add-${resourceId}-${isoDate}`).click()
  await expect(page.getByTestId('booking-dialog')).toBeVisible()
}

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

async function setDeliveryDays(page: Page, days: number) {
  await page.goto('/admin/organization')
  await expect(page.getByTestId('scheduling-settings-form')).toBeVisible()
  const field = page.getByTestId('scheduling-delivery-days')
  if ((await field.inputValue()) === String(days)) return // Save is off until something changes
  await field.fill(String(days))
  await page.getByTestId('scheduling-settings-save').click()
  await expect(page.getByTestId('org-banner')).toContainText('Scheduling rules saved.')
  await page.getByTestId('org-banner-close').click()
}

const eidStart = tuesdayTwoWeeksOut()
const eidEnd = shift(eidStart, 1)
const eidName = `Eid (retest ${eidStart})`
let maker: string
let strandedBooking: { id: string; starts_at: string }
let strandedTaskTitle: string

test.describe('Section M — scheduling rules and office closures', () => {
  test.beforeAll(async ({ browser }) => {
    maker = await resourceIdOf(PEOPLE.maker.name)
    // Something booked ON the closure days, before the closure exists: a job's task on the maker (ad-hoc
    // work, which this used, is switched off — I66.10).
    const am = await as(browser, 'am')
    const job = await releaseSingleJob(am, { title: `Eid stranded ${Date.now()}`, department: 'Creative', type: 'Social Advertisement' })
    await am.context().close()
    const lead = await as(browser, 'lead')
    // The task list is approved on the campaign piece panel now (I71.1, ADR-0140); the Creative lead may (I74.51).
    await approveTaskList(lead, job)
    await lead.context().close()
    const [task] = await rows<{ id: string; title: string }>('sub_tasks', `select=id,title&deliverable_id=eq.${job.deliverableId}&order=sort_order.asc`)
    // The stranded list names the booking's DELIVERABLE (an ad-hoc task's name was both, so it read the same).
    const [piece] = await rows<{ name: string }>('deliverables', `select=name&id=eq.${job.deliverableId}`)
    strandedTaskTitle = piece!.name
    const tl = await as(browser, 'tl')
    await openAdd(tl, maker, eidStart)
    await tl.getByTestId('booking-project').selectOption({ label: job.title })
    await tl.getByTestId('booking-deliverable-select').selectOption({ index: 1 })
    await tl.getByTestId('booking-subtask-select').selectOption({ label: task!.title })
    await tl.getByTestId('booking-project-reviewer-add').selectOption({ label: PEOPLE.lead.name })
    await tl.getByTestId('booking-hours').fill('2')
    await book(tl)
    await tl.context().close()
    ;[strandedBooking] = await rows<{ id: string; starts_at: string }>('bookings', `select=id,starts_at&sub_task_id=eq.${task!.id}`)
    expect(strandedBooking).toBeTruthy()
  })

  // Put the rule back whether M1 passed or not. It used to be the test's last line, so a failure
  // anywhere above it left the tenant on 3 — and every date the next person looked at was a day
  // early (24 Sep: the timing screen showed Tue where Wed was right).
  test.afterEach(async ({ browser }, info) => {
    if (!info.title.startsWith('M1')) return
    const admin = await as(browser, 'admin')
    await setDeliveryDays(admin, 2)
    await admin.context().close()
  })

  test('M1 — the scheduling rules live under Admin → Organization; a viewer without organization:manage is refused plainly; the wizard reads them', async ({ browser }) => {
    test.setTimeout(120_000)
    const admin = await as(browser, 'admin')
    await setDeliveryDays(admin, 2) // stated, so a previous run's value cannot leak in
    await admin.goto('/admin/organization')
    const form = admin.getByTestId('scheduling-settings-form')
    await expect(form).toBeVisible()
    // The section sits at the top, with the three rules in working days, and Save is off until a change.
    const firstHeading = admin.locator('main h2, .surface h2, h2').first()
    await expect(firstHeading).toContainText(/scheduling rules/i)
    await expect(admin.getByTestId('scheduling-delivery-days')).toHaveValue('2')
    await expect(admin.getByTestId('scheduling-commence-days')).toHaveValue('4')
    await expect(admin.getByTestId('scheduling-review-buffer')).toHaveValue('1')
    await expect(admin.getByTestId('scheduling-settings-save')).toBeDisabled()
    await admin.getByTestId('scheduling-delivery-days').fill('3')
    await expect(admin.getByTestId('scheduling-settings-save')).toBeEnabled()
    await admin.getByTestId('scheduling-settings-save').click()
    await expect(admin.getByTestId('org-banner')).toContainText('Scheduling rules saved.')
    await admin.getByTestId('org-banner-close').click()
    await admin.reload()
    await expect(admin.getByTestId('scheduling-delivery-days')).toHaveValue('3')
    await admin.context().close()

    // Somebody who can see the organisation but not manage it (the CEO — Traffic cannot open the
    // page at all: admin.organization:view is held by the executives and the Power Admin only).
    const ceo = await as(browser, 'ceo')
    await ceo.goto('/admin/organization')
    await expect(ceo.getByTestId('scheduling-settings-form')).toBeVisible()
    await ceo.getByTestId('scheduling-commence-days').fill('5')
    await ceo.getByTestId('scheduling-settings-save').click()
    await expect(ceo.getByTestId('org-banner-dialog')).toBeVisible()
    await expect(ceo.getByTestId('org-banner-dialog').locator('h2')).toHaveText('That did not work')
    await expect(ceo.getByTestId('org-banner')).toContainText(/manages the organisation.*Nothing was changed/i)
    await ceo.context().close()
    const [row] = await rows<{ delivery_days_before_go_live: number; commence_days_before_delivery: number }>('tenant_reminder_settings', 'select=delivery_days_before_go_live,commence_days_before_delivery')
    expect(row.delivery_days_before_go_live).toBe(3)
    expect(row.commence_days_before_delivery).toBe(4) // the refused save changed nothing

    // The wizard's timing step reads the new rule — in its (i) tip, which is where standing advice
    // lives now (Edward, 24 Sep), and in the date it counts back.
    const am = await as(browser, 'am')
    await mockProposal(am, [{ name: 'Key visual', typeCode: 'ADV-006', channel: 'OOH' }])
    await startCampaign(am, { name: `M1 rules ${Date.now()}`, workstreams: false })
    await writeBrief(am)
    await ownTheWork(am, [PEOPLE.tl.name])
    await am.getByTestId('wizard-timing-golive-tip-button').click()
    await expect(am.getByTestId('wizard-timing-golive-tip-body')).toContainText(/delivery 3 working days before it/)
    await am.context().close()
  })


  test('M2/M3 — declare a closure on an office; the stranded list names the booking, moves nothing; a drag moves it', async ({ browser }) => {
    test.setTimeout(120_000)
    const admin = await as(browser, 'admin')
    await admin.goto('/people/leave')
    await expect(admin.getByTestId('surface-leave')).toBeVisible()
    // Two halves: closures above staff leave.
    const closuresBox = await admin.getByTestId('closures-table').boundingBox()
    const leaveBox = await (await admin.getByTestId('leave-table').count()
      ? admin.getByTestId('leave-table')
      : admin.getByTestId('leave-empty')).boundingBox()
    expect(closuresBox!.y).toBeLessThan(leaveBox!.y)

    await admin.getByTestId('closure-add').click()
    const dialog = admin.getByTestId('closure-dialog')
    await expect(dialog).toBeVisible()
    // An office, not a person; a kind; a name; dates.
    const officeOptions = await dialog.getByTestId('closure-office').locator('option').allTextContents()
    expect(officeOptions).toEqual(expect.arrayContaining([OFFICES.baghdad, OFFICES.dubai]))
    expect(officeOptions).not.toContain(PEOPLE.maker.name)
    const kinds = await dialog.getByTestId('closure-kind').locator('option').allTextContents()
    expect(kinds.join(' ')).toMatch(/public holiday/i)
    expect(kinds.join(' ')).toMatch(/company closed/i)
    await dialog.getByTestId('closure-office').selectOption({ label: OFFICES.baghdad })
    await dialog.getByTestId('closure-kind').selectOption('public_holiday')
    await dialog.getByTestId('closure-name').fill(eidName)
    await dialog.getByTestId('closure-start').fill(eidStart)
    await dialog.getByTestId('closure-end').fill(eidEnd)
    await dialog.getByTestId('closure-submit').click()
    // "Saved." (ADR-0092: one notice chrome) sits over the page until closed.
    await expect(admin.getByTestId('leave-banner')).toContainText(/saved/i)
    await admin.getByTestId('leave-banner-close').click()
    const table = admin.getByTestId('closures-table')
    await expect(table).toContainText(eidName)
    await expect(table).toContainText(OFFICES.baghdad)

    // M3 — the stranded list, straight away: the booking, the work, the person, "Open that week".
    const panel = admin.getByTestId('stranded-panel')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText(eidName)
    const line = admin.getByTestId(`stranded-${strandedBooking.id}`)
    await expect(line).toBeVisible()
    await expect(line).toContainText(strandedTaskTitle)
    await expect(line).toContainText(PEOPLE.maker.name)
    const open = admin.getByTestId(`stranded-open-${strandedBooking.id}`)
    await expect(open).toBeVisible()
    const href = await open.getAttribute('href')
    expect(href).toMatch(/\/schedule\?/)
    expect(href).toContain(`on=${eidStart}`)
    // Nothing has moved.
    const [still] = await rows<{ starts_at: string }>('bookings', `select=starts_at&id=eq.${strandedBooking.id}`)
    expect(still.starts_at).toBe(strandedBooking.starts_at)
    await admin.getByTestId('stranded-dismiss').click()
    await expect(panel).toHaveCount(0)
    // Reachable later from the row.
    const [closure] = await rows<{ id: string }>('office_closures', `select=id&name=eq.${encodeURIComponent(eidName)}`)
    await admin.getByTestId(`closure-stranded-${closure.id}`).click()
    await expect(admin.getByTestId('stranded-panel')).toBeVisible()
    await expect(admin.getByTestId(`stranded-${strandedBooking.id}`)).toBeVisible()
    await admin.context().close()

    // Drag the chip to the Thursday after Eid: it moves (a warning, if any, is the ordinary drop warning).
    const traffic = await as(browser, 'traffic')
    await traffic.goto(`/schedule?on=${eidStart}`)
    await expect(traffic.getByTestId('schedule-grid')).toBeVisible()
    const target = shift(eidStart, 2) // Thursday, in the same week
    const chip = traffic.getByTestId(`booking-${strandedBooking.id}`)
    await expect(chip).toBeVisible()
    // HTML5 drag-and-drop, driven through the same events the grid listens to (the chip writes
    // its id to the DataTransfer on dragstart; the cell reads it on drop).
    const dt = await traffic.evaluateHandle(() => new DataTransfer())
    await chip.dispatchEvent('dragstart', { dataTransfer: dt })
    const cell = traffic.getByTestId(`cell-${maker}-${target}`)
    await cell.dispatchEvent('dragover', { dataTransfer: dt })
    await cell.dispatchEvent('drop', { dataTransfer: dt })
    const warn = traffic.getByTestId('drop-warning-confirm')
    if (await warn.isVisible({ timeout: 2_000 }).catch(() => false)) await warn.click()
    await expect.poll(async () => (await rows<{ starts_at: string }>('bookings', `select=starts_at&id=eq.${strandedBooking.id}`))[0].starts_at.slice(0, 10)).toBe(target)
    await traffic.context().close()
  })

  test('M4/M5 — the grid shades the closed days for Baghdad rows only, including a person added afterwards', async ({ browser }) => {
    // M5: a new Baghdad resource, added after the closure was declared.
    const admin = await as(browser, 'admin')
    await admin.goto('/admin/resources')
    await admin.getByTestId('resource-new').click()
    await expect(admin.getByTestId('resource-dialog')).toBeVisible()
    const newName = `Eid Newcomer ${Date.now()}`
    await admin.getByTestId('resource-kind').selectOption('human')
    await admin.getByTestId('resource-name').fill(newName)
    await admin.getByTestId('resource-office').selectOption({ label: OFFICES.baghdad })
    await admin.getByTestId('resource-submit').click()
    await expect(admin.getByTestId('resource-dialog')).toHaveCount(0)
    const newcomer = await resourceIdOf(newName)
    await admin.context().close()

    const traffic = await as(browser, 'traffic')
    await traffic.goto(`/schedule?on=${eidStart}`)
    await expect(traffic.getByTestId('schedule-grid')).toBeVisible()
    const producer = await resourceIdOf(PEOPLE.producer.name)
    const editor = await resourceIdOf(PEOPLE.editor.name)
    for (const day of [eidStart, eidEnd]) {
      await expect(traffic.getByTestId(`cell-${producer}-${day}`), `Baghdad ${day}`).toHaveClass(/nonworking/)
      await expect(traffic.getByTestId(`cell-${newcomer}-${day}`), `newcomer ${day}`).toHaveClass(/nonworking/)
      await expect(traffic.getByTestId(`cell-${editor}-${day}`), `Dubai ${day}`).not.toHaveClass(/nonworking/)
    }
    // And a plain working day is not shaded for anybody.
    await expect(traffic.getByTestId(`cell-${producer}-${shift(eidStart, -1)}`)).not.toHaveClass(/nonworking/)
    await traffic.context().close()
  })

  test('M6 — a multi-day booking steps over the closure, and the dialog says so', async ({ browser }) => {
    test.setTimeout(120_000)
    const am = await as(browser, 'am')
    const job = await releaseSingleJob(am, { title: `M6 span ${Date.now()}`, department: 'Creative', type: 'Social Advertisement' })
    await am.context().close()
    const lead = await as(browser, 'lead')
    // The task list is approved on the campaign piece panel now (I71.1, ADR-0140); the Creative lead may (I74.51).
    await approveTaskList(lead, job)
    await lead.context().close()
    const [task] = await rows<{ id: string; title: string }>('sub_tasks', `select=id,title&deliverable_id=eq.${job.deliverableId}&order=sort_order.asc`)

    const traffic = await as(browser, 'traffic')
    const start = shift(eidStart, -1) // the Monday before Eid
    await openAdd(traffic, maker, start)
    const mode = traffic.getByTestId('mode-project')
    if (await mode.count()) await mode.check()
    await traffic.getByTestId('booking-project').selectOption({ label: job.title })
    await traffic.getByTestId('booking-deliverable-select').selectOption({ index: 1 })
    await traffic.getByTestId('booking-subtask-select').selectOption({ label: task.title })
    await traffic.getByTestId('booking-project-reviewer-add').selectOption({ label: PEOPLE.lead.name })
    await traffic.getByTestId('booking-hours').fill('3')
    await traffic.getByTestId('booking-end-date').fill(shift(start, 2)) // "3 days": Mon–Wed on the calendar
    // The preview says where the work actually ends — past the closure.
    const endsOn = traffic.getByTestId('booking-ends-on')
    await expect(endsOn).toBeVisible()
    await expect(endsOn).not.toContainText(eidStart)
    await expect(endsOn).not.toContainText(eidEnd)
    await book(traffic)
    await traffic.context().close()

    const bookings = await rows<{ starts_at: string }>('bookings', `select=starts_at&sub_task_id=eq.${task.id}&order=starts_at.asc`)
    expect(bookings).toHaveLength(3)
    const days = bookings.map((b) => b.starts_at.slice(0, 10))
    expect(days).not.toContain(eidStart)
    expect(days).not.toContain(eidEnd)
    expect(days[0]).toBe(start)
    expect(days[1]).toBe(shift(eidStart, 2)) // Thursday — the first working day after Eid
    for (const d of days) expect([5, 6]).not.toContain(new Date(`${d}T12:00:00Z`).getUTCDay())
  })

  test('M7 — the leave form offers Leave only', async ({ browser }) => {
    const admin = await as(browser, 'admin')
    await admin.goto('/people/leave')
    await admin.getByTestId('leave-add').click()
    await expect(admin.getByTestId('leave-dialog')).toBeVisible()
    const kinds = await admin.getByTestId('leave-kind').locator('option').allTextContents()
    expect(kinds).toHaveLength(1)
    expect(kinds[0]).toMatch(/leave/i)
    expect(kinds.join(' ')).not.toMatch(/holiday/i)
    await admin.getByTestId('leave-cancel').click()
    await admin.context().close()
  })

  test('M8 — a maker cannot reach the HR surface at all (leave:view is the Power Admin only); edit and delete are two-step for those who may', async ({ browser }) => {
    const [closure] = await rows<{ id: string }>('office_closures', `select=id&name=eq.${encodeURIComponent(eidName)}`)
    // ADR-0079 d.7: /people/leave is the HR surface behind leave:view, which no seeded role but
    // the Power Admin holds — so a maker is refused at the route (the guard is the front door)
    // and has no nav entry; the closures reach them through the grid (M4), not this page.
    const maker = await as(browser, 'maker')
    await maker.goto('/people/leave')
    await expect(maker.getByTestId('surface-leave')).toHaveCount(0)
    await expect(maker).not.toHaveURL(/\/people\/leave/)
    await expect(maker.getByTestId('nav-people-leave')).toHaveCount(0)
    await maker.context().close()

    // Two-step: the first press arms ("Confirm delete?"), the row stays; the second removes it.
    const admin = await as(browser, 'admin')
    await admin.goto('/people/leave')
    const del = admin.getByTestId(`closure-delete-${closure.id}`)
    await del.click()
    await expect(del).toContainText(/confirm/i)
    await expect(admin.getByTestId(`closure-row-${closure.id}`)).toBeVisible()
    await del.click()
    await expect(admin.getByTestId(`closure-row-${closure.id}`)).toHaveCount(0)
    expect(await rows('office_closures', `select=id&id=eq.${closure.id}`)).toHaveLength(0)
    await admin.context().close()
  })
})
