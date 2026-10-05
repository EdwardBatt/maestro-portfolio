import { test, expect, type Browser, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { authFile, PEOPLE } from '../fixtures'
import { rows } from '../helpers/db'
import { clearMailbox } from '../helpers/mailpit'
import { dueInTwoWeeks, nextToReview, pickJobLanguages } from '../helpers/single-job'
import { pieceIds, startCampaign } from '../helpers/campaign-wizard'

/**
 * Review walk — a single job becomes a campaign (rewritten 25 Sep, `I57.31`).
 *
 * Edward, 21 Sep: *"run the step by step flow for creating a single job, convert a single job to a
 * campaign and generate a campaign brief (the existing deliverables should not be changed), add
 * phases to a campaign, add deliverables to a campaign… check all notifications are correctly
 * generated, all my-work pages correctly showing pending approvals… the final report should show
 * screenshots of each step completed"*.
 *
 * The same journey, on the product as it is after section D and ADR-0100: there are no department
 * briefs on a campaign any more — after approval each deliverable's OWNER approves its task list,
 * on the Grid — and the campaign page is views (Brief, Grid, Season map…), not department tabs.
 *
 * THE MODEL IS REAL (no route mocks) — what the report shows is what the product does. The only
 * retry is for the model's own hiccup, and it is a loop that throws when the blocker stays.
 *
 * There are NO fallbacks (traps.md, "a walk passes end to end and never reached the end"): the
 * set-up and the navigation are hard assertions, so a refusal stops the run where it happened; what
 * each screen should show is a recorded check, and the report counts them. The chapters run in
 * order and each one builds on the last — a failed chapter stops the language it is in.
 *
 * Run it ALONE: it reads the whole Mailpit box to prove who was mailed, so another suite sending mail
 * at the same time shows up as mail this walk "sent".
 *
 * Run:
 *   WALK=1 npx playwright test -c playwright.local.config.ts e2e/local/walks/job-to-campaign.walk.spec.ts
 *   WALK=1 WALK_LOCALES=en …    # one language only
 *
 * Writes `Claude outputs/reports/<date>-job-to-campaign/REPORT.html` — self-contained, every
 * screenshot embedded as a data URI, so the one file can be sent on its own.
 */
const WALK = process.env.WALK === '1'
const LOCALES = (process.env.WALK_LOCALES ?? 'en,ar').split(',') as Array<'en' | 'ar'>
const iraqDay = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad' }).format(new Date(ms))
const DATE = process.env.WALK_DATE ?? iraqDay(Date.now())
const OUT = path.resolve('Claude outputs', 'reports', `${DATE}-job-to-campaign`)
const API = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const MAILPIT = process.env.MAILPIT_URL_HOST ?? 'http://127.0.0.1:54324'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

// ------------------------------------------------------------------ the report ----
interface Mail { to: string; subject: string; snippet: string }
interface Check { title: string; ok: boolean; detail?: string }
interface Step { n: number; title: string; actor: string; notes: string[]; shots: string[]; mails: Mail[]; checks: Check[] }
interface Chapter { key: string; title: string; steps: Step[] }
interface Report { started: string; chapters: Chapter[] }

class Walk {
  report: Report = { started: new Date().toISOString(), chapters: [] }
  chapter!: Chapter
  step!: Step
  shots = 0
  constructor() {
    // A fresh report every run: the walk makes its own job and campaign, so an older run's
    // pictures describe different ones.
    if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true })
    mkdirSync(path.join(OUT, 'shots'), { recursive: true })
    this.flush()
  }
  open(key: string, title: string) {
    this.chapter = { key, title, steps: [] }
    this.report.chapters.push(this.chapter)
    this.flush()
  }
  begin(title: string, actor: string) {
    this.step = { n: this.chapter.steps.length + 1, title, actor, notes: [], shots: [], mails: [], checks: [] }
    this.chapter.steps.push(this.step)
    this.flush()
  }
  note(text: string) { this.step.notes.push(text); this.flush() }
  async check(title: string, fn: () => Promise<void> | void) {
    try {
      await fn()
      this.step.checks.push({ title, ok: true })
    } catch (e) {
      const msg = (e as Error).message ?? String(e)
      this.step.checks.push({ title, ok: false, detail: msg.split('\n').filter((l) => l.trim()).slice(0, 8).join('\n') })
    }
    this.flush()
  }
  async shot(page: Page, slug: string, opts: { full?: boolean; caption?: string } = {}) {
    this.shots += 1
    const name = `${String(this.shots).padStart(3, '0')}-${slug}.png`
    await page.addStyleTag({ content: '[data-testid="environment-bar"]{display:none!important}' }).catch(() => {})
    const full = opts.full
      ? await page.addStyleTag({ content: '.shell{block-size:auto!important;overflow:visible!important}.shell-main{overflow:visible!important}' })
      : null
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(OUT, 'shots', name), fullPage: opts.full ?? false })
    if (full) await full.evaluate((el) => (el as Element).remove())
    this.step.shots.push(`shots/${name}${opts.caption ? `|${opts.caption}` : ''}`)
    this.flush()
  }
  /** Everything Mailpit holds now — the mail this step sent — recorded, then the box emptied. */
  async collectMail(settleMs = 5_000): Promise<Mail[]> {
    await new Promise((r) => setTimeout(r, settleMs))
    const res = await fetch(`${MAILPIT}/api/v1/messages?limit=100`)
    const body = (await res.json()) as { messages: { To: { Address: string }[]; Subject: string; Snippet: string }[] }
    const mails = (body.messages ?? []).map((m) => ({ to: m.To.map((t) => t.Address).join(', '), subject: m.Subject, snippet: m.Snippet }))
    this.step.mails.push(...mails)
    await clearMailbox()
    this.flush()
    return mails
  }
  flush() {
    mkdirSync(OUT, { recursive: true })
    writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(this.report, null, 2))
    writeFileSync(path.join(OUT, 'REPORT.html'), renderHtml(this.report))
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function renderHtml(r: Report): string {
  let pass = 0, fail = 0, steps = 0, shots = 0
  for (const c of r.chapters) for (const s of c.steps) {
    steps++
    shots += s.shots.length
    for (const k of s.checks) { if (k.ok) pass++; else fail++ }
  }
  const out: string[] = []
  out.push('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Job to campaign walk</title>')
  out.push('<style>:root{color-scheme:light}body{font:15px/1.6 system-ui,sans-serif;max-width:1180px;margin:32px auto;padding:0 24px;color:#1d1d1f;background:#fff}'
    + 'img{max-width:100%;border:1px solid #ddd;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.08);margin:8px 0}'
    + 'figcaption{color:#666;font-style:italic;margin-bottom:24px}'
    + 'h2{margin-top:56px;border-top:1px solid #e5e5e5;padding-top:24px}h3{margin-top:32px}'
    + '.ok{color:#1a7f37}.bad{color:#b42318}pre{background:#f6f6f6;padding:8px 12px;border-radius:6px;font-size:13px;white-space:pre-wrap}'
    + 'table{border-collapse:collapse;font-size:13px;margin:8px 0}td,th{border:1px solid #e5e5e5;padding:4px 8px;text-align:start;vertical-align:top}'
    + 'nav ol{columns:2}.tally{font-size:17px;font-weight:600}'
    + '.observe{background:#fff8e6;border-inline-start:3px solid #d99b0a;padding:10px 14px;border-radius:6px;margin:12px 0}'
    + '@media (max-width:700px){nav ol{columns:1}body{padding:0 16px}}</style></head><body>')
  out.push('<h1>A single job becomes a campaign</h1>')
  out.push(`<p>Walked ${esc(r.started.slice(0, 16).replace('T', ' '))} UTC on the local stack, with the real model and the real mail lane (Mailpit). `
    + 'Everything was done through the product by the person who would do it. Every screenshot is the state <b>after</b> the step completed.</p>')
  out.push(`<p class="tally">${steps} steps · ${shots} screenshots · checks: <span class="ok">${pass} passed</span>, <span class="${fail ? 'bad' : 'ok'}">${fail} failed</span>.</p>`)
  const failed = r.chapters.flatMap((c) => c.steps.flatMap((s) => s.checks.filter((k) => !k.ok).map((k) => `${c.title} → ${s.title}: ${k.title}`)))
  if (failed.length) out.push(`<p><b>Failed checks:</b></p><ul>${failed.map((f) => `<li class="bad">${esc(f)}</li>`).join('')}</ul>`)
  out.push('<nav><ol>')
  for (const c of r.chapters) out.push(`<li><a href="#${esc(c.key)}">${esc(c.title)}</a></li>`)
  out.push('</ol></nav>')
  for (const c of r.chapters) {
    out.push(`<h2 id="${esc(c.key)}">${esc(c.title)}</h2>`)
    for (const s of c.steps) {
      out.push(`<h3>${s.n}. ${esc(s.title)}</h3><p><i>As ${esc(s.actor)}.</i></p>`)
      for (const n of s.notes) {
        if (n.startsWith('OBSERVE:')) out.push(`<p class="observe">${esc(n.slice(8).trim())}</p>`)
        else out.push(`<p>${esc(n)}</p>`)
      }
      for (const shot of s.shots) {
        const [file, caption] = shot.split('|')
        // Embedded, never linked: the one file is what gets shared.
        const png = path.join(OUT, file!)
        const src = existsSync(png) ? `data:image/png;base64,${readFileSync(png).toString('base64')}` : file!
        out.push(`<figure><img src="${src}" alt="${esc(caption ?? file!)}" loading="lazy">${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}</figure>`)
      }
      if (s.mails.length) {
        out.push('<p><b>Mail sent during this step:</b></p><table><tr><th>To</th><th>Subject</th><th>First line</th></tr>')
        for (const m of s.mails) out.push(`<tr><td>${esc(m.to)}</td><td>${esc(m.subject)}</td><td>${esc(m.snippet.slice(0, 160))}</td></tr>`)
        out.push('</table>')
      } else if (s.checks.some((k) => /mail/i.test(k.title))) {
        out.push('<p><b>Mail sent during this step:</b> none.</p>')
      }
      if (s.checks.length) {
        out.push('<ul>')
        for (const k of s.checks) out.push(`<li class="${k.ok ? 'ok' : 'bad'}">${k.ok ? '✅' : '❌'} ${esc(k.title)}${!k.ok && k.detail ? `<pre>${esc(k.detail)}</pre>` : ''}</li>`)
        out.push('</ul>')
      }
    }
  }
  out.push('</body></html>')
  return out.join('\n')
}

// ------------------------------------------------------------------ the helpers ----
type Tag = keyof typeof PEOPLE
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
/** The next Monday at least `minDays` out — a working day in every office. */
function workingDay(minDays: number): string {
  const d = new Date(Date.now() + minDays * 86_400_000)
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
/**
 * A fresh access token for a person — signed in with the seed's password, not read from the saved
 * login, which expires within the hour and made every RPC check a 401 on a long walk.
 */
const tokens = new Map<Tag, { token: string; at: number }>()
async function tokenOf(tag: Tag): Promise<string> {
  const hit = tokens.get(tag)
  if (hit && Date.now() - hit.at < 20 * 60_000) return hit.token
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email: PEOPLE[tag].email, password: 'devpassword' }),
  })
  const body = (await res.json()) as { access_token?: string }
  expect(body.access_token, `sign-in as ${tag}`).toBeTruthy()
  tokens.set(tag, { token: body.access_token!, at: Date.now() })
  return body.access_token!
}
/** What the schedule would offer for assignment on a campaign, asked as a person (the picker's RPC). */
async function offeredAs(tag: Tag, campaignId: string): Promise<string[]> {
  const res = await fetch(`${API}/rest/v1/rpc/assignable_deliverables`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${await tokenOf(tag)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_campaign: campaignId }),
  })
  const body = await res.text()
  expect(res.status, `assignable_deliverables as ${tag}: ${body}`).toBeLessThan(300)
  return (JSON.parse(body || '[]') as { id: string }[]).map((r) => r.id)
}

class Session {
  constructor(readonly browser: Browser, readonly locale: 'en' | 'ar') {}
  async as(tag: Tag): Promise<Page> {
    const ctx = await this.browser.newContext({ storageState: authFile(tag), viewport: { width: 1440, height: 1000 } })
    return ctx.newPage()
  }
  /** Navigate, then make the page the walk's language. The choice is REMEMBERED on the profile
   *  (I53.21) and applied once it loads, so the page settles before the direction is read —
   *  otherwise the walk's press and the profile's own switch cancel each other out. */
  async go(page: Page, url: string) {
    await page.goto(url)
    await page.getByTestId('locale-toggle').first().waitFor({ state: 'visible', timeout: 15_000 })
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(400)
    const want = this.locale === 'ar' ? 'rtl' : 'ltr'
    if ((await page.locator('html').getAttribute('dir')) !== want) {
      await page.getByTestId('locale-toggle').first().click()
    }
    await expect(page.locator('html')).toHaveAttribute('dir', want)
  }
  /** Raw translation keys showing as text — the RTL walk's leak check. */
  async leakedKeys(page: Page): Promise<string[]> {
    return page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      const hits = new Set<string>()
      let n: Node | null
      while ((n = walker.nextNode())) {
        const t = (n.textContent ?? '').trim()
        if (/^[a-z][a-z0-9]*(\.[a-zA-Z0-9_]+){2,}$/.test(t)) hits.add(t)
      }
      return [...hits]
    })
  }
}

/** My Work loads its panels after the shell; give them a moment before reading. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(800)
}
async function kindsOf(page: Page): Promise<string> {
  await settle(page)
  const kinds = await page.locator('[data-testid^="waiting-for-you-kind-"]').allTextContents()
  return kinds.length ? kinds.join(', ') : 'nothing'
}
/** A literal for a RegExp. */
const rx = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
async function pickPerson(page: Page, testId: string, name: string) {
  await page.getByTestId(testId).fill(name)
  await page.getByTestId(`${testId}-list`).getByRole('option', { name: new RegExp(name) }).first().dispatchEvent('mousedown')
}
async function pickDeliverable(page: Page, testId: string, query: string) {
  await page.getByTestId(testId).fill(query)
  await page.getByTestId(`${testId}-list`).getByRole('option').first().dispatchEvent('mousedown')
  await expect(page.getByTestId(`${testId}-chip`)).toBeVisible()
}
/** Close the campaign page's banner, returning what it said (the words differ by language). */
async function closeBanner(page: Page): Promise<string> {
  const banner = page.getByTestId('campaign-banner')
  await expect(banner).toBeVisible({ timeout: 20_000 })
  const text = (await banner.textContent()) ?? ''
  await page.getByTestId('campaign-banner-close').click()
  return text
}
/** What to TYPE into a deliverable picker: the English name, or — in Arabic — the code (I53.23). */
async function typeName(code: string, locale: 'en' | 'ar'): Promise<string> {
  const [t] = await rows<{ name_en: string }>('deliverable_types', `select=name_en&code=eq.${code}`)
  return locale === 'ar' ? code : t.name_en
}
async function arabicName(code: string): Promise<string> {
  const [t] = await rows<{ name_ar: string }>('deliverable_types', `select=name_ar&code=eq.${code}`)
  return t.name_ar
}
/** Whom to make the owner of a proposed row, from what it is called. */
function ownerFor(name: string): Tag {
  if (/anim|motion|reel|video|tvc|film|edit|story|teaser|تشويق|فيديو/i.test(name)) return 'motiontl'
  if (/copy|caption|script|article|blog|headline|text|content|slogan|tagline|press|نص|محتوى/i.test(name)) return 'copytl'
  if (/photo|shoot|studio|print|production|billboard|ooh|radio|تصوير|لوحة/i.test(name)) return 'studiotl'
  return 'tl'
}
/**
 * Propose more puts every row in the chosen workstream, and an owner list offers only that workstream's department's
 * leads (ADR-0128). The promoted job's one workstream is its Creative piece's (I68.16), so the rows' owners are
 * Creative's leads — motion work to the Motion lead, the rest to the Design lead.
 */
function creativeOwnerFor(name: string): Tag {
  return /anim|motion|reel|video|tvc|film|edit|story|teaser|تشويق|فيديو/i.test(name) ? 'motiontl' : 'tl'
}
async function tagOfUser(userId: string): Promise<Tag> {
  const [u] = await rows<{ email: string }>('user_profiles', `select=email&id=eq.${userId}`)
  const tag = (Object.keys(PEOPLE) as Tag[]).find((k) => PEOPLE[k].email === u.email)
  expect(tag, `a seeded person for ${u.email}`).toBeTruthy()
  return tag!
}
async function deliverablesOf(campaignId: string) {
  return rows<{ id: string; name: string; state: string; owner_user_id: string; quantity: number; due_at: string | null; deliverable_type_id: string | null; department_id: string | null; phase_id: string | null; tasks_approved_at: string | null }>(
    'deliverables',
    `select=id,name,state,owner_user_id,quantity,due_at,deliverable_type_id,department_id,phase_id,tasks_approved_at,streams!inner(campaign_id)&streams.campaign_id=eq.${campaignId}&order=created_at`,
  )
}
async function tasksOf(deliverableId: string) {
  return rows<{ id: string; title: string; status: string; assignee_id: string | null; due_at: string | null; committed_due_at: string | null }>(
    'sub_tasks', `select=id,title,status,assignee_id,due_at,committed_due_at&deliverable_id=eq.${deliverableId}&order=sort_order,id`,
  )
}
const strip = (o: Record<string, unknown>) => { const { phase_id: _p, ...rest } = o; return rest }

/**
 * The real model sometimes answers nothing. Ask again — but only twice more, and throw if it
 * still has not answered: a walk that photographs a service failure and carries on is the one
 * that "passed" without reaching the end.
 */
async function untilAnswered(ask: () => Promise<boolean>, what: string, walk: Walk) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (await ask()) return
    walk.note(`The model gave nothing for ${what} on attempt ${attempt}; asked again.`)
  }
  throw new Error(`the model answered nothing for ${what} after three attempts`)
}

// ------------------------------------------------------------------ the walk ----
let walk: Walk

for (const locale of LOCALES) {
  test.describe(`Job to campaign walk (${locale})`, () => {
    test.skip(!WALK, 'WALK=1 runs the review walk')
    test.describe.configure({ mode: 'serial' })
    test.setTimeout(15 * 60_000)
    test.use({ actionTimeout: 20_000 })

    const L = locale === 'ar' ? 'Arabic' : 'English'
    const TITLES = locale === 'ar'
      ? { job: 'لوما الموسم الثاني — إعلان تشويقي', wizard: 'لوما الموسم الثاني' }
      : { job: 'LUMA Season 2 teaser', wizard: 'LUMA Season 2' }
    const owner = PEOPLE.lead // a Creative single job's owner is the department lead
    const ownerTag: Tag = 'lead'
    const st: { title?: string; campaignId?: string; deliverableId?: string; addedIds?: string[]; phases?: { id: string; number: number; name: string }[]; keyVisualId?: string } = {}
    let s: Session

    const uniqueTitle = async (base: string) => {
      let title = base
      for (let i = 2; (await rows('campaigns', `select=id&name=eq.${encodeURIComponent(title)}`)).length > 0; i++) title = `${base} (${i})`
      return title
    }

    test.beforeAll(({ browser }) => {
      walk ??= new Walk()
      s = new Session(browser, locale)
    })

    // The Arabic half switches every person it signs in as to Arabic, and the profile REMEMBERS it
    // (I53.21) — so the ordinary English suites run next would open in Arabic and fail on words.
    // Put each seeded person back to the language the seed gave them. A fixture rewind, not product.
    test.afterAll(async () => {
      if (locale !== 'ar') return
      const key = process.env.E2E_SERVICE_ROLE_KEY ??
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
      for (const p of Object.values(PEOPLE) as { email: string; locale?: string }[]) {
        await fetch(`${API}/rest/v1/user_profiles?email=eq.${encodeURIComponent(p.email)}`, {
          method: 'PATCH',
          headers: { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({ locale: p.locale ?? 'en' }),
        })
      }
    })

    test('A. a single job is created and released', async () => {
      walk.open(`${locale}-a`, `${L} · A. A single job is created and released`)
      const am = await s.as('am2')
      const title = await uniqueTitle(TITLES.job)
      st.title = title
      walk.begin('Create a single job — the request', PEOPLE.am2.name)
      walk.note(`Client Luma Retail (account manager ${PEOPLE.am2.name}); department Creative; deliverable ${await typeName('ADV-003', 'en')} (ADV-003); title "${title}".`)
      await s.go(am, '/campaigns/new-job')
      await am.getByTestId('sj-client').selectOption({ label: 'Luma Retail' })
      await am.getByTestId('sj-words').fill(locale === 'ar'
        ? 'إعلان تشويقي واحد على وسائل التواصل يعلن عودة لوما للموسم الثاني — السحب الأسبوعي الأول بعد أسبوعين من الإطلاق.'
        : 'One social teaser announcing LUMA is back for Season 2 — the first weekly draw is two weeks after launch.')
      await am.getByTestId('sj-brief-card-single_execution').click()
      await am.getByTestId('sj-next').click()
      await expect(am.getByTestId('sj-brief')).toBeVisible()
      await am.getByTestId('sj-field-task').fill(locale === 'ar'
        ? 'صمّم إعلاناً تشويقياً واحداً بصيغة مربّعة وقصة، بالعربية أولاً، يحمل شعار "كل عملية شراء تذكرة".'
        : 'Design one teaser social advertisement in square and story formats, Arabic first, carrying "Every purchase is a ticket".')
      await walk.shot(am, 'single-job-brief-filled', { full: true, caption: 'The brief, filled' })
      await am.getByTestId('sj-next').click()
      await expect(am.getByTestId('sj-request')).toBeVisible()
      await am.getByTestId('sj-title').fill(title)
      await am.getByTestId('sj-due').fill(dueInTwoWeeks())
      if (locale === 'ar') {
        await am.getByTestId('sj-type').fill(await arabicName('ADV-003'))
        await am.waitForTimeout(600)
        const found = await am.getByTestId('sj-type-list').getByRole('option').count()
        await walk.shot(am, 'single-job-picker-arabic-name', { caption: "The deliverable picker, given the catalogue entry's Arabic name" })
        await walk.check('the deliverable picker finds a catalogue entry by its ARABIC name in the Arabic UI', () => {
          expect(found, 'options offered for the Arabic name').toBeGreaterThan(0)
        })
        await am.getByTestId('sj-type').fill('')
      }
      await am.getByTestId('sj-type').fill(await typeName('ADV-003', locale))
      await am.getByTestId('sj-type-list').getByRole('option').first().dispatchEvent('mousedown')
      await expect(am.getByTestId('sj-type-none')).toHaveCount(0)
      await am.getByTestId('sj-department').getByRole('radio', { name: 'Creative' }).click()
      await pickJobLanguages(am)
      await walk.shot(am, 'single-job-request-filled', { full: true, caption: 'The request: client, words, due date, the deliverable from the catalogue, the department' })
      await nextToReview(am)
      await walk.shot(am, 'single-job-review', { full: true, caption: 'Review before opening the job' })

      walk.begin('Release the job', PEOPLE.am2.name)
      await clearMailbox()
      await am.getByTestId('sj-approve').click()
      // A look-alike job may be found (ADR-0086): the walk keeps it separate, which is a choice
      // the product offers, not a fallback — both roads end on the job's page, asserted below.
      const prompt = am.getByTestId('sj-similar-dialog')
      const outcome = await Promise.any([
        prompt.waitFor({ state: 'visible', timeout: 10_000 }).then(() => 'prompt' as const),
        am.waitForURL(/\/campaigns\/[0-9a-f-]{36}$/, { timeout: 30_000 }).then(() => 'released' as const),
      ])
      if (outcome === 'prompt') {
        await walk.shot(am, 'single-job-lookalike-prompt', { caption: 'A look-alike job was found; kept separate' })
        await am.getByTestId('sj-similar-separate').click()
      }
      await expect(am).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/, { timeout: 30_000 })
      const campaignId = am.url().split('/').pop()!
      st.campaignId = campaignId
      // ADR-0132 d.1: the job's own page carries Promote on its header; the old "Open the deliverable" is gone — its piece opens here.
      await expect(am.getByTestId('campaign-promote-job')).toBeVisible()
      await expect(am.getByTestId('campaign-single-job-cta')).toHaveCount(0)
      await walk.shot(am, 'single-job-open', { full: true, caption: 'The job is open — its page' })
      const [d] = await deliverablesOf(campaignId)
      expect(d, 'the job has its deliverable').toBeTruthy()
      st.deliverableId = d.id
      const tasks = await tasksOf(d.id)
      await walk.check('the deliverable has its task list from the catalogue entry', () => {
        expect(tasks.length, `tasks: ${tasks.map((t) => t.title).join(', ')}`).toBeGreaterThan(0)
      })
      await walk.check('the deliverable is owned by the Creative department lead', async () => {
        const [u] = await rows<{ display_name: string }>('user_profiles', `select=display_name&id=eq.${d.owner_user_id}`)
        expect(u.display_name).toBe(owner.name)
      })
      await walk.check('the due date is stored at 18:00 Iraq (15:00Z) of the chosen day (I52.14)', () => {
        expect(d.due_at, 'due_at').toBeTruthy()
        expect(d.due_at!).toMatch(/T15:00:00/)
      })
      // ADR-0132: the job's own page, its one piece open in the panel — the task list is there, not on /deliverables.
      await am.getByTestId(`campaign-deliverable-open-${d.id}`).click()
      await expect(am.getByTestId('piece-panel')).toBeVisible({ timeout: 15_000 })
      await walk.shot(am, 'single-job-task-list', { full: true, caption: 'The task list under the deliverable, in its panel on the job\'s page' })
      await walk.check('every task is listed on the job\'s own page, under its piece owned in Creative (I53.15, ADR-0132)', async () => {
        await expect(am.getByRole('heading', { level: 1 })).toContainText(title)
        await expect(am.getByTestId('piece-drawer-owner')).toContainText('Creative')
        for (const t of tasks) await expect(am.getByTestId(`piece-panel-task-${t.id}`)).toBeVisible()
      })
      await am.getByTestId('piece-drawer-close').click()
      const mails = await walk.collectMail()
      await walk.check(`exactly one mail: "Approved: ${title} — you own 1 deliverable" to the owner (${owner.email}), in the owner's language`, () => {
        expect(mails.map((m) => m.to)).toEqual([owner.email])
        expect(mails[0]!.subject).toMatch(new RegExp(`^(Approved: ${rx(title)} — you own 1 deliverable|تمت الموافقة: ${rx(title)} — لديك 1 مُخرج)$`))
      })
      await walk.check('the account manager who released it is not mailed', () => {
        expect(mails.filter((m) => m.to.includes(PEOPLE.am2.email))).toHaveLength(0)
      })
      await walk.check('the in-app notification exists for the owner and nobody else (I53.19)', async () => {
        const all = await rows<{ user_id: string }>('notifications', `select=user_id&entity_id=eq.${campaignId}&type=eq.campaign_approved`)
        const [u] = await rows<{ id: string }>('user_profiles', `select=id&email=eq.${encodeURIComponent(owner.email)}`)
        expect(all.map((n) => n.user_id)).toEqual([u.id])
      })
      await am.context().close()
    })

    test('B. who is waiting for what — My Work after the release', async () => {
      const { deliverableId, title } = st
      walk.open(`${locale}-b`, `${L} · B. Who is waiting for what`)
      walk.begin('My Work after the release — the owner, the account manager, an uninvolved lead, the Power Admin, a maker', 'everyone')
      const lead = await s.as(ownerTag)
      await s.go(lead, '/my-work')
      await expect(lead.getByTestId('surface-my-work')).toBeVisible()
      await settle(lead)
      await walk.shot(lead, 'my-work-owner-waiting', { full: true, caption: `${owner.name} — Waiting for you carries the job's task list` })
      await walk.check("the owner's Waiting for you lists the job's task list, naming the job", async () => {
        const row = lead.getByTestId(`waiting-for-you-task_list-${deliverableId}`)
        await expect(row).toBeVisible()
        await expect(row).toContainText(title!)
      })
      await lead.getByTestId('notif-bell').click()
      await expect(lead.getByTestId('notif-panel')).toBeVisible()
      await walk.shot(lead, 'inbox-owner', { caption: `${owner.name}'s inbox — the approval notice` })
      await walk.check("the owner's inbox shows the approval notice with the job's name", async () => {
        await expect(lead.getByTestId('notif-panel')).toContainText(title!)
      })
      if (locale === 'ar') {
        await walk.check('no raw translation keys on My Work (RTL)', async () => expect(await s.leakedKeys(lead)).toEqual([]))
        await walk.check('I53.21: the chosen language is remembered — a fresh load comes up in Arabic without the toggle', async () => {
          await lead.goto('/my-work')
          await lead.getByTestId('surface-my-work').waitFor({ state: 'visible' })
          await expect(lead.locator('html')).toHaveAttribute('dir', 'rtl', { timeout: 10_000 })
        })
      }
      await lead.context().close()

      for (const [tag, why] of [
        ['am2', 'the account manager is never offered a task list (ADR-0090)'],
        ['content', "an uninvolved department's lead sees nothing of it"],
        ['admin', 'the Power Admin sees no company-wide list (ADR-0070 d.6)'],
        ['maker', 'a team member has no panel at all'],
      ] as const) {
        const p = await s.as(tag)
        await s.go(p, '/my-work')
        await expect(p.getByTestId('surface-my-work')).toBeVisible()
        await settle(p)
        await walk.shot(p, `my-work-${tag}`, { caption: `${PEOPLE[tag].name} — ${why}` })
        await walk.check(`${PEOPLE[tag].name}: ${why}`, async () => {
          await expect(p.getByTestId(`waiting-for-you-task_list-${deliverableId}`)).toHaveCount(0)
          await expect(p.getByTestId('waiting-for-you-load-error')).toHaveCount(0)
          // I59.10: approvals sit in Needs you now; a team member has no approval row at all.
          if (tag === 'maker') await expect(p.locator('[data-testid^="waiting-for-you-"]')).toHaveCount(0)
        })
        await p.context().close()
      }
    })

    test('C. the owner approves the task list; the schedule offers the work only after', async () => {
      const { campaignId, deliverableId, title } = st
      walk.open(`${locale}-c`, `${L} · C. The owner approves the task list`)
      const [makerRes] = await rows<{ id: string }>('resources', `select=id&name=eq.${encodeURIComponent(PEOPLE.maker.name)}&is_active=eq.true`)
      const bookDay = workingDay(3)

      walk.begin('Before the task list is approved, the schedule does not offer the work', PEOPLE.traffic.name)
      const traffic = await s.as('traffic')
      await s.go(traffic, `/schedule?on=${bookDay}`)
      await expect(traffic.getByTestId('schedule-grid')).toBeVisible()
      await traffic.getByTestId(`cell-${makerRes.id}-${bookDay}`).hover()
      await traffic.getByTestId(`add-${makerRes.id}-${bookDay}`).click()
      // ADR-0129 (I66.10, 29 Sep): ad-hoc work is off — on a person the dialog offers a project task only, no choice.
      await expect(traffic.getByTestId('mode-project')).toHaveCount(0)
      await traffic.getByTestId('booking-project').selectOption({ label: title! })
      const picker = traffic.getByTestId('booking-deliverable-select')
      await expect(picker).toBeVisible()
      await traffic.waitForTimeout(800)
      await walk.shot(traffic, 'schedule-picker-held', { caption: 'The booking dialog on the job: the deliverable picker offers nothing yet (ADR-0090 d.3a)' })
      await walk.check("the picker offers none of the job's deliverables before approval — absence, not a disabled entry", async () => {
        await expect.poll(() => picker.locator('option').count()).toBe(1)
      })
      await traffic.getByTestId('booking-cancel').click()

      walk.begin('The owner approves the task list from the Waiting for you row', owner.name)
      await clearMailbox()
      const lead = await s.as(ownerTag)
      await s.go(lead, '/my-work')
      await lead.getByTestId(`waiting-for-you-open-${deliverableId}`).click()
      // ADR-0132 d.8: the row leads to the job's own page with its piece open — the list is approved in the panel.
      await expect(lead).toHaveURL((u) => u.pathname === `/campaigns/${st.campaignId}` && u.searchParams.get('piece') === deliverableId)
      await expect(lead.getByTestId('piece-panel-approve')).toBeVisible()
      await walk.shot(lead, 'task-list-before-approve', { full: true, caption: 'Where the row leads: the job\'s page, its piece open, with Approve the task list' })
      await lead.getByTestId('piece-panel-approve').click()
      await expect(lead.getByTestId('piece-panel-approved')).toBeVisible()
      await walk.shot(lead, 'task-list-approved', { full: true, caption: 'Approved' })
      await s.go(lead, '/my-work')
      await settle(lead)
      await walk.shot(lead, 'my-work-owner-after-approve', { caption: 'The row has left Waiting for you' })
      await walk.check('the row leaves Waiting for you once approved', async () => {
        await expect(lead.getByTestId(`waiting-for-you-task_list-${deliverableId}`)).toHaveCount(0)
      })
      const mails = await walk.collectMail(3_000)
      await walk.check('approving the task list sends no mail', () => { expect(mails).toEqual([]) })
      await lead.context().close()

      walk.begin('After approval the schedule offers the work, and a task is assigned', PEOPLE.traffic.name)
      await clearMailbox()
      await s.go(traffic, `/schedule?on=${bookDay}`)
      await traffic.getByTestId(`cell-${makerRes.id}-${bookDay}`).hover()
      await traffic.getByTestId(`add-${makerRes.id}-${bookDay}`).click()
      await traffic.getByTestId('booking-project').selectOption({ label: title! })
      await expect.poll(() => picker.locator('option').count()).toBeGreaterThan(1)
      await picker.selectOption({ index: 1 })
      const tasks = await tasksOf(deliverableId!)
      const firstOpen = tasks.find((t) => !t.assignee_id) ?? tasks[0]
      await traffic.getByTestId('booking-subtask-select').selectOption({ label: firstOpen.title })
      await traffic.getByTestId('booking-project-reviewer-add').selectOption({ label: owner.name })
      await traffic.getByTestId('booking-hours').fill('4')
      await walk.shot(traffic, 'schedule-booking-filled', { caption: `Booking "${firstOpen.title}" on ${PEOPLE.maker.name}, reviewer ${owner.name}, 4 hours` })
      const dialog = traffic.getByTestId('booking-dialog')
      const submit = traffic.getByTestId('booking-submit')
      await submit.click()
      // Warn-and-allow (ADR-0061): a full day asks once more. Both roads end with the dialog shut.
      const warned = await submit.filter({ hasText: /Proceed anyway|المتابعة/ }).waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false)
      if (warned) {
        await walk.shot(traffic, 'schedule-booking-warned', { caption: 'Warned (capacity or calendar) — proceeding' })
        await submit.click()
      }
      await expect(dialog).toHaveCount(0, { timeout: 20_000 })
      await traffic.waitForTimeout(800)
      await walk.shot(traffic, 'schedule-booked', { caption: 'The booking on the grid' })
      const [after] = await rows<{ assignee_id: string | null; committed_due_at: string | null }>('sub_tasks', `select=assignee_id,committed_due_at&id=eq.${firstOpen.id}`)
      await walk.check('the task is assigned to the maker', async () => {
        const [u] = await rows<{ id: string }>('user_profiles', `select=id&email=eq.${encodeURIComponent(PEOPLE.maker.email)}`)
        expect(after.assignee_id).toBe(u.id)
      })
      await walk.check('the commitment is stamped 18:00 Iraq on the booked day (ADR-0075 addendum d.3a)', () => {
        expect(after.committed_due_at, 'committed_due_at').toBeTruthy()
        expect(after.committed_due_at!).toMatch(/T15:00:00/)
        expect(after.committed_due_at!.slice(0, 10)).toBe(bookDay)
      })
      const mails2 = await walk.collectMail()
      await walk.check(`exactly one mail: "New task: ${firstOpen.title}" to the maker`, () => {
        expect(mails2.map((m) => m.to)).toEqual([PEOPLE.maker.email])
        expect(mails2[0]!.subject).toMatch(new RegExp(`^(New task|مهمة جديدة): ${rx(firstOpen.title)}$`))
      })
      await walk.check('the approved job is offered on the schedule', async () => {
        expect(await offeredAs('traffic', campaignId!)).toContain(deliverableId)
      })
      await traffic.context().close()

      const maker = await s.as('maker')
      await s.go(maker, '/my-work')
      await expect(maker.getByTestId(`my-work-item-${firstOpen.id}`)).toBeVisible({ timeout: 15_000 })
      await walk.shot(maker, 'my-work-maker-assigned', { full: true, caption: `${PEOPLE.maker.name}'s My Work — the task, its project and its due day` })
      await walk.check("the task is on the maker's My Work, naming the job", async () => {
        await expect(maker.getByTestId(`my-work-item-${firstOpen.id}`)).toContainText(title!)
      })
      await maker.context().close()
    })

    test('D. the job is promoted to a campaign — the existing deliverable untouched', async () => {
      const { campaignId, deliverableId, title } = st
      walk.open(`${locale}-d`, `${L} · D. The job is promoted to a campaign`)
      walk.begin('Promote the job from its card on the campaigns list', PEOPLE.am2.name)
      const before = (await deliverablesOf(campaignId!)).map(strip)
      const tasksBefore = await tasksOf(deliverableId!)
      const bookingsBefore = await rows('bookings', `select=id,resource_id,starts_at,ends_at&sub_task_id=in.(${tasksBefore.map((t) => t.id).join(',')})`)
      await clearMailbox()
      const am = await s.as('am2')
      await s.go(am, '/campaigns')
      await am.getByTestId('campaigns-scope-all').click()
      await am.getByTestId('campaigns-search').fill(title!)
      await expect(am.getByTestId(`campaign-row-${campaignId}`)).toBeVisible()
      await am.getByTestId(`campaign-menu-${campaignId}`).click()
      await expect(am.getByTestId(`campaign-promote-${campaignId}`)).toBeVisible()
      await walk.shot(am, 'campaigns-card-promote', { caption: "The job's card: Promote is offered in its menu" })
      await am.getByTestId(`campaign-promote-${campaignId}`).click()
      await expect(am.getByTestId('campaign-promote-confirm')).toBeVisible()
      await walk.shot(am, 'promote-confirm', { caption: 'The confirmation — it cannot be undone' })
      await am.getByTestId('campaign-promote-confirm').click()
      await expect.poll(async () => (await rows<{ kind: string }>('campaigns', `select=kind&id=eq.${campaignId}`))[0].kind, { timeout: 20_000 }).toBe('campaign')
      await s.go(am, `/campaigns/${campaignId}`)
      await expect(am.getByTestId('campaign-tabs')).toBeVisible()
      await walk.shot(am, 'promoted-campaign-grid', { full: true, caption: 'Now a campaign: its page opens on the Grid, the original deliverable on it' })

      const after = (await deliverablesOf(campaignId!)).map(strip)
      const tasksAfter = await tasksOf(deliverableId!)
      const bookingsAfter = await rows('bookings', `select=id,resource_id,starts_at,ends_at&sub_task_id=in.(${tasksBefore.map((t) => t.id).join(',')})`)
      await walk.check('the existing deliverable is untouched — id, name, owner, quantity, due date, type, state, task-list approval', () => { expect(after).toEqual(before) })
      await walk.check('its tasks are untouched — titles, statuses, assignee, dates', () => { expect(tasksAfter).toEqual(tasksBefore) })
      await walk.check('its booking is untouched', () => { expect(bookingsAfter).toEqual(bookingsBefore) })
      await walk.check('the approved task list keeps the work on offer — promotion adds no gate (ADR-0100 d.2)', async () => {
        expect(await offeredAs('traffic', campaignId!)).toContain(deliverableId)
      })
      const mails = await walk.collectMail(3_000)
      await walk.check('promotion itself sends no mail', () => { expect(mails).toEqual([]) })
      const [cRow] = await rows<{ brief: Record<string, unknown> }>('campaigns', `select=brief&id=eq.${campaignId}`)
      await walk.check("the job's words and task became the campaign brief, and the job's brief is kept whole under promotedJobBrief (I53.20)", () => {
        expect(String(cRow.brief.background ?? '')).toMatch(/teaser|تشويقي/)
        expect(String(cRow.brief.task ?? '')).toMatch(/Design one teaser|صمّم/)
        expect(cRow.brief.promotedJobBrief).toBeTruthy()
      })
      const legacy = await rows<{ approved_at: string | null; values: Record<string, unknown> }>('campaign_briefs', `select=approved_at,values&campaign_id=eq.${campaignId}`)
      walk.note(`OBSERVE: promotion still re-opens and empties the job's department brief (\`promote_single_job\`, from before ADR-0100): ${legacy.length} row(s), ${legacy.filter((b) => !b.approved_at).length} unapproved and ${legacy.filter((b) => Object.keys(b.values ?? {}).length === 0).length} empty. Nothing waits on it any more — the gate is the owner's task list — so it is a leftover, not a block.`)

      walk.begin('The Brief view shows the job’s words', PEOPLE.am2.name)
      await am.getByTestId('campaign-tab-brief').click()
      await expect(am.getByTestId('campaign-master-brief')).toBeVisible()
      await walk.shot(am, 'promoted-brief-view', { full: true, caption: "The Brief view: the job's words, now the campaign's brief, with Edit and Propose more" })
      await walk.check("the Brief view shows the job's own words (I53.20)", async () => {
        await expect(am.getByTestId('campaign-master-brief')).toContainText(/teaser|تشويقي/)
      })
      await walk.check('Edit this brief and Propose more deliverables are offered to the account manager', async () => {
        await expect(am.getByTestId('campaign-brief-edit')).toBeVisible()
        await expect(am.getByTestId('campaign-generate-deliverables')).toBeVisible()
      })
      await am.context().close()

      walk.begin('Nobody is asked for a department brief', owner.name)
      const leadNow = await s.as(ownerTag)
      await s.go(leadNow, '/my-work')
      await expect(leadNow.getByTestId('surface-my-work')).toBeVisible()
      await settle(leadNow)
      await walk.shot(leadNow, 'my-work-lead-after-promotion', { full: true, caption: `${owner.name} — Waiting for you after the promotion` })
      await walk.check('ADR-0100 d.4: no "write your department\'s brief" row — the document is retired on campaigns', async () => {
        await expect(leadNow.getByTestId(`waiting-for-you-department_brief_unwritten-${campaignId}`)).toHaveCount(0)
        await expect(leadNow.locator('[data-testid^="waiting-for-you-department_brief"]')).toHaveCount(0)
      })
      await leadNow.context().close()
    })

    test('E. the campaign brief is rewritten on the page; more deliverables are proposed from it', async () => {
      const { campaignId, deliverableId } = st
      walk.open(`${locale}-e`, `${L} · E. The brief is rewritten; more deliverables are proposed`)
      walk.begin('Edit the campaign brief after release', PEOPLE.am2.name)
      const before = (await deliverablesOf(campaignId!)).map(strip)
      const am = await s.as('am2')
      await s.go(am, `/campaigns/${campaignId}?tab=brief`)
      await am.getByTestId('campaign-tab-brief').click()
      await am.getByTestId('campaign-brief-edit').click()
      const proposition = locale === 'ar' ? 'كل عملية شراء تذكرة. كل جمعة سحب.' : 'Every purchase is a ticket. Every Friday is a draw.'
      const task = locale === 'ar'
        ? 'أعد الناس إلى لوما في الموسم الثاني وحافظ على شرائهم خلال السحوبات الأربعة — إعلان تشويقي قبل الإطلاق، ثم إيقاع من المنشورات والتذكيرات وقصص الفائزين كل أسبوع، على وسائل التواصل وفي التطبيق وعلى شاشة قناة الربيعة.'
        : 'Bring people back for Season 2 and keep them buying through the four weekly draws — a teaser before launch, then a weekly rhythm of posts, reminders and winner stories, on social, in the app and on Al Rabiaa TV.'
      await am.getByTestId('campaign-master-brief-field-task').fill(task)
      await am.getByTestId('campaign-master-brief-field-proposition').fill(proposition)
      await walk.shot(am, 'brief-editing', { full: true, caption: 'The brief in its fields, rewritten for the bigger scope' })
      await clearMailbox()
      await am.getByTestId('campaign-master-brief-save').click()
      walk.note(`The page said: “${(await closeBanner(am)).trim()}”.`)
      await walk.shot(am, 'brief-saved', { full: true, caption: 'Saved — the brief reads back' })
      await walk.check('the saved brief shows the new text', async () => {
        await expect(am.getByTestId('campaign-master-brief')).toContainText(task.slice(0, 40))
      })
      await walk.check('the campaign row carries the new text', async () => {
        const [c] = await rows<{ brief: { task?: string; proposition?: string } | null }>('campaigns', `select=brief&id=eq.${campaignId}`)
        expect(c.brief?.task).toBe(task)
        expect(c.brief?.proposition).toBe(proposition)
      })
      await walk.check('editing the brief leaves the existing deliverable untouched', async () => {
        expect((await deliverablesOf(campaignId!)).map(strip)).toEqual(before)
      })
      const mails3 = await walk.collectMail(3_000)
      await walk.check('editing the brief sends no mail', () => { expect(mails3).toEqual([]) })

      walk.begin('Propose more deliverables from the brief — the real model, the catalogue only', PEOPLE.am2.name)
      await clearMailbox()
      const genRows = am.locator('[data-testid^="campaign-generate-row-"]')
      await untilAnswered(async () => {
        await am.getByTestId('campaign-generate-deliverables').click()
        await expect(am.getByTestId('campaign-generate-dialog')).toBeVisible()
        await expect(genRows.first().or(am.getByTestId('campaign-generate-none')).or(am.getByTestId('campaign-generate-empty'))).toBeVisible({ timeout: 120_000 })
        await am.waitForTimeout(500)
        if ((await genRows.count()) > 0) return true
        await walk.shot(am, 'propose-more-nothing', { caption: 'Nothing proposed — the dialog says so' })
        await am.getByTestId('campaign-generate-cancel').click()
        await expect(am.getByTestId('campaign-generate-dialog')).toHaveCount(0)
        return false
      }, 'Propose more deliverables', walk)
      await walk.shot(am, 'propose-more-proposed', { full: true, caption: 'What the model proposed, before anything is chosen' })
      const n = await genRows.count()
      const proposed: { id: string; name: string; flagged: boolean }[] = []
      for (let i = 0; i < n; i++) {
        const id = (await genRows.nth(i).getAttribute('data-testid'))!.replace('campaign-generate-row-', '')
        proposed.push({
          id,
          name: await am.getByTestId(`campaign-generate-name-${id}`).inputValue(),
          flagged: (await am.getByTestId(`campaign-generate-choose-${id}`).count()) > 0,
        })
      }
      walk.note(`The model proposed ${n} row(s): ${proposed.map((p) => `${p.name}${p.flagged ? ' (flagged — no catalogue match)' : ''}`).join('; ')}.`)
      await walk.check('every proposal is a catalogue entry — no row is flagged "choose a deliverable" (ADR-0097)', () => {
        expect(proposed.filter((p) => p.flagged).map((p) => p.name)).toEqual([])
      })
      await walk.check('nothing proposed duplicates what the campaign already has', () => {
        const have = before.map((d) => String(d.name).toLowerCase())
        expect(proposed.filter((p) => have.includes(p.name.toLowerCase())).map((p) => p.name)).toEqual([])
      })
      // Keep the first three unflagged, so the campaign stays readable.
      const kept = proposed.filter((p) => !p.flagged).slice(0, 3)
      expect(kept.length, 'at least one catalogue proposal to keep').toBeGreaterThan(0)
      for (const p of proposed.filter((x) => !kept.includes(x))) await am.getByTestId(`campaign-generate-remove-${p.id}`).click()
      for (const p of kept) {
        await pickPerson(am, `campaign-generate-owner-${p.id}`, PEOPLE[creativeOwnerFor(p.name)].name)
        await am.getByTestId(`campaign-generate-due-${p.id}`).fill(day(20))
      }
      await walk.shot(am, 'propose-more-filled', { full: true, caption: 'Owners and due dates named per row' })
      await am.getByTestId('campaign-generate-submit').click()
      walk.note(`The page said: “${(await closeBanner(am)).trim()}”.`)
      await am.getByTestId('campaign-tab-grid').click()
      await walk.shot(am, 'propose-more-added', { full: true, caption: 'The Grid after Add: the new deliverables with their owners' })
      const after = await deliverablesOf(campaignId!)
      const added = after.filter((d) => !before.some((b) => b.id === d.id))
      st.addedIds = added.map((d) => d.id)
      await walk.check(`${kept.length} deliverables were added, each with a catalogue type and a due date`, () => {
        expect(added).toHaveLength(kept.length)
        for (const d of added) { expect(d.deliverable_type_id, d.name).toBeTruthy(); expect(d.due_at, d.name).toBeTruthy() }
      })
      await walk.check('each added deliverable has its task list materialised', async () => {
        for (const d of added) expect((await tasksOf(d.id)).length, d.name).toBeGreaterThan(0)
      })
      await walk.check("each added deliverable's department is its owner's (ADR-0102)", async () => {
        for (const d of added) {
          const [r] = await rows<{ department_id: string | null }>('resources', `select=department_id&user_id=eq.${d.owner_user_id}&kind=eq.human&is_active=eq.true`)
          expect(d.department_id, d.name).toBe(r?.department_id ?? null)
        }
      })
      await walk.check('the original deliverable is untouched by the addition', () => {
        expect(after.filter((d) => d.id === deliverableId).map(strip)).toEqual(before.filter((d) => d.id === deliverableId))
      })
      await walk.check('the added work is NOT offered on the schedule until its owner approves the task list (ADR-0100 d.2)', async () => {
        const offered = await offeredAs('traffic', campaignId!)
        for (const d of added) expect(offered.includes(d.id), d.name).toBe(false)
      })
      const mails4 = await walk.collectMail()
      const ownerEmails = await Promise.all([...new Set(added.map((d) => d.owner_user_id))].map(async (id) => (await rows<{ email: string }>('user_profiles', `select=email&id=eq.${id}`))[0].email))
      walk.note(`New owners: ${ownerEmails.join(', ')}.`)
      await walk.check('each new owner is told — "Added to <campaign>: <deliverable>" (I53.18); nobody else', () => {
        for (const e of ownerEmails) expect(mails4.some((m) => m.to.includes(e) && /^(Added to|أُضيف إلى) /.test(m.subject)), `mail to ${e}; got: ${mails4.map((m) => `${m.to} — ${m.subject}`).join(' | ') || 'none'}`).toBe(true)
        expect(mails4.filter((m) => !ownerEmails.some((e) => m.to.includes(e))), 'mail to anyone who is not a new owner').toEqual([])
      })
      await am.context().close()

      for (const d of added) {
        const tag = await tagOfUser(d.owner_user_id)
        const p = await s.as(tag)
        await s.go(p, '/my-work')
        await expect(p.getByTestId('surface-my-work')).toBeVisible()
        await settle(p)
        await walk.shot(p, `my-work-new-owner-${tag}`, { full: true, caption: `${PEOPLE[tag].name} — Waiting for you: ${await kindsOf(p)}` })
        await walk.check(`${PEOPLE[tag].name} owes the task list of "${d.name}"`, async () => {
          await expect(p.getByTestId(`waiting-for-you-task_list-${d.id}`)).toBeVisible()
        })
        await p.context().close()
      }
    })

    test('F. phases are turned on and managed; each view follows', async () => {
      const { campaignId } = st
      walk.open(`${locale}-f`, `${L} · F. Phases`)
      walk.begin('Turn phases on for the campaign', PEOPLE.am2.name)
      const am = await s.as('am2')
      await s.go(am, `/campaigns/${campaignId}`)
      await expect(am.getByTestId('campaign-phases-on')).toBeVisible()
      await walk.shot(am, 'phases-off', { caption: 'Phases are off; the offer to turn them on beside the views' })
      await am.getByTestId('campaign-phases-on').click()
      walk.note(`The page said: “${(await closeBanner(am)).trim()}”.`)
      await expect(am.getByTestId('campaign-phases-dialog')).toBeVisible()
      await walk.shot(am, 'phases-dialog-first', { caption: 'One phase holding everything, opened for managing' })
      let phases = await rows<{ id: string; number: number; name: string }>('campaign_phases', `select=id,number,name&campaign_id=eq.${campaignId}&order=number`)
      await walk.check('turning phases on makes one phase holding every deliverable', async () => {
        expect(phases).toHaveLength(1)
        const count = await am.getByTestId(`campaign-phase-count-${phases[0].id}`).textContent()
        expect(Number(count)).toBe((await deliverablesOf(campaignId!)).length)
      })
      const NAMES = locale === 'ar' ? ['ما قبل الإطلاق', 'الأسبوع الأول', 'الأسبوع الثاني', 'ما بعد الموسم'] : ['Pre-Launch', 'Week 1', 'Week 2', 'Post-Season']
      await am.getByTestId(`campaign-phase-name-${phases[0].id}`).fill(NAMES[0])
      await am.getByTestId(`campaign-phase-start-${phases[0].id}`).fill(day(1))
      await am.getByTestId(`campaign-phase-end-${phases[0].id}`).fill(day(7))
      await am.getByTestId(`campaign-phase-save-${phases[0].id}`).click()
      await expect.poll(async () => (await rows<{ name: string }>('campaign_phases', `select=name&id=eq.${phases[0].id}`))[0].name).toBe(NAMES[0])
      for (const [i, [start, end]] of [[8, 14], [15, 21], [22, 35]].entries()) {
        await am.getByTestId('campaign-phase-add-name').fill(NAMES[i + 1])
        await am.getByTestId('campaign-phase-add-start').fill(day(start))
        await am.getByTestId('campaign-phase-add-end').fill(day(end))
        await am.getByTestId('campaign-phase-add').click()
        await expect(am.locator('[data-testid^="campaign-phase-row-"]')).toHaveCount(i + 2)
      }
      await walk.shot(am, 'phases-dialog-four', { caption: 'Renamed, re-dated, three added' })
      phases = await rows<{ id: string; number: number; name: string }>('campaign_phases', `select=id,number,name&campaign_id=eq.${campaignId}&order=number`)
      await am.getByTestId(`campaign-phase-delete-${phases[0].id}`).click()
      // The database words the refusal; the dialog hands it to the page's banner.
      await expect(am.getByTestId('campaign-banner')).toBeVisible({ timeout: 20_000 })
      await walk.shot(am, 'phases-delete-refused', { caption: 'A phase holding work cannot be deleted — said in words' })
      const refused = await closeBanner(am)
      walk.note(`Deleting the phase that holds work was refused: “${refused.trim()}”.`)
      await walk.check('a phase holding work cannot be deleted; the refusal is worded', async () => {
        expect(refused.trim().length).toBeGreaterThan(10)
        expect((await rows('campaign_phases', `select=id&id=eq.${phases[0].id}`)).length).toBe(1)
      })
      await am.getByTestId(`campaign-phase-delete-${phases[3].id}`).click()
      await expect(am.locator('[data-testid^="campaign-phase-row-"]')).toHaveCount(3)
      await walk.shot(am, 'phases-dialog-deleted-empty', { caption: 'The empty fourth phase deleted; three remain' })
      await am.getByTestId('campaign-phases-done').click()
      await expect(am.getByTestId('campaign-phases-dialog')).toHaveCount(0)
      phases = await rows<{ id: string; number: number; name: string }>('campaign_phases', `select=id,number,name&campaign_id=eq.${campaignId}&order=number`)
      st.phases = phases
      await walk.check('the Season map view appears once there are phases', async () => {
        await expect(am.getByTestId('campaign-tab-seasonMap')).toBeVisible()
      })

      walk.begin('Move deliverables to other phases — in each one’s panel', PEOPLE.am2.name)
      const dl = await deliverablesOf(campaignId!)
      await am.getByTestId('campaign-tab-grid').click()
      // The original stays in phase 1; the added ones go to 2 and 3.
      const moves = dl.slice(1).map((d, i) => ({ d, phase: phases[(i % 2) + 1] }))
      for (const [i, m] of moves.entries()) {
        await am.getByTestId(`campaign-deliverable-edit-${m.d.id}`).click()
        await expect(am.getByTestId('piece-panel')).toBeVisible()
        await am.getByTestId('piece-panel-phase').selectOption(m.phase.id)
        // I57.36 / I68.11: a later phase moves the promised date to its delivery day — asked the moment the phase is
        // picked, never passed over. "Move" puts that day in the date, and Save writes both (ADR-0132 d.3).
        await expect(am.getByTestId('piece-panel-phase-date')).toBeVisible()
        if (i === 0) await walk.shot(am, 'edit-move-phase', { caption: `The panel: "${m.d.name}" moved to ${m.phase.name} — the date follows the phase, if you say so` })
        const was = await am.getByTestId('piece-panel-due').inputValue()
        await am.getByTestId('piece-panel-phase-date-move').click()
        // The box takes the phase's day on the next render; read it once it has, not the instant after the click.
        await expect(am.getByTestId('piece-panel-due')).not.toHaveValue(was)
        const planned = await am.getByTestId('piece-panel-due').inputValue()
        if (i === 0) await walk.shot(am, 'edit-move-promised-date', { caption: 'The phase\'s delivery day in the date, checked against go-live before Save' })
        await am.getByTestId('piece-panel-save').click()
        await closeBanner(am)
        await am.getByTestId('piece-drawer-close').click()
        await expect(am.getByTestId('piece-drawer')).toHaveCount(0)
        await expect.poll(async () => (await rows<{ due_at: string | null }>('deliverables', `select=due_at&id=eq.${m.d.id}`))[0].due_at?.slice(0, 10)).toBe(planned)
        await expect.poll(async () => (await rows<{ phase_id: string }>('deliverables', `select=phase_id&id=eq.${m.d.id}`))[0].phase_id).toBe(m.phase.id)
      }
      await walk.shot(am, 'grid-spread', { full: true, caption: 'The Grid, the deliverables now across three phases' })
      await walk.check('each move is stored', async () => {
        for (const m of moves) expect((await rows<{ phase_id: string }>('deliverables', `select=phase_id&id=eq.${m.d.id}`))[0].phase_id).toBe(m.phase.id)
      })
      await am.getByTestId('campaign-phase-filter').selectOption(phases[1].id)
      await am.waitForTimeout(300)
      await walk.shot(am, 'grid-filtered', { full: true, caption: `The Grid filtered to ${phases[1].name}` })
      await walk.check("the Grid's phase filter narrows the sheet to that phase's deliverables", async () => {
        await expect(am.locator('[data-testid^="campaign-grid-status-"]')).toHaveCount(moves.filter((m) => m.phase.id === phases[1].id).length)
      })
      await am.getByTestId('campaign-phase-filter').selectOption('')
      await am.getByTestId('campaign-tab-seasonMap').click()
      await expect(am.getByTestId('campaign-panel-season-map')).toBeVisible()
      await walk.shot(am, 'season-map', { full: true, caption: 'The Season map: each phase with the deliverables it holds' })
      await walk.check('the Season map names every phase', async () => {
        for (const p of phases) await expect(am.getByTestId('campaign-panel-season-map')).toContainText(p.name)
      })

      walk.begin('The Pipeline and the schedule, by phase', PEOPLE.am2.name)
      await s.go(am, `/pipeline?campaign=${campaignId}`)
      await expect(am.getByTestId('pipeline-grid')).toBeVisible()
      await am.waitForTimeout(600)
      await walk.shot(am, 'pipeline-grid', { full: true, caption: 'The Pipeline: phases down, departments across (I53.10)' })
      await walk.check('the Pipeline grid names every phase', async () => {
        const text = (await am.getByTestId('pipeline-grid').textContent()) ?? ''
        for (const p of phases) expect(text).toContain(p.name)
      })
      await am.getByTestId('pipeline-phase').selectOption(phases[1].id)
      await am.waitForTimeout(400)
      await walk.shot(am, 'pipeline-one-phase', { caption: `The Pipeline filtered to ${phases[1].name}` })
      await s.go(am, `/schedule?view=project&campaign=${campaignId}`)
      await expect(am.getByTestId('filter-phase')).toBeVisible()
      await am.waitForTimeout(800)
      await walk.shot(am, 'schedule-project-by-phase', { caption: "The schedule's Project view with the phase filter" })
      if (locale === 'ar') await walk.check('no raw translation keys on the Pipeline / schedule (RTL)', async () => expect(await s.leakedKeys(am)).toEqual([]))
      await am.context().close()
    })

    test('G. a deliverable is added by hand on the Grid — due date required, phase taken, rename reaches tasks', async () => {
      const { campaignId, phases, title } = st
      walk.open(`${locale}-g`, `${L} · G. A deliverable is added by hand`)
      walk.begin('Add a deliverable on the Grid', PEOPLE.am2.name)
      await clearMailbox()
      const am = await s.as('am2')
      await s.go(am, `/campaigns/${campaignId}`)
      await am.getByTestId('campaign-tab-grid').click()
      await am.getByTestId('campaign-add-deliverable').click()
      await expect(am.getByTestId('campaign-deliverable-form')).toBeVisible()
      await pickDeliverable(am, 'campaign-deliverable-form-type', await typeName('CAM-004', locale))
      await am.getByTestId('campaign-deliverable-form-quantity').fill('3')
      await pickPerson(am, 'campaign-deliverable-form-owner', PEOPLE.tl.name)
      await am.getByTestId('campaign-deliverable-form-phase').selectOption(phases![0].id)
      await am.getByTestId('campaign-deliverable-form-submit').click()
      await expect(am.getByTestId('campaign-deliverable-form-error')).toBeVisible()
      await walk.shot(am, 'add-deliverable-no-date-refused', { caption: 'Without a due date: refused in the form (I53.6)' })
      await walk.check('the form refuses a deliverable without a due date', async () => {
        await expect(am.getByTestId('campaign-deliverable-form-error')).toBeVisible()
      })
      // A date past the phase's end: warned, recorded, allowed.
      await am.getByTestId('campaign-deliverable-form-due').fill(day(9))
      await expect(am.getByTestId('campaign-deliverable-form-phase-warning')).toBeVisible()
      await walk.shot(am, 'add-deliverable-past-phase-end', { caption: 'A due date after the phase ends: warned, not refused' })
      await am.getByTestId('campaign-deliverable-form-submit').click()
      walk.note(`The page said: “${(await closeBanner(am)).trim()}”.`)
      await walk.shot(am, 'add-deliverable-added', { full: true, caption: 'Added: the key visual × 3, in the first phase' })
      const dl = await deliverablesOf(campaignId!)
      const kv = dl.find((d) => d.quantity === 3 && d.phase_id === phases![0].id && !(st.addedIds ?? []).includes(d.id))
      expect(kv, 'the added deliverable').toBeTruthy()
      st.keyVisualId = kv!.id
      const [creative] = await rows<{ id: string }>('departments', 'select=id&name=eq.Creative')
      await walk.check("the row landed with quantity 3, the chosen phase and the date — in its owner's department, Creative (ADR-0102)", () => {
        expect(kv!.department_id).toBe(creative.id)
        expect(kv!.due_at?.slice(0, 10)).toBe(day(9))
      })
      await walk.check('its task list is materialised from the catalogue entry', async () => {
        expect((await tasksOf(kv!.id)).length).toBeGreaterThan(0)
      })
      await walk.check('the quantity is printed beside its name (I53.14)', async () => {
        await expect(am.getByTestId(`campaign-deliverable-qty-${kv!.id}`)).toContainText('3')
      })
      await walk.check('the past-phase-end override is recorded', async () => {
        const ev = await rows<{ event_type: string }>('sla_events', `select=event_type&deliverable_id=eq.${kv!.id}`)
        expect(ev.length, `events: ${ev.map((e) => e.event_type).join(', ')}`).toBeGreaterThan(0)
      })
      const mails = await walk.collectMail()
      await walk.check(`the new owner (${PEOPLE.tl.email}) is told "Added to …" and nobody else (I53.18)`, () => {
        expect(mails.map((m) => m.to), `got: ${mails.map((m) => `${m.to} — ${m.subject}`).join(' | ') || 'none'}`).toEqual([PEOPLE.tl.email])
        expect(mails[0]!.subject).toMatch(new RegExp(`^(Added to|أُضيف إلى) ${rx(title!)}: `))
      })

      walk.begin('Rename the deliverable — its tasks follow', PEOPLE.am2.name)
      const titlesBefore = (await tasksOf(kv!.id)).map((t) => t.title)
      const newName = locale === 'ar' ? 'التصميم الأساسي — الموسم الثاني' : 'Season 2 key visual'
      await am.getByTestId(`campaign-deliverable-edit-${kv!.id}`).click()
      await expect(am.getByTestId('piece-panel')).toBeVisible()
      await am.getByTestId('piece-panel-name').fill(newName)
      await walk.shot(am, 'rename-deliverable', { caption: 'The panel: the name' })
      await am.getByTestId('piece-panel-save').click()
      await closeBanner(am)
      await am.getByTestId('piece-drawer-close').click()
      await expect(am.getByTestId('piece-drawer')).toHaveCount(0)
      await walk.check("the tasks' titles follow the rename (ADR-0071 addendum)", async () => {
        await expect.poll(async () => (await tasksOf(kv!.id)).map((t) => t.title).sort(), { timeout: 15_000 })
          .toEqual(titlesBefore.map((t) => t.replace(kv!.name, newName)).sort())
      })
      await am.getByTestId(`campaign-deliverable-open-${kv!.id}`).click()
      await expect(am.getByTestId('piece-drawer')).toBeVisible()
      await walk.shot(am, 'renamed-drawer', { caption: 'The deliverable drawer: the new name, its tasks under it' })
      await walk.check('the drawer shows the new name', async () => {
        await expect(am.getByTestId('piece-drawer')).toContainText(newName)
      })
      await am.getByTestId('piece-drawer-close').click()
      await am.context().close()
    })

    test('H. each owner approves the new task lists on the Grid; the schedule then offers the work', async () => {
      const { campaignId, addedIds, keyVisualId } = st
      walk.open(`${locale}-h`, `${L} · H. The owners approve the new task lists`)
      const pending = (await deliverablesOf(campaignId!)).filter((d) => [...(addedIds ?? []), keyVisualId].includes(d.id) && !d.tasks_approved_at)
      expect(pending.length, 'task lists waiting').toBeGreaterThan(0)
      const byOwner = new Map<string, typeof pending>()
      for (const d of pending) byOwner.set(d.owner_user_id, [...(byOwner.get(d.owner_user_id) ?? []), d])
      for (const [ownerId, list] of byOwner) {
        const tag = await tagOfUser(ownerId)
        walk.begin(`${PEOPLE[tag].name} approves ${list.length === 1 ? 'a task list' : `${list.length} task lists`} on the Grid`, PEOPLE[tag].name)
        const p = await s.as(tag)
        await s.go(p, `/campaigns/${campaignId}`)
        await p.getByTestId('campaign-tab-grid').click()
        await expect(p.getByTestId('campaign-task-lists')).toBeVisible()
        for (const d of list) await expect(p.getByTestId(`campaign-task-lists-approve-${d.id}`)).toBeVisible()
        await walk.shot(p, `task-lists-${tag}`, { full: true, caption: `${PEOPLE[tag].name}'s task lists waiting, above the Grid` })
        await walk.check('the lists owned by somebody else say whose they are, and offer no Approve', async () => {
          for (const other of pending.filter((d) => d.owner_user_id !== ownerId)) {
            await expect(p.getByTestId(`campaign-task-lists-approve-${other.id}`)).toHaveCount(0)
          }
        })
        for (const d of list) {
          await p.getByTestId(`campaign-task-lists-approve-${d.id}`).click()
          await expect.poll(async () => (await rows<{ tasks_approved_at: string | null }>('deliverables', `select=tasks_approved_at&id=eq.${d.id}`))[0].tasks_approved_at).toBeTruthy()
        }
        await walk.shot(p, `task-lists-${tag}-approved`, { full: true, caption: 'Approved' })
        await p.context().close()
      }
      walk.begin('The schedule now offers every deliverable', PEOPLE.traffic.name)
      await walk.check('every deliverable on the campaign is offered for assignment', async () => {
        const offered = await offeredAs('traffic', campaignId!)
        for (const d of await deliverablesOf(campaignId!)) expect(offered.includes(d.id), d.name).toBe(true)
      })
      const traffic = await s.as('traffic')
      await s.go(traffic, `/campaigns/${campaignId}`)
      await traffic.getByTestId('campaign-tab-grid').click()
      await walk.shot(traffic, 'grid-all-approved', { full: true, caption: 'The Grid with every task list approved' })
      await walk.check('the Grid shows no task list waiting', async () => {
        await expect(traffic.getByTestId('campaign-task-lists-waiting')).toHaveCount(0)
      })
      await traffic.context().close()
    })

    test('I. the final state — every My Work and inbox', async () => {
      const { title } = st
      walk.open(`${locale}-i`, `${L} · I. The final state`)
      walk.begin('The final state, seen by everyone', 'everyone')
      for (const tag of ['am2', 'lead', 'tl', 'motiontl', 'copytl', 'studiotl', 'content', 'admin', 'maker', 'am'] as const) {
        const p = await s.as(tag)
        await s.go(p, '/my-work')
        await expect(p.getByTestId('surface-my-work')).toBeVisible()
        const kinds = await kindsOf(p)
        await walk.shot(p, `final-my-work-${tag}`, { full: true, caption: `${PEOPLE[tag].name} (${PEOPLE[tag].role}) — Waiting for you: ${kinds}` })
        await walk.check(`${PEOPLE[tag].name} owes nothing more on "${title}"`, async () => {
          // I59.10: the approval rows of Needs you (its maker items may name the job, as they should).
          const text = (await p.locator('[data-testid^="waiting-for-you-"]').allTextContents()).join(' ')
          expect(text).not.toContain(title!)
        })
        if (locale === 'ar') await walk.check(`no raw translation keys on ${PEOPLE[tag].name}'s My Work (RTL)`, async () => expect(await s.leakedKeys(p)).toEqual([]))
        await p.context().close()
      }
      await walk.check('every mail sent in this walk has its in-app notification for the same person', async () => {
        const mails = walk.report.chapters.filter((c) => c.key.startsWith(locale)).flatMap((c) => c.steps.flatMap((x) => x.mails))
        for (const m of mails) {
          const [u] = await rows<{ id: string }>('user_profiles', `select=id&email=eq.${encodeURIComponent(m.to)}`)
          // The walk stamps its start on THIS machine's clock; notifications carry the DATABASE's. The
          // local Docker clock drifts (5.4s behind on 26 Sep), so a notification raised in the walk's first
          // seconds read as earlier than the start and this check failed with the row right there. A minute
          // of allowance, and the notification must name what the mail is about — so a stray row from an
          // earlier run cannot pass it.
          const since = new Date(Date.parse(walk.report.started) - 60_000).toISOString()
          const n = (await rows<{ label: string | null }>('notifications', `select=label&user_id=eq.${u.id}&created_at=gte.${since}`))
            .filter((r) => r.label && m.subject.includes(r.label))
          expect(n.length, `${m.to}: ${m.subject}`).toBeGreaterThan(0)
        }
      })
    })

    test('J. a fresh campaign through the wizard, with phases — the real model', async () => {
      walk.open(`${locale}-j`, `${L} · J. A campaign through the wizard, with phases`)
      walk.begin('Step 1 — the campaign, with four phases', PEOPLE.am2.name)
      const name = await uniqueTitle(TITLES.wizard)
      const am = await s.as('am2')
      await s.go(am, '/campaigns')
      const PH = locale === 'ar'
        ? [['ما قبل الإطلاق', 1, 7], ['الأسبوع الأول', 8, 14], ['الأسبوع الثاني', 15, 21], ['الأسبوعان ٣–٤', 22, 35]] as const
        : [['Pre-Launch', 1, 7], ['Week 1', 8, 14], ['Week 2', 15, 21], ['Weeks 3–4', 22, 35]] as const
      await startCampaign(am, {
        name,
        client: 'Luma Retail',
        brand: null,
        phases: PH.map(([n, a, b]) => ({ name: n, startsOn: day(a), endsOn: day(b) })),
      })
      walk.note('Step 1 was filled — client, name, four phases — and left with Next; the brief follows.')

      walk.begin('Step 2 — the brief', PEOPLE.am2.name)
      const B = locale === 'ar' ? {
        background: 'جعل الموسم الأول من لوما محفظة سوبر كايت حديث الناس ليلة الجمعة. الموسم الثاني يقدّم أربعة سحوبات أسبوعية من الإطلاق، مباشرة على قناة الربيعة وببثّ متزامن داخل التطبيق.',
        task: 'أعد الناس للوما في الموسم الثاني وحافظ على شرائهم خلال السحوبات الأربعة — إعلان تشويقي قبل الإطلاق، ثم إيقاع من المنشورات والتذكيرات وقصص الفائزين كل أسبوع.',
        proposition: 'كل عملية شراء تذكرة. كل جمعة سحب.',
      } : {
        background: 'Season 1 of LUMA made SuperKite the wallet people talk about on a Friday night. Season 2 runs four weekly draws from launch, live on Al Rabiaa TV with a simultaneous stream inside the app.',
        task: 'Bring people back for Season 2 and keep them buying through the four draws — a teaser before launch, then a rhythm of posts, reminders and winner stories every week.',
        proposition: 'Every purchase is a ticket. Every Friday is a draw.',
      }
      for (const [k, v] of Object.entries(B)) await am.getByTestId(`wizard-brief-${k}`).fill(v)
      await walk.shot(am, 'wizard-step2-brief', { full: true, caption: 'Step 2 — the brief' })

      walk.begin('Step 3 — the work the real model proposed; every piece owned', PEOPLE.am2.name)
      await untilAnswered(async () => {
        await am.getByTestId('wizard-next').click()
        await expect(am.getByTestId('wizard-step-3')).toBeVisible()
        // Wait for the ANSWER — pieces on the step, or the product saying the call failed — not
        // merely for the busy dialog to be gone: it may not have appeared yet.
        const pieces = am.locator('[data-testid^="wizard-work-piece-"]')
        await expect(pieces.first().or(am.getByTestId('wizard-error'))).toBeVisible({ timeout: 120_000 })
        await expect(am.getByTestId('wizard-busy-propose')).toHaveCount(0, { timeout: 120_000 })
        if ((await pieceIds(am)).length > 0) return true
        // The service could not be reached: the product says so; close it, go back, ask again.
        if (await am.getByTestId('wizard-error').isVisible()) await am.getByTestId('wizard-error-close').click()
        if (await am.getByTestId('wizard-step-3').isVisible()) {
          await am.getByTestId('wizard-back').click()
          await expect(am.getByTestId('wizard-step-2')).toBeVisible()
        }
        return false
      }, 'the wizard’s proposal', walk)
      await walk.shot(am, 'wizard-step3-proposed', { full: true, caption: 'Step 3 — what the real model proposed, grouped' })
      const ids = await pieceIds(am)
      walk.note(`The model proposed ${ids.length} piece(s).`)
      // Keep six, so the campaign stays readable; the rest are removed with the reason the step asks for.
      for (const id of ids.slice(6)) {
        await am.getByTestId(`wizard-work-remove-${id}`).click()
        await am.getByTestId('wizard-remove-piece-reason').fill('Kept the walk to six pieces.')
        await am.getByTestId('wizard-remove-piece-confirm').click()
        await expect(am.getByTestId(`wizard-work-piece-${id}`)).toHaveCount(0)
      }
      for (const id of ids.slice(0, 6)) {
        await am.getByTestId(`wizard-work-edit-${id}`).click()
        await expect(am.getByTestId('wizard-piece-dialog')).toBeVisible()
        const pieceName = await am.getByTestId('wizard-piece-name').inputValue()
        // ADR-0128: the list offers only the leads of the piece's workstream's department, and the real model decides
        // which department each piece's workstream is — so the discipline's lead when offered, else the first lead there.
        const offered = (await am.getByTestId('wizard-piece-owner').locator('option').allTextContents()).map((x) => x.trim()).filter(Boolean)
        const wanted = PEOPLE[ownerFor(pieceName)].name
        const leads = offered.filter((o) => Object.values(PEOPLE).some((p) => p.name === o))
        expect(leads.length, `"${pieceName}": its workstream offers at least one lead`).toBeGreaterThan(0)
        const owner = leads.includes(wanted) ? wanted : leads[0]!
        if (owner !== wanted) walk.note(`"${pieceName}" is in a workstream whose department's leads do not include ${wanted}; ${owner} was chosen (ADR-0128).`)
        await am.getByTestId('wizard-piece-owner').selectOption({ label: owner })
        const type = am.getByTestId('wizard-piece-type')
        if ((await type.inputValue()) === '') {
          walk.note(`OBSERVE: "${pieceName}" arrived with no catalogue type (ADR-0097 d.4); the first was chosen.`)
          await type.selectOption({ index: 1 })
        }
        const phase = am.getByTestId('wizard-piece-phase')
        if ((await phase.inputValue()) === '') await phase.selectOption({ index: 2 })
        await am.getByTestId('wizard-piece-save').click()
        await expect(am.getByTestId('wizard-piece-dialog')).toHaveCount(0)
      }
      for (const sel of await am.locator('select[data-testid^="wizard-work-dept-"]').all()) {
        if ((await sel.inputValue()) === '') await sel.selectOption({ index: 1 })
      }
      await walk.check('every proposal is a catalogue entry (ADR-0097)', async () => {
        await expect(am.locator('[data-testid^="wizard-work-warn-"]')).toHaveCount(0)
      })
      await walk.shot(am, 'wizard-step3-owned', { full: true, caption: 'Step 3 — every piece owned, in a phase' })
      await am.getByTestId('wizard-next').click()
      await expect(am.getByTestId('wizard-step-4')).toBeVisible()

      walk.begin('Step 4 — timing, counted back from each phase', PEOPLE.am2.name)
      await walk.shot(am, 'wizard-step4-timing', { full: true, caption: 'Step 4 — each phase planned back from its end' })
      await walk.check('no piece is left outside a phase', async () => {
        await expect(am.getByTestId('wizard-timing-unplaced')).toHaveCount(0)
      })

      walk.begin('Step 5 — review, and approve', PEOPLE.am2.name)
      await clearMailbox()
      await am.getByTestId('wizard-next').click()
      await expect(am.getByTestId('wizard-step-5')).toBeVisible()
      await walk.shot(am, 'wizard-step5-review', { full: true, caption: 'Step 5 — what approving does, before it is pressed' })
      await am.getByTestId('wizard-review-approve').click()
      await expect(am).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/, { timeout: 30_000 })
      const wid = am.url().split('/').pop()!
      await expect(am.getByTestId('campaign-tabs')).toBeVisible()
      await walk.shot(am, 'wizard-campaign-page', { full: true, caption: 'The campaign, approved — its Grid, with each owner’s task lists waiting' })
      const dl = await deliverablesOf(wid)
      await walk.check('every deliverable has a phase, an owner, a type and a due date', () => {
        expect(dl.length).toBeGreaterThan(0)
        for (const d of dl) { expect(d.phase_id, d.name).toBeTruthy(); expect(d.owner_user_id, d.name).toBeTruthy(); expect(d.deliverable_type_id, d.name).toBeTruthy(); expect(d.due_at, d.name).toBeTruthy() }
      })
      await walk.check("each deliverable's department is its owner's (ADR-0102)", async () => {
        for (const d of dl) {
          const [r] = await rows<{ department_id: string | null }>('resources', `select=department_id&user_id=eq.${d.owner_user_id}&kind=eq.human&is_active=eq.true`)
          expect(d.department_id, d.name).toBe(r?.department_id ?? null)
        }
      })
      const mails = await walk.collectMail(8_000)
      const ownerIds = [...new Set(dl.map((d) => d.owner_user_id))]
      const ownerEmails = await Promise.all(ownerIds.map(async (id) => (await rows<{ email: string }>('user_profiles', `select=email&id=eq.${id}`))[0].email))
      walk.note(`${dl.length} deliverables across ${ownerIds.length} owner(s): ${ownerEmails.join(', ')}.`)
      await walk.check('ONE mail per owner — "Approved: <campaign> — you own N deliverables" — and nobody else (I53.19)', () => {
        expect([...new Set(mails.map((m) => m.to))].sort()).toEqual([...ownerEmails].sort())
        expect(mails.length).toBe(ownerIds.length)
        for (const m of mails) expect(m.subject).toMatch(new RegExp(`^(Approved: ${rx(name)} — you own \\d+ deliverables?|تمت الموافقة: ${rx(name)} — لديك \\d+ مُخرج(ات)?)$`))
      })
      await walk.check('the approval asks for task lists only — no department brief (ADR-0100)', () => {
        for (const m of mails) expect(m.snippet).not.toMatch(/department brief|موجز القسم/i)
      })
      await am.context().close()

      for (const ownerId of ownerIds.slice(0, 3)) {
        const tag = await tagOfUser(ownerId)
        const p = await s.as(tag)
        await s.go(p, '/my-work')
        await expect(p.getByTestId('surface-my-work')).toBeVisible()
        await settle(p)
        await walk.shot(p, `wizard-my-work-${tag}`, { full: true, caption: `${PEOPLE[tag].name} — Waiting for you: ${await kindsOf(p)}` })
        await walk.check(`${PEOPLE[tag].name} owes the task list of each deliverable they own, and no brief`, async () => {
          for (const d of dl.filter((x) => x.owner_user_id === ownerId)) await expect(p.getByTestId(`waiting-for-you-task_list-${d.id}`)).toBeVisible()
          await expect(p.locator('[data-testid^="waiting-for-you-department_brief"]')).toHaveCount(0)
        })
        await p.context().close()
      }
    })
  })
}
