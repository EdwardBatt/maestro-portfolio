import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows } from '../helpers/db'
import { mockProposal, chooseLanguages, pieceIds } from '../helpers/campaign-wizard'

/**
 * Coverage — the wizard's dialogs, control by control (`I56.19`, `I57.14`, `I57.27`).
 *
 * `check:e2e-coverage` found eight controls on the campaign wizard that no browser test pressed:
 * the phase dialog's Remove, the rule dialog's languages, the move dialog's "Out of any workstream",
 * the new-workstream dialog's departments, the piece dialog's languages and "Add another", the
 * proposal's "Drop all", and the workstream drawer's Rename. Each is pressed here and its effect
 * asserted — on the screen, and on the saved draft where the wizard saves one. The gate matches by
 * shape (`*-remove` is any dialog's Remove), so every press is aimed at the RIGHT dialog's control.
 *
 * One campaign, walked from step 1 to step 4 as `am`, one page shared across the tests: the
 * wizard's state lives in the page, and a fresh page per test would be a fresh wizard. Only the
 * model call is mocked (`generate-deliverables`).
 *
 * Known gap, not this suite's to fix: a campaign rule's languages are collected by the dialog and
 * then dropped — rules are not saved with the draft at all (`I56.6`, open). So the rule test proves
 * what the dialog does with its languages, and no more.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}
function dayOut(days: number): string {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const STAMP = Date.now()
const NAME = `Dialogs ${STAMP}`
const GROUP = `Social ${STAMP}`
const RENAMED = `Social and reels ${STAMP}`
const ADDED = `Story frame ${STAMP}`

type DraftBrief = {
  deliverables: { name: string; workstreamId: string | null; language: string | null }[]
  workstreams: { id: string; name: string; departmentId: string }[]
}

let am: Page
let contentId: string
let groupId: string
let outdoorId: string

test.describe.configure({ mode: 'serial' })

test.describe('The campaign wizard’s dialogs, every control (I56.19)', () => {
  test.beforeAll(async ({ browser }) => {
    ;[{ id: contentId }] = await rows<{ id: string }>('departments', 'select=id&name=eq.Content')
    am = await as(browser, 'am')
    // Two proposed pieces in one proposed group, one proposed loose — which joins the only workstream, since
    // every campaign piece is in one (ADR-0116 d.3).
    await mockProposal(
      am,
      [
        { name: `Post ${STAMP}`, typeCode: 'ADV-003', channel: 'Instagram', group: 0 },
        { name: `Reel ${STAMP}`, typeCode: 'ADV-003', channel: 'Instagram', group: 0 },
        { name: `Billboard ${STAMP}`, typeCode: 'ADV-006', channel: 'OOH' },
      ],
      [{ name: GROUP, departmentId: contentId }],
    )
  })

  test.afterAll(async () => {
    await am?.context().close()
  })

  test('step 1: a phase is removed through its own dialog, the last one too (ADR-0116)', async () => {
    await am.goto('/campaigns/new')
    await expect(am.getByTestId('wizard-step-1')).toBeVisible()
    await am.getByTestId('wizard-client').selectOption({ label: 'Northwind Beverages' })
    await am.getByTestId('wizard-brand').selectOption({ label: 'Northwind' })
    await am.getByTestId('wizard-name').fill(NAME)
    for (const [name, from, to] of [['Teaser', 0, 6], ['Launch', 7, 13], ['Wrap', 14, 20]] as const) {
      await am.getByTestId('wizard-phases-add').click()
      await am.getByTestId('wizard-phase-dialog-name').fill(name)
      await am.getByTestId('wizard-phase-dialog-starts').fill(dayOut(from))
      await am.getByTestId('wizard-phase-dialog-date').fill(dayOut(to))
      await am.getByTestId('wizard-phase-dialog-submit').click()
    }
    const phaseRows = am.locator('[data-testid^="wizard-phases-row-"]')
    await expect(phaseRows).toHaveCount(3)

    // Remove the LAST phase — its edit dialog offers Remove because two others stay.
    const last = (await phaseRows.nth(2).getAttribute('data-testid'))!.replace('wizard-phases-row-', '')
    await am.getByTestId(`wizard-phases-edit-${last}`).click()
    await am.getByTestId('wizard-phase-dialog-remove').click()
    await expect(am.getByTestId('wizard-phase-dialog-name')).toHaveCount(0)
    await expect(phaseRows).toHaveCount(2)
    await expect(am.getByTestId(`wizard-phases-row-${last}`)).toHaveCount(0)
    await expect(am.getByTestId('wizard-phases')).not.toContainText('Wrap')

    // And the middle one, which leaves one; then that one too — the last phase can go (ADR-0116 d.1: a
    // campaign uses phases while it has one, and simply has none after).
    const second = (await phaseRows.nth(1).getAttribute('data-testid'))!.replace('wizard-phases-row-', '')
    await am.getByTestId(`wizard-phases-edit-${second}`).click()
    await am.getByTestId('wizard-phase-dialog-remove').click()
    await expect(phaseRows).toHaveCount(1)
    const only = (await phaseRows.first().getAttribute('data-testid'))!.replace('wizard-phases-row-', '')
    await am.getByTestId(`wizard-phases-edit-${only}`).click()
    await expect(am.getByTestId('wizard-phase-dialog-name')).toHaveValue('Teaser')
    await am.getByTestId('wizard-phase-dialog-remove').click()
    await expect(am.getByTestId('wizard-phase-dialog-name')).toHaveCount(0)
    await expect(phaseRows).toHaveCount(0)

    await am.getByTestId('wizard-next').click()
    await expect(am.getByTestId('wizard-step-2')).toBeVisible()
  })

  test('step 2: a rule’s languages start all on, turn off one by one, and never all', async () => {
    await am.getByTestId('wizard-brief-proposition').fill('Cold before you get there.')
    await chooseLanguages(am, 'wizard-languages-picker', ['en', 'ar'])
    await am.getByTestId('wizard-brief-add-rule').click()
    await expect(am.getByTestId('wizard-brief-rule-dialog')).toBeVisible()
    await am.getByTestId('wizard-brief-rule-dialog-text').fill('Never show the can warm.')

    // The campaign's languages, read from the catalogue the dialog is given — never assumed.
    const codes = await am.locator('[data-testid^="wizard-brief-rule-dialog-locale-"]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-testid')!.replace('wizard-brief-rule-dialog-locale-', '')).filter((c) => c !== 's'),
    )
    expect(codes.length, 'at least two languages to choose between').toBeGreaterThanOrEqual(2)
    const submit = am.getByTestId('wizard-brief-rule-dialog-submit')
    for (const c of codes) await expect(am.getByTestId(`wizard-brief-rule-dialog-locale-${c}`)).toHaveAttribute('aria-pressed', 'true')

    // Off one by one: the rule is addable while any language is left ...
    for (const [i, c] of codes.entries()) {
      await am.getByTestId(`wizard-brief-rule-dialog-locale-${c}`).click()
      await expect(am.getByTestId(`wizard-brief-rule-dialog-locale-${c}`)).toHaveAttribute('aria-pressed', 'false')
      if (i < codes.length - 1) await expect(submit).toBeEnabled()
    }
    // ... and all off is a rule that holds nowhere — the form will not take it.
    await expect(submit).toBeDisabled()
    await am.getByTestId(`wizard-brief-rule-dialog-locale-${codes[0]}`).click()
    await expect(am.getByTestId(`wizard-brief-rule-dialog-locale-${codes[0]}`)).toHaveAttribute('aria-pressed', 'true')
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(am.getByTestId('wizard-brief-rule-dialog')).toHaveCount(0)
    await expect(am.getByTestId('wizard-brief')).toContainText('Never show the can warm.')

    await am.getByTestId('wizard-next').click()
    await expect(am.getByTestId('wizard-step-3')).toBeVisible()
    await expect(am.getByTestId('wizard-busy-propose')).toHaveCount(0, { timeout: 15_000 })
  })

  test('step 3: "Drop all" unticks the group’s proposed pieces; the loose one joined the group (ADR-0116)', async () => {
    const groupName = am.locator('[data-testid^="wizard-work-group-name-"]')
    await expect(groupName).toHaveCount(1)
    await expect(groupName).toHaveValue(GROUP)
    groupId = (await groupName.getAttribute('data-testid'))!.replace('wizard-work-group-name-', '')

    const inGroup = am.getByTestId(`wizard-work-group-${groupId}`).locator('input[type="checkbox"][data-testid^="wizard-work-keep-"]')
    await expect(inGroup).toHaveCount(3)
    await expect(am.getByTestId('wizard-work-group-__ungrouped__')).toHaveCount(0)

    await am.getByTestId(`wizard-work-drop-all-${groupId}`).click()
    for (const box of await inGroup.all()) await expect(box).not.toBeChecked()

    // Kept again, because the rest of the walk needs them.
    await am.getByTestId(`wizard-work-keep-all-${groupId}`).click()
    for (const box of await inGroup.all()) await expect(box).toBeChecked()
  })

  test('step 3: a new workstream takes the department pressed, one at a time', async () => {
    const [production] = await rows<{ id: string }>('departments', 'select=id&name=eq.Production')
    await am.getByTestId('wizard-work-new-group').click()
    await expect(am.getByTestId('wizard-new-workstream-dialog')).toBeVisible()
    await am.getByTestId('wizard-new-workstream-name').fill(`Outdoor ${STAMP}`)
    const create = am.getByTestId('wizard-new-workstream-create')
    await expect(create, 'a name alone is not enough').toBeDisabled()

    await am.getByTestId(`wizard-new-workstream-dept-${contentId}`).click()
    await expect(am.getByTestId(`wizard-new-workstream-dept-${contentId}`)).toHaveAttribute('aria-pressed', 'true')
    await am.getByTestId(`wizard-new-workstream-dept-${production.id}`).click()
    await expect(am.getByTestId(`wizard-new-workstream-dept-${production.id}`)).toHaveAttribute('aria-pressed', 'true')
    await expect(am.getByTestId(`wizard-new-workstream-dept-${contentId}`)).toHaveAttribute('aria-pressed', 'false')
    await create.click()

    const outdoor = am.locator('[data-testid^="wizard-work-group-name-"]')
    await expect(outdoor).toHaveCount(2)
    outdoorId = (await outdoor.nth(1).getAttribute('data-testid'))!.replace('wizard-work-group-name-', '')
    await expect(outdoor.nth(1)).toHaveValue(`Outdoor ${STAMP}`)
    await expect(am.getByTestId(`wizard-work-dept-${outdoorId}`)).toHaveValue(production.id)
  })

  test('step 3: Move takes a piece to another workstream — never out of all of them (ADR-0116 d.3)', async () => {
    const reel = am.getByTestId(`wizard-work-group-${groupId}`).locator('[data-testid^="wizard-work-piece-"]').filter({ hasText: `Reel ${STAMP}` })
    const reelId = (await reel.getAttribute('data-testid'))!.replace('wizard-work-piece-', '')
    await am.getByTestId(`wizard-work-move-${reelId}`).click()
    await expect(am.getByTestId('wizard-move-workstream-dialog')).toBeVisible()
    await expect(am.getByTestId('wizard-move-workstream-option-none')).toHaveCount(0)
    const outdoor = am.getByTestId(`wizard-move-workstream-option-${outdoorId}`)
    await outdoor.click()
    await expect(outdoor).toHaveAttribute('aria-checked', 'true')
    await am.getByTestId('wizard-move-workstream-submit').click()
    await expect(am.getByTestId('wizard-move-workstream-dialog')).toHaveCount(0)

    await expect(am.getByTestId(`wizard-work-group-${outdoorId}`).getByTestId(`wizard-work-piece-${reelId}`)).toBeVisible()
    await expect(am.getByTestId(`wizard-work-group-${groupId}`).getByTestId(`wizard-work-piece-${reelId}`)).toHaveCount(0)
  })

  test('step 3: a piece in two languages is two pieces, and "Add another" keeps the dialog open', async () => {
    const before = await am.getByTestId(`wizard-work-group-${groupId}`).locator('[data-testid^="wizard-work-piece-"]').count()
    await am.getByTestId(`wizard-work-add-piece-${groupId}`).click()
    await expect(am.getByTestId('wizard-piece-dialog')).toBeVisible()
    await expect(am.getByTestId('wizard-piece-workstream')).toHaveValue(GROUP)
    await am.getByTestId('wizard-piece-name').fill(ADDED)
    await am.getByTestId('wizard-piece-type').selectOption({ index: 1 })
    await am.getByTestId('wizard-piece-owner').selectOption({ label: PEOPLE.content.name })
    await expect(am.getByTestId('wizard-piece-add-another')).toBeEnabled()

    const langs = await am.locator('[data-testid^="wizard-piece-lang-"]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-testid')!.replace('wizard-piece-lang-', '')),
    )
    expect(langs.length, 'the seed offers at least two languages').toBeGreaterThanOrEqual(2)
    const [l1, l2] = langs as [string, string]
    await am.getByTestId(`wizard-piece-lang-${l1}`).click()
    await am.getByTestId(`wizard-piece-lang-${l2}`).click()
    await expect(am.getByTestId(`wizard-piece-lang-${l1}`)).toHaveAttribute('aria-pressed', 'true')
    await expect(am.getByTestId(`wizard-piece-lang-${l2}`)).toHaveAttribute('aria-pressed', 'true')

    await am.getByTestId('wizard-piece-add-another').click()
    // Saved, and the dialog is open again on an empty piece in the same workstream.
    await expect(am.getByTestId('wizard-piece-dialog')).toBeVisible()
    await expect(am.getByTestId('wizard-piece-name')).toHaveValue('')
    await expect(am.getByTestId('wizard-piece-workstream')).toHaveValue(GROUP)
    await am.getByTestId('wizard-piece-cancel').click()

    const inGroup = am.getByTestId(`wizard-work-group-${groupId}`).locator('[data-testid^="wizard-work-piece-"]')
    await expect(inGroup).toHaveCount(before + 2)
    await expect(inGroup.filter({ hasText: ADDED })).toHaveCount(2)
  })

  test('step 3: the drawer’s Rename changes the name and nothing else (I57.27)', async () => {
    await am.getByTestId(`wizard-work-open-${groupId}`).click()
    await expect(am.getByTestId('wizard-workstream-drawer')).toBeVisible()
    await am.getByTestId('wizard-workstream-drawer-rename').click()

    await expect(am.getByTestId('wizard-workstream-drawer')).toHaveCount(0)
    await expect(am.getByTestId('wizard-rename-workstream-dialog')).toBeVisible()
    await expect(am.getByTestId('wizard-rename-workstream-name')).toHaveValue(GROUP)
    // The name only: no department is asked.
    await expect(am.locator('[data-testid^="wizard-rename-workstream-dept-"]')).toHaveCount(0)
    const save = am.getByTestId('wizard-rename-workstream-create')
    await expect(save, 'the unchanged name is not a rename').toBeDisabled()
    await am.getByTestId('wizard-rename-workstream-name').fill(`outdoor ${STAMP}`)
    await expect(am.getByTestId('wizard-rename-workstream-clash')).toBeVisible()
    await expect(save).toBeDisabled()
    await am.getByTestId('wizard-rename-workstream-name').fill(RENAMED)
    await save.click()

    await expect(am.getByTestId('wizard-rename-workstream-dialog')).toHaveCount(0)
    await expect(am.getByTestId(`wizard-work-group-name-${groupId}`)).toHaveValue(RENAMED)
    await expect(am.getByTestId(`wizard-work-dept-${groupId}`)).toHaveValue(contentId)
  })

  test('the draft keeps it all: the rename, the two languages, the piece moved to Outdoor', async () => {
    // An owner is one of the piece's own department's leads (I66.9, I74.38): the Content workstream's from Content, Outdoor's
    // from Production — each piece and each workstream by the department it sits in.
    const leadOf: Record<string, string> = { [RENAMED]: PEOPLE.copytl.name, [`Outdoor ${STAMP}`]: PEOPLE.studiotl.name }
    for (const id of await pieceIds(am)) {
      await am.getByTestId(`wizard-work-edit-${id}`).click()
      const ws = await am.getByTestId('wizard-piece-workstream').inputValue()
      expect(leadOf[ws], `a lead for the workstream "${ws}"`).toBeTruthy()
      await am.getByTestId('wizard-piece-owner').selectOption({ label: leadOf[ws]! })
      await am.getByTestId('wizard-piece-save').click()
      await expect(am.getByTestId('wizard-piece-save')).toHaveCount(0)
    }
    for (const sel of await am.locator('select[data-testid^="wizard-work-owner-"]').all()) {
      const gid = (await sel.getAttribute('data-testid'))!.replace('wizard-work-owner-', '')
      const lead = leadOf[await am.getByTestId(`wizard-work-group-name-${gid}`).inputValue()]!
      // An option reads "name · role" (ProposalStep), so the owner is found by name.
      await sel.selectOption((await sel.locator('option').filter({ hasText: lead }).first().getAttribute('value'))!)
    }
    await am.getByTestId('wizard-next').click()
    await expect(am.getByTestId('wizard-step-4')).toBeVisible()
    const [c] = await rows<{ brief: DraftBrief }>('campaigns', `select=brief&name=eq.${encodeURIComponent(NAME)}`)
    expect(c, 'the draft is saved').toBeTruthy()
    const ws = c.brief.workstreams.find((w) => w.name === RENAMED)
    expect(ws, 'the renamed workstream').toBeTruthy()
    expect(ws!.departmentId).toBe(contentId)
    expect(c.brief.workstreams.some((w) => w.name === GROUP)).toBe(false)

    const added = c.brief.deliverables.filter((d) => d.name === ADDED)
    expect(added).toHaveLength(2)
    expect(new Set(added.map((d) => d.language)).size, 'one language each').toBe(2)
    for (const d of added) expect(d.workstreamId).toBe(ws!.id)
    const outdoor = c.brief.workstreams.find((w) => w.name === `Outdoor ${STAMP}`)
    expect(outdoor, 'the Outdoor workstream').toBeTruthy()
    expect(c.brief.deliverables.find((d) => d.name === `Reel ${STAMP}`)!.workstreamId).toBe(outdoor!.id)
  })
})
