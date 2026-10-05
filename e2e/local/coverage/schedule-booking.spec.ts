import { test, expect, type Page } from '@playwright/test'
import { rows } from '../helpers/db'
import { approveTaskList } from '../helpers/piece'
import { releaseSingleJob } from '../helpers/single-job'
import {
  PEOPLE,
  as,
  bookingsOf,
  idOf,
  makeApprovedPiece,
  requestsOn,
  resourceIdOf,
  rpcAs,
  rpcRaw,
  taskRow,
  toldAbout,
  workday,
  type TaskRow,
} from '../helpers/i74'

/**
 * Coverage — the Schedule's booking window (I74.21–I74.24, Figma L SC-01…SC-18) and who may book whom
 * (ADR-0139 d.1–d.3).
 *
 *   MAY book directly:  the Design team lead (`tl`) her own team (the maker); the Creative department lead
 *                       (`lead`) anyone in Creative (the Motion animator).
 *   MAY NOT — it asks:  the account manager (`am`) picking anyone; the Design team lead picking another team
 *                       (Motion); the Creative department lead picking another department (Content's writer).
 *                       Nothing is booked, a `sub_task_assignment_requests` row waits, and the asked team's
 *                       Team Leader is told (`assignment_requested`).
 *   NOT OFFERED:        the team lead's Who lists only her team; the department lead's only his department.
 *
 * Every piece is made here through the product (a released Creative single job, its list approved by its
 * owner); every outcome is read back from the database.
 */
test.use({ actionTimeout: 15_000 })
test.describe.configure({ mode: 'serial' })

const DESIGN = 'd0000000-0000-4000-8000-00000000d101'
const MOTION = 'd0000000-0000-4000-8000-00000000d102'
const COPY = 'd0000000-0000-4000-8000-00000000d105'
const BUCKET = 'https://b2.local.test'
const DAY = 86_400_000
const stamp = Date.now().toString().slice(-6)

/** The day after `iso` that Baghdad works (Sun–Thu). */
function nextWorkday(iso: string): string {
  let t = Date.parse(`${iso}T12:00:00Z`) + DAY
  for (;;) {
    const wd = new Date(t).getUTCDay()
    if (wd !== 5 && wd !== 6) return new Date(t).toISOString().slice(0, 10)
    t += DAY
  }
}
/** The Sunday (UTC) starting the week that holds `ms` — as the Schedule counts weeks. */
const sundayOf = (ms: number) => {
  const d = new Date(ms)
  d.setUTCHours(0, 0, 0, 0)
  return new Date(d.getTime() - d.getUTCDay() * DAY).toISOString().slice(0, 10)
}

/** The Library's bucket stood in for in the browser (traps: local functions have no B2 keys). */
async function standInForTheBucket(page: Page) {
  await page.route(`${BUCKET}/**`, (route) => route.fulfill({ status: 200, body: '', headers: { ETag: '"e2e"' } }))
  await page.route('**/functions/v1/asset-url', async (route) => {
    const body = route.request().postDataJSON() as { op: string; fileName?: string; objectKey?: string; folderId?: string }
    const keyIn = async (folderId: string, name: string) => {
      const [f] = await rows<{ tenant_id: string; client_id: string }>('asset_folders', `select=tenant_id,client_id&id=eq.${folderId}`)
      return `${f!.tenant_id}/${f!.client_id}/${folderId}/${Date.now()}-${name}`
    }
    if (body.op === 'upload') {
      const objectKey = await keyIn(body.folderId!, body.fileName ?? 'file')
      return route.fulfill({ json: { uploadUrl: `${BUCKET}/put/${objectKey}`, objectKey, provider: 'b2' } })
    }
    if (body.op === 'thumb_upload') return route.fulfill({ json: { uploadUrl: `${BUCKET}/put/${body.objectKey}.thumb.webp`, thumbObjectKey: `${body.objectKey}.thumb.webp` } })
    return route.fulfill({ json: { url: `${BUCKET}/get/x`, downloadUrl: `${BUCKET}/get/x` } })
  })
}

/**
 * Pick the piece from To book (searched by its title, so a long-lived list never decides it) and click the
 * person's day: the booking window opens on the piece's unbooked tasks.
 */
async function openWindow(page: Page, piece: { title: string; deliverableId: string }, resourceId: string, isoDay: string, firstTask: string) {
  await page.goto(`/schedule?on=${isoDay}`)
  await expect(page.getByTestId('schedule-grid')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('to-book-search').fill(piece.title)
  await page.getByTestId(`to-book-${piece.deliverableId}`).click()
  await expect(page.getByTestId('schedule-picked')).toBeVisible()
  await expect(page.getByTestId('schedule-pick-hint')).toBeVisible()
  await page.getByTestId(`cell-${resourceId}-${isoDay}`).click({ position: { x: 4, y: 4 } })
  await expect(page.getByTestId('book-submit')).toBeVisible()
  await expect(page.getByTestId(`book-row-${firstTask}`)).toBeVisible({ timeout: 15_000 })
}

/** Who checks the work — chosen, never assumed (I74.22). */
async function chooseReviewer(page: Page, tag: keyof typeof PEOPLE) {
  const id = await idOf(tag)
  await page.getByTestId('book-reviewer-add').selectOption(id)
  await expect(page.getByTestId(`book-reviewer-row-${id}`)).toBeVisible()
}

/** Pick two days in the open row's calendar: `from`, then `to`. */
async function pickDays(page: Page, taskId: string, from: string, to: string) {
  await page.getByTestId(`book-dates-${taskId}`).click()
  await expect(page.getByTestId('book-dates-picker')).toBeVisible()
  await page.getByTestId(`book-dates-picker-day-${from}`).click()
  await page.getByTestId(`book-dates-picker-day-${to}`).click()
  await expect(page.getByTestId('book-dates-picker-from')).not.toHaveText('—')
  await expect(page.getByTestId('book-dates-picker-to')).not.toHaveText('—')
  await page.getByTestId('book-dates-picker-done').click()
  await expect(page.getByTestId('book-dates-picker')).toHaveCount(0)
}

const iraqDayOf = (ts: string) => new Date(Date.parse(ts) + 3 * 3_600_000).toISOString().slice(0, 10)

test.describe('Coverage — the Schedule\'s booking window and who books whom (ADR-0139)', () => {
  test('To book: search, client, campaign and due menus narrow it; a picked piece is dropped; the weeks menu and Jump to a date move the grid', async ({ browser }) => {
    test.setTimeout(180_000)
    const { job } = await makeApprovedPiece(browser, `I74 To book ${stamp}`)
    const [campaign] = await rows<{ client_id: string }>('campaigns', `select=client_id&id=eq.${job.campaignId}`)

    const tl = await as(browser, 'tl')
    await tl.goto('/schedule')
    await expect(tl.getByTestId('schedule-grid')).toBeVisible({ timeout: 20_000 })
    const card = tl.getByTestId(`to-book-${job.deliverableId}`)

    await tl.getByTestId('to-book-search').fill(job.title)
    await expect(card).toBeVisible()
    await expect(tl.locator('[data-testid^="to-book-"][aria-pressed]')).toHaveCount(1)

    await tl.getByTestId('to-book-client').click()
    await expect(tl.getByTestId('to-book-client-menu')).toBeVisible()
    await tl.getByTestId(`to-book-client-${campaign!.client_id}`).click()
    await expect(tl.getByTestId('to-book-client')).toContainText('Northwind Beverages')
    await expect(card).toBeVisible()

    await tl.getByTestId('to-book-campaign').click()
    await tl.getByTestId(`to-book-campaign-${job.campaignId}`).click()
    await expect(card).toBeVisible()

    // The piece is due in two to three weeks: "no due date" hides it, "any" brings it back.
    await tl.getByTestId('to-book-due').click()
    await tl.getByTestId('to-book-due-none').click()
    await expect(card).toHaveCount(0)
    await expect(tl.getByTestId('to-book-nomatch')).toBeVisible()
    await tl.getByTestId('to-book-due').click()
    await tl.getByTestId('to-book-due-any').click()
    await expect(card).toBeVisible()

    // Pick it, then drop it with the ✕ on the picked line.
    await card.click()
    // The picked line names the PIECE (the deliverable — named after its type here) and its client, not the job.
    const [piece] = await rows<{ name: string }>('deliverables', `select=name&id=eq.${job.deliverableId}`)
    await expect(tl.getByTestId('schedule-picked')).toContainText(piece!.name)
    await expect(tl.getByTestId('schedule-picked')).toContainText('Northwind Beverages')
    await expect(card).toHaveAttribute('aria-pressed', 'true')
    await tl.getByTestId('schedule-picked-close').click()
    await expect(tl.getByTestId('schedule-picked')).toHaveCount(0)
    await expect(card).toHaveAttribute('aria-pressed', 'false')

    // The weeks menu: next week, then Jump to a date six weeks out.
    const thisSunday = sundayOf(Date.now())
    const nextSunday = sundayOf(Date.now() + 7 * DAY)
    await tl.getByTestId('week-menu-open').click()
    await expect(tl.getByTestId('week-menu')).toBeVisible()
    await tl.getByTestId('week-option-1').click()
    await expect(tl.getByTestId('week-menu')).toHaveCount(0)
    await expect(tl).toHaveURL(new RegExp(`on=${nextSunday}`))
    await expect(tl.getByTestId('nav-today')).toBeVisible()

    const far = new Date(Date.now() + 43 * DAY).toISOString().slice(0, 10)
    await tl.getByTestId('week-menu-open').click()
    await tl.getByTestId('week-jump').click()
    await tl.getByTestId('week-jump-date').fill(far)
    await expect(tl).toHaveURL(new RegExp(`on=${sundayOf(Date.parse(`${far}T00:00:00Z`))}`))
    await tl.getByTestId('nav-today').click()
    await expect(tl).not.toHaveURL(/on=/)
    expect(thisSunday < nextSunday).toBe(true)
    await tl.context().close()
  })

  test('MAY: the Design team lead books her own maker — days, hours, what it waits for — and the database has the assignment and the booking; another team is not on her Who', async ({ browser }) => {
    test.setTimeout(180_000)
    const { job, tasks } = await makeApprovedPiece(browser, `I74 Book own ${stamp}`)
    const [t1, t2] = tasks as [TaskRow, TaskRow]
    const maker = await resourceIdOf('maker')
    const animator = await resourceIdOf('animator')
    const d1 = workday(2)
    const d2 = nextWorkday(d1)

    const tl = await as(browser, 'tl')
    await openWindow(tl, job, maker, d1, t1.id)
    // I74.32 (Edward, 4 Oct): the person and the day clicked come in already chosen on every row.
    for (const t of [t1, t2]) await expect(tl.getByTestId(`book-who-${t.id}`)).toContainText(PEOPLE.maker.name)
    // A row books only with hours (isReady): give the second task one more hour so it books.
    await tl.getByTestId(`book-more-${t2.id}`).click()

    // Who: her team, most room first — the Motion animator is not offered (ADR-0139 d.1, d.6).
    await tl.getByTestId(`book-who-${t1.id}`).click()
    await expect(tl.getByTestId('book-who-list')).toBeVisible()
    await expect(tl.getByTestId(`book-who-list-${animator}`)).toHaveCount(0)
    await tl.getByTestId(`book-who-list-${maker}`).click()
    await expect(tl.getByTestId(`book-who-${t1.id}`)).toContainText(PEOPLE.maker.name)

    await pickDays(tl, t1.id, d1, d2)

    // Hours: +1, +1, −1 = one more than the task carried.
    const before = await tl.getByTestId(`book-hours-${t1.id}`).textContent()
    await tl.getByTestId(`book-more-${t1.id}`).click()
    await tl.getByTestId(`book-more-${t1.id}`).click()
    await tl.getByTestId(`book-less-${t1.id}`).click()
    await expect(tl.getByTestId(`book-hours-${t1.id}`)).not.toHaveText(before!)

    // What it waits for: the first starts any time; the second waits for the first.
    await tl.getByTestId(`book-waits-${t1.id}`).click()
    await tl.getByTestId('book-waits-none').check()
    await expect(tl.getByTestId('book-waits-none')).toBeChecked()
    await tl.keyboard.press('Escape')
    await tl.getByTestId(`book-waits-${t2.id}`).click()
    await tl.getByTestId(`book-waits-${t2.id}-${t1.id}`).check()
    await tl.keyboard.press('Escape')
    await expect(tl.getByTestId(`book-waits-${t2.id}`)).toContainText(t1.title)

    await chooseReviewer(tl, 'lead')
    await expect(tl.getByTestId('book-submit')).toBeEnabled()
    await tl.getByTestId('book-submit').click()
    await expect(tl.getByTestId('book-submit')).toHaveCount(0, { timeout: 30_000 })
    await expect(tl.getByTestId('schedule-toast')).toContainText(/Booked 2 tasks/)

    const makerId = await idOf('maker')
    await expect.poll(async () => (await taskRow(t1.id)).assignee_id, { timeout: 15_000 }).toBe(makerId)
    const booked = await taskRow(t1.id)
    expect(iraqDayOf(booked.starts_at!), 'starts on the first day picked').toBe(d1)
    expect(iraqDayOf(booked.due_at!), 'ends on the last day picked').toBe(d2)
    expect(Number(booked.sla_hours), 'one hour more than it carried').toBe(Number(t1.sla_hours ?? 0) + 1)
    await expect.poll(async () => (await bookingsOf(t1.id)).filter((b) => b.resource_id === maker && b.state === 'confirmed').length, { timeout: 20_000 }).toBeGreaterThan(0)
    const reviewers = await rows<{ user_id: string }>('sub_task_reviewers', `select=user_id&sub_task_id=eq.${t1.id}`)
    expect(reviewers.map((r) => r.user_id)).toContain(await idOf('lead'))
    const deps = await rows<{ depends_on_sub_task_id: string }>('sub_task_dependencies', `select=depends_on_sub_task_id&sub_task_id=eq.${t2.id}`)
    expect(deps.map((d) => d.depends_on_sub_task_id), 'the second waits for the first').toContain(t1.id)
    // A booking, not a request: nothing waits on anybody's answer.
    expect(await requestsOn(t1.id)).toEqual([])
    // The second came in with the clicked person and day (I74.32) and was booked with it.
    await expect.poll(async () => (await taskRow(t2.id)).assignee_id, { timeout: 15_000 }).toBe(makerId)
    await tl.context().close()
  })

  test('MAY: the Creative department lead gives every task to the Motion animator in one go — select, bulk give, apply — and Undo takes it all back; a Content writer is not on his Who', async ({ browser }) => {
    test.setTimeout(180_000)
    const { job, tasks } = await makeApprovedPiece(browser, `I74 Bulk ${stamp}`)
    const [t1, t2] = tasks as [TaskRow, TaskRow]
    const animator = await resourceIdOf('animator')
    const writer = await resourceIdOf('writer')
    const d1 = workday(3)

    const lead = await as(browser, 'lead')
    await openWindow(lead, job, animator, d1, t1.id)

    // One row ticked shows the bar; Clear takes it away.
    await lead.getByTestId(`book-select-${t1.id}`).check()
    await expect(lead.getByTestId('book-bulk')).toContainText('1')
    await lead.getByTestId('book-bulk-clear').click()
    await expect(lead.getByTestId('book-bulk')).toHaveCount(0)

    await lead.getByTestId('book-select-all').check()
    await expect(lead.getByTestId(`book-select-${t2.id}`)).toBeChecked()
    await expect(lead.getByTestId('book-bulk-apply')).toBeDisabled()
    await lead.getByTestId('book-bulk-who').click()
    await expect(lead.getByTestId(`book-bulk-who-list-${writer}`)).toHaveCount(0)
    await lead.getByTestId(`book-bulk-who-list-${animator}`).click()
    await lead.getByTestId('book-bulk-day').click()
    await lead.getByTestId(`book-bulk-day-picker-day-${d1}`).click()
    await lead.getByTestId('book-bulk-day-picker-done').click()
    await lead.getByTestId('book-bulk-apply').click()
    for (const t of tasks) await expect(lead.getByTestId(`book-who-${t.id}`)).toContainText(PEOPLE.animator.name)
    // The type's workflow gives its tasks no hours, and a task is given out only with its hours (E11): one each.
    for (const t of tasks) await lead.getByTestId(`book-more-${t.id}`).click()
    await expect(lead.getByTestId('book-submit')).toHaveText(new RegExp(`Book ${tasks.length} tasks`))

    await chooseReviewer(lead, 'tl')
    await lead.getByTestId('book-submit').click()
    await expect(lead.getByTestId('book-submit')).toHaveCount(0, { timeout: 45_000 })
    await expect(lead.getByTestId('schedule-toast')).toContainText(new RegExp(`Booked ${tasks.length} tasks`))

    const animatorId = await idOf('animator')
    for (const t of tasks) {
      await expect.poll(async () => (await taskRow(t.id)).assignee_id, { timeout: 15_000 }).toBe(animatorId)
      expect(await requestsOn(t.id), `${t.title} is booked, not asked`).toEqual([])
    }

    // Undo: every task goes back to To book.
    await lead.getByTestId('schedule-toast-undo').click()
    await expect(lead.getByTestId('schedule-toast')).toHaveCount(0, { timeout: 20_000 })
    for (const t of tasks) {
      await expect.poll(async () => (await taskRow(t.id)).assignee_id, { timeout: 15_000 }).toBeNull()
      await expect.poll(async () => (await bookingsOf(t.id)).filter((b) => b.state === 'confirmed').length).toBe(0)
    }
    await lead.context().close()
  })

  test('MAY NOT: the account manager books nobody — her pick of the maker is an ask to the Design team lead; nothing is booked, and the direct door asks too', async ({ browser }) => {
    test.setTimeout(180_000)
    const { job, tasks } = await makeApprovedPiece(browser, `I74 AM asks ${stamp}`)
    const [t1, t2] = tasks as [TaskRow, TaskRow]
    const maker = await resourceIdOf('maker')
    const d1 = workday(2)
    const needBy = nextWorkday(nextWorkday(d1))
    const note = `Please, the summer key visual ${stamp}`

    const am = await as(browser, 'am')
    await openWindow(am, job, maker, d1, t1.id)
    await am.getByTestId(`book-who-${t1.id}`).click()
    // Every pick is an ask, and the picker says so.
    await expect(am.getByTestId('book-who-list-ask-only')).toBeVisible()
    await am.getByTestId(`book-who-list-${maker}`).click()
    await expect(am.getByTestId(`book-ask-${t1.id}`)).toBeVisible()
    await expect(am.getByTestId(`book-who-${t1.id}`)).toContainText('Design')
    await am.getByTestId(`book-ask-${t1.id}-note`).fill(note)
    await am.getByTestId(`book-dates-${t1.id}`).click()
    await am.getByTestId(`book-ask-day-picker-day-${needBy}`).click()
    await am.getByTestId('book-ask-day-picker-done').click()

    // A task is asked for or given only with its hours (the workflow gives none): one each.
    await am.getByTestId(`book-more-${t1.id}`).click()
    await chooseReviewer(am, 'lead')
    await expect(am.getByTestId('book-submit')).toHaveText(/Send 1 ask/)
    await am.getByTestId('book-submit').click()
    await expect(am.getByTestId('book-submit')).toHaveCount(0, { timeout: 30_000 })
    await expect(am.getByTestId('schedule-toast')).toContainText(/asked Design for/)
    await am.context().close()

    // Nothing booked; one request waits, from her, for the maker, on Design.
    expect((await taskRow(t1.id)).assignee_id).toBeNull()
    expect(await bookingsOf(t1.id)).toEqual([])
    const [req, ...more] = await requestsOn(t1.id)
    expect(more).toEqual([])
    expect(req).toMatchObject({
      status: 'pending',
      requested_by: await idOf('am'),
      assignee_id: await idOf('maker'),
      team_id: DESIGN,
      needed_by: needBy,
      note,
    })
    // The Design Team Leader is the one asked (ADR-0139 d.3); the asker is not told of her own ask.
    const told = await toldAbout('assignment_requested', t1.id)
    expect(told).toContain(await idOf('tl'))
    expect(told).not.toContain(await idOf('am'))

    // The door the editors call, as her, straight to the maker: still an ask — never an assignment.
    const out = await rpcRaw('am', 'update_task_assignment', {
      p_sub_task: t2.id,
      p_title: t2.title,
      p_assignee: await idOf('maker'),
      p_reviewers: [{ user_id: await idOf('lead'), is_mandatory: true }],
      p_starts_at: `${d1}T06:00:00Z`,
      p_due_at: `${d1}T14:00:00Z`,
      p_hours: 2,
      p_review_mode: 'manual',
    })
    expect(out.status, out.text).toBeLessThan(300)
    expect((JSON.parse(out.text) as { outcome: string }[])[0]!.outcome).toBe('requested')
    expect((await taskRow(t2.id)).assignee_id).toBeNull()
    expect(await bookingsOf(t2.id)).toEqual([])
    expect((await requestsOn(t2.id))[0]).toMatchObject({ status: 'pending', requested_by: await idOf('am') })
  })

  test('MAY NOT: the Design team lead asks Motion ("anyone — their lead decides") while booking her maker in the same press; the Creative lead asks Content for the writer — each an ask to that team\'s lead', async ({ browser }) => {
    test.setTimeout(180_000)
    const { job, tasks } = await makeApprovedPiece(browser, `I74 Ask other ${stamp}`)
    const [t1, t2, t3] = tasks as [TaskRow, TaskRow, TaskRow]
    expect(t3, 'the type carries three tasks or more').toBeTruthy()
    const maker = await resourceIdOf('maker')
    const writer = await resourceIdOf('writer')
    const d1 = workday(4)

    // The team lead: t1 asked of Motion, t2 booked on her maker — "Book 1 task, send 1 ask".
    const tl = await as(browser, 'tl')
    await openWindow(tl, job, maker, d1, t1.id)
    await tl.getByTestId(`book-who-${t1.id}`).click()
    await tl.getByTestId('book-who-list-ask-other').click()
    await tl.getByTestId('book-who-list-ask-team').selectOption(MOTION)
    await tl.getByTestId('book-who-list-ask-anyone').click()
    await expect(tl.getByTestId(`book-ask-${t1.id}`)).toBeVisible()
    await tl.getByTestId(`book-who-${t2.id}`).click()
    await tl.getByTestId(`book-who-list-${maker}`).click()
    await pickDays(tl, t2.id, d1, d1)
    // A task is asked for or given only with its hours (the workflow gives none): one each.
    await tl.getByTestId(`book-more-${t1.id}`).click()
    await tl.getByTestId(`book-more-${t2.id}`).click()
    await chooseReviewer(tl, 'lead')
    await expect(tl.getByTestId('book-submit')).toHaveText(/Book 1 task, send 1 ask/)
    await tl.getByTestId('book-submit').click()
    await expect(tl.getByTestId('book-submit')).toHaveCount(0, { timeout: 30_000 })
    await expect(tl.getByTestId('schedule-toast')).toContainText(/Booked 1 task/)
    await expect(tl.getByTestId('schedule-toast')).toContainText(/asked Motion for/)
    await tl.context().close()

    expect((await taskRow(t1.id)).assignee_id, 'Motion\'s work is asked, not booked').toBeNull()
    expect(await bookingsOf(t1.id)).toEqual([])
    expect((await requestsOn(t1.id))[0]).toMatchObject({ status: 'pending', team_id: MOTION, assignee_id: null, requested_by: await idOf('tl') })
    expect(await toldAbout('assignment_requested', t1.id)).toContain(await idOf('motiontl'))
    await expect.poll(async () => (await taskRow(t2.id)).assignee_id, { timeout: 15_000 }).toBe(await idOf('maker'))

    // The direct door refuses to turn her own team into an ask: book them directly (hint book_directly).
    // With a reviewer on it (so the ask is otherwise well-formed), the refusal is about reach alone.
    await rpcAs('tl', 'save_sub_task', {
      p_sub_task: t3.id, p_deliverable: t3.deliverable_id, p_title: t3.title,
      p_reviewers: [{ user_id: await idOf('lead'), is_mandatory: true }],
    })
    const own = await rpcRaw('tl', 'request_task_booking', { p_sub_task: t3.id, p_team: DESIGN, p_assignee: await idOf('maker') })
    expect(own.status).toBeGreaterThanOrEqual(400)
    expect(own.text).toMatch(/book_directly|book them directly/)
    expect(await requestsOn(t3.id)).toEqual([])

    // The department lead: Content's writer is not on his Who; he asks Copy for her.
    const lead = await as(browser, 'lead')
    await openWindow(lead, job, await resourceIdOf('animator'), d1, t3.id)
    await lead.getByTestId(`book-who-${t3.id}`).click()
    await expect(lead.getByTestId(`book-who-list-${writer}`)).toHaveCount(0)
    await lead.getByTestId('book-who-list-ask-other').click()
    await lead.getByTestId('book-who-list-ask-team').selectOption(COPY)
    await lead.getByTestId(`book-who-list-ask-${writer}`).click()
    await expect(lead.getByTestId(`book-ask-${t3.id}`)).toBeVisible()
    // A task is asked for or given only with its hours (the workflow gives none): one each.
    await lead.getByTestId(`book-more-${t3.id}`).click()
    await chooseReviewer(lead, 'tl')
    await lead.getByTestId('book-submit').click()
    await expect(lead.getByTestId('book-submit')).toHaveCount(0, { timeout: 30_000 })
    await expect(lead.getByTestId('schedule-toast')).toContainText(/asked Copy for/)
    await lead.context().close()

    expect((await taskRow(t3.id)).assignee_id).toBeNull()
    expect(await bookingsOf(t3.id)).toEqual([])
    expect((await requestsOn(t3.id))[0]).toMatchObject({ status: 'pending', team_id: COPY, assignee_id: await idOf('writer'), requested_by: await idOf('lead') })
    // Copy's Team Leader answers — not the Content department lead (ADR-0139 d.3).
    const told = await toldAbout('assignment_requested', t3.id)
    expect(told).toContain(await idOf('copytl'))
    expect(told).not.toContain(await idOf('content'))
  })

  test('the window\'s other controls: brief and files tabs, a link added and opened, a file uploaded; rows removed, undone, added from the workflow and named — and Cancel / ✕ write nothing', async ({ browser }) => {
    test.setTimeout(180_000)
    const { job, tasks } = await makeApprovedPiece(browser, `I74 Window ${stamp}`)
    const first = tasks[0]!
    const last = tasks[tasks.length - 1]!
    const [lastRow] = await rows<{ workflow_step_id: string | null }>('sub_tasks', `select=workflow_step_id&id=eq.${last.id}`)
    expect(lastRow!.workflow_step_id, 'the type\'s tasks come from its workflow').not.toBeNull()
    const [folder] = await rows<{ id: string }>('asset_folders', `select=id&deliverable_id=eq.${job.deliverableId}&kind=eq.deliverable`)
    expect(folder, 'the piece has its own Library folder (ADR-0134 d.22)').toBeTruthy()
    const maker = await resourceIdOf('maker')
    const d1 = workday(2)

    const tl = await as(browser, 'tl')
    await standInForTheBucket(tl)
    await openWindow(tl, job, maker, d1, first.id)

    // Brief (read only) and Files.
    await tl.getByTestId('book-tab-brief').click()
    await expect(tl.getByTestId('book-brief')).toContainText(job.title)
    await tl.getByTestId('book-tab-files').click()
    await expect(tl.getByTestId('book-files')).toBeVisible()

    // Add a link: Cancel first, then for real — the row is in the piece's folder.
    await tl.getByTestId('book-files-add-link').click()
    await expect(tl.getByTestId('book-files-link-form')).toBeVisible()
    await tl.getByTestId('book-files-link-cancel').click()
    await expect(tl.getByTestId('book-files-link-form')).toHaveCount(0)
    const linkName = `Working file ${stamp}`
    const linkUrl = `https://drive.example.com/file/${stamp}`
    await tl.getByTestId('book-files-add-link').click()
    await tl.getByTestId('book-files-link-url').fill(linkUrl)
    await tl.getByTestId('book-files-link-name').fill(linkName)
    await tl.getByTestId('book-files-link-add').click()
    await expect(tl.getByTestId('book-files-link-form')).toHaveCount(0)
    await expect.poll(async () => (await rows('assets', `select=id&folder_id=eq.${folder!.id}&name=eq.${encodeURIComponent(linkName)}&deleted_at=is.null`)).length).toBe(1)
    const [link] = await rows<{ id: string; link_url: string }>('assets', `select=id,link_url&folder_id=eq.${folder!.id}&name=eq.${encodeURIComponent(linkName)}`)
    expect(link!.link_url).toBe(linkUrl)
    // The address is made up; the network edge answers it, so the new tab lands on it rather than on an error page.
    await tl.context().route('https://drive.example.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: 'the working file' }))
    const popup = tl.context().waitForEvent('page')
    await tl.getByTestId(`book-file-open-${link!.id}`).click()
    const opened = await popup
    await opened.waitForLoadState()
    expect(opened.url()).toBe(linkUrl)

    // Upload a file: the button opens the chooser; the hidden input takes a second file directly.
    const chooser = tl.waitForEvent('filechooser')
    await tl.getByTestId('book-files-upload').click()
    await (await chooser).setFiles({ name: `brief-${stamp}.txt`, mimeType: 'text/plain', buffer: Buffer.from('one') })
    await tl.getByTestId('book-files-input').setInputFiles({ name: `notes-${stamp}.txt`, mimeType: 'text/plain', buffer: Buffer.from('two') })
    await expect.poll(async () => (await rows('assets', `select=id&folder_id=eq.${folder!.id}&name=in.(brief-${stamp}.txt,notes-${stamp}.txt)&deleted_at=is.null`)).length, { timeout: 30_000 }).toBe(2)

    // The upload box stands in front until Done (the uploads carry on in the corner).
    await expect(tl.getByTestId('upload-box-list')).toContainText(`notes-${stamp}.txt`)
    await tl.getByTestId('upload-box-done').click()
    await expect(tl.getByTestId('upload-box-done')).toHaveCount(0)

    // Back to the tasks: remove the last row, Undo, remove it again; its workflow step is offered back.
    await tl.getByTestId('book-tab-tasks').click()
    await tl.getByTestId(`book-remove-${last.id}`).click()
    await expect(tl.getByTestId(`book-row-${last.id}`)).toHaveCount(0)
    await tl.getByTestId('book-undo-button').click()
    await expect(tl.getByTestId(`book-row-${last.id}`)).toBeVisible()
    await tl.getByTestId(`book-remove-${last.id}`).click()
    await tl.getByTestId('book-add-task').click()
    await tl.getByTestId(`book-add-step-${lastRow!.workflow_step_id}`).click()
    // Added back from the workflow, the row carries the step's own name ("Create Artwork"), not the piece-suffixed title.
    await expect(tl.getByTestId('book-row-new:1')).toContainText(last.title.split(' — ')[0]!)
    // A task of your own: named on its row.
    const own = `Own check ${stamp}`
    await tl.getByTestId('book-add-task').click()
    await tl.getByTestId('book-add-own').click()
    await tl.getByTestId('book-name-new:2').fill(own)
    await tl.getByTestId('book-name-new:2').press('Enter')
    await expect(tl.getByTestId('book-name-new:2')).toHaveCount(0)
    await expect(tl.getByTestId('book-row-new:2')).toContainText(own)

    // Cancel: nothing written — the removed task stands, the added ones were never made.
    await tl.getByTestId('book-cancel').click()
    await expect(tl.getByTestId('book-submit')).toHaveCount(0)
    expect((await taskRow(last.id)).status).not.toBe('cancelled')
    expect(await rows('sub_tasks', `select=id&deliverable_id=eq.${job.deliverableId}&title=eq.${encodeURIComponent(own)}`)).toEqual([])
    expect((await rows('sub_tasks', `select=id&deliverable_id=eq.${job.deliverableId}&status=neq.cancelled`)).length).toBe(tasks.length)

    // The ✕ closes it too, still writing nothing.
    // Cancel closes the window and leaves the piece picked, so a day is clicked again straight away.
    await expect(tl.getByTestId('schedule-picked')).toBeVisible()
    await expect(tl.getByTestId(`to-book-${job.deliverableId}`)).toHaveAttribute('aria-pressed', 'true')
    await tl.getByTestId(`cell-${maker}-${d1}`).click({ position: { x: 4, y: 4 } })
    await expect(tl.getByTestId(`book-row-${first.id}`)).toBeVisible({ timeout: 15_000 })
    await tl.getByTestId('book-tasks-close').click()
    await expect(tl.getByTestId('book-submit')).toHaveCount(0)
    for (const t of tasks) expect((await taskRow(t.id)).assignee_id).toBeNull()
    await tl.context().close()
  })

  test('I74.28: the deliverable\'s owner adds a link on its Files tab at the first press — with no task of the client in her team — and it lands in its own folder; a team member is refused and nothing is written', async ({ browser }) => {
    test.setTimeout(180_000)
    // Luma Retail (am2's client): the Design team holds no task of it, so the owner's only standing is owning it.
    const am2 = await as(browser, 'am2')
    const job = await releaseSingleJob(am2, {
      title: `I74 Owner files ${stamp}`, department: 'Creative', type: 'Social Advertisement', client: 'Luma Retail', ownerPick: PEOPLE.tl.name,
    })
    await am2.context().close()
    expect(job.ownerUserId, 'the Design team lead owns the deliverable').toBe(await idOf('tl'))
    const tlPage = await as(browser, 'tl')
    await approveTaskList(tlPage, job)
    await tlPage.context().close()
    const tasks = await rows<{ id: string }>('sub_tasks', `select=id&deliverable_id=eq.${job.deliverableId}&status=neq.cancelled&order=sort_order`)
    const [folder] = await rows<{ id: string; client_id: string; parent_id: string }>('asset_folders', `select=id,client_id,parent_id&deliverable_id=eq.${job.deliverableId}&kind=eq.deliverable`)
    expect(folder, 'the deliverable has its own Library folder (ADR-0134 d.22)').toBeTruthy()
    // The point of the test: the reach rule alone would refuse her here.
    expect(await rpcAs<boolean>('tl', 'library_can_change', { p_client: folder!.client_id }), 'the client is outside her d.2 reach').toBe(false)

    const tl = await as(browser, 'tl')
    await openWindow(tl, job, await resourceIdOf('maker'), workday(2), tasks[0]!.id)
    await tl.getByTestId('book-tab-files').click()
    await expect(tl.getByTestId('book-files-upload')).toBeVisible()
    await expect(tl.getByTestId('book-files-add-link')).toBeVisible()
    const linkName = `Owner link ${stamp}`
    await tl.getByTestId('book-files-add-link').click()
    await tl.getByTestId('book-files-link-url').fill(`https://drive.example.com/file/owner-${stamp}`)
    await tl.getByTestId('book-files-link-name').fill(linkName)
    await tl.getByTestId('book-files-link-add').click()
    await expect(tl.getByTestId('book-files-link-form')).toHaveCount(0)
    await expect(tl.getByTestId('book-files-error')).toHaveCount(0)
    await expect(tl.getByTestId('book-files')).toContainText(linkName)
    const added = await rows<{ folder_id: string; deliverable_id: string; uploaded_by: string }>('assets', `select=folder_id,deliverable_id,uploaded_by&name=eq.${encodeURIComponent(linkName)}&deleted_at=is.null`)
    expect(added).toEqual([{ folder_id: folder!.id, deliverable_id: job.deliverableId, uploaded_by: await idOf('tl') }])
    await tl.getByTestId('book-cancel').click()
    await tl.context().close()

    // Only that folder: the Deliverables folder above it is refused to her, and nothing is written.
    const above = await rpcRaw('tl', 'library_add_link', { p_folder: folder!.parent_id, p_name: `Above ${stamp}`, p_url: 'https://x.example.com/a', p_expires_on: null })
    expect(above.status, above.text).toBeGreaterThanOrEqual(400)
    expect(above.text).toContain('you cannot change this client')

    // A team member (no task of this client): the server refuses her in the owner's folder, in words; no row.
    const refused = await rpcRaw('maker', 'library_add_link', { p_folder: folder!.id, p_name: `Maker ${stamp}`, p_url: 'https://x.example.com/m', p_expires_on: null })
    expect(refused.status, refused.text).toBeGreaterThanOrEqual(400)
    expect(refused.text).toContain('you cannot change this client')
    expect(await rows('assets', `select=id&name=in.(${encodeURIComponent(`Maker ${stamp}`)},${encodeURIComponent(`Above ${stamp}`)})`)).toEqual([])
  })
})
