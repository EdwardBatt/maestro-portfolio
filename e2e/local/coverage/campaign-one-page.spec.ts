import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows } from '../helpers/db'
import { releaseSingleJob, type ReleasedJob } from '../helpers/single-job'

/**
 * Coverage — ADR-0132, the campaign page is the one page (I68.2, I68.3, I68.6, I68.7, I68.9).
 *
 * A released single job, walked on the campaign page as its account manager:
 *  - the page: Back at the top and the foot, "Edit this brief", Promote on a single job, "Add a deliverable",
 *    and the tabs that would be empty greyed with their (i);
 *  - a link opens the piece's panel on the task the person came from; the ✕ closes it and drops the link's params;
 *  - the panel: a task added by its name and due date (unassigned), edited, removed; the piece's name, channel, language,
 *    brief lines and due date saved; the quantity and the type each asked first, then changed; "The client asked for a
 *    change" opens the change-request route; Close the piece asks, then closes it.
 *
 * Each step reads the database, not the screen alone (a test must be able to fail).
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}
async function piece(id: string) {
  const [d] = await rows<{ name: string; quantity: number; channel: string | null; languages: string[]; notes: string | null;
    due_at: string | null; deliverable_type_id: string | null; state: string }>(
    'deliverables', `select=name,quantity,channel,languages,notes,due_at,deliverable_type_id,state&id=eq.${id}`,
  )
  return d
}
async function tasksOf(id: string) {
  return rows<{ id: string; title: string; status: string; assignee_id: string | null; due_at: string | null }>(
    'sub_tasks', `select=id,title,status,assignee_id,due_at&deliverable_id=eq.${id}&order=sort_order`,
  )
}
async function banner(page: Page) {
  const b = page.getByTestId('campaign-banner')
  if (await b.isVisible().catch(() => false)) await page.getByTestId('campaign-banner-close').click()
}
/** A day two weeks on, as the date box takes it. */
const dayAhead = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

let job: ReleasedJob

test.describe.serial('ADR-0132 — the campaign page is the one page', () => {
  test.beforeAll(async ({ browser }) => {
    const am = await as(browser, 'am')
    job = await releaseSingleJob(am, { title: `One page ${Date.now()}`, department: 'Creative', type: 'Social Advertisement' })
    await am.context().close()
  })

  test('a single job: Back top and foot, Edit this brief, Promote, Add a deliverable, the empty tabs greyed', async ({ browser }) => {
    const am = await as(browser, 'am')
    await am.goto('/campaigns')
    await am.goto(`/campaigns/${job.campaignId}`)
    await expect(am.getByTestId('campaign-back')).toContainText(/Campaigns/)
    await expect(am.getByTestId('campaign-back-foot')).toBeVisible()
    await expect(am.getByTestId('campaign-open-deliverable')).toHaveCount(0)

    // One deliverable: Board and Where is everything have nothing to compare, and say so.
    await expect(am.getByTestId('campaign-tab-board')).toBeDisabled()
    await expect(am.getByTestId('campaign-tab-where')).toBeDisabled()
    await am.getByTestId('campaign-tab-board-why-button').click()
    await expect(am.getByTestId('campaign-tab-board-why-body')).toContainText(/one/)
    await expect(am.getByTestId('campaign-tab-grid')).toBeEnabled()

    await am.getByTestId('campaign-edit-brief').click()
    await expect(am.getByTestId('campaign-tab-brief')).toHaveAttribute('aria-selected', 'true')

    await am.getByTestId('campaign-promote-job').click()
    await expect(am.getByTestId('campaign-promote')).toBeVisible()
    await am.getByTestId('campaign-promote-cancel').click()

    await am.getByTestId('campaign-add-deliverable').click()
    await expect(am.getByTestId('campaign-deliverable-form-cancel')).toBeVisible()
    await am.getByTestId('campaign-deliverable-form-cancel').click()

    await am.getByTestId('campaign-back-foot').click()
    await expect(am).toHaveURL(/\/campaigns$/)
    await am.context().close()
  })

  test('a link opens the piece on the task the person came from; the ✕ closes it and drops the link', async ({ browser }) => {
    const [first] = await tasksOf(job.deliverableId)
    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}&task=${first.id}`)
    await expect(am.getByTestId('piece-panel')).toBeVisible()
    // ADR-0140: the panel's task list is `piece-panel-tasks`; the row the person came from is marked.
    await expect(am.getByTestId(`piece-panel-tasks-row-${first.id}`)).toHaveAttribute('data-marked', 'true')
    await expect(am.getByTestId('piece-panel-tasks-came-from')).toBeVisible()
    // I67.6: the ✕ takes the focus, so the status pill's card does not open over the name.
    await expect(am.getByTestId('piece-drawer-x')).toBeFocused()
    await am.getByTestId('piece-drawer-x').click()
    await expect(am.getByTestId('piece-panel')).toHaveCount(0)
    await expect(am).not.toHaveURL(/piece=/)
    await am.context().close()
  })

  test('a task is added by its name, unassigned; renamed; removed (with an undo window)', async ({ browser }) => {
    // ADR-0140 d.2 / I74.12: the piece's OWNER works its suggested list on the panel — add your own, rename, remove
    // with undo. (The add line takes a name; days and person are the editor's and the booking's.)
    const lead = await as(browser, 'lead')
    await lead.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
    const title = `Print adaptation ${Date.now()}`
    await lead.getByTestId('piece-panel-tasks-add').click()
    await lead.getByTestId('piece-panel-tasks-add-name').fill(title)
    await lead.getByTestId('piece-panel-tasks-add-save').click()
    await expect.poll(async () => (await tasksOf(job.deliverableId)).find((t) => t.title === title)?.status).toBe('todo')
    const added = (await tasksOf(job.deliverableId)).find((t) => t.title === title)!
    expect(added.assignee_id).toBeNull()

    await lead.getByTestId(`piece-panel-tasks-rename-${added.id}`).click()
    await lead.getByTestId(`piece-panel-tasks-name-${added.id}`).fill(`${title} (A3)`)
    await lead.getByTestId(`piece-panel-tasks-name-${added.id}`).press('Enter')
    await expect.poll(async () => (await tasksOf(job.deliverableId)).find((t) => t.id === added.id)?.title).toBe(`${title} (A3)`)

    await lead.getByTestId(`piece-panel-tasks-remove-${added.id}`).click()
    await expect(lead.getByTestId('piece-panel-tasks-undo')).toBeVisible()
    // Never given or started: once the undo window passes it is gone (remove_sub_task decides).
    await expect.poll(async () => (await tasksOf(job.deliverableId)).some((t) => t.id === added.id && t.status !== 'cancelled'), { timeout: 20_000 }).toBe(false)
    await lead.context().close()
  })

  test('the piece is saved: name, channel, language, brief lines and due date', async ({ browser }) => {
    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
    const name = `One page piece ${Date.now()}`
    const due = dayAhead(20)
    await am.getByTestId('piece-panel-name').fill(name)
    await am.getByTestId('piece-panel-channel').fill('TikTok')
    // ADR-0117 addendum (Q18): the languages are a picker now; at least one stays (deliverable-languages.spec covers it).
    await expect(am.getByTestId('piece-panel-languages')).toBeVisible()
    await am.getByTestId('piece-panel-brief-lines').fill('Arabic master, 1080 × 1350.')
    await am.getByTestId('piece-panel-due').fill(due)
    await am.getByTestId('piece-panel-save').click()
    await expect.poll(async () => (await piece(job.deliverableId)).name).toBe(name)
    const d = await piece(job.deliverableId)
    expect(d.channel).toBe('TikTok')
    expect(d.languages.length).toBeGreaterThan(0)
    expect(d.notes).toBe('Arabic master, 1080 × 1350.')
    expect(d.due_at?.slice(0, 10)).toBe(due)
    await banner(am)
    await am.context().close()
  })

  test('the quantity is asked first, naming what it adds, then changed directly', async ({ browser }) => {
    const before = await piece(job.deliverableId)
    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
    await am.getByTestId('piece-panel-quantity').fill(String(before.quantity + 1))
    await am.getByTestId('piece-panel-save').click()
    await expect(am.getByTestId('piece-panel-quantity-confirm-dialog')).toBeVisible()
    expect((await piece(job.deliverableId)).quantity).toBe(before.quantity)
    await am.getByTestId('piece-panel-quantity-confirm-confirm').click()
    await expect.poll(async () => (await piece(job.deliverableId)).quantity).toBe(before.quantity + 1)
    await banner(am)
    await am.context().close()
  })

  test('a new type is asked first — what is cancelled, kept, added — then the list is replaced', async ({ browser }) => {
    const before = await piece(job.deliverableId)
    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
    // The box holds the loaded type before it is typed over (a fill before the catalogue loaded read "Social AdvertisementStatic Post").
    await expect(am.getByTestId('piece-panel-type')).toHaveValue('Social Advertisement')
    await am.getByTestId('piece-panel-type').fill('Static Post')
    await am.getByTestId('piece-panel-type-list').getByRole('option').first().dispatchEvent('mousedown')
    await am.getByTestId('piece-panel-save').click()
    const confirm = am.getByTestId('piece-panel-type-confirm-dialog')
    await expect(confirm).toBeVisible()
    await expect(confirm).toContainText(/added/)
    expect((await piece(job.deliverableId)).deliverable_type_id).toBe(before.deliverable_type_id)
    await am.getByTestId('piece-panel-type-confirm-confirm').click()
    await expect.poll(async () => (await piece(job.deliverableId)).deliverable_type_id).not.toBe(before.deliverable_type_id)
    await banner(am)
    await am.context().close()
  })

  test('"The client asked for a change" opens the change-request route', async ({ browser }) => {
    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
    await am.getByTestId('piece-panel-client-change').click()
    await expect(am.getByTestId('campaign-deliverable-form')).toBeVisible()
    await expect(am.getByTestId('piece-panel')).toHaveCount(0)
    await am.getByTestId('campaign-deliverable-form-cancel').click()
    await am.context().close()
  })

  test('Close the job asks first, then closes it', async ({ browser }) => {
    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
    await am.getByTestId('piece-panel-close-piece').click()
    await expect(am.getByTestId('piece-panel-close-confirm-dialog')).toBeVisible()
    await am.getByTestId('piece-panel-close-confirm-confirm').click()
    await expect.poll(async () => (await piece(job.deliverableId)).state).toBe('archived')
    await am.context().close()
  })
})
