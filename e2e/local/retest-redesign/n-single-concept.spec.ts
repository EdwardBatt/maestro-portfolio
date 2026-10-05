import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows } from '../helpers/db'

/**
 * docs/RETEST-REDESIGN.md — N: the single refined concept (ADR-0065 addendum, I48.15).
 *
 * `propose-concepts` is a real model call (OpenAI, through the local functions runtime with the
 * env file) — it writes the concept row itself, so it is NOT mocked here: every press below costs
 * one model round-trip and is given the time for it. Runs on the seeded Northwind campaign: its
 * Content brief is written (N1–N7); a blank Creative brief is created from the template for N8.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}

type Item = { id: string; shape: string; text: string; kept: boolean }
let campaignId: string
let contentDept: string
let creativeDept: string
let panel: string
/** The items, shapes and their controls hang off the concept card's own prefix. */
let card: string

/** Every item on the panel, by shape, with its text and whether it carries the Kept tag. */
async function itemsOn(page: Page): Promise<Item[]> {
  const out: Item[] = []
  for (const shape of ['strategic_thinking', 'creative_direction', 'pillars']) {
    const group = page.getByTestId(`${card}-${shape}`)
    if (!(await group.count())) continue
    const nodes = group.locator(`[data-testid^="${card}-item-"]`)
    const n = await nodes.count()
    for (let i = 0; i < n; i++) {
      const el = nodes.nth(i)
      const id = (await el.getAttribute('data-testid'))!.replace(`${card}-item-`, '')
      const kept = (await el.locator(`[data-testid="${card}-kept-${id}"]`).count()) > 0
      const text = ((await el.textContent()) ?? '').replace(/\s+/g, ' ').replace(/(Kept|Keep|Delete)/g, '').trim()
      out.push({ id, shape, text, kept })
    }
  }
  return out
}

async function openContentTab(page: Page) {
  await page.goto(`/campaigns/${campaignId}`)
  await page.getByTestId(`campaign-tab-${contentDept}`).click()
  await expect(page.getByTestId(panel)).toBeVisible()
}

// I56.28 (Edward, 24 Sep): "remove for now.. do not remove the code, just leave it off the page".
// The panel is off the campaign page, so this section is parked — not deleted — until concepts have
// a place again. What IS checked while it is parked: the panel stays off.
test.describe('Section N — concepts are off the page (I56.28)', () => {
  // I57.4 (24 Sep): the campaign grid replaced the department tabs; a campaign's department briefs are
  // retired and one that already carries them shows them, read only, on the Brief view (ADR-0100 d.6).
  // So the brief is looked for there — and the concepts panel is still not beside it.
  test('N0 — the Brief view shows no concepts panel, even where a department brief exists', async ({ browser }) => {
    const [c] = await rows<{ id: string }>('campaigns', `select=id&name=eq.${encodeURIComponent('Northwind Summer Launch')}`)
    const [{ id: content }] = await rows<{ id: string }>('departments', 'select=id&name=eq.Content')
    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${c.id}`)
    await am.getByTestId('campaign-tab-brief').click()
    await expect(am.getByTestId(`campaign-department-${content}`)).toBeVisible()
    await expect(am.getByTestId(`campaign-concepts-${content}`)).toHaveCount(0)
    await am.context().close()
  })
})

test.describe.skip('Section N — the single refined concept (parked, I56.28)', () => {
  test.beforeAll(async () => {
    const [c] = await rows<{ id: string }>('campaigns', `select=id&name=eq.${encodeURIComponent('Northwind Summer Launch')}`)
    campaignId = c.id
    ;[{ id: contentDept }] = await rows<{ id: string }>('departments', 'select=id&name=eq.Content')
    ;[{ id: creativeDept }] = await rows<{ id: string }>('departments', 'select=id&name=eq.Creative')
    panel = `campaign-concepts-${contentDept}`
    card = `${panel}-concept`
    const [brief] = await rows<{ id: string; values: Record<string, string> }>('campaign_briefs', `select=id,values&campaign_id=eq.${campaignId}&department_id=eq.${contentDept}`)
    expect(brief, 'Northwind has a written Content brief').toBeTruthy()
    expect(Object.values(brief.values ?? {}).some((v) => String(v).trim())).toBe(true)
  })

  test('N1 — propose: one concept, three shapes, no content-type suggestions, proposed by you', async ({ browser }) => {
    test.setTimeout(240_000)
    const am = await as(browser, 'am')
    await openContentTab(am)
    await expect(am.getByTestId(panel)).toContainText('Proposed concept')
    // A previous run may have left a concept: discard it first, so this run proposes afresh.
    if (await am.getByTestId(`${panel}-concept`).count()) {
      await am.getByTestId(`${panel}-discard`).click()
      await am.getByTestId(`${panel}-discard`).click()
      await expect(am.getByTestId(`${panel}-empty`)).toBeVisible()
    }
    const propose = am.getByTestId(`${panel}-propose`)
    await expect(propose).toHaveText('Propose a concept')
    await expect(propose).toBeEnabled()
    await propose.click()
    const busy = am.getByTestId(`${panel}-busy`)
    await expect(busy).toBeVisible()
    await expect(busy).toContainText('Proposing a concept…')
    await expect(busy).toHaveCount(0, { timeout: 180_000 })
    await expect(am.getByTestId(`${panel}-error`)).toHaveCount(0)
    const concept = am.getByTestId(`${panel}-concept`)
    await expect(concept).toBeVisible()
    await expect(concept).toContainText(`Proposed by ${PEOPLE.am.name} ·`)
    await expect(am.getByTestId(`${card}-strategic_thinking`)).toBeVisible()
    await expect(am.getByTestId(`${card}-creative_direction`)).toBeVisible()
    await expect(am.getByTestId(`${card}-pillars`)).toBeVisible()
    await expect(am.getByTestId(panel)).not.toContainText(/suggested content types/i)
    await expect(am.locator('body')).not.toContainText(/suggested content types/i)
    // ONE concept in the record.
    const [brief] = await rows<{ id: string }>('campaign_briefs', `select=id&campaign_id=eq.${campaignId}&department_id=eq.${contentDept}`)
    const concepts = await rows<{ id: string }>('campaign_concepts', `select=id&campaign_brief_id=eq.${brief.id}`)
    expect(concepts).toHaveLength(1)
    // Before any deletion: Regenerate removed (0), disabled, with the hint.
    await expect(propose).toHaveText('Regenerate removed (0)')
    await expect(propose).toBeDisabled()
    await expect(propose).toHaveAttribute('title', /delete an item you don't want first/i)
    await am.context().close()
  })

  test('N2/N3 — Keep marks an item; Delete opens a slot and the header counts it', async ({ browser }) => {
    const am = await as(browser, 'am')
    await openContentTab(am)
    const items = await itemsOn(am)
    const pillars = items.filter((i) => i.shape === 'pillars')
    const directions = items.filter((i) => i.shape === 'creative_direction')
    expect(pillars.length, 'at least three pillars to work with').toBeGreaterThanOrEqual(3)
    expect(directions.length).toBeGreaterThanOrEqual(1)

    // N2 — keep one pillar: Kept tag, Keep gone, Delete remains.
    const keep = pillars[0]
    await expect(am.getByTestId(`${card}-keep-${keep.id}`)).toBeVisible()
    await am.getByTestId(`${card}-keep-${keep.id}`).click()
    await expect(am.getByTestId(`${card}-kept-${keep.id}`)).toBeVisible()
    await expect(am.getByTestId(`${card}-keep-${keep.id}`)).toHaveCount(0)
    await expect(am.getByTestId(`${card}-delete-${keep.id}`)).toBeVisible()

    // N3 — delete two pillars and one direction.
    for (const it of [pillars[1], pillars[2], directions[0]]) {
      await am.getByTestId(`${card}-delete-${it.id}`).click()
      await expect(am.getByTestId(`${card}-item-${it.id}`)).toHaveCount(0)
    }
    await expect(am.getByTestId(`${panel}-slots`)).toHaveText('3 items removed, waiting to be regenerated')
    await expect(am.getByTestId(`${panel}-propose`)).toHaveText('Regenerate removed (3)')
    await expect(am.getByTestId(`${panel}-propose`)).toBeEnabled()
    await am.context().close()
  })

  test('N4/N5 — regenerate fills only the gaps, twice; one concept per brief, the same after a reload', async ({ browser }) => {
    test.setTimeout(400_000)
    const am = await as(browser, 'am')
    await openContentTab(am)
    const before = await itemsOn(am)
    const beforeById = new Map(before.map((i) => [i.id, i]))
    const pillarsBefore = before.filter((i) => i.shape === 'pillars').length
    const directionsBefore = before.filter((i) => i.shape === 'creative_direction').length

    await am.getByTestId(`${panel}-propose`).click()
    const busy = am.getByTestId(`${panel}-busy`)
    await expect(busy).toBeVisible()
    await expect(busy).toContainText('Regenerating the removed items…')
    await expect(busy).toHaveCount(0, { timeout: 180_000 })
    await expect(am.getByTestId(`${panel}-error`)).toHaveCount(0)

    const after = await itemsOn(am)
    // Exactly the gaps: +2 pillars, +1 direction, and every earlier item exactly as it was.
    expect(after.filter((i) => i.shape === 'pillars').length).toBe(pillarsBefore + 2)
    expect(after.filter((i) => i.shape === 'creative_direction').length).toBe(directionsBefore + 1)
    for (const i of before) {
      const now = after.find((a) => a.id === i.id)
      expect(now, `item ${i.id} still there`).toBeTruthy()
      expect(now!.text).toBe(i.text)
      expect(now!.kept).toBe(i.kept)
    }
    const fresh = after.filter((a) => !beforeById.has(a.id))
    expect(fresh).toHaveLength(3)
    expect(fresh.every((f) => !f.kept)).toBe(true)
    await expect(am.getByTestId(`${panel}-slots`)).toHaveCount(0)
    await expect(am.getByTestId(`${panel}-regenerations`)).toContainText(`regenerated once, by ${PEOPLE.am.name} ·`)
    await expect(am.getByTestId(`${panel}-propose`)).toHaveText('Regenerate removed (0)')

    // Again, after one more deletion.
    const victim = after.find((a) => a.shape === 'pillars' && !a.kept)!
    await am.getByTestId(`${card}-delete-${victim.id}`).click()
    await expect(am.getByTestId(`${panel}-slots`)).toHaveText('1 item removed, waiting to be regenerated')
    await am.getByTestId(`${panel}-propose`).click()
    await expect(busy).toBeVisible()
    await expect(busy).toHaveCount(0, { timeout: 180_000 })
    await expect(am.getByTestId(`${panel}-regenerations`)).toContainText(`regenerated 2 times, last by ${PEOPLE.am.name} ·`)
    const again = await itemsOn(am)
    expect(again.filter((i) => i.shape === 'pillars').length).toBe(pillarsBefore + 2)

    // N5 — one concept per brief: no sets, no Latest/Earlier; a reload shows the same, kept marks and all.
    await expect(am.getByTestId(panel)).not.toContainText(/show proposed sets|latest|earlier/i)
    const [brief] = await rows<{ id: string }>('campaign_briefs', `select=id&campaign_id=eq.${campaignId}&department_id=eq.${contentDept}`)
    expect(await rows('campaign_concepts', `select=id&campaign_brief_id=eq.${brief.id}`)).toHaveLength(1)
    await am.reload()
    await am.getByTestId(`campaign-tab-${contentDept}`).click()
    await expect(am.getByTestId(`${panel}-concept`)).toBeVisible()
    const reloaded = await itemsOn(am)
    expect(reloaded.map((i) => [i.id, i.text, i.kept])).toEqual(again.map((i) => [i.id, i.text, i.kept]))
    await am.context().close()
  })

  test('N7 — a reader sees the concept and none of the controls', async ({ browser }) => {
    const maker = await as(browser, 'maker')
    await maker.goto(`/campaigns/${campaignId}`)
    await maker.getByTestId(`campaign-tab-${contentDept}`).click()
    await expect(maker.getByTestId(`${panel}-concept`)).toBeVisible()
    expect(await maker.locator(`[data-testid^="${card}-item-"]`).count()).toBeGreaterThan(0)
    await expect(maker.locator(`[data-testid^="${card}-keep-"]`)).toHaveCount(0)
    await expect(maker.locator(`[data-testid^="${card}-delete-"]`)).toHaveCount(0)
    await expect(maker.getByTestId(`${panel}-propose`)).toHaveCount(0)
    await expect(maker.getByTestId(`${panel}-discard`)).toHaveCount(0)
    await maker.context().close()
  })

  test('N6 — discard is two-step and returns the panel to "No concept proposed yet"', async ({ browser }) => {
    const am = await as(browser, 'am')
    await openContentTab(am)
    // The discard is an ICON until armed (icons over text buttons; I53.13) — its name is the
    // accessible label; once armed it becomes a worded button.
    const discard = am.getByTestId(`${panel}-discard`)
    await expect(discard).toHaveAccessibleName('Discard concept')
    await expect(discard).not.toHaveAttribute('data-armed', 'true')
    await discard.click()
    await expect(discard).toHaveText('Discard it — sure?')
    await expect(am.getByTestId(`${panel}-concept`)).toBeVisible() // nothing gone yet
    await discard.click()
    await expect(am.getByTestId(`${panel}-empty`)).toHaveText('No concept proposed yet.')
    await expect(am.getByTestId(`${panel}-propose`)).toHaveText('Propose a concept')
    const [brief] = await rows<{ id: string }>('campaign_briefs', `select=id&campaign_id=eq.${campaignId}&department_id=eq.${contentDept}`)
    expect(await rows('campaign_concepts', `select=id&campaign_brief_id=eq.${brief.id}`)).toHaveLength(0)
    await am.context().close()
  })

  test('N8 — an empty brief: Propose says so as a state, not an error dialog', async ({ browser }) => {
    const am = await as(browser, 'am')
    // The department's brief is created from a template with NOTHING written in it — the writer
    // (a model call) is mocked to return no values, which is what a blank brief is.
    await am.route('**/functions/v1/generate-brief', async (route) => {
      await new Promise((r) => setTimeout(r, 300))
      await route.fulfill({ json: { values: {}, oversized: [] } })
    })
    await am.goto(`/campaigns/${campaignId}`)
    await am.getByTestId(`campaign-tab-${creativeDept}`).click()
    const nobrief = am.getByTestId(`campaign-department-nobrief-${creativeDept}`)
    if (await nobrief.count()) {
      // The template choice shows only when the department has no default template (Admin →
      // Brief templates); with one assigned the tab goes straight to Generate.
      const template = am.getByTestId(`campaign-department-nobrief-${creativeDept}-template`)
      if (await template.isVisible()) {
        const labels = await template.locator('option').allTextContents()
        await template.selectOption({ label: labels.find((l) => /custom/i.test(l)) ?? labels.find((l) => l.trim() && !/select/i.test(l))! })
      }
      await am.getByTestId(`campaign-department-nobrief-${creativeDept}-generate`).click()
      // "The brief was written…" — then the tab still offers the template (a brief with nothing in
      // it reads as no brief), while the concepts panel hangs off the row that now exists.
      await expect(am.getByTestId('campaign-banner')).toContainText(/brief was written/, { timeout: 15_000 })
      await am.getByTestId('campaign-banner-close').click()
    }
    const [blankBrief] = await rows<{ values: Record<string, string> | null }>('campaign_briefs', `select=values&campaign_id=eq.${campaignId}&department_id=eq.${creativeDept}`)
    expect(Object.values(blankBrief.values ?? {}).every((v) => !String(v ?? '').trim())).toBe(true)
    const blank = `campaign-concepts-${creativeDept}`
    await expect(am.getByTestId(blank)).toBeVisible()
    await am.getByTestId(`${blank}-propose`).click()
    await expect(am.getByTestId(`${blank}-error`)).toContainText('This brief has nothing written in it yet')
    await expect(am.locator('[role="alertdialog"]')).toHaveCount(0)
    await expect(am.getByTestId(`${blank}-empty`)).toBeVisible()
    await am.context().close()
  })
})
