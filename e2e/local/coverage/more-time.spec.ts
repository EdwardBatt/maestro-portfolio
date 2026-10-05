import { test, expect } from '@playwright/test'
import { rows } from '../helpers/db'
import {
  as, assignAs, day, idOf, makeApprovedPiece, rpcAs, rpcRaw, taskRow, toldAbout, workday, type TaskRow,
} from '../helpers/i74'
import type { ReleasedJob } from '../helpers/single-job'

/**
 * Coverage — a maker asks her own lead for more time (I74.17, ADR-0141 d.5; Figma L SC-01 "Lujain wants Wednesday too").
 *
 * Made through the product: a Creative job released by the account manager, its list approved by its owner (the
 * Creative department lead), two tasks given to the maker (`maker`, Design) by that lead. The maker's lead is the
 * Design team lead (`tl`); the Design deputy (`deputy`) is asked only when the leader is on leave that day (ADR-0139
 * d.3) — she is not here.
 *
 *   may      the maker asks on her task page (Cancel first: nothing sent) — a pending ask, her lead told, the deputy and
 *            other leads not;
 *   may NOT  another team's lead (`motiontl`) is not shown it and is refused (not_the_answerer); the maker cannot answer
 *            her own; a person not on the task cannot ask — nothing changes;
 *   may      her lead says no with a reason (the empty reason is stopped on screen; Cancel backs out) — the maker reads it;
 *   may      asked again, her lead gives it — the task's due day moves, the maker is told;
 *   may      the maker withdraws an ask — it leaves her lead's list;
 *   may      a yes past the PIECE's due date opens the one change form to the account manager, filled in with that day.
 */
test.use({ actionTimeout: 15_000 })
test.describe.configure({ mode: 'serial' })

const iraqDayOf = (ts: string | null) => (ts ? new Date(Date.parse(ts) + 3 * 3_600_000).toISOString().slice(0, 10) : null)
type TimeAsk = { id: string; status: string; to_day: string; note: string | null; answer_note: string | null; asked_by: string }
const timeAsks = (subTaskId: string) =>
  rows<TimeAsk>('sub_task_time_asks', `select=id,status,to_day,note,answer_note,asked_by&sub_task_id=eq.${subTaskId}&order=created_at.desc`)

let job: ReleasedJob
let tasks: TaskRow[]
let taskDay: string

test.describe('Ask your lead for more time (I74.17)', () => {
  test.beforeAll(async ({ browser }) => {
    ;({ job, tasks } = await makeApprovedPiece(browser, `More time ${Date.now()}`))
    taskDay = workday(3)
    for (const t of tasks.slice(0, 2)) expect((await assignAs('lead', t.id, 'maker', 'lead', taskDay)).outcome).toBe('assigned')
  })

  test('may: the maker asks on her task page — Cancel sends nothing; Send waits on her lead, who is told', async ({ browser }) => {
    const t0 = tasks[0]!.id
    const mk = await as(browser, 'maker')
    await mk.goto(`/my-work/task/${t0}`)
    await mk.getByTestId('task-more-time-open').click({ timeout: 20_000 })
    await expect(mk.getByTestId('task-more-time')).toBeVisible()
    await mk.getByTestId('task-more-time-cancel').click()
    await expect(mk.getByTestId('task-more-time')).toHaveCount(0)
    expect(await timeAsks(t0)).toEqual([])

    await mk.getByTestId('task-more-time-open').click()
    await mk.getByTestId('task-more-time-day').fill(workday(6))
    await mk.getByTestId('task-more-time-note').fill('The client sent new copy late.')
    await mk.getByTestId('task-more-time-send').click()
    await expect(mk.getByTestId('task-more-time-pending')).toBeVisible()
    await mk.context().close()

    const [ask] = await timeAsks(t0)
    expect(ask).toMatchObject({ status: 'pending', to_day: workday(6), note: 'The client sent new copy late.', asked_by: await idOf('maker') })
    const told = await toldAbout('time_asked', t0)
    expect(told).toContain(await idOf('tl'))
    // The Team Leader is asked; the deputy only when she is on leave that day; never another team's lead.
    expect(told).not.toContain(await idOf('deputy'))
    expect(told).not.toContain(await idOf('motiontl'))
  })

  test('may NOT: another team\'s lead is not shown it and is refused; the maker cannot answer her own; a stranger cannot ask', async ({ browser }) => {
    const t0 = tasks[0]!.id
    const [ask] = await timeAsks(t0)
    const due = (await taskRow(t0)).due_at

    const motion = await as(browser, 'motiontl')
    await motion.goto('/schedule')
    await expect(motion.getByTestId('surface-schedule')).toBeVisible({ timeout: 20_000 })
    await expect(motion.getByTestId(`time-ask-${ask!.id}`)).toHaveCount(0)
    await motion.context().close()

    const other = await rpcRaw('motiontl', 'answer_more_time', { p_ask: ask!.id, p_give: true, p_note: null })
    expect(other.status, other.text).toBe(403)
    expect(other.text).toContain('not_the_answerer')
    const self = await rpcRaw('maker', 'answer_more_time', { p_ask: ask!.id, p_give: true, p_note: null })
    expect(self.status, self.text).toBe(403)
    expect(self.text).toContain('not_the_answerer')
    const stranger = await rpcRaw('writer', 'ask_more_time', { p_sub_task: tasks[1]!.id, p_to_day: workday(8), p_note: null })
    expect(stranger.status, stranger.text).toBe(403)

    expect((await timeAsks(t0))[0]!.status).toBe('pending')
    expect((await taskRow(t0)).due_at).toBe(due)
    expect(await timeAsks(tasks[1]!.id)).toEqual([])
  })

  test('may: her lead says no, with a reason — the task keeps its day and the maker reads why', async ({ browser }) => {
    const t0 = tasks[0]!.id
    const [ask] = await timeAsks(t0)
    const due = (await taskRow(t0)).due_at
    const tl = await as(browser, 'tl')
    await tl.goto('/schedule')
    await expect(tl.getByTestId(`time-ask-${ask!.id}`)).toBeVisible({ timeout: 20_000 })
    await tl.getByTestId(`time-ask-no-${ask!.id}`).click()
    await expect(tl.getByTestId(`time-ask-reason-${ask!.id}`)).toBeVisible()
    await tl.getByTestId(`time-ask-no-cancel-${ask!.id}`).click()
    await expect(tl.getByTestId(`time-ask-reason-${ask!.id}`)).toHaveCount(0)
    await tl.getByTestId(`time-ask-no-${ask!.id}`).click()
    // An empty reason is stopped on screen; nothing is sent.
    await tl.getByTestId(`time-ask-no-send-${ask!.id}`).click()
    await expect(tl.getByTestId(`time-ask-error-${ask!.id}`)).toBeVisible()
    expect((await timeAsks(t0))[0]!.status).toBe('pending')
    await tl.getByTestId(`time-ask-reason-${ask!.id}`).fill('The client presents on Sunday.')
    await tl.getByTestId(`time-ask-no-send-${ask!.id}`).click()
    await expect(tl.getByTestId(`time-ask-${ask!.id}`)).toHaveCount(0)
    await tl.context().close()

    await expect.poll(async () => (await timeAsks(t0))[0]!.status).toBe('refused')
    expect((await timeAsks(t0))[0]!.answer_note).toBe('The client presents on Sunday.')
    expect((await taskRow(t0)).due_at).toBe(due)
    expect(await toldAbout('time_answered', t0)).toContain(await idOf('maker'))

    const mk = await as(browser, 'maker')
    await mk.goto(`/my-work/task/${t0}`)
    await expect(mk.getByTestId('task-more-time-answer')).toContainText('The client presents on Sunday.', { timeout: 20_000 })
    await mk.context().close()
  })

  test('may: asked again, her lead gives it — the task\'s due day moves and the maker is told', async ({ browser }) => {
    const t0 = tasks[0]!.id
    const askId = await rpcAs<string>('maker', 'ask_more_time', { p_sub_task: t0, p_to_day: workday(7), p_note: 'Please.' })
    const tl = await as(browser, 'tl')
    await tl.goto('/schedule')
    await tl.getByTestId(`time-ask-give-${askId}`).click({ timeout: 20_000 })
    await expect(tl.getByTestId('schedule-toast')).toBeVisible()
    await expect(tl.getByTestId(`time-ask-${askId}`)).toHaveCount(0)
    // Not past the piece's due date: no change form.
    await expect(tl.getByTestId('time-ask-change')).toHaveCount(0)
    await tl.context().close()

    await expect.poll(async () => (await timeAsks(t0))[0]!.status).toBe('given')
    expect(iraqDayOf((await taskRow(t0)).due_at)).toBe(workday(7))
    // Told twice on this task: the no, then the yes.
    const maker = await idOf('maker')
    expect((await toldAbout('time_answered', t0)).filter((u) => u === maker)).toHaveLength(2)
  })

  test('may: the maker withdraws her ask — it leaves her lead\'s list', async ({ browser }) => {
    const t1 = tasks[1]!.id
    const mk = await as(browser, 'maker')
    await mk.goto(`/my-work/task/${t1}`)
    await mk.getByTestId('task-more-time-open').click({ timeout: 20_000 })
    await mk.getByTestId('task-more-time-day').fill(workday(5))
    await mk.getByTestId('task-more-time-send').click()
    await expect(mk.getByTestId('task-more-time-pending')).toBeVisible()
    const [ask] = await timeAsks(t1)
    await mk.getByTestId('task-more-time-withdraw').click()
    await expect(mk.getByTestId('task-more-time-open')).toBeVisible()
    await mk.context().close()
    await expect.poll(async () => (await timeAsks(t1))[0]!.status).toBe('withdrawn')
    expect(iraqDayOf((await taskRow(t1)).due_at)).toBe(taskDay)

    const tl = await as(browser, 'tl')
    await tl.goto('/schedule')
    await expect(tl.getByTestId('surface-schedule')).toBeVisible({ timeout: 20_000 })
    await expect(tl.getByTestId(`time-ask-${ask!.id}`)).toHaveCount(0)
    await tl.context().close()
  })

  test('may: a yes past the piece\'s due date opens the change form to the account manager, filled in', async ({ browser }) => {
    const t1 = tasks[1]!.id
    const pieceDue = iraqDayOf((await rows<{ due_at: string }>('deliverables', `select=due_at&id=eq.${job.deliverableId}`))[0]!.due_at)!
    const past = new Date(Date.parse(`${pieceDue}T12:00:00Z`) + 3 * 86_400_000).toISOString().slice(0, 10)
    expect(past > day(0)).toBe(true)
    const askId = await rpcAs<string>('maker', 'ask_more_time', { p_sub_task: t1, p_to_day: past, p_note: 'The shoot slipped.' })

    const tl = await as(browser, 'tl')
    await tl.goto('/schedule')
    await tl.getByTestId(`time-ask-give-${askId}`).click({ timeout: 20_000 })
    const form = tl.getByTestId('time-ask-change')
    await expect(form).toBeVisible()
    await expect(tl.getByTestId('time-ask-change-moved')).toBeVisible()
    await expect(tl.getByTestId('time-ask-change-kind-due_date')).toHaveAttribute('aria-pressed', 'true')
    await expect(tl.getByTestId('time-ask-change-due')).toHaveValue(past)
    await tl.getByTestId('time-ask-change-reason').fill('The maker needs past the client date.')
    await tl.getByTestId('time-ask-change-send').click()
    await expect(form).toHaveCount(0)
    await tl.context().close()

    // Its own ask, by id: the test before this one asked and withdrew on the same task a moment earlier, and "newest
    // first" by creation time cannot tell two asks a second apart.
    await expect.poll(async () => (await timeAsks(t1)).find((x) => x.id === askId)?.status).toBe('given')
    expect(iraqDayOf((await taskRow(t1)).due_at)).toBe(past)
    const asks = await rows<{ status: string; requested_due_day: string; from_sub_task_id: string; asked_by: string }>(
      'deliverable_change_asks', `select=status,requested_due_day,from_sub_task_id,asked_by&deliverable_id=eq.${job.deliverableId}`)
    expect(asks).toEqual([{ status: 'pending', requested_due_day: past, from_sub_task_id: t1, asked_by: await idOf('tl') }])
    expect(await toldAbout('deliverable_change_asked', job.deliverableId)).toContain(await idOf('am'))
    // The piece's own date is not moved by the lead's yes.
    expect(iraqDayOf((await rows<{ due_at: string }>('deliverables', `select=due_at&id=eq.${job.deliverableId}`))[0]!.due_at)).toBe(pieceDue)
  })
})
