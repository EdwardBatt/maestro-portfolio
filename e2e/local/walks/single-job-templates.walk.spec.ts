import { test, expect, type Browser, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { authFile, PEOPLE } from '../fixtures'
import { rows } from '../helpers/db'
import { dueInTwoWeeks, nextToReview, pickJobLanguages } from '../helpers/single-job'

/**
 * Review walk — one single job per kind of brief (Figma `B · SINGLE JOB — BRIEF FIRST`, 22 Sep).
 *
 * Edward, 22 Sep: *"do an automation to create a single job using a template of each type so I can
 * review each screenshot… as a document with steps and screenshots."* For every active template
 * the tenant has, the walk goes SJ-v3-01 → the brief → Who and when → Review and open, as the
 * account manager, filling every field, and photographs each screen. The modals (S2 under the lead
 * time, S1 similar job, S4 add a brand) do not depend on the template, so they are walked once, on
 * the first template. Nothing is opened: every job is left as a draft, so the local stack is not
 * filled with released jobs and their notifications.
 *
 * Run: `WALK=1 npx playwright test --config playwright.local.config.ts e2e/local/walks/single-job-templates.walk.spec.ts`
 * Writes `Claude outputs/reports/<date>-templates/REPORT.md` and the screenshots, and `REPORT.html` —
 * self-contained, the screenshots embedded, so the one file can be sent to a reviewer.
 */
const WALK = process.env.WALK === '1'
const LOCALES = (process.env.WALK_LOCALES ?? 'en').split(',') as Array<'en' | 'ar'>
const DATE = process.env.WALK_DATE ?? new Date().toISOString().slice(0, 10)
const OUT = path.resolve('Claude outputs', 'reports', `${DATE}-templates`)
/** Templates left behind by the coverage suites (`cov_…`) are not the tenant's — skipped, and said so. */
const RESIDUE = /^cov_/

interface Check { title: string; ok: boolean; detail?: string }
interface Step { n: number; title: string; actor: string; notes: string[]; shots: string[]; checks: Check[] }
interface Chapter { key: string; title: string; steps: Step[] }
interface Report { started: string; locales: Record<string, Chapter[]> }
interface State { shot: number; done: string[] }
const reportFile = path.join(OUT, 'report.json')
const stateFile = (locale: string) => path.join(OUT, `state-${locale}.json`)
function loadReport(): Report {
  if (existsSync(reportFile)) return JSON.parse(readFileSync(reportFile, 'utf8')) as Report
  return { started: new Date().toISOString(), locales: {} }
}
function loadState(locale: string): State {
  if (existsSync(stateFile(locale))) return JSON.parse(readFileSync(stateFile(locale), 'utf8')) as State
  return { shot: 0, done: [] }
}

class Walk {
  report: Report
  chapters: Chapter[]
  chapter!: Chapter
  state: State
  step!: Step
  constructor(readonly locale: 'en' | 'ar') {
    mkdirSync(path.join(OUT, locale), { recursive: true })
    this.report = loadReport()
    this.chapters = this.report.locales[locale] ??= []
    this.state = loadState(locale)
  }
  open(key: string, title: string) {
    const existing = this.chapters.find((c) => c.key === key)
    if (existing) existing.steps = []
    this.chapter = existing ?? { key, title, steps: [] }
    if (!existing) this.chapters.push(this.chapter)
    this.flush()
  }
  begin(title: string, actor: string) {
    this.step = { n: this.chapter.steps.length + 1, title, actor, notes: [], shots: [], checks: [] }
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
    this.state.shot += 1
    const name = `${String(this.state.shot).padStart(3, '0')}-${slug}.png`
    await page.addStyleTag({ content: '[data-testid="environment-bar"]{display:none!important}' }).catch(() => {})
    if (opts.full) {
      await page.addStyleTag({ content: '.shell{block-size:auto!important;overflow:visible!important}.shell-main{overflow:visible!important}' }).catch(() => {})
    }
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(OUT, this.locale, name), fullPage: opts.full ?? false })
    if (opts.full) {
      await page.evaluate(() => { const tags = document.querySelectorAll('style'); tags[tags.length - 1]?.remove() }).catch(() => {})
    }
    this.step.shots.push(`${this.locale}/${name}${opts.caption ? `|${opts.caption}` : ''}`)
    this.save()
    this.flush()
  }
  save() { writeFileSync(stateFile(this.locale), JSON.stringify(this.state, null, 2)) }
  flush() {
    mkdirSync(OUT, { recursive: true })
    writeFileSync(reportFile, JSON.stringify(this.report, null, 2))
    writeFileSync(path.join(OUT, 'REPORT.md'), renderMarkdown(this.report))
    writeFileSync(path.join(OUT, 'REPORT.html'), renderHtml(this.report))
  }
}

function renderMarkdown(r: Report): string {
  const out: string[] = []
  out.push(`# Single job, brief first — one job per kind of brief (branch \`flows-22-sep\`)`)
  out.push('')
  out.push(`Started ${r.started.slice(0, 16).replace('T', ' ')} UTC on the local stack, as the account manager. Every screenshot is the state AFTER the step completed. The jobs are left as drafts — nothing was opened.`)
  out.push('')
  let pass = 0, fail = 0
  for (const chapters of Object.values(r.locales)) for (const c of chapters) for (const s of c.steps) for (const k of s.checks) { if (k.ok) pass++; else fail++ }
  out.push(`**Checks: ${pass} passed, ${fail} failed.**`)
  out.push('')
  for (const [locale, chapters] of Object.entries(r.locales)) {
    out.push(`## ${locale === 'ar' ? 'Arabic / RTL walk' : 'English walk'}`)
    out.push('')
    out.push('Contents:', '')
    for (const c of chapters) out.push(`- [${c.title}](#${c.key.replace(/[^a-z0-9]+/gi, '-').toLowerCase()})`)
    out.push('')
    for (const c of chapters) {
      out.push(`<a id="${c.key.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}"></a>`, '')
      out.push(`## ${c.title}`, '')
      for (const s of c.steps) {
        out.push(`### ${s.n}. ${s.title}`)
        out.push(`*As ${s.actor}.*`, '')
        for (const n of s.notes) out.push(n, '')
        for (const shot of s.shots) {
          const [file, caption] = shot.split('|')
          out.push(`![${caption ?? file}](${file})`)
          if (caption) out.push(`*${caption}*`)
          out.push('')
        }
        for (const k of s.checks) {
          out.push(`- ${k.ok ? '✅' : '❌'} ${k.title}`)
          if (!k.ok && k.detail) out.push('', '  ```', ...k.detail.split('\n').map((l) => `  ${l}`), '  ```', '')
        }
        if (s.checks.length) out.push('')
      }
    }
  }
  return out.join('\n')
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
function renderHtml(r: Report): string {
  const out: string[] = []
  out.push('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Single job, brief first — one job per kind of brief</title>')
  out.push('<style>body{font:15px/1.5 system-ui,sans-serif;max-width:1180px;margin:32px auto;padding:0 24px;color:#1d1d1f}img{max-width:100%;border:1px solid #ddd;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.08);margin:8px 0}figcaption{color:#666;font-style:italic;margin-bottom:24px}h2{margin-top:56px;border-top:1px solid #e5e5e5;padding-top:24px}h3{margin-top:32px}.ok{color:#1a7f37}.bad{color:#b42318}pre{background:#f6f6f6;padding:8px 12px;border-radius:6px;font-size:13px}nav ol{columns:2}</style></head><body>')
  out.push(`<h1>Single job, brief first — one job per kind of brief</h1>`)
  out.push(`<p>Started ${esc(r.started.slice(0, 16).replace('T', ' '))} UTC on the local stack, as the account manager. Every screenshot is the state <b>after</b> the step completed. The jobs are left as drafts — nothing was opened.</p>`)
  for (const [locale, chapters] of Object.entries(r.locales)) {
    out.push(`<h2>${locale === 'ar' ? 'Arabic / RTL walk' : 'English walk'}</h2><nav><ol>`)
    for (const c of chapters) out.push(`<li><a href="#${esc(c.key)}">${esc(c.title)}</a></li>`)
    out.push('</ol></nav>')
    for (const c of chapters) {
      out.push(`<h2 id="${esc(c.key)}">${esc(c.title)}</h2>`)
      for (const s of c.steps) {
        out.push(`<h3>${s.n}. ${esc(s.title)}</h3><p><i>As ${esc(s.actor)}.</i></p>`)
        for (const n of s.notes) out.push(`<p>${esc(n)}</p>`)
        for (const shot of s.shots) {
          const [file, caption] = shot.split('|')
          // Embedded, not linked: the one file is shared on its own (Edward, 22 Sep — a linked
          // report sent to a reviewer arrived without its pictures).
          const png = path.join(OUT, file)
          const src = existsSync(png) ? `data:image/png;base64,${readFileSync(png).toString('base64')}` : file
          out.push(`<figure><img src="${src}" alt="${esc(caption ?? file)}" loading="lazy">${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}</figure>`)
        }
        if (s.checks.length) {
          out.push('<ul>')
          for (const k of s.checks) out.push(`<li class="${k.ok ? 'ok' : 'bad'}">${k.ok ? '✅' : '❌'} ${esc(k.title)}${!k.ok && k.detail ? `<pre>${esc(k.detail)}</pre>` : ''}</li>`)
          out.push('</ul>')
        }
      }
    }
  }
  out.push('</body></html>')
  return out.join('\n')
}

// ------------------------------------------------------------------------------ the helpers ----
type Tag = keyof typeof PEOPLE
interface TemplateField { key: string; en: string; ar?: string; essential?: boolean; guidance?: string }
interface Template { brief_type: string; name_en: string; name_ar: string | null; fields: TemplateField[] }

class Session {
  constructor(readonly browser: Browser, readonly walk: Walk) {}
  async as(tag: Tag): Promise<Page> {
    const ctx = await this.browser.newContext({ storageState: authFile(tag), viewport: { width: 1440, height: 1000 } })
    return ctx.newPage()
  }
  /** Navigate; make sure the page is in the walk's language (the profile remembers the last choice). */
  async go(page: Page, url: string) {
    await page.goto(url)
    await page.getByTestId('locale-toggle').first().waitFor({ state: 'visible', timeout: 15_000 })
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(400)
    const want = this.walk.locale === 'ar' ? 'rtl' : 'ltr'
    if ((await page.locator('html').getAttribute('dir')) !== want) {
      await page.getByTestId('locale-toggle').first().click()
      await expect(page.locator('html')).toHaveAttribute('dir', want)
    }
  }
}

/** Tomorrow — always short of any lead time, so S2 shows. */
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
/** Sample text for a brief field: the field's own name, so the reviewer sees which is which. */
function sampleFor(f: TemplateField, locale: 'en' | 'ar'): string {
  const label = locale === 'ar' && f.ar ? f.ar : f.en
  return locale === 'ar' ? `${label} — نص تجريبي للمراجعة.` : `${label} — sample text for the review walk.`
}
async function typeName(code: string): Promise<string> {
  const [t] = await rows<{ name_en: string }>('deliverable_types', `select=name_en&code=eq.${code}`)
  return t.name_en
}
/** The newest open Northwind single job with a live deliverable — the S1 prompt needs one. */
async function lookalikeTitle(): Promise<string | null> {
  const [c] = await rows<{ name: string }>('campaigns',
    'select=name,clients!inner(name),streams!inner(deliverables!inner(state))&clients.name=eq.Northwind%20Beverages&status=eq.approved&kind=eq.single_job&streams.deliverables.state=in.(draft,in_progress,in_review,blocked)&order=created_at.desc&limit=1')
  return c?.name ?? null
}
async function uniqueTitle(base: string): Promise<string> {
  let title = base
  for (let i = 2; (await rows('campaigns', `select=id&name=eq.${encodeURIComponent(title)}`)).length > 0; i++) title = `${base} (${i})`
  return title
}

// ---------------------------------------------------------------------------------- the walk ----
for (const locale of LOCALES) {
  test.describe(`Review walk (${locale}) — one single job per kind of brief`, () => {
    test.skip(!WALK, 'WALK=1 runs the review walk')
    test.setTimeout(20 * 60_000)
    test.use({ actionTimeout: 15_000 })
    let walk: Walk
    let s: Session
    test.beforeEach(({ browser }) => { walk = new Walk(locale); s = new Session(browser, walk) })

    test('every kind of brief, first screen to review', async () => {
      const all = await rows<Template>('brief_templates', 'select=brief_type,name_en,name_ar,fields&is_active=eq.true&order=created_at')
      const templates = all.filter((t) => Array.isArray(t.fields) && t.fields.length > 0 && !RESIDUE.test(t.brief_type))
      const skipped = all.filter((t) => !templates.includes(t)).map((t) => t.brief_type)
      const typeName003 = await typeName('ADV-003')
      const am = await s.as('am')

      for (const [i, tpl] of templates.entries()) {
        const first = i === 0
        const name = locale === 'ar' && tpl.name_ar ? tpl.name_ar : tpl.name_en
        walk.open(tpl.brief_type, `${i + 1}. ${tpl.name_en} (\`${tpl.brief_type}\`) — ${tpl.fields.length} fields, ${tpl.fields.filter((f) => f.essential).length} essential`)
        const title = await uniqueTitle(`${tpl.name_en} — review walk`)

        // ---- SJ-v3-01: what are we making ----
        walk.begin('SJ-v3-01 — What are we making?', PEOPLE.am.name)
        walk.note(`Client Northwind Beverages; asked by "Ahmed Al-Sayed" over WhatsApp; the words of the request typed; the card "${tpl.name_en}" chosen.${first ? ' The S4 "Add a brand" dialog is opened from the brand list and closed again, unused.' : ''}${skipped.length && first ? ` Templates skipped as test residue: ${skipped.join(', ')}.` : ''}`)
        await s.go(am, '/campaigns/new-job')
        await am.getByTestId('sj-client').selectOption({ label: 'Northwind Beverages' })
        await am.getByTestId('sj-asked-by').fill('Ahmed Al-Sayed')
        await am.getByTestId('sj-source').selectOption('whatsapp')
        await am.getByTestId('sj-words').fill(locale === 'ar'
          ? `طلب العميل: ${name} لمجموعة الصيف — انظر الرسالة المرفقة.`
          : `The client asked for a ${tpl.name_en.toLowerCase()} for the summer range — see the message attached.`)
        if (first) {
          await walk.shot(am, 'screen-1-before-choice', { full: true, caption: 'Screen 1 before a card is chosen: For whom, How it came in, INHERITS, and every template the tenant has' })
          // S4 — add a brand: the dialog opens from the brand list; closed unused.
          await am.getByTestId('sj-brand').selectOption('__add_brand__')
          await expect(am.getByTestId('add-brand-dialog')).toBeVisible()
          await am.getByTestId('add-brand-name').fill('Northwind Zero')
          await walk.shot(am, 's4-add-brand', { caption: 'S4 — Add a brand, opened from the brand list (closed without saving)' })
          await am.getByTestId('add-brand-cancel').click()
          await expect(am.getByTestId('add-brand-dialog')).toHaveCount(0)
        }
        const card = am.getByTestId(`sj-brief-card-${tpl.brief_type}`)
        await card.scrollIntoViewIfNeeded()
        await card.click()
        await expect(card).toHaveAttribute('aria-pressed', 'true')
        await walk.shot(am, `${tpl.brief_type}-01-chosen`, { full: true, caption: `Screen 1 with "${tpl.name_en}" pressed; Next names the choice` })
        await walk.check('the INHERITS line counts the client profile’s dos and don’ts', async () => {
          await expect(am.getByTestId('sj-inherits')).toBeVisible()
        })

        // ---- SJ-v3-02: the brief ----
        walk.begin('SJ-v3-02 — The brief, in the template’s colour', PEOPLE.am.name)
        await am.getByTestId('sj-next').click()
        await expect(am.getByTestId('sj-brief')).toBeVisible({ timeout: 20_000 })
        await am.waitForLoadState('networkidle').catch(() => {})
        await walk.shot(am, `${tpl.brief_type}-02-empty`, { full: true, caption: 'The brief on arrival: the rail with counts, The essentials, The rest, the risk line, the dos and don’ts, attachments' })
        for (const f of tpl.fields) {
          const box = am.getByTestId(`sj-field-${f.key}`)
          await box.scrollIntoViewIfNeeded()
          await box.fill(sampleFor(f, locale))
        }
        await am.getByTestId('sj-risk').fill(locale === 'ar' ? 'الموعد قريب من عطلة العيد.' : 'The date sits close to the Eid break.')
        await am.getByTestId('sj-brief-nav-essentials').click()
        await am.waitForTimeout(1_500)   // the autosave (1.2 s) writes "Saved"
        await walk.shot(am, `${tpl.brief_type}-02-filled`, { full: true, caption: `Every field filled — ${tpl.fields.length} fields, ${tpl.fields.filter((f) => f.essential).length} essential; filled fields carry the template’s hue` })
        await walk.check('the rail counts every essential and every rest field as filled', async () => {
          const ess = tpl.fields.filter((f) => f.essential).length
          const essentials = ess > 0 ? ess : Math.min(4, tpl.fields.length)   // no tick → the first four
          const rest = tpl.fields.length - essentials
          await expect(am.getByTestId('sj-brief-nav-essentials')).toContainText(`${essentials}`)
          await expect(am.getByTestId('sj-brief-nav-rest')).toContainText(`${rest}`)
        })
        walk.note(`Fields, in order: ${tpl.fields.map((f) => `${f.en}${f.essential ? ' (essential)' : ''}`).join(' · ')}.`)

        // ---- SJ-v3-04: who and when ----
        walk.begin('SJ-v3-04 — Who and when', PEOPLE.am.name)
        await am.getByTestId('sj-next').click()
        await expect(am.getByTestId('sj-request')).toBeVisible({ timeout: 20_000 })
        await am.getByTestId('sj-department').getByRole('radio', { name: 'Creative' }).click()
        await pickJobLanguages(am)
        await am.getByTestId('sj-title').fill(title)
        await am.getByTestId('sj-type').fill(typeName003)
        await am.getByTestId('sj-type-list').getByRole('option').first().dispatchEvent('mousedown')
        await expect(am.getByTestId('sj-type-none')).toHaveCount(0)
        await am.getByTestId('sj-priority').getByRole('radio', { name: locale === 'ar' ? /.+/ : 'Medium' }).nth(locale === 'ar' ? 1 : 0).click()
        if (first) {
          // S1 — similar job: a title like an open Northwind job's brings the prompt; closed with
          // Escape (nothing chosen), then the walk's own title is typed.
          const lookalike = await lookalikeTitle()
          if (lookalike) {
            await am.getByTestId('sj-title').fill(`${lookalike} again`)
            await am.getByTestId('sj-due').fill(dueInTwoWeeks())
            await am.getByTestId('sj-next').click()
            await expect(am.getByTestId('sj-similar-dialog')).toBeVisible({ timeout: 15_000 })
            await walk.shot(am, 's1-similar-job', { caption: `S1 — Similar job, brought by the title "${lookalike} again": CHECK THIS FIRST, the look-alikes with their score, Add it to that job or Keep them separate` })
            await am.keyboard.press('Escape')
            await expect(am.getByTestId('sj-similar-dialog')).toHaveCount(0)
            await am.getByTestId('sj-title').fill(title)
            walk.note(`S1 was brought on purpose with the title "${lookalike} again" and dismissed with Escape; the walk's own title was then typed.`)
          }
          // S2 — under the lead time: a due date of tomorrow is short of any lead time.
          await am.getByTestId('sj-due').fill(tomorrow())
          await walk.shot(am, 's2-countback-short', { full: true, caption: 'Who and when with a date short of the lead time: the day strip and the "short by" note' })
          await am.getByTestId('sj-next').click()
          await expect(am.getByTestId('sj-short-dialog')).toBeVisible()
          await walk.shot(am, 's2-under-the-lead-time', { caption: 'S2 — Under the lead time: needs / has / short by, what reduced scope means; Continue or Give it more time' })
          await am.getByTestId('sj-short-more-time').click()
          await expect(am.getByTestId('sj-short-dialog')).toHaveCount(0)
          walk.note('S2 was answered "Give it more time"; the due date was then set two weeks out.')
        }
        await am.getByTestId('sj-due').fill(dueInTwoWeeks())
        await am.getByTestId('sj-title').click()
        await walk.shot(am, `${tpl.brief_type}-04-who-and-when`, { full: true, caption: 'Which team (Creative, the lead and the team’s load, the escalation line), When (date, day strip), Priority, What is being made' })
        await walk.check('the escalation line names the lead and the tenant’s hours', async () => {
          await expect(am.getByTestId('sj-escalation-note')).toContainText(/hours|ساعة|ساعات/)
        })

        // ---- SJ-v3-05: review and open ----
        walk.begin('SJ-v3-05 — Review and open', PEOPLE.am.name)
        const outcome = await nextToReview(am, true)
        if (outcome === 'prompt') {
          await walk.shot(am, `${tpl.brief_type}-s1-similar`, { caption: 'S1 — Similar job: a look-alike was found; Add it to that job, or Keep them separate' })
          await am.getByTestId('sj-similar-separate').click()
          await expect(am.getByTestId('sj-review')).toBeVisible()
          walk.note('S1 fired (an earlier run left a look-alike); answered "Keep them separate".')
        }
        await am.waitForLoadState('networkidle').catch(() => {})
        await walk.shot(am, `${tpl.brief_type}-05-review`, { full: true, caption: 'Review and open: the deliverable card, how the request came in, the brief, where it goes, the rules it carries, what is attached' })
        await walk.check('the review names the title, the type and the template', async () => {
          await expect(am.getByTestId('sj-review-title')).toContainText(title)
          await expect(am.getByTestId('sj-review')).toContainText(name)
        })
        await walk.check('the review lists every brief field that was filled', async () => {
          for (const f of tpl.fields) await expect(am.getByTestId(`sj-review-field-${f.key}`)).toBeVisible()
        })
        walk.note(`Left as a draft: "${title}". Not opened.`)
        walk.state.done.push(tpl.brief_type)
        walk.save()
      }
      await am.context().close()
    })
  })
}
