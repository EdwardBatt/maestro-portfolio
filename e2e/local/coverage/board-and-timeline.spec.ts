import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows } from '../helpers/db'
import { releaseSingleJob, type ReleasedJob } from '../helpers/single-job'

/**
 * The Board and the Timeline (Figma CG-05 / CG-06, I57.8 / I57.9), in a browser.
 *
 * Edward, 24 Sep: *"the card reads the deliverable and the deliverable owner, it does not display
 * tasks. If the user needs to see the details they can click on the card and the pop-up can display
 * the breakdown by task. The same applies to the timeline."*
 *
 * A fresh single job, released through the wizard, plus three pieces the account manager adds on
 * the grid — so the campaign is this run's own and a long-lived local database cannot leave
 * anything in it. None of the four has anybody on a task, so every one belongs in UNASSIGNED; that
 * is checked against the database before the screen is asked, and the counts the screen must show
 * come from the database too.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}
const dueIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

interface PieceRaw { id: string; name: string; owner_user_id: string | null; due_at: string | null }

let job: ReleasedJob
let pieces: PieceRaw[]
const ownerName = new Map<string, string>()

test.describe('Board and Timeline — the piece and its owner, never the tasks', () => {
  test.beforeAll(async ({ browser }) => {
    const am = await as(browser, 'am')
    job = await releaseSingleJob(am, { title: `Board ${Date.now()}`, department: 'Creative', type: 'Social Advertisement' })
    // Three more pieces, owned by the Creative lead, no type and so no tasks: Unassigned (none planned).
    await am.goto(`/campaigns/${job.campaignId}`)
    await am.getByTestId('campaign-tab-grid').click()
    for (const name of ['Board piece A', 'Board piece B', 'Board piece C']) {
      await am.getByTestId('campaign-add-deliverable').click()
      await am.getByTestId('campaign-deliverable-form-name').fill(name)
      await am.getByTestId('campaign-deliverable-form-owner').fill(PEOPLE.lead.name)
      await am.getByTestId('campaign-deliverable-form-owner-list').getByRole('option', { name: PEOPLE.lead.name }).first().click()
      await am.getByTestId('campaign-deliverable-form-due').fill(dueIn(5))
      await am.getByTestId('campaign-deliverable-form-submit').click()
      await expect(am.getByTestId('campaign-banner')).toContainText(/added/i)
      await am.getByTestId('campaign-banner-close').click()
    }
    await am.context().close()

    pieces = await rows<PieceRaw>(
      'deliverables',
      `select=id,name,owner_user_id,due_at,streams!inner(campaign_id)&streams.campaign_id=eq.${job.campaignId}&state=neq.archived`,
    )
    expect(pieces).toHaveLength(4)
    const ids = pieces.map((p) => p.id).join(',')
    // The column rule's preconditions, from the database: nobody holds a live task, nothing is started,
    // no input is outstanding.
    const held = await rows('sub_tasks', `select=id&deliverable_id=in.(${ids})&status=not.in.(done,cancelled)&assignee_id=not.is.null`)
    expect(held).toHaveLength(0)
    const started = await rows('sub_tasks', `select=id&deliverable_id=in.(${ids})&status=in.(in_progress,review,done)`)
    expect(started).toHaveLength(0)
    const inputs = await rows('deliverable_pending_inputs', `select=id&deliverable_id=in.(${ids})&satisfied_at=is.null`)
    expect(inputs).toHaveLength(0)
    const owners = [...new Set(pieces.map((p) => p.owner_user_id).filter(Boolean))].join(',')
    for (const u of await rows<{ id: string; display_name: string }>('user_profiles', `select=id,display_name&id=in.(${owners})`)) {
      ownerName.set(u.id, u.display_name)
    }
  })

  test('the Board: every piece in Unassigned with its owner; three shown and "+ 1 more"; a card opens the drawer; Edit opens the dialog', async ({ browser }) => {
    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${job.campaignId}`)
    await am.getByTestId('campaign-tab-board').click()
    await expect(am.getByTestId('campaign-panel-board')).toBeVisible()
    await expect(am.getByTestId('board-count-unassigned')).toHaveText(String(pieces.length))
    for (const c of ['notStarted', 'inProgress', 'waiting', 'inReview', 'delivered']) {
      await expect(am.getByTestId(`board-count-${c}`)).toHaveText('0')
    }
    // Three cards, then the rest behind "+ 1 more".
    const column = am.getByTestId('board-column-unassigned')
    await expect(column.locator('[data-testid^="board-card-owner-"]')).toHaveCount(3)
    await am.getByTestId('board-more-unassigned').click()
    await expect(column.locator('[data-testid^="board-card-owner-"]')).toHaveCount(4)
    for (const p of pieces) {
      await expect(am.getByTestId(`board-card-${p.id}`)).toContainText(p.name)
      await expect(am.getByTestId(`board-card-owner-${p.id}`)).toHaveText(ownerName.get(p.owner_user_id!)!)
    }
    await am.getByTestId('board-more-unassigned').click()
    await expect(column.locator('[data-testid^="board-card-owner-"]')).toHaveCount(3)

    // The card opens the drawer with the task breakdown.
    await am.getByTestId(`board-card-${job.deliverableId}`).click()
    await expect(am.getByTestId('piece-drawer')).toBeVisible()
    // Someone who may edit reads the piece panel in the drawer, not the task story (ADR-0132 d.2, PieceDrawer `editor`).
    await expect(am.getByTestId('piece-panel')).toBeVisible()
    await expect(am.getByTestId('piece-drawer-tasks')).toHaveCount(0)
    await am.getByTestId('piece-drawer-close').click()
    await expect(am.getByTestId('piece-drawer')).toHaveCount(0)

    // Edit opens the piece panel in the drawer, the one editor (ADR-0132 d.2); closing it changes nothing.
    await am.getByTestId(`board-card-edit-${job.deliverableId}`).click()
    await expect(am.getByTestId('piece-drawer').getByTestId('piece-panel')).toBeVisible()
    await am.getByTestId('piece-drawer-close').click()
    await expect(am.getByTestId('piece-drawer')).toHaveCount(0)
    await am.context().close()
  })

  test('the Timeline: a hollow bar per piece, the owner beside it; Next / Previous move a week; a bar opens the drawer; Edit opens the dialog', async ({ browser }) => {
    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${job.campaignId}`)
    await am.getByTestId('campaign-tab-timeline').click()
    await expect(am.getByTestId('campaign-panel-timeline')).toBeVisible()
    const added = pieces.filter((p) => p.id !== job.deliverableId)
    for (const p of added) {
      // No tasks, due in five days, not late: its bar starts today, is grey and hollow — nobody yet.
      await expect(am.getByTestId(`timeline-owner-${p.id}`)).toHaveText(ownerName.get(p.owner_user_id!)!)
      const bar = am.getByTestId(`timeline-bar-${p.id}`)
      await expect(bar).toHaveAttribute('data-tone', 'notStarted')
      await expect(bar).toHaveAttribute('data-hollow', 'true')
      await expect(am.getByTestId(`timeline-label-${p.id}`)).toHaveText('nobody yet')
    }
    // The released job's piece: nobody on its tasks either.
    await expect(am.getByTestId(`timeline-row-${job.deliverableId}`)).toBeVisible()

    const range = await am.getByTestId('timeline-range').textContent()
    await am.getByTestId('timeline-next').click()
    await expect(am.getByTestId('timeline-range')).not.toHaveText(range!)
    await am.getByTestId('timeline-prev').click()
    await expect(am.getByTestId('timeline-range')).toHaveText(range!)

    const first = added[0]
    await am.getByTestId(`timeline-bar-${first.id}`).click()
    await expect(am.getByTestId('piece-drawer')).toBeVisible()
    await expect(am.getByTestId('piece-drawer-status')).toBeVisible()
    await am.getByTestId('piece-drawer-close').click()

    // Edit opens the piece panel in the drawer, the one editor (ADR-0132 d.2).
    await am.getByTestId(`timeline-edit-${first.id}`).click()
    await expect(am.getByTestId('piece-drawer').getByTestId('piece-panel')).toBeVisible()
    await am.getByTestId('piece-drawer-close').click()
    await expect(am.getByTestId('piece-drawer')).toHaveCount(0)
    await am.context().close()
  })
})
