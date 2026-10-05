import { test, expect, type Browser, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { authFile, PEOPLE } from '../fixtures'
import { chooseLanguages } from '../helpers/campaign-wizard'

/**
 * Review walk — the campaign flow, `CB-v3` (Edward, 24 Sep).
 *
 * All five steps of the rebuilt campaign wizard, walked as the account manager, in English and in
 * Arabic, photographing every screen and every modal: `CB-v3-01` the campaign with its phases
 * panel and `P1`; `CB-v3-02` the brief with `P2`; `CB-v3-03` the work with `P3`, `P4`, `P5`, `P6`,
 * `P8` and the move between workstreams; `CB-v3-04` timing with `P7`; and `CB-v3-05` review.
 *
 * There are NO fallbacks in here. Every step is a hard assertion, so a refusal anywhere fails the
 * run rather than being photographed and walked past.
 *
 * The campaign is left as a DRAFT. Nothing is approved, so the local stack does not fill with
 * released work and its notifications.
 *
 * Run:
 *   WALK=1 npx playwright test --config playwright.local.config.ts e2e/local/walks/campaign-flow.walk.spec.ts
 *   WALK=1 WALK_LOCALES=en,ar npx playwright test --config … (both languages)
 *
 * Writes `Claude outputs/reports/<date>-campaign-flow/REPORT.html` — self-contained, every
 * screenshot embedded as a data URI, so the one file can be sent to a reviewer on its own
 * (Edward, 22 Sep: a linked report arrived without its pictures).
 */
const WALK = process.env.WALK === '1'
const LOCALES = (process.env.WALK_LOCALES ?? 'en').split(',') as Array<'en' | 'ar'>
const DATE = process.env.WALK_DATE ?? new Date().toISOString().slice(0, 10)
const OUT = path.resolve('Claude outputs', 'reports', `${DATE}-campaign-flow`)

interface Check { title: string; ok: boolean; detail?: string }
interface Step { n: number; title: string; actor: string; notes: string[]; shots: string[]; checks: Check[] }
interface Chapter { key: string; title: string; steps: Step[] }
interface Report { started: string; locales: Record<string, Chapter[]> }
interface State { shot: number }

const reportFile = path.join(OUT, 'report.json')
const stateFile = (locale: string) => path.join(OUT, `state-${locale}.json`)

function loadReport(): Report {
  if (existsSync(reportFile)) return JSON.parse(readFileSync(reportFile, 'utf8')) as Report
  return { started: new Date().toISOString(), locales: {} }
}
function loadState(locale: string): State {
  if (existsSync(stateFile(locale))) return JSON.parse(readFileSync(stateFile(locale), 'utf8')) as State
  return { shot: 0 }
}

class Walk {
  report: Report
  chapters: Chapter[]
  chapter!: Chapter
  step!: Step
  state: State
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
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(OUT, this.locale, name), fullPage: opts.full ?? false })
    this.step.shots.push(`${this.locale}/${name}${opts.caption ? `|${opts.caption}` : ''}`)
    writeFileSync(stateFile(this.locale), JSON.stringify(this.state, null, 2))
    this.flush()
  }
  flush() {
    mkdirSync(OUT, { recursive: true })
    writeFileSync(reportFile, JSON.stringify(this.report, null, 2))
    writeFileSync(path.join(OUT, 'REPORT.html'), renderHtml(this.report))
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function renderHtml(r: Report): string {
  let pass = 0, fail = 0
  for (const chapters of Object.values(r.locales)) for (const c of chapters) for (const s of c.steps) for (const k of s.checks) { if (k.ok) pass++; else fail++ }
  const out: string[] = []
  out.push('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>The campaign flow — CB-v3</title>')
  out.push('<style>body{font:15px/1.6 system-ui,sans-serif;max-width:1180px;margin:32px auto;padding:0 24px;color:#1d1d1f}'
    + 'img{max-width:100%;border:1px solid #ddd;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.08);margin:8px 0}'
    + 'figcaption{color:#666;font-style:italic;margin-bottom:24px}'
    + 'h2{margin-top:56px;border-top:1px solid #e5e5e5;padding-top:24px}h3{margin-top:32px}'
    + '.ok{color:#1a7f37}.bad{color:#b42318}pre{background:#f6f6f6;padding:8px 12px;border-radius:6px;font-size:13px;white-space:pre-wrap}'
    + 'nav ol{columns:2}.tally{font-size:17px;font-weight:600}'
    + '.old{background:#fff8e6;border-inline-start:3px solid #d99b0a;padding:10px 14px;border-radius:6px;margin:12px 0}</style></head><body>')
  out.push('<h1>The campaign flow — <code>CB-v3</code></h1>')
  out.push(`<p>Started ${esc(r.started.slice(0, 16).replace('T', ' '))} UTC on the local stack, as the account manager. Every screenshot is the state <b>after</b> the step completed. The campaign is left as a draft — nothing was approved.</p>`)
  out.push(`<p class="tally">Checks: <span class="ok">${pass} passed</span>, <span class="${fail ? 'bad' : 'ok'}">${fail} failed</span>.</p>`)
  for (const [locale, chapters] of Object.entries(r.locales)) {
    out.push(`<h2>${locale === 'ar' ? 'Arabic / RTL walk' : 'English walk'}</h2><nav><ol>`)
    for (const c of chapters) out.push(`<li><a href="#${esc(locale)}-${esc(c.key)}">${esc(c.title)}</a></li>`)
    out.push('</ol></nav>')
    for (const c of chapters) {
      out.push(`<h2 id="${esc(locale)}-${esc(c.key)}">${esc(c.title)}</h2>`)
      for (const s of c.steps) {
        out.push(`<h3>${s.n}. ${esc(s.title)}</h3><p><i>As ${esc(s.actor)}.</i></p>`)
        for (const n of s.notes) {
          const old = n.startsWith('OLD:')
          out.push(old ? `<p class="old">${esc(n.slice(4).trim())}</p>` : `<p>${esc(n)}</p>`)
        }
        for (const shot of s.shots) {
          const [file, caption] = shot.split('|')
          // Embedded, never linked: the one file is what gets shared.
          const png = path.join(OUT, file!)
          const src = existsSync(png) ? `data:image/png;base64,${readFileSync(png).toString('base64')}` : file!
          out.push(`<figure><img src="${src}" alt="${esc(caption ?? file!)}" loading="lazy">${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}</figure>`)
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

class Session {
  constructor(readonly browser: Browser, readonly walk: Walk) {}
  async as(tag: keyof typeof PEOPLE): Promise<Page> {
    const ctx = await this.browser.newContext({ storageState: authFile(tag), viewport: { width: 1440, height: 1000 } })
    return ctx.newPage()
  }
  async go(page: Page, url: string) {
    await page.goto(url)
    await page.getByTestId('locale-toggle').first().waitFor({ state: 'visible', timeout: 20_000 })
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(400)
    const want = this.walk.locale === 'ar' ? 'rtl' : 'ltr'
    if ((await page.locator('html').getAttribute('dir')) !== want) {
      await page.getByTestId('locale-toggle').first().click()
      await expect(page.locator('html')).toHaveAttribute('dir', want)
      await page.waitForTimeout(300)
    }
  }
}

const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

/**
 * Put every piece that is in no phase into one, from the timing screen's own line.
 *
 * `CB-v3-04` gives a piece with no phase no row and no date, and the step will not be left with
 * one (ADR-0093 addendum d.7). The line that names them opens the piece's Edit, where a date places it.
 */
async function placeEveryUnplaced(page: Page) {
  for (let guard = 0; guard < 25; guard++) {
    const place = page.locator('[data-testid^="wizard-timing-place-"]').first()
    if (await place.count() === 0) return
    const placeId = (await place.getAttribute('data-testid'))!.replace('wizard-timing-place-', '')
    // cc1c420 (24 Sep): placing a piece is giving it a date — the date chooses the phase. A day
    // inside Week 1 (which ends at +21).
    await page.getByTestId(`wizard-timing-place-${placeId}`).click()
    await expect(page.getByTestId('wizard-timing-piece-dialog')).toBeVisible()
    await page.getByTestId('wizard-timing-piece-due').fill(plusDays(18))
    await page.getByTestId('wizard-timing-piece-save').click()
    await page.waitForTimeout(400)
  }
  throw new Error('pieces are still outside a phase after 25 passes')
}

/**
 * Give every piece an owner.
 *
 * The model proposes work with nobody named on it — no owners or departments travel to it — so
 * the account manager names one on each before the step will be left. That rule used to be
 * silent: a row with no owner was filtered out of the count and the step passed anyway.
 */
async function ownEveryPiece(page: Page) {
  for (let guard = 0; guard < 25; guard++) {
    const warn = page.locator('[data-testid^="wizard-work-warn-"]').first()
    if (await warn.count() === 0) return
    const id = (await warn.getAttribute('data-testid'))!.replace('wizard-work-warn-', '')
    await page.getByTestId(`wizard-work-edit-${id}`).click()
    await expect(page.getByTestId('wizard-piece-dialog')).toBeVisible()
    await page.getByTestId('wizard-piece-owner').selectOption({ index: 1 })
    // A row the model could not place in the catalogue needs a type too (ADR-0097 d.4).
    const type = page.getByTestId('wizard-piece-type')
    if (await type.inputValue() === '') await type.selectOption({ index: 1 })
    // And a phase, so the timing screen has something to count back from. Not required to SAVE
    // (ADR-0096 d.8 lets a piece arrive unplaced), but a campaign left with none would spend the
    // whole of step 4 on the "not in a phase yet" line, which is not what this walk is for.
    const phase = page.getByTestId('wizard-piece-phase')
    if (await phase.count() > 0 && await phase.inputValue() === '') await phase.selectOption({ index: 1 })
    await page.getByTestId('wizard-piece-save').click()
    await page.waitForTimeout(400)
  }
  throw new Error('still pieces without an owner after 25 passes')
}


for (const locale of LOCALES) {
  test.describe(`Campaign flow walk (${locale})`, () => {
    test.skip(!WALK, 'WALK=1 runs the review walk')
    test.setTimeout(20 * 60_000)
    test.use({ actionTimeout: 20_000 })
    let walk: Walk
    let s: Session
    test.beforeEach(({ browser }) => { walk = new Walk(locale); s = new Session(browser, walk) })

    test('the five steps, every screen and every modal', async () => {
      const page = await s.as('am')
      const name = `Walk ${DATE} ${locale} ${Date.now().toString().slice(-5)}`

      // ---------------------------------------------------------------- step 1 ----
      walk.open('step1', 'Step 1 — The campaign (CB-v3-01)')

      walk.begin('The wizard opens on the campaign', 'the account manager')
      await s.go(page, '/campaigns/new')
      await expect(page.getByTestId('wizard-step-1')).toBeVisible()
      walk.note('Five steps, not six: phases moved onto this step, beside the campaign it belongs to.')
      await walk.check('the rail shows five steps', async () => {
        await expect(page.getByTestId('wizard-steps').locator('li')).toHaveCount(5)
      })
      await walk.shot(page, 'step1-empty', { full: true, caption: 'Step 1 as it opens — the campaign, and the phases panel with its switch off.' })

      walk.begin('The campaign is named and its client chosen', 'the account manager')
      await page.getByTestId('wizard-name').fill(name)
      await page.getByTestId('wizard-client').selectOption({ index: 1 })
      await page.waitForTimeout(400)
      await walk.shot(page, 'step1-named', { full: true, caption: 'Named, with the account manager pre-filled from the client.' })

      walk.begin('Phases are switched on, and refuse to be empty', 'the account manager')
      await page.getByTestId('wizard-phases-toggle').click()
      await page.waitForTimeout(300)
      walk.note('Turning phases on does not invent a blank "Phase 1" to correct. The panel offers the button that makes one.')
      await walk.shot(page, 'step1-phases-on', { full: true, caption: 'Phases on, nothing defined — the panel offers "+ Add a phase".' })
      await page.getByTestId('wizard-next').click()
      await page.waitForTimeout(300)
      await walk.check('Next refuses and names the gap', async () => {
        await expect(page.getByTestId('wizard-error')).toBeVisible()
      })
      await walk.shot(page, 'step1-phases-refused', { caption: 'The refusal names what is missing rather than saying "incomplete".' })
      // The refusal is a dialog, so it is closed before anything behind it is pressed.
      await page.getByTestId('wizard-error-close').click().catch(async () => {
        await page.getByRole('button', { name: /close/i }).first().click()
      })
      await page.waitForTimeout(300)

      walk.begin('A phase is added (CB-v3-P1)', 'the account manager')
      await page.getByTestId('wizard-phases-add').click()
      await expect(page.getByTestId('wizard-phase-dialog-dialog')).toBeVisible()
      // Edward, 24 Sep (dca52e7): "a phase is a start and an end date; the event is gone" — the walk
      // filled the removed event field until 26 Sep, and stopped here.
      await walk.shot(page, 'p1-add-phase-empty', { caption: 'CB-v3-P1 — a phase is a name, a start date and an end date.' })
      await page.getByTestId('wizard-phase-dialog-name').fill(locale === 'ar' ? 'الأسبوع الأول' : 'Week 1')
      const firstStart = page.getByTestId('wizard-phase-dialog-starts')
      if (!(await firstStart.inputValue())) await firstStart.fill(plusDays(1))
      await page.getByTestId('wizard-phase-dialog-date').fill(plusDays(21))
      await walk.shot(page, 'p1-add-phase-filled', { caption: 'Week 1, from its start to its end date.' })
      await page.getByTestId('wizard-phase-dialog-submit').click()
      await page.waitForTimeout(400)

      await page.getByTestId('wizard-phases-add').click()
      await page.getByTestId('wizard-phase-dialog-name').fill(locale === 'ar' ? 'الأسبوع الثاني' : 'Week 2')
      await walk.shot(page, 'p1-second-phase-start', { caption: 'The second phase — its start as the dialog offers it.' })
      const secondStart = page.getByTestId('wizard-phase-dialog-starts')
      if (!(await secondStart.inputValue())) await secondStart.fill(plusDays(22))
      await page.getByTestId('wizard-phase-dialog-date').fill(plusDays(35))
      await page.getByTestId('wizard-phase-dialog-submit').click()
      await page.waitForTimeout(400)
      await walk.check('both phases are on the panel', async () => {
        await expect(page.locator('[data-testid^="wizard-phases-row-"]')).toHaveCount(2)
      })
      await walk.shot(page, 'step1-phases-two', { full: true, caption: 'Two phases, each with its dates.' })

      walk.begin('A phase is edited, and can be removed from the same dialog', 'the account manager')
      const firstPhase = page.locator('[data-testid^="wizard-phases-edit-"]').first()
      await firstPhase.click()
      await expect(page.getByTestId('wizard-phase-dialog-dialog')).toBeVisible()
      await walk.shot(page, 'p1-edit-phase', { caption: 'The same dialog edits — only the title and the button change. Remove lives here too.' })
      await page.getByTestId('wizard-phase-dialog-cancel').click()
      await page.waitForTimeout(300)

      // ---------------------------------------------------------------- step 2 ----
      walk.open('step2', 'Step 2 — The brief (CB-v3-02)')

      walk.begin('The brief, in four parts with the rules as a fifth', 'the account manager')
      await page.getByTestId('wizard-next').click()
      await expect(page.getByTestId('wizard-step-2')).toBeVisible()
      walk.note('One page you scroll, with a rail that counts what is filled in each part — rather than two panels of stacked boxes.')
      await walk.shot(page, 'step2-brief-empty', { full: true, caption: 'CB-v3-02 as it opens. Only the proposition is marked REQUIRED.' })

      walk.begin('Next is refused until the proposition is written, and the box is named', 'the account manager')
      await page.getByTestId('wizard-next').click()
      await expect(page.getByTestId('wizard-error')).toBeVisible()
      await page.getByTestId('wizard-error-close').click()
      await walk.check('the refusal marks the field itself, not just the dialog', async () => {
        await expect(page.getByTestId('wizard-brief-proposition-missing')).toBeVisible()
        await expect(page.getByTestId('wizard-brief-proposition')).toHaveAttribute('aria-invalid', 'true')
      })
      await walk.shot(page, 'step2-refused', { full: true, caption: 'The refusal names the field AND marks it, so nobody has to read the message twice.' })

      walk.begin('The brief is written', 'the account manager')
      await page.getByTestId('wizard-brief-proposition').fill(
        locale === 'ar' ? 'كل عملية شراء تذكرة.' : 'Every purchase is a ticket.')
      await chooseLanguages(page, 'wizard-languages-picker', ['en'])
      await page.getByTestId('wizard-brief-background').fill(
        locale === 'ar' ? 'الموسم الثاني يبدأ بعد نجاح الأول.' : 'Season two opens on the back of a season that worked.')
      await page.getByTestId('wizard-brief-task').fill(
        locale === 'ar' ? 'مضاعفة المشاركة في ليالي السحب.' : 'Double the entries on draw nights.')
      await walk.shot(page, 'step2-brief-filled', { full: true, caption: 'Filled. The rail counts each part as it goes.' })

      walk.begin('A campaign rule is added (CB-v3-P2)', 'the account manager')
      await page.getByTestId('wizard-brief-add-rule').click()
      await expect(page.getByTestId('wizard-brief-rule-dialog')).toBeVisible()
      await walk.shot(page, 'p2-add-rule', { caption: "CB-v3-P2 — a campaign rule sits on top of the client's; it can never cancel one." })
      await page.getByTestId('wizard-brief-rule-dialog-text').fill(
        locale === 'ar' ? 'لا تستخدم المفتاح البصري للموسم الماضي.' : "Never reuse last season's key visual.")
      await page.getByTestId('wizard-brief-rule-dialog-because').fill(
        locale === 'ar' ? 'طلب العميل، ٢٤ سبتمبر.' : 'Client asked, 24 Sep.')
      await walk.shot(page, 'p2-add-rule-filled', { caption: 'Because: who asked for it, and when. The next person reading it wants to know.' })
      await page.getByTestId('wizard-brief-rule-dialog-submit').click()
      await page.waitForTimeout(400)
      await walk.check('the rule is on the brief', async () => {
        await expect(page.locator('[data-testid^="wizard-brief-rule-"]').first()).toBeVisible()
      })
      await walk.shot(page, 'step2-rule-added', { full: true, caption: 'The rule travels with every piece in this campaign.' })

      // ---------------------------------------------------------------- step 3 ----
      walk.open('step3', 'Step 3 — The work (CB-v3-03)')

      walk.begin('The work screen, with the model\'s proposals', 'the account manager')
      await page.getByTestId('wizard-next').click()
      await expect(page.getByTestId('wizard-step-3')).toBeVisible({ timeout: 60_000 })
      await page.waitForTimeout(1200)
      walk.note('Proposals arrive with no owner and no group — no owners or departments travel to the model — so they gather in one list until somebody says where they belong.')
      await walk.shot(page, 'step3-proposed', { full: true, caption: 'CB-v3-03 — what are we actually making?' })

      walk.begin('A workstream is made (CB-v3-P3)', 'the account manager')
      await page.getByTestId('wizard-work-new-group').click()
      await expect(page.getByTestId('wizard-new-workstream-dialog')).toBeVisible()
      await walk.shot(page, 'p3-new-workstream', { caption: 'CB-v3-P3 — a name and a department. That is all a workstream needs.' })
      await page.getByTestId('wizard-new-workstream-name').fill(locale === 'ar' ? 'التصميم والحركة' : 'Design & Animation')
      await page.locator('[data-testid^="wizard-new-workstream-dept-"]').first().click()
      await walk.shot(page, 'p3-new-workstream-filled', { caption: 'The department is pills, not a dropdown — it is what the pieces underneath will inherit.' })
      await page.getByTestId('wizard-new-workstream-create').click()
      await page.waitForTimeout(500)
      await walk.check('the workstream is on the screen', async () => {
        await expect(page.locator('[data-testid^="wizard-work-group-"]').first()).toBeVisible()
      })
      await walk.shot(page, 'step3-one-group', { full: true, caption: 'The group, with its department and who assigns for it.' })

      walk.begin('A piece is typed straight onto the list', 'the account manager')
      const addLine = page.locator('[data-testid^="wizard-work-new-"]').first()
      await addLine.fill(locale === 'ar' ? 'الفيديو الافتتاحي' : 'Launch key visual')
      await walk.shot(page, 'step3-typing', { full: true, caption: 'A piece is one line of text — laying out a campaign is writing a list, not filling a form.' })
      await addLine.press('Enter')
      await page.waitForTimeout(500)
      await walk.check('the piece appears, and says it needs an owner', async () => {
        await expect(page.locator('[data-testid^="wizard-work-warn-"]').first()).toBeVisible()
      })
      await walk.shot(page, 'step3-piece-added', { full: true, caption: 'It lands on the list and says what it still needs — on the row, not only in the refusal.' })

      walk.begin('The piece is completed (CB-v3-P8)', 'the account manager')
      const pieceRow = page.locator('[data-testid^="wizard-work-edit-"]').first()
      await pieceRow.click()
      await expect(page.getByTestId('wizard-piece-dialog')).toBeVisible()
      await walk.shot(page, 'p8-edit-piece', { caption: 'CB-v3-P8 — the workstream is shown and not chosen; the caption says what it decides.' })
      await page.getByTestId('wizard-piece-idea').fill(
        locale === 'ar' ? 'ثلاث لقطات: الرقم، الوجه، ردّ الفعل.' : 'Three frames: the number, the face, the reaction.')
      await page.getByTestId('wizard-piece-owner').selectOption({ index: 1 })
      await page.getByTestId('wizard-piece-type').selectOption({ index: 1 })
      await page.getByTestId('wizard-piece-quantity').fill('3')
      await page.getByTestId('wizard-piece-notes').fill(
        locale === 'ar' ? 'العميل يريد النسخة الكردية أولاً.' : 'Client wants the Kurdish cut first.')
      await page.waitForTimeout(400)
      await walk.shot(page, 'p8-edit-piece-filled', { caption: 'The type brings its own task list, previewed under it. Quantity, owner and notes are here too.' })
      await page.getByTestId('wizard-piece-save').click()
      await page.waitForTimeout(500)
      await walk.shot(page, 'step3-piece-done', { full: true, caption: 'The row now reads its format and how many, and the warning is gone.' })

      walk.begin('A second workstream, and the move between them', 'the account manager')
      await page.getByTestId('wizard-work-new-group').click()
      await page.getByTestId('wizard-new-workstream-name').fill(locale === 'ar' ? 'الفيديو القصير' : 'Short-form video')
      await page.locator('[data-testid^="wizard-new-workstream-dept-"]').nth(1).click()
      await page.getByTestId('wizard-new-workstream-create').click()
      await page.waitForTimeout(500)
      const moveBtn = page.locator('[data-testid^="wizard-work-move-"]').first()
      await walk.check('a Move action appears once there is somewhere to move to', async () => {
        await expect(moveBtn).toBeVisible()
      })
      await moveBtn.click()
      await expect(page.getByTestId('wizard-move-workstream-dialog')).toBeVisible()
      await walk.shot(page, 'move-workstream', { caption: 'Moving between workstreams — the list alone cannot say that this changes the department.' })
      const optionId = (await page.locator('[data-testid^="wizard-move-workstream-option-"]').nth(1)
        .getAttribute('data-testid'))!.replace('wizard-move-workstream-option-', '')
      await page.getByTestId(`wizard-move-workstream-option-${optionId}`).click()
      await page.waitForTimeout(300)
      await walk.check('it warns that the department changes, before the press', async () => {
        await expect(page.getByTestId('wizard-move-workstream-department-note')).toBeVisible()
      })
      await walk.shot(page, 'move-workstream-warned', { caption: 'Tasks nobody has started follow it; anything already picked up stays where it is.' })
      await page.getByTestId('wizard-move-workstream-cancel').click()
      await page.waitForTimeout(300)

      walk.begin('A workstream is opened (CB-v3-P5)', 'the account manager')
      const groupId = (await page.locator('[data-testid^="wizard-work-group-name-"]').first()
        .getAttribute('data-testid'))!.replace('wizard-work-group-name-', '')
      // I56.22 (39a48d2, 24 Sep): the name is a box you rename in place; the drawer opens from Open.
      await page.getByTestId(`wizard-work-open-${groupId}`).click()
      await page.waitForTimeout(400)
      await expect(page.getByTestId('wizard-workstream-drawer')).toBeVisible()
      await walk.shot(page, 'p5-drawer', { caption: 'CB-v3-P5 — a drawer down the right, so the list behind it stays readable.' })
      await page.getByTestId('wizard-workstream-drawer-close').click()
      await page.waitForTimeout(300)

      walk.begin('Removing a piece asks why (CB-v3-P6)', 'the account manager')
      const removeBtn = page.locator('[data-testid^="wizard-work-remove-"]').last()
      await removeBtn.click()
      await expect(page.getByTestId('wizard-remove-piece-dialog')).toBeVisible()
      await walk.shot(page, 'p6-remove-piece', { caption: 'CB-v3-P6 — the reason is required and goes on the campaign record.' })
      await page.getByTestId('wizard-remove-piece-keep').click()
      await page.waitForTimeout(300)

      walk.begin('Adding a piece from the group\'s own button (CB-v3-P4)', 'the account manager')
      const addToId = (await page.locator('[data-testid^="wizard-work-add-piece-"]').first()
        .getAttribute('data-testid'))!.replace('wizard-work-add-piece-', '')
      await page.getByTestId(`wizard-work-add-piece-${addToId}`).click()
      await expect(page.getByTestId('wizard-piece-dialog')).toBeVisible()
      await walk.shot(page, 'p4-add-piece', { caption: 'CB-v3-P4 — adding a piece to a named workstream, which sets its department.' })
      await page.getByTestId('wizard-piece-cancel').click()
      await page.waitForTimeout(300)

      walk.begin('Every piece is given an owner', 'the account manager')
      walk.note('Proposals arrive with nobody named on them, and the step will not be left until somebody is — this is the rule that used to be silent, and it is why the model\'s row has to be opened.')
      await ownEveryPiece(page)
      await walk.check('nothing is left without an owner', async () => {
        await expect(page.locator('[data-testid^="wizard-work-warn-"]')).toHaveCount(0)
      })
      await walk.shot(page, 'step3-final', { full: true, caption: 'The work step as the account manager leaves it — every piece owned.' })

      // ---------------------------------------------------------------- step 4 ----
      walk.open('step4', 'Step 4 — Timing')
      walk.begin('Timing', 'the account manager')
      await page.getByTestId('wizard-next').click()
      await expect(page.getByTestId('wizard-step-4')).toBeVisible()
      walk.note('Every phase plans back from its own end date. Nobody types a due date here — it is counted back from the event the phase ends on, and only a piece PULLED earlier carries one of its own.')
      await walk.shot(page, 'step4-timing', { full: true, caption: 'CB-v3-04 — the season strip, and each phase planned backwards from its event.' })

      // cc1c420 (24 Sep): "a date chooses the phase" — the Move button is gone; a piece's Edit sets its
      // due date and the phase follows. The walk opened the removed Move dialog until 26 Sep.
      walk.begin('A piece\'s date is edited, and the date chooses its phase (CB-v3-P7)', 'the account manager')
      await page.locator('[data-testid^="wizard-timing-edit-"]').first().click()
      await expect(page.getByTestId('wizard-timing-piece-dialog')).toBeVisible()
      await walk.shot(page, 'p7-edit-piece', { caption: 'CB-v3-P7 — a piece plans back from its due date, and that date puts it in its phase.' })
      await page.getByTestId('wizard-timing-piece-cancel').click()
      await page.waitForTimeout(300)

      walk.begin('A piece nobody placed is placed from here', 'the account manager')
      walk.note('It is named on its own line WITH the way to fix it. Sending somebody back a step to place what they are looking at is a dead end with extra words.')
      await walk.shot(page, 'step4-unplaced', { full: true, caption: 'A piece not in a phase yet — so it has no date, and it says so.' })
      await placeEveryUnplaced(page)
      await walk.check('nothing is left out of a phase', async () => {
        await expect(page.getByTestId('wizard-timing-unplaced')).toHaveCount(0)
      })
      await walk.shot(page, 'step4-all-placed', { full: true, caption: 'Every piece in a phase, every date counted back from the event it ends on.' })

      // ---------------------------------------------------------------- step 5 ----
      walk.open('step5', 'Step 5 — Review')
      walk.begin('Review', 'the account manager')
      await page.getByTestId('wizard-next').click()
      await expect(page.getByTestId('wizard-step-5')).toBeVisible()
      walk.note('Grouped by workstream, with the facts strip and what approving actually does — rather than a second rendering of the whole brief.')
      await walk.shot(page, 'step5-review', { full: true, caption: 'CB-v3-05 — this is what you are approving. Nothing is approved on this walk.' })
      await walk.check('the campaign is grouped by workstream, with every piece counted', async () => {
        await expect(page.locator('[data-testid^="wizard-review-row-"]').first()).toBeVisible()
      })
      await walk.check('it says what approving does before it is pressed', async () => {
        await expect(page.getByTestId('wizard-review-consequences')).toBeVisible()
      })
      await walk.check('the walk reached the last step of the wizard', async () => {
        await expect(page.getByTestId('wizard-review-approve')).toBeVisible()
      })

      walk.begin('The campaign is left as a draft', 'the account manager')
      walk.note(`Left as a draft under the name "${name}". Nothing was approved, so no clocks started and nobody was told.`)
    })
  })
}
