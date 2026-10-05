import { expect, type Page } from '@playwright/test'

/**
 * The campaign wizard as it is since CB-v3 (I56.18–I56.23, 24 Sep), driven the way a person drives
 * it. Every spec that needs a campaign made through the wizard goes through here, so the next
 * change to a step is one file to follow — the old specs each carried their own copy of the flow
 * and all of them broke together when step 2 became the brief and phases moved onto step 1.
 *
 *   1  The campaign — client, brand, name, account manager; the phases and workstreams switches.
 *   2  The brief — the proposition is the one field a brief cannot proceed without.
 *   3  The work — the model's proposal (mocked at the network edge), an owner on every piece.
 *   4  Timing — every date is given through a row's Edit; a date chooses the phase.
 *   5  Review — "Approve and start the work".
 *
 * Only the model call is mocked. The draft, the submit, the approval and the notifications are the
 * real app on the real database.
 */

export interface ProposedPiece {
  name: string
  typeCode: string
  quantity?: number
  channel?: string | null
  phaseNumber?: number | null
  /** Index into `groups`. Omitted: the first group — the model always places a piece (ADR-0116 d.3).
   *  `null` keeps it out of every group, to test the work step's refusal. */
  group?: number | null
}

/** Mock `generate-deliverables` with the shape it answers in since ADR-0101: rows, and groups. */
export function mockProposal(page: Page, pieces: ProposedPiece[], given: { name: string; departmentId: string | null }[] = []) {
  // With no groups given, one — the department left for the person to choose, as ownTheWork does.
  const groups = given.length > 0 ? given : [{ name: 'Main work', departmentId: null }]
  return page.route('**/functions/v1/generate-deliverables', async (route) => {
    await new Promise((r) => setTimeout(r, 200))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        deliverables: pieces.map((p) => ({
          name: p.name,
          quantity: p.quantity ?? 1,
          typeCode: p.typeCode,
          needsType: false,
          note: null,
          channel: p.channel ?? null,
          phaseNumber: p.phaseNumber ?? null,
          from: null,
          group: p.group === undefined ? 0 : p.group,
        })),
        groups,
        vocabulary: { types: 'offered', channels: 'offered' },
      }),
    })
  })
}

/** Pick a person in a PersonPicker (typed search; selection commits on mousedown). */
export async function pickPerson(page: Page, testId: string, name: string) {
  await page.getByTestId(testId).fill(name)
  await page.getByTestId(`${testId}-list`).getByRole('option', { name: new RegExp(`(^|\\s)${name}(?!\\s*\\d)`) }).first().dispatchEvent('mousedown')
}

export interface CampaignStart {
  name: string
  client?: string
  brand?: string | null
  /** The account manager, when not the client's own. They approve on step 5 (ADR-0083 d.14). */
  accountManager?: string
  /** Phases on step 1, each a name and a start and end date. Omitted: the campaign has none. */
  phases?: { name: string; startsOn: string; endsOn: string }[]
}

/** Step 1, then Next. Leaves the wizard on step 2. */
export async function startCampaign(page: Page, c: CampaignStart) {
  await page.goto('/campaigns/new')
  await expect(page.getByTestId('wizard-step-1')).toBeVisible()
  await page.getByTestId('wizard-client').selectOption({ label: c.client ?? 'Northwind Beverages' })
  if (c.brand !== null) await page.getByTestId('wizard-brand').selectOption({ label: c.brand ?? 'Northwind' })
  await page.getByTestId('wizard-name').fill(c.name)
  if (c.accountManager) await pickPerson(page, 'wizard-account-manager', c.accountManager)
  // ADR-0116 d.1: no switch — adding a phase is what makes the campaign use them.
  if (c.phases?.length) {
    for (const ph of c.phases) {
      await page.getByTestId('wizard-phases-add').click()
      await page.getByTestId('wizard-phase-dialog-name').fill(ph.name)
      await page.getByTestId('wizard-phase-dialog-starts').fill(ph.startsOn)
      await page.getByTestId('wizard-phase-dialog-date').fill(ph.endsOn)
      await page.getByTestId('wizard-phase-dialog-submit').click()
    }
  }
  await page.getByTestId('wizard-next').click()
  await expect(page.getByTestId('wizard-step-2')).toBeVisible()
}

/**
 * Pick languages in a LanguagePicker (`testId` is the picker's): type, then choose the option. ADR-0117 addendum
 * (Q19, 4 Oct): a campaign or job has at least one, picked — there is no default.
 */
export async function chooseLanguages(page: Page, testId: string, codes: readonly string[]) {
  for (const code of codes) {
    if (await page.getByTestId(`${testId}-chip-${code}`).count()) continue
    await page.getByTestId(`${testId}-input`).click()
    await page.getByTestId(`${testId}-option-${code}`).dispatchEvent('mousedown')
    await expect(page.getByTestId(`${testId}-chip-${code}`)).toBeVisible()
  }
}

/** Step 2: the proposition and the languages, then Next — which asks for the proposal. Leaves the wizard on step 3. */
export async function writeBrief(page: Page, proposition = 'Cold before you get there.', languages: readonly string[] = ['en']) {
  await page.getByTestId('wizard-brief-proposition').fill(proposition)
  await chooseLanguages(page, 'wizard-languages-picker', languages)
  await page.getByTestId('wizard-next').click()
  await expect(page.getByTestId('wizard-step-3')).toBeVisible()
  await expect(page.getByTestId('wizard-busy-propose')).toHaveCount(0, { timeout: 15_000 })
}

/** The piece ids on The work, in screen order. */
export async function pieceIds(page: Page): Promise<string[]> {
  const ids = await page.locator('[data-testid^="wizard-work-piece-"]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-testid')!.replace('wizard-work-piece-', '')),
  )
  return ids
}

/** Name a piece's owner through its dialog (the owner lives in the piece dialog since CB-v3-P4). */
export async function setPieceOwner(page: Page, id: string, owner: string) {
  await page.getByTestId(`wizard-work-edit-${id}`).click()
  await page.getByTestId('wizard-piece-owner').selectOption({ label: owner })
  await page.getByTestId('wizard-piece-save').click()
  await expect(page.getByTestId('wizard-piece-save')).toHaveCount(0)
}

/**
 * Step 3: an owner on every piece (in order, the last one repeated), a department and an owner on
 * every proposed group that lacks one, then "Keep these — go to timing". Leaves it on step 4.
 */
export async function ownTheWork(page: Page, owners: string[], groupOwner?: string) {
  const ids = await pieceIds(page)
  for (let i = 0; i < ids.length; i++) await setPieceOwner(page, ids[i]!, owners[Math.min(i, owners.length - 1)]!)
  for (const sel of await page.locator('select[data-testid^="wizard-work-dept-"]').all()) {
    if ((await sel.inputValue()) === '') await sel.selectOption({ index: 1 })
  }
  if (groupOwner) {
    // An option reads "name · role" (ProposalStep), so the owner is found by name, not by label.
    for (const sel of await page.locator('select[data-testid^="wizard-work-owner-"]').all()) {
      const value = await sel.locator('option').filter({ hasText: groupOwner }).first().getAttribute('value')
      expect(value, `${groupOwner} is offered as the group's owner`).toBeTruthy()
      await sel.selectOption(value!)
    }
  }
  await page.getByTestId('wizard-next').click()
  await expect(page.getByTestId('wizard-step-4')).toBeVisible()
}

/** Step 4's one row action: Edit, a date, Save. `id` omitted means the first row on screen. */
export async function setDue(page: Page, date: string, id?: string) {
  const edit = id ? page.getByTestId(`wizard-timing-edit-${id}`) : page.locator('[data-testid^="wizard-timing-edit-"]').first()
  await edit.click()
  await page.getByTestId('wizard-timing-piece-due').fill(date)
  await page.getByTestId('wizard-timing-piece-save').click()
  await expect(page.getByTestId('wizard-timing-piece-dialog')).toHaveCount(0)
}

/** The row ids on step 4 (the open phase's, with phases). */
export async function timingRowIds(page: Page): Promise<string[]> {
  return page.locator('[data-testid^="wizard-timing-row-"]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-testid')!.replace('wizard-timing-row-', '')),
  )
}

/** Step 4 → 5 → "Approve and start the work". Returns the campaign id, from the page it lands on. */
export async function reviewAndApprove(page: Page): Promise<string> {
  await page.getByTestId('wizard-next').click()
  await expect(page.getByTestId('wizard-step-5')).toBeVisible()
  await page.getByTestId('wizard-review-approve').click()
  await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/, { timeout: 30_000 })
  return page.url().split('/').pop()!
}
