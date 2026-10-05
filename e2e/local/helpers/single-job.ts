import { expect, type Page } from '@playwright/test'
import { rows } from './db'

/**
 * Drive the single-job flow (SJ-v3-01 → SJ-04) through the product, as whoever the page is signed in
 * as, and return what it created. Used by the families after E that need a released job to work on
 * — the product creates the fixture, never the back door.
 */
export function dueInTwoWeeks(): string {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + 14 + ((7 - d.getUTCDay()) % 7))
  return d.toISOString().slice(0, 10)
}

export interface SingleJobInput {
  title: string
  department: 'Creative' | 'Content' | 'Production' | 'Strategy'
  /** The owner to pick from the drop-down (display name) — a team lead, or with no department lead the one to name. */
  ownerPick?: string
  client?: string
  words?: string
  task?: string
  due?: string
  /** A deliverable type (its English name). A typed job gets its workflow's task list; an untyped one has no tasks. */
  type?: string
  /** The kind of brief picked on SJ-v3-01 — a `brief_templates.brief_type` key. */
  briefType?: string
  /** Stop with the similar-job prompt (S1) open instead of keeping them separate. */
  keepPrompt?: boolean
  /** I54.12/I54.15 — the job's priority, set on step 3. Left alone the wizard sends none, which
   *  is a real third state: a deliverable with no priority carries no mark anywhere. */
  priority?: 'high' | 'medium' | 'low'
  /** ADR-0117 addendum (Q19, 4 Oct): the languages it is made in — at least one, picked. Default: English. */
  languages?: readonly string[]
}

/**
 * Next from who and when → the review. Since 22 Sep the similar-job prompt (S1) fires HERE, once
 * the title is known — and earlier runs leave lookalikes behind, so it may appear; "Keep them
 * separate" carries on. Pass `keepPrompt` to stop with the prompt open (the E specs assert on it).
 */
// Promise.any, not Promise.race (26 Sep): with race the LOSING waiter kept waiting and, on its
// timeout, rejected into whatever step was running by then — failing it at random (running-the-week,
// "release a job due tomorrow"). `any` settles on the first to happen and swallows the other's timeout;
// it still fails when neither happens.
export async function nextToReview(page: Page, keepPrompt = false): Promise<'prompt' | 'review'> {
  await page.getByTestId('sj-next').click()
  const prompt = page.getByTestId('sj-similar-dialog')
  const review = page.getByTestId('sj-review')
  const outcome = await Promise.any([
    prompt.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'prompt' as const),
    review.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'review' as const),
  ])
  if (outcome === 'prompt' && !keepPrompt) {
    await page.getByTestId('sj-similar-separate').click()
    await expect(review).toBeVisible()
  }
  return outcome
}

/** ADR-0117 addendum (Q19, 4 Oct): pick the job's languages on who and when — at least one; English by default here. */
export async function pickJobLanguages(page: Page, codes: readonly string[] = ['en']) {
  for (const code of codes) {
    if (await page.getByTestId(`sj-languages-picker-chip-${code}`).count()) continue
    await page.getByTestId('sj-languages-picker-input').click()
    await page.getByTestId(`sj-languages-picker-option-${code}`).dispatchEvent('mousedown')
    await expect(page.getByTestId(`sj-languages-picker-chip-${code}`)).toBeVisible()
  }
}

export async function fillSingleJobToReview(page: Page, input: SingleJobInput) {
  await page.goto('/campaigns/new-job')
  // The Figma's order (22 Sep): 1 the kind of brief with the evidence and the words, 2 the brief,
  // 3 who and when, 4 review. The draft is created on the first Next.
  await page.getByTestId('sj-client').selectOption({ label: input.client ?? 'Northwind Beverages' })
  await page.getByTestId('sj-words').fill(input.words ?? 'Three social statics for the summer range.')
  await page.getByTestId(`sj-brief-card-${input.briefType ?? 'single_execution'}`).click()
  await page.getByTestId('sj-next').click()
  await expect(page.getByTestId('sj-brief')).toBeVisible()
  await page.getByTestId('sj-field-task').fill(input.task ?? 'Design three social statics.')
  await page.getByTestId('sj-next').click()
  await expect(page.getByTestId('sj-request')).toBeVisible()
  await page.getByTestId('sj-title').fill(input.title)
  await page.getByTestId('sj-due').fill(input.due ?? dueInTwoWeeks())
  if (input.type) {
    // The type picker is a typed search: type the name, pick the option from the list.
    const picker = page.getByTestId('sj-type')
    await picker.fill(input.type)
    const option = page.getByTestId('sj-type-list').getByRole('option', { name: new RegExp(input.type) }).first()
    await option.dispatchEvent('mousedown')
    await expect(page.getByTestId('sj-type-none')).toHaveCount(0)
  }
  // By testid, not by the label: the word for `low` is "Normal" in English and its own word in
  // Arabic, and this helper is used by the Arabic walk too.
  if (input.priority) await page.getByTestId(`sj-priority-${input.priority}`).click()
  await page.getByTestId('sj-department').getByRole('radio', { name: input.department }).click()
  // Q19: a job is made in at least one language, picked — there is no default.
  await pickJobLanguages(page, input.languages)
  if (input.ownerPick) {
    // A drop-down since 27 Sep: the department lead and every team lead, each "Name · role".
    const owner = page.getByTestId('sj-owner-select')
    const value = await owner.locator('option', { hasText: input.ownerPick }).first().getAttribute('value')
    await owner.selectOption(value!)
  }
  await nextToReview(page, input.keepPrompt)
}

/** Approve; a lookalike prompt (left by earlier runs) is answered "keep separate". */
export async function approveSingleJob(page: Page): Promise<string> {
  await page.getByTestId('sj-approve').click()
  const prompt = page.getByTestId('sj-similar-dialog')
  const outcome = await Promise.any([
    prompt.waitFor({ state: 'visible', timeout: 10_000 }).then(() => 'prompt' as const),
    page.waitForURL(/\/campaigns\/[0-9a-f-]{36}$/, { timeout: 30_000 }).then(() => 'released' as const),
  ])
  if (outcome === 'prompt') {
    await page.getByTestId('sj-similar-separate').click()
    await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/, { timeout: 30_000 })
  }
  return page.url().split('/').pop()!
}

export interface ReleasedJob {
  title: string
  campaignId: string
  deliverableId: string
  ownerUserId: string
}

/** Release a single job end to end and return its one deliverable. */
export async function releaseSingleJob(page: Page, input: SingleJobInput): Promise<ReleasedJob> {
  await fillSingleJobToReview(page, input)
  const campaignId = await approveSingleJob(page)
  const [d] = await rows<{ id: string; owner_user_id: string }>(
    'deliverables',
    `select=id,owner_user_id,streams!inner(campaign_id)&streams.campaign_id=eq.${campaignId}`,
  )
  expect(d, `deliverable for ${input.title}`).toBeTruthy()
  return { title: input.title, campaignId, deliverableId: d.id, ownerUserId: d.owner_user_id }
}
