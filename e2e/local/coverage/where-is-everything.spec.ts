import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows, userIdOf } from '../helpers/db'
import { mockProposal, ownTheWork, reviewAndApprove, startCampaign, writeBrief } from '../helpers/campaign-wizard'

/**
 * Where is everything (Figma CG-03, I57.10) in a browser — one row per piece, with its OWNER, how
 * long it has been where it is, the one thing that moves it and the clock; the four filters; the
 * row, Open and Edit.
 *
 * The campaign is made here, through the wizard, so every expectation comes from what this run
 * created and what the database says of it — never from what an earlier run left: two phases (the
 * first holding today, so the page opens on it), one workstream, and a piece in each phase — the
 * first in the workstream and owned by the Creative team lead, the second in none and owned by the
 * Content lead. Approval leaves both task lists waiting for their owners, so both pieces are
 * Unassigned and the next step names the owner.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}
const dayOut = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

let campaignId: string
let first: { id: string; code: string | null }
let second: { id: string; code: string | null }
let phaseIds: string[]
let workstreamId: string
let copyWorkstreamId: string

test.describe('Where is everything — CG-03 (I57.10)', () => {
  test.beforeAll(async ({ browser }) => {
    const [creative] = await rows<{ id: string }>('departments', 'select=id&name=eq.Creative')
    const [content] = await rows<{ id: string }>('departments', 'select=id&name=eq.Content')
    const am = await as(browser, 'am')
    const stamp = Date.now()
    await mockProposal(
      am,
      [
        { name: `Opener ${stamp}`, typeCode: 'ADV-003', channel: 'Instagram', phaseNumber: 1, group: 0 },
        { name: `Launch copy ${stamp}`, typeCode: 'ADV-003', channel: 'Instagram', phaseNumber: 2, group: 1 },
      ],
      // Two workstreams, a piece in each — every campaign piece is in one (ADR-0116 d.3).
      [{ name: `Design ${stamp}`, departmentId: creative.id }, { name: `Copy ${stamp}`, departmentId: content.id }],
    )
    await startCampaign(am, {
      name: `Where ${stamp}`,
      phases: [
        { name: 'Now', startsOn: dayOut(0), endsOn: dayOut(6) },
        { name: 'Later', startsOn: dayOut(7), endsOn: dayOut(14) },
      ],
    })
    await writeBrief(am)
    // No group owner: a workstream's owners come from its own department (I66.9), and nothing below reads one.
    await ownTheWork(am, [PEOPLE.tl.name, PEOPLE.content.name])
    campaignId = await reviewAndApprove(am)
    await am.context().close()

    const pieces = await rows<{ id: string; code: string | null; name: string }>(
      'deliverables', `select=id,code,name,streams!inner(campaign_id)&streams.campaign_id=eq.${campaignId}`)
    first = pieces.find((p) => p.name.startsWith('Opener'))!
    second = pieces.find((p) => p.name.startsWith('Launch copy'))!
    expect(first && second, 'both pieces made').toBeTruthy()
    phaseIds = (await rows<{ id: string }>('campaign_phases', `select=id&campaign_id=eq.${campaignId}&order=number`)).map((p) => p.id)
    expect(phaseIds).toHaveLength(2)
    const groups = await rows<{ id: string; name: string }>('workstreams', `select=id,name&campaign_id=eq.${campaignId}`)
    workstreamId = groups.find((w) => w.name.startsWith('Design'))!.id
    copyWorkstreamId = groups.find((w) => w.name.startsWith('Copy'))!.id
  })

  test('opens on today\'s phase; each row is the piece, its owner and department, how long, next and the clock', async ({ browser }) => {
    const [p] = await rows<{ tasks_approved_at: string | null; phase_id: string; workstream_id: string | null; due_at: string }>(
      'deliverables', `select=tasks_approved_at,phase_id,workstream_id,due_at&id=eq.${first.id}`)
    const live = await rows('sub_tasks', `select=id&deliverable_id=eq.${first.id}&status=not.in.(done,cancelled)`)
    // What the row must say follows from these: an unapproved list with live tasks is Unassigned.
    expect(p.tasks_approved_at).toBeNull()
    expect(live.length).toBeGreaterThan(0)
    expect(p.phase_id).toBe(phaseIds[0])
    expect(p.workstream_id).toBe(workstreamId)
    expect(Date.parse(p.due_at)).toBeGreaterThan(Date.now())

    const lead = await as(browser, 'lead')
    await lead.goto(`/campaigns/${campaignId}`)
    await lead.getByTestId('campaign-tab-where').click()
    await expect(lead.getByTestId('campaign-panel-where')).toBeVisible()
    await expect(lead.getByTestId('where-filter-phase')).toHaveValue(phaseIds[0])
    await expect(lead.getByTestId(`where-row-${first.id}`)).toBeVisible()
    await expect(lead.getByTestId(`where-row-${second.id}`)).toHaveCount(0)

    if (first.code) await expect(lead.getByTestId(`where-row-${first.id}`)).toContainText(first.code)
    await expect(lead.getByTestId(`where-status-${first.id}`)).toHaveText(/unassigned/i)
    await expect(lead.getByTestId(`where-owner-${first.id}`)).toContainText(`${PEOPLE.tl.name} · Creative`)
    await expect(lead.getByTestId(`where-next-${first.id}`)).toHaveText(`${PEOPLE.tl.name} approves its task list`)
    await expect(lead.getByTestId(`where-since-${first.id}`)).toHaveText(/^(under 1h|\d+h)$/)   // made this run
    // Due in the future: never late. Which of the two depends on the working days left (ADR-0075).
    await expect(lead.getByTestId(`where-clock-${first.id}`)).toHaveText(/^(on time|at risk)$/)
    await lead.context().close()
  })

  test('the four filters: phase, workstream, owner, where it is; an empty result says so in one line', async ({ browser }) => {
    const contentId = await userIdOf(PEOPLE.content.email)
    const lead = await as(browser, 'lead')
    await lead.goto(`/campaigns/${campaignId}`)
    await lead.getByTestId('campaign-tab-where').click()

    await lead.getByTestId('where-filter-phase').selectOption(phaseIds[1])
    await expect(lead.getByTestId(`where-row-${second.id}`)).toBeVisible()
    await expect(lead.getByTestId(`where-row-${first.id}`)).toHaveCount(0)
    await lead.getByTestId('where-filter-phase').selectOption('')
    await expect(lead.locator('[data-testid^="where-row-"]')).toHaveCount(2)

    await lead.getByTestId('where-filter-workstream').selectOption(workstreamId)
    await expect(lead.locator('[data-testid^="where-row-"]')).toHaveCount(1)
    await expect(lead.getByTestId(`where-row-${first.id}`)).toBeVisible()
    await lead.getByTestId('where-filter-workstream').selectOption(copyWorkstreamId)
    await expect(lead.locator('[data-testid^="where-row-"]')).toHaveCount(1)
    await expect(lead.getByTestId(`where-row-${second.id}`)).toBeVisible()
    await lead.getByTestId('where-filter-workstream').selectOption('')

    await lead.getByTestId('where-filter-owner').selectOption(contentId)
    await expect(lead.locator('[data-testid^="where-row-"]')).toHaveCount(1)
    await expect(lead.getByTestId(`where-owner-${second.id}`)).toContainText(`${PEOPLE.content.name} · Content`)
    await lead.getByTestId('where-filter-owner').selectOption('')

    await lead.getByTestId('where-filter-status').selectOption('unassigned')
    await expect(lead.locator('[data-testid^="where-row-"]')).toHaveCount(2)
    await lead.getByTestId('where-filter-status').selectOption('delivered')
    await expect(lead.locator('[data-testid^="where-row-"]')).toHaveCount(0)
    await expect(lead.getByTestId('where-empty')).toHaveText('Nothing matches these filters.')
    await lead.context().close()
  })

  test('the row and Open open the piece; Edit is offered to who may edit, and not to a team member', async ({ browser }) => {
    // May: the account manager.
    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${campaignId}`)
    await am.getByTestId('campaign-tab-where').click()
    await am.getByTestId(`where-row-${first.id}`).click()
    await expect(am.getByTestId('piece-drawer')).toBeVisible()
    await am.getByTestId('piece-drawer-close').click()
    await expect(am.getByTestId('piece-drawer')).toHaveCount(0)
    await am.getByTestId(`where-open-${first.id}`).click()
    await expect(am.getByTestId('piece-drawer')).toBeVisible()
    await am.getByTestId('piece-drawer-close').click()
    await am.getByTestId(`where-edit-${first.id}`).click()
    // Edit opens the piece panel in the drawer, the one editor (ADR-0132 d.2).
    await expect(am.getByTestId('piece-drawer').getByTestId('piece-panel')).toBeVisible()
    await am.getByTestId('piece-drawer-close').click()
    await expect(am.getByTestId('piece-drawer')).toHaveCount(0)
    await am.context().close()

    // May not: a team member reads where everything is and opens it, and is offered no Edit.
    const maker = await as(browser, 'maker')
    await maker.goto(`/campaigns/${campaignId}`)
    await maker.getByTestId('campaign-tab-where').click()
    await expect(maker.getByTestId(`where-row-${first.id}`)).toBeVisible()
    await expect(maker.locator(`[data-testid="where-edit-${first.id}"]`)).toHaveCount(0)
    await maker.getByTestId(`where-open-${first.id}`).click()
    await expect(maker.getByTestId('piece-drawer')).toBeVisible()
    await maker.context().close()
  })
})
