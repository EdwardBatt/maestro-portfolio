import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows, userIdOf, waitForNotification } from '../helpers/db'
import { releaseSingleJob, type ReleasedJob } from '../helpers/single-job'
import { approveTaskList } from '../helpers/piece'

/**
 * Coverage — a change to STARTED work is a request the owner answers (ADR-0110 + its 25 Sep
 * addendum, I59.23, Figma CG-E2), sent from the Edit dialog that "The client asked for a change" opens in the
 * piece's panel (ADR-0132 d.3 — a correction by the team is made directly in the panel).
 *
 * The started work is MADE here, through the product's doors: a Creative job is released, its
 * owner (the Creative lead) approves the task list, one task is given to the maker, who starts it.
 * Then, as the account manager:
 *
 *   * Edit says the work has started; a new quantity is NOT saved — Save opens the warning (before
 *     → after, the started task, the landing date, the escalation clock); Send without saying who
 *     asked is refused on screen; with "The client" it sends: one pending request, the quantity
 *     unchanged, the owner told (`change_request_sent`);
 *   * the drawer and the Board card say "Change requested · waiting on" the owner;
 *   * one open per piece: Edit says so, and Save shows the open request with no Send;
 *   * the owner declines it and the account manager closes it (their doors — the answering screens
 *     are Needs you's, another track's); a new DUE DATE then asks for evidence and Keep sends
 *     nothing; sent without evidence it is recorded without (E5, never blocking); declined and closed
 *     again, sent WITH evidence, the file is filed in the campaign's References and recorded;
 *   * E6: the owner changes straight away on started work — no request.
 *
 * Written against the local stack with every I59 migration applied (20260926111000 and 20260926132000,
 * which adds `p_evidence_asset`). Not run in the build session that wrote it.
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
/**
 * Stand in for B2 and the presigning `asset-url` function — the local stack has no bucket, so the
 * function answers 503 and the evidence can never be filed (the same stand-in `k-my-work` K6 and
 * `people-chat-library-bookings` use). The asset ROW is still written by the product's own filing
 * door, which is what E5 asserts.
 */
const BUCKET = 'https://b2.local.test'
async function mockBucket(page: Page) {
  await page.route(`${BUCKET}/**`, (route) => route.fulfill({ status: 200, body: '' }))
  await page.route('**/functions/v1/asset-url', async (route) => {
    const body = route.request().postDataJSON() as { op: string; fileName?: string; folderId?: string }
    if (body.op === 'upload') {
      // Keyed as the real function keys it — tenant / client / folder — or the database refuses the row
      // ("a stored file must be inside its own tenant", 20261002130000).
      const [f] = await rows<{ tenant_id: string; client_id: string }>('asset_folders', `select=tenant_id,client_id&id=eq.${body.folderId}`)
      const objectKey = `${f!.tenant_id}/${f!.client_id}/${body.folderId}/${Date.now()}-${body.fileName}`
      return route.fulfill({ json: { uploadUrl: `${BUCKET}/put/${objectKey}`, objectKey, provider: 'b2' } })
    }
    return route.fulfill({ json: { url: `${BUCKET}/get/x` } })
  })
}
// The job is due 14–20 days out (`dueInTwoWeeks`); a NEW date is 30+ days out so it never equals it — on a Monday
// day(20) WAS the job's date, Save saw no change, and the request never opened.
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

interface RequestRow {
  id: string
  status: string
  changes: Record<string, { from: string | null; to: string }>
  asked_by: string
  cost: Record<string, unknown>
  evidence_asset_id: string | null
  closed_at: string | null
}
const requestsOf = (deliverableId: string) =>
  rows<RequestRow>('deliverable_change_requests', `select=id,status,changes,asked_by,cost,evidence_asset_id,closed_at&deliverable_id=eq.${deliverableId}&order=created_at.desc`)
/**
 * The one request a Send just made: the row whose id was not there before it. Not "the newest by
 * created_at" — the local database's clock can step back a few seconds between two commits (the
 * WSL/Docker clock resync; seen 25 Sep: the request sent second carried the EARLIER created_at), and
 * the newest-first read then handed back the declined one. Exactly one new row, or the test fails.
 */
async function sentRequest(deliverableId: string, before: readonly RequestRow[]): Promise<RequestRow> {
  const known = new Set(before.map((r) => r.id))
  const fresh = (await requestsOf(deliverableId)).filter((r) => !known.has(r.id))
  expect(fresh, 'exactly one request made by this Send').toHaveLength(1)
  return fresh[0]!
}

/** ADR-0132 d.3: the grid's Edit opens the piece's panel; the CLIENT's change is asked from "The client asked for a
 *  change", which opens the Edit dialog this spec walks. */
async function openEdit(page: Page, job: ReleasedJob) {
  await page.goto(`/campaigns/${job.campaignId}`)
  await page.getByTestId('campaign-tab-grid').click()
  await page.getByTestId(`campaign-deliverable-edit-${job.deliverableId}`).click()
  await page.getByTestId('piece-panel-client-change').click()
  await expect(page.getByTestId('campaign-deliverable-form')).toBeVisible()
  // Save waits for "started" to be read; the note says it has been.
  await expect(page.getByTestId('campaign-deliverable-form-started')).toBeVisible()
}
/** The owner declines, the account manager closes — the doors Needs you's buttons call. */
async function declineAndClose(requestId: string) {
  await rpcAs('lead', 'answer_change_request', { p_request: requestId, p_answer: 'decline', p_text: 'Not this week.' })
  await rpcAs('am', 'close_change_request', { p_request: requestId })
}

let job: ReleasedJob
let ownerName: string

test.describe.configure({ mode: 'serial' })

test.describe('CG-E2 — a change to started work is a request (ADR-0110)', () => {
  test.beforeAll(async ({ browser }) => {
    const am = await as(browser, 'am')
    job = await releaseSingleJob(am, { title: `Change request ${Date.now()}`, department: 'Creative', type: 'Social Advertisement' })
    await am.context().close()
    const lead = await as(browser, 'lead')
    // ADR-0140: the task list is approved on the piece panel's task list (`piece-panel-tasks-approve`).
    await approveTaskList(lead, job)
    await lead.context().close()

    const [first] = await rows<{ id: string; title: string }>('sub_tasks', `select=id,title&deliverable_id=eq.${job.deliverableId}&order=sort_order.asc,unit_index.asc`)
    const maker = await userIdOf(PEOPLE.maker.email)
    const leadId = await userIdOf(PEOPLE.lead.email)
    const out = await rpcAs<{ outcome: string }[]>('lead', 'update_task_assignment', {
      p_sub_task: first.id, p_title: first.title, p_assignee: maker,
      p_reviewers: [{ user_id: leadId, is_mandatory: true }],
      p_starts_at: `${day(0)}T06:00:00Z`, p_due_at: `${day(1)}T14:00:00Z`, p_hours: 2, p_review_mode: 'manual',
    })
    expect(out[0]?.outcome).toBe('assigned')
    await rpcAs('maker', 'sub_task_start', { p_id: first.id })
    expect(await rpcAs<boolean>('am', 'deliverable_is_started', { p_deliverable: job.deliverableId })).toBe(true)
    const [owner] = await rows<{ display_name: string }>('user_profiles', `select=display_name&id=eq.${job.ownerUserId}`)
    ownerName = owner.display_name
  })

  test('a new quantity is not saved: the warning costs it, who asked is required, and Send asks the owner', async ({ browser }) => {
    const [before] = await rows<{ quantity: number }>('deliverables', `select=quantity&id=eq.${job.deliverableId}`)
    const am = await as(browser, 'am')
    await openEdit(am, job)
    await expect(am.getByTestId('campaign-deliverable-form-started')).toContainText(ownerName)
    await am.getByTestId('campaign-deliverable-form-quantity').fill(String(before.quantity + 1))
    await am.getByTestId('campaign-deliverable-form-submit').click()

    await expect(am.getByTestId('change-request-dialog')).toBeVisible()
    await expect(am.getByTestId('change-request-change-quantity')).toContainText(`${before.quantity}`)
    await expect(am.getByTestId('change-request-change-quantity')).toContainText(`${before.quantity + 1}`)
    await expect(am.getByTestId('change-request-cost-total')).toContainText('1 task started')
    await expect(am.getByTestId('change-request-escalates')).toContainText(`${ownerName} has until`)
    await expect(am.getByTestId('change-request-evidence')).toHaveCount(0)   // not a date change

    // Who asked is the one required answer.
    await am.getByTestId('change-request-send').click()
    await expect(am.getByTestId('change-request-error')).toContainText('Say who asked')
    expect(await requestsOf(job.deliverableId)).toHaveLength(0)

    await am.getByTestId('change-request-asked-by-client').check()
    await am.getByTestId('change-request-send').click()
    await expect(am.getByTestId('campaign-banner')).toContainText(`Sent to ${ownerName} as a change request`)

    const [req] = await requestsOf(job.deliverableId)
    expect(req).toMatchObject({ status: 'pending', asked_by: 'client', evidence_asset_id: null })
    expect(req.changes.quantity.to).toBe(String(before.quantity + 1))
    expect(req.cost).toMatchObject({ started_tasks: 1 })
    expect((await rows<{ quantity: number }>('deliverables', `select=quantity&id=eq.${job.deliverableId}`))[0].quantity).toBe(before.quantity)
    await waitForNotification(PEOPLE.lead.email, 'change_request_sent', 8_000, job.deliverableId)
    await am.context().close()
  })

  test('the drawer says it is waiting on the owner (a one-piece job has no Board to show it on)', async ({ browser }) => {
    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${job.campaignId}`)
    await am.getByTestId('campaign-tab-grid').click()
    await am.getByTestId(`campaign-deliverable-open-${job.deliverableId}`).click()
    await expect(am.getByTestId('piece-drawer-change-request-line')).toHaveText(`Change requested · waiting on ${ownerName}`)
    await am.getByTestId('piece-drawer-close').click()
    // ADR-0132 d.5: a single job with one deliverable greys the Board — there is nothing to compare.
    await expect(am.getByTestId('campaign-tab-board')).toBeDisabled()
    await am.context().close()
  })

  test('one open per piece: Edit says so, and Save shows the open request with no Send', async ({ browser }) => {
    const am = await as(browser, 'am')
    await openEdit(am, job)
    await expect(am.getByTestId('campaign-deliverable-form-open-request')).toContainText(`waiting on ${ownerName}`)
    await am.getByTestId('campaign-deliverable-form-due-day').fill(day(30))
    await am.getByTestId('campaign-deliverable-form-submit').click()
    await expect(am.getByTestId('change-request-already-open')).toBeVisible()
    await expect(am.getByTestId('change-request-send')).toHaveCount(0)
    await am.getByTestId('change-request-keep').click()
    await expect(am.getByTestId('change-request-dialog')).toHaveCount(0)
    expect(await requestsOf(job.deliverableId)).toHaveLength(1)
    await am.context().close()
  })

  test('E5: a new due date asks for evidence and never needs it; Keep sends nothing; with it, it is filed and recorded', async ({ browser }) => {
    await declineAndClose((await requestsOf(job.deliverableId))[0].id)
    const [before] = await rows<{ due_at: string }>('deliverables', `select=due_at&id=eq.${job.deliverableId}`)

    const am = await as(browser, 'am')
    await mockBucket(am)
    // Keep it as it was: nothing sent.
    await openEdit(am, job)
    await am.getByTestId('campaign-deliverable-form-due-day').fill(day(30))
    await am.getByTestId('campaign-deliverable-form-submit').click()
    await expect(am.getByTestId('change-request-evidence')).toBeVisible()
    await expect(am.getByTestId('change-request-lands')).toBeVisible()
    await am.getByTestId('change-request-keep').click()
    expect(await requestsOf(job.deliverableId)).toHaveLength(1)

    // Sent without evidence: recorded without it.
    await openEdit(am, job)
    await am.getByTestId('campaign-deliverable-form-due-day').fill(day(30))
    await am.getByTestId('campaign-deliverable-form-submit').click()
    await am.getByTestId('change-request-asked-by-us').check()
    const beforeFirst = await requestsOf(job.deliverableId)
    await am.getByTestId('change-request-send').click()
    await expect(am.getByTestId('campaign-banner')).toContainText('as a change request')
    let req = await sentRequest(job.deliverableId, beforeFirst)
    expect(req).toMatchObject({ status: 'pending', asked_by: 'us', evidence_asset_id: null })
    expect(req.changes.due.to).toBe(day(30))
    expect((await rows<{ due_at: string }>('deliverables', `select=due_at&id=eq.${job.deliverableId}`))[0].due_at).toBe(before.due_at)

    // Sent with evidence: filed in the campaign's References, named on the request.
    await declineAndClose(req.id)
    await openEdit(am, job)
    await am.getByTestId('campaign-deliverable-form-due-day').fill(day(31))
    await am.getByTestId('campaign-deliverable-form-submit').click()
    await am.getByTestId('change-request-evidence').setInputFiles({
      name: 'client-agreed.txt', mimeType: 'text/plain', buffer: Buffer.from('The client agreed to the new date.'),
    })
    await am.getByTestId('change-request-asked-by-client').check()
    const beforeSecond = await requestsOf(job.deliverableId)
    await am.getByTestId('change-request-send').click()
    await expect(am.getByTestId('campaign-banner')).toContainText('as a change request')
    req = await sentRequest(job.deliverableId, beforeSecond)
    expect(req.status).toBe('pending')
    expect(req.evidence_asset_id).not.toBeNull()
    const [asset] = await rows<{ folder_id: string }>('assets', `select=folder_id&id=eq.${req.evidence_asset_id}`)
    const [folder] = await rows<{ name: string; campaign_id: string }>('asset_folders', `select=name,campaign_id&id=eq.${asset.folder_id}`)
    expect(folder).toMatchObject({ name: 'References', campaign_id: job.campaignId })
    await am.context().close()
  })

  test('E6: the owner changes straight away on started work — no request', async ({ browser }) => {
    const openBefore = (await requestsOf(job.deliverableId)).length
    // ADR-0128: the owner is one of the piece's department's leads — the Creative team lead, not another department's.
    const tlId = await userIdOf(PEOPLE.tl.email)
    const am = await as(browser, 'am')
    await openEdit(am, job)
    await am.getByTestId('campaign-deliverable-form-owner').fill(PEOPLE.tl.name)
    await am.getByTestId('campaign-deliverable-form-owner-list').getByRole('option', { name: new RegExp(PEOPLE.tl.name) }).first().dispatchEvent('mousedown')
    await am.getByTestId('campaign-deliverable-form-submit').click()
    await expect(am.getByTestId('change-request-dialog')).toHaveCount(0)
    await expect.poll(async () => (await rows<{ owner_user_id: string }>('deliverables', `select=owner_user_id&id=eq.${job.deliverableId}`))[0].owner_user_id).toBe(tlId)
    expect(await requestsOf(job.deliverableId)).toHaveLength(openBefore)

    // Back to the Creative lead.
    await openEdit(am, job)
    await am.getByTestId('campaign-deliverable-form-owner').fill(PEOPLE.lead.name)
    await am.getByTestId('campaign-deliverable-form-owner-list').getByRole('option', { name: new RegExp(PEOPLE.lead.name) }).first().dispatchEvent('mousedown')
    await am.getByTestId('campaign-deliverable-form-submit').click()
    await expect.poll(async () => (await rows<{ owner_user_id: string }>('deliverables', `select=owner_user_id&id=eq.${job.deliverableId}`))[0].owner_user_id).toBe(job.ownerUserId)
    await am.context().close()
  })
})
