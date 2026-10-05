import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows } from '../helpers/db'

/**
 * I49.77 — the Library opens for a client with thousands of folders.
 *
 * Northwind has gained five folders per test campaign for two days (~2,600 locally). Until 15 Sep
 * the Library read the client's whole tree in one request, the server returned the first 1,000,
 * the client root was not among them, and the page showed nothing at all. The tree is now read
 * one level at a time (`src/lib/assets/folders.ts` — `useFolderView`).
 *
 * The proof needs a client with MORE folders than one request returns; it says so and stops if
 * the database has been reset.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}

test('the Library opens a client with more than a thousand folders, and walks into a campaign (I49.77)', async ({ browser }) => {
  const [client] = await rows<{ id: string; name: string }>('clients', `select=id,name&name=eq.${encodeURIComponent('Northwind Beverages')}`)
  // The server never returns more than 1,000 rows, so "more than a page" is asked as "is there a
  // row past the first thousand".
  const past = await rows<{ id: string }>('asset_folders', `select=id&client_id=eq.${client.id}&order=id&offset=1000&limit=1`)
  test.skip(past.length === 0, 'Northwind holds 1,000 folders or fewer — this proof needs more than one page')

  // I72: the client view reads every project in one call (`library_client_overview`) — no page cap.
  const traffic = await as(browser, 'traffic')
  await traffic.goto(`/library?client=${client.id}`)
  const [projects] = await rows<{ id: string }>('asset_folders', `select=id&client_id=eq.${client.id}&kind=eq.projects_root`)
  const campaignsUnder: { id: string }[] = []
  for (let offset = 0; ; offset += 1000) {
    const page = await rows<{ id: string }>('asset_folders', `select=id&parent_id=eq.${projects.id}&kind=eq.campaign&order=id&offset=${offset}&limit=1000`)
    campaignsUnder.push(...page)
    if (page.length < 1000) break
  }
  await expect(traffic.locator('[data-testid^="library-project-open-"]')).toHaveCount(campaignsUnder.length, { timeout: 30_000 })

  // Into one campaign; its References are chosen and the trail reaches back to the client.
  await traffic.locator('[data-testid^="library-project-open-"]').first().click()
  await expect(traffic.locator('.lb-folder-card.is-on')).toContainText('References')
  await expect(traffic.locator('.lb-crumbs')).toContainText(client.name)
  await traffic.context().close()
})
