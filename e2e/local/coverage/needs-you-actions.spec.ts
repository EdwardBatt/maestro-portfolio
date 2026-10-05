import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { attemptWrite, rows, userIdOf } from '../helpers/db'
import { approveSingleJob, releaseSingleJob, type ReleasedJob, pickJobLanguages } from '../helpers/single-job'
import { addTaskOnPanel, approveTaskList, assignOnSchedule, workingDayFor } from '../helpers/piece'

/**
 * Coverage — Needs you's new items and the task page's new parts (I59 Track 6; plan View 3,
 * View 4 and View 6; ADR-0106, 0107, 0109, 0110, 0113). WRITTEN, NOT RUN in the track that wrote it
 * (the shared local stack was not ours to drive) — run it before ticking I59.30.
 *
 * Every state is MADE through the product, signed in as each person: a Creative job released by
 * the account manager, its owner (the Creative lead) approves the task list and gives two tasks to
 * the maker (the deputy). Then each new control is pressed by somebody who may, and looked for as
 * somebody who may not:
 *
 *   * I'm blocked on the task page → the owner's "Someone is blocked": Nudge (pre-filled), Reassign
 *     (the Schedule, filtered); the maker clears it from Waiting on.
 *   * Ask someone → the account manager replies from Needs you; the second person replies from the
 *     task page's Questions.
 *   * Ask for more time → the owner Forwards with a note → the account manager approves a SHORTER
 *     one; a second request the owner Declines.
 *   * New on you → Too much → the assigner Keeps it; a second one Rebalances (the Schedule).
 *   * Waiting on the client (an input on the deliverable) → the account manager Marks it received.
 *   * A change request on the started piece — asked through `request_deliverable_change`, the door
 *     Track 10's Edit dialog calls (that dialog is not in this copy): the owner sees what it costs and
 *     pushes back; the account manager accepts their version. A second one declined: Close, and Send
 *     a new request goes to the piece's Edit.
 *   * A single job released short of its lead time (reduced scope) → Record the acknowledgement.
 *
 * Escalated to you and Over capacity need the sweep (`run_escalation_sweep`, service role only) or
 * a week booked past 110% — neither is made by a screen here; they are `fixme` with the reason.
 */
const API = 'http://127.0.0.1:54321'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
type Tag = keyof typeof PEOPLE

async function as(browser: Browser, tag: Tag): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}
async function tokenOf(tag: Tag): Promise<string> {
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email: PEOPLE[tag].email, password: 'devpassword' }),
  })
  return ((await res.json()) as { access_token: string }).access_token
}
/** The door a screen's button uses, as the person pressing it. Refused = the test stops. */
async function rpcAs<T = unknown>(tag: Tag, fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${await tokenOf(tag)}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  })
  const body = await res.text()
  expect(res.status, `${fn} as ${tag}: ${body}`).toBeLessThan(300)
  return (body ? JSON.parse(body) : null) as T
}

type Task = { id: string; title: string; status: string }
const tasksOf = (d: string) => rows<Task>('sub_tasks', `select=id,title,status&deliverable_id=eq.${d}&order=sort_order.asc`)
const inputsOf = (d: string) =>
  rows<{ id: string; sub_task_id: string | null; kind: string | null; satisfied_at: string | null; description: string }>(
    'deliverable_pending_inputs', `select=id,sub_task_id,kind,satisfied_at,description&deliverable_id=eq.${d}&order=requested_at.asc`)
const messagesOf = (d: string, kind: string) =>
  rows<{ id: string; kind: string; parent_id: string | null; body: string | null; status: string | null; recipients: string[] }>(
    'piece_messages', `select=id,kind,parent_id,body,status,recipients&deliverable_id=eq.${d}&kind=eq.${kind}&order=created_at.asc`)
const pendingExtension = async (t: string) =>
  (await rows<{ request_id: string; stage: string }>('sub_task_extension_requests', `select=request_id,stage&sub_task_id=eq.${t}&is_pending=eq.true`))[0]
const changeRequestsOf = (d: string) =>
  rows<{ id: string; status: string; closed_at: string | null }>('deliverable_change_requests', `select=id,status,closed_at&deliverable_id=eq.${d}&order=created_at.asc`)
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

let job: ReleasedJob
let work: Task
let fresh: Task

test.describe.configure({ mode: 'serial' })

test.describe('Coverage — Needs you: the new items and the task page (I59 Track 6)', () => {
  test.beforeAll(async ({ browser }) => {
    const am = await as(browser, 'am')
    job = await releaseSingleJob(am, { title: `Cov needs you ${Date.now()}`, department: 'Creative', type: 'Social Advertisement' })
    await am.context().close()
    expect(job.ownerUserId, 'the Creative job is owned by the Creative lead').toBe(await userIdOf(PEOPLE.lead.email))

    // Since ADR-0132 (I71.1): the list is approved and the two tasks added on the piece's panel, and each is given
    // to the deputy on the Schedule, with its hours and its reviewer.
    const lead = await as(browser, 'lead')
    await approveTaskList(lead, job)
    for (const [i, title] of ['NY work', 'NY fresh'].entries()) {
      const on = await workingDayFor(PEOPLE.deputy.email, 3 + i * 3)
      const taskId = await addTaskOnPanel(lead, job, title, on)
      await assignOnSchedule(lead, job, { taskId, assignee: PEOPLE.deputy.email, reviewer: PEOPLE.lead.email, day: on, hours: 6 })
    }
    await lead.context().close()
    const all = await tasksOf(job.deliverableId)
    work = all.find((t) => t.title === 'NY work')!
    fresh = all.find((t) => t.title === 'NY fresh')!
  })

  test("I'm blocked → the owner's Someone is blocked: Nudge, Reassign; the maker clears it", async ({ browser }) => {
    const maker = await as(browser, 'deputy')
    await maker.goto(`/my-work/task/${work.id}`)
    await maker.getByTestId(`my-work-start-${work.id}`).click()
    await expect.poll(async () => (await tasksOf(job.deliverableId)).find((t) => t.id === work.id)!.status).toBe('in_progress')
    await maker.getByTestId('task-page-blocked-open').click()
    await expect(maker.getByTestId('block-told')).toContainText(PEOPLE.lead.name)
    await expect(maker.getByTestId('block-send')).toBeDisabled()
    await maker.getByTestId('block-kind-copy').check()
    await maker.getByTestId('block-who').fill(PEOPLE.writer.name)
    await maker.getByTestId('block-need').fill('The Arabic headline')
    await maker.getByTestId('block-send').click()
    await expect(maker.getByTestId('block-dialog')).toHaveCount(0)
    await expect.poll(async () => (await inputsOf(job.deliverableId)).filter((i) => i.sub_task_id === work.id && !i.satisfied_at).length).toBe(1)
    const [block] = (await inputsOf(job.deliverableId)).filter((i) => i.sub_task_id === work.id)
    expect(block.kind).toBe('copy')
    await expect(maker.getByTestId(`task-page-input-${block.id}`)).toContainText('The Arabic headline')
    await maker.context().close()

    // May not: a team lead who does not own the piece has no such card.
    const tl = await as(browser, 'tl')
    await tl.goto('/my-work')
    await expect(tl.getByTestId('surface-my-work')).toBeVisible()
    await expect(tl.getByTestId(`needs-you-blocked-${block.id}`)).toHaveCount(0)
    await tl.context().close()

    // The owner: the card, its clock, Nudge (the writer pre-filled from "who has it"), Reassign.
    const lead = await as(browser, 'lead')
    await lead.goto('/my-work')
    const card = lead.getByTestId(`needs-you-blocked-${block.id}`)
    await expect(card).toBeVisible({ timeout: 30_000 })
    await expect(lead.getByTestId(`needs-you-clock-${block.id}`)).toContainText('escalates in')
    await lead.getByTestId(`needs-you-nudge-${block.id}`).click()
    await expect(lead.getByTestId('ny-nudge-told')).toContainText(PEOPLE.writer.name)
    await lead.getByTestId('ny-nudge-body').fill('Could you send the Arabic headline today?')
    await lead.getByTestId('ny-nudge-send').click()
    await expect(lead.getByTestId('ny-nudge-dialog')).toHaveCount(0)
    const writerId = await userIdOf(PEOPLE.writer.email)
    await expect.poll(async () => (await messagesOf(job.deliverableId, 'nudge')).some((m) => m.recipients.includes(writerId))).toBe(true)
    await lead.getByTestId(`needs-you-reassign-${block.id}`).click()
    await expect(lead).toHaveURL(/\/schedule\?campaign=.+&dept=.+/)
    await lead.context().close()

    // The maker clears it; the card leaves the owner's list.
    const maker2 = await as(browser, 'deputy')
    await maker2.goto(`/my-work/task/${work.id}`)
    await maker2.getByTestId(`task-page-input-clear-${block.id}`).click()
    await expect.poll(async () => (await inputsOf(job.deliverableId)).find((i) => i.id === block.id)!.satisfied_at).not.toBeNull()
    await expect(maker2.getByTestId(`task-page-input-${block.id}`)).toHaveCount(0)
    await maker2.context().close()
  })

  test('Ask someone → the AM replies from Needs you; the writer replies on the task page', async ({ browser }) => {
    const maker = await as(browser, 'deputy')
    await maker.goto(`/my-work/task/${work.id}`)
    await maker.getByTestId('task-page-ask').click()
    const amId = await userIdOf(PEOPLE.am.email)
    const writerId = await userIdOf(PEOPLE.writer.email)
    await expect(maker.getByTestId(`ask-person-${amId}`)).toBeChecked() // the AM, pre-selected
    await maker.getByTestId('ask-search').fill(PEOPLE.writer.name)
    await maker.getByTestId(`ask-person-${writerId}`).check()
    await expect(maker.getByTestId('ask-told')).toContainText(PEOPLE.writer.name)
    await maker.getByTestId('ask-body').fill('Is the headline final?')
    await maker.getByTestId('ask-send').click()
    await expect.poll(async () => (await messagesOf(job.deliverableId, 'question')).length).toBe(1)
    const [q] = await messagesOf(job.deliverableId, 'question')
    expect(q.recipients.sort()).toEqual([amId, writerId].sort())
    await expect(maker.getByTestId(`task-page-question-${q.id}`)).toContainText('Is the headline final?')
    await expect(maker.getByTestId(`task-page-question-reply-${q.id}`)).toHaveCount(0) // the asker does not reply
    await maker.context().close()

    const am = await as(browser, 'am')
    await am.goto('/my-work')
    await am.getByTestId(`needs-you-reply-${q.id}`).click({ timeout: 30_000 })
    await expect(am.getByTestId('ny-reply-question')).toContainText('Is the headline final?')
    await am.getByTestId('ny-reply-body').fill('Yes, final.')
    await am.getByTestId('ny-reply-send').click()
    await expect.poll(async () => (await messagesOf(job.deliverableId, 'reply')).length).toBe(1)
    await expect(am.getByTestId(`needs-you-question-${q.id}`)).toHaveCount(0)
    await am.context().close()

    const writer = await as(browser, 'writer')
    await writer.goto(`/my-work/task/${work.id}`)
    await writer.getByTestId(`task-page-question-reply-${q.id}`).click()
    await writer.getByTestId('reply-body').fill('Final from Content too.')
    await writer.getByTestId('reply-send').click()
    await expect.poll(async () => (await messagesOf(job.deliverableId, 'reply')).length).toBe(2)
    await writer.context().close()
  })

  test('Extension (retired, ADR-0141 d.5): no new ask and the door refuses; one already pending is still answered — the owner forwards, the AM approves a shorter one; the next the owner declines', async ({ browser }) => {
    const control = `my-work-extension-${work.id}`
    // No NEW extension request: the maker's task page offers none, and the door refuses in words — nothing written.
    const deputyPage = await as(browser, 'deputy')
    await deputyPage.goto(`/my-work/task/${work.id}`)
    // What she is offered instead: asking her own lead for more time (I74.17).
    await expect(deputyPage.getByTestId('task-more-time-open')).toBeVisible({ timeout: 15_000 })
    expect(await deputyPage.getByTestId(`${control}-ask`).count(), 'the retired extension Ask is not offered').toBe(0)
    await deputyPage.context().close()
    const retired = await fetch(`${API}/rest/v1/rpc/sub_task_extension_request`, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${await tokenOf('deputy')}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_sub_task: work.id, p_to_day: day(30), p_reason: 'x', p_attributed_to: 'assignee' }),
    })
    expect(retired.status).toBe(400)
    expect(await retired.text()).toContain('extension_retired')
    expect(await pendingExtension(work.id)).toBeUndefined()

    // A request raised BEFORE the retirement is still answered as before (d.5). None can be raised through the product
    // any more, so one is put on the record as the retired function wrote it (sla_events + the owner's notification) —
    // the one staged state in this test, through the service role.
    const ask = async (reason: string) => {
      const [t] = await rows<{ deliverable_id: string; committed_due_at: string | null; tenant_id: string; title: string }>(
        'sub_tasks', `select=deliverable_id,committed_due_at,tenant_id,title&id=eq.${work.id}`)
      const deputy = await userIdOf(PEOPLE.deputy.email)
      const owner = await userIdOf(PEOPLE.lead.email)
      const approver = await userIdOf(PEOPLE.am.email)
      const id = crypto.randomUUID()
      const to = `${day(30)}T15:00:00Z`
      const ev = await attemptWrite('POST', 'sla_events', '', {
        id, tenant_id: t.tenant_id, deliverable_id: t.deliverable_id, sub_task_id: work.id, event_type: 'extension_requested',
        attributed_to: 'assignee', actor_user_id: deputy,
        payload: { from: t.committed_due_at, to, reason, approver_user_id: approver, owner_user_id: owner, owner_step: true },
      })
      expect(ev.status, ev.text).toBeLessThan(300)
      const n = await attemptWrite('POST', 'notifications', '', {
        tenant_id: t.tenant_id, user_id: owner, type: 'extension_requested', label: t.title, entity_type: 'sub_task',
        entity_id: work.id, actor_id: deputy, detail: { stage: 'owner', from: t.committed_due_at, to, reason },
      })
      expect(n.status, n.text).toBeLessThan(300)
      await expect.poll(async () => (await pendingExtension(work.id))?.stage).toBe('owner')
      return (await pendingExtension(work.id))!.request_id
    }

    const first = await ask('The files came late.')
    // May not: the account manager has nothing to decide before the owner forwards it.
    const amEarly = await as(browser, 'am')
    await amEarly.goto('/my-work')
    await expect(amEarly.getByTestId('surface-my-work')).toBeVisible()
    await expect(amEarly.getByTestId(`needs-you-decide-extension-${first}`)).toHaveCount(0)
    await amEarly.context().close()

    const lead = await as(browser, 'lead')
    await lead.goto('/my-work')
    await lead.getByTestId(`needs-you-forward-${first}`).click({ timeout: 30_000 })
    await expect(lead.getByTestId('ny-ext-owner-send')).toBeDisabled() // the note is required
    await lead.getByTestId('ny-ext-owner-text').fill('Fair — the client sent the files late.')
    await lead.getByTestId('ny-ext-owner-send').click()
    await expect.poll(async () => (await pendingExtension(work.id))?.stage).toBe('am')
    await lead.context().close()

    const am = await as(browser, 'am')
    await am.goto('/my-work')
    await am.getByTestId(`needs-you-decide-extension-${first}`).click({ timeout: 30_000 })
    await expect(am.getByTestId('ny-ext-am-owner-note')).toContainText('Fair')
    await am.getByTestId('ny-ext-am-mode-shorter').check()
    const picker = am.getByTestId('ny-ext-am-day')
    const max = await picker.getAttribute('max')
    expect(max).toBe(day(29))
    await picker.fill(day(20))
    await am.getByTestId('ny-ext-am-note').fill('Ten days, not thirty.')
    await am.getByTestId('ny-ext-am-send').click()
    await expect.poll(async () => pendingExtension(work.id)).toBeUndefined()
    const [approved] = await rows<{ payload: { shorter?: boolean } }>('sla_events', `select=payload&sub_task_id=eq.${work.id}&event_type=eq.extension_approved&order=created_at.desc`)
    expect(approved.payload.shorter).toBe(true)
    await am.context().close()

    const second = await ask('Still waiting on the copy.')
    const lead2 = await as(browser, 'lead')
    await lead2.goto('/my-work')
    await lead2.getByTestId(`needs-you-decline-${second}`).click({ timeout: 30_000 })
    await expect(lead2.getByTestId('ny-ext-owner-mode-decline')).toBeChecked()
    await lead2.getByTestId('ny-ext-owner-mode-forward').check()
    await lead2.getByTestId('ny-ext-owner-mode-decline').check()
    await lead2.getByTestId('ny-ext-owner-text').fill('The copy is not the blocker.')
    await lead2.getByTestId('ny-ext-owner-send').click()
    await expect.poll(async () => pendingExtension(work.id)).toBeUndefined()
    await lead2.context().close()

    // The AM step's Refuse and Cancel, on a third request.
    const third = await ask('One more try.')
    const lead3 = await as(browser, 'lead')
    await lead3.goto('/my-work')
    await lead3.getByTestId(`needs-you-forward-${third}`).click({ timeout: 30_000 })
    await lead3.getByTestId('ny-ext-owner-cancel').click()
    await lead3.getByTestId(`needs-you-forward-${third}`).click()
    await lead3.getByTestId('ny-ext-owner-text').fill('Your call.')
    await lead3.getByTestId('ny-ext-owner-send').click()
    await expect.poll(async () => (await pendingExtension(work.id))?.stage).toBe('am')
    await lead3.context().close()
    const am3 = await as(browser, 'am')
    await am3.goto('/my-work')
    await am3.getByTestId(`needs-you-decide-extension-${third}`).click({ timeout: 30_000 })
    await am3.getByTestId('ny-ext-am-cancel').click()
    await am3.getByTestId(`needs-you-decide-extension-${third}`).click()
    await am3.getByTestId('ny-ext-am-mode-approve').check()
    await am3.getByTestId('ny-ext-am-mode-refuse').check()
    await am3.getByTestId('ny-ext-am-send').click()
    await expect.poll(async () => pendingExtension(work.id)).toBeUndefined()
    await am3.context().close()
  })

  test('New on you → Too much → the assigner keeps it; the next one is rebalanced', async ({ browser }) => {
    const sayTooMuch = async () => {
      const maker = await as(browser, 'deputy')
      await maker.goto('/my-work')
      await maker.getByTestId(`needs-you-too-much-${fresh.id}`).click({ timeout: 30_000 })
      await expect(maker.getByTestId('ny-too-much-told')).toContainText(PEOPLE.lead.name)
      await maker.getByTestId('ny-too-much-note').fill('Three launches this week.')
      await maker.getByTestId('ny-too-much-send').click()
      await expect.poll(async () => (await messagesOf(job.deliverableId, 'too_much')).filter((m) => m.status === 'open').length).toBe(1)
      await maker.context().close()
      return (await messagesOf(job.deliverableId, 'too_much')).find((m) => m.status === 'open')!.id
    }
    const first = await sayTooMuch()
    const lead = await as(browser, 'lead')
    await lead.goto('/my-work')
    await expect(lead.getByTestId(`needs-you-too_much-${first}`)).toContainText('too much', { timeout: 30_000 })
    await lead.getByTestId(`needs-you-keep-${first}`).click()
    await expect.poll(async () => (await messagesOf(job.deliverableId, 'too_much')).find((m) => m.id === first)!.status).toBe('kept')
    await lead.context().close()

    const second = await sayTooMuch()
    const lead2 = await as(browser, 'lead')
    await lead2.goto('/my-work')
    await lead2.getByTestId(`needs-you-rebalance-${second}`).click({ timeout: 30_000 })
    await expect(lead2).toHaveURL(/\/schedule\?campaign=/)
    await expect.poll(async () => (await messagesOf(job.deliverableId, 'too_much')).find((m) => m.id === second)!.status).toBe('rebalanced')
    await lead2.context().close()

    // Opening the task marks it seen on the server (I59, `assignee_seen_at`) — gone from New on you
    // everywhere. There is no Later button (Edward, 26 Sep).
    const maker = await as(browser, 'deputy')
    await maker.goto('/my-work')
    await expect(maker.getByTestId(`needs-you-later-${fresh.id}`)).toHaveCount(0)
    await maker.goto(`/my-work/task/${fresh.id}`)
    await expect(maker.getByTestId('task-page')).toBeVisible({ timeout: 15_000 })
    await expect.poll(async () => (await rows<{ assignee_seen_at: string | null }>('sub_tasks', `select=assignee_seen_at&id=eq.${fresh.id}`))[0]?.assignee_seen_at ?? null, { timeout: 15_000 }).not.toBeNull()
    await maker.goto('/my-work')
    await expect(maker.getByTestId(`needs-you-new_on_you-${fresh.id}`)).toHaveCount(0)
    await expect.poll(async () => (await rows<{ assignee_seen_at: string | null }>('sub_tasks', `select=assignee_seen_at&id=eq.${fresh.id}`))[0]?.assignee_seen_at ?? null).not.toBeNull()
    await maker.context().close()
  })

  test('Waiting on the client → the AM marks it received', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await lead.goto(`/deliverables?open=${job.deliverableId}`)
    await lead.getByTestId('external-input-add').click()
    await lead.getByTestId('external-input-description').fill('The offer terms')
    await lead.getByTestId('external-input-awaited-from').fill('Northwind marketing')
    await lead.getByTestId('external-input-save').click()
    await expect.poll(async () => (await inputsOf(job.deliverableId)).filter((i) => i.description === 'The offer terms').length).toBe(1)
    await lead.context().close()
    const [input] = (await inputsOf(job.deliverableId)).filter((i) => i.description === 'The offer terms')

    // May not: the maker is not the campaign's account manager — no such card.
    const maker = await as(browser, 'deputy')
    await maker.goto('/my-work')
    await expect(maker.getByTestId('surface-my-work')).toBeVisible()
    await expect(maker.getByTestId(`needs-you-client_waiting-${input.id}`)).toHaveCount(0)
    await maker.context().close()

    const am = await as(browser, 'am')
    await am.goto('/my-work')
    await am.getByTestId(`needs-you-mark-received-${input.id}`).click({ timeout: 30_000 })
    await am.getByTestId('ny-received-cancel').click()
    await am.getByTestId(`needs-you-mark-received-${input.id}`).click()
    await am.getByTestId('ny-received-send').click()
    await expect.poll(async () => (await inputsOf(job.deliverableId)).find((i) => i.id === input.id)!.satisfied_at).not.toBeNull()
    await am.context().close()
  })

  test('A change request on started work: the cost, a push-back, their version accepted; a decline closed', async ({ browser }) => {
    // Asked through the door Track 10's Edit dialog calls, as the account manager — with the cost in
    // the shape that dialog stores (`costFigures`: started_tasks, booked_hours, timed_hours, lands_on).
    // Needs you reads it back by exactly those names (`readStoredCost`, COST_KEYS); a cost holding none
    // of them is "no cost worked out" (change-request.test.ts), so an invented `days_lost` is not shown.
    const ask = () => rpcAs<string>('am', 'request_deliverable_change', {
      p_deliverable: job.deliverableId, p_changes: { due: { to: day(40) } }, p_asked_by: 'client',
      p_cost: { started_tasks: 2, booked_hours: 6, timed_hours: 1.5, lands_on: day(40) },
    })
    const first = await ask()

    const lead = await as(browser, 'lead')
    await lead.goto('/my-work')
    await lead.getByTestId(`needs-you-change-cost-${first}`).click({ timeout: 30_000 })
    await expect(lead.getByTestId('ny-change-cost-cost-work')).toContainText('2 tasks started — 6 h booked, 1.5 h timed.')
    await expect(lead.getByTestId('ny-change-cost-cost-lands')).toBeVisible()
    await expect(lead.getByTestId('ny-change-cost-cost-none')).toHaveCount(0)
    await lead.getByTestId('ny-change-cost-close').click()
    await lead.getByTestId(`needs-you-decide-change-${first}`).click()
    await expect(lead.getByTestId('ny-change-decide-change-due')).toBeVisible()
    await expect(lead.getByTestId('ny-change-decide-told')).toContainText(PEOPLE.am.name)
    await lead.getByTestId('ny-change-decide-mode-decline').check()
    await lead.getByTestId('ny-change-decide-mode-accept').check()
    await lead.getByTestId('ny-change-decide-mode-push_back').check()
    await lead.getByTestId('ny-change-decide-text').fill('Due a week later, not three.')
    await lead.getByTestId('ny-change-decide-date').fill(day(25))
    await lead.getByTestId('ny-change-decide-send').click()
    await expect.poll(async () => (await changeRequestsOf(job.deliverableId)).find((r) => r.id === first)!.status).toBe('pushed_back')
    await lead.context().close()

    const am = await as(browser, 'am')
    await am.goto('/my-work')
    await am.getByTestId(`needs-you-withdraw-change-${first}`).click({ timeout: 30_000 })
    await am.getByTestId('ny-change-counter-cancel').click()
    await am.getByTestId(`needs-you-accept-counter-${first}`).click()
    await am.getByTestId('ny-change-counter-mode-withdraw').check()
    await am.getByTestId('ny-change-counter-mode-accept').check()
    await am.getByTestId('ny-change-counter-send').click()
    await expect.poll(async () => (await changeRequestsOf(job.deliverableId)).find((r) => r.id === first)!.status).toBe('counter_accepted')
    await am.context().close()

    const second = await ask()
    const lead2 = await as(browser, 'lead')
    await lead2.goto('/my-work')
    await lead2.getByTestId(`needs-you-decide-change-${second}`).click({ timeout: 30_000 })
    await lead2.getByTestId('ny-change-decide-cancel').click()
    await lead2.getByTestId(`needs-you-decide-change-${second}`).click()
    await lead2.getByTestId('ny-change-decide-mode-decline').check()
    await lead2.getByTestId('ny-change-decide-text').fill('The client has not agreed it.')
    await lead2.getByTestId('ny-change-decide-send').click()
    await expect.poll(async () => (await changeRequestsOf(job.deliverableId)).find((r) => r.id === second)!.status).toBe('declined')
    await lead2.context().close()

    // May not: the maker asked nothing and owns nothing — no change cards.
    const maker = await as(browser, 'deputy')
    await maker.goto('/my-work')
    await expect(maker.getByTestId('surface-my-work')).toBeVisible()
    await expect(maker.getByTestId(`needs-you-change_declined-${second}`)).toHaveCount(0)
    await maker.context().close()

    const am2 = await as(browser, 'am')
    await am2.goto('/my-work')
    await expect(am2.getByTestId(`needs-you-send-new-request-${second}`)).toHaveAttribute('href', `/campaigns/${job.campaignId}?edit=${job.deliverableId}`, { timeout: 30_000 })
    await am2.getByTestId(`needs-you-close-change-${second}`).click()
    await expect.poll(async () => (await changeRequestsOf(job.deliverableId)).find((r) => r.id === second)!.closed_at).not.toBeNull()
    await am2.getByTestId(`needs-you-send-new-request-${second}`).waitFor({ state: 'detached' })
    await am2.context().close()
  })

  test('A job released short of its lead time → Record the acknowledgement', async ({ browser }) => {
    const am = await as(browser, 'am')
    const title = `Cov reduced scope ${Date.now()}`
    await am.goto('/campaigns/new-job')
    await am.getByTestId('sj-client').selectOption({ label: 'Northwind Beverages' })
    await am.getByTestId('sj-words').fill('One static, tomorrow.')
    await am.getByTestId('sj-brief-card-single_execution').click()
    await am.getByTestId('sj-next').click()
    await am.getByTestId('sj-field-task').fill('Design one static.')
    await am.getByTestId('sj-next').click()
    await am.getByTestId('sj-title').fill(title)
    await am.getByTestId('sj-due').fill(day(1))
    await am.getByTestId('sj-department').getByRole('radio', { name: 'Creative' }).click()
    await pickJobLanguages(am)
    await am.getByTestId('sj-next').click()
    await am.getByTestId('sj-short-continue').click()
    // Earlier runs leave lookalikes: the similar-job prompt may come first (as nextToReview handles it).
    const prompt = am.getByTestId('sj-similar-dialog')
    const review = am.getByTestId('sj-review')
    const outcome = await Promise.race([
      prompt.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'prompt' as const),
      review.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'review' as const),
    ])
    if (outcome === 'prompt') await am.getByTestId('sj-similar-separate').click()
    await expect(review).toBeVisible()
    await expect(am.getByTestId('sj-review-reduced-scope')).toBeVisible()
    const campaignId = await approveSingleJob(am)
    await am.goto('/my-work')
    await am.getByTestId(`needs-you-record-ack-${campaignId}`).click({ timeout: 30_000 })
    await expect(am.getByTestId('ny-scope-ack-days')).toBeVisible()
    await expect(am.getByTestId('ny-scope-ack-send')).toBeDisabled()
    await am.getByTestId('ny-scope-ack-by').fill('Ahmed (Northwind)')
    await am.getByTestId('ny-scope-ack-via').selectOption('email')
    await am.getByTestId('ny-scope-ack-at').fill('2026-09-25T10:30')
    await am.getByTestId('ny-scope-ack-note').fill('Understood, a lighter version is fine.')
    await am.getByTestId('ny-scope-ack-send').click()
    await expect.poll(async () => (await rows<{ acknowledged_by: string }>('scope_acknowledgements', `select=acknowledged_by&campaign_id=eq.${campaignId}`))[0]?.acknowledged_by).toBe('Ahmed (Northwind)')
    await expect(am.getByTestId(`needs-you-scope_unacknowledged-${campaignId}`)).toHaveCount(0)
    await am.context().close()
  })

  test.fixme('Escalated to you and Over capacity — Open, Rebalance, See the week', async ({ browser }) => {
    // Needs the escalation sweep (`run_escalation_sweep`, granted to the service role only) past a
    // rule's hours, and a person booked over 110% this week. Neither is made by a screen in this
    // copy; wire it to the sweep's Edge Function (Track 8) and a Schedule booking walk, then drop fixme.
    const lead = await as(browser, 'lead')
    await lead.goto('/my-work')
    const esc = lead.locator('[data-kind="escalated"]').first()
    const id = (await esc.getAttribute('data-testid'))!.replace('needs-you-escalated-', '')
    await lead.getByTestId(`needs-you-open-escalated-${id}`).click()
    await lead.goto('/my-work')
    const over = lead.locator('[data-kind="over_capacity"]').first()
    const rid = (await over.getAttribute('data-testid'))!.replace('needs-you-over_capacity-', '')
    await lead.getByTestId(`needs-you-see-week-${rid}`).click()
    await expect(lead).toHaveURL(/\/team/)
    await lead.goto('/my-work')
    await lead.getByTestId(`needs-you-rebalance-week-${rid}`).click()
    await expect(lead).toHaveURL(/\/schedule\?/)
    await lead.context().close()
  })
})
