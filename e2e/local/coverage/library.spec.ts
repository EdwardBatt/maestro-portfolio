import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { readFileSync } from 'node:fs'
import { rows } from '../helpers/db'

/**
 * The Library (I72, ADR-0134 — Figma K): every control, pressed, and what it did read back from the
 * database.
 *
 * THE BUCKET IS STOOD IN FOR, NOT THE PRODUCT. The local functions have no B2 keys, so `asset-url` and
 * the bucket are answered in the browser (the pattern `people-chat-library-bookings` set). Everything
 * else is real: the screens, the RPCs, the rows they write, the rules that refuse. A file "uploaded"
 * here has a row and no bytes.
 *
 * Each test makes its own premise in a folder of its own under Northwind Beverages' Northwind brand, named with the
 * run's stamp, so the long-lived local database never decides the outcome (traps.md).
 */
const BUCKET = 'https://b2.local.test'
const ANON = (readFileSync('.env.local', 'utf8').match(/^VITE_SUPABASE_PUBLISHABLE_KEY=(.+)$/m)?.[1] ?? '').trim()
const stamp = Date.now().toString().slice(-6)

async function mockBucket(page: Page) {
  await page.route(`${BUCKET}/**`, (route) => route.fulfill({ status: 200, body: '', headers: { ETag: '"e2e"' } }))
  await page.route('**/functions/v1/asset-url', async (route) => {
    const body = route.request().postDataJSON() as { op: string; fileName?: string; objectKey?: string; folderId?: string }
    // Keyed as the real function keys it — tenant / client / folder — or the database refuses the row.
    const keyIn = async (folderId: string, name: string) => {
      const [f] = await rows<{ tenant_id: string; client_id: string }>('asset_folders', `select=tenant_id,client_id&id=eq.${folderId}`)
      return `${f!.tenant_id}/${f!.client_id}/${folderId}/${Date.now()}-${name}`
    }
    if (body.op === 'upload') {
      if (body.fileName?.startsWith('stops')) return route.fulfill({ status: 500, json: { error: { code: 'boom', message: 'stand-in refusal' } } })
      const objectKey = await keyIn(body.folderId!, body.fileName ?? 'file')
      return route.fulfill({ json: { uploadUrl: `${BUCKET}/put/${objectKey}`, objectKey, provider: 'b2' } })
    }
    if (body.op === 'thumb_upload') return route.fulfill({ json: { uploadUrl: `${BUCKET}/put/${body.objectKey}.thumb.webp`, thumbObjectKey: `${body.objectKey}.thumb.webp` } })
    if (body.op === 'copy') return route.fulfill({ json: { objectKey: await keyIn(body.folderId!, 'copy'), thumbObjectKey: null } })
    return route.fulfill({ json: { url: `${BUCKET}/get/x`, downloadUrl: `${BUCKET}/get/x` } })
  })
}

async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag), viewport: { width: 1440, height: 1050 } })
  const page = await ctx.newPage()
  await mockBucket(page)
  return page
}

// The bare seed's client and its brand (supabase/seed.sql); its brand folder and Logos / Fonts are provisioned by trigger.
async function northwind() {
  const [client] = await rows<{ id: string }>('clients', 'select=id&name=eq.Northwind%20Beverages')
  const [brand] = await rows<{ id: string }>('asset_folders', `select=id&client_id=eq.${client!.id}&kind=eq.brand&name=eq.Northwind`)
  return { clientId: client!.id, brandId: brand!.id }
}

/** A made folder under the brand, through the screen; its id read back. */
async function makeFolder(page: Page, clientId: string, brandId: string, name: string): Promise<string> {
  await page.goto(`/library?client=${clientId}&folder=${brandId}`)
  await page.getByTestId('library-new-folder').click()
  await page.getByTestId('library-new-folder-name').fill(name)
  await page.getByTestId('library-new-folder-add').click()
  await expect.poll(async () => (await rows('asset_folders', `select=id&parent_id=eq.${brandId}&name=eq.${encodeURIComponent(name)}`)).length).toBe(1)
  const [f] = await rows<{ id: string }>('asset_folders', `select=id&parent_id=eq.${brandId}&name=eq.${encodeURIComponent(name)}`)
  return f!.id
}

const live = (folderId: string) => rows<{ id: string; name: string; current_version: number }>('assets', `select=id,name,current_version&folder_id=eq.${folderId}&deleted_at=is.null&order=name`)

test.describe('Coverage — the Library (I72)', () => {
  test('client view, a brand, a made folder renamed, moved and deleted; Recently deleted opens', async ({ browser }) => {
    const am = await as(browser, 'am')
    const { clientId, brandId } = await northwind()
    await am.goto(`/library?client=${clientId}`)
    await am.getByTestId(`library-brand-${brandId}`).click()
    await expect(am).toHaveURL(new RegExp(`folder=${brandId}`))

    const id = await makeFolder(am, clientId, brandId, `Cov folder ${stamp}`)
    await expect(am.getByTestId(`library-folder-${id}`)).toBeVisible()
    // Rename (ADR-0134 d.20) — the reach rule.
    await am.getByTestId(`folder-menu-${id}`).click()
    await am.getByTestId(`folder-rename-${id}`).click()
    await am.getByTestId('library-folder-rename-input').fill(`Cov renamed ${stamp}`)
    await am.getByTestId('library-folder-rename').getByRole('button', { name: 'Rename' }).click()
    await expect.poll(async () => (await rows<{ name: string }>('asset_folders', `select=name&id=eq.${id}`))[0]?.name).toBe(`Cov renamed ${stamp}`)
    // Open it by its card; it is empty, so it can be deleted (d.20).
    await am.getByTestId(`library-folder-${id}`).click()
    await expect(am).toHaveURL(new RegExp(`folder=${id}`))
    await am.goto(`/library?client=${clientId}&folder=${brandId}`)
    await am.getByTestId(`folder-menu-${id}`).click()
    await am.getByTestId(`folder-delete-${id}`).click()
    await am.getByTestId('library-folder-delete-confirm').click()
    await expect.poll(async () => (await rows('asset_folders', `select=id&id=eq.${id}`)).length).toBe(0)

    await am.goto(`/library?client=${clientId}`)
    await am.getByTestId('library-deleted-open').click()
    await expect(am).toHaveURL(/view=deleted/)
    await am.context().close()
  })

  test('uploads: a name clash made the next version, then kept as a new file; a refused file waits in the corner box', async ({ browser }) => {
    const am = await as(browser, 'am')
    const { clientId, brandId } = await northwind()
    const folder = await makeFolder(am, clientId, brandId, `Cov uploads ${stamp}`)
    await am.goto(`/library?client=${clientId}&folder=${folder}`)
    const pick = async (files: { name: string; body: string }[]) => {
      const chooser = am.waitForEvent('filechooser')
      await am.getByTestId('library-upload').click()
      await (await chooser).setFiles(files.map((f) => ({ name: f.name, mimeType: 'image/svg+xml', buffer: Buffer.from(f.body) })))
    }
    await pick([{ name: 'logo.svg', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' }])
    await expect.poll(async () => (await live(folder)).length).toBe(1)
    await am.getByTestId('upload-box-done').click()

    // The same name again: the box asks (d.12). Make it the next version.
    await pick([{ name: 'logo.svg', body: '<svg xmlns="http://www.w3.org/2000/svg" width="2"/>' }])
    const clashRow = am.locator('[data-testid^="upload-row-"][data-testid$="-make-version"]')
    await expect(clashRow).toBeVisible()
    const rowId = (await clashRow.getAttribute('data-testid'))!.replace(/^upload-row-/, '').replace(/-make-version$/, '')
    await am.getByTestId(`upload-row-${rowId}-make-version`).click()
    await expect.poll(async () => (await live(folder)).find((a) => a.name === 'logo.svg')?.current_version).toBe(2)
    await am.getByTestId('upload-box-done').click()

    // Change (LB-05): a file not yet sent goes to another folder, asked afresh there — Fonts has no logo.svg.
    const { brandId: brand } = await northwind()
    const [fonts] = await rows<{ id: string }>('asset_folders', `select=id&parent_id=eq.${brand}&name=eq.Fonts`)
    await pick([{ name: 'logo.svg', body: '<svg xmlns="http://www.w3.org/2000/svg" width="9"/>' }])
    await expect(am.locator('[data-testid^="upload-row-"][data-testid$="-make-version"]')).toBeVisible()
    await am.getByTestId('upload-box-change').click()
    await am.getByTestId('upload-box-search').fill('Fonts')
    await am.getByTestId(`upload-box-target-${fonts!.id}`).click()
    await am.getByTestId('upload-box-change-confirm').click()
    await expect(am.getByTestId('upload-box-into')).toContainText('Fonts')
    await expect.poll(async () => (await live(fonts!.id)).map((a) => a.name)).toContain('logo.svg')
    await am.getByTestId('upload-box-done').click()

    // And again: keep both — a new file beside it.
    await pick([{ name: 'logo.svg', body: '<svg xmlns="http://www.w3.org/2000/svg" width="3"/>' }])
    const keep = am.locator('[data-testid^="upload-row-"][data-testid$="-keep-both"]')
    await expect(keep).toBeVisible()
    const keepId = (await keep.getAttribute('data-testid'))!.replace(/^upload-row-/, '').replace(/-keep-both$/, '')
    await am.getByTestId(`upload-row-${keepId}-keep-both`).click()
    await expect.poll(async () => (await live(folder)).map((a) => a.name)).toContain('logo (2).svg')
    await am.getByTestId('upload-box-done').click()

    // A refused upload stays in the corner box after the box closes; it folds and reopens the box.
    await pick([{ name: 'stops.svg', body: '<svg/>' }])
    await am.getByTestId('upload-box-done').click()
    await expect(am.getByTestId('upload-tray')).toBeVisible()
    await am.getByTestId('upload-tray-fold').click()
    await expect(am.getByTestId('upload-tray-fold')).toHaveAttribute('aria-expanded', 'false')
    await am.getByTestId('upload-tray-open').click()
    await expect(am.locator('.modal').filter({ hasText: /stops\.svg/ })).toBeVisible()
    await am.getByTestId('upload-box-cancel-rest').click()
    await am.context().close()
  })

  test('the file menu: a new version from the history panel, preview, move by search, delete and bring back; past fifty files', async ({ browser }) => {
    const am = await as(browser, 'am')
    const { clientId, brandId } = await northwind()
    const folder = await makeFolder(am, clientId, brandId, `Cov menu ${stamp}`)
    await am.goto(`/library?client=${clientId}&folder=${folder}`)
    const chooser = am.waitForEvent('filechooser')
    await am.getByTestId('library-upload').click()
    await (await chooser).setFiles({ name: 'brand.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 e2e') })
    await expect.poll(async () => (await live(folder)).length).toBe(1)
    await am.getByTestId('upload-box-done').click()
    const [file] = await live(folder)

    // History → Upload a new version (d.7): whatever is picked becomes v2 of this file, its name kept.
    await am.getByTestId(`asset-menu-${file!.id}`).click()
    await am.getByTestId(`file-versions-${file!.id}`).click()
    const vChooser = am.waitForEvent('filechooser')
    await am.getByTestId('library-versions-upload').click()
    await (await vChooser).setFiles({ name: 'brand-FINAL.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 v2') })
    await expect.poll(async () => (await live(folder))[0]?.current_version).toBe(2)
    await expect.poll(async () => (await live(folder))[0]?.name).toBe('brand.pdf')
    await am.getByTestId('upload-box-done').click()

    // Preview opens and offers Download.
    await am.reload()
    await am.getByTestId(`asset-menu-${file!.id}`).click()
    await am.getByTestId(`file-preview-${file!.id}`).click()
    const popup = am.context().waitForEvent('page', { timeout: 10_000 })
    await am.getByTestId('library-preview-download').click()
    await (await popup).close()
    await am.keyboard.press('Escape')

    // Move to… found by searching the client's folders (d.10).
    const [fonts] = await rows<{ id: string }>('asset_folders', `select=id&parent_id=eq.${brandId}&name=eq.Fonts`)
    await am.getByTestId(`asset-menu-${file!.id}`).click()
    await am.getByTestId(`file-move-${file!.id}`).click()
    await am.getByTestId('library-move-search').fill('Fonts')
    await am.getByTestId(`library-move-target-${fonts!.id}`).click()
    await am.getByTestId('library-move-confirm').click()
    await expect.poll(async () => (await rows<{ folder_id: string }>('assets', `select=folder_id&id=eq.${file!.id}`))[0]?.folder_id).toBe(fonts!.id)

    // Delete it, then bring it back from the client's Recently deleted (d.9).
    await am.goto(`/library?client=${clientId}&folder=${fonts!.id}&file=${file!.id}`)
    await am.getByTestId(`asset-menu-${file!.id}`).click()
    await am.getByTestId(`file-delete-${file!.id}`).click()
    await am.getByTestId('library-delete-confirm').click()
    await expect.poll(async () => (await rows<{ deleted_at: string | null }>('assets', `select=deleted_at&id=eq.${file!.id}`))[0]?.deleted_at).not.toBeNull()
    await am.goto(`/library?client=${clientId}&view=deleted`)
    await am.getByTestId(`deleted-restore-${file!.id}`).click()
    await expect.poll(async () => (await rows<{ deleted_at: string | null }>('assets', `select=deleted_at&id=eq.${file!.id}`))[0]?.deleted_at).toBeNull()

    // Past fifty files the list stops and offers the rest (links need no storage — d.16).
    for (let i = 0; i < 51; i++) {
      const res = await am.evaluate(async ({ folder, i, anon }) => {
        const raw = localStorage.getItem('sb-127-auth-token')
        const token = raw ? (JSON.parse(raw) as { access_token: string }).access_token : ''
        return (await fetch('http://127.0.0.1:54321/rest/v1/rpc/library_add_link', {
          method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}`, apikey: anon },
          body: JSON.stringify({ p_folder: folder, p_name: `Cov link ${String(i).padStart(2, '0')}`, p_url: 'https://drive.google.com/x', p_expires_on: null }),
        })).status
      }, { folder, i, anon: ANON })
      expect(res).toBeLessThan(300)
    }
    await am.goto(`/library?client=${clientId}&folder=${folder}`)
    await am.getByTestId('library-more-files').click()
    await expect(am.getByTestId('library-assets').locator('tbody tr')).toHaveCount(51)
    await am.context().close()
  })

  test('a project, its pieces grouped, and search with its filters opening the file', async ({ browser }) => {
    const am = await as(browser, 'am')
    const { clientId } = await northwind()
    // The seed's running campaign (supabase/seed.sql); its folder and Deliverables are provisioned by trigger.
    const [s2] = await rows<{ id: string; campaign_id: string }>('asset_folders', `select=id,campaign_id&client_id=eq.${clientId}&kind=eq.campaign&name=eq.Northwind%20Summer%20Launch`)
    const [deliverables] = await rows<{ id: string }>('asset_folders', `select=id&parent_id=eq.${s2!.id}&name=eq.Deliverables`)
    await am.goto(`/library?client=${clientId}`)
    await am.getByTestId(`library-project-open-${s2!.id}`).click()
    await expect(am.getByTestId('library-open-campaign')).toHaveAttribute('href', `/campaigns/${s2!.campaign_id}`)
    await am.getByTestId(`library-folder-${deliverables!.id}`).click()
    for (const g of ['workstream', 'type', 'latest', 'piece']) {
      await am.getByTestId(`library-pieces-${g}`).click()
      await expect(am.getByTestId(`library-pieces-${g}`)).toHaveAttribute('aria-selected', 'true')
    }

    // Search everything (d.27): a link made here is found under Links, for this client, and opens its folder.
    const { brandId } = await northwind()
    const folder = await makeFolder(am, clientId, brandId, `Cov search ${stamp}`)
    await am.goto(`/library?client=${clientId}&folder=${folder}`)
    await am.getByTestId('library-add-link').click()
    await am.getByTestId('library-link-name').fill(`Cov findable ${stamp}`)
    await am.getByTestId('library-link-url').fill('https://www.dropbox.com/s/e2e')
    await am.getByTestId('library-link-save').click()
    await expect.poll(async () => (await live(folder)).length).toBe(1)
    const [link] = await live(folder)
    await am.goto('/library')
    await am.getByTestId('library-search-open').click()
    await am.getByTestId('library-search-input').fill(`findable ${stamp}`)
    await am.getByTestId('library-search-kind-link').click()
    await am.getByTestId('library-search-client').selectOption(clientId)
    // ↓ from the keyboard (it gives way to "Open folder" only under the pointer): a link opens its address.
    const tab = am.context().waitForEvent('page', { timeout: 10_000 })
    await am.getByTestId(`search-download-${link!.id}`).focus()
    await am.keyboard.press('Enter')
    expect((await tab).url()).toContain('dropbox.com')
    await am.getByTestId(`search-hit-${link!.id}`).click()
    await expect(am).toHaveURL(new RegExp(`folder=${folder}&file=${link!.id}`))
    await expect(am.getByTestId(`asset-${link!.id}`)).toHaveClass(/is-picked/)
    await am.context().close()
  })

  test('the campaign wizard’s brand documents: into a brand folder and back by its breadcrumb (the shared FolderPicker)', async ({ browser }) => {
    const am = await as(browser, 'am')
    const { brandId } = await northwind()
    const [logos] = await rows<{ id: string }>('asset_folders', `select=id&parent_id=eq.${brandId}&name=eq.Logos`)
    await am.goto('/campaigns/new')
    await am.getByTestId('wizard-client').selectOption({ label: 'Northwind Beverages' })
    await am.getByTestId('wizard-brand').selectOption({ label: 'Northwind' })
    await am.getByTestId(`brand-filing-picker-open-${logos!.id}`).click()
    await expect(am.getByTestId('brand-filing-picker-breadcrumb')).toContainText('Logos')
    await am.getByTestId(`brand-filing-picker-crumb-${brandId}`).click()
    await expect(am.getByTestId('brand-filing-picker-breadcrumb')).not.toContainText('Logos')
    await am.context().close()
  })
})
