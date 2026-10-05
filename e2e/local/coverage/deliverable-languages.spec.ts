import { test, expect } from '@playwright/test'
import { CAMPAIGNS } from '../fixtures'
import { rows } from '../helpers/db'
import { as, rpcRaw } from '../helpers/i74'
import { chooseLanguages, mockProposal, startCampaign } from '../helpers/campaign-wizard'
import { dueInTwoWeeks } from '../helpers/single-job'

/**
 * ADR-0117 addendum, 4 Oct (Edward, Q18–Q20) — I74.34, I74.35, I74.36.
 *
 *   Q18  a deliverable starts with its campaign's languages; the account manager adds one to that deliverable alone,
 *        with the existing picker (chips, a remove icon each). The owner and a team member see them, read only.
 *   Q20  its translation task follows: "Translation — <campaign> (Arabic, English, Kurdish)" (ADR-0071 addendum, 4 Oct).
 *   Q19  a campaign (step 2) and a single job (who and when) do not go on without a language — and say so.
 *
 * Runs on the seeded "Northwind Summer Launch" (Arabic and English) and puts the deliverable's languages back as
 * found. The wizard and the job leave drafts behind, as the other wizard specs do.
 */

interface Piece { id: string; name: string; languages: string[]; owner_user_id: string }

async function keyVisual(): Promise<{ campaignId: string; piece: Piece; other: Piece }> {
  const [c] = await rows<{ id: string; languages: string[] }>('campaigns', `select=id,languages&name=eq.${encodeURIComponent(CAMPAIGNS.running)}`)
  expect(c, 'the running campaign is seeded').toBeTruthy()
  expect(c!.languages, 'the running campaign is made in Arabic and English').toEqual(['ar', 'en'])
  const pieces = await rows<Piece>('deliverables', `select=id,name,languages,owner_user_id,streams!inner(campaign_id)&streams.campaign_id=eq.${c!.id}&order=created_at`)
  const piece = pieces.find((p) => p.name === 'Key visual - summer range')!
  const other = pieces.find((p) => p.name === 'Social statics')!
  return { campaignId: c!.id, piece, other }
}

async function translationTitle(deliverableId: string): Promise<string | null> {
  const t = await rows<{ title: string }>('sub_tasks', `select=title&deliverable_id=eq.${deliverableId}&title=like.Translation*&status=neq.cancelled`)
  return t[0]?.title ?? null
}

test.describe.serial('a deliverable\'s languages (ADR-0117 addendum, Q18–Q20)', () => {
  test('the account manager adds Kurdish to one deliverable: its chips, the grid, its translation task', async ({ browser }, info) => {
    const { campaignId, piece, other } = await keyVisual()
    expect(piece.languages, 'it starts with its campaign\'s languages').toEqual(['ar', 'en'])
    expect(await translationTitle(piece.id)).toBe('Translation — Northwind Summer Launch (Arabic, English)')

    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${campaignId}?piece=${piece.id}`)
    const picker = am.getByTestId('piece-panel-languages')
    await expect(picker).toBeVisible()
    await expect(am.getByTestId('piece-panel-languages-chip-ar')).toBeVisible()
    await expect(am.getByTestId('piece-panel-languages-chip-en')).toBeVisible()

    // Kurdish, through the smart filter.
    await am.getByTestId('piece-panel-languages-input').fill('Kur')
    await am.getByTestId('piece-panel-languages-option-ku').dispatchEvent('mousedown')
    await expect(am.getByTestId('piece-panel-languages-chip-ku')).toBeVisible()
    await am.getByTestId('piece-panel-save').click()

    await expect.poll(async () => (await rows<Piece>('deliverables', `select=languages&id=eq.${piece.id}`))[0]?.languages).toEqual(['ar', 'en', 'ku'])
    await expect.poll(() => translationTitle(piece.id)).toBe('Translation — Northwind Summer Launch (Arabic, English, Kurdish)')
    // The deliverable's own: the campaign and the other deliverables are as they were.
    expect((await rows<{ languages: string[] }>('campaigns', `select=languages&id=eq.${campaignId}`))[0]?.languages).toEqual(['ar', 'en'])
    expect((await rows<Piece>('deliverables', `select=languages&id=eq.${other.id}`))[0]?.languages).toEqual(['ar', 'en'])

    // The page says it: the grid in words, and the renamed task in the panel's list.
    await am.reload()
    await expect(am.getByTestId('piece-panel-languages-chip-ku')).toBeVisible()
    await expect(am.getByTestId('piece-panel-tasks')).toContainText('Translation — Northwind Summer Launch (Arabic, English, Kurdish)')
    await am.screenshot({ path: info.outputPath('am-panel-kurdish-added.png') })
    await am.getByTestId('piece-panel-tasks').getByText('Translation — Northwind Summer Launch (Arabic, English, Kurdish)').scrollIntoViewIfNeeded()
    await am.screenshot({ path: info.outputPath('am-panel-translation-renamed.png') })
    await am.goto(`/campaigns/${campaignId}?view=grid`)
    await am.getByTestId('campaign-tab-grid').click()
    await expect(am.getByTestId(`campaign-grid-languages-${piece.id}`)).toHaveText('Arabic, English, Kurdish')
    await expect(am.getByTestId(`campaign-grid-languages-${other.id}`)).toHaveText('Arabic, English')
    await am.getByTestId(`campaign-grid-languages-${piece.id}`).scrollIntoViewIfNeeded()
    await am.screenshot({ path: info.outputPath('am-grid-languages.png') })

    // The last language cannot go: the panel says so and Save waits.
    await am.goto(`/campaigns/${campaignId}?piece=${piece.id}`)
    for (const code of ['ar', 'en', 'ku']) await am.getByTestId(`piece-panel-languages-remove-${code}`).click()
    await expect(am.getByTestId('piece-panel-languages-missing')).toBeVisible()
    await expect(am.getByTestId('piece-panel-save')).toBeDisabled()
    await am.screenshot({ path: info.outputPath('am-panel-no-language.png'), fullPage: true })

    // Put it back as found: Arabic and English.
    await chooseLanguages(am, 'piece-panel-languages', ['ar', 'en'])
    await am.getByTestId('piece-panel-save').click()
    await expect.poll(async () => (await rows<Piece>('deliverables', `select=languages&id=eq.${piece.id}`))[0]?.languages).toEqual(['ar', 'en'])
    await expect.poll(() => translationTitle(piece.id)).toBe('Translation — Northwind Summer Launch (Arabic, English)')
    await am.context().close()
  })

  test('the owner and a team member see the languages and cannot change them', async ({ browser }, info) => {
    const { campaignId, piece } = await keyVisual()

    // The owner (a team lead): the panel's fields are the account manager's on a live campaign — read in the header.
    const owner = await as(browser, 'tl')
    await owner.goto(`/campaigns/${campaignId}?piece=${piece.id}`)
    await expect(owner.getByTestId('piece-panel-ask-languages')).toHaveText('Arabic, English')
    await expect(owner.getByTestId('piece-panel-languages')).toHaveCount(0)
    await owner.screenshot({ path: info.outputPath('owner-languages-read-only.png'), fullPage: true })
    const ownerTry = await rpcRaw('tl', 'update_piece_details', { p_deliverable: piece.id, p_channel: null, p_languages: ['ar', 'en', 'ku'], p_notes: null })
    expect(ownerTry.status, ownerTry.text).toBeGreaterThanOrEqual(400)
    expect(ownerTry.text).toContain('only the account manager changes a deliverable')
    await owner.context().close()

    // A team member: no editor at all; the grid names the languages.
    const maker = await as(browser, 'maker')
    await maker.goto(`/campaigns/${campaignId}?view=grid`)
    await maker.getByTestId('campaign-tab-grid').click()
    await expect(maker.getByTestId(`campaign-grid-languages-${piece.id}`)).toHaveText('Arabic, English')
    await expect(maker.getByTestId('piece-panel-languages')).toHaveCount(0)
    await maker.getByTestId(`campaign-grid-languages-${piece.id}`).scrollIntoViewIfNeeded()
    await maker.screenshot({ path: info.outputPath('maker-grid-languages.png') })
    const makerTry = await rpcRaw('maker', 'update_piece_details', { p_deliverable: piece.id, p_channel: null, p_languages: ['ar'], p_notes: null })
    expect(makerTry.status, makerTry.text).toBeGreaterThanOrEqual(400)
    await maker.context().close()
    expect((await rows<Piece>('deliverables', `select=languages&id=eq.${piece.id}`))[0]?.languages).toEqual(['ar', 'en'])
  })

  test('the wizard will not pass step 2 without a language, nor a single job its step 3 — each says so', async ({ browser }, info) => {
    const am = await as(browser, 'am')
    await mockProposal(am, [{ name: 'Teaser', typeCode: 'SOC-001' }])
    await startCampaign(am, { name: `Languages ${Date.now()}` })
    await am.getByTestId('wizard-brief-proposition').fill('Cold before you get there.')
    await am.getByTestId('wizard-next').click()
    await expect(am.getByTestId('wizard-error')).toContainText('Choose at least one language this campaign is made in')
    await am.screenshot({ path: info.outputPath('wizard-step2-refused.png'), fullPage: true })
    await am.getByTestId('wizard-error-close').click()
    await expect(am.getByTestId('wizard-step-2')).toBeVisible()
    await expect(am.getByTestId('wizard-languages-missing')).toBeVisible()
    await chooseLanguages(am, 'wizard-languages-picker', ['ar'])
    await expect(am.getByTestId('wizard-languages-missing')).toHaveCount(0)
    await am.getByTestId('wizard-next').click()
    await expect(am.getByTestId('wizard-step-3')).toBeVisible()

    // A single job, on who and when.
    await am.goto('/campaigns/new-job')
    await am.getByTestId('sj-client').selectOption({ label: 'Northwind Beverages' })
    await am.getByTestId('sj-words').fill('One social static for the summer range.')
    await am.getByTestId('sj-brief-card-single_execution').click()
    await am.getByTestId('sj-next').click()
    await am.getByTestId('sj-field-task').fill('Design one social static.')
    await am.getByTestId('sj-next').click()
    await expect(am.getByTestId('sj-request')).toBeVisible()
    await am.getByTestId('sj-title').fill(`Languages job ${Date.now()}`)
    await am.getByTestId('sj-due').fill(dueInTwoWeeks())
    await am.getByTestId('sj-department').getByRole('radio', { name: 'Creative' }).click()
    await am.getByTestId('sj-next').click()
    await expect(am.getByTestId('sj-languages-missing')).toBeVisible()
    await expect(am.getByTestId('sj-request')).toBeVisible()
    await am.screenshot({ path: info.outputPath('job-step3-refused.png'), fullPage: true })
    await am.context().close()
  })
})
