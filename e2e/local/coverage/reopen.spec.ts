import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { attemptWrite, rows, userIdOf } from '../helpers/db'
import { releaseSingleJob, type ReleasedJob } from '../helpers/single-job'
import { approveTaskList } from '../helpers/piece'

/**
 * Coverage — re-opening finished work (ADR-0103, I58.7–I58.8) and a job's brief after release
 * and promotion (ADR-0104, I57.40–I57.41).
 *
 * The finished work is MADE here, through the product: a Creative job is released, its owner (the
 * Creative lead) approves the task list, two tasks are given to the maker, who starts and submits
 * them, and the lead approves them — the doors My Work and the review panel call, signed in as each
 * person. The last approval closes the deliverable (ADR-0077). Then every re-open control is pressed:
 *
 *   * the deliverables list's Re-open opens the dialog (the bare move is fenced) — cancelled;
 *   * the campaign drawer's Re-open, one task ticked — the task is To do and back to be assigned (ADR-0121);
 *   * an approved task's own Re-open, that task ticked — cancelled once, then sent;
 *   * may NOT: another department's lead is offered no Re-open; a team member neither;
 *   * a CLOSED campaign re-opens from its page (the one staged state: closing needs finished work,
 *     so the status is set with the service role and the test says so);
 *   * ADR-0104: the released job's brief is edited by hand; promoted, its Brief view generates the
 *     campaign brief (the model's reading mocked at the network edge) and the edit is saved.
 */
const API = 'http://127.0.0.1:54321'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
type Tag = keyof typeof PEOPLE

async function as(browser: Browser, tag: Tag): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}
/** A fresh token for a person — the saved login can be an hour old. */
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
async function insertAs(tag: Tag, table: string, row: Record<string, unknown>) {
  const res = await fetch(`${API}/rest/v1/${table}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${await tokenOf(tag)}`, 'content-type': 'application/json' },
    body: JSON.stringify(row),
  })
  expect(res.status, `insert ${table} as ${tag}: ${await res.text()}`).toBeLessThan(300)
}
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
const taskRow = async (id: string) =>
  (await rows<{ status: string; assignee_id: string | null; approved_at: string | null }>('sub_tasks', `select=status,assignee_id,approved_at&id=eq.${id}`))[0]

let job: ReleasedJob
let taskA: { id: string; title: string }
let taskB: { id: string; title: string }
let maker: string

test.describe.configure({ mode: 'serial' })

test.describe('Re-opening finished work (ADR-0103) and a job\'s brief (ADR-0104)', () => {
  test.beforeAll(async ({ browser }) => {
    const am = await as(browser, 'am')
    job = await releaseSingleJob(am, { title: `Reopen ${Date.now()}`, department: 'Creative', type: 'Social Advertisement' })
    await am.context().close()
    // The owner approves the task list on the piece's panel (ADR-0132 d.2; I71.1).
    const lead = await as(browser, 'lead')
    await approveTaskList(lead, job)
    await lead.context().close()

    const tasks = await rows<{ id: string; title: string }>('sub_tasks', `select=id,title&deliverable_id=eq.${job.deliverableId}&order=sort_order.asc,unit_index.asc`)
    ;[taskA, taskB] = tasks
    maker = await userIdOf(PEOPLE.maker.email)
    const lead_ = await userIdOf(PEOPLE.lead.email)
    const [{ tenant_id }] = await rows<{ tenant_id: string }>('campaigns', `select=tenant_id&id=eq.${job.campaignId}`)
    // EVERY task on the list is done, so the job is approved; A and B are the two re-opened below. (The type's
    // list has four; settling only A and B left the piece in progress.)
    for (const t of tasks) {
      const out = await rpcAs<{ outcome: string }[]>('lead', 'update_task_assignment', {
        p_sub_task: t.id, p_title: t.title, p_assignee: maker,
        p_reviewers: [{ user_id: lead_, is_mandatory: true }],
        p_starts_at: `${day(0)}T06:00:00Z`, p_due_at: `${day(1)}T14:00:00Z`, p_hours: 2, p_review_mode: 'manual',
      })
      expect(out[0]?.outcome).toBe('assigned')
      await rpcAs('maker', 'sub_task_start', { p_id: t.id })
      await insertAs('maker', 'review_feedback', { tenant_id, sub_task_id: t.id, body: `Done: ${t.title}.`, author_user_id: maker })
      // Sent straight after Start on purpose (the round's timing is not what this covers): an
      // untimed round is refused unless accepted (ADR-0106 d.2), so it is accepted — as "Send anyway".
      await rpcAs('maker', 'sub_task_submit', { p_id: t.id, p_manual_minutes: null, p_accept_untimed: true })
      await rpcAs('lead', 'sub_task_approve', { p_sub_task: t.id })
    }
    expect((await taskRow(taskA.id)).status).toBe('done')
    await expect
      .poll(async () => (await rows<{ state: string }>('deliverables', `select=state&id=eq.${job.deliverableId}`))[0].state)
      .toBe('approved')
  })

  test('ADR-0104 d.3: the released job\'s brief is edited by hand; the approval stamp stays', async ({ browser }) => {
    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${job.campaignId}?tab=brief`)
    await am.getByTestId('campaign-tab-brief').click()
    const edit = am.locator('[data-testid^="campaign-department-brief-"][data-testid$="-edit"]').first()
    await expect(edit).toBeVisible()
    const editId = (await edit.getAttribute('data-testid'))!
    const key = editId.replace('campaign-department-brief-', '').replace(/-edit$/, '')
    await am.getByTestId(`campaign-department-brief-${key}-edit`).click()
    await am.getByTestId(`campaign-department-brief-${key}-input-task`).fill('Design one teaser, Arabic first.')
    await am.getByTestId(`campaign-department-brief-${key}-save`).click()
    await expect(am.getByTestId(`campaign-department-brief-${key}-editing`)).toHaveCount(0)
    await expect
      .poll(async () => (await rows<{ values: { task?: string }; approved_at: string | null }>('campaign_briefs', `select=values,approved_at&campaign_id=eq.${job.campaignId}`))[0])
      .toMatchObject({ values: { task: 'Design one teaser, Arabic first.' } })
    const [b] = await rows<{ approved_at: string | null }>('campaign_briefs', `select=approved_at&campaign_id=eq.${job.campaignId}`)
    expect(b.approved_at, 'the approval stamp stays').not.toBeNull()
    await am.context().close()
  })

  test('the deliverables list\'s Re-open opens the dialog — the bare move is gone — and Cancel changes nothing', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await lead.goto('/deliverables')
    await lead.getByTestId('deliverables-campaign').selectOption(job.campaignId)
    await lead.getByTestId(`deliverable-reopen-${job.deliverableId}`).click()
    await expect(lead.getByTestId('reopen-dialog')).toBeVisible()
    await expect(lead.getByTestId(`reopen-dialog-task-${taskA.id}`)).toBeVisible()
    await expect(lead.getByTestId(`reopen-dialog-task-${taskB.id}`)).toBeVisible()
    await expect(lead.getByTestId('reopen-dialog-submit')).toBeDisabled()
    await lead.getByTestId('reopen-dialog-cancel').click()
    await expect(lead.getByTestId('reopen-dialog')).toHaveCount(0)
    expect((await rows<{ state: string }>('deliverables', `select=state&id=eq.${job.deliverableId}`))[0].state).toBe('approved')
    await lead.context().close()
  })

  test('may NOT: another department\'s lead and a team member are offered no Re-open', async ({ browser }) => {
    const content = await as(browser, 'content')
    await content.goto(`/campaigns/${job.campaignId}`)
    await content.getByTestId('campaign-tab-grid').click()
    await content.getByTestId(`campaign-deliverable-open-${job.deliverableId}`).click()
    await expect(content.getByTestId('piece-drawer')).toBeVisible()
    await expect(content.getByTestId('piece-drawer-reopen')).toHaveCount(0)
    await content.context().close()
    // And the door itself refuses them, in words.
    const res = await fetch(`${API}/rest/v1/rpc/reopen_task`, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${await tokenOf('content')}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_sub_task: taskA.id, p_reason: 'x', p_due_at: `${day(5)}T15:00:00Z` }),
    })
    expect(res.status).toBe(403)
    expect(await res.text()).toMatch(/outside your reach/)

    // A team member reads the campaign; the drawer offers them no Re-open either.
    const mk = await as(browser, 'maker')
    await mk.goto(`/campaigns/${job.campaignId}`)
    await mk.getByTestId('campaign-tab-grid').click()
    await mk.getByTestId(`campaign-deliverable-open-${job.deliverableId}`).click()
    await expect(mk.getByTestId('piece-drawer')).toBeVisible()
    await expect(mk.getByTestId('piece-drawer-reopen')).toHaveCount(0)
    await mk.context().close()
  })

  test('the drawer\'s Re-open: one task ticked, a kind chosen — it is To do and back with its maker (ADR-0142); the other stays approved', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await lead.goto(`/campaigns/${job.campaignId}`)
    await lead.getByTestId('campaign-tab-grid').click()
    await lead.getByTestId(`campaign-deliverable-open-${job.deliverableId}`).click()
    await lead.getByTestId('piece-drawer-reopen').click()
    await expect(lead.getByTestId('reopen-dialog')).toBeVisible()
    await lead.getByTestId(`reopen-dialog-task-${taskA.id}`).check()
    await lead.getByTestId('reopen-dialog-reason').fill('The client changed the headline.')
    await lead.getByTestId('reopen-dialog-due').fill(day(6))
    // ADR-0142 d.1: a re-open says what kind it is — Send waits for one.
    await expect(lead.getByTestId('reopen-dialog-submit')).toBeDisabled()
    await lead.getByTestId('reopen-dialog-kind-client_amendment').click()
    await lead.getByTestId('reopen-dialog-submit').click()
    await expect(lead.getByTestId('campaign-banner')).toBeVisible()
    await lead.getByTestId('campaign-banner-close').click()

    await expect.poll(async () => (await taskRow(taskA.id)).status).toBe('todo')
    // ADR-0142 d.2 (reversing ADR-0121): back to the person who made it, approval cleared.
    expect(await taskRow(taskA.id)).toMatchObject({ assignee_id: maker, approved_at: null })
    expect((await taskRow(taskB.id)).status).toBe('done')
    expect((await rows<{ state: string }>('deliverables', `select=state&id=eq.${job.deliverableId}`))[0].state).toBe('in_progress')
    // The maker is told (d.2: "the maker is now told too"); the one who re-opened it is not.
    await expect.poll(async () => (await rows<{ user_id: string }>('notifications', `select=user_id&type=eq.task_reopened&entity_id=eq.${taskA.id}`)).map((n) => n.user_id)).toContain(maker)
    const told = await rows<{ user_id: string }>('notifications', `select=user_id&type=eq.task_reopened&entity_id=eq.${taskA.id}`)
    expect(told.map((n) => n.user_id)).not.toContain(await userIdOf(PEOPLE.lead.email))
    const [rec] = await rows<{ kind: string }>('sub_task_reopenings', `select=kind&sub_task_id=eq.${taskA.id}&order=reopened_at.desc`)
    expect(rec!.kind).toBe('client_amendment')
    await lead.context().close()
  })

  test('an approved task\'s own Re-open: arrives ticked; Cancel keeps it, Send re-opens it', async ({ browser }) => {
    // The task's own row is on its page since ADR-0132 d.8 retired the deliverable window (I71.1).
    const lead = await as(browser, 'lead')
    await lead.goto(`/my-work/task/${taskB.id}`)
    await lead.getByTestId(`subtask-reopen-${taskB.id}`).click()
    await expect(lead.getByTestId(`reopen-dialog-task-${taskB.id}`)).toBeChecked()
    await lead.getByTestId('reopen-dialog-cancel').click()
    expect((await taskRow(taskB.id)).status).toBe('done')

    await lead.getByTestId(`subtask-reopen-${taskB.id}`).click()
    await lead.getByTestId('reopen-dialog-reason').fill('Resize for the new placement.')
    await lead.getByTestId('reopen-dialog-due').fill(day(7))
    await lead.getByTestId('reopen-dialog-kind-own_fix').click()
    await lead.getByTestId('reopen-dialog-submit').click()
    await expect.poll(async () => (await taskRow(taskB.id)).status).toBe('todo')
    expect((await taskRow(taskB.id)).assignee_id, 'back with its maker (ADR-0142 d.2)').toBe(maker)
    await expect(lead.getByTestId(`subtask-reopen-${taskB.id}`)).toHaveCount(0)
    await lead.context().close()
  })

  test('a CLOSED campaign re-opens from its page', async ({ browser }) => {
    // Staged: closing out needs every piece finished, and this job's other tasks never are.
    const staged = await attemptWrite('PATCH', 'campaigns', `id=eq.${job.campaignId}`, { status: 'closed', closed_at: new Date().toISOString() })
    expect(staged.status).toBeLessThan(300)
    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${job.campaignId}`)
    await am.getByTestId('campaign-reopen').click()
    await expect(am.getByTestId('campaign-banner')).toBeVisible()
    await expect.poll(async () => (await rows<{ status: string }>('campaigns', `select=status&id=eq.${job.campaignId}`))[0].status).toBe('approved')
    await am.getByTestId('campaign-banner-close').click()
    await expect(am.getByTestId('campaign-reopen')).toHaveCount(0)
    await am.context().close()
  })

  test('ADR-0104: promoted, the job leaves its brief alone and the Brief view generates the campaign brief', async ({ browser }) => {
    const am = await as(browser, 'am')
    await am.route('**/functions/v1/ingest-brief', (route) => route.fulfill({ json: {
      fields: { proposition: 'Every purchase is a ticket.', insight: 'A purchase already feels like a small win.' },
      oversized: [],
    } }))
    await am.goto('/campaigns')
    await am.getByTestId('campaigns-scope-all').click()
    await am.getByTestId('campaigns-search').fill(job.title)
    await am.getByTestId(`campaign-menu-${job.campaignId}`).click()
    await am.getByTestId(`campaign-promote-${job.campaignId}`).click()
    await am.getByTestId('campaign-promote-confirm').click()
    await expect.poll(async () => (await rows<{ kind: string }>('campaigns', `select=kind&id=eq.${job.campaignId}`))[0].kind).toBe('campaign')
    const [legacy] = await rows<{ approved_at: string | null; values: { task?: string } }>('campaign_briefs', `select=approved_at,values&campaign_id=eq.${job.campaignId}`)
    expect(legacy.approved_at, 'the job\'s brief stays approved (d.1)').not.toBeNull()
    expect(legacy.values.task).toBe('Design one teaser, Arabic first.')

    await am.goto(`/campaigns/${job.campaignId}?tab=brief`)
    await am.getByTestId('campaign-tab-brief').click()
    await am.getByTestId('campaign-brief-generate').click()
    await expect(am.getByTestId('campaign-master-brief-field-proposition')).toHaveValue('Every purchase is a ticket.')
    await am.getByTestId('campaign-banner-close').click()
    await am.getByTestId('campaign-master-brief-save').click()
    await expect
      .poll(async () => (await rows<{ brief: { proposition?: string; insight?: string } }>('campaigns', `select=brief&id=eq.${job.campaignId}`))[0].brief.proposition)
      .toBe('Every purchase is a ticket.')
    await expect(am.getByTestId('campaign-master-brief')).toContainText('Every purchase is a ticket.')
    await am.context().close()
  })
})
