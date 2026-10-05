import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows } from '../helpers/db'
import { fillSingleJobToReview } from '../helpers/single-job'
import { chooseLanguages } from '../helpers/campaign-wizard'

/**
 * Coverage — the campaign wizard, its review step, the campaign page and the campaigns list
 * (I49: BriefWizard 13, ReviewStep 6, CampaignPage 4, CampaignsPage 2, BriefIngestPanel 2,
 * BriefReceiptPanel 3, DocumentFiling 1).
 *
 * Actors: `am` (Northwind's account manager) may do everything; `am2` (Luma's) may capture but not
 * approve — the campaign is left pending for `am`; `maker` is not offered the wizard.
 *
 * The model calls (`ingest-brief`, `propose-deliverables`, `generate-brief`) and B2 (`asset-url`)
 * are mocked: what is tested is the screen and the rows it writes, not the model.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}
function sundayOut(weeksOut: number): string {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + 7 * weeksOut + ((7 - d.getUTCDay()) % 7))
  return d.toISOString().slice(0, 10)
}
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
const BUCKET = 'https://b2.local.test'

async function mocks(page: Page) {
  await page.route('**/functions/v1/ingest-brief', async (route) => {
    // The campaign brief's keys are fixed (src/lib/brief/fields.ts); three of them come back.
    const fields = { background: 'Read from the file: background', task: 'Read from the file: task', insight: 'Read from the file: insight' }
    await route.fulfill({ json: { fields, oversized: [] } })
  })
  // ADR-0097: the model answers with catalogue codes; the rows are named by the catalogue. Both in one
  // workstream — every campaign piece is in one (ADR-0116 d.3).
  const [creative] = await rows<{ id: string }>('departments', 'select=id&name=eq.Creative')
  await page.route('**/functions/v1/generate-deliverables', async (route) => {
    await route.fulfill({ json: {
      deliverables: [
        { name: 'Billboard', quantity: 1, typeCode: 'ADV-006', needsType: false, note: null, channel: 'OOH', phaseNumber: null, group: 0 },
        { name: 'Social Advertisement', quantity: 1, typeCode: 'ADV-003', needsType: false, note: null, channel: 'Instagram', phaseNumber: null, group: 0 },
      ],
      groups: [{ name: 'Launch visuals', departmentId: creative.id }],
      vocabulary: { types: 'offered', channels: 'offered' },
      needsType: 0,
    } })
  })
  await page.route('**/functions/v1/generate-brief', async (route) => {
    const req = route.request().postDataJSON() as { fields?: { key: string }[] }
    const values: Record<string, string> = {}
    for (const f of req.fields ?? []) values[f.key] = `Generated: ${f.key}`
    await route.fulfill({ json: { values, oversized: [] } })
  })
  await page.route(`${BUCKET}/**`, (route) => route.fulfill({ status: 200, body: '' }))
  await page.route('**/functions/v1/asset-url', async (route) => {
    const body = route.request().postDataJSON() as { op: string; fileName?: string; folderId?: string }
    if (body.op === 'upload') {
      // A file row must name an object inside its own tenant (20261002130000, I74.38): key it as asset-url does.
      const [f] = await rows<{ tenant_id: string; client_id: string }>('asset_folders', `select=tenant_id,client_id&id=eq.${body.folderId}`)
      const objectKey = `${f!.tenant_id}/${f!.client_id}/${body.folderId}/${Date.now()}-${body.fileName}`
      return route.fulfill({ json: { uploadUrl: `${BUCKET}/put/${objectKey}`, objectKey, provider: 'b2' } })
    }
    return route.fulfill({ json: { url: `${BUCKET}/get/x` } })
  })
}
/** Resume the draft and walk forward to step `n` (a draft resumes where it was left, G2). */
async function resumeAt(page: Page, draftId: string, n: number) {
  await page.goto(`/campaigns/new?draft=${draftId}`)
  await expect(page.locator('[data-testid^="wizard-step-"]').first()).toBeVisible()
  // The form renders before the draft arrives; on step 1 the name filling in is the hydration.
  if (await page.getByTestId('wizard-name').isVisible().catch(() => false)) {
    await expect(page.getByTestId('wizard-name')).not.toHaveValue('', { timeout: 15_000 })
  }
  // Five steps (CB-v3); the loop allows one spare press.
  for (let i = 0; i < 6; i++) {
    if (await page.getByTestId(`wizard-step-${n}`).isVisible().catch(() => false)) return
    await page.getByTestId('wizard-next').click()
    await page.waitForTimeout(300)
    const err = page.getByTestId('wizard-error')
    if (await err.isVisible().catch(() => false)) {
      const step = await page.locator('[data-testid^="wizard-step-"]').first().getAttribute('data-testid')
      throw new Error(`resume stopped at ${step} by: ${await err.textContent()}`)
    }
  }
  await expect(page.getByTestId(`wizard-step-${n}`)).toBeVisible()
}

let name: string
let campaignId: string

test.describe('Coverage — Campaign wizard, review, page and list', () => {
  test('step 1–2: the receipt; the brief from a FILE, each read field kept or edited; Next refused and named; the journey fields; attachments', async ({ browser }) => {
    name = `Cov campaign ${Date.now()}`
    const am = await as(browser, 'am')
    await mocks(am)
    await am.goto('/campaigns/new')
    await am.getByTestId('wizard-client').selectOption({ label: 'Northwind Beverages' })
    await am.getByTestId('wizard-brand').selectOption({ label: 'Northwind' })
    await am.getByTestId('wizard-name').fill(name)
    // The receipt sits on step 1 (ADR-0066, Edward 3 Sep): Choose (a file picker for the
    // screenshot) reveals the fields; then subject, timezone and the arrival typed by hand.
    const receiptChooser = am.waitForEvent('filechooser')
    await am.getByTestId('receipt-choose').click()
    await (await receiptChooser).setFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') })
    await expect(am.getByTestId('receipt-preview')).toBeVisible()
    await expect(am.getByTestId('receipt-reading')).toHaveCount(0, { timeout: 30_000 })
    await am.getByTestId('receipt-subject').fill('Re: summer launch')
    const tz = am.getByTestId('receipt-timezone')
    const tzValues = await tz.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))
    const dubai = tzValues.find((v) => /Dubai/.test(v))!
    expect(dubai).toBeTruthy()
    await tz.selectOption(dubai)
    await am.getByTestId('receipt-date').fill(shift(sundayOut(0), -1))
    await am.getByTestId('receipt-time').fill('11:30')
    // ADR-0116 / CB-v3-01: no switches on step 1 — the phases card is a sentence and "+ Add a phase", and a
    // campaign uses phases once one is added; workstreams are always on.
    await expect(am.getByTestId('wizard-phases-explain')).toBeVisible()
    await expect(am.getByTestId('wizard-phases-add')).toBeVisible()
    await expect(am.locator('[data-testid^="wizard-phases-row-"]')).toHaveCount(0)
    await am.getByTestId('wizard-next').click()
    await expect(am.getByTestId('wizard-step-2')).toBeVisible()

    // The brief from a file: Choose opens the picker (the input is hidden) and the drop zone reads
    // the file the moment it is chosen. The model fills three fields; each is marked where it sits,
    // with a Keep (Edward, 24 Sep: "in each field within the form, so the user can either keep or edit").
    await expect(am.getByTestId('brief-ingest-file')).toBeHidden()
    const chooser = am.waitForEvent('filechooser')
    await am.getByTestId('brief-ingest-choose').click()
    await (await chooser).setFiles({ name: 'brief.txt', mimeType: 'text/plain', buffer: Buffer.from('Summer launch. Three statics and a key visual for OOH.') })
    await expect(am.getByTestId('brief-ingest-source-note')).toContainText('brief.txt', { timeout: 15_000 })
    const marks = am.locator('[data-testid^="wizard-brief-"][data-testid$="-suggested"]')
    await expect(marks).toHaveCount(3, { timeout: 15_000 })
    const firstKey = (await marks.first().getAttribute('data-testid'))!.replace('wizard-brief-', '').replace('-suggested', '')
    await am.getByTestId(`wizard-brief-${firstKey}-keep`).click()
    await expect(am.getByTestId(`wizard-brief-${firstKey}-suggested`)).toHaveCount(0)
    await expect(marks).toHaveCount(2)

    // The journey and measures (paid media): every field takes text; the account manager holds
    // campaign_budget:view, so the budget is among them (I56.18).
    const perfKeys = ['perfObjective', 'perfBudget', 'perfAudience', 'perfGeography', 'perfPlatforms']
    for (const [i, k] of perfKeys.entries()) await am.getByTestId(`wizard-brief-${k}`).fill(`perf ${i}`)

    // Attachments sit behind "Add reference files" (I56.18); Choose opens the picker and the file
    // is filed into the campaign's References.
    await am.getByTestId('wizard-references-toggle').click()
    const docChooser = am.waitForEvent('filechooser')
    await am.getByTestId('campaign-filing-choose').click()
    await (await docChooser).setFiles({ name: 'moodboard.txt', mimeType: 'text/plain', buffer: Buffer.from('mood') })
    await expect(am.getByTestId('campaign-filing-filed')).toContainText(/1 document/, { timeout: 15_000 })

    // Next with two read fields unchecked and the proposition blank: refused, and the refusal NAMES
    // what is outstanding (I49.73; Edward, 24 Sep: "Refuse and name them").
    await am.getByTestId('wizard-next').click()
    await expect(am.getByTestId('wizard-error')).toBeVisible()
    await expect(am.getByTestId('wizard-error')).toContainText(/proposition/i)
    await am.getByTestId('wizard-error-close').click()
    await expect(am.getByTestId('wizard-brief-proposition')).toHaveAttribute('aria-invalid', 'true')
    await expect(am.getByTestId('wizard-brief-proposition-missing')).toBeVisible()
    while ((await marks.count()) > 0) {
      const key = (await marks.first().getAttribute('data-testid'))!.replace('wizard-brief-', '').replace('-suggested', '')
      await am.getByTestId(`wizard-brief-${key}-keep`).click()
    }
    await am.getByTestId('wizard-brief-proposition').fill('Cold before you get there.')
    await chooseLanguages(am, 'wizard-languages-picker', ['en'])
    await am.getByTestId('wizard-next').click()
    await expect(am.getByTestId('wizard-step-3')).toBeVisible()
    const [draft] = await rows<{ id: string; brief: Record<string, string> }>('campaigns', `select=id,brief&name=eq.${encodeURIComponent(name)}`)
    campaignId = draft.id
    expect(draft.brief[firstKey]).toContain('Read from the file')
    expect(Object.values((draft.brief as { performance?: Record<string, string> }).performance ?? {}).some((v) => String(v).startsWith('perf '))).toBe(true)
    const [receipt] = await rows<{ subject: string | null; received_tz: string | null; asset_id: string | null }>('campaign_brief_receipts', `select=subject,received_tz,asset_id&campaign_id=eq.${campaignId}`)
    expect(receipt.subject).toBe('Re: summer launch')
    expect(receipt.received_tz).toContain('Dubai')
    expect(receipt.asset_id).not.toBeNull()
    await am.context().close()
  })

  test('step 3–4: a piece’s every field, add and remove a piece, an owner each; a date through the row’s Edit', async ({ browser }) => {
    const am = await as(browser, 'am')
    await mocks(am)
    await resumeAt(am, campaignId, 3)
    await expect(am.getByTestId('wizard-busy-propose')).toHaveCount(0, { timeout: 15_000 })

    // The proposal landed on The work: two pieces, in the one workstream proposed (ADR-0116 d.3).
    const pieces = am.locator('[data-testid^="wizard-work-piece-"]')
    await expect(pieces).toHaveCount(2)
    const ids = await pieces.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.replace('wizard-work-piece-', '')))
    const [rowId, secondId] = ids as [string, string]

    // The first piece's every field, in its dialog.
    await am.getByTestId(`wizard-work-edit-${rowId}`).click()
    await expect(am.getByTestId('wizard-piece-dialog')).toBeVisible()
    await am.getByTestId('wizard-piece-name').fill('Key visual, renamed')
    await am.getByTestId('wizard-piece-idea').fill('The cold is the product.')
    await am.getByTestId('wizard-piece-quantity').fill('3')
    await am.getByTestId('wizard-piece-owner').selectOption({ label: PEOPLE.tl.name })
    const lastOption = async (sel: ReturnType<Page['getByTestId']>) => {
      const values = await sel.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean))
      if (values.length) await sel.selectOption(values[values.length - 1])
      return values.length
    }
    expect(await lastOption(am.getByTestId('wizard-piece-channel'))).toBeGreaterThan(0)
    await lastOption(am.getByTestId('wizard-piece-format'))
    await am.getByTestId('wizard-piece-priority').selectOption('high')
    await am.getByTestId('wizard-piece-notes').fill('Client wants it by Thursday.')
    await am.getByTestId('wizard-piece-save').click()
    await expect(am.getByTestId(`wizard-work-piece-${rowId}`)).toContainText('Key visual, renamed')
    await am.getByTestId(`wizard-work-edit-${secondId}`).click()
    // ADR-0128 (I66.9): the owner list offers the workstream's department's leads — the Creative lead here.
    await am.getByTestId('wizard-piece-owner').selectOption({ label: PEOPLE.lead.name })
    await am.getByTestId('wizard-piece-save').click()

    // Add a piece by typing its name in the workstream, then remove it — with the reason the dialog asks for.
    const quickAdd = am.locator('input[data-testid^="wizard-work-new-"]:not([data-testid$="__ungrouped__"])')
    await expect(quickAdd).toHaveCount(1)
    await quickAdd.fill('Extra reel')
    await quickAdd.press('Enter')
    await expect(pieces).toHaveCount(3)
    const addedId = (await pieces.nth(2).getAttribute('data-testid'))!.replace('wizard-work-piece-', '')
    await am.getByTestId(`wizard-work-remove-${addedId}`).click()
    await am.getByTestId('wizard-remove-piece-reason').fill('Not in the brief.')
    await am.getByTestId('wizard-remove-piece-confirm').click()
    await expect(pieces).toHaveCount(2)

    await am.getByTestId('wizard-next').click()
    await expect(am.getByTestId('wizard-step-4')).toBeVisible()

    // Timing without phases: one list, the go-live optional at the top, a date per row through its
    // Edit — and the start counted back from it.
    await am.getByTestId('wizard-golive').fill(sundayOut(4))
    const due = shift(sundayOut(2), 1) // a Monday
    await am.getByTestId(`wizard-timing-edit-${rowId}`).click()
    await am.getByTestId('wizard-timing-piece-due').fill(due)
    await expect(am.getByTestId('wizard-timing-piece-starts')).toContainText(/Work starts/)
    await am.getByTestId('wizard-timing-piece-given').check()
    await am.getByTestId('wizard-timing-piece-save').click()
    await expect(am.getByTestId(`wizard-timing-given-tag-${rowId}`)).toBeVisible()
    await am.getByTestId('wizard-next').click()
    await expect(am.getByTestId('wizard-step-5')).toBeVisible()
    await am.context().close()

    const [c] = await rows<{ brief: { deliverables: { name: string; quantity: number; dueAt: string | null; givenToClient?: boolean; contentIdea?: string }[] } }>('campaigns', `select=brief&id=eq.${campaignId}`)
    const spec = [...c.brief.deliverables].sort((a, b) => a.name.localeCompare(b.name))
    expect(spec.map((d) => d.name)).toEqual(['Key visual, renamed', 'Social Advertisement'])
    expect(spec[0]).toMatchObject({ quantity: 3, dueAt: due, givenToClient: true, contentIdea: 'The cold is the product.' })
  })

  test('step 5: Edit any step goes back to the brief; Save as a draft keeps the draft; resume from the list', async ({ browser }) => {
    const am = await as(browser, 'am')
    await mocks(am)
    await resumeAt(am, campaignId, 5)
    await expect(am.getByTestId('wizard-review')).toContainText('This one is yours to approve')
    await am.getByTestId('wizard-review-edit').click()
    await expect(am.getByTestId('wizard-step-2')).toBeVisible()
    await resumeAt(am, campaignId, 5)

    // Save as a draft: back to the list, the draft kept and resumable from there.
    await am.getByTestId('wizard-review-draft').click()
    await expect(am).toHaveURL(/\/campaigns$/)
    expect((await rows<{ status: string }>('campaigns', `select=status&id=eq.${campaignId}`))[0].status).toBe('draft')
    await am.getByTestId(`campaign-draft-resume-${campaignId}`).click()
    await expect(am.locator('[data-testid^="wizard-step-"]').first()).toBeVisible()
    // Cancel, on the steps before review: back to the list, the draft still kept.
    await am.getByTestId('wizard-cancel').click()
    await expect(am).toHaveURL(/\/campaigns$/)
    expect((await rows<{ status: string }>('campaigns', `select=status&id=eq.${campaignId}`))[0].status).toBe('draft')
    await am.context().close()
  })

  test('submit by a manager who is not the account manager leaves it pending; the campaigns list opens it; the account manager approves on the page', async ({ browser }) => {
    const other = await as(browser, 'am2')
    await mocks(other)
    await resumeAt(other, campaignId, 5)
    await other.getByTestId('wizard-review-approve').click()
    // The submit lands (pending); the approval is refused for reach — and the refusal NAMES the
    // account manager and says the campaign is saved (I49.72, ADR-0083 d.15), with the campaign
    // page one press away. Not reportable: it is an answer.
    const refused = other.getByTestId('wizard-approval-refused-note')
    await expect(refused).toBeVisible({ timeout: 30_000 })
    await expect(refused).toContainText(PEOPLE.am.name)
    await expect(refused).toContainText(/saved/i)
    await expect(other.getByTestId('wizard-not-draft')).toHaveCount(0)
    await expect.poll(async () => (await rows<{ status: string }>('campaigns', `select=status&id=eq.${campaignId}`))[0].status).toBe('pending_approval')
    await other.getByTestId('wizard-approval-refused-open').click()
    await expect(other).toHaveURL(new RegExp(`/campaigns/${campaignId}$`))
    await other.context().close()

    const am = await as(browser, 'am')
    await am.goto('/campaigns')
    await am.getByTestId(`campaign-open-${campaignId}`).click()
    await expect(am).toHaveURL(new RegExp(`/campaigns/${campaignId}$`))
    await am.getByTestId('campaign-approve').click()
    await expect.poll(async () => (await rows<{ status: string }>('campaigns', `select=status&id=eq.${campaignId}`))[0].status).toBe('approved')
    await expect(am.getByTestId('campaign-approve')).toHaveCount(0)

    // On the Grid (CG-01): the task lists waiting for their owner (ADR-0100 d.2) — not a brief to
    // write, which is retired (ADR-0100 d.6). The account manager does not own the piece, so the
    // row names who does.
    await am.getByTestId('campaign-tab-grid').click()
    const lists = am.getByTestId('campaign-task-lists')
    await expect(lists).toBeVisible()
    await expect(lists).toContainText('Key visual, renamed')
    await expect(am.locator('[data-testid^="campaign-department-nobrief-"]')).toHaveCount(0)
    // Open: the piece drawer (CG-04, I57.16) — the piece, its owner, its tasks one by one.
    const dels = await rows<{ id: string }>('deliverables', `select=id,streams!inner(campaign_id)&streams.campaign_id=eq.${campaignId}&order=name.asc`)
    const shown = am.locator('[data-testid^="campaign-deliverable-open-"]').first()
    const openId = (await shown.getAttribute('data-testid'))!.replace('campaign-deliverable-open-', '')
    expect(dels.some((d) => d.id === openId)).toBe(true)
    await am.getByTestId(`campaign-deliverable-open-${openId}`).click()
    await expect(am.getByTestId('piece-drawer')).toBeVisible()
    // ADR-0132 d.8: the piece is edited here, in its panel — no "Open in Deliverables" any more.
    await expect(am.getByTestId('piece-panel')).toBeVisible()
    await expect(am.getByTestId('piece-drawer-full')).toHaveCount(0)
    await am.getByTestId('piece-drawer-close').click()
    await expect(am.getByTestId('piece-drawer')).toHaveCount(0)
    await am.context().close()
  })

  test('the wizard refuses to reopen a released campaign, and offers its page instead', async ({ browser }) => {
    const am = await as(browser, 'am')
    await am.goto(`/campaigns/new?draft=${campaignId}`)
    await expect(am.getByTestId('wizard-not-draft')).toBeVisible()
    await am.getByTestId('wizard-not-draft-open').click()
    await expect(am).toHaveURL(new RegExp(`/campaigns/${campaignId}$`))
    await am.context().close()
  })

  test('a single job on the list: a pending one offers Continue; Open goes to its page and on to its deliverable', async ({ browser }) => {
    // A single job captured by a colleague and refused at Approve is "pending" (ADR-0083 d.16):
    // the list offers Continue to whoever may approve.
    const jobTitle = `Cov pending job ${Date.now()}`
    const other = await as(browser, 'am2')
    await fillSingleJobToReview(other, { title: jobTitle, department: 'Creative', type: 'Social Advertisement' })
    await other.getByTestId('sj-approve').click()
    const lookalike = other.getByTestId('sj-similar-dialog')
    const refusal = other.getByTestId('sj-error')
    const first = await Promise.race([
      lookalike.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'prompt' as const),
      refusal.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'refused' as const),
    ])
    if (first === 'prompt') await other.getByTestId('sj-similar-separate').click()
    await expect(refusal).toBeVisible({ timeout: 30_000 })
    await other.context().close()
    const [job] = await rows<{ id: string; status: string }>('campaigns', `select=id,status&name=eq.${encodeURIComponent(jobTitle)}`)
    expect(job.status).toBe('pending_approval')

    const am = await as(browser, 'am')
    await am.goto('/campaigns')
    await am.getByTestId('campaigns-scope-all').click()
    await am.getByTestId(`campaign-job-continue-${job.id}`).click()
    await expect(am.getByTestId('surface-single-job')).toBeVisible()
    await expect(am.getByTestId('sj-review')).toBeVisible()
    await am.getByTestId('sj-approve').click()
    const prompt = am.getByTestId('sj-similar-dialog')
    const outcome = await Promise.race([
      prompt.waitFor({ state: 'visible', timeout: 10_000 }).then(() => 'prompt' as const),
      am.waitForURL(/\/campaigns\/[0-9a-f-]{36}$/, { timeout: 30_000 }).then(() => 'released' as const),
    ])
    if (outcome === 'prompt') await am.getByTestId('sj-similar-separate').click()
    await expect(am).toHaveURL(new RegExp(`/campaigns/${job.id}$`), { timeout: 30_000 })

    // From the list: Open → the job's page → its one deliverable, in the piece's panel on the same page (ADR-0132 d.8 —
    // "Open the deliverable" and the Deliverables window are gone for campaign work).
    await am.goto('/campaigns')
    await am.getByTestId(`campaign-open-${job.id}`).click()
    await expect(am).toHaveURL(new RegExp(`/campaigns/${job.id}$`))
    await expect(am.getByTestId('campaign-open-deliverable')).toHaveCount(0)
    const [piece] = await rows<{ id: string }>('deliverables', `select=id,streams!inner(campaign_id)&streams.campaign_id=eq.${job.id}`)
    await am.getByTestId('campaign-tab-grid').click()
    await am.getByTestId(`campaign-deliverable-open-${piece.id}`).click()
    await expect(am.getByTestId('piece-panel')).toBeVisible()
    await am.context().close()
  })

  test('may NOT: a team member is not offered the wizard', async ({ browser }) => {
    const maker = await as(browser, 'maker')
    await maker.goto('/campaigns/new')
    await expect(maker.getByTestId('wizard-step-1')).toHaveCount(0)
    await expect(maker).not.toHaveURL(/\/campaigns\/new$/)
    await maker.context().close()
  })

  // I49.72 — a manager who is not the account manager submits a campaign: the approval refusal
  // must name who can approve (ADR-0083 d.15), not vanish behind "this is no longer a draft".
})
