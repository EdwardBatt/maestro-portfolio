import { test, expect } from '@playwright/test'
import { rows } from '../helpers/db'
import { closeCampaignBanner } from '../helpers/piece'
import {
  as, assignAs, idOf, makeApprovedPiece, PEOPLE, rpcAs, rpcRaw, toldAbout, workday, day, type TaskRow,
} from '../helpers/i74'
import type { ReleasedJob } from '../helpers/single-job'

/**
 * Coverage — only the account manager changes a deliverable; everyone else asks through one form (ADR-0141, I74.13–I74.16).
 *
 * The piece is MADE through the product: the account manager (Inas in the demo data — `am`) releases a Creative single job,
 * its owner (the Creative department lead, Fadia — `lead`) approves the task list, and one task is given to the maker
 * (Zubaida — `maker`) so "the assignees are told" has someone to tell.
 *
 *   may NOT  the owner sees the piece's fields read-only (the strip), and the server refuses her direct due-date, type and
 *            details edits in the account manager's name (hint ask_account_manager) — the deliverable unchanged;
 *   may NOT  a team member is refused the form (hint ask_your_lead) — no ask row;
 *   may NOT  the retired per-task extension (hint extension_retired) — no extension event; its Ask button is gone;
 *   may NOT  the account manager is not offered the ask (she changes it herself; the server says change_directly);
 *   may      the owner asks from the piece (Cancel first: nothing sent), sees her ask, withdraws it;
 *   may      the account manager answers: accept (the due day applies, the maker is told), keep (with a reason; Reply opens
 *            the form again), change it (her own day applies);
 *   may      the account manager changes the due date in the panel, and the type, directly.
 */
test.use({ actionTimeout: 15_000 })
test.describe.configure({ mode: 'serial' })

const iraqDayOf = (ts: string | null) => (ts ? new Date(Date.parse(ts) + 3 * 3_600_000).toISOString().slice(0, 10) : null)
type Ask = { id: string; status: string; kinds: string[]; requested_due_day: string | null; requested_hours: number | null; asked_by: string; applied_due_day: string | null; answer_note: string | null }
const asksOn = (deliverableId: string) =>
  rows<Ask>('deliverable_change_asks', `select=id,status,kinds,requested_due_day,requested_hours,asked_by,applied_due_day,answer_note&deliverable_id=eq.${deliverableId}&order=created_at.desc`)
const piece = async (id: string) =>
  (await rows<{ due_at: string | null; deliverable_type_id: string | null; channel: string | null; name: string }>('deliverables', `select=due_at,deliverable_type_id,channel,name&id=eq.${id}`))[0]!

let job: ReleasedJob
let tasks: TaskRow[]
let dueBefore: string

test.describe('Ask the account manager to change it (ADR-0141)', () => {
  test.beforeAll(async ({ browser }) => {
    ;({ job, tasks } = await makeApprovedPiece(browser, `Change ask ${Date.now()}`))
    const r = await assignAs('lead', tasks[0]!.id, 'maker', 'lead', workday(3))
    expect(r.outcome).toBe('assigned')
    dueBefore = iraqDayOf((await piece(job.deliverableId)).due_at)!
    expect(dueBefore).toBeTruthy()
  })

  test('may NOT: the owner reads the fields and the server refuses her direct edits in the account manager\'s name', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await lead.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
    await expect(lead.getByTestId('piece-panel')).toBeVisible({ timeout: 20_000 })
    // Read-only: the strip and its Ask; none of the account manager's fields.
    await expect(lead.getByTestId('piece-panel-ask-strip')).toBeVisible()
    await expect(lead.getByTestId('piece-panel-ask-ask')).toBeVisible()
    await expect(lead.getByTestId('piece-panel-due')).toHaveCount(0)
    await expect(lead.getByTestId('piece-panel-name')).toHaveCount(0)
    await expect(lead.getByTestId('piece-panel-quantity')).toHaveCount(0)
    await expect(lead.getByTestId('piece-panel-channel')).toHaveCount(0)
    await lead.context().close()

    const before = await piece(job.deliverableId)
    const due = await rpcRaw('lead', 'edit_piece_directly', { p_deliverable: job.deliverableId, p_quantity: null, p_due_day: day(40) })
    expect(due.status, due.text).toBe(403)
    expect(due.text).toContain('ask_account_manager')
    expect(due.text).toContain(PEOPLE.am.name)

    const [other] = await rows<{ id: string }>('deliverable_types', `select=id&id=neq.${before.deliverable_type_id}&is_active=eq.true&limit=1`)
    expect(other, 'another deliverable type exists').toBeTruthy()
    const type = await rpcRaw('lead', 'change_deliverable_type', { p_deliverable: job.deliverableId, p_type: other!.id })
    expect(type.status, type.text).toBe(403)
    expect(type.text).toContain('ask_account_manager')

    const details = await rpcRaw('lead', 'update_piece_details', { p_deliverable: job.deliverableId, p_channel: 'Refused channel', p_languages: null, p_notes: '' })
    expect(details.status, details.text).toBe(403)
    expect(details.text).toContain('ask_account_manager')

    // Nothing changed.
    const after = await piece(job.deliverableId)
    expect(after).toEqual(before)
  })

  test('may NOT: a team member is refused the form (ask_your_lead); the account manager is told to change it herself', async ({ browser }) => {
    const mk = await rpcRaw('maker', 'ask_deliverable_change', {
      p_deliverable: job.deliverableId, p_kinds: ['due_date'], p_reason: 'I need longer.', p_due_day: day(40), p_hours: null, p_from_sub_task: null,
    })
    expect(mk.status, mk.text).toBe(403)
    expect(mk.text).toContain('ask_your_lead')

    const amAsk = await rpcRaw('am', 'ask_deliverable_change', {
      p_deliverable: job.deliverableId, p_kinds: ['due_date'], p_reason: 'x', p_due_day: day(40), p_hours: null, p_from_sub_task: null,
    })
    expect(amAsk.status, amAsk.text).toBe(400)
    expect(amAsk.text).toContain('change_directly')
    expect(await asksOn(job.deliverableId)).toEqual([])

    // The account manager's panel offers no Ask — her fields are editable instead.
    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
    await expect(am.getByTestId('piece-panel-due')).toBeVisible({ timeout: 20_000 })
    await expect(am.getByTestId('piece-panel-ask-ask')).toHaveCount(0)
    await am.context().close()
  })

  test('may NOT: the retired per-task extension — no Ask on the task page, and the door refuses (extension_retired)', async ({ browser }) => {
    const t0 = tasks[0]!.id
    const mk = await as(browser, 'maker')
    await mk.goto(`/my-work/task/${t0}`)
    await expect(mk.getByTestId('task-more-time-open')).toBeVisible({ timeout: 20_000 })
    await expect(mk.getByTestId(`my-work-extension-${t0}-ask`)).toHaveCount(0)
    await mk.context().close()

    const res = await rpcRaw('maker', 'sub_task_extension_request', { p_sub_task: t0, p_to_day: day(40), p_reason: 'More time', p_attributed_to: 'internal' })
    expect(res.status, res.text).toBe(400)
    expect(res.text).toContain('extension_retired')
    expect(await rows('sla_events', `select=id&sub_task_id=eq.${t0}&event_type=eq.extension_requested`)).toEqual([])
  })

  test('may: the owner asks from the piece — Cancel sends nothing; Send waits on the account manager, who is told', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await lead.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
    await lead.getByTestId('piece-panel-ask-ask').click()
    const form = lead.getByTestId('piece-panel-ask-form')
    await expect(form).toBeVisible()
    await expect(lead.getByTestId('piece-panel-ask-form-send')).toBeDisabled()
    await lead.getByTestId('piece-panel-ask-form-kind-format').click()
    await lead.getByTestId('piece-panel-ask-form-reason').fill('Changed my mind.')
    await lead.getByTestId('piece-panel-ask-form-cancel').click()
    await expect(form).toHaveCount(0)
    expect(await asksOn(job.deliverableId)).toEqual([])

    await lead.getByTestId('piece-panel-ask-ask').click()
    await lead.getByTestId('piece-panel-ask-form-kind-due_date').click()
    await lead.getByTestId('piece-panel-ask-form-kind-hours').click()
    await expect(lead.getByTestId('piece-panel-ask-form-kind-due_date')).toHaveAttribute('aria-pressed', 'true')
    // Not ready until the day, the hours and the reason are given.
    await expect(lead.getByTestId('piece-panel-ask-form-send')).toBeDisabled()
    await lead.getByTestId('piece-panel-ask-form-due').fill(day(35))
    await lead.getByTestId('piece-panel-ask-form-hours').fill('16')
    await lead.getByTestId('piece-panel-ask-form-reason').fill('The client added two sizes.')
    await lead.getByTestId('piece-panel-ask-form-send').click()
    await expect(form).toHaveCount(0)

    await expect.poll(async () => (await asksOn(job.deliverableId)).length).toBe(1)
    const [ask] = await asksOn(job.deliverableId)
    expect(ask).toMatchObject({ status: 'pending', requested_due_day: day(35), asked_by: await idOf('lead') })
    expect(Number(ask!.requested_hours)).toBe(16)
    expect([...ask!.kinds].sort()).toEqual(['due_date', 'hours'])
    expect(await toldAbout('deliverable_change_asked', job.deliverableId)).toContain(await idOf('am'))
    // Nothing changes until she answers.
    expect(iraqDayOf((await piece(job.deliverableId)).due_at)).toBe(dueBefore)

    // CP-07: the waiting banner, and the asker sees her ask.
    await expect(lead.getByTestId('piece-panel-ask-waiting')).toBeVisible()
    await lead.getByTestId('piece-panel-ask-see').click()
    await expect(lead.getByTestId('piece-panel-ask-reason')).toContainText('The client added two sizes.')
    await expect(lead.getByTestId('piece-panel-ask-answer')).toHaveCount(0)
    await lead.context().close()
  })

  test('may: the asker withdraws — the ask is closed and the account manager told', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await lead.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
    await lead.getByTestId('piece-panel-ask-withdraw').click()
    await expect.poll(async () => (await asksOn(job.deliverableId))[0]!.status).toBe('withdrawn')
    await expect(lead.getByTestId('piece-panel-ask-waiting')).toHaveCount(0)
    await expect(lead.getByTestId('piece-panel-ask-ask')).toBeVisible()
    expect(await toldAbout('deliverable_change_withdrawn', job.deliverableId)).toContain(await idOf('am'))
    expect(iraqDayOf((await piece(job.deliverableId)).due_at)).toBe(dueBefore)
    await lead.context().close()
  })

  test('may: the account manager accepts — the due day moves, the maker is told; the owner reads the answer and presses OK', async ({ browser }) => {
    const askId = await rpcAs<string>('lead', 'ask_deliverable_change', {
      p_deliverable: job.deliverableId, p_kinds: ['due_date'], p_reason: 'The shoot moved.', p_due_day: day(36), p_hours: null, p_from_sub_task: null,
    })
    // Another lead is refused the answer, in the account manager's name; the ask stays pending.
    const other = await rpcRaw('lead', 'answer_deliverable_change', { p_ask: askId, p_answer: 'accept', p_due_day: null, p_hours: null, p_note: null })
    expect(other.status, other.text).toBe(403)
    expect(other.text).toContain('ask_account_manager')
    expect((await asksOn(job.deliverableId))[0]).toMatchObject({ id: askId, status: 'pending' })

    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
    await expect(am.getByTestId('piece-panel-ask-waiting')).toBeVisible({ timeout: 20_000 })
    await am.getByTestId('piece-panel-ask-see').click()
    await expect(am.getByTestId('piece-panel-ask-reason')).toContainText('The shoot moved.')
    await am.getByTestId('piece-panel-ask-answer').click()
    const dialog = am.getByTestId('piece-panel-ask-answer-dialog')
    await expect(dialog).toBeVisible()
    await expect(am.getByTestId('piece-panel-ask-answer-dialog-reason')).toContainText('The shoot moved.')
    await am.getByTestId('piece-panel-ask-answer-dialog-mode-accept').click()
    await am.getByTestId('piece-panel-ask-answer-dialog-note').fill('Fine — the client agreed.')
    await am.getByTestId('piece-panel-ask-answer-dialog-submit').click()
    await expect(dialog).toHaveCount(0)
    await am.context().close()

    await expect.poll(async () => (await asksOn(job.deliverableId))[0]!.status).toBe('accepted')
    expect((await asksOn(job.deliverableId))[0]!.applied_due_day).toBe(day(36))
    expect(iraqDayOf((await piece(job.deliverableId)).due_at)).toBe(day(36))
    expect(await toldAbout('deliverable_edited', job.deliverableId)).toContain(await idOf('maker'))
    expect(await toldAbout('deliverable_change_answered', job.deliverableId)).toContain(await idOf('lead'))

    const lead = await as(browser, 'lead')
    await lead.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
    const answered = lead.getByTestId('piece-panel-ask-answered')
    await expect(answered).toBeVisible({ timeout: 20_000 })
    await expect(answered).toHaveAttribute('data-status', 'accepted')
    await expect(lead.getByTestId('piece-panel-ask-told')).toContainText(PEOPLE.maker.name)
    await lead.getByTestId('piece-panel-ask-ok').click()
    await expect(answered).toHaveCount(0)
    await lead.context().close()
  })

  test('may: the account manager keeps it, with her reason; the owner reads it and Reply opens the form again', async ({ browser }) => {
    await rpcAs('lead', 'ask_deliverable_change', {
      p_deliverable: job.deliverableId, p_kinds: ['language'], p_reason: 'Arabic first, please.', p_due_day: null, p_hours: null, p_from_sub_task: null,
    })
    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
    await am.getByTestId('piece-panel-ask-answer').click({ timeout: 20_000 })
    await am.getByTestId('piece-panel-ask-answer-dialog-mode-keep').click()
    // Keep needs her reason.
    await expect(am.getByTestId('piece-panel-ask-answer-dialog-submit')).toBeDisabled()
    await am.getByTestId('piece-panel-ask-answer-dialog-note').fill('The client signed English off.')
    await am.getByTestId('piece-panel-ask-answer-dialog-submit').click()
    await expect(am.getByTestId('piece-panel-ask-answer-dialog')).toHaveCount(0)
    await am.context().close()

    await expect.poll(async () => (await asksOn(job.deliverableId))[0]!.status).toBe('kept')
    expect((await asksOn(job.deliverableId))[0]!.answer_note).toBe('The client signed English off.')
    expect(iraqDayOf((await piece(job.deliverableId)).due_at)).toBe(day(36))

    const lead = await as(browser, 'lead')
    await lead.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
    const answered = lead.getByTestId('piece-panel-ask-answered')
    await expect(answered).toHaveAttribute('data-status', 'kept', { timeout: 20_000 })
    await expect(answered).toContainText('The client signed English off.')
    await lead.getByTestId('piece-panel-ask-reply').click()
    await expect(lead.getByTestId('piece-panel-ask-form')).toBeVisible()
    await lead.getByTestId('piece-panel-ask-form-cancel').click()
    await expect(lead.getByTestId('piece-panel-ask-form')).toHaveCount(0)
    await lead.context().close()
    expect((await asksOn(job.deliverableId)).filter((a) => a.status === 'pending')).toEqual([])
  })

  test('may: the account manager changes it — her own day applies', async ({ browser }) => {
    await rpcAs('lead', 'ask_deliverable_change', {
      p_deliverable: job.deliverableId, p_kinds: ['due_date'], p_reason: 'Two more days.', p_due_day: day(38), p_hours: null, p_from_sub_task: null,
    })
    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
    await am.getByTestId('piece-panel-ask-answer').click({ timeout: 20_000 })
    await am.getByTestId('piece-panel-ask-answer-dialog-mode-change').click()
    await am.getByTestId('piece-panel-ask-answer-dialog-due').fill(day(42))
    await am.getByTestId('piece-panel-ask-answer-dialog-hours').fill('10')
    await am.getByTestId('piece-panel-ask-answer-dialog-submit').click()
    await expect(am.getByTestId('piece-panel-ask-answer-dialog')).toHaveCount(0)
    await am.context().close()

    await expect.poll(async () => (await asksOn(job.deliverableId))[0]!.status).toBe('changed')
    expect((await asksOn(job.deliverableId))[0]!.applied_due_day).toBe(day(42))
    expect(iraqDayOf((await piece(job.deliverableId)).due_at)).toBe(day(42))
  })

  test('may: the account manager changes the due date in the panel, and the type, directly', async ({ browser }) => {
    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
    await am.getByTestId('piece-panel-due').fill(day(44))
    await am.getByTestId('piece-panel-save').click()
    await closeCampaignBanner(am)
    await expect.poll(async () => iraqDayOf((await piece(job.deliverableId)).due_at)).toBe(day(44))
    await am.context().close()

    const before = await piece(job.deliverableId)
    const [other] = await rows<{ id: string }>('deliverable_types', `select=id&id=neq.${before.deliverable_type_id}&is_active=eq.true&limit=1`)
    await rpcAs('am', 'change_deliverable_type', { p_deliverable: job.deliverableId, p_type: other!.id })
    expect((await piece(job.deliverableId)).deliverable_type_id).toBe(other!.id)
  })
})
