import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows } from '../helpers/db'

/**
 * ADR-0100 d.2/d.9 — the second gate, in a browser.
 *
 * Edward, 23 Sep: *"The assigned deliverables owner has to review and approve the tasks before the
 * tasks can be assigned. This is now the second gate."* and *"they can review all tasks for all
 * deliverables on one page … then they can approve all or selected ones."*
 *
 * What this walks, on the seeded `Northwind Summer Launch` (Creative owns three deliverables
 * between two people, Content owns one):
 *
 *  - the department tab offers the task lists, not a brief to approve;
 *  - a person is offered only the ones THEY own, and told whose the others are;
 *  - accepting one leaves the rest held — partial acceptance is the new state, and the screen has
 *    to say which work is still stuck and why;
 *  - "accept all" takes everything that is theirs and nothing that is not.
 *
 * The old control — **Approve the department brief**, one press releasing a whole department — is
 * asserted GONE, because leaving it on the page would be two gates arguing.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}

const CAMPAIGN = 'Northwind Summer Launch'

/** The task lists are one panel on the Grid since the department tabs went (CG-01, I57.4). */
async function creativePanelId(): Promise<string> {
  return 'campaign-task-lists'
}

async function campaignId(): Promise<string> {
  const [c] = await rows<{ id: string }>('campaigns', `select=id&name=eq.${encodeURIComponent(CAMPAIGN)}`)
  expect(c, CAMPAIGN).toBeTruthy()
  return c.id
}

async function deliverablesOf(campaign: string) {
  return rows<{ id: string; name: string; tasks_approved_at: string | null; owner_user_id: string }>(
    'deliverables',
    `select=id,name,tasks_approved_at,owner_user_id,streams!inner(campaign_id),departments!inner(name)` +
      `&streams.campaign_id=eq.${campaign}&departments.name=eq.Creative&order=name`,
  )
}

/** Put every Creative task list back to unaccepted, so the walk starts from the same place twice. */
async function resetAcceptance(campaign: string) {
  const ids = (await deliverablesOf(campaign)).map((d) => d.id)
  // Through the service role: this is the fixture being rewound, not the product being driven.
  for (const id of ids) {
    await fetch(`http://127.0.0.1:54321/rest/v1/deliverables?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        apikey: process.env.E2E_SERVICE_ROLE_KEY ?? SERVICE_KEY,
        Authorization: `Bearer ${process.env.E2E_SERVICE_ROLE_KEY ?? SERVICE_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ tasks_approved_at: null, tasks_approved_by: null }),
    })
  }
}

const SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

test.describe.configure({ mode: 'serial' })

test.describe('The second gate: the owner accepts the task list (ADR-0100)', () => {
  test('the department tab offers task lists to accept, and no longer a brief to approve', async ({ browser }) => {
    const id = await campaignId()
    await resetAcceptance(id)

    const lead = await as(browser, 'lead') // Dev Dept Lead — owns one of Creative's three
    await lead.goto(`/campaigns/${id}`)
    await lead.getByTestId('campaign-tab-grid').click()

    const panelId = await creativePanelId()
    await expect(lead.getByTestId(panelId)).toBeVisible()
    // Every piece on the campaign whose list waits — the three Creative ones reset above among them.
    const waiting = (await rows<{ id: string; tasks_approved_at: string | null; sub_tasks: { status: string }[] }>(
      'deliverables', `select=id,tasks_approved_at,sub_tasks(status),streams!inner(campaign_id)&streams.campaign_id=eq.${id}&state=neq.archived`,
    )).filter((d) => d.tasks_approved_at == null && d.sub_tasks.some((t) => t.status !== 'done' && t.status !== 'cancelled'))
    expect(waiting.length).toBeGreaterThanOrEqual(3)
    await expect(lead.getByTestId(`${panelId}-waiting`)).toContainText(String(waiting.length))

    // The old gate's control is gone: an unapproved department brief has nothing to approve here
    // any more, because approving it would release nothing (ADR-0100 d.2).
    await expect(lead.locator('[data-testid^="campaign-brief-approval-"] button')).toHaveCount(0)

    await lead.context().close()
  })

  // I66.6 — the Dashboard's "Task lists not approved" opens the lists themselves: the same count, one row each,
  // naming who it waits on, and each row opens its deliverable. Run while this campaign's lists are all held.
  test('the dashboard card opens the task lists it counted, one row each', async ({ browser }) => {
    const id = await campaignId()
    await resetAcceptance(id)
    const held = (await deliverablesOf(id)).filter((d) => d.tasks_approved_at == null)
    expect(held.length, 'Creative lists held on the seeded campaign').toBeGreaterThan(0)

    const lead = await as(browser, 'lead')
    await lead.goto('/dashboard')
    const figure = lead.getByTestId('db-stat-task-lists-value')
    await expect(figure).not.toHaveText('0', { timeout: 15_000 })
    const counted = Number(await figure.innerText())
    await figure.click()

    await expect(lead).toHaveURL(/\/deliverables\/task-lists/)
    const table = lead.getByTestId('task-lists-waiting-table')
    await expect(table).toBeVisible({ timeout: 15_000 })
    await expect(table.locator('tbody tr')).toHaveCount(counted)
    // The seeded campaign's held lists are among them, each naming its owner.
    for (const d of held) {
      await expect(lead.getByTestId(`task-list-waiting-row-${d.id}`)).toBeVisible()
      await expect(lead.getByTestId(`task-list-waiting-owner-${d.id}`)).not.toHaveText('')
    }

    await lead.getByTestId(`task-list-waiting-open-${held[0]!.id}`).click()
    // ADR-0132 d.8: the row's Open goes straight to the piece's panel on its campaign page (pieceHref).
    await lead.waitForURL(new RegExp(`/campaigns/${id}\\?piece=${held[0]!.id}$`))
    await expect(lead.getByTestId('piece-panel')).toBeVisible({ timeout: 20_000 })
    await lead.context().close()
  })

  test('a lead may accept for their whole department; a maker is offered nothing', async ({ browser }) => {
    // ADR-0090 d.4: the owner, OR somebody who may change its owner within the department's scope.
    // So a department lead can still release everything their department owns in one sitting —
    // the convenience the old single "Approve the department brief" button provided survives,
    // which is what stops a slow owner becoming a stalled campaign.
    const id = await campaignId()
    const creative = await deliverablesOf(id)
    const panelId = await creativePanelId()

    const lead = await as(browser, 'lead')
    await lead.goto(`/campaigns/${id}`)
    await lead.getByTestId('campaign-tab-grid').click()
    for (const d of creative) {
      await expect(lead.getByTestId(`${panelId}-approve-${d.id}`)).toBeVisible()
    }
    await expect(lead.getByTestId(`${panelId}-approve-all`)).toBeVisible()
    await lead.context().close()

    // A team member owns none of it and may change nobody's owner, so the panel offers them
    // nothing to press — and names who they are waiting on instead of leaving them guessing.
    const maker = await as(browser, 'maker')
    await maker.goto(`/campaigns/${id}`)
    await maker.getByTestId('campaign-tab-grid').click()
    await expect(maker.getByTestId(`${panelId}-approve-all`)).toHaveCount(0)
    for (const d of creative) {
      await expect(maker.getByTestId(`${panelId}-approve-${d.id}`)).toHaveCount(0)
      await expect(maker.getByTestId(`${panelId}-not-yours-${d.id}`)).toBeVisible()
    }
    await maker.context().close()
  })

  test('accepting the selected ones leaves the rest held — partial is a real state', async ({ browser }) => {
    const id = await campaignId()
    const tl = await as(browser, 'tl') // Dev Team Lead — owns two of Creative's three
    await tl.goto(`/campaigns/${id}`)
    await tl.getByTestId('campaign-tab-grid').click()
    const panelId = await creativePanelId()

    const tlId = (await rows<{ id: string }>('user_profiles', `select=id&email=eq.${encodeURIComponent(PEOPLE.tl.email)}`))[0].id
    const theirs = (await deliverablesOf(id)).filter((d) => d.owner_user_id === tlId)
    expect(theirs.length).toBeGreaterThan(1)
    const [first, ...rest] = theirs

    await tl.getByTestId(`${panelId}-pick-${first.id}`).check()
    await tl.getByTestId(`${panelId}-approve-picked`).click()

    await expect
      .poll(async () => (await rows<{ tasks_approved_at: string | null }>('deliverables', `select=tasks_approved_at&id=eq.${first.id}`))[0].tasks_approved_at)
      .not.toBeNull()
    // The ones NOT ticked are untouched: accepting is now per deliverable, not per department.
    for (const d of rest) {
      const [row] = await rows<{ tasks_approved_at: string | null }>('deliverables', `select=tasks_approved_at&id=eq.${d.id}`)
      expect(row.tasks_approved_at, `${d.name} was not ticked`).toBeNull()
    }

    await tl.context().close()
  })

  test('accept all takes everything that is theirs, and nothing that is not', async ({ browser }) => {
    const id = await campaignId()
    const tl = await as(browser, 'tl')
    await tl.goto(`/campaigns/${id}`)
    await tl.getByTestId('campaign-tab-grid').click()
    const panelId = await creativePanelId()

    const tlId = (await rows<{ id: string }>('user_profiles', `select=id&email=eq.${encodeURIComponent(PEOPLE.tl.email)}`))[0].id
    const all = await deliverablesOf(id)
    const theirs = all.filter((d) => d.owner_user_id === tlId)
    const others = all.filter((d) => d.owner_user_id !== tlId)

    await tl.getByTestId(`${panelId}-approve-all`).click()

    for (const d of theirs) {
      await expect
        .poll(async () => (await rows<{ tasks_approved_at: string | null }>('deliverables', `select=tasks_approved_at&id=eq.${d.id}`))[0].tasks_approved_at)
        .not.toBeNull()
    }
    for (const d of others) {
      const [row] = await rows<{ tasks_approved_at: string | null }>('deliverables', `select=tasks_approved_at&id=eq.${d.id}`)
      expect(row.tasks_approved_at, `${d.name} belongs to somebody else`).toBeNull()
    }

    await tl.context().close()
  })
})
