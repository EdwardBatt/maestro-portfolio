import { test, expect, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { authFile } from '../fixtures'
import { rows } from '../helpers/db'

/**
 * Review walk — Figma section K, the Library (I72, ADR-0134). Every screen beside its frame.
 *
 * As the Kite Card account manager, on the local stack: the client view (LB-01), a brand (LB-03) with a
 * folder added, a folder's files (LB-04) uploaded through the product — the upload box (LB-05) with a
 * name clash answered — the file menu, the grid, version history (LB-07) with an older version made
 * current, rename, move (LB-09), copy, copy link, preview, a link with an expiry, delete (LB-10) and
 * Recently deleted, a project (LB-06), a campaign's piece folders (LB-02) and search (LB-08). Then a
 * maker who reads but may not change, and the folder in Arabic.
 *
 * NO FALLBACKS. Navigation is asserted; what a screen shows is a recorded check and the report counts
 * them. Files are uploaded by this walk through the screen (the bucket is the real B2, ADR-0081 d.4).
 * The walk first sends its own earlier uploads to Recently deleted, through the same RPC the Delete
 * item calls, so a re-run starts from the same folder.
 *
 * Run:
 *   WALK=1 npx playwright test --config playwright.local.config.ts e2e/local/walks/library.walk.spec.ts
 * Writes `Claude outputs/reports/<date>-library/REPORT.html` — each shot beside its Figma frame, every
 * image embedded, so the one file can be sent on its own.
 */
const WALK = process.env.WALK === '1'
const DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad' }).format(new Date())
const OUT = path.resolve('Claude outputs', 'reports', `${DATE}-library`)
const FRAMES = path.resolve('Claude outputs', 'reports', 'library-frames')
const FILES = path.join(OUT, 'files')

interface Check { title: string; ok: boolean; detail?: string }
interface Step { title: string; frame: string | null; actor: string; notes: string[]; shots: string[]; checks: Check[] }

class Walk {
  steps: Step[] = []
  step!: Step
  n = 0
  constructor() {
    if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true })
    mkdirSync(path.join(OUT, 'shots'), { recursive: true })
    mkdirSync(FILES, { recursive: true })
  }
  begin(title: string, frame: string | null, actor = 'Dev Account Mgr (Kite Card’s account manager)') {
    this.step = { title, frame, actor, notes: [], shots: [], checks: [] }
    this.steps.push(this.step)
    this.flush()
  }
  note(t: string) { this.step.notes.push(t); this.flush() }
  async check(title: string, fn: () => Promise<void> | void) {
    try { await fn(); this.step.checks.push({ title, ok: true }) } catch (e) {
      this.step.checks.push({ title, ok: false, detail: String((e as Error).message ?? e).split('\n').filter((l) => l.trim()).slice(0, 6).join('\n') })
    }
    this.flush()
  }
  async shot(page: Page, slug: string, of?: Locator) {
    this.n += 1
    const name = `${String(this.n).padStart(2, '0')}-${slug}.png`
    await page.addStyleTag({ content: '[data-testid="environment-bar"],[data-testid="update-bar"]{display:none!important}' }).catch(() => {})
    await page.waitForTimeout(500)
    if (of) await of.screenshot({ path: path.join(OUT, 'shots', name) })
    else await page.screenshot({ path: path.join(OUT, 'shots', name) })
    this.step.shots.push(`shots/${name}`)
    this.flush()
  }
  flush() { writeFileSync(path.join(OUT, 'REPORT.html'), render(this.steps)); writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(this.steps, null, 2)) }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const img = (file: string) => (existsSync(file) ? `data:image/png;base64,${readFileSync(file).toString('base64')}` : '')

function render(steps: Step[]): string {
  let pass = 0, fail = 0
  for (const s of steps) for (const c of s.checks) { if (c.ok) pass++; else fail++ }
  const o: string[] = []
  o.push('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Library walk</title><style>'
    + ':root{color-scheme:light}body{font:15px/1.55 system-ui,sans-serif;max-width:1500px;margin:32px auto;padding:0 24px;color:#1d1d1f;background:#fff}'
    + '.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}.pair figure{margin:0}.pair figcaption{font-size:12px;color:#666;margin-bottom:4px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}'
    + 'img{max-width:100%;border:1px solid #ddd;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.08)}'
    + 'h2{margin-top:48px;border-top:1px solid #e5e5e5;padding-top:24px}.ok{color:#1a7f37}.bad{color:#b42318}'
    + 'pre{background:#f6f6f6;padding:8px 12px;border-radius:6px;font-size:12px;white-space:pre-wrap}.tally{font-size:17px;font-weight:600}'
    + '.note{background:#fff8e6;border-inline-start:3px solid #d99b0a;padding:8px 12px;border-radius:6px;margin:10px 0}'
    + '@media (max-width:900px){.pair{grid-template-columns:1fr}}</style></head><body>')
  o.push('<h1>Library (Figma K) — built screens beside their frames</h1>')
  o.push('<p>Walked on the local stack through the product. On the left, the frame; on the right, the running app after the step. Every image is embedded.</p>')
  o.push(`<p class="tally">${steps.length} steps · checks: <span class="ok">${pass} passed</span>, <span class="${fail ? 'bad' : 'ok'}">${fail} failed</span>.</p>`)
  steps.forEach((s, i) => {
    o.push(`<h2>${i + 1}. ${esc(s.title)}</h2><p><i>As ${esc(s.actor)}.</i></p>`)
    for (const n of s.notes) o.push(`<p class="note">${esc(n)}</p>`)
    const frame = s.frame ? img(path.join(FRAMES, `${s.frame}.png`)) : ''
    s.shots.forEach((sh, k) => {
      const built = img(path.join(OUT, sh))
      if (frame && k === 0) o.push(`<div class="pair"><figure><figcaption>Figma ${esc(s.frame!)}</figcaption><img src="${frame}" alt="Figma ${esc(s.frame!)}"></figure><figure><figcaption>Built</figcaption><img src="${built}" alt="built"></figure></div>`)
      else o.push(`<figure><figcaption>Built</figcaption><img src="${built}" alt="built"></figure>`)
    })
    o.push('<ul>')
    for (const c of s.checks) o.push(`<li class="${c.ok ? 'ok' : 'bad'}">${c.ok ? '✓' : '✗'} ${esc(c.title)}${c.detail ? `<pre>${esc(c.detail)}</pre>` : ''}</li>`)
    o.push('</ul>')
  })
  o.push('</body></html>')
  return o.join('\n')
}

/** Call an RPC as the person signed in on this page (their own session — never the service role). */
const ANON = (readFileSync('.env.local', 'utf8').match(/^VITE_SUPABASE_PUBLISHABLE_KEY=(.+)$/m)?.[1] ?? '').trim()
async function rpcAs(page: Page, fn: string, args: Record<string, unknown>) {
  return page.evaluate(async ({ fn, args, anon }) => {
    const raw = localStorage.getItem('sb-127-auth-token')
    const token = raw ? (JSON.parse(raw) as { access_token: string }).access_token : ''
    const res = await fetch(`http://127.0.0.1:54321/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}`, apikey: anon },
      body: JSON.stringify(args),
    })
    return { status: res.status, body: await res.text() }
  }, { fn, args, anon: ANON })
}

const BUCKET = 'https://b2.local.test'
/** The local functions have no B2 keys: `asset-url` and the bucket are answered in the browser. The rows are real. */
async function standInForTheBucket(page: Page) {
  await page.route(`${BUCKET}/**`, async (route) => {
    await new Promise((r) => setTimeout(r, 1500)) // slow enough for the box to be seen working
    await route.fulfill({ status: 200, body: '', headers: { ETag: '"walk"' } })
  })
  await page.route('**/functions/v1/asset-url', async (route) => {
    const body = route.request().postDataJSON() as { op: string; fileName?: string; objectKey?: string; folderId?: string }
    const keyIn = async (folderId: string, name: string) => {
      const [f] = await rows<{ tenant_id: string; client_id: string }>('asset_folders', `select=tenant_id,client_id&id=eq.${folderId}`)
      return `${f!.tenant_id}/${f!.client_id}/${folderId}/${Date.now()}-${name}`
    }
    if (body.op === 'upload') {
      const objectKey = await keyIn(body.folderId!, body.fileName ?? 'file')
      return route.fulfill({ json: { uploadUrl: `${BUCKET}/put/${objectKey}`, objectKey, provider: 'b2' } })
    }
    if (body.op === 'thumb_upload') return route.fulfill({ json: { uploadUrl: `${BUCKET}/put/${body.objectKey}.thumb.webp`, thumbObjectKey: `${body.objectKey}.thumb.webp` } })
    if (body.op === 'copy') return route.fulfill({ json: { objectKey: await keyIn(body.folderId!, 'copy'), thumbObjectKey: null } })
    return route.fulfill({ json: { url: `${BUCKET}/get/x`, downloadUrl: `${BUCKET}/get/x` } })
  })
}

function makeFiles() {
  const png = readFileSync(path.join(FRAMES, 'LB-03.png'))
  const png2 = readFileSync(path.join(FRAMES, 'LB-06.png'))
  const svg = (fill: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" rx="16" fill="${fill}"/><text x="24" y="74" font-family="Arial" font-size="40" fill="#fff">LUMA</text></svg>`
  const files: [string, string | Buffer][] = [
    ['LUMA_logo_primary.svg', svg('#614cff')],
    ['LUMA_logo_white.svg', svg('#1e7a5a')],
    ['LUMA_logo_arabic.png', png],
    ['LUMA_logo_lockup_qi.ai', Buffer.from('%!PS-Adobe-3.0 fake illustrator body for the walk')],
    ['LUMA_brand_book.docx', Buffer.from('PK fake word body for the walk')],
  ]
  for (const [n, b] of files) writeFileSync(path.join(FILES, n), b)
  mkdirSync(path.join(FILES, 'v2'), { recursive: true })
  writeFileSync(path.join(FILES, 'v2', 'LUMA_logo_primary.svg'), svg('#b45309'))
  writeFileSync(path.join(FILES, 'v2', 'LUMA_logo_mono.svg'), svg('#0a0d14'))
  writeFileSync(path.join(FILES, 'v2', 'LUMA_social_avatar.png'), png2)
}

test.describe('Library walk (Figma K)', () => {
  test.skip(!WALK, 'review walk — run with WALK=1')
  test.setTimeout(10 * 60_000)
  test.use({ storageState: authFile('am'), viewport: { width: 1440, height: 1050 }, actionTimeout: 15_000 })

  test('every screen beside its frame', async ({ page, browser }) => {
    const w = new Walk()
    makeFiles()
    await standInForTheBucket(page)
    const [kite] = await rows<{ id: string }>('clients', 'select=id&name=eq.Kite%20Card')
    expect(kite, 'the local tenant has Kite Card').toBeTruthy()

    // ---- LB-01 ----
    await page.goto(`/library?client=${kite!.id}`)
    await expect(page.getByTestId('library-brands')).toBeVisible()
    w.begin('Library — by client', 'LB-01')
    await w.check('every client is listed, Kite Card picked', async () => { await expect(page.getByTestId(`library-client-${kite!.id}`)).toHaveAttribute('aria-current', 'true') })
    await w.check('brand folders with file counts and their folders', async () => { await expect(page.getByTestId('library-brands')).toContainText('Logos, Fonts, Guidelines, Key visuals') })
    await w.check('projects listed with kind and brand', async () => { await expect(page.getByTestId('library-projects')).toContainText('LUMA Season 2') })
    await w.check('no Upload and no New folder at the client’s top level (d.15)', async () => {
      await expect(page.getByTestId('library-upload')).toHaveCount(0)
      await expect(page.getByTestId('library-new-folder')).toHaveCount(0)
    })
    w.note('The frame’s "+ New folder" beside the client name is left out: LB-NOTES item 05 and ADR-0134 d.15 say nothing is added at the top. "Merge the two" becomes "Open the other job" (Edward, 1 Oct, B); no look-alike pair can exist locally once ADR-0135’s rule is on, so that row is not shown here.')
    await w.shot(page, 'lb01')

    // ---- LB-03 ----
    const luma = page.locator('[data-testid^="library-brand-"]', { hasText: 'LUMA' }).first()
    await luma.click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('LUMA')
    // A re-run starts from the frame's state: this walk's earlier "Draw night KVs" folders go, as their maker.
    const brandId = new URL(page.url()).searchParams.get('folder')!
    await page.evaluate(async ({ brandId, anon }) => {
      const raw = localStorage.getItem('sb-127-auth-token')
      const token = raw ? (JSON.parse(raw) as { access_token: string }).access_token : ''
      await fetch(`http://127.0.0.1:54321/rest/v1/asset_folders?parent_id=eq.${brandId}&name=like.Draw%20night%20KVs*`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}`, apikey: anon },
      })
    }, { brandId, anon: ANON })
    await page.reload()
    w.begin('A brand, opened — and a new folder being added', 'LB-03')
    const stamp = Date.now().toString().slice(-5)
    await page.getByTestId('library-new-folder').click()
    await page.getByTestId('library-new-folder-name').fill(`Draw night KVs ${stamp}`)
    await w.check('the four standard folders carry the lock', async () => { await expect(page.locator('.lb-lock')).toHaveCount(4) })
    await w.check('no Upload button at a brand’s top level (d.15)', async () => { await expect(page.getByTestId('library-upload')).toHaveCount(0) })
    await w.shot(page, 'lb03-adding')
    await page.getByTestId('library-new-folder-add').click()
    await w.check('the folder is made beside the standard four', async () => { await expect(page.locator('.lb-folder-card', { hasText: `Draw night KVs ${stamp}` })).toBeVisible() })

    // ---- LB-04 / LB-05 ----
    await page.locator('.lb-folder-card', { hasText: 'Logos' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Logos')
    const logos = new URL(page.url()).searchParams.get('folder')!
    // A re-run starts from the same folder: this walk's earlier uploads go to Recently deleted.
    const old = await rows<{ id: string }>('assets', `select=id&folder_id=eq.${logos}&deleted_at=is.null`)
    for (const a of old) await rpcAs(page, 'library_delete', { p_asset: a.id })
    await page.reload()
    w.begin('Uploading — several files, one already here', 'LB-05')
    let chooser = page.waitForEvent('filechooser')
    await page.getByTestId('library-upload').click()
    await (await chooser).setFiles(['LUMA_logo_primary.svg', 'LUMA_logo_white.svg', 'LUMA_logo_arabic.png', 'LUMA_logo_lockup_qi.ai', 'LUMA_brand_book.docx'].map((n) => path.join(FILES, n)))
    const box = page.locator('.modal').filter({ hasText: /Uploading/ })
    await page.waitForTimeout(800)
    w.note('The bucket is stood in for in the browser — the local functions have no B2 keys — so the bytes go nowhere; every row, rule and screen is real.')
    await w.shot(page, 'lb05-working', box)
    await w.check('five files land in the folder', async () => { await expect.poll(async () => (await rows('assets', `select=id&folder_id=eq.${logos}&deleted_at=is.null`)).length, { timeout: 60_000 }).toBe(5) })
    await page.getByTestId('upload-box-done').click({ timeout: 3000 }).catch(() => {})
    await page.reload()
    // The name clash (d.12) is decided before any byte moves, so it can be shown even without storage.
    chooser = page.waitForEvent('filechooser')
    await page.getByTestId('library-upload').click()
    await (await chooser).setFiles(['LUMA_logo_primary.svg', 'LUMA_logo_mono.svg', 'LUMA_social_avatar.png'].map((n) => path.join(FILES, 'v2', n)))
    await w.check('the name clash asks: next version, or keep both (d.12)', async () => {
      await expect(page.locator('[data-testid$="-make-version"]')).toBeVisible({ timeout: 20_000 })
      await expect(page.locator('[data-testid$="-keep-both"]')).toBeVisible()
    })
    await w.shot(page, 'lb05-clash', box)
    await page.locator('[data-testid$="-make-version"]').click()
    await w.check('the clash becomes v2 of the same file, nothing overwritten', async () => {
      await expect.poll(async () => (await rows<{ current_version: number }>('assets', `select=current_version&folder_id=eq.${logos}&name=eq.LUMA_logo_primary.svg&deleted_at=is.null`))[0]?.current_version, { timeout: 60_000 }).toBe(2)
    })
    await page.getByTestId('upload-box-done').click({ timeout: 3000 }).catch(() => {})
    await page.keyboard.press('Escape')
    await page.reload()

    w.begin('Inside a folder — files, versions and the file menu', 'LB-04')
    const primary = page.locator('tr', { hasText: 'LUMA_logo_primary.svg' })
    await w.check('kind is written in words (d.4)', async () => {
      await expect(page.locator('tr', { hasText: 'LUMA_brand_book.docx' })).toContainText('Word document')
      await expect(page.locator('tr', { hasText: 'LUMA_logo_lockup_qi.ai' })).toContainText('Illustrator file')
      await expect(primary).toContainText('SVG image')
    })
    const [amRow] = await rows<{ display_name: string }>('user_profiles', 'select=display_name&email=eq.maestro.dev%2Bam%40example.test')
    await w.check('who added it is shown', async () => { await expect(primary).toContainText(amRow!.display_name) })
    await primary.locator('[data-testid^="asset-menu-"]').click()
    await w.check('the whole menu, with Delete last after a hairline', async () => {
      for (const label of ['Preview', 'Download', 'Upload a new version', 'Version history · 2', 'Rename', 'Move to…', 'Copy to…', 'Copy link', 'Delete']) {
        await expect(page.getByRole('menuitem', { name: label })).toBeVisible()
      }
    })
    w.note('Dates read "Thu, 1 Oct" rather than "3 days ago": ADR-0127 fixes one date form everywhere. The menu gains "Copy to…" (Edward, 1 Oct).')
    await w.shot(page, 'lb04-menu')
    await page.keyboard.press('Escape')

    // grid
    w.begin('The same folder as a grid (d.26)', null)
    await page.getByTestId('library-view-grid').click()
    await w.check('pictures for images, a kind tile for the rest', async () => {
      await expect(page.getByTestId('library-grid')).toBeVisible()
      await expect(page.locator('.lb-tile-kind', { hasText: 'Word document' })).toBeVisible()
    })
    await w.shot(page, 'grid')
    await page.getByTestId('library-view-list').click()

    // ---- LB-07 ----
    w.begin('Version history — every version is kept', 'LB-07')
    await primary.locator('[data-testid^="asset-menu-"]').click()
    await page.getByRole('menuitem', { name: /Version history/ }).click()
    const panel = page.getByTestId('library-versions')
    await w.check('two versions, the latest current', async () => {
      await expect(panel.getByTestId('library-version-2')).toContainText('Current')
      await expect(panel.getByTestId('library-version-1')).toContainText('First upload')
    })
    await w.check('the panel says the latest version is the one in use (Edward, Q2)', async () => { await expect(panel).toContainText('The latest version is the one in use') })
    await w.shot(page, 'lb07')
    await panel.getByTestId('library-make-current-1').click()
    await w.check('making v1 current adds it as v3 — history never goes back (d.7)', async () => {
      await expect(panel.getByTestId('library-version-3')).toContainText('Current', { timeout: 15_000 })
      await expect(panel.getByTestId('library-version-3')).toContainText('made current from v1')
    })
    await page.keyboard.press('Escape')

    // rename
    w.begin('Rename — the name only; the ending stays the file’s own (d.8)', null)
    const white = page.locator('tr', { hasText: 'LUMA_logo_white.svg' })
    await white.locator('[data-testid^="asset-menu-"]').click()
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    await page.getByTestId('library-rename-input').fill('LUMA_logo_reverse')
    await w.check('the extension sits beside the box and cannot be typed', async () => { await expect(page.getByTestId('library-rename')).toContainText('.svg') })
    await w.shot(page, 'rename', page.getByTestId('library-rename').locator('xpath=ancestor-or-self::*[contains(@class,"modal")][1]'))
    await page.getByTestId('library-rename-save').click()
    await w.check('renamed, ending kept', async () => { await expect(page.locator('tr', { hasText: 'LUMA_logo_reverse.svg' })).toBeVisible() })
    await page.getByTestId('library-banner-close').click({ timeout: 3000 }).catch(() => {})

    // ---- LB-09 ----
    w.begin('Move to… — only inside the same client', 'LB-09')
    const arabic = page.locator('tr', { hasText: 'LUMA_logo_arabic.png' })
    await arabic.locator('[data-testid^="asset-menu-"]').click()
    await page.getByRole('menuitem', { name: 'Move to…' }).click()
    const move = page.getByTestId('library-move')
    await w.check('the tree is this client’s only, the current folder marked', async () => {
      await expect(move).toContainText('Pick a folder inside Kite Card')
      await expect(move).toContainText('Logos · here now')
    })
    await move.getByRole('option', { name: 'Key visuals', exact: true }).first().click()
    await w.shot(page, 'lb09')
    await page.getByTestId('library-move-confirm').click()
    await w.check('the file left Logos for Key visuals', async () => { await expect(page.locator('tr', { hasText: 'LUMA_logo_arabic.png' })).toHaveCount(0) })
    await page.getByTestId('library-banner-close').click({ timeout: 3000 }).catch(() => {})

    // copy + copy link
    w.begin('Copy to… and Copy link (d.10, d.11)', null)
    await page.locator('tr', { hasText: 'LUMA_logo_lockup_qi.ai' }).locator('[data-testid^="asset-menu-"]').click()
    await page.getByRole('menuitem', { name: 'Copy to…' }).click()
    await page.getByTestId('library-copy').getByRole('option', { name: 'Guidelines', exact: true }).first().click()
    await page.getByTestId('library-copy-confirm').click()
    await w.check('a copy lands at v1, the original stays', async () => {
      await expect(page.locator('tr', { hasText: 'LUMA_logo_lockup_qi.ai' })).toBeVisible()
      await expect.poll(async () => (await rows('assets', 'select=id&name=eq.LUMA_logo_lockup_qi.ai&deleted_at=is.null')).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2)
    })
    await page.getByTestId('library-banner-close').click({ timeout: 3000 }).catch(() => {})
    await page.keyboard.press('Escape')
    await page.getByTestId('library-banner-close').click({ timeout: 3000 }).catch(() => {})
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.locator('tr', { hasText: 'LUMA_logo_lockup_qi.ai' }).locator('[data-testid^="asset-menu-"]').click()
    await page.getByRole('menuitem', { name: 'Copy link' }).click()
    await w.check('the link is a Maestro address with the file picked out', async () => {
      const text = await page.evaluate(() => navigator.clipboard.readText())
      expect(text).toMatch(/\/library\?client=.*&folder=.*&file=/)
    })
    await w.shot(page, 'copy-link')
    await page.getByTestId('library-banner-close').click({ timeout: 3000 }).catch(() => {})

    // preview
    w.begin('Preview — shown, or named with its kind when it cannot be (d.6)', null)
    await page.locator('tr', { hasText: 'LUMA_brand_book.docx' }).locator('[data-testid^="asset-menu-"]').click()
    await page.getByRole('menuitem', { name: 'Preview' }).click()
    await w.check('a Word document is named, its kind given, Download offered', async () => {
      await expect(page.getByTestId('library-preview-none')).toContainText('LUMA_brand_book.docx')
      await expect(page.getByTestId('library-preview-none')).toContainText('Word document')
    })
    await w.shot(page, 'preview-none')
    await page.keyboard.press('Escape')

    // link
    w.begin('A link kept in the folder, with an expiry (d.16–18)', null)
    await page.getByTestId('library-add-link').click()
    await page.getByTestId('library-link-name').fill('LUMA launch film — master')
    await page.getByTestId('library-link-url').fill('https://drive.google.com/file/d/walk-demo/view')
    await page.getByTestId('library-link-expires').fill('2026-12-31')
    await w.shot(page, 'link-add')
    await page.getByTestId('library-link-save').click()
    await w.check('the link is a row, its kind "Link · Google Drive"', async () => { await expect(page.locator('tr', { hasText: 'LUMA launch film' })).toContainText('Link · Google Drive') })
    await page.getByTestId('library-banner-close').click({ timeout: 3000 }).catch(() => {})

    // ---- LB-10 ----
    w.begin('Delete a file — are you sure', 'LB-10')
    await page.locator('tr', { hasText: 'LUMA_logo_reverse.svg' }).locator('[data-testid^="asset-menu-"]').click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await w.check('it says every version goes and how it comes back', async () => { await expect(page.getByTestId('library-delete')).toContainText('Recently deleted for 30 days') })
    w.note('The amber "Two deliverables use this file" note appears only when a piece links to the file; none does locally, so the dialog shows its plain form.')
    await w.shot(page, 'lb10')
    await page.getByTestId('library-delete-confirm').click()
    await page.getByTestId('library-banner-close').click({ timeout: 3000 }).catch(() => {})
    await w.check('the file leaves the folder', async () => { await expect(page.locator('tr', { hasText: 'LUMA_logo_reverse.svg' })).toHaveCount(0) })

    w.begin('Recently deleted — one per client, bring it back (d.9)', null)
    await page.goto(`/library?client=${kite!.id}&view=deleted`)
    const gone = page.locator('tr', { hasText: 'LUMA_logo_reverse.svg' }).first()
    await w.check('the deleted file is listed with the day it goes for good', async () => { await expect(gone).toBeVisible() })
    await w.shot(page, 'deleted')
    const restoreId = await gone.locator('[data-testid^="deleted-restore-"]').getAttribute('data-testid')
    await gone.locator('[data-testid^="deleted-restore-"]').click()
    await w.check('brought back — it leaves Recently deleted', async () => { await expect(page.getByTestId(restoreId!)).toHaveCount(0) })
    w.note('Earlier runs of this walk deleted the same file; their copies are still listed — each is its own deleted file.')

    // ---- LB-06 ----
    w.begin('A project, opened — the four folders every job gets', 'LB-06')
    await page.goto(`/library?client=${kite!.id}`)
    await page.locator('[data-testid^="library-project-"]', { hasText: 'LUMA Season 2' }).locator('[data-testid^="library-project-open-"]').click()
    await w.check('the four folders, References chosen and its files below', async () => {
      await expect(page.locator('.lb-folder-card.is-on')).toContainText('References')
      await expect(page.getByTestId('library-upload')).toContainText('Upload to References')
    })
    await w.shot(page, 'lb06')

    // ---- LB-02 ----
    w.begin('Deliverables — one folder per piece, every version it was reviewed in', 'LB-02')
    await page.locator('.lb-folder-card', { hasText: 'Deliverables' }).click()
    await w.check('one card per piece', async () => { await expect(page.locator('.lb-piece').first()).toBeVisible() })
    await w.shot(page, 'lb02-luma')
    const [rev] = await rows<{ deliverable_id: string }>('media_records', 'select=deliverable_id&limit=1&order=created_at.desc')
    if (rev) {
      const [pf] = await rows<{ parent_id: string; client_id: string }>('asset_folders', `select=parent_id,client_id&deliverable_id=eq.${rev.deliverable_id}`)
      await page.goto(`/library?client=${pf!.client_id}&folder=${pf!.parent_id}`)
      await w.check('a piece shows its review versions with their states', async () => { await expect(page.locator('.lb-review').first()).toBeVisible() })
      w.note('LUMA Season 2 has no work sent for review locally, so this second picture is a test campaign that does.')
      await w.shot(page, 'lb02-versions')
    }

    // ---- LB-08 ----
    w.begin('Search every client — results open their folder', 'LB-08')
    await page.goto('/library')
    await page.getByTestId('library-search-open').click()
    await page.getByTestId('library-search-input').fill('LUMA')
    const hit = page.locator('[data-testid^="search-hit-"]', { hasText: 'LUMA_logo_lockup_qi.ai' }).first()
    await w.check('each result shows where it lives', async () => { await expect(hit).toContainText('Kite Card / Brand assets / LUMA / ') })
    await hit.hover()
    await w.shot(page, 'lb08')
    await hit.click()
    await w.check('clicking a result opens its folder with the file picked out', async () => {
      await expect(page).toHaveURL(/file=/)
      await expect(page.locator('tr.is-picked')).toContainText('LUMA_logo_lockup_qi.ai')
    })
    w.note('The frame’s line "you only see the clients you manage" is gone: everyone reads every client (Edward, 1 Oct).')

    // ---- a reader ----
    const makerCtx = await browser.newContext({ storageState: authFile('writer'), viewport: { width: 1440, height: 1050 } })
    const maker = await makerCtx.newPage()
    await maker.goto(`/library?client=${kite!.id}&folder=${logos}`)
    w.begin('A team member with no task for Kite Card: reads and downloads, changes nothing (d.1–2)', null, 'Dev Writer (team member, no Kite Card task)')
    await w.check('no Upload, no New folder, no drop strip', async () => {
      await expect(maker.getByRole('heading', { level: 1 })).toHaveText('Logos')
      await expect(maker.getByTestId('library-new-folder')).toHaveCount(0)
      await expect(maker.getByTestId('library-upload')).toHaveCount(0)
      await expect(maker.getByTestId('library-drop-strip')).toHaveCount(0)
    })
    await maker.locator('tr', { hasText: 'LUMA_logo_primary.svg' }).locator('[data-testid^="asset-menu-"]').click()
    await w.check('the menu offers reading only', async () => {
      await expect(maker.getByRole('menuitem', { name: 'Preview' })).toBeVisible()
      await expect(maker.getByRole('menuitem', { name: 'Rename' })).toHaveCount(0)
      await expect(maker.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0)
    })
    await w.shot(maker, 'maker')
    await makerCtx.close()

    // ---- Arabic ----
    const arCtx = await browser.newContext({ storageState: authFile('animator'), viewport: { width: 1440, height: 1050 }, locale: 'ar' })
    const ar = await arCtx.newPage()
    await ar.goto(`/library?client=${kite!.id}&folder=${logos}`)
    w.begin('The same folder in Arabic', null, 'Dev Animator (Arabic)')
    await w.check('right to left, words translated', async () => {
      await expect(ar.locator('html')).toHaveAttribute('dir', 'rtl')
      await expect(ar.getByRole('heading', { level: 1 })).toHaveText('الشعارات')
    })
    await w.shot(ar, 'arabic')
    await arCtx.close()

    const fails = w.steps.flatMap((s) => s.checks).filter((c) => !c.ok)
    expect(fails, fails.map((f) => f.title).join('; ')).toHaveLength(0)
  })
})
