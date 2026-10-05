import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows, userIdOf } from '../helpers/db'
import { releaseSingleJob, type ReleasedJob } from '../helpers/single-job'

/**
 * The campaign page's live counts (I52.9 / I52.10, Edward 17 Sep), on the GRID since 24 Sep: the
 * rings came off the page (CG-01, option a) and the same facts are the Executed column — everyone
 * holding a task on the piece, and how many tasks nobody has. They move when a task is added,
 * assigned or cancelled, and a page left open catches up on its own instead of going stale.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}
const API = 'http://127.0.0.1:54321'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
/** The door the Schedule's assignment calls, as the person (ADR-0132: assigning is not done in the panel). */
async function rpcAs<T = unknown>(tag: keyof typeof PEOPLE, fn: string, args: Record<string, unknown>): Promise<T> {
  const tok = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email: PEOPLE[tag].email, password: 'devpassword' }),
  }).then((r) => r.json() as Promise<{ access_token: string }>)
  const res = await fetch(`${API}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${tok.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  })
  const body = await res.text()
  expect(res.status, `${fn} as ${tag}: ${body}`).toBeLessThan(300)
  return (body ? JSON.parse(body) : null) as T
}
/** The same door, returning the status and words instead of judging them (for refusals). */
async function rpcRaw(tag: keyof typeof PEOPLE, fn: string, args: Record<string, unknown>): Promise<{ status: number; text: string }> {
  const tok = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email: PEOPLE[tag].email, password: 'devpassword' }),
  })
  const { access_token } = (await tok.json()) as { access_token: string }
  const res = await fetch(`${API}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  })
  return { status: res.status, text: await res.text() }
}
const dueIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
/** ADR-0097 d.7: the deliverable is one of the 260, chosen by typing (the picker replaced the select). */
async function pickDeliverable(page: Page, testId: string, query: string) {
  await page.getByTestId(testId).fill(query)
  await page.getByTestId(`${testId}-list`).getByRole('option', { name: new RegExp(query) }).first().dispatchEvent('mousedown')
  await expect(page.getByTestId(`${testId}-chip`)).toBeVisible()
}
let job: ReleasedJob

test.describe('Campaign grid counts — who is on each piece, and what nobody has', () => {
  test.beforeAll(async ({ browser }) => {
    const am = await as(browser, 'am')
    job = await releaseSingleJob(am, { title: `Rings ${Date.now()}`, department: 'Creative', type: 'Social Advertisement' })
    await am.context().close()
  })

  test('a released job on the grid: its n tasks, nobody on them yet, its task list pending', async ({ browser }) => {
    const n = (await rows('sub_tasks', `select=id&deliverable_id=eq.${job.deliverableId}&status=neq.cancelled`)).length
    expect(n).toBeGreaterThan(0)
    const lead = await as(browser, 'lead')
    await lead.goto(`/campaigns/${job.campaignId}`)
    await expect(lead.getByTestId(`campaign-deliverable-name-${job.deliverableId}`)).toHaveText('Social Advertisement')
    await expect(lead.getByTestId(`campaign-grid-executed-${job.deliverableId}`)).toHaveText(`${n} unassigned`)
    await expect(lead.getByTestId(`campaign-grid-approved-${job.deliverableId}`)).toContainText('Pending')
    await expect(lead.getByTestId('campaign-status-overall')).toHaveCount(0)   // no rings (24 Sep)
    await lead.context().close()
  })

  test('editing a deliverable (ADR-0141): the account manager renames it in the panel; the department lead reads it and is offered Ask; a lead of another department neither; a failure carries Report', async ({ browser }) => {
    // May NOT (ADR-0141 d.1–d.2): the department lead reads the piece's fields and is offered "Ask … to change it".
    const lead = await as(browser, 'lead')
    await lead.goto(`/campaigns/${job.campaignId}`)
    await lead.getByTestId('campaign-tab-grid').click()
    await expect(lead.getByTestId(`campaign-deliverable-name-${job.deliverableId}`)).toHaveText('Social Advertisement')
    await lead.getByTestId(`campaign-deliverable-edit-${job.deliverableId}`).click()
    await expect(lead.getByTestId('piece-panel')).toBeVisible()
    await expect(lead.getByTestId('piece-panel-ask-ask')).toBeVisible()
    expect(await lead.getByTestId('piece-panel-name').count(), 'the name is read-only for the department lead').toBe(0)
    expect(await lead.getByTestId('piece-panel-quantity').count(), 'the quantity is read-only for the department lead').toBe(0)
    await lead.context().close()

    // MAY: the account manager. Closing unsaved changes nothing.
    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${job.campaignId}`)
    await am.getByTestId('campaign-tab-grid').click()
    await am.getByTestId(`campaign-deliverable-edit-${job.deliverableId}`).click()
    await expect(am.getByTestId('piece-panel')).toBeVisible()
    await am.getByTestId('piece-panel-name').fill('Never saved')
    await am.getByTestId('piece-drawer-x').click()
    await expect(am.getByTestId('piece-panel')).toHaveCount(0)
    await expect(am.getByTestId(`campaign-deliverable-name-${job.deliverableId}`)).toHaveText('Social Advertisement')
    // A blank name is refused, in words.
    await am.getByTestId(`campaign-deliverable-edit-${job.deliverableId}`).click()
    await am.getByTestId('piece-panel-name').fill('   ')
    await am.getByTestId('piece-panel-save').click()
    await expect(am.getByTestId('campaign-banner')).toContainText(/name/i)
    await am.getByTestId('campaign-banner-close').click()
    // Save renames it and sets the quantity — the quantity on live work asked first (ADR-0132 d.3).
    await am.getByTestId('piece-panel-name').fill('Ramadan teaser posts')
    await am.getByTestId('piece-panel-quantity').fill('2')
    await am.getByTestId('piece-panel-save').click()
    await am.getByTestId('piece-panel-quantity-confirm-confirm').click()
    await expect(am.getByTestId('campaign-banner')).toContainText(/saved/i)
    await am.getByTestId('campaign-banner-close').click()
    await expect(am.getByTestId(`campaign-deliverable-name-${job.deliverableId}`)).toHaveText('Ramadan teaser posts')
    await expect.poll(async () => (await rows<{ name: string; quantity: number }>('deliverables', `select=name,quantity&id=eq.${job.deliverableId}`))[0]).toEqual({ name: 'Ramadan teaser posts', quantity: 2 })
    await am.context().close()

    // May NOT: the Content team lead — no field to change, and the server refuses in words; nothing changed.
    const other = await as(browser, 'copytl')
    await other.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
    await expect(other.getByTestId('piece-drawer')).toBeVisible({ timeout: 20_000 })
    expect(await other.getByTestId('piece-panel-name').count()).toBe(0)
    await other.context().close()
    const refused = await rpcRaw('copytl', 'update_piece_details', { p_deliverable: job.deliverableId, p_channel: 'Not mine', p_languages: null, p_notes: null }) // I74.35: the function takes p_languages text[]
    expect(refused.status).toBeGreaterThanOrEqual(400)
    expect(refused.text).toMatch(/ask_account_manager|outside your reach/)
    expect((await rows<{ name: string; channel: string | null }>('deliverables', `select=name,channel&id=eq.${job.deliverableId}`))[0])
      .toMatchObject({ name: 'Ramadan teaser posts' })
    expect((await rows<{ channel: string | null }>('deliverables', `select=channel&id=eq.${job.deliverableId}`))[0].channel).not.toBe('Not mine')

    // A FAILURE (the function missing on the server) is worded and carries Report; a refusal does not (ADR-0092).
    const broken = await as(browser, 'am')
    for (const fn of ['update_campaign_deliverable', 'update_piece_details', 'edit_piece_directly']) {
      await broken.route(`**/rest/v1/rpc/${fn}*`, (route) =>
        route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` }) }),
      )
    }
    await broken.goto(`/campaigns/${job.campaignId}`)
    await broken.getByTestId('campaign-tab-grid').click()
    await broken.getByTestId(`campaign-deliverable-edit-${job.deliverableId}`).click()
    await broken.getByTestId('piece-panel-name').fill('Will fail')
    await broken.getByTestId('piece-panel-save').click()
    const failure = broken.getByTestId('campaign-banner')
    await expect(failure).toContainText(/did not work|could not/i)
    await expect(failure).not.toContainText(/schema cache/)
    await expect(broken.getByTestId('campaign-banner-report')).toBeVisible()
    await broken.getByTestId('campaign-banner-close').click()
    await broken.context().close()

    // Back to the name and quantity the tests below expect (the quantity down asked first too).
    const back = await as(browser, 'am')
    await back.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
    await back.getByTestId('piece-panel-name').fill('Social Advertisement')
    await back.getByTestId('piece-panel-quantity').fill('1')
    await back.getByTestId('piece-panel-save').click()
    await back.getByTestId('piece-panel-quantity-confirm-confirm').click()
    await expect(back.getByTestId('campaign-banner')).toContainText(/saved/i)
    await expect.poll(async () => (await rows<{ name: string; quantity: number }>('deliverables', `select=name,quantity&id=eq.${job.deliverableId}`))[0]).toEqual({ name: 'Social Advertisement', quantity: 1 })
    await back.context().close()
  })

  test('adding a deliverable (I52.20): the account manager adds one with a type and its tasks appear; an untyped one gets its list when typed in the panel; a lead cannot add', async ({ browser }) => {
    // May NOT: the department lead is offered no Add — the list is the campaign's shape.
    const lead = await as(browser, 'lead')
    await lead.goto(`/campaigns/${job.campaignId}`)
    await lead.getByTestId('campaign-tab-grid').click()
    await expect(lead.locator('[data-testid="campaign-add-deliverable"]')).toHaveCount(0)
    await lead.context().close()

    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${job.campaignId}`)
    await am.getByTestId('campaign-tab-grid').click()
    // 1) An UNTYPED deliverable — the production shape — owned by the Creative lead: no tasks.
    await am.getByTestId('campaign-add-deliverable').click()
    await expect(am.getByTestId('campaign-deliverable-form')).toBeVisible()
    await am.getByTestId('campaign-deliverable-form-submit').click()   // nothing filled: refused in the dialog
    await expect(am.getByTestId('campaign-deliverable-form-error')).toBeVisible()
    await am.getByTestId('campaign-deliverable-form-name').fill('Key visual')
    await am.getByTestId('campaign-deliverable-form-owner').fill(PEOPLE.lead.name)
    await am.getByTestId('campaign-deliverable-form-owner-list').getByRole('option', { name: PEOPLE.lead.name }).first().click()
    await am.getByTestId('campaign-deliverable-form-due').fill(dueIn(12))
    await am.getByTestId('campaign-deliverable-form-submit').click()
    await expect(am.getByTestId('campaign-banner')).toContainText(/added/i)
    await am.getByTestId('campaign-banner-close').click()
    const [kv] = await rows<{ id: string; owner_user_id: string; department_id: string | null }>('deliverables', `select=id,owner_user_id,department_id&name=eq.Key%20visual&order=created_at.desc&limit=1`)
    expect(kv.owner_user_id).toBe(await userIdOf(PEOPLE.lead.email))
    expect(kv.department_id).not.toBeNull()   // stamped from the owner (ADR-0050)
    expect((await rows('sub_tasks', `select=id&deliverable_id=eq.${kv.id}`)).length).toBe(0)
    await expect(am.getByTestId(`campaign-deliverable-untyped-${kv.id}`)).toBeVisible()

    // 2) Give it a type in the panel: with no live task there is nothing to replace, so no question —
    //    the task list materialises on save (what was missing on production).
    await am.getByTestId(`campaign-deliverable-edit-${kv.id}`).click()
    await expect(am.getByTestId('piece-panel')).toBeVisible()
    await pickDeliverable(am, 'piece-panel-type', 'Social Advertisement')
    await expect(am.getByTestId('piece-panel-type-note')).toHaveCount(0)
    await am.getByTestId('piece-panel-save').click()
    await expect(am.getByTestId('campaign-banner')).toContainText(/saved/i)
    await am.getByTestId('campaign-banner-close').click()
    await expect.poll(async () => (await rows('sub_tasks', `select=id&deliverable_id=eq.${kv.id}`)).length).toBeGreaterThan(0)
    await am.getByTestId('piece-drawer-x').click()
    await expect(am.getByTestId(`campaign-deliverable-untyped-${kv.id}`)).toHaveCount(0)
    await expect(am.getByTestId(`campaign-deliverable-name-${kv.id}`)).toContainText('Key visual')

    // 3) A typed one straight away: tasks on arrival.
    await am.getByTestId('campaign-add-deliverable').click()
    await pickDeliverable(am, 'campaign-deliverable-form-type', 'Social Advertisement')
    await am.getByTestId('campaign-deliverable-form-name').fill('Teaser cutdowns')
    await am.getByTestId('campaign-deliverable-form-quantity').fill('2')
    await am.getByTestId('campaign-deliverable-form-owner').fill(PEOPLE.lead.name)
    await am.getByTestId('campaign-deliverable-form-owner-list').getByRole('option', { name: PEOPLE.lead.name }).first().click()
    // ADR-0093 addendum d.7: a due date is required — refused in the dialog without one.
    await am.getByTestId('campaign-deliverable-form-submit').click()
    await expect(am.getByTestId('campaign-deliverable-form-error')).toContainText(/due date/i)
    await am.getByTestId('campaign-deliverable-form-due').fill(dueIn(12))
    await am.getByTestId('campaign-deliverable-form-submit').click()
    await expect(am.getByTestId('campaign-banner')).toContainText(/added/i)
    await am.getByTestId('campaign-banner-close').click()
    const [tc] = await rows<{ id: string; quantity: number }>('deliverables', `select=id,quantity&name=eq.Teaser%20cutdowns&order=created_at.desc&limit=1`)
    expect(tc.quantity).toBe(2)
    await expect.poll(async () => (await rows('sub_tasks', `select=id&deliverable_id=eq.${tc.id}`)).length).toBeGreaterThan(0)
    await am.context().close()
  })

  test('a task added in the panel and given to somebody names them on the grid; started, it cannot be removed (ADR-0140 d.3); a second tab catches up by itself', async ({ browser }) => {
    test.setTimeout(150_000)   // three people, a refresh clock and a reload — not one screen
    // The piece's own live tasks, nobody on any of them yet.
    const n = (await rows('sub_tasks', `select=id&deliverable_id=eq.${job.deliverableId}&status=neq.cancelled&status=neq.done`)).length
    const executed = (p: Page) => p.getByTestId(`campaign-grid-executed-${job.deliverableId}`)
    // A second tab already open on the campaign page — the one that used to go stale (I52.9).
    const watcher = await as(browser, 'lead')
    await watcher.goto(`/campaigns/${job.campaignId}`)
    await expect(executed(watcher)).toHaveText(`${n} unassigned`)

    // ADR-0140: the owner approves the suggested list on the panel, then adds a task of her own by its name, unassigned.
    const lead = await as(browser, 'lead')
    await lead.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
    await expect(lead.getByTestId('piece-panel')).toBeVisible()
    await lead.getByTestId('piece-panel-tasks-approve').click()
    await expect(lead.getByTestId('campaign-banner')).toContainText(/approved/i)
    await lead.getByTestId('campaign-banner-close').click()
    await expect(lead.getByTestId('piece-panel-tasks-open-schedule')).toBeVisible()
    await lead.getByTestId('piece-panel-tasks-add').click()
    await lead.getByTestId('piece-panel-tasks-add-name').fill('Rings extra')
    await lead.getByTestId('piece-panel-tasks-add-save').click()
    await expect.poll(async () => (await rows('sub_tasks', `select=id&deliverable_id=eq.${job.deliverableId}&title=eq.Rings%20extra`)).length).toBe(1)
    const [extra] = await rows<{ id: string; assignee_id: string | null }>('sub_tasks', `select=id,assignee_id&deliverable_id=eq.${job.deliverableId}&title=eq.Rings%20extra`)
    expect(extra.assignee_id).toBeNull()
    await expect(lead.getByTestId(`piece-panel-tasks-row-${extra.id}`)).toBeVisible()

    // Assigning stays on the Schedule and the Team page (ADR-0132): the door they call, as the lead.
    const makerId = await userIdOf(PEOPLE.maker.email)
    const tlId = await userIdOf(PEOPLE.tl.email)
    const out = await rpcAs<{ outcome: string }[]>('lead', 'update_task_assignment', {
      p_sub_task: extra.id, p_title: 'Rings extra', p_assignee: makerId,
      p_reviewers: [{ user_id: tlId, is_mandatory: true }],
      p_starts_at: `${dueIn(1)}T06:00:00Z`, p_due_at: `${dueIn(2)}T14:00:00Z`, p_hours: 4, p_review_mode: 'manual',
    })
    expect(out[0]?.outcome).toBe('assigned')

    // Same tab, navigating back: the maker is named on the piece; the n others still have nobody.
    await lead.goto(`/campaigns/${job.campaignId}`)
    await expect(executed(lead)).toHaveText(`${PEOPLE.maker.name} · ${n} unassigned`)

    // The task's row in the panel names who has it and where it is — "Not started" — and it follows Start.
    await lead.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
    // The Who field names the person by first name, with their avatar (Figma N).
    await expect(lead.getByTestId(`piece-panel-tasks-who-${extra.id}`)).toContainText(PEOPLE.maker.name.split(' ')[0]!)
    await expect(lead.getByTestId(`piece-panel-tasks-status-${extra.id}`)).toContainText('Booked')
    const maker = await as(browser, 'maker')
    await maker.goto('/my-work')
    await maker.getByTestId(`my-work-start-${extra.id}`).click()
    await expect.poll(async () => (await rows<{ status: string }>('sub_tasks', `select=status&id=eq.${extra.id}`))[0].status).toBe('in_progress')
    await maker.context().close()
    await lead.reload()
    await expect(lead.getByTestId(`piece-panel-tasks-status-${extra.id}`)).toContainText('In progress')

    // The other tab, untouched, catches up by itself.
    await expect(executed(watcher)).toHaveText(`${PEOPLE.maker.name} · ${n} unassigned`, { timeout: 30_000 })
    await watcher.context().close()

    // ADR-0140 d.3: a STARTED task is not removed from the panel — its row carries the lock, not the ✕ — and the
    // server refuses the removal; the maker stays on the piece.
    await expect(lead.getByTestId(`piece-panel-tasks-locked-${extra.id}`)).toBeVisible()
    expect(await lead.getByTestId(`piece-panel-tasks-remove-${extra.id}`).count()).toBe(0)
    const refused = await rpcRaw('lead', 'remove_sub_task', { p_sub_task: extra.id })
    expect(refused.status, refused.text).toBeGreaterThanOrEqual(400)
    expect((await rows<{ status: string }>('sub_tasks', `select=status&id=eq.${extra.id}`))[0].status).toBe('in_progress')
    await lead.goto(`/campaigns/${job.campaignId}`)
    await expect(executed(lead)).toHaveText(`${PEOPLE.maker.name} · ${n} unassigned`)
    await lead.context().close()
  })
})
