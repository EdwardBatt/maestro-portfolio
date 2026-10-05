import { test, expect, type Page } from '@playwright/test'
import { rows } from '../helpers/db'
import {
  PEOPLE,
  as,
  bookingsOf,
  day,
  idOf,
  makeApprovedPiece,
  resourceIdOf,
  restAs,
  rpcAs,
  rpcRaw,
  taskRow,
  toldAbout,
  workday,
  type TaskRow,
} from '../helpers/i74'
import type { ReleasedJob } from '../helpers/single-job'

/**
 * Coverage — asks between teams (ADR-0139 d.2–d.4; I74.2–I74.4, I74.26; Figma L SC-18/19/28–30).
 *
 * The account manager (Inas Azmi in the demo data, `am`) asks the Design team for tasks on two released Creative
 * pieces — through `request_task_booking`, the door the booking window's "Ask another team" calls, signed in as her.
 * Then every control around an ask is pressed:
 *
 *   ALLOWED  the Design Team Leader (Nour, `tl`) books an ask from the Schedule's answer window — person, days and
 *            hours — and the task is hers to give: the request is approved, the task assigned, a booking placed, the
 *            asker told; she offers another day and the asker takes it; she says no (with a reason — a bare "no" is
 *            refused on the window), from the Schedule and from My work; the asker sees each answer on her Schedule
 *            ("Asked of other teams") and on the grid's ⏳ row, withdraws a waiting ask (card and See-the-ask), asks
 *            again after an offer, asks another team / does it in her own after a no.
 *   REFUSED  another team's lead (Basheer, `motiontl`) and the Creative department lead (Fadia, `lead`) are not
 *            offered the ask and are refused `not_the_answerer` by the server; the asker cannot answer her own ask;
 *            the Deputy (Ismail, `deputy`) is neither told nor offered nor allowed while the Team Leader is at work —
 *            and IS asked, and answers, once the Team Leader is on leave that day (d.3). Every refusal leaves the
 *            request pending and the task unassigned.
 *
 * Leave for the Team Leader is written as the Leave page writes it (`resource_unavailability`, as the Power Admin),
 * removed at the start and the end.
 */
test.use({ actionTimeout: 15_000 })
test.describe.configure({ mode: 'serial' })

const DESIGN = 'd0000000-0000-4000-8000-00000000d101'
const TENANT = 'd0000000-0000-4000-8000-000000000001'
const LEAVE_REASON = 'e2e schedule-asks: the Team Leader is away'

interface AskRow {
  id: string
  status: string
  team_id: string | null
  assignee_id: string | null
  hours: number | null
  needed_by: string | null
  note: string | null
  answered_by: string | null
  answer_note: string | null
  offered_starts_at: string | null
  offered_ends_at: string | null
}
const askRow = async (id: string): Promise<AskRow> => {
  const [r] = await rows<AskRow>(
    'sub_task_assignment_requests',
    `select=id,status,team_id,assignee_id,hours,needed_by,note,answered_by,answer_note,offered_starts_at,offered_ends_at&id=eq.${id}`,
  )
  expect(r, `request ${id} exists`).toBeTruthy()
  return r!
}
/** The asker asks Design for a task — the door "Ask another team" calls, as her. Returns the request id. */
async function ask(task: TaskRow, opts: { person?: 'maker' | null; hours?: number; neededBy: string; note: string }): Promise<string> {
  // As the booking window does (BookTasksDialog, ADR-0139 d.2): the ask carries who checks the task, and the lead's
  // booking writes it onto the task (I74.53) — the asker does not edit the task.
  const id = await rpcAs<string>('am', 'request_task_booking', {
    p_sub_task: task.id,
    p_team: DESIGN,
    p_assignee: opts.person ? await idOf(opts.person) : null,
    p_hours: opts.hours ?? 2,
    p_needed_by: opts.neededBy,
    p_note: opts.note,
    p_reviewers: [{ user_id: await idOf('lead'), is_mandatory: true }],
  })
  expect(typeof id).toBe('string')
  expect((await askRow(id)).status).toBe('pending')
  return id
}
/** Nothing changed: still pending, nobody answered, the task still unassigned and unbooked. */
async function untouched(requestId: string, taskId: string) {
  const r = await askRow(requestId)
  expect(r.status).toBe('pending')
  expect(r.answered_by).toBeNull()
  expect((await taskRow(taskId)).assignee_id).toBeNull()
  expect(await bookingsOf(taskId)).toEqual([])
}
/** A page that has read its list of asks to answer (`my_pending_approvals`) — so an absence means something. */
async function openAfterAsksLoad(page: Page, url: string) {
  const read = page.waitForResponse((r) => r.url().includes('/rpc/my_pending_approvals') && r.ok(), { timeout: 30_000 })
  await page.goto(url)
  await read
  await page.waitForLoadState('networkidle')
}
async function pendingFor(tag: 'tl' | 'motiontl' | 'lead' | 'deputy'): Promise<string[]> {
  const list = await rpcAs<{ kind: string; id: string }[]>(tag, 'my_pending_approvals', {})
  return list.filter((x) => x.kind === 'booking_request').map((x) => x.id)
}
/** Who was told about THIS request (the notification carries its id) — earlier asks on the same task do not count. */
async function askedOf(requestId: string): Promise<string[]> {
  const n = await rows<{ user_id: string }>('notifications', `select=user_id&type=eq.assignment_requested&detail->>request_id=eq.${requestId}`)
  return n.map((x) => x.user_id)
}
async function clearLeave() {
  const res = await restAs('admin', 'DELETE', 'resource_unavailability', `reason=eq.${encodeURIComponent(LEAVE_REASON)}`)
  expect(res.status, res.text).toBeLessThan(300)
}

let A: { job: ReleasedJob; tasks: TaskRow[] }
let B: { job: ReleasedJob; tasks: TaskRow[] }
const neededBy = workday(10)
const otherDay = workday(13)

test.describe('Asks between teams (ADR-0139)', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000)
    await clearLeave()
    const stamp = Date.now()
    A = await makeApprovedPiece(browser, `Asks A ${stamp}`)
    B = await makeApprovedPiece(browser, `Asks B ${stamp}`)
    expect(A.tasks.length, 'piece A has four tasks to ask about').toBeGreaterThanOrEqual(4)
    expect(B.tasks.length, 'piece B has three tasks to ask about').toBeGreaterThanOrEqual(3)
  })
  test.afterAll(async () => {
    await clearLeave()
  })

  let a1: string

  test('the ask reaches the Design Team Leader only; the asker sees it waiting on her Schedule and on the grid', async ({ browser }) => {
    const t1 = A.tasks[0]!
    a1 = await ask(t1, { person: 'maker', hours: 3, neededBy, note: 'Needs the summer palette.' })
    const r = await askRow(a1)
    expect(r).toMatchObject({ team_id: DESIGN, assignee_id: await idOf('maker'), needed_by: neededBy, note: 'Needs the summer palette.' })
    // d.3: the Team Leader is told — not the Deputy, not the department lead, never the asker.
    const told = await askedOf(a1)
    expect(told).toContain(await idOf('tl'))
    for (const tag of ['deputy', 'lead', 'motiontl', 'am'] as const) expect(told, `${tag} is not asked`).not.toContain(await idOf(tag))

    const am = await as(browser, 'am')
    await am.goto(`/schedule?on=${neededBy}`)
    // The ⏳ chip on the "Other teams" row, on the day it is needed.
    await am.getByTestId(`ask-chip-${a1}`).click()
    await expect(am.getByTestId('see-ask')).toBeVisible()
    await expect(am.getByTestId('see-ask')).toContainText(PEOPLE.maker.name)
    await expect(am.getByTestId('see-ask')).toContainText('Design')
    await am.getByTestId('see-ask-close').click()
    await expect(am.getByTestId('see-ask')).toHaveCount(0)
    // The card's "See the ask", then OK.
    await am.getByTestId(`ask-see-${a1}`).click()
    await expect(am.getByTestId('see-ask')).toBeVisible()
    await am.getByTestId('see-ask-done').click()
    await expect(am.getByTestId('see-ask')).toHaveCount(0)
    await am.context().close()
    await untouched(a1, t1.id)
  })

  test('may NOT answer: another team\'s lead, the department lead, the Deputy (leader at work) and the asker herself', async ({ browser }) => {
    const t1 = A.tasks[0]!
    const book = { p_request: a1, p_answer: 'book', p_assignee: await idOf('maker'), p_starts_at: `${neededBy}T06:00:00Z`, p_due_at: `${neededBy}T14:00:00Z`, p_hours: 3 }

    // Not offered: the Motion lead's Schedule and My work have no card for it, and the server's list agrees.
    expect(await pendingFor('motiontl')).not.toContain(a1)
    const motion = await as(browser, 'motiontl')
    await openAfterAsksLoad(motion, '/schedule')
    await expect(motion.getByTestId(`ask-from-${a1}`)).toHaveCount(0)
    await openAfterAsksLoad(motion, '/my-work')
    await expect(motion.getByTestId(`my-work-ask-${a1}`)).toHaveCount(0)
    await motion.context().close()
    // Refused in words.
    for (const tag of ['motiontl', 'lead', 'deputy'] as const) {
      const res = await rpcRaw(tag, 'answer_task_request', book)
      expect(res.status, `${tag}: ${res.text}`).toBe(403)
      expect(res.text).toContain('not_the_answerer')
      expect(res.text).toMatch(/answered by the lead of the team asked/)
    }
    // The Deputy is not offered it either while the Team Leader is at work.
    expect(await pendingFor('deputy')).not.toContain(a1)
    const deputy = await as(browser, 'deputy')
    await openAfterAsksLoad(deputy, '/schedule')
    await expect(deputy.getByTestId(`ask-from-${a1}`)).toHaveCount(0)
    await deputy.context().close()

    // The asker cannot answer her own ask.
    const own = await rpcRaw('am', 'answer_task_request', book)
    expect(own.status, own.text).toBe(403)
    expect(own.text).toMatch(/cannot answer your own request/)

    await untouched(a1, t1.id)
  })

  test('the Team Leader books it from the Schedule — the person, the days and the hours she sets; the asker is told', async ({ browser }) => {
    const t1 = A.tasks[0]!
    expect(await pendingFor('tl')).toContain(a1)
    const tl = await as(browser, 'tl')
    await tl.goto(`/schedule?on=${neededBy}`)
    // Opened and closed once, then answered.
    await tl.getByTestId(`ask-from-${a1}`).click()
    await expect(tl.getByTestId('answer-ask')).toBeVisible()
    await tl.getByTestId('answer-ask-close').click()
    await expect(tl.getByTestId('answer-ask')).toHaveCount(0)
    await tl.getByTestId(`ask-from-${a1}`).click()
    const dlg = tl.getByTestId('answer-ask')
    await expect(dlg).toContainText('Needs the summer palette.')
    // The brief and the files go with the ask.
    await tl.getByTestId('answer-ask-brief').click()
    await expect(dlg.locator('[data-testid="book-brief"], [data-testid="book-brief-none"]')).toHaveCount(1)
    await tl.getByTestId('answer-ask-files').click()
    await expect(dlg.locator('[data-testid="book-files"], [data-testid="book-files-none"]')).toHaveCount(1)
    // Who: the person asked for is already chosen; pick her again from the list.
    const makerRes = await resourceIdOf('maker')
    await tl.getByTestId('answer-ask-who').click()
    await tl.getByTestId(`answer-ask-who-list-${makerRes}`).click()
    await expect(tl.getByTestId('answer-ask-who')).toContainText(PEOPLE.maker.name)
    // Days: from and to the day asked.
    await tl.getByTestId('answer-ask-from').fill(neededBy)
    await tl.getByTestId('answer-ask-to').fill(neededBy)
    await expect(tl.getByTestId('answer-ask-day-ok')).toBeVisible()
    // Hours: 3 asked, +2 −1 = 4.
    await tl.getByTestId('answer-ask-more').click()
    await tl.getByTestId('answer-ask-more').click()
    await tl.getByTestId('answer-ask-less').click()
    await expect(tl.getByTestId('answer-ask-hours')).toContainText('4')
    await tl.getByTestId('answer-ask-book').click()
    await expect(dlg).toHaveCount(0, { timeout: 20_000 })
    await expect(tl.getByTestId('schedule-toast')).toBeVisible()
    await expect(tl.getByTestId(`ask-from-${a1}`)).toHaveCount(0)
    await tl.context().close()

    const r = await askRow(a1)
    expect(r).toMatchObject({ status: 'approved', answered_by: await idOf('tl'), assignee_id: await idOf('maker') })
    expect(Number(r.hours)).toBe(4)
    expect((await taskRow(t1.id)).assignee_id).toBe(await idOf('maker'))
    await expect.poll(async () => (await bookingsOf(t1.id)).filter((b) => b.state === 'confirmed').length, { timeout: 20_000 }).toBeGreaterThan(0)
    expect(await toldAbout('assignment_approved', t1.id)).toContain(await idOf('am'))

    // A second answer is refused — the first settled it.
    const again = await rpcRaw('tl', 'answer_task_request', { p_request: a1, p_answer: 'refuse', p_note: 'late' })
    expect(again.status).toBe(400)
    expect(again.text).toContain('request_settled')

    // The asker's card says Booked; OK puts it away.
    const am = await as(browser, 'am')
    await am.goto('/schedule')
    await am.getByTestId(`ask-ok-${a1}`).click()
    await expect(am.getByTestId(`ask-sent-${a1}`)).toHaveCount(0)
    await am.context().close()
  })

  test('an offer of another day: the Team Leader offers, nothing is booked; the asker takes it and it is booked', async ({ browser }) => {
    const t2 = A.tasks[1]!
    const a2 = await ask(t2, { person: null, hours: 2, neededBy, note: 'Any designer will do.' })
    const tl = await as(browser, 'tl')
    await tl.goto(`/schedule?on=${neededBy}`)
    await tl.getByTestId(`ask-from-${a2}`).click()
    // An offer names a person.
    await tl.getByTestId('answer-ask-who').click()
    await tl.getByTestId(`answer-ask-who-list-${await resourceIdOf('maker')}`).click()
    await tl.getByTestId('answer-ask-from').fill(otherDay)
    await tl.getByTestId('answer-ask-to').fill(otherDay)
    await expect(tl.getByTestId('answer-ask-day-off')).toBeVisible()
    await tl.getByTestId('answer-ask-offer').click()
    await expect(tl.getByTestId('answer-ask')).toHaveCount(0, { timeout: 20_000 })
    await tl.context().close()

    const offered = await askRow(a2)
    expect(offered).toMatchObject({ status: 'offered', answered_by: await idOf('tl'), assignee_id: await idOf('maker') })
    expect(offered.offered_ends_at).not.toBeNull()
    expect((await taskRow(t2.id)).assignee_id, 'an offer books nothing').toBeNull()
    expect(await bookingsOf(t2.id)).toEqual([])
    expect(await toldAbout('assignment_offered', t2.id)).toContain(await idOf('am'))

    // Only the asker takes an offer.
    const notHers = await rpcRaw('tl', 'take_task_offer', { p_request: a2 })
    expect(notHers.status).toBe(403)
    expect((await askRow(a2)).status).toBe('offered')

    const am = await as(browser, 'am')
    await am.goto('/schedule')
    await am.getByTestId(`ask-take-${a2}`).click()
    await expect(am.getByTestId('schedule-toast')).toBeVisible({ timeout: 20_000 })
    await am.context().close()
    expect((await askRow(a2)).status).toBe('approved')
    expect((await taskRow(t2.id)).assignee_id).toBe(await idOf('maker'))
    await expect.poll(async () => (await bookingsOf(t2.id)).filter((b) => b.state === 'confirmed').length, { timeout: 20_000 }).toBeGreaterThan(0)
    expect(await toldAbout('assignment_offer_taken', t2.id)).toContain(await idOf('tl'))
  })

  test('after an offer the asker asks again: the offer is withdrawn and the piece\'s booking window opens', async ({ browser }) => {
    const t3 = A.tasks[2]!
    const a3 = await ask(t3, { person: 'maker', hours: 2, neededBy, note: 'Third task.' })
    await rpcAs('tl', 'answer_task_request', {
      p_request: a3, p_answer: 'offer', p_assignee: await idOf('maker'),
      p_starts_at: `${otherDay}T06:00:00Z`, p_due_at: `${otherDay}T14:00:00Z`, p_hours: 2,
    })
    expect((await askRow(a3)).status).toBe('offered')
    const am = await as(browser, 'am')
    await am.goto('/schedule')
    await am.getByTestId(`ask-again-${a3}`).click()
    await expect(am.getByTestId('book-tasks')).toBeVisible({ timeout: 20_000 })
    await am.getByTestId('book-tasks-close').click()
    await expect(am.getByTestId('book-tasks')).toHaveCount(0)
    await am.context().close()
    expect((await askRow(a3)).status).toBe('withdrawn')
    expect((await taskRow(t3.id)).assignee_id).toBeNull()
    expect(await toldAbout('assignment_withdrawn', t3.id), 'the lead who offered is told').toContain(await idOf('tl'))
  })

  test('the asker withdraws a waiting ask — from its card, and from See the ask', async ({ browser }) => {
    const t3 = A.tasks[2]!
    const t4 = A.tasks[3]!
    const w1 = await ask(t3, { person: null, neededBy, note: 'Withdrawn from the card.' })
    const w2 = await ask(t4, { person: null, neededBy, note: 'Withdrawn from See the ask.' })
    const am = await as(browser, 'am')
    await am.goto('/schedule')
    await am.getByTestId(`ask-withdraw-${w1}`).click()
    await expect(am.getByTestId(`ask-sent-${w1}`)).toHaveCount(0, { timeout: 20_000 })
    await am.getByTestId(`ask-see-${w2}`).click()
    await am.getByTestId('see-ask-withdraw').click()
    await expect(am.getByTestId('see-ask')).toHaveCount(0)
    await expect(am.getByTestId(`ask-sent-${w2}`)).toHaveCount(0, { timeout: 20_000 })
    await am.context().close()
    expect((await askRow(w1)).status).toBe('withdrawn')
    expect((await askRow(w2)).status).toBe('withdrawn')
    expect(await toldAbout('assignment_withdrawn', t4.id)).toContain(await idOf('tl'))
    expect((await taskRow(t3.id)).assignee_id).toBeNull()
    expect((await taskRow(t4.id)).assignee_id).toBeNull()
  })

  test('the Team Leader says no from the Schedule — a reason is required; the asker asks another team', async ({ browser }) => {
    const t = B.tasks[0]!
    const n1 = await ask(t, { person: 'maker', neededBy, note: 'Can Zubaida take it?' })
    const tl = await as(browser, 'tl')
    await tl.goto(`/schedule?on=${neededBy}`)
    await tl.getByTestId(`ask-from-${n1}`).click()
    await tl.getByTestId('answer-ask-no').click()
    await tl.getByTestId('answer-ask-no-cancel').click()
    await expect(tl.getByTestId('answer-ask-reason')).toHaveCount(0)
    await tl.getByTestId('answer-ask-no').click()
    // No reason — refused on the window, nothing sent.
    await tl.getByTestId('answer-ask-no-send').click()
    await expect(tl.getByTestId('answer-ask-error')).toBeVisible()
    await untouched(n1, t.id)
    await tl.getByTestId('answer-ask-reason').fill('Design is full until the launch.')
    await tl.getByTestId('answer-ask-no-send').click()
    await expect(tl.getByTestId('answer-ask')).toHaveCount(0, { timeout: 20_000 })
    await tl.context().close()

    expect(await askRow(n1)).toMatchObject({ status: 'refused', answered_by: await idOf('tl'), answer_note: 'Design is full until the launch.' })
    expect((await taskRow(t.id)).assignee_id).toBeNull()
    expect(await bookingsOf(t.id)).toEqual([])
    expect(await toldAbout('assignment_refused', t.id)).toContain(await idOf('am'))

    const am = await as(browser, 'am')
    await am.goto('/schedule')
    await expect(am.getByTestId(`ask-sent-${n1}`)).toContainText('Design is full until the launch.')
    await am.getByTestId(`ask-other-${n1}`).click()
    await expect(am.getByTestId('book-tasks')).toBeVisible({ timeout: 20_000 })
    await am.getByTestId('book-tasks-close').click()
    await expect(am.getByTestId(`ask-sent-${n1}`)).toHaveCount(0)
    await am.context().close()
  })

  test('My work: the ask is on top; Answer opens it on the Schedule, the brief opens the piece, Say no answers it', async ({ browser }) => {
    const t = B.tasks[1]!
    const n2 = await ask(t, { person: null, neededBy, note: 'For the My work card.' })
    const tl = await as(browser, 'tl')
    await tl.goto('/my-work')
    await expect(tl.getByTestId(`my-work-ask-${n2}`)).toBeVisible({ timeout: 20_000 })
    await tl.getByTestId(`my-work-ask-answer-${n2}`).click()
    await expect(tl).toHaveURL(/\/schedule/)
    await expect(tl.getByTestId('answer-ask')).toBeVisible({ timeout: 20_000 })
    await expect(tl.getByTestId('answer-ask')).toContainText(t.title)
    await tl.getByTestId('answer-ask-close').click()

    await tl.goto('/my-work')
    await tl.getByTestId(`my-work-ask-brief-${n2}`).click()
    await expect(tl).toHaveURL(new RegExp(`/campaigns/${B.job.campaignId}\\?.*piece=${B.job.deliverableId}`), { timeout: 20_000 })

    await tl.goto('/my-work')
    await tl.getByTestId(`my-work-ask-no-${n2}`).click()
    await tl.getByTestId(`my-work-ask-no-cancel-${n2}`).click()
    await expect(tl.getByTestId(`my-work-ask-reason-${n2}`)).toHaveCount(0)
    await tl.getByTestId(`my-work-ask-no-${n2}`).click()
    await tl.getByTestId(`my-work-ask-reason-${n2}`).fill('Not this week.')
    await tl.getByTestId(`my-work-ask-no-send-${n2}`).click()
    await expect(tl.getByTestId(`my-work-ask-${n2}`)).toHaveCount(0, { timeout: 20_000 })
    await tl.context().close()
    expect(await askRow(n2)).toMatchObject({ status: 'refused', answered_by: await idOf('tl'), answer_note: 'Not this week.' })

    // The asker does it in her own team instead: the booking window opens on the piece.
    const am = await as(browser, 'am')
    await am.goto('/schedule')
    await am.getByTestId(`ask-own-${n2}`).click()
    await expect(am.getByTestId('book-tasks')).toBeVisible({ timeout: 20_000 })
    await am.getByTestId('book-tasks-close').click()
    await expect(am.getByTestId(`ask-sent-${n2}`)).toHaveCount(0)
    await am.context().close()
    expect((await taskRow(t.id)).assignee_id).toBeNull()
  })

  test('the other doors to the same answer: the grid request chip and the bell open the answer window', async ({ browser }) => {
    const t = B.tasks[2]!
    const day1 = workday(11)
    // As the window does: the ask names who checks it (I74.53).
    const r1 = await rpcAs<string>('am', 'request_task_booking', {
      p_sub_task: t.id, p_team: DESIGN, p_assignee: await idOf('maker'), p_hours: 2, p_needed_by: day1,
      p_starts_at: `${day1}T06:00:00Z`, p_due_at: `${day1}T14:00:00Z`, p_note: 'From the chip and the bell.',
      p_reviewers: [{ user_id: await idOf('lead'), is_mandatory: true }],
    })
    expect(await askedOf(r1)).toContain(await idOf('tl'))
    const tl = await as(browser, 'tl')
    // The requested chip on Zubaida's row opens the request; Answer opens the answer window.
    await tl.goto(`/schedule?on=${day1}`)
    await tl.getByTestId(`request-${r1}`).click()
    await tl.getByTestId('request-answer').click()
    await expect(tl.getByTestId('answer-ask')).toBeVisible({ timeout: 20_000 })
    await expect(tl.getByTestId('answer-ask')).toContainText(t.title)
    await tl.getByTestId('answer-ask-close').click()
    // The bell's item answers the same way.
    await tl.goto('/my-work')
    await tl.getByTestId('notif-bell').click()
    await tl.getByTestId(`notif-request-answer-${t.id}`).click()
    await expect(tl).toHaveURL(/\/schedule/)
    await expect(tl.getByTestId('answer-ask')).toBeVisible({ timeout: 20_000 })
    await expect(tl.getByTestId('answer-ask')).toContainText(t.title)
    await tl.getByTestId('answer-ask-close').click()
    await tl.context().close()
    await untouched(r1, t.id)
    // Put it away: the asker withdraws it.
    await rpcAs('am', 'withdraw_assignment_request', { p_request: r1 })
    expect((await askRow(r1)).status).toBe('withdrawn')
  })

  test('d.3: with the Team Leader on leave today, the Deputy is asked instead, and answers', async ({ browser }) => {
    const t = A.tasks[3]!
    // The Team Leader's leave, today, as the Leave page writes it.
    const leave = await restAs('admin', 'POST', 'resource_unavailability', '', {
      tenant_id: TENANT,
      resource_id: await resourceIdOf('tl'),
      kind: 'leave',
      category: 'planned',
      starts_at: `${day(0)}T00:00:00+03:00`,
      ends_at: `${day(1)}T00:00:00+03:00`,
      reason: LEAVE_REASON,
    })
    expect(leave.status, leave.text).toBeLessThan(300)

    const d1 = await ask(t, { person: null, neededBy, note: 'While Nour is away.' })
    const told = await askedOf(d1)
    expect(told, 'the Deputy is asked').toContain(await idOf('deputy'))
    expect(told, 'the Team Leader on leave is not').not.toContain(await idOf('tl'))
    expect(await pendingFor('deputy')).toContain(d1)

    const deputy = await as(browser, 'deputy')
    await deputy.goto('/schedule')
    await expect(deputy.getByTestId(`ask-from-${d1}`)).toBeVisible({ timeout: 20_000 })
    await deputy.goto('/my-work')
    await deputy.getByTestId(`my-work-ask-no-${d1}`).click()
    await deputy.getByTestId(`my-work-ask-reason-${d1}`).fill('Nour is away; we are full.')
    await deputy.getByTestId(`my-work-ask-no-send-${d1}`).click()
    await expect(deputy.getByTestId(`my-work-ask-${d1}`)).toHaveCount(0, { timeout: 20_000 })
    await deputy.context().close()
    expect(await askRow(d1)).toMatchObject({ status: 'refused', answered_by: await idOf('deputy') })
    expect((await taskRow(t.id)).assignee_id).toBeNull()
    await clearLeave()
  })

  test('may NOT: an ask for a task nobody checks is refused (reviewer_required) — no request is written', async ({ browser }) => {
    // A fresh piece, so its tasks carry no reviewer (the type's workflow appoints none).
    const { tasks } = await makeApprovedPiece(browser, `Ask no reviewer ${Date.now()}`)
    const t = tasks[0]!
    expect(await rows('sub_task_reviewers', `select=user_id&sub_task_id=eq.${t.id}`), 'no reviewer on the task').toEqual([])
    const res = await rpcRaw('am', 'request_task_booking', { p_sub_task: t.id, p_team: DESIGN, p_hours: 2 })
    expect(res.status).toBe(400)
    expect(res.text).toContain('reviewer_required')
    expect(await rows('sub_task_assignment_requests', `select=id&sub_task_id=eq.${t.id}`)).toEqual([])
    expect(await toldAbout('assignment_requested', t.id)).toEqual([])
    expect((await taskRow(t.id)).assignee_id).toBeNull()
  })
})
