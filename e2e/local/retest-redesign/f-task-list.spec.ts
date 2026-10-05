import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows, userIdOf, waitForNotification } from '../helpers/db'
import { approveTaskList, closeCampaignBanner } from '../helpers/piece'
import { releaseSingleJob, type ReleasedJob } from '../helpers/single-job'

/**
 * docs/RETEST-REDESIGN.md — F: the task list & ownership (ADR-0090 + ADR-0083 d.9/d.11/d.12).
 *
 * Two jobs are released by the AM up front: one to Creative (owner = the department lead) and one
 * to Production (no lead — the AM names the Studio team lead). Each test then opens the right
 * person's browser on the deliverable.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}

let creative: ReleasedJob
let production: ReleasedJob

test.describe('Section F — task list & ownership', () => {
  test.beforeAll(async ({ browser }) => {
    const am = await as(browser, 'am')
    creative = await releaseSingleJob(am, { title: `F creative ${Date.now()}`, department: 'Creative', type: 'Social Advertisement' })
    production = await releaseSingleJob(am, {
      title: `F production ${Date.now()}`,
      department: 'Production',
      ownerPick: PEOPLE.studiotl.name,
      type: 'TV Advertisement',
      task: 'Cut a 30-second edit.',
    })
    await am.context().close()
  })

  test('F1 — a released job\'s tasks are HELD until the owner approves the list', async ({ browser }) => {
    const traffic = await as(browser, 'traffic')
    // The tasks exist (materialised from the type's workflow), unassigned …
    const tasks = await rows<{ id: string; status: string; assignee_id: string | null }>(
      'sub_tasks',
      `select=id,status,assignee_id&deliverable_id=eq.${creative.deliverableId}`,
    )
    expect(tasks.length).toBeGreaterThan(0)
    expect(tasks.every((t) => t.assignee_id === null)).toBe(true)
    // … the row on /deliverables says "awaiting the owner's review — <owner>" …
    await traffic.goto(`/deliverables?campaign=${creative.campaignId}`)
    await expect(traffic.getByTestId(`deliverable-held-${creative.deliverableId}`)).toContainText(
      new RegExp(`awaiting the owner's review.*${PEOPLE.lead.name}`),
    )
    // … and the row's name opens the piece's panel on its campaign page (ADR-0132 d.8, I71.1), where the list reads
    // unapproved. (Traffic is a failsafe approver, so it is offered Approve — a viewer who cannot approve is not: F2.)
    await traffic.getByTestId(`deliverable-open-${creative.deliverableId}`).click()
    await traffic.waitForURL(new RegExp(`/campaigns/${creative.campaignId}\\?piece=${creative.deliverableId}$`))
    await expect(traffic.getByTestId('piece-panel')).toBeVisible({ timeout: 20_000 })
    await expect(traffic.getByTestId('piece-panel-tasks-banner')).toHaveClass(/is-suggested/)
    await expect(traffic.getByTestId('piece-panel-tasks-approve')).toBeVisible()
    await expect(traffic.getByTestId('piece-panel-tasks-open-schedule')).toHaveCount(0)
    const [d] = await rows<{ tasks_approved_at: string | null }>('deliverables', `select=tasks_approved_at&id=eq.${creative.deliverableId}`)
    expect(d.tasks_approved_at).toBeNull()
    await traffic.context().close()
  })

  test('F2 — the account manager has NO "Approve task list" button', async ({ browser }) => {
    // I74.51 (ADR-0100 addendum): the account manager never approves a task list; the panel reads it unapproved.
    const am = await as(browser, 'am')
    await am.goto(`/deliverables?open=${creative.deliverableId}`)
    await am.waitForURL(new RegExp(`/campaigns/${creative.campaignId}\\?piece=${creative.deliverableId}`))
    await expect(am.getByTestId('piece-panel')).toBeVisible({ timeout: 20_000 })
    await expect(am.getByTestId('piece-panel-tasks-banner')).toHaveClass(/is-suggested/)
    await expect(am.getByTestId('piece-panel-tasks-approve')).toHaveCount(0)
    const [d] = await rows<{ tasks_approved_at: string | null }>('deliverables', `select=tasks_approved_at&id=eq.${creative.deliverableId}`)
    expect(d.tasks_approved_at).toBeNull()
    await am.context().close()
  })

  test('F3 — the owner (department lead) approves; the tasks become assignable', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    // ADR-0140: approved on the piece's panel; the helper asserts the button, the success notice and the database.
    await approveTaskList(lead, creative)
    await expect(lead.getByTestId('piece-panel-tasks-banner')).toHaveClass(/is-approved/)
    // The row no longer says held.
    await lead.goto(`/deliverables?campaign=${creative.campaignId}`)
    await expect(lead.getByTestId(`deliverable-row-${creative.deliverableId}`)).toBeVisible()
    await expect(lead.getByTestId(`deliverable-held-${creative.deliverableId}`)).toHaveCount(0)
    await lead.context().close()
  })

  test('F4 — the failsafe (Traffic) can approve for an absent owner', async ({ browser }) => {
    const traffic = await as(browser, 'traffic')
    // ADR-0140 / I74.51: unapproved first, then approved on the piece's panel by Traffic, the failsafe.
    await traffic.goto(`/campaigns/${production.campaignId}?piece=${production.deliverableId}`)
    await expect(traffic.getByTestId('piece-panel')).toBeVisible({ timeout: 20_000 })
    await expect(traffic.getByTestId('piece-panel-tasks-banner')).toHaveClass(/is-suggested/)
    await approveTaskList(traffic, production)
    await traffic.context().close()
  })

  test('F5 — Change owner never offers "Nobody"; Production (no lead) is handed on between its team leads, never to a member', async ({ browser }) => {
    // ADR-0055 d.4: the owner may not reassign their own deliverable unless they hold
    // `deliverable_owner:manage`; a team lead does not, so the AM does it. (The "name a team lead"
    // explanation itself is the release-time case, B6 — no seeded role is both department-scoped
    // and a reassigner.) ADR-0132 d.2 / ADR-0128: the owner is the piece panel's Owner field.
    const [studio, edit, producer, maker] = await Promise.all(
      (['studiotl', 'edittl', 'producer', 'maker'] as const).map((tag) => userIdOf(PEOPLE[tag].email)),
    )
    // The refusal: the owner, a team lead without deliverable_owner:manage, reads the owner and is offered no picker.
    const studioLead = await as(browser, 'studiotl')
    await studioLead.goto(`/campaigns/${production.campaignId}?piece=${production.deliverableId}`)
    await expect(studioLead.getByTestId('piece-panel')).toBeVisible({ timeout: 20_000 })
    await expect(studioLead.getByTestId('piece-panel')).toContainText(PEOPLE.studiotl.name)
    await expect(studioLead.getByTestId('piece-panel-owner')).toHaveCount(0)
    await studioLead.context().close()

    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${production.campaignId}?piece=${production.deliverableId}`)
    await expect(am.getByTestId('piece-panel')).toBeVisible({ timeout: 20_000 })
    const owner = am.getByTestId('piece-panel-owner')
    await expect(owner).toHaveValue(PEOPLE.studiotl.name)
    await owner.click()
    const list = am.getByTestId('piece-panel-owner-list')
    await expect(list).toBeVisible()
    await expect(list).not.toContainText(/Nobody/)
    await expect(am.getByTestId(`piece-panel-owner-option-${studio}`)).toBeVisible()
    await expect(am.getByTestId(`piece-panel-owner-option-${edit}`)).toBeVisible()
    await expect(am.getByTestId(`piece-panel-owner-option-${producer}`)).toHaveCount(0)
    await expect(am.getByTestId(`piece-panel-owner-option-${maker}`)).toHaveCount(0)
    await am.getByTestId(`piece-panel-owner-option-${edit}`).dispatchEvent('mousedown')
    await am.getByTestId('piece-panel-save').click()
    await closeCampaignBanner(am)
    await expect(owner).toHaveValue(PEOPLE.edittl.name)
    await expect
      .poll(async () => (await rows<{ owner_user_id: string }>('deliverables', `select=owner_user_id&id=eq.${production.deliverableId}`))[0]!.owner_user_id)
      .toBe(edit)
    await am.context().close()
  })

  test('F6 — the owner reassigns to one of THEIR team leads; a team member is never offered; both parties told, not the actor', async ({ browser }) => {
    // ADR-0128, untouched by ADR-0141 (migration 20261003130000): the department lead holds deliverable_owner:manage,
    // so the owner changes on the piece panel's Owner field, among the department's own leads.
    const [tl, motion, maker, copy] = await Promise.all(
      (['tl', 'motiontl', 'maker', 'copytl'] as const).map((tag) => userIdOf(PEOPLE[tag].email)),
    )
    const lead = await as(browser, 'lead')
    await lead.goto(`/campaigns/${creative.campaignId}?piece=${creative.deliverableId}`)
    await expect(lead.getByTestId('piece-panel')).toBeVisible({ timeout: 20_000 })
    const owner = lead.getByTestId('piece-panel-owner')
    await expect(owner).toHaveValue(PEOPLE.lead.name)
    await owner.click()
    await expect(lead.getByTestId('piece-panel-owner-list')).toBeVisible()
    await expect(lead.getByTestId(`piece-panel-owner-option-${tl}`)).toBeVisible()
    await expect(lead.getByTestId(`piece-panel-owner-option-${motion}`)).toBeVisible()
    await expect(lead.getByTestId(`piece-panel-owner-option-${maker}`)).toHaveCount(0)
    await expect(lead.getByTestId(`piece-panel-owner-option-${copy}`)).toHaveCount(0) // another department's lead is not offered to a department-scoped viewer
    await lead.getByTestId(`piece-panel-owner-option-${motion}`).dispatchEvent('mousedown')
    await lead.getByTestId('piece-panel-save').click()
    await closeCampaignBanner(lead)
    await expect(owner).toHaveValue(PEOPLE.motiontl.name)

    const [d] = await rows<{ owner_user_id: string }>('deliverables', `select=owner_user_id&id=eq.${creative.deliverableId}`)
    expect(d.owner_user_id).toBe(motion)
    const told = await waitForNotification(PEOPLE.motiontl.email, 'deliverable_reassigned')
    expect(told.entity_id).toBe(creative.deliverableId)
    // The actor is the outgoing owner here, so nobody else is told — and the actor is never told.
    const actorRows = await rows<{ id: string }>(
      'notifications',
      `select=id&type=eq.deliverable_reassigned&entity_id=eq.${creative.deliverableId}&user_id=eq.${creative.ownerUserId}`,
    )
    expect(actorRows).toHaveLength(0)
    await lead.context().close()
  })
})
