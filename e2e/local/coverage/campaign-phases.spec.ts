import { test, expect, type Browser, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { authFile, PEOPLE } from '../fixtures'
import { rows } from '../helpers/db'
import { releaseSingleJob } from '../helpers/single-job'
import { clearMailbox, expectMail, readMailHtml, searchMail } from '../helpers/mailpit'
import { reviewAndApprove, chooseLanguages } from '../helpers/campaign-wizard'

/**
 * Coverage — campaign phases (ADR-0096), proposals from the catalogue (ADR-0097), a promoted job
 * that grows (I53.4), a due date required (ADR-0093 addendum), a rename that reaches the tasks
 * (ADR-0071 addendum) and the 18:00 deadline (ADR-0075 addendum). Edward, 20 Sep: *"promote single
 * to campaign, create campaign with phases, add phases to existing campaigns etc. … including
 * testing unauthorised access"* — every door as one who may and one who may not (ADR-0095).
 *
 * The model is mocked (`generate-deliverables`): what is tested is the screen and the rows.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}
const dayOut = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
const API = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

/** The signed-in person's access token, from the storage state the setup project wrote. */
function tokenOf(tag: keyof typeof PEOPLE): string {
  const state = JSON.parse(readFileSync(authFile(tag), 'utf8')) as { origins: { localStorage: { name: string; value: string }[] }[] }
  for (const o of state.origins) {
    for (const item of o.localStorage) {
      if (item.name.endsWith('-auth-token')) return (JSON.parse(item.value) as { access_token: string }).access_token
    }
  }
  throw new Error(`no token for ${tag}`)
}
/** An RPC called AS a person — the API door, for the "may not" that the screen never offers. */
async function rpcAs(tag: keyof typeof PEOPLE, fn: string, args: Record<string, unknown>) {
  const res = await fetch(`${API}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${tokenOf(tag)}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  })
  return { status: res.status, body: await res.text() }
}
async function pickPerson(page: Page, testId: string, name: string) {
  await page.getByTestId(testId).fill(name)
  await page.getByTestId(`${testId}-list`).getByRole('option', { name: new RegExp(name) }).first().dispatchEvent('mousedown')
}
async function pickDeliverable(page: Page, testId: string, query: string) {
  await page.getByTestId(testId).fill(query)
  await page.getByTestId(`${testId}-list`).getByRole('option').first().dispatchEvent('mousedown')
  await expect(page.getByTestId(`${testId}-chip`)).toBeVisible()
}
async function closeBanner(page: Page, pattern: RegExp) {
  await expect(page.getByTestId('campaign-banner')).toContainText(pattern)
  await page.getByTestId('campaign-banner-close').click()
}

/** A proposal with a suggested phase and one row outside the catalogue (ADR-0097 d.4), all in one workstream —
 *  every campaign piece is in one (ADR-0116 d.3). */
async function mockProposals(page: Page, opts: { withPhases: boolean }) {
  const [creative] = await rows<{ id: string }>('departments', 'select=id&name=eq.Creative')
  await page.route('**/functions/v1/generate-deliverables', async (route) => {
    const req = route.request().postDataJSON() as { brief: string; phases?: { number: number }[] }
    const phases = req.phases ?? []
    expect(phases.length > 0).toBe(opts.withPhases)
    await route.fulfill({ json: {
      deliverables: [
        { name: 'Social Advertisement', quantity: 2, typeCode: 'ADV-003', needsType: false, note: null, channel: null, phaseNumber: phases.length > 1 ? 2 : null, group: 0 },
        { name: 'Billboard', quantity: 1, typeCode: 'ADV-006', needsType: false, note: 'the airport road one', channel: null, phaseNumber: null, group: 0 },
        { name: 'a hologram in the mall', quantity: 1, typeCode: null, needsType: true, note: 'a hologram in the mall', channel: null, phaseNumber: null, group: 0 },
      ],
      groups: [{ name: 'Launch visuals', departmentId: creative.id }],
      vocabulary: { types: 'offered', channels: 'offered' },
      needsType: 1,
    } })
  })
}

let name: string
let campaignId: string
let promotedId: string

test.describe('Coverage — phases, proposals from the catalogue, a promoted job that grows', () => {
  test('the wizard: phases on, the model suggests the phase, a flagged row blocks Next, a date chooses the phase, and the campaign page shows the strip', async ({ browser }) => {
    await clearMailbox()
    const am = await as(browser, 'am')
    await mockProposals(am, { withPhases: true })
    name = `Phases ${Date.now()}`
    await am.goto('/campaigns/new')
    await am.getByTestId('wizard-client').selectOption({ label: 'Northwind Beverages' })
    await am.getByTestId('wizard-name').fill(name)

    // Step 1 — no switch (ADR-0116 d.1, CB-v3-01): the campaign uses phases because one is added.
    await expect(am.getByTestId('wizard-phases-explain')).toBeVisible()
    for (const [phaseName, starts, ends] of [['Pre-Launch', dayOut(0), dayOut(7)], ['Week 1', dayOut(8), dayOut(14)]] as const) {
      await am.getByTestId('wizard-phases-add').click()
      await am.getByTestId('wizard-phase-dialog-name').fill(phaseName)
      await am.getByTestId('wizard-phase-dialog-starts').fill(starts)
      await am.getByTestId('wizard-phase-dialog-date').fill(ends)
      await am.getByTestId('wizard-phase-dialog-submit').click()
    }
    await am.getByTestId('wizard-next').click()
    await expect(am.getByTestId('wizard-step-2')).toBeVisible()
    await am.getByTestId('wizard-brief-proposition').fill('A teaser before launch, then a post every week.')
    await chooseLanguages(am, 'wizard-languages-picker', ['en'])
    await am.getByTestId('wizard-next').click()

    // Step 3 — The work, proposed from the catalogue with the phases handed over.
    await expect(am.getByTestId('wizard-step-3')).toBeVisible()
    await expect(am.getByTestId('wizard-busy-propose')).toHaveCount(0, { timeout: 15_000 })
    const pieces = am.locator('[data-testid^="wizard-work-piece-"]')
    await expect(pieces).toHaveCount(3)
    const ids = await pieces.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.replace('wizard-work-piece-', '')))
    // Named by the catalogue; the row outside it is flagged where it sits.
    await expect(am.getByTestId(`wizard-work-piece-${ids[0]}`)).toContainText('Social Advertisement')
    await expect(am.getByTestId(`wizard-work-warn-${ids[2]}`)).toBeVisible()
    // The suggested phase landed on the piece, and its dialog previews the tasks the type WILL
    // produce — the materialiser's own names, two per unit at quantity 2 (Edward, 22 Sep).
    await am.getByTestId(`wizard-work-edit-${ids[0]}`).click()
    await expect(am.getByTestId('wizard-piece-phase').locator('option:checked')).toContainText('Week 1')
    await am.getByTestId('wizard-piece-tasks-toggle').click()
    const preview = am.getByTestId('wizard-piece-tasks-list')
    // ADR-0071 addendum (4 Oct): a unit names the campaign, then the type and its number.
    await expect(preview).toContainText('· Social Advertisement')
    expect((await preview.locator('li').allTextContents()).filter((t) => /Social Advertisement 2$/.test(t)).length).toBeGreaterThan(0)
    await am.getByTestId('wizard-piece-owner').selectOption({ label: PEOPLE.lead.name })
    await am.getByTestId('wizard-piece-save').click()
    // Billboard: an owner, and Pre-Launch.
    await am.getByTestId(`wizard-work-edit-${ids[1]}`).click()
    await am.getByTestId('wizard-piece-owner').selectOption({ label: PEOPLE.lead.name })
    const phaseSel = am.getByTestId('wizard-piece-phase')
    await phaseSel.selectOption((await phaseSel.locator('option', { hasText: 'Pre-Launch' }).getAttribute('value'))!)
    await am.getByTestId('wizard-piece-save').click()
    // The flagged row: an owner, but no catalogue entry yet — Next refuses, naming why.
    await am.getByTestId(`wizard-work-edit-${ids[2]}`).click()
    await am.getByTestId('wizard-piece-owner').selectOption({ label: PEOPLE.lead.name })
    await am.getByTestId('wizard-piece-save').click()
    await am.getByTestId('wizard-next').click()
    await expect(am.getByTestId('wizard-error')).toContainText(/catalogue/i)
    await am.getByTestId('wizard-error-close').click()
    await am.getByTestId(`wizard-work-edit-${ids[2]}`).click()
    const typeSel = am.getByTestId('wizard-piece-type')
    await typeSel.selectOption((await typeSel.locator('option', { hasText: 'Poster' }).first().getAttribute('value'))!)
    await am.getByTestId('wizard-piece-save').click()
    await expect(am.getByTestId(`wizard-work-warn-${ids[2]}`)).toHaveCount(0)
    await am.getByTestId('wizard-next').click()

    // Step 4 — Timing. The Poster has no phase: named under the table, and its Edit places it by a
    // date inside Week 1. Social Advertisement is given a date in the EARLIER phase and moves there
    // (Edward, 24 Sep: "Move it to that phase") — the dialog says so before the press.
    await expect(am.getByTestId('wizard-step-4')).toBeVisible()
    await expect(am.getByTestId('wizard-timing-unplaced')).toBeVisible()
    await am.getByTestId(`wizard-timing-place-${ids[2]}`).click()
    await am.getByTestId('wizard-timing-piece-due').fill(dayOut(12))
    await expect(am.getByTestId('wizard-timing-piece-moves').or(am.getByTestId('wizard-timing-piece-in-phase'))).toContainText('Week 1')
    await am.getByTestId('wizard-timing-piece-save').click()
    await expect(am.getByTestId('wizard-timing-unplaced')).toHaveCount(0)
    // Social Advertisement sits in Week 1; open it on the strip.
    await am.locator('[data-testid^="wizard-timing-phase-"][role="tab"]').filter({ hasText: 'Week 1' }).click()
    await am.getByTestId(`wizard-timing-edit-${ids[0]}`).click()
    // "Use the phase's own date" puts back what the phase gives — a pull undone in one press.
    await am.getByTestId('wizard-timing-piece-due').fill(dayOut(13))
    await am.getByTestId('wizard-timing-piece-phase-date').click()
    await expect(am.getByTestId('wizard-timing-piece-phase-date')).toHaveCount(0)
    await am.getByTestId('wizard-timing-piece-due').fill(dayOut(5))
    await expect(am.getByTestId('wizard-timing-piece-moves')).toContainText('from Week 1 to Pre-Launch')
    await am.getByTestId('wizard-timing-piece-save').click()
    await expect(am.getByTestId(`wizard-timing-row-${ids[0]}`)).toBeVisible() // the view follows it into Pre-Launch
    // A phase's pencil opens its dialog; an end past the next phase's end is refused, in words.
    const preLaunchEdit = am.locator('[data-testid^="wizard-timing-phase-edit-"]').first()
    const preLaunchId = (await preLaunchEdit.getAttribute('data-testid'))!.replace('wizard-timing-phase-edit-', '')
    await am.getByTestId(`wizard-timing-phase-edit-${preLaunchId}`).click()
    await am.getByTestId('wizard-timing-phase-dialog-date').fill(dayOut(20))
    await expect(am.getByTestId('wizard-timing-phase-dialog-clash')).toContainText(/Week 1 ends on/)
    await expect(am.getByTestId('wizard-timing-phase-dialog-submit')).toBeDisabled()
    await am.getByTestId('wizard-timing-phase-dialog-cancel').click()
    const id = await reviewAndApprove(am)
    campaignId = id

    // The rows: two phases, every deliverable in one, each where its date put it.
    const phases = await rows<{ id: string; number: number; name: string }>('campaign_phases', `select=id,number,name&campaign_id=eq.${campaignId}&order=number`)
    expect(phases.map((p) => [p.number, p.name])).toEqual([[1, 'Pre-Launch'], [2, 'Week 1']])
    const dl = await rows<{ id: string; name: string; phase_id: string | null }>('deliverables', `select=id,name,phase_id,streams!inner(campaign_id)&streams.campaign_id=eq.${campaignId}`)
    expect(dl).toHaveLength(3)
    expect(dl.every((d) => d.phase_id != null)).toBe(true)
    const billboard = dl.find((d) => d.name === 'Billboard')!
    expect(billboard.phase_id).toBe(phases[0].id)
    expect(dl.find((d) => d.name === 'Social Advertisement')!.phase_id).toBe(phases[0].id)

    // The page (CG-01, 24 Sep — no rings): Manage phases beside the tabs, the filter narrowing the
    // grid, and the piece's phase in its Edit dialog (CG-E1, I57.11 — the row's select moved there).
    await expect(am.getByTestId('campaign-phases-manage')).toBeVisible()
    await expect(am.getByTestId('campaign-phase-filter').locator('option')).toContainText(['1. Pre-Launch'])
    await am.getByTestId('campaign-tab-grid').click()
    // ADR-0132 d.2: the grid's Edit opens the piece's panel, which holds the phase.
    await am.getByTestId(`campaign-deliverable-edit-${billboard.id}`).click()
    await expect(am.getByTestId('piece-panel-phase')).toHaveValue(phases[0].id)
    await am.getByTestId('piece-drawer-x').click()
    await expect(am.getByTestId('piece-panel')).toHaveCount(0)
    await am.getByTestId('campaign-phase-filter').selectOption(phases[1].id)
    await expect(am.getByTestId(`campaign-deliverable-${billboard.id}`)).toHaveCount(0)
    await expect(am.locator('[data-testid^="campaign-grid-status-"]')).toHaveCount(1)
    await am.getByTestId('campaign-phase-filter').selectOption('')
    await expect(am.locator('[data-testid^="campaign-grid-status-"]')).toHaveCount(3)
    await am.context().close()

    // I53.19 (21 Sep): ONE approval mail per owner, listing each piece with its PHASE and due
    // date (ADR-0096 d.11, kept in the list rather than the facts line). The owner here owns every row.
    const mail = await expectMail(PEOPLE.lead.email, /^Approved: .* — you own \d+ deliverables$/, { timeoutMs: 20_000 })
    const html = await readMailHtml(mail.ID)
    expect(html).toMatch(/You own \d+ deliverables on it:/)
    expect(html).toMatch(/• .* — Phase [12]: (Pre-Launch|Week 1), due /)
    expect((await searchMail(`to:${PEOPLE.lead.email}`)).filter((m) => m.Subject.startsWith('Approved:'))).toHaveLength(1)
  })

  test('may NOT: a lead sees no phase controls and the API refuses them in words; a team member likewise', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await lead.goto(`/campaigns/${campaignId}`)
    await lead.getByTestId('campaign-tab-grid').click()   // the filter sits on the Grid
    await expect(lead.getByTestId('campaign-phase-filter')).toBeVisible()   // the lead reads the phases
    await expect(lead.getByTestId('campaign-phases-manage')).toHaveCount(0)
    await lead.getByTestId('campaign-tab-brief').click()
    await expect(lead.getByTestId('campaign-master-brief')).toBeVisible()
    await expect(lead.getByTestId('campaign-brief-edit')).toHaveCount(0)
    await expect(lead.getByTestId('campaign-generate-deliverables')).toHaveCount(0)
    await lead.getByTestId('campaign-tab-grid').click()
    const [phase] = await rows<{ id: string }>('campaign_phases', `select=id&campaign_id=eq.${campaignId}&number=eq.1`)
    const [dl] = await rows<{ id: string }>('deliverables', `select=id,streams!inner(campaign_id)&streams.campaign_id=eq.${campaignId}`)
    // The panel (ADR-0132) offers the lead no phase move — the drawer READS the phase instead.
    await lead.getByTestId(`campaign-deliverable-edit-${dl.id}`).click()
    await expect(lead.getByTestId('piece-panel')).toBeVisible()
    await expect(lead.getByTestId('piece-panel-phase')).toHaveCount(0)
    await expect(lead.getByTestId('piece-drawer-sub')).toContainText(/Pre-Launch|Week 1/)
    await lead.getByTestId('piece-drawer-x').click()
    await lead.context().close()

    for (const tag of ['lead', 'maker'] as const) {
      const off = await rpcAs(tag, 'set_campaign_phases', { p_campaign: campaignId, p_enabled: false })
      expect(off.status, `${tag}: set_campaign_phases`).toBe(403)
      expect(off.body).toMatch(/outside your reach/)
      const add = await rpcAs(tag, 'save_campaign_phase', { p_campaign: campaignId, p_phase: null, p_name: 'Sneak', p_starts_on: dayOut(1), p_ends_on: dayOut(2) })
      expect(add.status, `${tag}: save_campaign_phase`).toBe(403)
      const move = await rpcAs(tag, 'move_deliverable_to_phase', { p_deliverable: dl.id, p_phase: phase.id })
      expect(move.status, `${tag}: move_deliverable_to_phase`).toBe(403)
      const brief = await rpcAs(tag, 'update_campaign_brief', { p_campaign: campaignId, p_brief: { proposition: 'Sneaky' } })
      expect(brief.status, `${tag}: update_campaign_brief`).toBe(403)
    }
    expect((await rows('campaign_phases', `select=id&campaign_id=eq.${campaignId}`)).length).toBe(2)
  })

  test('a promoted job grows: the brief is edited on its page, more deliverables are proposed and added, the original untouched; then phases on for an existing campaign', async ({ browser }) => {
    const am = await as(browser, 'am')
    const job = await releaseSingleJob(am, { title: `Grows ${Date.now()}`, department: 'Creative', type: 'Social Advertisement' })
    // Promote on the campaigns list (ADR-0086 addendum: it opens the campaign page).
    await am.goto('/campaigns')
    await am.getByTestId('campaigns-scope-all').click()
    await am.getByTestId(`campaign-menu-${job.campaignId}`).click()
    await am.getByTestId(`campaign-promote-${job.campaignId}`).click()
    await am.getByTestId('campaign-promote-confirm').click()
    await expect(am).toHaveURL(new RegExp(`/campaigns/${job.campaignId}`), { timeout: 15_000 })
    promotedId = job.campaignId
    const before = (await rows<{ id: string; name: string; state: string; deliverable_type_id: string }>('deliverables', `select=id,name,state,deliverable_type_id&id=eq.${job.deliverableId}`))[0]

    // Edit brief (I53.4): the account manager rewrites the proposition; the columns follow.
    await am.getByTestId('campaign-tab-brief').click()
    await am.getByTestId('campaign-brief-edit').click()
    await am.getByTestId('campaign-master-brief-field-proposition').fill('Never saved.')
    await am.getByTestId('campaign-master-brief-cancel').click()
    await expect(am.getByTestId('campaign-master-brief-details')).not.toContainText('Never saved.')
    await am.getByTestId('campaign-brief-edit').click()
    await am.getByTestId('campaign-master-brief-field-proposition').fill('A season, not a poster.')
    await am.getByTestId('campaign-master-brief-save').click()
    await closeBanner(am, /saved/i)
    await expect(am.getByTestId('campaign-master-brief')).toContainText('A season, not a poster.')
    expect((await rows<{ proposition: string }>('campaigns', `select=proposition&id=eq.${promotedId}`))[0].proposition).toBe('A season, not a poster.')

    // Propose more: the model is told what exists; one row duplicates it and is dropped; the
    // flagged row needs a choice; every row needs an owner and a date before Add.
    await am.route('**/functions/v1/generate-deliverables', async (route) => {
      const req = route.request().postDataJSON() as { brief: string }
      expect(req.brief).toContain('do not propose these again')
      await route.fulfill({ json: {
        deliverables: [
          { name: 'Social Advertisement', quantity: 1, typeCode: 'ADV-003', needsType: false, note: null, channel: null, phaseNumber: null },
          { name: 'Billboard', quantity: 2, typeCode: 'ADV-006', needsType: false, note: null, channel: null, phaseNumber: null },
        ],
        vocabulary: { types: 'offered', channels: 'offered' },
        needsType: 0,
      } })
    })
    // Every campaign piece is in a workstream (ADR-0116 d.3). A promoted job already has its own (I68.16, named for
    // its department); a second is made here (under the Grid), so the dialog asks which (I74.38) — Launch visuals.
    const [creative] = await rows<{ id: string }>('departments', 'select=id&name=eq.Creative')
    await am.getByTestId('campaign-tab-grid').click()
    await am.getByTestId('campaign-workstreams-add').click()
    await am.getByTestId('campaign-workstreams-name').fill('Launch visuals')
    await am.getByTestId('campaign-workstreams-department').selectOption(creative.id)
    await am.getByTestId('campaign-workstreams-save').click()
    await expect(am.locator('[data-testid^="campaign-workstreams-group-name-"]')).toHaveCount(1)
    await am.getByTestId('campaign-tab-brief').click()
    await am.getByTestId('campaign-generate-deliverables').click()
    await expect(am.getByTestId('campaign-generate-dialog')).toBeVisible()
    await am.getByTestId('campaign-generate-cancel').click()   // Cancel adds nothing
    await expect(am.getByTestId('campaign-generate-dialog')).toHaveCount(0)
    await am.getByTestId('campaign-generate-deliverables').click()
    await expect(am.getByTestId('campaign-generate-note')).toContainText(/1 proposed/)
    const genRows = am.locator('[data-testid^="campaign-generate-row-"]')
    await expect(genRows).toHaveCount(1)
    const gid = (await genRows.first().getAttribute('data-testid'))!.replace('campaign-generate-row-', '')
    // A row added by hand, edited, and removed again.
    await am.getByTestId('campaign-generate-add-row').click()
    await expect(genRows).toHaveCount(2)
    const hand = (await genRows.nth(1).getAttribute('data-testid'))!.replace('campaign-generate-row-', '')
    await am.getByTestId(`campaign-generate-name-${hand}`).fill('By hand')
    await am.getByTestId(`campaign-generate-qty-${hand}`).fill('3')
    await am.getByTestId(`campaign-generate-remove-${hand}`).click()
    await expect(genRows).toHaveCount(1)
    await am.getByTestId(`campaign-generate-qty-${gid}`).fill('2')
    await am.getByTestId('campaign-generate-workstream').selectOption({ label: 'Launch visuals' })
    await am.getByTestId('campaign-generate-submit').click()   // no owner, no date: refused in the dialog
    await expect(am.getByTestId('campaign-generate-error')).toBeVisible()
    await pickPerson(am, `campaign-generate-owner-${gid}`, PEOPLE.lead.name)
    await am.getByTestId(`campaign-generate-due-${gid}`).fill(dayOut(10))
    await am.getByTestId('campaign-generate-submit').click()
    await closeBanner(am, /1 deliverables added/i)
    const after = await rows<{ id: string; name: string; state: string; deliverable_type_id: string; quantity: number }>('deliverables', `select=id,name,state,deliverable_type_id,quantity,streams!inner(campaign_id)&streams.campaign_id=eq.${promotedId}&order=created_at`)
    expect(after).toHaveLength(2)
    // Found BY IDENTITY, not by position (I54.24). `order=created_at` looks deterministic and is
    // not: two rows written moments apart can carry the same stamp, and then the order is whatever
    // Postgres feels like. On 23 Sep this read the new deliverable as the original, reported "the
    // original was changed", and took the three tests after it down with it — they inherit
    // `promotedId` from here, so they each died on `campaign_id=eq.undefined`. One flake, four red
    // lines, and none of them about the product.
    const original = after.find((d) => d.id === before.id)
    expect(original, 'the original deliverable is still there').toBeTruthy()
    expect(original).toMatchObject({ name: before.name, state: before.state, deliverable_type_id: before.deliverable_type_id })
    const added = after.find((d) => d.id !== before.id)
    expect(added).toMatchObject({ name: 'Billboard', quantity: 2 })

    // Phases on for an existing campaign (ADR-0096 d.5): one phase holding everything.
    await am.getByTestId('campaign-phases-on').click()
    await closeBanner(am, /phases are on/i)
    await expect(am.getByTestId('campaign-phases-dialog')).toBeVisible()
    const [phase1] = await rows<{ id: string; number: number; name: string }>('campaign_phases', `select=id,number,name&campaign_id=eq.${promotedId}`)
    expect(phase1).toMatchObject({ number: 1, name: 'Phase 1' })
    await expect(am.getByTestId(`campaign-phase-count-${phase1.id}`)).toHaveText('2')
    // Rename it, add Week 1.
    await am.getByTestId(`campaign-phase-name-${phase1.id}`).fill('Pre-Launch')
    await am.getByTestId(`campaign-phase-start-${phase1.id}`).fill(dayOut(0))
    await am.getByTestId(`campaign-phase-end-${phase1.id}`).fill(dayOut(7))
    await am.getByTestId(`campaign-phase-save-${phase1.id}`).click()
    await expect.poll(async () => (await rows<{ name: string; ends_on: string }>('campaign_phases', `select=name,ends_on&id=eq.${phase1.id}`))[0]).toEqual({ name: 'Pre-Launch', ends_on: dayOut(7) })
    await am.getByTestId('campaign-phase-add-name').fill('Week 1')
    await am.getByTestId('campaign-phase-add-start').fill(dayOut(8))
    await am.getByTestId('campaign-phase-add-end').fill(dayOut(3))   // ends before it starts: refused in the dialog
    await am.getByTestId('campaign-phase-add').click()
    await expect(am.getByTestId('campaign-phases-error')).toBeVisible()
    // Ends three weeks out: Week 1's own planned day then falls well after Billboard's dayOut(10), so moving it in
    // always moves the date. (Ending at dayOut(14), the planned day landed ON dayOut(10) some weeks — no move, no line.)
    await am.getByTestId('campaign-phase-add-end').fill(dayOut(21))
    await am.getByTestId('campaign-phase-add').click()
    await expect(am.locator('[data-testid^="campaign-phase-row-"]')).toHaveCount(2)
    const [week1] = await rows<{ id: string }>('campaign_phases', `select=id&campaign_id=eq.${promotedId}&number=eq.2`)
    // Turning off is refused while it would strand nothing? Everything is in Pre-Launch, so it
    // would be allowed — first move Billboard into Week 1, then off is refused in words.
    await am.getByTestId('campaign-phases-done').click()
    await am.getByTestId('campaign-tab-grid').click()
    // ADR-0132 d.2: the phase is moved in the piece's panel.
    await am.getByTestId(`campaign-deliverable-edit-${after[1].id}`).click()
    await am.getByTestId('piece-panel-phase').selectOption(week1.id)
    // I57.36 / I68.11: the date moves with the phase — asked the moment the phase is picked, naming the phase and its
    // planned day. "Keep" keeps the old promise; the phase moves either way.
    await expect(am.getByTestId('piece-panel-phase-date')).toContainText('Week 1')
    const dueBefore = (await rows<{ due_at: string }>('deliverables', `select=due_at&id=eq.${after[1].id}`))[0].due_at
    await am.getByTestId('piece-panel-phase-date-keep').click()
    await expect(am.getByTestId('piece-panel-phase-date')).toHaveCount(0)
    await am.getByTestId('piece-panel-save').click()
    // One notice (I59.47): the move is saved, the date kept.
    await closeBanner(am, /Week 1/)
    await am.getByTestId('piece-drawer-close').click()
    await expect.poll(async () => (await rows<{ phase_id: string }>('deliverables', `select=phase_id&id=eq.${after[1].id}`))[0].phase_id).toBe(week1.id)
    expect((await rows<{ due_at: string }>('deliverables', `select=due_at&id=eq.${after[1].id}`))[0].due_at, 'cancel keeps the promise').toBe(dueBefore)
    await am.getByTestId('campaign-phases-manage').click()
    await am.getByTestId('campaign-phases-off').click()
    await closeBanner(am, /move the deliverables into one phase first/i)
    // Deleting a phase that holds work is refused with the count; empty it and it goes.
    await am.getByTestId(`campaign-phase-delete-${week1.id}`).click()
    await closeBanner(am, /holds 1 deliverable/i)
    await am.getByTestId('campaign-phases-done').click()
    await am.getByTestId(`campaign-deliverable-edit-${after[1].id}`).click()
    await am.getByTestId('piece-panel-phase').selectOption(phase1.id)
    // Back into Pre-Launch: its planned day (before dayOut(7)) is not the kept dayOut(10), so the
    // panel asks again; kept, the promise stays — and the one notice follows.
    await expect(am.getByTestId('piece-panel-phase-date')).toContainText('Pre-Launch')
    await am.getByTestId('piece-panel-phase-date-keep').click()
    await am.getByTestId('piece-panel-save').click()
    await closeBanner(am, /Pre-Launch/)
    await am.getByTestId('piece-drawer-close').click()
    await expect.poll(async () => (await rows<{ phase_id: string }>('deliverables', `select=phase_id&id=eq.${after[1].id}`))[0].phase_id).toBe(phase1.id)
    await am.getByTestId('campaign-phases-manage').click()
    await am.getByTestId(`campaign-phase-delete-${week1.id}`).click()
    await expect(am.locator('[data-testid^="campaign-phase-row-"]')).toHaveCount(1)
    // Off, now that everything sits in one phase: the rows keep no phase, and the filter goes back to
    // weeks (I63.8 — the campaign reads by week when it has no phases).
    await am.getByTestId('campaign-phases-off').click()
    await closeBanner(am, /phases are off/i)
    await expect(am.getByTestId('campaign-phase-filter').locator('option').first()).toHaveText('All weeks')
    await expect(am.getByTestId('campaign-phases-on')).toBeVisible()
    expect((await rows('campaign_phases', `select=id&campaign_id=eq.${promotedId}`)).length).toBe(0)
    await am.context().close()
  })

  test('Add deliverable needs a due date and takes the phase; the schedule and Pipeline filter by phase', async ({ browser }) => {
    // ADR-0128 (I66.9): an owner is one of the piece's own department's leads, the department its workstream's. The Poster is
    // Content's work (the next test needs a second department's list waiting), so the campaign gets a Content workstream
    // first — through save_workstream, the call the page's workstream panel makes.
    const [contentDept] = await rows<{ id: string }>('departments', 'select=id&name=eq.Content')
    const ws = await rpcAs('am', 'save_workstream', { p_campaign: campaignId, p_name: 'Words', p_department: contentDept.id, p_owner: null, p_workstream: null, p_code_letters: null })
    expect(ws.status, ws.body).toBeLessThan(300)
    const wordsId = JSON.parse(ws.body) as string
    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${campaignId}`)
    const phases = await rows<{ id: string; number: number; name: string }>('campaign_phases', `select=id,number,name&campaign_id=eq.${campaignId}&order=number`)
    await am.getByTestId('campaign-tab-grid').click()
    await am.getByTestId('campaign-add-deliverable').click()
    await expect(am.getByTestId('campaign-deliverable-form')).toBeVisible()
    await pickDeliverable(am, 'campaign-deliverable-form-type', 'Poster')
    await expect(am.getByTestId('campaign-deliverable-form-name')).not.toHaveValue('')   // named by the entry
    await am.getByTestId('campaign-deliverable-form-workstream').selectOption(wordsId)
    await pickPerson(am, 'campaign-deliverable-form-owner', PEOPLE.content.name)
    // No due date: refused in the dialog (ADR-0093 addendum d.7).
    await am.getByTestId('campaign-deliverable-form-submit').click()
    await expect(am.getByTestId('campaign-deliverable-form-error')).toContainText(/due date/i)
    await am.getByTestId('campaign-deliverable-form-phase').selectOption(phases[1].id)
    await am.getByTestId('campaign-deliverable-form-due').fill(dayOut(30))   // past Week 1's end: warned, allowed
    await expect(am.getByTestId('campaign-deliverable-form-phase-warning')).toContainText(/Week 1/)
    await am.getByTestId('campaign-deliverable-form-submit').click()
    await closeBanner(am, /added/i)
    const [added] = await rows<{ id: string; phase_id: string; due_at: string }>('deliverables', `select=id,phase_id,due_at,streams!inner(campaign_id)&streams.campaign_id=eq.${campaignId}&order=created_at.desc&limit=1`)
    expect(added.phase_id).toBe(phases[1].id)
    const [override] = await rows<{ payload: { boundary: string } }>('sla_events', `select=payload&deliverable_id=eq.${added.id}&event_type=eq.due_date_override`)
    expect(override.payload.boundary).toBe('phase_end')

    // Propose more on the PHASED campaign: the row carries a phase select, defaulting to the
    // suggested phase or the first; every row is added into the phase chosen.
    await am.route('**/functions/v1/generate-deliverables', async (route) => {
      await route.fulfill({ json: {
        deliverables: [{ name: 'Flyer', quantity: 1, typeCode: 'PRT-005', needsType: false, note: null, channel: null, phaseNumber: 1 }],
        vocabulary: { types: 'offered', channels: 'offered' },
        needsType: 0,
      } })
    })
    await am.goto(`/campaigns/${campaignId}`)
    await am.getByTestId('campaign-tab-brief').click()
    await am.getByTestId('campaign-generate-deliverables').click()
    // Two workstreams now (Words was added above): the batch's workstream is chosen — Creative's, the flyer's owner's.
    await am.getByTestId('campaign-generate-workstream').selectOption({ label: 'Launch visuals' })
    const prow = am.locator('[data-testid^="campaign-generate-row-"]').first()
    const pid = (await prow.getAttribute('data-testid'))!.replace('campaign-generate-row-', '')
    await expect(am.getByTestId(`campaign-generate-phase-${pid}`)).toHaveValue(phases[0].id)
    await am.getByTestId(`campaign-generate-phase-${pid}`).selectOption(phases[1].id)
    await pickPerson(am, `campaign-generate-owner-${pid}`, PEOPLE.lead.name)
    await am.getByTestId(`campaign-generate-due-${pid}`).fill(dayOut(12))
    await am.getByTestId('campaign-generate-submit').click()
    await closeBanner(am, /1 deliverables added/i)
    const [flyer] = await rows<{ phase_id: string }>('deliverables', `select=phase_id,streams!inner(campaign_id)&streams.campaign_id=eq.${campaignId}&order=created_at.desc&limit=1`)
    expect(flyer.phase_id).toBe(phases[1].id)

    // Pipeline: the phase filter appears for a phased campaign and narrows the board.
    await am.goto(`/pipeline?campaign=${campaignId}`)
    await expect(am.getByTestId('pipeline-phase')).toBeVisible()
    // The grid draws once the rows arrive — count after the first card, not before it.
    await expect(am.locator('[data-testid^="pipeline-card-"]').first()).toBeVisible()
    const cardsBefore = await am.locator('[data-testid^="pipeline-card-"]').count()
    await am.getByTestId('pipeline-phase').selectOption(phases[0].id)
    await expect.poll(() => am.locator('[data-testid^="pipeline-card-"]').count()).toBeLessThan(cardsBefore)
    // The schedule's Project view offers the phase filter, mirrored in the URL.
    await am.goto(`/schedule?view=project&campaign=${campaignId}`)
    await expect(am.getByTestId('filter-phase')).toBeVisible()
    await am.getByTestId('filter-phase').selectOption(phases[0].id)
    await expect(am).toHaveURL(new RegExp(`phase=${phases[0].id}`))
    await am.context().close()
  })

  /**
   * ADR-0072 d.6, ADR-0090 d.3a — Edward, 20 Sep: *"you are making deliverables available for
   * assignment on the schedule when the tasks have not been approved."* The campaign is approved,
   * its departments have written no brief: the schedule's picker offers NONE of its deliverables
   * (absence, not a disabled entry), the API refuses an assignment in words, and only once the
   * Creative lead has generated and approved Creative's brief are Creative's pieces offered —
   * Production's, still unbriefed, are not.
   */
  test("a deliverable's work is offered for assignment only once its OWNER accepts the task list; the API refuses it before", async ({ browser }) => {
    const [creative] = await rows<{ id: string }>('departments', 'select=id&name=eq.Creative')
    const [social] = await rows<{ id: string }>('deliverables', `select=id,streams!inner(campaign_id)&streams.campaign_id=eq.${campaignId}&name=eq.Social%20Advertisement`)
    const [task] = await rows<{ id: string }>('sub_tasks', `select=id&deliverable_id=eq.${social.id}&assignee_id=is.null&order=sort_order&limit=1`)
    const [makerRes] = await rows<{ id: string }>('resources', `select=id&name=eq.${encodeURIComponent(PEOPLE.maker.name)}&is_active=eq.true`)
    const [makerUser] = await rows<{ id: string }>('user_profiles', `select=id&display_name=eq.${encodeURIComponent(PEOPLE.maker.name)}`)
    const day = dayOut(21)

    // The picker, as Traffic — every grant to assign, so what holds them is the gate.
    const traffic = await as(browser, 'traffic')
    await traffic.goto(`/schedule?on=${day}`)
    await expect(traffic.getByTestId('schedule-grid')).toBeVisible()
    await traffic.getByTestId(`cell-${makerRes.id}-${day}`).hover()
    await traffic.getByTestId(`add-${makerRes.id}-${day}`).click()
    const mode = traffic.getByTestId('mode-project')
    if (await mode.count()) await mode.check()
    await traffic.getByTestId('booking-project').selectOption({ label: name })
    const picker = traffic.getByTestId('booking-deliverable-select')
    await expect(picker).toBeVisible()
    await expect.poll(() => picker.locator('option').count()).toBe(1)
    await traffic.getByTestId('booking-cancel').click()

    // The API door: the gate itself, in ADR-0100 d.2's words. It used to name the DEPARTMENT's
    // brief; it now names the deliverable's task list and the person who owes it.
    // With its hours (E11, I59): an assignment without them is refused for THAT reason, and this
    // call is about the task-list gate — so it is refused for the gate alone.
    const refused = await rpcAs('traffic', 'update_task_assignment', { p_sub_task: task.id, p_title: 'Held', p_assignee: makerUser.id, p_hours: 2 })
    expect(refused.status, refused.body).toBe(403)
    expect(refused.body).toContain('task list')
    expect(refused.body).toContain('has not been approved')

    // Creative's lead accepts Creative's task lists on the Grid — the second gate (ADR-0100 d.2/d.9;
    // the department tabs went 24 Sep, CG-01). One panel, all or selected; a lead may accept for
    // their department (ADR-0090 d.4), which is what keeps this a single sitting. "All" is theirs:
    // the other department's lists stay Pending on the same sheet — partial is a real state.
    const lead = await as(browser, 'lead')
    await lead.goto(`/campaigns/${campaignId}`)
    await lead.getByTestId('campaign-tab-grid').click()
    const withLists = (await rows<{ id: string; department_id: string | null; tasks_approved_at: string | null; sub_tasks: { status: string }[] }>(
      'deliverables', `select=id,department_id,tasks_approved_at,sub_tasks(status),streams!inner(campaign_id)&streams.campaign_id=eq.${campaignId}&state=neq.archived`,
    )).filter((x) => x.sub_tasks.length > 0)
    expect(withLists.some((d) => d.department_id !== creative.id && d.tasks_approved_at == null), 'another department has a list waiting').toBe(true)
    await lead.getByTestId('campaign-task-lists-approve-all').click()
    for (const d of withLists) {
      const expected = d.department_id === creative.id || d.tasks_approved_at != null ? 'Yes' : 'Pending'
      await expect(lead.getByTestId(`campaign-grid-approved-${d.id}`)).toContainText(expected, { timeout: 20_000 })
    }
    await lead.context().close()

    // Now Creative's pieces are offered, and only Creative's.
    await traffic.goto(`/schedule?on=${day}`)
    await traffic.getByTestId(`cell-${makerRes.id}-${day}`).hover()
    await traffic.getByTestId(`add-${makerRes.id}-${day}`).click()
    if (await mode.count()) await mode.check()
    await traffic.getByTestId('booking-project').selectOption({ label: name })
    await expect.poll(() => picker.locator('option').allTextContents()).toContain('Social Advertisement')
    // By id — the fixture holds two "Poster"s, Creative's and Content's, and only Creative's may be here.
    const offered = await picker.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))
    const all = await rows<{ id: string; name: string; department_id: string | null }>('deliverables', `select=id,name,department_id,streams!inner(campaign_id)&streams.campaign_id=eq.${campaignId}`)
    expect(all.some((d) => d.department_id !== creative.id), 'the fixture has another department to leave out').toBe(true)
    // Only Creative's task lists were accepted, so only Creative's work is offered — the gate is
    // per deliverable now, and this is what partial acceptance looks like from the scheduler's end.
    for (const d of all) {
      expect(offered.includes(d.id), `${d.name} (${d.department_id === creative.id ? 'Creative, accepted' : 'another department, not accepted'})`).toBe(d.department_id === creative.id)
    }
    await traffic.getByTestId('booking-cancel').click()
    await traffic.context().close()
  })

  test('a rename leaves the task titles — they name the campaign, not the deliverable (ADR-0071 addendum, 4 Oct); the promise stamps at 18:00 Iraq on the last booked day (ADR-0075 addendum)', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    // The typed Social Advertisement on the phased campaign has a materialised task list.
    const [d] = await rows<{ id: string; name: string }>('deliverables', `select=id,name,streams!inner(campaign_id)&streams.campaign_id=eq.${campaignId}&name=eq.Social%20Advertisement`)
    // I57.15: two "Create Artwork" units share a sort_order, so the order breaks the tie by unit and
    // then by id — the same order both reads, or the comparison flips at random.
    const TASK_ORDER = 'order=sort_order,unit_index.nullsfirst,id'
    const titlesBefore = (await rows<{ id: string; title: string }>('sub_tasks', `select=id,title&deliverable_id=eq.${d.id}&${TASK_ORDER}`)).map((t) => t.title)
    expect(titlesBefore.length).toBeGreaterThan(0)
    // ADR-0071 addendum (4 Oct): "<step> — <campaign>[ · <type> <n>]" — every title names the campaign.
    expect(titlesBefore.every((t) => t.includes(' — '))).toBe(true)
    // ADR-0132: renamed in the piece's panel — by the account manager, who alone changes a live piece (ADR-0141 d.1).
    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${campaignId}`)
    await am.getByTestId('campaign-tab-grid').click()
    await am.getByTestId(`campaign-deliverable-edit-${d.id}`).click()
    await am.getByTestId('piece-panel-name').fill('Launch statics')
    await am.getByTestId('piece-panel-save').click()
    await closeBanner(am, /saved/i)
    await am.context().close()
    await lead.goto(`/campaigns/${campaignId}`)
    await lead.getByTestId('campaign-tab-grid').click()
    await lead.getByTestId(`campaign-deliverable-edit-${d.id}`).click()
    await expect.poll(async () => (await rows<{ name: string }>('deliverables', `select=name&id=eq.${d.id}`))[0]?.name).toBe('Launch statics')
    expect((await rows<{ title: string }>('sub_tasks', `select=title&deliverable_id=eq.${d.id}&${TASK_ORDER}`)).map((t) => t.title))
      .toEqual(titlesBefore)

    // Assign a task with a booked day: the commitment lands at 18:00 Iraq that day, never the hour
    // the placed booking ends (ADR-0075 addendum d.3a) — and My Work prints a day (d.3b).
    // ADR-0132 d.2: a task is added in the panel by name and due date, unassigned; it is given to somebody the way the
    // Schedule gives it — update_task_assignment, with its hours (E11) and a reviewer.
    // I74 (the one task list): + Add, the name, Add — the due date comes with the booking below.
    await lead.getByTestId('piece-panel-tasks-add').click()
    await lead.getByTestId('piece-panel-tasks-add-name').fill('Phase stamp check')
    await lead.getByTestId('piece-panel-tasks-add-save').click()
    await expect.poll(async () => (await rows('sub_tasks', `select=id&deliverable_id=eq.${d.id}&title=eq.Phase%20stamp%20check`)).length).toBe(1)
    const [added] = await rows<{ id: string }>('sub_tasks', `select=id&deliverable_id=eq.${d.id}&title=eq.Phase%20stamp%20check`)
    const [makerUser] = await rows<{ id: string }>('user_profiles', `select=id&display_name=eq.${encodeURIComponent(PEOPLE.maker.name)}`)
    const [tlUser] = await rows<{ id: string }>('user_profiles', `select=id&display_name=eq.${encodeURIComponent(PEOPLE.tl.name)}`)
    const given = await rpcAs('lead', 'update_task_assignment', {
      p_sub_task: added.id, p_title: 'Phase stamp check', p_assignee: makerUser.id, p_hours: 4,
      p_reviewers: [{ user_id: tlUser.id, is_mandatory: true }],
      p_starts_at: `${dayOut(14)}T06:00:00Z`, p_due_at: `${dayOut(15)}T14:00:00Z`,
    })
    expect(given.status, given.body).toBeLessThan(300)
    const [task] = await rows<{ id: string; committed_due_at: string | null; due_at: string | null }>('sub_tasks', `select=id,committed_due_at,due_at&deliverable_id=eq.${d.id}&title=eq.Phase%20stamp%20check`)
    if (task.committed_due_at) {
      // 18:00 Asia/Baghdad is 15:00Z; the day is the plan's day.
      expect(task.committed_due_at).toMatch(/T15:00:00/)
      expect(task.committed_due_at.slice(0, 10)).toBe(task.due_at!.slice(0, 10))
    }
    await lead.context().close()
  })

  test('may NOT: a team member is offered neither Edit brief nor Propose more on the promoted campaign, and the wizard shows them no phases switch', async ({ browser }) => {
    const maker = await as(browser, 'maker')
    await maker.goto(`/campaigns/${promotedId}`)
    await maker.getByTestId('campaign-tab-brief').click()
    await expect(maker.getByTestId('campaign-master-brief')).toBeVisible()
    await expect(maker.getByTestId('campaign-brief-edit')).toHaveCount(0)
    await expect(maker.getByTestId('campaign-generate-deliverables')).toHaveCount(0)
    await expect(maker.getByTestId('campaign-phases-on')).toHaveCount(0)
    await maker.goto('/campaigns/new')
    await expect(maker.getByTestId('wizard-phases')).toHaveCount(0)   // no phases card (the switch went, ADR-0116)
    await maker.context().close()
  })
})
