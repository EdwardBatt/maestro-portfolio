import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows, userIdOf } from '../helpers/db'
import { releaseSingleJob, type ReleasedJob } from '../helpers/single-job'

/**
 * Coverage — editing a deliverable, opened from the grid's Edit. Since ADR-0132 (I68.2) the grid's Edit opens the
 * piece's side panel, the editor; the old Edit dialog (CG-E1) is reached only by "The client asked for a change".
 *
 * Every field opens on what the DATABASE holds and nothing is written until Save; the status is the drawer's pill,
 * not a control; the owner is offered from the piece's department's leads (ADR-0128) and saves through
 * `reassign_deliverable`; the client's route still opens the evidenced date dialog and hands back (ADR-0088 d.7a);
 * Close asks first, names the live work, and archives (ADR-0080). As one who may not: a team member is offered no
 * Edit and no editor, and a department lead is offered no owner outside the department.
 *
 * Name / type / quantity / channel / due date are walked in `campaign-one-page.spec.ts`, the phase in
 * `campaign-phases.spec.ts`.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}
async function closeBanner(page: Page, pattern: RegExp) {
  await expect(page.getByTestId('campaign-banner')).toContainText(pattern)
  await page.getByTestId('campaign-banner-close').click()
}
async function pickPerson(page: Page, testId: string, name: string) {
  await page.getByTestId(testId).fill(name)
  await page.getByTestId(`${testId}-list`).getByRole('option', { name: new RegExp(name) }).first().dispatchEvent('mousedown')
}
/** The grid's Edit opens the piece's panel (ADR-0132 d.2). */
async function openEdit(page: Page, job: ReleasedJob) {
  await page.goto(`/campaigns/${job.campaignId}`)
  await page.getByTestId('campaign-tab-grid').click()
  await page.getByTestId(`campaign-deliverable-edit-${job.deliverableId}`).click()
  await expect(page.getByTestId('piece-panel')).toBeVisible()
}

let job: ReleasedJob

test.describe('Editing a deliverable — the side panel (ADR-0132)', () => {
  test.beforeAll(async ({ browser }) => {
    const am = await as(browser, 'am')
    job = await releaseSingleJob(am, { title: `Edit piece ${Date.now()}`, department: 'Creative', type: 'Social Advertisement', priority: 'high' })
    await am.context().close()
  })

  test('opens on what the piece holds; the status is the pill, and nothing is written until Save', async ({ browser }) => {
    const [d] = await rows<{ name: string; quantity: number; state: string; owner_user_id: string }>(
      'deliverables', `select=name,quantity,state,owner_user_id&id=eq.${job.deliverableId}`,
    )
    const [owner] = await rows<{ display_name: string }>('user_profiles', `select=display_name&id=eq.${d.owner_user_id}`)

    const am = await as(browser, 'am')
    await openEdit(am, job)
    await expect(am.getByTestId('piece-panel-name')).toHaveValue(d.name)
    await expect(am.getByTestId('piece-panel-quantity')).toHaveValue(String(d.quantity))
    await expect(am.getByTestId('piece-panel-owner')).toHaveValue(owner.display_name)
    // The status is shown on the drawer, and it is not a control; Save waits for a change.
    await expect(am.getByTestId('piece-drawer-status')).toBeVisible()
    await expect(am.getByTestId('piece-panel-save')).toBeDisabled()
    await am.getByTestId('piece-panel-name').fill(`${d.name} (draft)`)
    await expect(am.getByTestId('piece-panel-save')).toBeEnabled()
    // Closing without saving writes nothing.
    await am.getByTestId('piece-drawer-x').click()
    await expect(am.getByTestId('piece-panel')).toHaveCount(0)
    const [after] = await rows<{ name: string; state: string }>('deliverables', `select=name,state&id=eq.${job.deliverableId}`)
    expect(after.name).toBe(d.name)
    expect(after.state).toBe(d.state)
    await am.context().close()
  })

  test('the client\'s route: "The client asked for a change" opens Edit, whose due date opens the evidenced dialog and hands back', async ({ browser }) => {
    const am = await as(browser, 'am')
    await openEdit(am, job)
    await am.getByTestId('piece-panel-client-change').click()
    await expect(am.getByTestId('campaign-deliverable-form')).toBeVisible()
    await am.getByTestId('campaign-deliverable-form-due').click()
    await expect(am.getByTestId('deliverable-due-change-dialog')).toBeVisible()
    // I59 E5: the client's agreement is asked for, never required — Save is open without it.
    await expect(am.getByTestId('deliverable-due-change-evidence-hint')).toBeVisible()
    await expect(am.getByTestId('deliverable-due-change-save')).toBeEnabled()
    await expect(am.getByTestId('campaign-deliverable-form')).toHaveCount(0)
    await am.getByTestId('deliverable-due-change-cancel').click()
    await expect(am.getByTestId('campaign-deliverable-form')).toBeVisible()
    await am.getByTestId('campaign-deliverable-form-cancel').click()
    await am.context().close()
  })

  // ADR-0102 / ADR-0128: the owner is one of the piece's department's leads; saving goes through reassign.
  test('the owner changes in the panel, among the department\'s leads, and is put back', async ({ browser }) => {
    const leadId = await userIdOf(PEOPLE.lead.email)
    const tlId = await userIdOf(PEOPLE.tl.email)
    const [before] = await rows<{ department_id: string }>('deliverables', `select=department_id&id=eq.${job.deliverableId}`)

    const am = await as(browser, 'am')
    await openEdit(am, job)
    await pickPerson(am, 'piece-panel-owner', PEOPLE.tl.name)
    await am.getByTestId('piece-panel-save').click()
    await closeBanner(am, /saved/i)
    await expect.poll(async () => (await rows<{ owner_user_id: string }>('deliverables', `select=owner_user_id&id=eq.${job.deliverableId}`))[0].owner_user_id).toBe(tlId)
    // A lead of the same department: the department stays (ADR-0102 d.1).
    expect((await rows<{ department_id: string }>('deliverables', `select=department_id&id=eq.${job.deliverableId}`))[0].department_id).toBe(before.department_id)

    // Back to the Creative lead, for the tests below.
    await am.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
    await expect(am.getByTestId('piece-panel')).toBeVisible()
    await pickPerson(am, 'piece-panel-owner', PEOPLE.lead.name)
    await am.getByTestId('piece-panel-save').click()
    await closeBanner(am, /saved/i)
    await expect.poll(async () => (await rows<{ owner_user_id: string }>('deliverables', `select=owner_user_id&id=eq.${job.deliverableId}`))[0].owner_user_id).toBe(leadId)
    await am.context().close()
  })

  test('may NOT: a department lead is offered no owner outside the department; a team member is offered no Edit and no editor', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await openEdit(lead, job)
    await lead.getByTestId('piece-panel-owner').fill(PEOPLE.content.name)
    await expect(lead.getByTestId('piece-panel-owner-none')).toBeVisible()
    await lead.getByTestId('piece-drawer-x').click()
    await lead.context().close()

    const maker = await as(browser, 'maker')
    await maker.goto(`/campaigns/${job.campaignId}`)
    await maker.getByTestId('campaign-tab-grid').click()
    await expect(maker.getByTestId(`campaign-deliverable-name-${job.deliverableId}`)).toBeVisible()
    await expect(maker.getByTestId(`campaign-deliverable-edit-${job.deliverableId}`)).toHaveCount(0)
    // A link to the piece opens the read-only drawer: no editor.
    await maker.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
    await expect(maker.getByTestId('piece-drawer')).toBeVisible()
    await expect(maker.getByTestId('piece-panel')).toHaveCount(0)
    await maker.context().close()
  })

  test('Close asks first, names the live work, and archives the piece', async ({ browser }) => {
    const am = await as(browser, 'am')
    const closing = await releaseSingleJob(am, { title: `Edit piece close ${Date.now()}`, department: 'Creative', type: 'Social Advertisement' })
    const live = (await rows('sub_tasks', `select=id&deliverable_id=eq.${closing.deliverableId}&status=not.in.(done,cancelled)`)).length
    expect(live).toBeGreaterThan(0)

    await openEdit(am, closing)
    await am.getByTestId('piece-panel-close-piece').click()
    await expect(am.getByTestId('piece-panel-close-confirm-dialog')).toBeVisible()
    await expect(am.getByTestId('piece-panel-close-confirm-detail')).toContainText(`${live} task`)
    // Cancel: back to the panel, nothing written.
    await am.getByTestId('piece-panel-close-confirm-cancel').click()
    await expect(am.getByTestId('piece-panel')).toBeVisible()
    expect((await rows<{ state: string }>('deliverables', `select=state&id=eq.${closing.deliverableId}`))[0].state).not.toBe('archived')
    // Confirm: archived, its tasks called off.
    await am.getByTestId('piece-panel-close-piece').click()
    await am.getByTestId('piece-panel-close-confirm-confirm').click()
    await closeBanner(am, /closed/i)
    await expect.poll(async () => (await rows<{ state: string }>('deliverables', `select=state&id=eq.${closing.deliverableId}`))[0].state).toBe('archived')
    expect((await rows('sub_tasks', `select=id&deliverable_id=eq.${closing.deliverableId}&status=not.in.(done,cancelled)`)).length).toBe(0)
    await am.context().close()
  })
})
