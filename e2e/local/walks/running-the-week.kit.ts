import { expect, type Browser, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { authFile, PEOPLE } from '../fixtures'

/**
 * The kit the "running the week" review walk is built from (I59.30): the report writer, the doors a
 * screen's button calls (as the person pressing it), the service-role doors the walk uses to STAGE
 * the two states no screen can make in a walk's time, and the browser session.
 *
 * Not a spec (no `.spec.ts`), so Playwright never runs it on its own. The shape follows
 * `section-d.walk.spec.ts` — one self-contained HTML file, every screenshot embedded as a data URI,
 * checks recorded rather than thrown, and a table of every check at the top.
 */

export type Tag = keyof typeof PEOPLE

// ------------------------------------------------------------------------------ dates ----

export const iraqDay = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad' }).format(new Date(ms))
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
/** The Sunday a day's week starts on — the team view's and the Schedule's own spine. */
export const sundayOf = (day: string) => addDays(day, -new Date(`${day}T12:00:00Z`).getUTCDay())

// ------------------------------------------------------------------------------ the report ----

export interface Check { title: string; ok: boolean; detail?: string }
export interface Step { n: number; title: string; actor: string; notes: string[]; shots: string[]; checks: Check[] }
export interface Chapter { key: string; title: string; steps: Step[] }
export interface Report { title: string; started: string; story: string[]; chapters: Chapter[] }

const firstLines = (e: unknown) =>
  ((e as Error)?.message ?? String(e)).split('\n').filter((l) => l.trim()).slice(0, 8).join('\n')

export class Walk {
  report: Report
  chapter!: Chapter
  step!: Step
  shots = 0
  readonly reportFile: string

  constructor(readonly out: string, title: string) {
    this.report = { title, started: new Date().toISOString(), story: [], chapters: [] }
    this.reportFile = path.join(out, 'report.json')
    // A fresh report every run: the walk makes its own data, so an older run's pictures describe
    // different work.
    if (existsSync(out)) rmSync(out, { recursive: true, force: true })
    mkdirSync(path.join(out, 'shots'), { recursive: true })
    this.flush()
  }
  story(line: string) { this.report.story.push(line); this.flush() }
  open(key: string, title: string) {
    this.chapter = { key, title, steps: [] }
    this.report.chapters.push(this.chapter)
    this.flush()
  }
  begin(title: string, actor: string) {
    this.step = { n: this.chapter.steps.length + 1, title, actor, notes: [], shots: [], checks: [] }
    this.chapter.steps.push(this.step)
    this.flush()
  }
  note(text: string) { this.step.notes.push(text); this.flush() }
  /** A recorded check: a failure is written down with its reason, and the walk goes on. */
  async check(title: string, fn: () => Promise<unknown> | unknown): Promise<boolean> {
    try {
      await fn()
      this.step.checks.push({ title, ok: true })
      this.flush()
      return true
    } catch (e) {
      this.step.checks.push({ title, ok: false, detail: firstLines(e) })
      this.flush()
      return false
    }
  }
  /**
   * A whole action that must happen for the step to mean anything (open a dialog, press Send). If it
   * cannot be done the step FAILS here, in words, and the walk carries on to the next step — never a
   * silent skip, never a fallback path.
   */
  async act(title: string, fn: () => Promise<unknown> | unknown): Promise<boolean> {
    return this.check(`done: ${title}`, fn)
  }
  /** A picture of the page — or of one element, when `of` is given. A shot that cannot be taken is a failed check. */
  async shot(page: Page, slug: string, opts: { full?: boolean; caption?: string; of?: Locator } = {}) {
    this.shots += 1
    const name = `${String(this.shots).padStart(3, '0')}-${slug}.png`
    try {
      await page.addStyleTag({ content: '[data-testid="environment-bar"]{display:none!important}' }).catch(() => {})
      const full = opts.full
        ? await page.addStyleTag({ content: '.shell{block-size:auto!important;overflow:visible!important}.shell-main{overflow:visible!important}' })
        : null
      await page.waitForTimeout(400)
      const file = path.join(this.out, 'shots', name)
      if (opts.of) await opts.of.screenshot({ path: file })
      else await page.screenshot({ path: file, fullPage: opts.full ?? false })
      if (full) await full.evaluate((el) => (el as Element).remove())
      this.step.shots.push(`shots/${name}${opts.caption ? `|${opts.caption}` : ''}`)
    } catch (e) {
      this.step.checks.push({ title: `screenshot "${slug}" taken`, ok: false, detail: firstLines(e) })
    }
    this.flush()
  }
  failures(): number {
    let n = 0
    for (const c of this.report.chapters) for (const s of c.steps) for (const k of s.checks) if (!k.ok) n++
    return n
  }
  flush() {
    mkdirSync(this.out, { recursive: true })
    writeFileSync(this.reportFile, JSON.stringify(this.report, null, 2))
    writeFileSync(path.join(this.out, 'REPORT.html'), renderHtml(this.report, this.out))
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function renderHtml(r: Report, out: string): string {
  let pass = 0, fail = 0, steps = 0, shots = 0
  for (const c of r.chapters) for (const s of c.steps) {
    steps++
    shots += s.shots.length
    for (const k of s.checks) { if (k.ok) pass++; else fail++ }
  }
  const o: string[] = []
  o.push(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(r.title)}</title>`)
  o.push('<style>:root{color-scheme:light}body{font:15px/1.6 system-ui,sans-serif;max-width:1180px;margin:32px auto;padding:0 24px;color:#1d1d1f;background:#fff}'
    + 'img{max-width:100%;border:1px solid #ddd;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.08);margin:8px 0}'
    + 'figcaption{color:#555;font-style:italic;margin-bottom:24px}'
    + 'h2{margin-top:56px;border-top:1px solid #e5e5e5;padding-top:24px}h3{margin-top:32px}'
    + '.ok{color:#1a7f37}.bad{color:#b42318}pre{background:#f6f6f6;padding:8px 12px;border-radius:6px;font-size:13px;white-space:pre-wrap}'
    + 'nav ol{columns:2}.tally{font-size:17px;font-weight:600}'
    + 'table{border-collapse:collapse;width:100%;font-size:14px;margin:12px 0 24px}th,td{border-bottom:1px solid #eee;padding:6px 8px;text-align:start;vertical-align:top}'
    + 'th{background:#fafafa;position:sticky;top:0}td.r{white-space:nowrap;font-weight:600}'
    + 'details.checks>summary{cursor:pointer;font-weight:600;margin:8px 0}'
    + '.frame{background:#eef4ff;border-inline-start:3px solid #3b6fd8;padding:10px 14px;border-radius:6px;margin:12px 0}'
    + '.staged{background:#fff8e6;border-inline-start:3px solid #d99b0a;padding:10px 14px;border-radius:6px;margin:12px 0}'
    + '@media (max-width:700px){nav ol{columns:1}body{padding:0 16px}table{font-size:13px}}</style></head><body>')
  o.push(`<h1>${esc(r.title)}</h1>`)
  o.push(`<p>Walked ${esc(r.started.slice(0, 16).replace('T', ' '))} UTC on the local stack. Every screenshot is the real state after the step, `
    + 'reached by the person who would reach it; the few states the walk had to stage are marked in amber where they show.</p>')
  for (const line of r.story) o.push(`<p>${esc(line)}</p>`)
  o.push(`<p class="tally">${steps} steps · ${shots} screenshots · checks: <span class="ok">${pass} passed</span>, <span class="${fail ? 'bad' : 'ok'}">${fail} failed</span>.</p>`)
  o.push('<nav><ol>')
  for (const c of r.chapters) o.push(`<li><a href="#${esc(c.key)}">${esc(c.title)}</a></li>`)
  o.push('<li><a href="#checks">Every check</a></li></ol></nav>')

  // Every check in one table — what a reviewer reads first.
  o.push('<details class="checks" id="checks" open><summary>Every check, in order</summary><table><thead><tr><th>Where</th><th>Check</th><th>Result</th></tr></thead><tbody>')
  for (const c of r.chapters) for (const s of c.steps) for (const k of s.checks) {
    o.push(`<tr><td><a href="#${esc(c.key)}-${s.n}">${esc(c.title.split(' · ')[0] ?? c.title)} · ${s.n}</a></td><td>${esc(k.title)}${!k.ok && k.detail ? `<pre>${esc(k.detail)}</pre>` : ''}</td>`
      + `<td class="r ${k.ok ? 'ok' : 'bad'}">${k.ok ? 'pass' : 'FAIL'}</td></tr>`)
  }
  o.push('</tbody></table></details>')

  for (const c of r.chapters) {
    o.push(`<h2 id="${esc(c.key)}">${esc(c.title)}</h2>`)
    for (const s of c.steps) {
      o.push(`<h3 id="${esc(c.key)}-${s.n}">${s.n}. ${esc(s.title)}</h3><p><i>As ${esc(s.actor)}.</i></p>`)
      for (const n of s.notes) {
        if (n.startsWith('FRAME:')) o.push(`<p class="frame">${esc(n.slice(6).trim())}</p>`)
        else if (n.startsWith('STAGED:')) o.push(`<p class="staged">${esc(n.slice(7).trim())}</p>`)
        else o.push(`<p>${esc(n)}</p>`)
      }
      for (const shot of s.shots) {
        const [file, caption] = shot.split('|')
        // Embedded, never linked: the one file is what gets shared.
        const png = path.join(out, file!)
        const src = existsSync(png) ? `data:image/png;base64,${readFileSync(png).toString('base64')}` : file!
        o.push(`<figure><img src="${src}" alt="${esc(caption ?? file!)}" loading="lazy">${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}</figure>`)
      }
      if (s.checks.length) {
        o.push('<ul>')
        for (const k of s.checks) o.push(`<li class="${k.ok ? 'ok' : 'bad'}">${k.ok ? '✅' : '❌'} ${esc(k.title)}${!k.ok && k.detail ? `<pre>${esc(k.detail)}</pre>` : ''}</li>`)
        o.push('</ul>')
      }
    }
  }
  o.push('</body></html>')
  return o.join('\n')
}

// ------------------------------------------------------------------------------ the doors ----

const API = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54321'
if (!/127\.0\.0\.1|localhost/.test(API)) throw new Error('the walk drives a LOCAL Supabase only')
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE_KEY =
  process.env.E2E_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

/** The signed-in person's access token, from the storage state the setup project wrote. */
function tokenOf(tag: Tag): string {
  const state = JSON.parse(readFileSync(authFile(tag), 'utf8')) as { origins: { localStorage: { name: string; value: string }[] }[] }
  for (const o of state.origins) {
    for (const item of o.localStorage) {
      if (item.name.endsWith('-auth-token')) return (JSON.parse(item.value) as { access_token: string }).access_token
    }
  }
  throw new Error(`no token for ${tag}`)
}
const headersOf = (tag: Tag) => ({ apikey: ANON, Authorization: `Bearer ${tokenOf(tag)}`, 'content-type': 'application/json' })

/** An RPC called AS a person — the same door the screen's button uses. Refused = it throws. */
export async function rpcAs<T = unknown>(tag: Tag, fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: headersOf(tag), body: JSON.stringify(args) })
  const body = await res.text()
  expect(res.status, `${fn} as ${tag}: ${body}`).toBeLessThan(300)
  return (body ? JSON.parse(body) : null) as T
}
/** An Edge Function called AS a person (the app's `functions.invoke`). */
export async function fnAs<T = unknown>(tag: Tag, name: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}/functions/v1/${name}`, { method: 'POST', headers: headersOf(tag), body: JSON.stringify(body) })
  const text = await res.text()
  expect(res.status, `${name} as ${tag}: ${text}`).toBeLessThan(300)
  return (text ? JSON.parse(text) : null) as T
}
/** A table write AS a person, under their RLS (the app's `supabase.from(...).insert`). */
export async function insertAs(tag: Tag, table: string, row: Record<string, unknown>) {
  const res = await fetch(`${API}/rest/v1/${table}`, { method: 'POST', headers: { ...headersOf(tag), Prefer: 'return=representation' }, body: JSON.stringify(row) })
  const text = await res.text()
  expect(res.status, `insert ${table} as ${tag}: ${text}`).toBeLessThan(300)
}
/**
 * The scheduled escalation sweep, run once — the job `stall-sweep` runs on its timer, granted to the
 * service role only (ADR-0108). The walk cannot wait for its clock, so it runs it; the report says so.
 */
export async function runEscalationSweep(deliverableId: string): Promise<unknown> {
  // Limited to the walk's own piece (Edward, 25 Sep): one run on the long-lived local database must not
  // escalate — and email — every stale item earlier runs left behind (20260926170000).
  const res = await fetch(`${API}/rest/v1/rpc/run_escalation_sweep_for`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_deliverable: deliverableId }),
  })
  const text = await res.text()
  expect(res.status, `run_escalation_sweep_for: ${text}`).toBeLessThan(300)
  return text ? JSON.parse(text) : null
}

// ------------------------------------------------------------------------------ the file store ----

const here = path.dirname(fileURLToPath(import.meta.url))
export const PNG = readFileSync(path.join(here, '..', 'retest-redesign', 'dummy-artwork.png'))
const BUCKET = 'https://b2.local.test'
/**
 * Stand in for B2 and the presigning functions — the local stack has no bucket (the same stand-in
 * `task-page.spec.ts` uses). The media ROWS are still written by the product's own doors.
 */
export async function mockBucket(page: Page) {
  await page.route(`${BUCKET}/**`, async (route) => {
    if (route.request().method() === 'PUT') return route.fulfill({ status: 200, body: '' })
    if (new URL(route.request().url()).searchParams.get('dl') === '1') {
      return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'content-disposition': 'attachment; filename="file.png"' }, body: PNG })
    }
    return route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
  })
  await page.route('**/functions/v1/review-media', async (route) => {
    const body = route.request().postDataJSON() as { op: string; fileName?: string; mediaRecordId?: string }
    if (body.op === 'upload') {
      const objectKey = `e2e/${Date.now()}-${body.fileName}`
      return route.fulfill({ json: { uploadUrl: `${BUCKET}/put/${objectKey}`, objectKey } })
    }
    return route.fulfill({ json: { viewUrl: `${BUCKET}/get/${body.mediaRecordId}`, downloadUrl: `${BUCKET}/get/${body.mediaRecordId}?dl=1` } })
  })
  await page.route('**/functions/v1/asset-url', async (route) => {
    const body = route.request().postDataJSON() as { op: string; fileName?: string; assetId?: string }
    if (body.op === 'upload') {
      const objectKey = `e2e/${Date.now()}-${body.fileName}`
      return route.fulfill({ json: { uploadUrl: `${BUCKET}/put/${objectKey}`, objectKey, provider: 'b2' } })
    }
    return route.fulfill({ json: { downloadUrl: `${BUCKET}/get/${body.assetId}?dl=1`, url: `${BUCKET}/get/x` } })
  })
}

// ------------------------------------------------------------------------------ the browser ----

export class Session {
  constructor(readonly browser: Browser) {}
  /** A fresh browser signed in as the person, at the guides' size. */
  async as(tag: Tag, viewport = { width: 1440, height: 1000 }): Promise<Page> {
    const ctx = await this.browser.newContext({ storageState: authFile(tag), viewport })
    const page = await ctx.newPage()
    await mockBucket(page)
    return page
  }
  /** Open a page in a language. The toggle is remembered on the profile, so it is set every time. */
  async go(page: Page, url: string, locale: 'en' | 'ar' = 'en') {
    await page.goto(url)
    await page.getByTestId('locale-toggle').first().waitFor({ state: 'visible', timeout: 20_000 })
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(400)
    const want = locale === 'ar' ? 'rtl' : 'ltr'
    if ((await page.locator('html').getAttribute('dir')) !== want) {
      await page.getByTestId('locale-toggle').first().click()
      await expect(page.locator('html')).toHaveAttribute('dir', want)
      await page.waitForTimeout(300)
    }
  }
}

/** A drag the way the team timeline hears it: the bar's dragstart writes the task id, the cell reads it. */
export async function dragOnTeam(page: Page, taskId: string, resourceId: string, isoDate: string) {
  const dt = await page.evaluateHandle(() => new DataTransfer())
  await page.getByTestId(`tv-bar-${taskId}`).dispatchEvent('dragstart', { dataTransfer: dt })
  const cell = page.getByTestId(`tv-cell-${resourceId}-${isoDate}`)
  await cell.dispatchEvent('dragover', { dataTransfer: dt })
  await cell.dispatchEvent('drop', { dataTransfer: dt })
}
/** The same on the Schedule: a booking chip onto a person's day. */
export async function dragOnSchedule(page: Page, bookingId: string, resourceId: string, isoDate: string) {
  const dt = await page.evaluateHandle(() => new DataTransfer())
  await page.getByTestId(`booking-${bookingId}`).dispatchEvent('dragstart', { dataTransfer: dt })
  const cell = page.getByTestId(`cell-${resourceId}-${isoDate}`)
  await cell.dispatchEvent('dragover', { dataTransfer: dt })
  await cell.dispatchEvent('drop', { dataTransfer: dt })
}
