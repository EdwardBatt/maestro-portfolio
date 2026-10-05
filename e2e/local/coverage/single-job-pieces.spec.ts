import { test, expect } from '@playwright/test'
import { authFile } from '../fixtures'
import { rows } from '../helpers/db'
import { approveSingleJob, dueInTwoWeeks, nextToReview, pickJobLanguages } from '../helpers/single-job'

/**
 * ADR-0138 (I73.3) — the single job asks the brief what to make; a piece may belong to another department,
 * owned there, on its own day; either is warned ("reads like a campaign"), never refused.
 *
 * The model is stood in for (`generate-deliverables` answered in the browser) so the suggestion is the same
 * every run; every other step — the draft, the release, the rows it writes — is the product's.
 */
test('the brief suggests two pieces on two departments; the second is owned in Production on its own day, with a warning', async ({ browser }) => {
  const [creative] = await rows<{ id: string }>('departments', 'select=id&name=eq.Creative')
  const [production] = await rows<{ id: string }>('departments', 'select=id&name=eq.Production')
  const types = await rows<{ code: string; name_en: string }>('deliverable_types', 'select=code,name_en&is_active=eq.true&order=code&limit=2')
  expect(types.length, 'two active deliverable types').toBe(2)

  const ctx = await browser.newContext({ storageState: authFile('am') })
  const page = await ctx.newPage()
  await page.route('**/functions/v1/generate-deliverables', (route) => route.fulfill({
    json: {
      deliverables: [
        { name: types[0]!.name_en, quantity: 3, typeCode: types[0]!.code, needsType: false, note: null, channel: null, phaseNumber: null, group: 0 },
        { name: types[1]!.name_en, quantity: 1, typeCode: types[1]!.code, needsType: false, note: null, channel: null, phaseNumber: null, group: 1 },
      ],
      groups: [{ name: null, departmentId: creative!.id }, { name: null, departmentId: production!.id }],
      vocabulary: { types: 'offered', channels: 'offered' },
    },
  }))

  const title = `Pieces across departments ${Date.now().toString().slice(-6)}`
  const due = dueInTwoWeeks()
  const later = new Date(Date.parse(`${due}T12:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10)
  await page.goto('/campaigns/new-job')
  await page.getByTestId('sj-client').selectOption({ label: 'Northwind Beverages' })
  await page.getByTestId('sj-words').fill('Three posts and a short video for the summer range.')
  await page.getByTestId('sj-brief-card-single_execution').click()
  await page.getByTestId('sj-next').click()
  await page.getByTestId('sj-field-task').fill('Three posts and a 15-second video.')
  await page.getByTestId('sj-next').click()
  await expect(page.getByTestId('sj-request')).toBeVisible()

  // The suggestion landed: the job's own piece, and one more on Production, marked as suggested.
  await expect(page.getByTestId('sj-suggestion')).toContainText('Suggested from the brief')
  await expect(page.getByTestId('sj-more-suggested-0')).toBeVisible()
  await expect(page.getByTestId('sj-more-department-0')).toHaveValue(production!.id)
  await expect(page.getByTestId('sj-reads-like-campaign')).toContainText('more than one department')

  await page.getByTestId('sj-title').fill(title)
  await page.getByTestId('sj-due').fill(due)
  // The second piece: its owner chosen among Production's leads, and its own day.
  const owner = page.getByTestId('sj-more-owner-0')
  const ownerId = await owner.locator('option').first().getAttribute('value')
  expect(ownerId, 'Production has a lead to own it').toBeTruthy()
  await owner.selectOption(ownerId!)
  await page.getByTestId('sj-more-due-0').fill(later)
  await expect(page.getByTestId('sj-reads-like-campaign')).toContainText('due on different days')
  await page.getByTestId('sj-department').getByRole('radio', { name: 'Creative' }).click()
  await pickJobLanguages(page)
  await nextToReview(page)
  const campaignId = await approveSingleJob(page)

  // Released: two pieces — the second owned in Production, due on its own day.
  const pieces = await rows<{ owner_user_id: string; department_id: string; due_at: string; quantity: number }>(
    'deliverables', `select=owner_user_id,department_id,due_at,quantity,streams!inner(campaign_id)&streams.campaign_id=eq.${campaignId}&order=created_at`)
  expect(pieces).toHaveLength(2)
  const second = pieces.find((p) => p.owner_user_id === ownerId)
  expect(second, 'the Production piece is owned by the lead chosen for it').toBeTruthy()
  expect(second!.department_id).toBe(production!.id)
  expect(second!.due_at.slice(0, 10)).toBe(later)
  await ctx.close()
})
