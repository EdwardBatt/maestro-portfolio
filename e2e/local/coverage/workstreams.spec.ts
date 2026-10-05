import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows } from '../helpers/db'

/**
 * ADR-0099 / `I56.3` — a campaign's work in named groups, in a browser.
 *
 * The four things a person does, walked on the seeded `Northwind Summer Launch`: make a group,
 * move work into it, move it back to its own, and remove the emptied group.
 *
 * ADR-0116 (27 Sep): every campaign piece is in a workstream — the seed's Northwind has two (Launch visuals,
 * Launch copy), and a piece moves only BETWEEN workstreams, never out of all of them.
 *
 * The two assertions worth the walk are the ones a unit test cannot make, because they are the
 * database's doing and not the screen's:
 *
 *  - moving work INTO a group changes its **department** (d.3) — the whole convenience a group
 *    exists to provide, and it was silently broken when this was first built: the trigger only
 *    fired on an owner change, so a move did nothing at all;
 *  - moving it back OUT changes the grouping and **nothing else** (d.4).
 *
 * The walk cleans up after itself: the piece back in its seeded workstream, the walk's group removed —
 * the state the other suites expect to find.
 *
 * **It also puts the department back.** d.4 means taking work out of a group leaves it in the
 * group's department, which is right for a person and wrong for a shared fixture: run once, and
 * the moved deliverable is Content's for ever, and every suite that assumes the seeded
 * Creative three finds two. The rewind below is the fixture being restored, not the product being
 * driven — hence the service role.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}

const CAMPAIGN = 'Northwind Summer Launch'
const GROUP = `Walk ${Date.now()}`
const MOVED = 'Key visual - summer range'
/** The seeded workstream the moved piece lives in (supabase/seed.sql). */
const HOME = 'Launch visuals'

const SERVICE_KEY =
  process.env.E2E_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

/** Put a deliverable's department back where the seed had it. Fixture rewind, not product. */
async function restoreDepartment(deliverableId: string, departmentId: string) {
  await fetch(`http://127.0.0.1:54321/rest/v1/deliverables?id=eq.${deliverableId}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ department_id: departmentId }),
  })
}

async function campaignId(): Promise<string> {
  const [c] = await rows<{ id: string }>('campaigns', `select=id&name=eq.${encodeURIComponent(CAMPAIGN)}`)
  expect(c, CAMPAIGN).toBeTruthy()
  return c.id
}

async function home(campaign: string): Promise<string> {
  const [w] = await rows<{ id: string }>('workstreams', `select=id&campaign_id=eq.${campaign}&name=eq.${encodeURIComponent(HOME)}`)
  expect(w, HOME).toBeTruthy()
  return w.id
}

async function deliverable(campaign: string, name: string) {
  const [d] = await rows<{ id: string; department_id: string; workstream_id: string | null }>(
    'deliverables',
    `select=id,department_id,workstream_id,streams!inner(campaign_id)` +
      `&streams.campaign_id=eq.${campaign}&name=eq.${encodeURIComponent(name)}`,
  )
  expect(d, name).toBeTruthy()
  return d
}

test.describe.configure({ mode: 'serial' })

test.describe('Workstreams: a campaign’s work in named groups (ADR-0099)', () => {
  // A walk that leaves groups behind makes its own first assertion false on the next run — and
  // every other suite's idea of this campaign with it. Clear anything a previous run left.
  test.beforeAll(async () => {
    const id = await campaignId()
    const left = await rows<{ id: string }>('workstreams', `select=id&campaign_id=eq.${id}&name=like.Walk*`)
    const homeId = await home(id)
    for (const w of left) {
      await fetch(`http://127.0.0.1:54321/rest/v1/deliverables?workstream_id=eq.${w.id}`, {
        method: 'PATCH',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ workstream_id: homeId }),
      })
      await fetch(`http://127.0.0.1:54321/rest/v1/workstreams?id=eq.${w.id}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      })
    }
    const [creative] = await rows<{ id: string }>('departments', 'select=id&name=eq.Creative')
    await restoreDepartment((await deliverable(id, MOVED)).id, creative.id)
  })

  test('the seeded campaign lists its workstreams, each piece in one (ADR-0116)', async ({ browser }) => {
    const id = await campaignId()
    const groups = await rows<{ id: string; name: string }>('workstreams', `select=id,name&campaign_id=eq.${id}`)
    const loose = await rows('deliverables', `select=id,streams!inner(campaign_id)&streams.campaign_id=eq.${id}&workstream_id=is.null`)
    expect(groups.length, 'the seed gives Northwind workstreams').toBeGreaterThan(0)
    expect(loose, 'no piece outside a workstream').toHaveLength(0)
    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${id}`)
    await am.getByTestId('campaign-tab-grid').click()
    await expect(am.getByTestId('campaign-workstreams')).toBeVisible()
    for (const g of groups) await expect(am.getByTestId(`campaign-workstreams-group-name-${g.id}`)).toHaveText(g.name)
    await expect(am.getByTestId('campaign-workstreams-none')).toHaveCount(0)
    await am.context().close()
  })

  test('a group is made with a name, a department and an owner', async ({ browser }) => {
    const id = await campaignId()
    const [content] = await rows<{ id: string }>('departments', 'select=id&name=eq.Content')

    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${id}`)
    await am.getByTestId('campaign-tab-grid').click()
    await am.getByTestId('campaign-workstreams-add').click()
    await am.getByTestId('campaign-workstreams-name').fill(GROUP)
    await am.getByTestId('campaign-workstreams-department').selectOption(content.id)
    await am.getByTestId('campaign-workstreams-save').click()

    await expect
      .poll(async () => (await rows<{ id: string }>('workstreams', `select=id&campaign_id=eq.${id}&name=eq.${encodeURIComponent(GROUP)}`)).length)
      .toBe(1)
    await am.context().close()
  })

  test('moving work into the group changes the grouping, not the DEPARTMENT', async ({ browser }) => {
    // ADR-0102 (24 Sep): a deliverable's department is its owner's. A Creative deliverable joins a
    // Content group and stays Creative's — the group no longer sets it (supersedes ADR-0099 d.3).
    const id = await campaignId()
    const [group] = await rows<{ id: string; department_id: string }>(
      'workstreams', `select=id,department_id&campaign_id=eq.${id}&name=eq.${encodeURIComponent(GROUP)}`)
    const before = await deliverable(id, MOVED)
    expect(before.department_id, 'starts in a different department from the group').not.toBe(group.department_id)

    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${id}`)
    await am.getByTestId('campaign-tab-grid').click()
    await am.getByTestId(`campaign-workstreams-move-${before.id}`).selectOption(group.id)

    await expect
      .poll(async () => (await deliverable(id, MOVED)).workstream_id)
      .toBe(group.id)
    expect((await deliverable(id, MOVED)).department_id).toBe(before.department_id)
    await am.context().close()
  })

  // CG-01 (I57.5): the Grid groups the sheet by workstream, and each of its filters narrows it. The
  // expected rows come from the database, never from what an earlier run happened to leave.
  test('the grid groups the piece under its workstream, and every filter narrows the sheet', async ({ browser }) => {
    const id = await campaignId()
    const [group] = await rows<{ id: string }>('workstreams', `select=id&campaign_id=eq.${id}&name=eq.${encodeURIComponent(GROUP)}`)
    const moved = await deliverable(id, MOVED)
    const pieces = await rows<{ id: string; owner_user_id: string | null; tasks_approved_at: string | null; sub_tasks: { status: string }[] }>(
      'deliverables',
      `select=id,owner_user_id,tasks_approved_at,sub_tasks(status),streams!inner(campaign_id)&streams.campaign_id=eq.${id}&state=neq.archived`,
    )
    const rowsShown = (p: Page) => p.locator('[data-testid^="campaign-grid-status-"]')

    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${id}`)
    await am.getByTestId('campaign-tab-grid').click()
    await expect(am.getByTestId(`campaign-grid-group-${group.id}`)).toContainText(GROUP)
    await expect(rowsShown(am)).toHaveCount(pieces.length)

    // Workstream: the group holds the one piece; its home workstream holds what is left there.
    await am.getByTestId('campaign-grid-filter-workstream').selectOption(group.id)
    await expect(rowsShown(am)).toHaveCount(1)
    await expect(am.getByTestId(`campaign-deliverable-${moved.id}`)).toBeVisible()
    const homeId = await home(id)
    const inHome = await rows('deliverables', `select=id,streams!inner(campaign_id)&streams.campaign_id=eq.${id}&workstream_id=eq.${homeId}&state=neq.archived`)
    await am.getByTestId('campaign-grid-filter-workstream').selectOption(homeId)
    await expect(rowsShown(am)).toHaveCount(inHome.length)
    await expect(am.getByTestId(`campaign-deliverable-${moved.id}`)).toHaveCount(0)
    await am.getByTestId('campaign-grid-filter-workstream').selectOption('')

    // Owner: exactly the pieces that owner is accountable for.
    const owner = pieces.find((d) => d.id === moved.id)!.owner_user_id!
    await am.getByTestId('campaign-grid-filter-owner').selectOption(owner)
    await expect(rowsShown(am)).toHaveCount(pieces.filter((d) => d.owner_user_id === owner).length)
    await am.getByTestId('campaign-grid-filter-owner').selectOption('')

    // Status: the moved piece's own status keeps it, and every row left wears that status.
    const status = ((await am.getByTestId(`campaign-grid-status-${moved.id}`).textContent()) ?? '').trim()
    await am.getByTestId('campaign-grid-filter-status').selectOption({ label: status })
    await expect(am.getByTestId(`campaign-deliverable-${moved.id}`)).toBeVisible()
    for (const s of await rowsShown(am).allTextContents()) expect(s.trim()).toBe(status)
    await am.getByTestId('campaign-grid-filter-status').selectOption('')

    // Needs approval: the pieces whose list has live tasks and no approval — and only those.
    const waiting = pieces.filter((d) => d.tasks_approved_at == null && d.sub_tasks.some((t) => t.status !== 'done' && t.status !== 'cancelled'))
    await am.getByTestId('campaign-grid-filter-approval').click()
    await expect(am.getByTestId('campaign-grid-filter-approval')).toHaveAttribute('aria-pressed', 'true')
    if (waiting.length > 0) {
      await expect(rowsShown(am)).toHaveCount(waiting.length)
      for (const d of waiting) await expect(am.getByTestId(`campaign-grid-approved-${d.id}`)).toContainText('Pending')
    } else {
      await expect(am.getByTestId('campaign-grid-no-matches')).toBeVisible()
    }
    await am.context().close()
  })

  test('moving it back to its own workstream changes the grouping and nothing else', async ({ browser }) => {
    // d.4: a move never silently moves work between departments. Never OUT of every workstream: the move
    // offers no "none" (ADR-0116 d.3).
    const id = await campaignId()
    const before = await deliverable(id, MOVED)
    const homeId = await home(id)

    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${id}`)
    await am.getByTestId('campaign-tab-grid').click()
    await expect(am.getByTestId(`campaign-workstreams-move-${before.id}`).locator('option[value=""]')).toHaveCount(0)
    await am.getByTestId(`campaign-workstreams-move-${before.id}`).selectOption(homeId)

    await expect
      .poll(async () => (await deliverable(id, MOVED)).workstream_id)
      .toBe(homeId)
    expect((await deliverable(id, MOVED)).department_id).toBe(before.department_id)
    await am.context().close()
  })

  test('an emptied group is removed; the campaign keeps its own workstreams', async ({ browser }) => {
    const id = await campaignId()
    // Rewind first: the walk moved this deliverable to Content and d.4 deliberately left it there.
    // Other suites count on the seeded Creative three, so the fixture goes back as it was found.
    const [creative] = await rows<{ id: string }>('departments', 'select=id&name=eq.Creative')
    await restoreDepartment((await deliverable(id, MOVED)).id, creative.id)
    const [group] = await rows<{ id: string }>('workstreams', `select=id&campaign_id=eq.${id}&name=eq.${encodeURIComponent(GROUP)}`)

    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${id}`)
    await am.getByTestId('campaign-tab-grid').click()
    await am.getByTestId(`campaign-workstreams-remove-${group.id}`).click()
    await am.getByTestId('campaign-workstreams-confirm-remove-confirm').click()

    await expect
      .poll(async () => (await rows<{ id: string }>('workstreams', `select=id&id=eq.${group.id}`)).length)
      .toBe(0)
    await expect(am.getByTestId(`campaign-workstreams-group-${group.id}`)).toHaveCount(0)
    await expect(am.getByTestId('campaign-workstreams-none')).toHaveCount(0)
    await am.context().close()
  })
})
