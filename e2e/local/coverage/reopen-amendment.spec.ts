import { test, expect } from '@playwright/test'
import { rows } from '../helpers/db'
import { closeCampaignBanner } from '../helpers/piece'
import { pickPerson } from '../helpers/campaign-wizard'
import {
  as, assignAs, day, idOf, makeApprovedPiece, PEOPLE, restAs, rpcAs, rpcRaw, taskRow, toldAbout, workday, type TaskRow,
} from '../helpers/i74'
import type { ReleasedJob } from '../helpers/single-job'

/**
 * Coverage — a re-opened task goes back to the person who made it; a client amendment is counted (ADR-0142, I74.18–I74.20).
 *
 * Finished work is MADE through the product's doors, signed in as each person: the account manager releases a Creative
 * job, its owner (the Creative department lead — `lead`) approves the list, every task is given to the maker (`maker`)
 * with the lead reviewing, the maker starts and submits each, the lead approves each; the piece closes.
 *
 *   may NOT  another department's lead (`content`) and a team member (`maker`) are offered no Re-open, and the door
 *            refuses them — nothing re-opened, nothing counted;
 *   may      the drawer's Re-open asks WHY first (client amendment / our own fix); as a client amendment with hours it
 *            goes back to the MAKER (not unassigned — ADR-0121 reversed), is recorded with its kind, the maker is told,
 *            and the piece reads "Amend 1"; the campaign and the client count it for the month;
 *   may      a task's own Re-open as our own fix goes back to the maker too — and is not counted as an amendment;
 *   may      the lead gives a re-opened task to someone else in the same step (Who).
 */
test.use({ actionTimeout: 15_000 })
test.describe.configure({ mode: 'serial' })

let job: ReleasedJob
let tasks: TaskRow[]
let maker: string

const reopenings = (subTaskId: string) =>
  rows<{ kind: string; hours: number | null; assignee_id: string | null; reopened_by: string | null }>(
    'sub_task_reopenings', `select=kind,hours,assignee_id,reopened_by&sub_task_id=eq.${subTaskId}&order=reopened_at.desc`)

test.describe('Re-open as a client amendment, back to its maker (ADR-0142)', () => {
  test.beforeAll(async ({ browser }) => {
    ;({ job, tasks } = await makeApprovedPiece(browser, `Amend ${Date.now()}`))
    maker = await idOf('maker')
    const leadId = await idOf('lead')
    const [{ tenant_id }] = await rows<{ tenant_id: string }>('campaigns', `select=tenant_id&id=eq.${job.campaignId}`)
    for (const t of tasks) {
      expect((await assignAs('lead', t.id, 'maker', 'lead', workday(1))).outcome).toBe('assigned')
      await rpcAs('maker', 'sub_task_start', { p_id: t.id })
      const fb = await restAs('maker', 'POST', 'review_feedback', '', { tenant_id, sub_task_id: t.id, body: `Done: ${t.title}.`, author_user_id: maker })
      expect(fb.status, fb.text).toBeLessThan(300)
      await rpcAs('maker', 'sub_task_submit', { p_id: t.id, p_manual_minutes: null, p_accept_untimed: true })
      await rpcAs('lead', 'sub_task_approve', { p_sub_task: t.id })
    }
    expect(leadId).toBeTruthy()
    await expect
      .poll(async () => (await rows<{ state: string }>('deliverables', `select=state&id=eq.${job.deliverableId}`))[0]!.state)
      .toBe('approved')
  })

  test('may NOT: another department\'s lead and a team member are offered no Re-open and are refused — nothing changes', async ({ browser }) => {
    for (const tag of ['content', 'maker'] as const) {
      const p = await as(browser, tag)
      await p.goto(`/campaigns/${job.campaignId}`)
      await p.getByTestId('campaign-tab-grid').click()
      await p.getByTestId(`campaign-deliverable-open-${job.deliverableId}`).click()
      await expect(p.getByTestId('piece-drawer')).toBeVisible()
      await expect(p.getByTestId('piece-drawer-reopen')).toHaveCount(0)
      await p.context().close()

      const res = await rpcRaw(tag, 'reopen_task', {
        p_sub_task: tasks[0]!.id, p_reason: 'x', p_due_at: `${day(6)}T15:00:00Z`, p_kind: 'client_amendment', p_hours: null, p_reviewers: null,
      })
      expect(res.status, res.text).toBe(403)
      expect(res.text).toMatch(/outside your reach/)
    }
    expect((await taskRow(tasks[0]!.id)).status).toBe('done')
    expect(await reopenings(tasks[0]!.id)).toEqual([])
  })

  test('may: the drawer\'s Re-open as a client amendment — back to the maker, counted, the maker told, "Amend 1"', async ({ browser }) => {
    const t0 = tasks[0]!
    const lead = await as(browser, 'lead')
    await lead.goto(`/campaigns/${job.campaignId}`)
    await lead.getByTestId('campaign-tab-grid').click()
    await lead.getByTestId(`campaign-deliverable-open-${job.deliverableId}`).click()
    await expect(lead.getByTestId('piece-drawer-amend')).toHaveCount(0)
    await lead.getByTestId('piece-drawer-reopen').click()
    await expect(lead.getByTestId('reopen-dialog')).toBeVisible()
    await lead.getByTestId(`reopen-dialog-task-${t0.id}`).check()
    await lead.getByTestId('reopen-dialog-reason').fill('The client wants the logo bigger.')
    await lead.getByTestId('reopen-dialog-due').fill(day(6))
    // WHY is asked first: not ready without it.
    await expect(lead.getByTestId('reopen-dialog-submit')).toBeDisabled()
    await lead.getByTestId('reopen-dialog-kind-own_fix').click()
    await expect(lead.getByTestId('reopen-dialog-kind-own_fix')).toHaveAttribute('aria-checked', 'true')
    await lead.getByTestId('reopen-dialog-kind-client_amendment').click()
    await expect(lead.getByTestId('reopen-dialog-kind-client_amendment')).toHaveAttribute('aria-checked', 'true')
    await lead.getByTestId('reopen-dialog-hours').fill('3')
    // One task ticked: the maker is the one it goes back to.
    await expect(lead.getByTestId('reopen-dialog-who')).toBeVisible()
    await lead.getByTestId('reopen-dialog-submit').click()
    await closeCampaignBanner(lead)

    await expect.poll(async () => (await taskRow(t0.id)).status).toBe('todo')
    expect((await taskRow(t0.id)).assignee_id, 'back with the person who made it (ADR-0142 d.2)').toBe(maker)
    const [rec] = await reopenings(t0.id)
    expect(rec).toMatchObject({ kind: 'client_amendment', assignee_id: maker, reopened_by: await idOf('lead') })
    expect(Number(rec!.hours)).toBe(3)
    expect(await toldAbout('task_reopened', t0.id)).toContain(maker)
    expect((await rows<{ state: string }>('deliverables', `select=state&id=eq.${job.deliverableId}`))[0]!.state).toBe('in_progress')

    // Counted: the piece's "Amend 1", the campaign's month line.
    await lead.goto(`/campaigns/${job.campaignId}`)
    await expect(lead.getByText('1 amendment this month', { exact: false })).toBeVisible({ timeout: 20_000 })
    await lead.getByTestId('campaign-tab-grid').click()
    await lead.getByTestId(`campaign-deliverable-open-${job.deliverableId}`).click()
    await expect(lead.getByTestId('piece-drawer-amend')).toHaveText('Amend 1')
    await lead.context().close()

    // The one read both pages use: this piece and this campaign count exactly one; the client at least one.
    const summary = await rpcAs<{ level: string; id: string; amendments: number; hours: number }[]>('am', 'amendment_summary', { p_month: day(0) })
    const [{ client_id }] = await rows<{ client_id: string }>('campaigns', `select=client_id&id=eq.${job.campaignId}`)
    expect(Number(summary.find((r) => r.level === 'deliverable' && r.id === job.deliverableId)?.amendments)).toBe(1)
    expect(Number(summary.find((r) => r.level === 'campaign' && r.id === job.campaignId)?.amendments)).toBe(1)
    expect(Number(summary.find((r) => r.level === 'client' && r.id === client_id)?.amendments)).toBeGreaterThanOrEqual(1)

    // The account manager sees the client's month on the client page.
    const am = await as(browser, 'am')
    await am.goto(`/clients/${client_id}`)
    await expect(am.getByTestId('client-page')).toContainText(/amendments? this month/, { timeout: 20_000 })
    await am.context().close()
  })

  test('may: a task\'s own Re-open as our own fix — back to the maker; not counted as an amendment', async ({ browser }) => {
    const t1 = tasks[1]!
    const lead = await as(browser, 'lead')
    await lead.goto(`/my-work/task/${t1.id}`)
    await lead.getByTestId(`subtask-reopen-${t1.id}`).click()
    await expect(lead.getByTestId(`reopen-dialog-task-${t1.id}`)).toBeChecked()
    await lead.getByTestId('reopen-dialog-kind-own_fix').click()
    await lead.getByTestId('reopen-dialog-reason').fill('A typo in the caption.')
    await lead.getByTestId('reopen-dialog-due').fill(day(7))
    await lead.getByTestId('reopen-dialog-submit').click()
    await expect.poll(async () => (await taskRow(t1.id)).status).toBe('todo')
    expect((await taskRow(t1.id)).assignee_id).toBe(maker)
    expect((await reopenings(t1.id))[0]).toMatchObject({ kind: 'own_fix', assignee_id: maker })
    expect(await toldAbout('task_reopened', t1.id)).toContain(maker)
    await lead.context().close()

    const summary = await rpcAs<{ level: string; id: string; amendments: number }[]>('am', 'amendment_summary', { p_month: day(0) })
    expect(Number(summary.find((r) => r.level === 'deliverable' && r.id === job.deliverableId)?.amendments), 'an own fix is not an amendment').toBe(1)
  })

  test('may: the lead gives a re-opened task to someone else in the same step', async ({ browser }) => {
    const t2 = tasks[2]!
    const lead = await as(browser, 'lead')
    await lead.goto(`/my-work/task/${t2.id}`)
    await lead.getByTestId(`subtask-reopen-${t2.id}`).click()
    await lead.getByTestId('reopen-dialog-kind-client_amendment').click()
    await lead.getByTestId('reopen-dialog-reason').fill('The client wants a second version.')
    await lead.getByTestId('reopen-dialog-due').fill(day(8))
    await pickPerson(lead, 'reopen-dialog-who', PEOPLE.deputy.name)
    await lead.getByTestId('reopen-dialog-submit').click()
    const deputy = await idOf('deputy')
    await expect.poll(async () => (await taskRow(t2.id)).assignee_id, { timeout: 20_000 }).toBe(deputy)
    expect((await taskRow(t2.id)).status).toBe('todo')
    // The record keeps the maker it went back to; the reassignment is the ordinary assignment after it.
    expect((await reopenings(t2.id))[0]).toMatchObject({ kind: 'client_amendment', assignee_id: maker })
    await lead.context().close()
  })
})
