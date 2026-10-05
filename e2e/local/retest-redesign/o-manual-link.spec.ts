import { test, expect, type Browser, type Page } from '@playwright/test'
import path from 'node:path'
import { authFile, PEOPLE } from '../fixtures'
import { rows, userIdOf } from '../helpers/db'
import { releaseSingleJob, type ReleasedJob } from '../helpers/single-job'
import { approveTaskList } from '../helpers/piece'

/**
 * Section O — a manual note can carry a link (ADR-0059 addendum d.14–d.17, I48.29).
 *
 * Fixture: one typed Creative single job, task list approved, its first task booked on the maker
 * in MANUAL mode with the department lead as the required reviewer. Then the round: the maker
 * starts, writes the note WITH a link, submits; the lead opens the task under Awaiting my review
 * and sees the link as a link.
 *
 * `GUIDE_SHOTS=1` also writes the two screenshots guides 7 and 8 embed for this flow, at the
 * guides' size, so a changed screen is re-shot by re-running this section rather than by hand.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag), viewport: { width: 1708, height: 1438 } })
  return ctx.newPage()
}

const GUIDE_SHOTS = process.env.GUIDE_SHOTS === '1'
const IMAGES = path.resolve('docs/guides/images')
async function shot(page: Page, name: string) {
  if (!GUIDE_SHOTS) return
  // The local-database marker is for the person at the keyboard, not for a guide's reader.
  await page.addStyleTag({ content: '[data-testid="environment-bar"]{display:none!important}' })
  await page.screenshot({ path: path.join(IMAGES, name), fullPage: false })
}

const baghdadToday = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10)
function sundayOut(weeksOut: number): string {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + 7 * weeksOut + ((7 - d.getUTCDay()) % 7))
  return d.toISOString().slice(0, 10)
}
const isBaghdadWorkingDay = (iso: string) => ![5, 6].includes(new Date(`${iso}T12:00:00Z`).getUTCDay())

async function bookManual(page: Page, jobTitle: string, resourceId: string, isoDate: string, taskTitle: string) {
  await page.goto(`/schedule?on=${isoDate}`)
  await expect(page.getByTestId('schedule-grid')).toBeVisible()
  const cell = page.getByTestId(`cell-${resourceId}-${isoDate}`)
  await expect(cell).toBeVisible()
  await cell.hover()
  await page.getByTestId(`add-${resourceId}-${isoDate}`).click()
  const dialog = page.getByTestId('booking-dialog')
  await expect(dialog).toBeVisible()
  const toggle = page.getByTestId('mode-project')
  if (await toggle.count()) await toggle.check()
  await page.getByTestId('booking-project').selectOption({ label: jobTitle })
  await page.getByTestId('booking-deliverable-select').selectOption({ index: 1 })
  await page.getByTestId('booking-subtask-select').selectOption({ label: taskTitle })
  await page.getByTestId('booking-project-reviewer-add').selectOption({ label: PEOPLE.lead.name })
  await page.getByTestId('booking-review-mode').selectOption('manual')
  await page.getByTestId('booking-hours').fill('4')
  const submit = page.getByTestId('booking-submit')
  await submit.click()
  const outcome = await Promise.race([
    dialog.waitFor({ state: 'detached', timeout: 20_000 }).then(() => 'closed' as const),
    submit.filter({ hasText: /Proceed anyway/ }).waitFor({ state: 'visible', timeout: 20_000 }).then(() => 'warned' as const),
  ])
  if (outcome === 'warned') {
    await submit.click()
    await expect(dialog).toHaveCount(0)
  }
}

const LINK = 'https://www.icloud.com/keynote/0a1b2c3d4e5f#Northwind_Q4_pitch_v1'

let job: ReleasedJob
let task: { id: string; title: string }

test.describe('Section O — a manual note can carry a link', () => {
  test.beforeAll(async ({ browser }) => {
    const am = await as(browser, 'am')
    job = await releaseSingleJob(am, { title: `O deck ${Date.now()}`, department: 'Creative', type: 'Social Advertisement' })
    await am.context().close()

    const lead = await as(browser, 'lead')
    // The task list is approved on the campaign piece panel now (I71.1, ADR-0140); the Creative lead may (I74.51).
    await approveTaskList(lead, job)
    await lead.context().close()

    ;[task] = await rows<{ id: string; title: string }>('sub_tasks', `select=id,title&deliverable_id=eq.${job.deliverableId}&order=sort_order.asc`)
    const [r] = await rows<{ id: string }>('resources', `select=id&name=eq.${encodeURIComponent(PEOPLE.maker.name)}&is_active=eq.true`)
    const today = baghdadToday()
    const traffic = await as(browser, 'traffic')
    await bookManual(traffic, job.title, r.id, isBaghdadWorkingDay(today) ? today : sundayOut(1), task.title)
    await traffic.context().close()
  })

  test('O1 — the maker writes a note with a link and submits; the link is stored, the note still gates', async ({ browser }) => {
    const maker = await as(browser, 'maker')
    await maker.goto('/my-work')
    await maker.getByTestId(`my-work-start-${task.id}`).click()
    // I59.11: the maker's note and Send are on the task's own page (the Submit dialog is retired).
    await maker.getByTestId(`my-work-open-${task.id}`).click()
    const modal = maker.getByTestId('task-page-file')
    await expect(modal).toBeVisible()
    await expect(maker.getByTestId(`my-work-submit-${task.id}`)).toBeDisabled()
    // d.17: the sentence is on the maker's composer.
    await expect(maker.getByTestId(`task-review-link-note-${task.id}`)).toContainText(/final approved file/i)

    // d.15: a link alone sends nothing — the note is what the gate reads.
    await maker.getByTestId(`task-comment-link-input-${task.id}`).fill(LINK)
    await expect(maker.getByTestId(`task-comment-submit-${task.id}`)).toBeDisabled()
    await expect(maker.getByTestId(`task-review-gate-${task.id}`)).toContainText(/write what you did/i)

    await maker.getByTestId(`task-comment-body-${task.id}`).fill('Deck v1 is on iCloud — 14 slides, the two hero visuals are placeholders until Motion delivers.')
    await maker.getByTestId(`task-comment-submit-${task.id}`).click()
    await expect(maker.getByTestId(`task-review-gate-${task.id}`)).toContainText(/you can submit/i)
    // d.16: the maker sees their own link as a link, showing host + path, not the token.
    const anchor = modal.locator('a.review-comment-link')
    await expect(anchor).toHaveCount(1)
    await expect(anchor).toHaveAttribute('href', LINK)
    await expect(anchor).toHaveAttribute('target', '_blank')
    await expect(anchor).toHaveText('www.icloud.com/keynote/0a1b2c3d4e5f')
    await shot(maker, '07-04b-submit-modal-manual-note-with-link.png')

    await maker.getByTestId(`my-work-submit-${task.id}`).click()

    // ADR-0106 (I59.20): a round sent minutes after Start is untimed — the warning, then Send anyway.

    await maker.getByTestId('untimed-send').click()
    await expect(maker.getByTestId('task-page-status')).toHaveAttribute('data-status', 'review')
    await expect.poll(async () => (await rows<{ status: string }>('sub_tasks', `select=status&id=eq.${task.id}`))[0].status).toBe('review')

    const notes = await rows<{ link_url: string | null; author_user_id: string }>('review_feedback', `select=link_url,author_user_id&sub_task_id=eq.${task.id}`)
    expect(notes).toHaveLength(1)
    expect(notes[0].link_url).toBe(LINK)
    expect(notes[0].author_user_id).toBe(await userIdOf(PEOPLE.maker.email))
    await maker.context().close()
  })

  test('O2 — the reviewer sees the link on the task they are asked to approve; the sentence is not theirs', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await lead.goto('/my-work')
    await lead.getByTestId(`awaiting-review-open-${task.id}`).click()
    const modal = lead.getByTestId(`awaiting-review-modal-${task.id}`)
    await expect(modal).toBeVisible()
    const anchor = modal.locator('a.review-comment-link')
    await expect(anchor).toHaveCount(1)
    await expect(anchor).toHaveAttribute('href', LINK)
    await expect(anchor).toHaveAttribute('rel', /noopener/)
    await expect(lead.getByTestId(`task-review-link-note-${task.id}`)).toHaveCount(0)
    await shot(lead, '08-02b-review-modal-manual-note-with-link.png')

    await lead.getByTestId(`awaiting-review-approve-${task.id}`).click()
    await expect(modal).toHaveCount(0)
    await expect.poll(async () => (await rows<{ status: string }>('sub_tasks', `select=status&id=eq.${task.id}`))[0].status).toBe('done')
    await lead.context().close()
  })
})
