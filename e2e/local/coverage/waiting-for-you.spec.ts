import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows } from '../helpers/db'
import { releaseSingleJob } from '../helpers/single-job'
import { approveTaskList } from '../helpers/piece'

/**
 * Coverage — "Waiting for you" on My Work (I53.16). Edward, 20 Sep: *"confirm all pending
 * approvals are displayed in respective individuals my-work page… Team Leads and Department Leads
 * still need a my-work page."* One who may (the owner sees the held task list, the account
 * manager sees the pending campaign) and one who may not (a team member sees no panel; the AM is
 * never offered a task list — ADR-0090, 12 Sep). Each row leads where the approval is given, and
 * giving it takes the row away.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}

test.describe('Coverage — Waiting for you', () => {
  test('the owner is offered the held task list, answers it from the row, and it leaves; a team member has no panel', async ({ browser }) => {
    const am = await as(browser, 'am')
    const job = await releaseSingleJob(am, { title: `Waiting ${Date.now()}`, department: 'Creative', type: 'Social Advertisement' })
    await am.context().close()

    // The owner (the Creative lead) — the row names the deliverable and the job.
    const lead = await as(browser, 'lead')
    await lead.goto('/my-work')
    const row = lead.getByTestId(`waiting-for-you-task_list-${job.deliverableId}`)
    await expect(row).toBeVisible()
    await expect(row).toContainText(job.title)
    await expect(lead.getByTestId(`waiting-for-you-kind-${job.deliverableId}`)).toHaveText('Task list')
    await lead.getByTestId(`waiting-for-you-open-${job.deliverableId}`).click()
    // ADR-0132 d.8 / ADR-0140: the row opens the piece's panel on its campaign page, where the list is approved.
    await lead.waitForURL(new RegExp(`/campaigns/${job.campaignId}\\?piece=${job.deliverableId}$`))
    await expect(lead.getByTestId('piece-panel-tasks-approve')).toBeVisible({ timeout: 20_000 })
    await approveTaskList(lead, job)
    await lead.goto('/my-work')
    await expect(lead.getByTestId(`waiting-for-you-task_list-${job.deliverableId}`)).toHaveCount(0)
    await lead.context().close()

    // The account manager was never offered it (ADR-0090, 12 Sep addendum).
    const am2 = await as(browser, 'am')
    await am2.goto('/my-work')
    await expect(am2.getByTestId('surface-my-work')).toBeVisible()
    await expect(am2.getByTestId(`waiting-for-you-task_list-${job.deliverableId}`)).toHaveCount(0)
    await am2.context().close()

    // A team member: nothing to approve, so no panel — and no error either.
    const maker = await as(browser, 'maker')
    await maker.goto('/my-work')
    await expect(maker.getByTestId('surface-my-work')).toBeVisible()
    // I59.10: approvals now sit in Needs you, which may hold the maker's own items — so "no panel"
    // is "no approval row".
    await expect(maker.locator('[data-testid^="waiting-for-you-"]')).toHaveCount(0)
    await expect(maker.getByTestId('waiting-for-you-load-error')).toHaveCount(0)
    await maker.context().close()
  })

  test('the account manager is offered a campaign pending their approval, and a department its brief', async ({ browser }) => {
    const [harbour] = await rows<{ id: string; name: string }>('campaigns', `select=id,name&name=eq.${encodeURIComponent('Harbour Line Rebrand')}&status=eq.pending_approval`)
    const [northwind] = await rows<{ id: string }>('campaigns', `select=id&name=eq.${encodeURIComponent('Northwind Summer Launch')}`)
    const [content] = await rows<{ id: string }>('departments', 'select=id&name=eq.Content')
    const [brief] = await rows<{ id: string; approved_at: string | null }>('campaign_briefs', `select=id,approved_at&campaign_id=eq.${northwind.id}&department_id=eq.${content.id}`)

    const am = await as(browser, 'am')
    await am.goto('/my-work')
    const row = am.getByTestId(`waiting-for-you-campaign-${harbour.id}`)
    await expect(row).toBeVisible()
    await expect(row).toContainText(harbour.name)
    await expect(am.getByTestId(`waiting-for-you-open-${harbour.id}`)).toHaveAttribute('href', `/campaigns/${harbour.id}`)
    await am.context().close()

    // ADR-0100 d.4 (23 Sep): a department brief is no longer owed by anybody, because the document
    // it asked for no longer governs anything. Content's lead is offered the TASK LISTS she owns
    // instead — the second gate — and never a brief, not even her own department's unapproved one.
    // The seed writes that brief and leaves it unapproved (seed.sql, "Content has WRITTEN its brief").
    expect(brief, 'the seed writes Content’s brief on Northwind').toBeTruthy()
    expect(brief.approved_at, 'and leaves it unapproved').toBeNull()

    // A task list she owns, held until she answers it: a Content job, released by the AM here, so
    // the row is this test's own and nothing an earlier run approved can take it away.
    const am2 = await as(browser, 'am')
    const copy = await releaseSingleJob(am2, { title: `Waiting copy ${Date.now()}`, department: 'Content', type: 'Social Advertisement' })
    await am2.context().close()
    const [contentLeadId] = await rows<{ id: string }>('user_profiles', `select=id&email=eq.${encodeURIComponent(PEOPLE.content.email)}`)
    expect(copy.ownerUserId, 'a Content job is owned by Content’s lead').toBe(contentLeadId.id)

    const contentLead = await as(browser, 'content')
    await contentLead.goto('/my-work')
    await expect(contentLead.getByTestId('surface-my-work')).toBeVisible()
    await expect(contentLead.getByTestId(`waiting-for-you-task_list-${copy.deliverableId}`)).toBeVisible()
    await expect(contentLead.getByTestId(`waiting-for-you-department_brief-${brief.id}`)).toHaveCount(0)
    await expect(contentLead.locator('[data-testid^="waiting-for-you-department_brief-"]')).toHaveCount(0)
    await contentLead.context().close()

    // ADR-0100 d.7's exemption (a campaign approved before the gate's cutover is not owed) is not
    // walked here: on a reset database every campaign, the seed's included, is approved after the
    // cutover the migration stamps, so no browser path can make one that predates it.

    // And the Creative lead is offered none of Content's work — scope is unchanged by any of this;
    // only what is owed has changed.
    const creativeLead = await as(browser, 'lead')
    await creativeLead.goto('/my-work')
    await expect(creativeLead.getByTestId('surface-my-work')).toBeVisible()
    await expect(creativeLead.getByTestId(`waiting-for-you-task_list-${copy.deliverableId}`)).toHaveCount(0)
    await creativeLead.context().close()
  })
})
