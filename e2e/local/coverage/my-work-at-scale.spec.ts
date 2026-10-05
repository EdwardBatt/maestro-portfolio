import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows, userIdOf } from '../helpers/db'

/**
 * I49.75 — My Work loads for a person with a few hundred live tasks.
 *
 * The seeded maker has accumulated ~230 live tasks over two days of local runs, which is exactly
 * the case that failed on 15 Sep: the reviewers read named every task in one request's address
 * and the gateway refused it as too long, so the page said "Could not load your assigned work."
 * The reads now go out in batches of 100 ids (`src/lib/query/in-chunks.ts`).
 *
 * The test needs the maker to hold MORE than one batch of live tasks, or it proves nothing; it
 * says so and stops if the database has been reset.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}

test('My Work loads for a person with more than a hundred live tasks (I49.75)', async ({ browser }) => {
  const makerId = await userIdOf(PEOPLE.maker.email)
  const live = await rows<{ id: string }>('sub_tasks', `select=id&assignee_id=eq.${makerId}&status=not.in.(done,cancelled)`)
  test.skip(live.length <= 100, `the maker holds ${live.length} live tasks — this proof needs more than one batch (101+)`)

  const maker = await as(browser, 'maker')
  await maker.goto('/my-work')
  await expect(maker.getByTestId('today-tasks-panel').or(maker.getByTestId('today-tasks-empty'))).toBeVisible({ timeout: 30_000 })
  await expect(maker.getByText(/could not load your assigned work/i)).toHaveCount(0)
  // The list shows work, and a task on it carries its reviewer line (the read that failed).
  await expect(maker.locator('[data-testid^="my-work-item-"]').first()).toBeVisible()
  await expect(maker.locator('[data-testid^="my-work-people-"]').first()).toBeVisible()
  await maker.context().close()
})
