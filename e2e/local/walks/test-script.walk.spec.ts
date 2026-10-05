import { test, expect, type Browser, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { authFile, PEOPLE } from '../fixtures'
import { rows } from '../helpers/db'
import { blockTimeFill, blockTimeOffers, day, idOf, resourceIdOf, rpcAs, workday, type Tag } from '../helpers/i74'
import { dragOnSchedule, mockBucket, PNG } from './running-the-week.kit'

/**
 * Edward's test script (4 Oct) — 38 numbered steps, walked in the browser on the local stack, exactly as a person
 * would: signed in as the person the step names, clicking and typing. Each step has a screenshot before and after
 * (open dialogs in the shot), what was done, what was expected, and the outcome — Pass / Fail (what was seen) /
 * Skipped (why). A failed step is recorded and the walk goes on with the next one, on a fresh page.
 *
 * It runs on the data already on the local database (campaign "Northwind Summer Launch", LV-001, LV-002 …) — NOT a
 * reset; another spec may be running on the same database, so a step whose data was changed under it uses the
 * nearest equivalent and says so. The database is read through the service role for ASSERTIONS only.
 *
 * Network-edge mocks (as every walk here): the file store (an upload's bytes go nowhere), so a maker can send a
 * version for review in step 31's set-up. Drags are the grid's own drag events (`dragOnSchedule`).
 *
 * Run:  WALK=1 npx playwright test --config playwright.local.config.ts e2e/local/walks/test-script.walk.spec.ts --project chromium
 * Re-render only (after tracing causes into CAUSES below):  RENDER=1 … same command.
 * Writes `Claude outputs/reports/2026-10-04-test-script/REPORT.html` — one file, every image embedded.
 */
const WALK = process.env.WALK === '1'
const RENDER = process.env.RENDER === '1'
/** Resume on the same data from step N, keeping the steps before it (and their pictures) from the earlier pass. */
const FROM = Number(process.env.WALK_FROM ?? '1')
/** Walk only these steps again (comma list), keeping every other step of the earlier pass. */
const ONLY = (process.env.WALK_ONLY ?? '').split(',').filter(Boolean).map(Number)
const OUT = path.resolve('Claude outputs', 'reports', '2026-10-04-test-script')
const VIEW = { width: 1440, height: 1000 }
const CAMPAIGN = 'Northwind Summer Launch'
const SECTIONS: Record<string, string> = {
  A: 'The deliverable’s task list on the campaign page (Dev Team Lead)',
  B: 'Schedule (Dev Team Lead)',
  C: 'The other team answers',
  D: 'Ask the account manager',
  E: 'Languages (Dev Account Mgr)',
  F: 'Re-open (Dev Team Lead)',
  G: 'More time',
  H: 'Refusals',
}
const sectionOf = (n: number) => (n <= 9 ? 'A' : n <= 17 ? 'B' : n <= 20 ? 'C' : n <= 24 ? 'D' : n <= 30 ? 'E' : n === 31 ? 'F' : n <= 33 ? 'G' : 'H')

/** Traced causes, written after reading each failure (the walk cannot be re-run on the same data). */
const CAUSES: Record<number, string> = {
  1: 'The order is right and there is no Who or Dates, but Translation reads “Not booked” instead of “Suggested”, and the banner says “6 suggested and 1 of yours”. The translation task is added by the languages rule, not by the workflow (it has no workflow step), and the list marks a task “Suggested” only when it came from a workflow step (PieceTasks: fromWorkflow = workflow_step_id set).',
  6: 'The TV Advertisement workflow gives its steps no hours, so every suggested task arrives with none (—), and the database refuses to give a task to anyone without hours (migration 20260926130000, “a task is assigned only with its hours”). After + to 2 hours the same Save booked it, and every other check held.',
  7: 'Same as step 6: the tasks had no hours, so the first Save was refused. After + to 2 hours on each, both were booked for Dev Deputy Lead on Tuesday.',
  8: 'Same as step 6: an ask for a task with no hours is refused (“has no hours allocated”). After + to 2 hours the ask went to Copy and the row read “⏳ Copy · asked” and “Asked Copy”.',
  12: 'Same root as step 6: the window starts each row at the task’s own hours (none → 0h) and counts a row ready only with more than 0 hours (book-plan isReady), so Book stays greyed and no day is over-full. Every row did come in as Dev Maker on Wed 7. With 2 hours a row (step 13) the Wednesday warning showed and the button read “Book 5 tasks anyway”.',
  14: 'A real fault, and a serious one: the pop-up’s form showed the BOOKED task as unbooked — Who “Pick a person”, Dates “Pick dates”, hours blank — while its header said “Booked for Dev · Wed 7 Oct · 2h”. It reads the deliverable’s task list from the page’s memory (kept 30 seconds, main.tsx staleTime), and the booking window does not refresh that list; LV-001 had been opened on the campaign page a moment before booking. Save then sent the blank form: Dev Maker was taken off the task (she got a “task_unassigned” notice) and the hours stayed 2. Step 15 had to give the task back to her.',
  16: 'The database tells the person and her lead, “never the actor” (migration 20261003120000, unassign_task): Dev Team Lead pressed Yes herself, so only Dev Maker was told. Dev Account Mgr was rightly not told; the task went back to To book.',
  18: 'The card is there, first on My work, with Write Copy and “3h 54m left to answer” — but it names the asker by first name only (“Ask from Design … Dev asks for 2 hours of Write Copy”). Every test account’s first name is “Dev”, so “Dev Team Lead” cannot be read on it.',
  20: 'The Schedule card read Booked with OK. On the campaign page Write Copy is Booked, but its Who shows the first name only (“Dev”, avatar “D”) — the same first-name rule as step 18; the database has it on Dev Writer.',
  24: 'The answer is shown — “Dev Account Mgr accepted · Sun, 4 Oct, 09:15 · Dev Deputy Lead, Dev Maker were told” with OK — but the new due day is not in it; Thu 5 Nov is shown only in the read-only line above (Due to the client, in green). In an earlier pass, opened in the same session that had sent the ask, the answer did not show at all.',
  29: 'At 3 the list reads Billboard 2, Billboard 3, Billboard 1: the two added units are given position 4 on the list while the original unit keeps 5 (sub_tasks.sort_order 4 vs 5). Back at 1 the number goes, as expected. The quantity change also sent LV-001’s task list back for approval.',
}

// ------------------------------------------------------------------------------ the record ----

type Outcome = 'Pass' | 'Fail' | 'Skipped'
type Phase = 'before' | 'during' | 'after'
interface Shot { file: string; caption: string; phase: Phase }
interface Check { title: string; ok: boolean; detail?: string }
interface StepRec {
  n: number; section: string; text: string; who: string; expected: string
  did: string[]; seen: string[]; checks: Check[]; shots: Shot[]
  outcome: Outcome; reason: string; error?: string
}
class SkipStep extends Error {}

const ROLE: Record<string, string> = {
  power_admin: 'Power Admin', scheduler: 'Traffic', account_manager: 'account manager', account_director: 'account director',
  department_lead: 'department lead', team_lead: 'team lead', deputy_team_lead: 'deputy team lead', team_member: 'team member', ceo: 'CEO',
}
function ACTOR(tag: Tag): string {
  const p = PEOPLE[tag] as { name: string; role: string; department?: string; team?: string }
  const where = p.team ? `${p.team} team, ${p.department}` : p.department ? p.department : ''
  return `${p.name} — ${ROLE[p.role] ?? p.role}${where ? ` (${where})` : ''}`
}
const firstLines = (e: unknown) => ((e as Error)?.message ?? String(e)).replace(/\u001b\[[0-9;]*m/g, '').split('\n').filter((l) => l.trim()).slice(0, 6).join('\n')

class Pages {
  map = new Map<Tag, Page>()
  constructor(private browser: Browser) {}
  async get(tag: Tag): Promise<Page> {
    const hit = this.map.get(tag)
    if (hit && !hit.isClosed()) return hit
    const ctx = await this.browser.newContext({ storageState: authFile(tag), viewport: VIEW })
    const p = await ctx.newPage()
    await mockBucket(p)
    this.map.set(tag, p)
    return p
  }
  async drop(tag: Tag) {
    const p = this.map.get(tag)
    if (p) await p.context().close().catch(() => {})
    this.map.delete(tag)
  }
}

class Report {
  steps: StepRec[] = []
  shots = 0
  notes: string[] = []
  constructor() {
    if ((FROM > 1 || ONLY.length) && existsSync(path.join(OUT, 'report.json'))) {
      const old = JSON.parse(readFileSync(path.join(OUT, 'report.json'), 'utf8')) as { notes: string[]; steps: StepRec[] }
      this.steps = old.steps.filter((x) => (ONLY.length ? !ONLY.includes(x.n) : x.n < FROM))
      this.notes = old.notes
      this.shots = Math.max(0, ...old.steps.flatMap((x) => x.shots.map((sh) => Number(path.basename(sh.file).slice(0, 3)))))
      return
    }
    if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true })
    mkdirSync(path.join(OUT, 'shots'), { recursive: true })
  }
  flush() { this.steps.sort((a, b) => a.n - b.n); writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ notes: this.notes, steps: this.steps }, null, 2)) }
}

class S {
  last: Page | null = null
  used = new Set<Tag>()
  constructor(public r: StepRec, private rep: Report, private pages: Pages) {}
  async page(tag: Tag): Promise<Page> { this.used.add(tag); const p = await this.pages.get(tag); this.last = p; return p }
  did(t: string) { this.r.did.push(t); this.rep.flush() }
  saw(t: string) { this.r.seen.push(t); this.rep.flush() }
  skip(why: string): never { throw new SkipStep(why) }
  async check(title: string, fn: () => Promise<unknown> | unknown): Promise<boolean> {
    try { await fn(); this.r.checks.push({ title, ok: true }); this.rep.flush(); return true } catch (e) {
      this.r.checks.push({ title, ok: false, detail: firstLines(e) }); this.rep.flush(); return false
    }
  }
  async shot(phase: Phase, page: Page, caption = '', focus?: Locator) {
    this.last = page
    this.rep.shots += 1
    const name = `${String(this.rep.shots).padStart(3, '0')}-s${String(this.r.n).padStart(2, '0')}-${phase}.jpg`
    try {
      await page.addStyleTag({ content: '[data-testid="environment-bar"],[data-testid="update-bar"]{display:none!important}' }).catch(() => {})
      if (focus) await focus.first().scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => {})
      await page.waitForTimeout(700)
      await page.screenshot({ path: path.join(OUT, 'shots', name), type: 'jpeg', quality: 70 })
      this.r.shots.push({ file: `shots/${name}`, caption, phase })
    } catch (e) {
      this.r.seen.push(`(screenshot "${phase}" could not be taken: ${firstLines(e)})`)
    }
    this.rep.flush()
  }
  before(page: Page, caption = '', focus?: Locator) { return this.shot('before', page, caption, focus) }
  during(page: Page, caption = '', focus?: Locator) { return this.shot('during', page, caption, focus) }
  after(page: Page, caption = '', focus?: Locator) { return this.shot('after', page, caption, focus) }
}

// ------------------------------------------------------------------------------ the doors ----

const iraqDayOf = (ts: string | null) => (ts ? new Date(Date.parse(ts) + 3 * 3_600_000).toISOString().slice(0, 10) : null)
type T = { id: string; title: string; status: string; assignee_id: string | null; starts_at: string | null; due_at: string | null; sla_hours: number | null; unit_index: number | null }
const T_COLS = 'id,title,status,assignee_id,starts_at,due_at,sla_hours,unit_index'
const tasksOf = (d: string) => rows<T>('sub_tasks', `select=${T_COLS}&deliverable_id=eq.${d}&status=neq.cancelled&order=sort_order.asc,unit_index.asc`)
const taskRow = async (id: string) => (await rows<T>('sub_tasks', `select=${T_COLS}&id=eq.${id}`))[0]!
const bookingsOf = (id: string) => rows<{ id: string; resource_id: string; starts_at: string; state: string }>('bookings', `select=id,resource_id,starts_at,state&sub_task_id=eq.${id}&state=neq.cancelled&order=starts_at`)
const requestsOn = (id: string) => rows<{ id: string; status: string; team_id: string | null; assignee_id: string | null; requested_by: string | null; created_at: string }>('sub_task_assignment_requests', `select=id,status,team_id,assignee_id,requested_by,created_at&sub_task_id=eq.${id}&order=created_at.desc`)
const deliverable = async (id: string) => (await rows<{ id: string; name: string; due_at: string | null; quantity: number; languages: string[]; state: string; tasks_approved_at: string | null }>('deliverables', `select=id,name,due_at,quantity,languages,state,tasks_approved_at&id=eq.${id}`))[0]!
const notesSince = (entityId: string, since: string) => rows<{ user_id: string; type: string; label: string | null }>('notifications', `select=user_id,type,label&entity_id=eq.${entityId}&created_at=gt.${encodeURIComponent(since)}`)

async function nav(page: Page, where: 'campaigns' | 'schedule' | 'my-work') {
  if (!/localhost:5173\/./.test(page.url())) await page.goto('/')
  // A person closes the deliverable's side panel (it covers the menu) before going elsewhere.
  if (await page.getByTestId('piece-drawer').isVisible().catch(() => false)) {
    await page.getByTestId('piece-drawer-close').click()
    await expect(page.getByTestId('piece-drawer')).toHaveCount(0)
  }
  await page.getByTestId(`nav-${where}`).click({ timeout: 20_000 })
  const surface = where === 'campaigns' ? 'surface-campaigns' : where === 'schedule' ? 'surface-schedule' : 'surface-my-work'
  await expect(page.getByTestId(surface)).toBeVisible({ timeout: 25_000 })
  await page.waitForLoadState('networkidle').catch(() => {})
}
async function openCampaign(page: Page, campaignId: string) {
  await nav(page, 'campaigns')
  await page.getByTestId(`campaign-open-${campaignId}`).click()
  await expect(page.getByTestId('surface-campaign')).toBeVisible({ timeout: 25_000 })
  await page.waitForLoadState('networkidle').catch(() => {})
}
/** From the campaign page's grid: Open on the deliverable's row. Returns once its panel (or read-only drawer) shows. */
async function openDeliverable(page: Page, campaignId: string, deliverableId: string) {
  await openCampaign(page, campaignId)
  const tab = page.getByTestId('campaign-tab-grid')
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
  await page.getByTestId(`campaign-deliverable-open-${deliverableId}`).click()
  await expect(page.getByTestId('piece-drawer')).toBeVisible({ timeout: 25_000 })
  await page.waitForLoadState('networkidle').catch(() => {})
}
/** The walk's working week starts on this Sunday (set once the days are known) — the week the Schedule must show. */
let WALK_WEEK: string | null = null
async function scheduleWeek(page: Page) {
  await nav(page, 'schedule')
  await expect(page.getByTestId('schedule-grid')).toBeVisible({ timeout: 25_000 })
  const wk = page.getByTestId('zoom-week')
  if (await wk.count()) if (!((await wk.getAttribute('class')) ?? '').includes('active')) await wk.click()
  // A person steps to the walk's week with the week arrow (it opens on this week; the walk's days may be next week's).
  if (WALK_WEEK) {
    const onGrid = () => page.getByTestId('schedule-grid').locator(`[data-testid^="cell-"][data-testid$="-${WALK_WEEK}"]`).count()
    for (let i = 0; i < 3 && (await onGrid()) === 0; i++) {
      await page.getByTestId('nav-next').click()
      await page.waitForLoadState('networkidle').catch(() => {})
    }
    expect(await onGrid(), `the Schedule shows the week of ${WALK_WEEK}`).toBeGreaterThan(0)
  }
}
async function pickOneDay(page: Page, picker: string, d: string) {
  await page.getByTestId(`${picker}-day-${d}`).click()
  await page.getByTestId(`${picker}-day-${d}`).click()
  await page.getByTestId(`${picker}-done`).click()
}
async function hoursTo(page: Page, prefix: string, key: string, n: number) {
  const box = page.getByTestId(`${prefix}-hours-${key}`)
  const read = async () => Number(((await box.textContent()) ?? '').replace(/[^0-9.]/g, '') || '0')
  for (let i = 0; i < 20; i++) {
    const now = await read()
    if (now === n) return
    await page.getByTestId(`${prefix}-${now < n ? 'more' : 'less'}-${key}`).click()
    await expect.poll(read, { timeout: 8_000 }).not.toBe(now)
  }
  expect(await read(), `${key} at ${n}h`).toBe(n)
}
/** The campaign page's message window after a save: read it, judge it, close it. */
async function banner(s: S, page: Page, shoot: Phase | null = null, mustBeOk = true): Promise<string> {
  const d = page.getByTestId('campaign-banner-dialog')
  await expect(d).toBeVisible({ timeout: 20_000 })
  const text = ((await d.textContent()) ?? '').replace(/\s+/g, ' ').trim()
  s.saw(`The message said: “${text}”`)
  if (shoot) await s.shot(shoot, page, 'The message after the save')
  if (mustBeOk) await s.check('the message is not a refusal', () => expect(text).not.toMatch(/outside your reach|could not|did not work|refused|cannot|can’t|isn’t allowed|not allowed/i))
  await page.getByTestId('campaign-banner-close').click()
  await expect(d).toHaveCount(0)
  return text
}
/**
 * Save on the task list. If a row is refused for want of hours (the workflow gives its steps none), that is recorded
 * as a failed check with the message; then — as the message tells a person to — each row gets 2 hours with + and
 * Save is pressed again, so the rest of the script can be walked.
 */
async function saveList(s: S, pg: Page, ids: string[]) {
  const save = pg.getByTestId('piece-panel-tasks-save')
  s.did(`Pressed “${((await save.textContent()) ?? '').trim()}”.`)
  await save.click()
  const err = pg.locator('[data-testid^="piece-panel-tasks-error-"]')
  const d = pg.getByTestId('campaign-banner-dialog')
  await expect(err.or(d).first()).toBeVisible({ timeout: 20_000 })
  if (await err.count()) {
    const msgs = (await err.allTextContents()).map((x) => x.trim())
    s.saw(`Refused on the row: “${msgs.join(' | ')}”`)
    await s.during(pg, 'Refused at the first Save', err.first())
    await s.check('booked at the first Save, as the script says', () => { throw new Error(`refused — ${msgs.join(' | ')}`) })
    s.did('As the message says, gave each of those rows 2 hours with + and pressed Save again.')
    for (const id of ids) await hoursTo(pg, 'piece-panel-tasks', id, 2)
    await save.click()
  }
  await banner(s, pg)
}
const panelTitles = (page: Page) => page.locator('[data-testid^="piece-panel-tasks-row-"]').evaluateAll((els) =>
  els.map((e) => (e.querySelector('.sc-task-name, .sc-name-input') as HTMLElement | null)?.textContent?.trim() ?? (e.querySelector('input') as HTMLInputElement | null)?.value ?? ''))

// ------------------------------------------------------------------------------ the walk ----

test.describe('Edward’s test script, 4 Oct', () => {
  test.skip(!WALK && !RENDER, 'review walk — run with WALK=1 (or RENDER=1 to re-render)')
  test.setTimeout(120 * 60_000)
  test.use({ actionTimeout: 15_000 })

  test('render the report again from report.json', async ({ page }) => {
    test.skip(!RENDER, 'RENDER=1 only')
    const data = JSON.parse(readFileSync(path.join(OUT, 'report.json'), 'utf8')) as { notes: string[]; steps: StepRec[] }
    writeFileSync(path.join(OUT, 'REPORT.html'), await render(data.steps, data.notes, page))
  })

  test('all 38 steps', async ({ browser, page: scratch }) => {
    test.skip(!WALK, 'WALK=1 only')
    const rep = new Report()
    const pages = new Pages(browser)
    async function step(n: number, who: Tag, text: string, expected: string, body: (s: S) => Promise<void>) {
      if (n < FROM || (ONLY.length && !ONLY.includes(n))) return
      const r: StepRec = { n, section: sectionOf(n), text, who: ACTOR(who), expected, did: [], seen: [], checks: [], shots: [], outcome: 'Pass', reason: '' }
      rep.steps.push(r)
      rep.flush()
      const s = new S(r, rep, pages)
      try {
        await body(s)
      } catch (e) {
        if (e instanceof SkipStep) { r.outcome = 'Skipped'; r.reason = e.message } else r.error = firstLines(e)
      }
      if (r.outcome !== 'Skipped') {
        const bad = r.checks.filter((c) => !c.ok)
        if (r.error || bad.length) {
          r.outcome = 'Fail'
          if (s.last && !r.shots.some((x) => x.phase === 'after')) await s.after(s.last, 'What the screen showed when the step stopped')
          r.reason = [r.error ? `Could not finish the step: ${r.error.split('\n')[0]}` : '', ...bad.map((c) => `${c.title} — ${(c.detail ?? '').split('\n')[0]}`)].filter(Boolean).join(' · ')
          for (const tag of s.used) await pages.drop(tag)
        } else r.reason = r.checks.length ? `${r.checks.length} of ${r.checks.length} checks held` : 'done as written'
      }
      rep.flush()
    }

    // ===================================================================== the data on the database (read only) ====
    const [camp] = await rows<{ id: string; client_id: string; languages: string[] }>('campaigns', `select=id,client_id,languages&name=eq.${encodeURIComponent(CAMPAIGN)}&kind=eq.campaign`)
    expect(camp, 'the campaign Northwind Summer Launch is on the database').toBeTruthy()
    const CID = camp!.id
    const dels = await rows<{ id: string; code: string; name: string }>('deliverables', `select=id,code,name,streams!inner(campaign_id)&streams.campaign_id=eq.${CID}`)
    const byCode = (c: string) => dels.find((d) => d.code === c)?.id ?? ''
    const LV1 = byCode('LV-001'), LV2 = byCode('LV-002'), LV3 = byCode('LV-003')
    expect(LV1 && LV2, 'LV-001 and LV-002 exist').toBeTruthy()
    const lv2 = await tasksOf(LV2)
    const find = (list: T[], re: RegExp) => list.find((t) => re.test(t.title))
    const CD = find(lv2, /^Creative Direction/)!, DC = find(lv2, /^Develop Concept/)!, WC = find(lv2, /^Write Copy/)!, TR = find(lv2, /^Translation/)!
    const CA = [1, 2, 3].map((i) => lv2.find((t) => /^Create Artwork/.test(t.title) && t.unit_index === i)!)
    const RES = { tl: await resourceIdOf('tl'), deputy: await resourceIdOf('deputy'), maker: await resourceIdOf('maker'), writer: await resourceIdOf('writer'), motiontl: await resourceIdOf('motiontl'), copytl: await resourceIdOf('copytl') }
    const UID = { tl: await idOf('tl'), deputy: await idOf('deputy'), maker: await idOf('maker'), writer: await idOf('writer'), am: await idOf('am'), motiontl: await idOf('motiontl'), copytl: await idOf('copytl') }
    const tagOfUser = (uid: string | null): Tag | null => (Object.entries(UID).find(([, v]) => v === uid)?.[0] as Tag | undefined) ?? null
    const [copyTeam] = await rows<{ id: string }>('teams', 'select=id&name=eq.Copy')
    const [designTeam] = await rows<{ id: string }>('teams', 'select=id&name=eq.Design')
    // The working days, from today (Baghdad's week, Sun–Thu).
    // From a Sunday — today when it is one, else the coming Sunday — so D0–D4 are one week on the grid whatever day the
    // walk runs (run on a Monday, "from today" put D4 in next week and the grid's Thursday cell was not there).
    const toSunday = (7 - new Date(`${day(0)}T12:00:00Z`).getUTCDay()) % 7
    const D: string[] = []
    for (let n = toSunday; D.length < 8; n++) { const d = workday(n); if (!D.includes(d)) D.push(d) }
    const [D0, D1, D2, D3, D4] = D as [string, string, string, string, string]
    WALK_WEEK = D0
    if (process.env.WALK_NOTE) rep.notes.push(process.env.WALK_NOTE)
    if (FROM > 1 && !ONLY.length) rep.notes.push(`Resumed at step ${FROM} at ${new Date().toISOString().slice(11, 16)} UTC on the same data: the first pass was stopped because of a fault in the walk itself (it left the deliverable’s side panel open over the menu, so the menu could not be pressed). Steps 1–${FROM - 1} and their pictures are from the first pass.`)
    else rep.notes.push(`Walked ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC on the local database as it stood (not reset). This working week: ${D0} – ${D4}. Another browser test was running on the same database at the same time, so the Schedule also shows its test jobs.`)
    if (FROM === 1) rep.notes.push(`Starting state of LV-002: ${lv2.map((t) => t.title).join(' · ')}.`)
    const st: Record<string, string> = {}
    if (FROM > 1 || ONLY.length) {
      // What earlier passes made, read back so a resumed pass knows it.
      st.askWC = (await requestsOn(WC.id))[0]?.id ?? ''
      st.own = (await rows<{ id: string }>('sub_tasks', `select=id&deliverable_id=eq.${LV2}&title=eq.Storyboard%20review&status=neq.cancelled`))[0]?.id ?? ''
      if (ONLY.length && Math.min(...ONLY) > 31) st.reopened = (await tasksOf(LV1)).find((t) => /^Create Artwork/.test(t.title))?.id ?? ''
    }
    // Walking 6–8 again on used data: their tasks were booked in the first pass. Dev Team Lead — LV-002's owner, who
    // may cancel any of its bookings — takes them off first through the app's own call (Cancel this booking), so the
    // steps start from unbooked tasks as written. Said in the report's notes.
    if (ONLY.some((n) => n >= 6 && n <= 8)) {
      const held = [...(ONLY.includes(6) ? [CA[0]!] : []), ...(ONLY.includes(7) ? [CA[1]!, CA[2]!] : []), ...(ONLY.includes(8) ? [WC] : [])]
      const freed: string[] = []
      for (const t of held) {
        if (!(await taskRow(t.id)).assignee_id) continue
        await rpcAs('tl', 'unassign_task', { p_sub_task: t.id, p_confirm_started: false })
        freed.push(t.title)
      }
      if (freed.length) rep.notes.push(`Set-up for walking steps 6–8 again (${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC): Dev Team Lead cancelled the first pass’s bookings of ${freed.join(', ')} (as Cancel this booking does), so the steps start from unbooked tasks. Their hours stayed as they were.`)
    }

    // ===================================================================== A ====
    await step(1, 'tl', 'Campaigns → Northwind Summer Launch → open LV-002 Social launch films.',
      'The suggested list, with no Who and no Dates: Creative Direction, Develop Concept, Write Copy, Translation (Arabic, English), Create Artwork · TV Advertisement 1, 2, 3, in that order.', async (s) => {
        const pg = await s.page('tl')
        // Walked again on used data (WALK_ONLY), LV-002's list is long approved: the same screen is read on the
        // campaign's deliverable whose list still waits for approval (LV-003), and the step says so.
        const lv2Open = (await deliverable(LV2)).tasks_approved_at == null
        const A1 = lv2Open ? LV2 : LV3
        const code = lv2Open ? 'LV-002' : 'LV-003'
        const name = dels.find((d) => d.id === A1)?.name ?? code
        await openCampaign(pg, CID)
        await s.before(pg, 'The campaign page', pg.getByTestId(`campaign-deliverable-${A1}`))
        if (!lv2Open) s.did(`LV-002’s task list was approved in the first pass, so the suggested list was read on ${code} ${name}, the campaign’s deliverable whose list still waits for approval.`)
        s.did(`Opened Campaigns, then Northwind Summer Launch, then pressed Open on ${code} ${name}.`)
        const tab = pg.getByTestId('campaign-tab-grid')
        if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
        await pg.getByTestId(`campaign-deliverable-open-${A1}`).click()
        await expect(pg.getByTestId('piece-panel-tasks')).toBeVisible({ timeout: 25_000 })
        await s.after(pg, `${code} open: its task list`, pg.getByTestId('piece-panel-tasks'))
        const titles = await panelTitles(pg)
        s.saw(`Rows, in order: ${titles.join(' | ')}`)
        const statuses = await pg.locator('[data-testid^="piece-panel-tasks-status-"]').allTextContents()
        s.saw(`Status column: ${statuses.join(', ')}`)
        const bannerText = ((await pg.getByTestId('piece-panel-tasks-banner').textContent()) ?? '').trim()
        s.saw(`Banner: “${bannerText}”`)
        const type = lv2Open ? 'TV Advertisement' : 'Social Advertisement'
        const units = (await tasksOf(A1)).filter((t) => /^Create Artwork/.test(t.title)).length
        await s.check('the rows are in the expected order', () => expect(titles).toEqual([
          'Creative Direction — Northwind Summer Launch', 'Develop Concept — Northwind Summer Launch', 'Write Copy — Northwind Summer Launch',
          'Translation — Northwind Summer Launch (Arabic, English)',
          ...Array.from({ length: units }, (_, i) => `Create Artwork — Northwind Summer Launch · ${type} ${i + 1}`)]))
        await s.check('no Who and no Dates before the list is approved', async () => {
          await expect(pg.locator('[data-testid^="piece-panel-tasks-who-"]')).toHaveCount(0)
          await expect(pg.locator('[data-testid^="piece-panel-tasks-dates-"]')).toHaveCount(0)
        })
        await s.check('every row is marked “Suggested”', () => expect(statuses.every((x) => x.trim() === 'Suggested'), `statuses: ${statuses.join(', ')}`).toBe(true))
        await s.check('the banner counts every row as suggested, none as “yours”', () => expect(bannerText).not.toMatch(/of yours/))
      })

    await step(2, 'tl', 'Rename the first task, change one task’s hours, remove one with ✕ → Undo for a few seconds; press Undo → it comes back.',
      'The new name and the hours are kept; the removed task disappears with an Undo line, and Undo brings it back.', async (s) => {
        const pg = await s.page('tl')
        if (!(await pg.getByTestId('piece-panel-tasks').count())) await openDeliverable(pg, CID, LV2)
        await s.before(pg, 'Before', pg.getByTestId('piece-panel-tasks'))
        const newName = 'Creative Direction — summer films'
        s.did(`Clicked the first task’s name and typed “${newName}”, Enter.`)
        await pg.getByTestId(`piece-panel-tasks-rename-${CD.id}`).click()
        await pg.getByTestId(`piece-panel-tasks-name-${CD.id}`).fill(newName)
        await pg.getByTestId(`piece-panel-tasks-name-${CD.id}`).press('Enter')
        await s.check('the new name is saved', () => expect.poll(async () => (await taskRow(CD.id)).title, { timeout: 10_000 }).toBe(newName))
        s.did('Pressed + on Develop Concept’s hours until it read 2h.')
        await hoursTo(pg, 'piece-panel-tasks', DC.id, 2)
        await s.check('Develop Concept’s hours are 2 on the database', () => expect.poll(async () => Number((await taskRow(DC.id)).sla_hours), { timeout: 10_000 }).toBe(2))
        s.did('Pressed ✕ on Develop Concept.')
        await pg.getByTestId(`piece-panel-tasks-remove-${DC.id}`).click()
        await expect(pg.getByTestId('piece-panel-tasks-undo')).toBeVisible()
        await s.during(pg, 'Just after ✕ — the Undo line', pg.getByTestId('piece-panel-tasks-undo'))
        s.saw(`Undo line: “${((await pg.getByTestId('piece-panel-tasks-undo').textContent()) ?? '').trim()}”`)
        await s.check('the row left the list while Undo shows', () => expect(pg.getByTestId(`piece-panel-tasks-row-${DC.id}`)).toHaveCount(0))
        s.did('Pressed Undo.')
        await pg.getByTestId('piece-panel-tasks-undo-button').click()
        await s.check('Develop Concept is back in the list', () => expect(pg.getByTestId(`piece-panel-tasks-row-${DC.id}`)).toBeVisible())
        await pg.waitForTimeout(9_000) // past the 8-second window: nothing removed behind the screen
        await s.check('it is still on the database after the Undo window closed', async () => expect((await taskRow(DC.id)).status).not.toBe('cancelled'))
        await s.after(pg, 'After Undo', pg.getByTestId('piece-panel-tasks'))
      })

    await step(3, 'tl', '+ Add a task, type “ab” → refused (at least 3 letters); type a proper name, Enter.',
      '“ab” cannot be added (the hint says at least 3 letters); the proper name is added as a new row.', async (s) => {
        const pg = await s.page('tl')
        if (!(await pg.getByTestId('piece-panel-tasks').count())) await openDeliverable(pg, CID, LV2)
        await s.before(pg, 'Before', pg.getByTestId('piece-panel-tasks-add'))
        s.did('Pressed “+ Add a task”, typed “ab”, pressed Enter.')
        await pg.getByTestId('piece-panel-tasks-add').click()
        await pg.getByTestId('piece-panel-tasks-add-name').fill('ab')
        await pg.getByTestId('piece-panel-tasks-add-name').press('Enter')
        await pg.waitForTimeout(1500)
        await s.during(pg, '“ab” typed and Enter pressed', pg.getByTestId('piece-panel-tasks-add-name'))
        const hint = ((await pg.locator('.sc-add-line .sc-foot-note').textContent()) ?? '').trim()
        s.saw(`Hint under the box: “${hint}”`)
        await s.check('Add is not pressable for “ab”', () => expect(pg.getByTestId('piece-panel-tasks-add-save')).toBeDisabled())
        await s.check('the hint says at least 3 letters', () => expect(hint).toMatch(/at least 3 letters/))
        await s.check('no task “ab” was made', async () => expect((await rows('sub_tasks', `select=id&deliverable_id=eq.${LV2}&title=eq.ab`)).length).toBe(0))
        const name = 'Storyboard review'
        s.did(`Typed “${name}” instead, pressed Enter.`)
        await pg.getByTestId('piece-panel-tasks-add-name').fill(name)
        await pg.getByTestId('piece-panel-tasks-add-name').press('Enter')
        await expect.poll(async () => (await rows<{ id: string }>('sub_tasks', `select=id&deliverable_id=eq.${LV2}&title=eq.${encodeURIComponent(name)}&status=neq.cancelled`)).length, { timeout: 10_000 }).toBe(1)
        st.own = (await rows<{ id: string }>('sub_tasks', `select=id&deliverable_id=eq.${LV2}&title=eq.${encodeURIComponent(name)}&status=neq.cancelled`))[0]!.id
        await s.check('the new row is on the list', () => expect(pg.getByTestId(`piece-panel-tasks-row-${st.own}`)).toBeVisible())
        await s.after(pg, 'After Enter', pg.getByTestId(`piece-panel-tasks-row-${st.own}`))
      })

    await step(4, 'tl', 'Approve N tasks → green “Task list approved”; rows now have Who, Dates, pencil, ✕.',
      'The list is approved: a green “Task list approved” line; every row gains Who and Dates, and keeps the pencil and ✕.', async (s) => {
        const pg = await s.page('tl')
        if (!(await pg.getByTestId('piece-panel-tasks').count())) await openDeliverable(pg, CID, LV2)
        const btn = pg.getByTestId('piece-panel-tasks-approve')
        await s.before(pg, 'Before', btn)
        s.did(`Pressed “${((await btn.textContent()) ?? '').trim()}”.`)
        await btn.click()
        await banner(s, pg, 'during')
        await s.check('approved on the database', () => expect.poll(async () => (await deliverable(LV2)).tasks_approved_at, { timeout: 10_000 }).not.toBeNull())
        const b = pg.getByTestId('piece-panel-tasks-banner')
        await s.after(pg, 'After approving', b)
        const bt = ((await b.textContent()) ?? '').trim()
        s.saw(`Banner: “${bt}”`)
        await s.check('the banner reads “Task list approved”', () => expect(bt).toMatch(/Task list approved/))
        await s.check('the banner is the green (approved) one', async () => expect(await b.getAttribute('class')).toMatch(/is-approved/))
        const n = await pg.locator('[data-testid^="piece-panel-tasks-row-"]').count()
        await s.check(`every row (${n}) has Who, Dates, a pencil and ✕`, async () => {
          for (const id of [CD.id, DC.id, WC.id, TR.id, CA[0]!.id, CA[1]!.id, CA[2]!.id, st.own!]) {
            for (const k of ['who', 'dates', 'edit', 'remove']) await expect(pg.getByTestId(`piece-panel-tasks-${k}-${id}`), `${k} on ${id}`).toBeVisible()
          }
        })
      })

    await step(5, 'tl', 'Create Artwork 1 → Who → only her team (Dev Team Lead, Dev Deputy Lead, Dev Maker) with free hours + “Ask another team…”; pick Dev Maker, set Dates to a day this week.',
      'Who lists exactly her three people, each with free hours, and “Ask another team…”; Dev Maker and the day are set on the row.', async (s) => {
        const pg = await s.page('tl')
        if (!(await pg.getByTestId('piece-panel-tasks').count())) await openDeliverable(pg, CID, LV2)
        await s.before(pg, 'Before', pg.getByTestId(`piece-panel-tasks-row-${CA[0]!.id}`))
        s.did('Pressed Who on Create Artwork · TV Advertisement 1.')
        await pg.getByTestId(`piece-panel-tasks-who-${CA[0]!.id}`).click()
        const pop = pg.getByTestId('piece-panel-tasks-who-pop')
        await expect(pop).toBeVisible()
        await s.during(pg, 'Who open', pop)
        const names = await pop.locator('.sc-person-name').allTextContents()
        const free = await pop.locator('.sc-person-free').allTextContents()
        s.saw(`Who lists: ${names.map((x, i) => `${x} (${free[i] ?? '?'})`).join(', ')}`)
        await s.check('only her team: Dev Team Lead, Dev Deputy Lead, Dev Maker', () => expect([...names].sort()).toEqual(['Dev Deputy Lead', 'Dev Maker', 'Dev Team Lead']))
        await s.check('each with free hours', () => expect(free.length === names.length && free.every((f) => /h/.test(f))).toBe(true))
        await s.check('“Ask another team…” is offered', () => expect(pg.getByTestId('piece-panel-tasks-people-ask-other')).toBeVisible())
        s.did(`Picked Dev Maker; Dates → ${D1} (Monday), Done.`)
        await pg.getByTestId(`piece-panel-tasks-people-${RES.maker}`).click()
        await pg.getByTestId(`piece-panel-tasks-dates-${CA[0]!.id}`).click()
        await pickOneDay(pg, 'piece-panel-tasks-dates-picker', D1)
        await s.after(pg, 'Dev Maker and Monday set (not saved yet)', pg.getByTestId(`piece-panel-tasks-row-${CA[0]!.id}`))
        await s.check('the row shows Dev Maker’s avatar and the day', async () => {
          await expect(pg.getByTestId(`piece-panel-tasks-who-${CA[0]!.id}`)).toContainText('Dev')
          await expect(pg.getByTestId(`piece-panel-tasks-dates-${CA[0]!.id}`)).not.toContainText(/Pick/i)
        })
      })

    await step(6, 'tl', 'Checked by → a reviewer; Save → booked; row Booked, Dev Maker, the day.',
      'Saved: Create Artwork 1 is booked for Dev Maker on the day; the row reads Booked.', async (s) => {
        const pg = await s.page('tl')
        if (!(await pg.getByTestId(`piece-panel-tasks-row-${CA[0]!.id}`).count())) {
          s.did(`Walked again on its own: opened LV-002 and made step 5’s choice again — Who → Dev Maker, Dates → ${D1}.`)
          await openDeliverable(pg, CID, LV2)
          await pg.getByTestId(`piece-panel-tasks-who-${CA[0]!.id}`).click()
          await pg.getByTestId(`piece-panel-tasks-people-${RES.maker}`).click()
          await pg.getByTestId(`piece-panel-tasks-dates-${CA[0]!.id}`).click()
          await pickOneDay(pg, 'piece-panel-tasks-dates-picker', D1)
        }
        // How Fadia works (Edward, 4 Oct): the person booking gives the task its hours, then books it.
        s.did('Gave Create Artwork 1 its hours: 2 (with + / −).')
        await hoursTo(pg, 'piece-panel-tasks', CA[0]!.id, 2)
        const sel = pg.getByTestId('piece-panel-tasks-reviewer')
        await s.before(pg, 'Before', sel)
        if (await sel.count()) {
          const opts = await sel.locator('option').allTextContents()
          s.saw(`Checked by offers: ${opts.join(', ')}`)
          s.did('Checked by → Dev Team Lead; pressed Save.')
          await sel.selectOption({ label: 'Dev Team Lead' })
        } else s.saw('No “Checked by” line: the task already has its reviewer from the first pass, so none is asked for.')
        await saveList(s, pg, [CA[0]!.id])
        await s.check('Dev Maker holds it on the database, on the day', async () => {
          await expect.poll(async () => (await taskRow(CA[0]!.id)).assignee_id, { timeout: 15_000 }).toBe(UID.maker)
          expect(iraqDayOf((await taskRow(CA[0]!.id)).starts_at)).toBe(D1)
        })
        await s.check('the row reads Booked', () => expect(pg.getByTestId(`piece-panel-tasks-status-${CA[0]!.id}`)).toHaveAttribute('data-status', 'booked'))
        const row = pg.getByTestId(`piece-panel-tasks-row-${CA[0]!.id}`)
        s.saw(`Row now: “${((await row.textContent()) ?? '').replace(/\s+/g, ' ').trim()}”`)
        await s.after(pg, 'After Save', row)
      })

    await step(7, 'tl', 'Tick Create Artwork 2 and 3 → dark bar → Dev Deputy Lead, a day, Apply, Save → both hers.',
      'A dark bar appears for the two ticked rows; after Apply and Save both are booked for Dev Deputy Lead on the day.', async (s) => {
        const pg = await s.page('tl')
        if (!(await pg.getByTestId('piece-panel-tasks').count())) await openDeliverable(pg, CID, LV2)
        await s.before(pg, 'Before', pg.getByTestId(`piece-panel-tasks-row-${CA[1]!.id}`))
        s.did('Ticked Create Artwork 2 and 3.')
        await pg.getByTestId(`piece-panel-tasks-select-${CA[1]!.id}`).check()
        await pg.getByTestId(`piece-panel-tasks-select-${CA[2]!.id}`).check()
        await expect(pg.getByTestId('piece-panel-tasks-bulk')).toBeVisible()
        s.did(`Bar: Pick a person → Dev Deputy Lead; Pick a day → ${D2} (Tuesday); Apply.`)
        await pg.getByTestId('piece-panel-tasks-bulk-who').click()
        await pg.getByTestId(`piece-panel-tasks-bulk-people-${RES.deputy}`).click()
        await pg.getByTestId('piece-panel-tasks-bulk-day').click()
        await pg.getByTestId(`piece-panel-tasks-bulk-day-picker-day-${D2}`).click()
        await s.during(pg, 'The dark bar, filled in', pg.getByTestId('piece-panel-tasks-bulk'))
        await pg.getByTestId('piece-panel-tasks-bulk-apply').click()
        s.did('Gave each its hours: 2.')
        for (const t of [CA[1]!, CA[2]!]) await hoursTo(pg, 'piece-panel-tasks', t.id, 2)
        const rv = pg.getByTestId('piece-panel-tasks-reviewer')
        if ((await rv.count()) && !(await rv.inputValue())) { s.did('“Checked by” was empty: picked Dev Team Lead.'); await rv.selectOption({ label: 'Dev Team Lead' }) }
        await saveList(s, pg, [CA[1]!.id, CA[2]!.id])
        await s.check('both are Dev Deputy Lead’s, on the day', async () => {
          for (const t of [CA[1]!, CA[2]!]) {
            await expect.poll(async () => (await taskRow(t.id)).assignee_id, { timeout: 15_000 }).toBe(UID.deputy)
            expect(iraqDayOf((await taskRow(t.id)).starts_at)).toBe(D2)
          }
        })
        await s.after(pg, 'After Save', pg.getByTestId(`piece-panel-tasks-row-${CA[1]!.id}`))
      })

    await step(8, 'tl', 'Write Copy → Who → Ask another team… → Copy → “Anyone — Dev decides” → send → “⏳ Copy · asked”, status “Asked Copy”.',
      'The ask goes to the Copy team; Write Copy’s Who reads “⏳ Copy · asked” and its status “Asked Copy”.', async (s) => {
        const pg = await s.page('tl')
        if (!(await pg.getByTestId('piece-panel-tasks').count())) await openDeliverable(pg, CID, LV2)
        await s.before(pg, 'Before', pg.getByTestId(`piece-panel-tasks-row-${WC.id}`))
        const rv = pg.getByTestId('piece-panel-tasks-reviewer')
        if ((await rv.count()) && !(await rv.inputValue())) {
          s.did('“Checked by” was empty, so picked Dev Team Lead first (an ask needs a reviewer on the task).')
          await rv.selectOption({ label: 'Dev Team Lead' })
        }
        s.did('Gave Write Copy its hours: 2.')
        await hoursTo(pg, 'piece-panel-tasks', WC.id, 2)
        s.did('Who on Write Copy → “Ask another team…” → team Copy.')
        await pg.getByTestId(`piece-panel-tasks-who-${WC.id}`).click()
        await pg.getByTestId('piece-panel-tasks-people-ask-other').click()
        await pg.getByTestId('piece-panel-tasks-people-ask-team').selectOption({ label: 'Copy' })
        const anyone = pg.getByTestId('piece-panel-tasks-people-ask-anyone')
        await expect(anyone).toBeVisible()
        s.saw(`The first choice reads “${((await anyone.textContent()) ?? '').replace(/\s+/g, ' ').trim()}”`)
        await s.during(pg, 'Copy chosen — its people and “Anyone”', anyone)
        s.did('Pressed “Anyone — Dev decides” (the ask is sent at that press).')
        await anyone.click()
        const said = await banner(s, pg, null, false)
        if (/no hours/i.test(said)) {
          await s.check('the ask is sent at the first press, as the script says', () => { throw new Error(`refused — ${said}`) })
          s.did('As the message says, gave Write Copy 2 hours with +, then Who → Ask another team… → Copy → “Anyone — Dev decides” again.')
          await hoursTo(pg, 'piece-panel-tasks', WC.id, 2)
          await pg.getByTestId(`piece-panel-tasks-who-${WC.id}`).click()
          await pg.getByTestId('piece-panel-tasks-people-ask-other').click()
          await pg.getByTestId('piece-panel-tasks-people-ask-team').selectOption({ label: 'Copy' })
          await pg.getByTestId('piece-panel-tasks-people-ask-anyone').click()
          await banner(s, pg)
        } else await s.check('the message is not a refusal', () => expect(said).not.toMatch(/did not work|could not|refused/i))
        const asked = pg.getByTestId(`piece-panel-tasks-asked-${WC.id}`)
        await s.check('Who reads “⏳ Copy · asked”', () => expect(asked).toHaveText(/⏳\s*Copy · asked/))
        await s.check('the status reads “Asked Copy”', () => expect(pg.getByTestId(`piece-panel-tasks-status-${WC.id}`)).toHaveText('Asked Copy'))
        const req = (await requestsOn(WC.id))[0]
        st.askWC = req?.id ?? ''
        await s.check('an ask to the Copy team waits on the database', () => expect(req).toMatchObject({ status: 'pending', team_id: copyTeam!.id, assignee_id: null }))
        s.saw(`Who now: “${((await asked.textContent().catch(() => '')) ?? '').trim()}”; status: “${((await pg.getByTestId(`piece-panel-tasks-status-${WC.id}`).textContent()) ?? '').trim()}”`)
        await s.after(pg, 'After the ask', pg.getByTestId(`piece-panel-tasks-row-${WC.id}`))
      })

    await step(9, 'tl', 'Pencil on Create Artwork 1 → one window with every detail; change notes; Save → the window closes.',
      'One window with the task’s name, notes, hours, who, dates, waits for, reviewer and review; after Save it closes and the notes are kept.', async (s) => {
        const pg = await s.page('tl')
        if (!(await pg.getByTestId('piece-panel-tasks').count())) await openDeliverable(pg, CID, LV2)
        await s.before(pg, 'Before', pg.getByTestId(`piece-panel-tasks-row-${CA[0]!.id}`))
        s.did('Pressed the pencil on Create Artwork 1.')
        await pg.getByTestId(`piece-panel-tasks-edit-${CA[0]!.id}`).click()
        const dlg = pg.getByTestId('task-editor-dialog')
        await expect(dlg).toBeVisible()
        await expect(pg.getByTestId('task-editor-dialog-form')).toBeVisible({ timeout: 15_000 })
        await s.check('every detail is in the one window', async () => {
          for (const k of ['title', 'notes', 'hours', 'dates', 'waits', 'reviewer']) await expect(pg.getByTestId(`task-editor-dialog-form-${k}`), k).toBeVisible()
          await expect(pg.locator('[data-testid="task-editor-dialog-form-who"], [data-testid="task-editor-dialog-form-who-fixed"]')).toHaveCount(1)
          await expect(pg.locator('[data-testid^="task-editor-dialog-form-review-"]').first()).toBeVisible()
        })
        const note = `Two cuts: 15 seconds and 6 seconds. Arabic supers first. (${new Date().toISOString().slice(11, 16)})`
        s.did(`Typed the notes “${note}”; pressed Save.`)
        await pg.getByTestId('task-editor-dialog-form-notes').fill(note)
        await s.during(pg, 'The window, notes changed', dlg)
        await pg.getByTestId('task-editor-dialog-form-save').click()
        await s.check('the window closes', () => expect(dlg).toHaveCount(0, { timeout: 15_000 }))
        await s.check('the notes are saved', async () => expect.poll(async () => JSON.stringify((await rows('sub_tasks', `select=*&id=eq.${CA[0]!.id}`))[0]).includes(note), { timeout: 10_000 }).toBe(true))
        await s.after(pg, 'After Save')
      })

    // ===================================================================== B ====
    await step(10, 'tl', 'Schedule → “Your team”, three people; step-A bookings on the grid; “Asked of other teams” shows Write Copy Waiting; Copy’s ⏳ chip.',
      '“Your team” is on with three rows; Create Artwork 1 (Dev Maker, Monday) and 2, 3 (Dev Deputy Lead, Tuesday) are on the grid; the Write Copy ask is listed as Waiting and as a ⏳ chip.', async (s) => {
        const pg = await s.page('tl')
        await s.before(pg, 'Before (the campaign page)')
        s.did('Pressed Schedule in the menu.')
        await scheduleWeek(pg)
        await s.after(pg, 'The Schedule')
        await s.check('“Your team” is selected', () => expect(pg.getByTestId('view-team')).toHaveAttribute('aria-selected', 'true'))
        const rowsN = await pg.locator('[data-testid^="free-"]').count()
        s.saw(`People rows on the grid: ${rowsN}`)
        await s.check('three people: Dev Team Lead, Dev Deputy Lead, Dev Maker', async () => {
          expect(rowsN).toBe(3)
          for (const r of [RES.tl, RES.deputy, RES.maker]) await expect(pg.getByTestId(`free-${r}`)).toBeVisible()
        })
        await s.check('the step-A bookings are on the grid', async () => {
          for (const t of CA) { const b = (await bookingsOf(t.id))[0]; expect(b, `a booking for ${t.title}`).toBeTruthy(); await expect(pg.getByTestId(`booking-${b!.id}`)).toBeVisible() }
        })
        const card = pg.getByTestId(`ask-sent-${st.askWC}`)
        await s.check('“Asked of other teams” lists Write Copy, Waiting', async () => {
          await expect(card).toBeVisible()
          await expect(card).toContainText('Write Copy')
          await expect(pg.getByTestId(`ask-sent-state-${st.askWC}`)).toHaveText(/Waiting/i)
        })
        // The chip sits on the ask's own days, which can be outside the walk's week (an ask for a task with no days of its
        // own takes today): the Schedule is opened on that day to see it.
        // The grid places it by its days, else its needed-by day (`askDays`): an ask with no days yet sits on that day.
        const [askRow] = await rows<{ starts_at: string | null; needed_by: string | null }>('sub_task_assignment_requests', `select=starts_at,needed_by&id=eq.${st.askWC}`)
        const askDay = iraqDayOf(askRow?.starts_at ?? null) ?? askRow?.needed_by ?? null
        if (askDay) { s.did(`Opened the Schedule on ${askDay}, the ask’s day.`); await pg.goto(`/schedule?on=${askDay}`); await expect(pg.getByTestId('schedule-grid')).toBeVisible({ timeout: 25_000 }) }
        await s.check('the ⏳ chip for Copy is on the grid', () => expect(pg.getByTestId(`ask-chip-${st.askWC}`)).toBeVisible())
        if (await card.count()) { await s.during(pg, 'The ask card', card) }
      })

    await step(11, 'tl', 'To book → LV-001 (approve its list on the campaign page first if not listed) → “Now click a day on someone’s row”.',
      'LV-001 is in To book; picking it shows “Now click a day on someone’s row”.', async (s) => {
        const pg = await s.page('tl')
        await scheduleWeek(pg)
        await s.before(pg, 'Before', pg.getByTestId('to-book'))
        if (!(await pg.getByTestId(`to-book-${LV1}`).count())) {
          s.did('LV-001 was not in To book (its task list was not approved), so: Campaigns → Northwind Summer Launch → Open LV-001 → Approve, then back to the Schedule.')
          await openDeliverable(pg, CID, LV1)
          await pg.getByTestId('piece-panel-tasks-approve').click()
          await banner(s, pg, 'during')
          await expect.poll(async () => (await deliverable(LV1)).tasks_approved_at, { timeout: 10_000 }).not.toBeNull()
          await scheduleWeek(pg)
        } else if (FROM > 1) s.saw('LV-001 was already in To book: its list had been approved in this walk’s first pass (step 11 then), as this step allows.')
        s.did('Clicked LV-001 in To book.')
        await pg.getByTestId(`to-book-${LV1}`).click()
        const picked = pg.getByTestId('schedule-picked')
        await expect(picked).toBeVisible()
        const hint = pg.locator('.sc-tobook-hint')
        s.saw(`Line above the grid: “${((await picked.textContent()) ?? '').replace(/\s+/g, ' ').trim()}”; To book’s hint: “${((await hint.textContent().catch(() => '')) ?? '').trim()}”`)
        await s.check('it says “Now click a day on someone’s row”', () => expect(pg.getByTestId('to-book')).toContainText('Now click a day on someone’s row'))
        await s.after(pg, 'LV-001 picked', picked)
      })

    await step(12, 'tl', 'Click Wednesday on Dev Maker’s row → every task already Dev Maker on Wednesday; warnings, no block.',
      'The booking window opens with every task already set to Dev Maker on Wednesday; warnings show where the day is too full, and Book stays pressable.', async (s) => {
        const pg = await s.page('tl')
        // Walked again on used data, LV-001 is booked and no longer in To book: the same window is opened for the
        // deliverable that is (LV-002, its unbooked tasks), and the step says so.
        let target = LV1
        if (!(await pg.getByTestId('schedule-picked').count())) {
          await scheduleWeek(pg)
          if (!(await pg.getByTestId(`to-book-${LV1}`).count())) {
            const ids = await pg.locator('[data-testid^="to-book-"]').evaluateAll((els) =>
              els.map((e) => (e.getAttribute('data-testid') ?? '').slice(8)).filter((x) => /^[0-9a-f-]{36}$/.test(x)))
            const pick = ids.includes(LV2) ? LV2 : ids[0]
            if (!pick) s.skip('nothing is in To book on Dev Team Lead’s Schedule to open the window with')
            target = pick
            const label = ((await pg.getByTestId(`to-book-${pick}`).textContent()) ?? '').replace(/\s+/g, ' ').trim()
            s.did(`LV-001 is fully booked from the first pass and not in To book, so picked the first deliverable in To book instead: “${label}”.`)
          }
          await pg.getByTestId(`to-book-${target}`).click()
        }
        const cell = pg.getByTestId(`cell-${RES.maker}-${D3}`)
        await s.before(pg, 'Before', cell)
        s.did(`Clicked Wednesday ${D3} on Dev Maker’s row.`)
        await cell.click({ position: { x: 4, y: 4 } })
        await expect(pg.getByTestId('book-tasks')).toBeVisible({ timeout: 15_000 })
        const all = await tasksOf(target)
        if (target === LV1) st.lv1 = JSON.stringify(all.map((t) => t.id))
        await expect(pg.locator('[data-testid^="book-row-"]').first()).toBeVisible({ timeout: 15_000 })
        const inWindow: T[] = []
        for (const t of all) if (await pg.getByTestId(`book-row-${t.id}`).count()) inWindow.push(t)
        // How Fadia works (Edward, 4 Oct): the person booking gives each task its hours before booking.
        s.did(`Gave each of the ${inWindow.length} tasks its hours: 3 (with + / −).`)
        for (const t of inWindow) await hoursTo(pg, 'book', t.id, 3)
        await s.after(pg, 'The booking window, hours given')
        const whos = await pg.locator('[data-testid^="book-who-"]:not([data-testid^="book-who-list"]):not([data-testid^="book-who-pop"])').allTextContents()
        const dates = await pg.locator('[data-testid^="book-dates-"]:not([data-testid*="picker"]):not([data-testid*="pop"])').allTextContents()
        s.saw(`Who column: ${whos.map((x) => x.replace(/\s+/g, ' ').trim()).join(' | ')}`)
        s.saw(`Dates column: ${dates.map((x) => x.replace(/\s+/g, ' ').trim()).join(' | ')}`)
        await s.check(`every task in the window (${inWindow.length}) is Dev Maker on Wednesday`, async () => {
          expect(inWindow.length).toBeGreaterThan(0)
          for (const t of inWindow) {
            await expect(pg.getByTestId(`book-who-${t.id}`), t.title).toContainText('Dev Maker')
            await expect(pg.getByTestId(`book-dates-${t.id}`), t.title).toContainText(/Wed/)
          }
        })
        const warns = await pg.locator('[data-testid^="book-warn-"]').allTextContents()
        const foot = (await pg.getByTestId('book-summary').textContent()) ?? ''
        s.saw(`Warnings: ${warns.length ? warns.join(' | ') : 'none'}; foot: “${foot.trim()}”`)
        await s.check('warnings are shown', () => expect(warns.length > 0 || /check|over|full/i.test(foot), `warnings ${warns.length}, foot “${foot}”`).toBe(true))
        await s.check('no block: Book is pressable', () => expect(pg.getByTestId('book-submit')).toBeEnabled())
        s.saw(`The button reads “${((await pg.getByTestId('book-submit').textContent()) ?? '').trim()}”`)
      })

    await step(13, 'tl', 'Change one row to Dev Deputy Lead, pick a reviewer, Book → toast with Undo; tasks on the grid.',
      'Booked: a toast with Undo; LV-001’s tasks are on the grid (one on Dev Deputy Lead’s row).', async (s) => {
        const pg = await s.page('tl')
        const lv1 = await tasksOf(LV1)
        if (!(await pg.getByTestId('book-tasks').count())) {
          s.did(`The window from step 12 had closed (that step failed and its page was set aside), so opened it again the same way: Schedule → To book → LV-001 → Wednesday ${D3} on Dev Maker’s row.`)
          await scheduleWeek(pg)
          if (!(await pg.getByTestId(`to-book-${LV1}`).count())) {
            s.did('LV-001 was no longer in To book — its task list had been opened for approval again by the quantity change in step 29 (walked before this step in an earlier pass) — so approved it again on the campaign page first, as step 11 allows.')
            await openDeliverable(pg, CID, LV1)
            await pg.getByTestId('piece-panel-tasks-approve').click()
            await banner(s, pg)
            await scheduleWeek(pg)
          }
          const picked = pg.getByTestId('schedule-picked')
          const name = (await deliverable(LV1)).name
          if (!((await picked.count()) && ((await picked.textContent()) ?? '').includes(name))) await pg.getByTestId(`to-book-${LV1}`).click()
          await expect(picked).toContainText(name)
          await pg.getByTestId(`cell-${RES.maker}-${D3}`).click({ position: { x: 4, y: 4 } })
          await expect(pg.getByTestId(`book-row-${lv1[0]!.id}`)).toBeVisible({ timeout: 15_000 })
        }
        const first = lv1[0]!
        await s.before(pg, 'Before', pg.getByTestId(`book-row-${first.id}`))
        s.did(`Who on “${first.title}” → Dev Deputy Lead; reviewer → Dev Team Lead.`)
        await pg.getByTestId(`book-who-${first.id}`).click()
        await pg.getByTestId(`book-who-list-${RES.deputy}`).click()
        await pg.getByTestId('book-reviewer-add').selectOption({ label: 'Dev Team Lead' })
        if (!(await pg.getByTestId('book-submit').isEnabled())) {
          s.did('Book was not pressable while the tasks had 0 hours (step 12): pressed + on each row to 2 hours.')
          for (const t of lv1) await hoursTo(pg, 'book', t.id, 2)
        }
        const submit = pg.getByTestId('book-submit')
        s.did(`Pressed “${((await submit.textContent()) ?? '').trim()}”.`)
        await s.during(pg, 'Ready to book', submit)
        await submit.click()
        await expect(pg.getByTestId('book-tasks')).toHaveCount(0, { timeout: 45_000 })
        const toast = pg.getByTestId('schedule-toast')
        await s.check('a toast with Undo', async () => { await expect(toast).toBeVisible({ timeout: 15_000 }); await expect(pg.getByTestId('schedule-toast-undo')).toBeVisible() })
        if (await toast.count()) s.saw(`Toast: “${((await toast.textContent()) ?? '').replace(/\s+/g, ' ').trim()}”`)
        await s.after(pg, 'After Book — the toast', toast)
        await s.check('on the database: the first task Dev Deputy Lead’s, the rest Dev Maker’s, on Wednesday', async () => {
          await expect.poll(async () => (await taskRow(first.id)).assignee_id, { timeout: 20_000 }).toBe(UID.deputy)
          for (const t of lv1.slice(1)) { const r = await taskRow(t.id); expect(r.assignee_id, t.title).toBe(UID.maker); expect(iraqDayOf(r.starts_at), t.title).toBe(D3) }
        })
        await s.check('the tasks are on the grid', async () => {
          for (const t of lv1) { const b = (await bookingsOf(t.id))[0]; expect(b, `a booking for ${t.title}`).toBeTruthy(); await expect(pg.getByTestId(`booking-${b!.id}`)).toBeAttached() }
        })
      })

    const lv1CA = async () => (await tasksOf(LV1)).find((t) => /^Create Artwork/.test(t.title))!
    await step(14, 'tl', 'Click a booked chip → pop-up with every detail and “Tasks of this deliverable”; change hours, Save → closes.',
      'The pop-up shows every detail and the deliverable’s other tasks; after the hours change and Save it closes and the hours are kept.', async (s) => {
        const pg = await s.page('tl')
        await scheduleWeek(pg)
        const ca = await lv1CA()
        const b = (await bookingsOf(ca.id))[0]
        if (!b) s.skip('LV-001’s Create Artwork has no booking (step 13 did not book it)')
        const chip = pg.getByTestId(`booking-${b.id}`)
        await s.before(pg, 'Before', chip)
        s.did(`Clicked the chip “${ca.title}” on Dev Maker’s Wednesday.`)
        await chip.click()
        await expect(pg.getByTestId('task-popup')).toBeVisible()
        await expect(pg.getByTestId('edit-task')).toBeVisible({ timeout: 15_000 })
        const tasksBox = pg.getByTestId('edit-piece-tasks')
        await s.check('“Tasks of this deliverable” is in the pop-up', async () => { await expect(tasksBox).toBeVisible(); await expect(tasksBox).toContainText('Tasks of this deliverable') })
        await s.check('every detail is there (name, notes, hours, who, dates, waits for, reviewer)', async () => {
          for (const k of ['title', 'notes', 'hours', 'dates', 'waits', 'reviewer']) await expect(pg.getByTestId(`edit-task-${k}`), k).toBeVisible()
        })
        const h0 = Number((await taskRow(ca.id)).sla_hours ?? 0)
        s.did('Pressed + on the hours twice; Save.')
        await pg.getByTestId('edit-task-more').click()
        await pg.getByTestId('edit-task-more').click()
        await s.during(pg, 'The pop-up, hours changed', pg.getByTestId('task-popup'))
        await pg.getByTestId('edit-task-save').click()
        await s.check('the pop-up closes', () => expect(pg.getByTestId('task-popup')).toHaveCount(0, { timeout: 15_000 }))
        await s.check(`the hours are saved (${h0} → ${h0 + 2})`, () => expect.poll(async () => Number((await taskRow(ca.id)).sla_hours ?? 0), { timeout: 10_000 }).toBe(h0 + 2))
        await s.after(pg, 'After Save')
      })

    await step(15, 'tl', 'Drag a Create Artwork chip past the deliverable’s due date → warning offering to ask the account manager → change form prefilled → Cancel.',
      'Dropping the chip after LV-001’s due date warns and offers to ask the account manager; that opens the change form already filled in; Cancel leaves everything as it was.', async (s) => {
        const pg = await s.page('tl')
        await scheduleWeek(pg)
        const ca = await lv1CA()
        const due = iraqDayOf((await deliverable(LV1)).due_at)!
        // the first Sun–Thu after the due date, inside the 4-week view
        let target = new Date(Date.parse(`${due}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
        while ([5, 6].includes(new Date(`${target}T12:00:00Z`).getUTCDay())) target = new Date(Date.parse(`${target}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
        const addD = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
        let b = (await bookingsOf(ca.id))[0]
        let from = b ? iraqDayOf(b.starts_at)! : D3
        const viewEnd = addD(D0, 27)
        if (!b || target > viewEnd) {
          // The chip must be on the same 4 weeks as a day after the due date: give the task to Dev Maker a week before
          // the due date, on the campaign page (step 14 had taken it off her; see step 14).
          let near = addD(due, -7)
          while ([5, 6].includes(new Date(`${near}T12:00:00Z`).getUTCDay())) near = addD(near, -1)
          s.did(`Set-up: ${!b ? 'the task had no booking any more (step 14 took it off Dev Maker)' : 'the chip and a day after the due date do not fit in one 4-week view from this week'}, so on the campaign page gave “${ca.title}” to Dev Maker on ${near}, a week before the due date (Who, Dates, Save).`)
          await openDeliverable(pg, CID, LV1)
          await expect(pg.getByTestId(`piece-panel-tasks-row-${ca.id}`)).toBeVisible({ timeout: 20_000 })
          if (!(await pg.getByTestId(`piece-panel-tasks-who-${ca.id}`).count())) { await pg.getByTestId('piece-panel-tasks-approve').click(); await banner(s, pg) }
          await pg.getByTestId(`piece-panel-tasks-who-${ca.id}`).click()
          await pg.getByTestId(`piece-panel-tasks-people-${RES.maker}`).click()
          await pg.getByTestId(`piece-panel-tasks-dates-${ca.id}`).click()
          for (let i = 0; i < 8 && !(await pg.getByTestId(`piece-panel-tasks-dates-picker-day-${near}`).count()); i++) await pg.getByTestId('piece-panel-tasks-dates-picker-next').click()
          await pickOneDay(pg, 'piece-panel-tasks-dates-picker', near)
          const rv = pg.getByTestId('piece-panel-tasks-reviewer')
          if ((await rv.count()) && !(await rv.inputValue())) await rv.selectOption({ label: 'Dev Team Lead' })
          await pg.getByTestId('piece-panel-tasks-save').click()
          await banner(s, pg)
          await expect.poll(async () => (await bookingsOf(ca.id)).length, { timeout: 15_000 }).toBeGreaterThan(0)
          b = (await bookingsOf(ca.id))[0]!
          from = near
          s.did(`Opened the Schedule on the week of ${near} (address /schedule?on=${near}).`)
          await nav(pg, 'schedule')
          await pg.goto(`/schedule?on=${near}`)
          await expect(pg.getByTestId('schedule-grid')).toBeVisible({ timeout: 25_000 })
        }
        st.caDay = from
        s.did(`LV-001 is due ${due}. Switched the Schedule to 4 weeks and dragged “${ca.title}” from Dev Maker’s ${from} to Dev Maker’s ${target}.`)
        await pg.getByTestId('zoom-month').click()
        if (!b) s.skip('LV-001’s Create Artwork has no booking')
        await expect(pg.getByTestId(`cell-${RES.maker}-${target}`)).toBeAttached({ timeout: 15_000 })
        await s.before(pg, 'Before the drag (4 weeks)', pg.getByTestId(`booking-${b.id}`))
        await dragOnSchedule(pg, b.id, RES.maker, target)
        const warn = pg.getByTestId('drop-warning-dialog')
        await expect(warn).toBeVisible({ timeout: 15_000 })
        s.saw(`Warning: “${((await warn.textContent()) ?? '').replace(/\s+/g, ' ').trim()}”`)
        await s.during(pg, 'The warning after the drop', warn)
        await s.check('it offers to ask the account manager', () => expect(pg.getByTestId('drop-warning-extension')).toBeVisible())
        s.did('Pressed the offer to ask the account manager.')
        await pg.getByTestId('drop-warning-extension').click()
        const form = pg.getByTestId('schedule-change-ask')
        await s.check('the change form opens, filled in', async () => {
          await expect(form).toBeVisible()
          await expect(pg.getByTestId('schedule-change-ask-moved')).toBeVisible()
        })
        if (await form.count()) {
          s.saw(`Form: “${((await form.textContent()) ?? '').replace(/\s+/g, ' ').trim().slice(0, 400)}”`)
          const dueBox = pg.getByTestId('schedule-change-ask-due')
          if (await dueBox.count()) s.saw(`Its due-date box holds ${await dueBox.inputValue()}`)
          await s.during(pg, 'The change form', form)
          s.did('Pressed Cancel.')
          await pg.getByTestId('schedule-change-ask-cancel').click()
          await s.check('the form closes', () => expect(form).toHaveCount(0))
        }
        await s.check(`nothing moved: the task is still on ${from}`, async () => expect(iraqDayOf((await taskRow(ca.id)).starts_at)).toBe(from))
        await s.check('no change ask was sent', async () => expect((await rows('deliverable_change_asks', `select=id&deliverable_id=eq.${LV1}&status=eq.pending`)).length).toBe(0))
        await s.after(pg, 'After Cancel')
        await pg.getByTestId('zoom-week').click()
      })

    await step(16, 'tl', 'A booked task’s pop-up → Cancel this booking → Yes → back in To book; Dev Maker and Dev Team Lead notified, Dev Account Mgr not (check notifications rows).',
      'After Yes the task has nobody, LV-002 is back in To book, and Dev Maker is told — not Dev Team Lead, who pressed it herself (the person who acts is never told of her own act), and not Dev Account Mgr.', async (s) => {
        const pg = await s.page('tl')
        await scheduleWeek(pg)
        const b = (await bookingsOf(CA[0]!.id))[0]
        if (!b) s.skip('Create Artwork 1 of LV-002 has no booking')
        const chip = pg.getByTestId(`booking-${b.id}`)
        await s.before(pg, 'Before', chip)
        s.did('Clicked LV-002’s Create Artwork 1 (Dev Maker, Monday); pressed “Cancel this booking”.')
        await chip.click()
        await expect(pg.getByTestId('edit-task')).toBeVisible({ timeout: 15_000 })
        await pg.getByTestId('edit-cancel-booking').click()
        await expect(pg.getByTestId('edit-cancel-ask')).toBeVisible()
        s.saw(`It asked: “${((await pg.getByTestId('edit-cancel-ask').textContent()) ?? '').replace(/\s+/g, ' ').trim()}”`)
        await s.during(pg, 'Asked before cancelling', pg.getByTestId('edit-cancel-ask'))
        const since = new Date(Date.now() - 2_000).toISOString()
        s.did('Pressed Yes.')
        await pg.getByTestId('edit-cancel-yes').click()
        await s.check('the pop-up closes', () => expect(pg.getByTestId('task-popup')).toHaveCount(0, { timeout: 15_000 }))
        await s.check('the task has nobody now', () => expect.poll(async () => (await taskRow(CA[0]!.id)).assignee_id, { timeout: 15_000 }).toBeNull())
        await s.check('LV-002 is in To book', () => expect(pg.getByTestId(`to-book-${LV2}`)).toBeVisible({ timeout: 15_000 }))
        await pg.waitForTimeout(2_000)
        const told = await notesSince(CA[0]!.id, since)
        s.saw(`Notifications written: ${told.map((x) => `${tagOfUser(x.user_id) ?? x.user_id} (${x.type})`).join(', ') || 'none'}`)
        await s.check('Dev Maker is notified', () => expect(told.map((x) => x.user_id)).toContain(UID.maker))
        // Edward, 4 Oct: the lead who cancels is not told about her own action.
        await s.check('Dev Team Lead, who pressed it, is not', () => expect(told.map((x) => x.user_id)).not.toContain(UID.tl))
        await s.check('Dev Account Mgr is not', () => expect(told.map((x) => x.user_id)).not.toContain(UID.am))
        await s.after(pg, 'After Yes', pg.getByTestId(`to-book-${LV2}`))
      })

    await step(17, 'tl', '+ Block time → Leave → Dev Maker, Thursday → “On leave”; then as Dev Admin, People → Leave lists it.',
      'Thursday on Dev Maker’s row reads “On leave”; the People → Leave page lists the same leave.', async (s) => {
        const pg = await s.page('tl')
        await scheduleWeek(pg)
        await s.before(pg, 'Before', pg.getByTestId('block-time-open'))
        s.did(`Pressed “+ Block time”, Leave, Who → Dev Maker, from and to ${D4} (Thursday); Save.`)
        await pg.getByTestId('block-time-open').click()
        await expect(pg.getByTestId('block-time')).toBeVisible()
        await pg.getByTestId('block-time-leave').click()
        await blockTimeFill(pg, RES.maker, D4)
        await s.during(pg, 'Block time filled in', pg.getByTestId('block-time'))
        await pg.getByTestId('block-time-save').click()
        await expect(pg.getByTestId('block-time')).toHaveCount(0, { timeout: 15_000 })
        await scheduleWeek(pg)
        const cell = pg.getByTestId(`cell-${RES.maker}-${D4}`)
        await s.check('Thursday reads “On leave” for Dev Maker', () => expect(cell).toContainText('On leave'))
        await s.during(pg, 'The grid after', cell)
        const leave = (await rows<{ id: string }>('resource_unavailability', `select=id&resource_id=eq.${RES.maker}&kind=eq.leave&order=created_at.desc&limit=1`))[0]
        s.did('Signed in as Dev Admin; People → Leave.')
        const ad = await s.page('admin')
        await ad.goto('/')
        const people = ad.getByTestId('nav-people-leave')
        await people.waitFor({ timeout: 15_000 }).catch(() => {})
        if (await people.count()) await people.click()
        else { s.did('(No “Leave” item in Dev Admin’s menu at this width — opened /people/leave.)'); await ad.goto('/people/leave') }
        await s.check('People → Leave lists Dev Maker’s Thursday', async () => {
          await expect(ad.getByTestId(`leave-row-${leave?.id}`)).toBeVisible({ timeout: 20_000 })
          await expect(ad.getByTestId(`leave-row-${leave?.id}`)).toContainText('Dev Maker')
        })
        await s.after(ad, 'Dev Admin — People → Leave', ad.getByTestId(`leave-row-${leave?.id}`))
      })

    // ===================================================================== C ====
    await step(18, 'copytl', 'Dev Copy Lead → My work → “Asks from other teams” on top with Dev Team Lead’s Write Copy ask and time left.',
      'My work opens with “Asks from other teams” first, holding Dev Team Lead’s Write Copy ask with the time left to answer.', async (s) => {
        const pg = await s.page('copytl')
        await pg.goto('/')
        await s.before(pg, 'Before')
        s.did('Pressed My work.')
        await nav(pg, 'my-work')
        const card = pg.getByTestId(`my-work-ask-${st.askWC}`)
        await expect(pg.getByTestId('my-work-asks')).toBeVisible({ timeout: 20_000 })
        await s.after(pg, 'My work')
        await s.check('“Asks from other teams” is the first thing on the page', async () => expect(await pg.evaluate(() => document.querySelector('.mw-main')?.firstElementChild?.getAttribute('data-testid'))).toBe('my-work-asks'))
        await s.check('it holds Dev Team Lead’s Write Copy ask', async () => { await expect(card).toBeVisible(); await expect(card).toContainText('Write Copy'); await expect(card).toContainText('Dev Team Lead') })
        await s.check('with the time left', () => expect(pg.getByTestId(`my-work-ask-left-${st.askWC}`)).toBeVisible())
        if (await card.count()) s.saw(`Card: “${((await card.textContent()) ?? '').replace(/\s+/g, ' ').trim()}”`)
      })

    await step(19, 'copytl', 'Answer on your Schedule → Book / Offer another day / Say no; pick Dev Writer, keep the day, Book.',
      'The answer window offers Book, Offer another day and Say no; with Dev Writer on the day asked, Book books Write Copy for Dev Writer.', async (s) => {
        const pg = await s.page('copytl')
        if (!(await pg.getByTestId(`my-work-ask-answer-${st.askWC}`).count())) await nav(pg, 'my-work')
        await s.before(pg, 'Before', pg.getByTestId(`my-work-ask-${st.askWC}`))
        s.did('Pressed “Answer on your Schedule”.')
        await pg.getByTestId(`my-work-ask-answer-${st.askWC}`).click()
        const dlg = pg.getByTestId('answer-ask')
        await expect(dlg).toBeVisible({ timeout: 25_000 })
        await s.check('Book, Offer another day and Say no are offered', async () => {
          await expect(pg.getByTestId('answer-ask-book')).toBeVisible()
          await expect(pg.getByTestId('answer-ask-offer')).toBeVisible()
          await expect(pg.getByTestId('answer-ask-no')).toBeVisible()
        })
        s.did('Who → Dev Writer; kept the day; pressed Book.')
        await pg.getByTestId('answer-ask-who').click()
        await pg.getByTestId(`answer-ask-who-list-${RES.writer}`).click()
        await s.check('the day asked is kept (the window says so)', () => expect(pg.getByTestId('answer-ask-day-ok')).toBeVisible())
        await s.during(pg, 'The answer window, Dev Writer chosen', dlg)
        await pg.getByTestId('answer-ask-book').click()
        await s.check('the window closes', () => expect(dlg).toHaveCount(0, { timeout: 25_000 }))
        await s.check('Write Copy is Dev Writer’s on the database', () => expect.poll(async () => (await taskRow(WC.id)).assignee_id, { timeout: 20_000 }).toBe(UID.writer))
        await s.after(pg, 'After Book')
      })

    await step(20, 'tl', 'Dev Team Lead → Schedule → Write Copy “Booked” with OK; campaign page Write Copy shows Dev Writer.',
      'On her Schedule the Write Copy ask card reads Booked with OK; on the campaign page Write Copy shows Dev Writer.', async (s) => {
        const pg = await s.page('tl')
        await s.before(pg, 'Before')
        s.did('Pressed Schedule.')
        await scheduleWeek(pg)
        const card = pg.getByTestId(`ask-sent-${st.askWC}`)
        await s.check('the card reads Booked, with OK', async () => {
          await expect(card).toBeVisible()
          // The asks she sent re-read every 20 s (`useAsksISent`, LIVE); the live task refresh does not cover them (I74.50).
          await expect(pg.getByTestId(`ask-sent-state-${st.askWC}`)).toHaveText(/Booked/i, { timeout: 25_000 })
          await expect(pg.getByTestId(`ask-ok-${st.askWC}`)).toBeVisible()
        })
        await s.during(pg, 'The Schedule — the answer', card)
        s.did('Campaigns → Northwind Summer Launch → Open LV-002.')
        await openDeliverable(pg, CID, LV2)
        const who = pg.getByTestId(`piece-panel-tasks-who-${WC.id}`)
        await expect(pg.getByTestId('piece-panel-tasks')).toBeVisible()
        const whoText = ((await who.textContent()) ?? '').replace(/\s+/g, ' ').trim()
        const avatar = await who.locator('[aria-label], [title]').first().getAttribute('title').catch(() => null)
        s.saw(`Write Copy’s Who reads “${whoText}”${avatar ? `; the avatar’s tip: “${avatar}”` : ''}; status “${((await pg.getByTestId(`piece-panel-tasks-status-${WC.id}`).textContent()) ?? '').trim()}”`)
        await s.check('Write Copy shows Dev Writer', () => expect(who).toContainText('Dev Writer'))
        await s.after(pg, 'LV-002 on the campaign page', pg.getByTestId(`piece-panel-tasks-row-${WC.id}`))
      })

    // ===================================================================== D ====
    await step(21, 'tl', 'Dev Team Lead → LV-001 → Format, Language, Quantity, Hours, Due read-only, “Ask Dev Account Mgr to change it”.',
      'LV-001’s format, languages, quantity, hours and due date are shown read-only, with the button “Ask Dev Account Mgr to change it”.', async (s) => {
        const pg = await s.page('tl')
        await openCampaign(pg, CID)
        await s.before(pg, 'Before', pg.getByTestId(`campaign-deliverable-${LV1}`))
        s.did('Pressed Open on LV-001.')
        await openDeliverable(pg, CID, LV1)
        const strip = pg.getByTestId('piece-panel-ask-strip')
        await expect(strip).toBeVisible({ timeout: 15_000 })
        s.saw(`Read-only strip: “${((await strip.textContent()) ?? '').replace(/\s+/g, ' ').trim()}”`)
        await s.check('the strip names Format, Languages, Quantity, Hours and Due', async () => { for (const w of ['Format', 'Languages', 'Quantity', 'Hours', 'Due']) await expect(strip).toContainText(new RegExp(w, 'i')) })
        await s.check('none of them is editable', async () => { for (const k of ['due', 'quantity', 'languages', 'type', 'name']) await expect(pg.getByTestId(`piece-panel-${k}`), k).toHaveCount(0) })
        await s.check('“Ask Dev Account Mgr to change it” is offered', () => expect(pg.getByTestId('piece-panel-ask-ask')).toHaveText('Ask Dev Account Mgr to change it'))
        await s.after(pg, 'LV-001 for its owner', strip)
      })

    const NEW_DUE = '2026-11-05'
    await step(22, 'tl', 'Press it; tick “Due date isn’t possible”, later day, why, Send → “Waiting on Dev Account Mgr” with Withdraw.',
      'The ask is sent; LV-001 shows “Waiting on Dev Account Mgr” with Withdraw.', async (s) => {
        const pg = await s.page('tl')
        if (!(await pg.getByTestId('piece-panel-ask-ask').count())) await openDeliverable(pg, CID, LV1)
        await s.before(pg, 'Before', pg.getByTestId('piece-panel-ask-ask'))
        s.did(`Pressed “Ask Dev Account Mgr to change it”; ticked “Due date isn’t possible”; new day ${NEW_DUE}; why: “The client added two languages; the film needs another week.”; Send.`)
        await pg.getByTestId('piece-panel-ask-ask').click()
        await expect(pg.getByTestId('piece-panel-ask-form')).toBeVisible()
        const kind = pg.getByTestId('piece-panel-ask-form-kind-due_date')
        s.saw(`The tick reads “${((await kind.textContent()) ?? '').trim()}”`)
        await kind.click()
        await pg.getByTestId('piece-panel-ask-form-due').fill(NEW_DUE)
        await pg.getByTestId('piece-panel-ask-form-reason').fill('The client added two languages; the film needs another week.')
        await s.during(pg, 'The form filled in', pg.getByTestId('piece-panel-ask-form'))
        await pg.getByTestId('piece-panel-ask-form-send').click()
        await expect(pg.getByTestId('piece-panel-ask-form')).toHaveCount(0, { timeout: 15_000 })
        const waiting = pg.getByTestId('piece-panel-ask-waiting')
        await s.check('“Waiting on Dev Account Mgr”', async () => { await expect(waiting).toBeVisible(); await expect(waiting).toContainText('Waiting on Dev Account Mgr') })
        await s.check('with Withdraw', () => expect(pg.getByTestId('piece-panel-ask-withdraw')).toBeVisible())
        await s.check('the ask waits on the database', async () => expect((await rows('deliverable_change_asks', `select=id&deliverable_id=eq.${LV1}&status=eq.pending`)).length).toBe(1))
        await s.after(pg, 'After Send', waiting)
      })

    await step(23, 'am', 'Dev Account Mgr → LV-001 → fields editable; the ask waiting with Answer → Accept → due date changes.',
      'For the account manager LV-001’s fields are editable; the ask shows with Answer; Accept changes the due date.', async (s) => {
        const pg = await s.page('am')
        await openCampaign(pg, CID)
        await s.before(pg, 'Before', pg.getByTestId(`campaign-deliverable-${LV1}`))
        s.did('Pressed Open on LV-001.')
        await openDeliverable(pg, CID, LV1)
        await s.check('her fields are editable', async () => { for (const k of ['name', 'quantity', 'due', 'languages']) await expect(pg.getByTestId(`piece-panel-${k}`), k).toBeVisible() })
        await s.check('the ask waits, with Answer', async () => { await expect(pg.getByTestId('piece-panel-ask-waiting')).toBeVisible(); await expect(pg.getByTestId('piece-panel-ask-answer')).toBeVisible() })
        await s.during(pg, 'LV-001 for the account manager', pg.getByTestId('piece-panel-ask-waiting'))
        s.did('Pressed Answer → Accept → Send.')
        await pg.getByTestId('piece-panel-ask-answer').click()
        const dlg = pg.getByTestId('piece-panel-ask-answer-dialog')
        await expect(dlg).toBeVisible()
        await pg.getByTestId('piece-panel-ask-answer-dialog-mode-accept').click()
        await s.during(pg, 'Answer — Accept', dlg)
        await pg.getByTestId('piece-panel-ask-answer-dialog-submit').click()
        await expect(dlg).toHaveCount(0, { timeout: 15_000 })
        await s.check(`the due date is now ${NEW_DUE}`, () => expect.poll(async () => iraqDayOf((await deliverable(LV1)).due_at), { timeout: 15_000 }).toBe(NEW_DUE))
        await s.after(pg, 'After Accept', pg.getByTestId('piece-panel-due'))
      })

    await step(24, 'tl', 'Dev Team Lead → LV-001 → “Accepted” with the new due day and who was told.',
      'LV-001 shows the ask Accepted, with the new due day and the names of who was told.', async (s) => {
        const pg = await s.page('tl')
        // She comes back to it later: a fresh page. Her tab read the ask seconds before the answer, and locally the live
        // refresh never arrives (Realtime refuses the local key — I67.5), so the 30 s cache would still say “waiting”.
        await pg.goto('/')
        await openCampaign(pg, CID)
        await s.before(pg, 'Before', pg.getByTestId(`campaign-deliverable-${LV1}`))
        s.did('Opened Maestro again; pressed Open on LV-001.')
        await openDeliverable(pg, CID, LV1)
        const ans = pg.getByTestId('piece-panel-ask-answered')
        await s.check('“Accepted”', async () => { await expect(ans).toHaveAttribute('data-status', 'accepted', { timeout: 15_000 }); await expect(ans).toContainText(/Accepted/i) })
        await s.check('with the new due day (Thu, 5 Nov)', () => expect(ans).toContainText(/5 Nov/))
        await s.check('and who was told', () => expect(pg.getByTestId('piece-panel-ask-told')).toBeVisible())
        if (await ans.count()) s.saw(`It reads: “${((await ans.textContent()) ?? '').replace(/\s+/g, ' ').trim()}”`)
        await s.after(pg, 'LV-001 for its owner', ans)
      })

    // ===================================================================== E ====
    await step(25, 'am', 'LV-001 → languages as chips Arabic, English in the picker.',
      'LV-001’s languages show as two chips, Arabic and English.', async (s) => {
        const pg = await s.page('am')
        await openCampaign(pg, CID)
        await s.before(pg, 'Before', pg.getByTestId(`campaign-deliverable-${LV1}`))
        s.did('Pressed Open on LV-001.')
        await openDeliverable(pg, CID, LV1)
        const chips = pg.getByTestId('piece-panel-languages-chosen')
        await s.check('chips Arabic and English', async () => {
          await expect(pg.getByTestId('piece-panel-languages-chip-ar')).toContainText('Arabic')
          await expect(pg.getByTestId('piece-panel-languages-chip-en')).toContainText('English')
        })
        s.saw(`Chips: “${((await chips.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim()}”`)
        await s.after(pg, 'The languages picker', pg.getByTestId('piece-panel-languages'))
      })

    await step(26, 'am', 'Add Kurdish, save → grid “Arabic, English, Kurdish” for LV-001 only; its translation task “Translation — Northwind Summer Launch (Arabic, English, Kurdish)”; campaign languages unchanged; the translation task’s holder notified (if held).',
      'Saved: only LV-001 reads “Arabic, English, Kurdish”; its translation task is renamed to match; the campaign’s languages stay Arabic, English; the translation task’s holder is told.', async (s) => {
        const pg = await s.page('am')
        if (!(await pg.getByTestId('piece-panel-languages').count())) await openDeliverable(pg, CID, LV1)
        await s.before(pg, 'Before', pg.getByTestId('piece-panel-languages'))
        const tr = (await tasksOf(LV1)).find((t) => /^Translation/.test(t.title))!
        const holder = tr.assignee_id
        const since = new Date(Date.now() - 2_000).toISOString()
        s.did('Clicked in the languages box, picked Kurdish; pressed “Save the deliverable”.')
        await pg.getByTestId('piece-panel-languages-input').click()
        await pg.getByTestId('piece-panel-languages-list').getByRole('option', { name: /Kurdish/ }).first().dispatchEvent('mousedown')
        await s.during(pg, 'Kurdish picked', pg.getByTestId('piece-panel-languages'))
        await pg.getByTestId('piece-panel-save').click()
        await banner(s, pg, null)
        await s.check('LV-001 has Kurdish on the database', () => expect.poll(async () => (await deliverable(LV1)).languages.length, { timeout: 15_000 }).toBe(3))
        const langs = (await deliverable(LV1)).languages
        s.saw(`LV-001 languages: ${langs.join(', ')}`)
        await s.check('the grid reads “Arabic, English, Kurdish” for LV-001', () => expect(pg.getByTestId(`campaign-grid-languages-${LV1}`)).toHaveText('Arabic, English, Kurdish'))
        await s.check('the other deliverables still read “Arabic, English”', async () => {
          for (const d of dels.filter((x) => x.id !== LV1)) await expect(pg.getByTestId(`campaign-grid-languages-${d.id}`), d.code).toHaveText('Arabic, English')
        })
        const trNow = await taskRow(tr.id)
        s.saw(`Translation task now: “${trNow.title}”`)
        await s.check('the translation task is “Translation — Northwind Summer Launch (Arabic, English, Kurdish)”', () => expect(trNow.title).toBe('Translation — Northwind Summer Launch (Arabic, English, Kurdish)'))
        await s.check('the campaign’s languages are unchanged (Arabic, English)', async () => expect((await rows<{ languages: string[] }>('campaigns', `select=languages&id=eq.${CID}`))[0]!.languages).toEqual(camp!.languages))
        await pg.waitForTimeout(1500)
        const told = await notesSince(tr.id, since)
        const toldD = await notesSince(LV1, since)
        s.saw(`Notifications about the translation task: ${told.map((x) => `${tagOfUser(x.user_id) ?? x.user_id} (${x.type})`).join(', ') || 'none'}; about LV-001: ${toldD.map((x) => `${tagOfUser(x.user_id) ?? x.user_id} (${x.type})`).join(', ') || 'none'}`)
        if (holder) await s.check(`its holder (${tagOfUser(holder) ? PEOPLE[tagOfUser(holder)!].name : holder}) is notified`, () => expect([...told, ...toldD].map((x) => x.user_id)).toContain(holder))
        else s.saw('The translation task has nobody, so nobody is to be told.')
        await s.after(pg, 'After Save — the grid', pg.getByTestId(`campaign-deliverable-${LV1}`))
      })

    await step(27, 'am', 'Remove every language, try to save → refused, needs at least one.',
      'With no language left, Save is refused and the panel says at least one is needed.', async (s) => {
        const pg = await s.page('am')
        await openDeliverable(pg, CID, LV1)
        await s.before(pg, 'Before', pg.getByTestId('piece-panel-languages'))
        const codes = await pg.locator('[data-testid^="piece-panel-languages-chip-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.replace('piece-panel-languages-chip-', '')))
        s.did(`Pressed ✕ on every language chip (${codes.join(', ')}); then tried Save.`)
        for (const c of codes) await pg.getByTestId(`piece-panel-languages-remove-${c}`).click()
        const save = pg.getByTestId('piece-panel-save')
        await s.check('it says at least one language is needed', () => expect(pg.getByTestId('piece-panel-languages-missing')).toBeVisible())
        await s.check('Save is refused (not pressable)', () => expect(save).toBeDisabled())
        if (await pg.getByTestId('piece-panel-languages-missing').count()) s.saw(`Message: “${((await pg.getByTestId('piece-panel-languages-missing').textContent()) ?? '').trim()}”`)
        await s.after(pg, 'No language left', pg.getByTestId('piece-panel-languages'))
        await s.check('nothing changed on the database', async () => expect((await deliverable(LV1)).languages.length).toBeGreaterThan(0))
        await pg.reload()
      })

    await step(28, 'am', 'Rename LV-001 to “Summer key visual” → NO task name changes (the deliverable’s name is not in task names any more — 4 Oct rule).',
      'The deliverable is renamed; every task keeps its name.', async (s) => {
        const pg = await s.page('am')
        await openDeliverable(pg, CID, LV1)
        const before = (await tasksOf(LV1)).map((t) => t.title)
        await s.before(pg, 'Before', pg.getByTestId('piece-panel-name'))
        s.did('Name → “Summer key visual”; pressed “Save the deliverable”.')
        await pg.getByTestId('piece-panel-name').fill('Summer key visual')
        await pg.getByTestId('piece-panel-save').click()
        await banner(s, pg, null)
        await s.check('renamed on the database', () => expect.poll(async () => (await deliverable(LV1)).name, { timeout: 15_000 }).toBe('Summer key visual'))
        const after = (await tasksOf(LV1)).map((t) => t.title)
        s.saw(`Task names after: ${after.join(' | ')}`)
        await s.check('no task name changed', () => expect(after).toEqual(before))
        await s.after(pg, 'After Save', pg.getByTestId(`campaign-deliverable-${LV1}`))
      })

    await step(29, 'am', 'Quantity 1 → 3 → Create Artwork tasks “… · Billboard 1”, “… 2”, “… 3” in order; back to 1 → number goes.',
      'At 3 there are three Create Artwork tasks numbered 1, 2, 3 in order; back at 1 there is one, without a number.', async (s) => {
        const pg = await s.page('am')
        await openDeliverable(pg, CID, LV1)
        await s.before(pg, 'Before', pg.getByTestId('piece-panel-quantity'))
        s.did('Quantity → 3; Save; confirmed.')
        await pg.getByTestId('piece-panel-quantity').fill('3')
        await pg.getByTestId('piece-panel-save').click()
        const conf = pg.getByTestId('piece-panel-quantity-confirm-dialog')
        await expect(conf).toBeVisible()
        s.saw(`It said: “${((await conf.textContent()) ?? '').replace(/\s+/g, ' ').trim()}”`)
        await s.during(pg, 'Asked before changing the quantity', conf)
        await pg.getByTestId('piece-panel-quantity-confirm-confirm').click()
        await banner(s, pg, null)
        const art = async () => (await tasksOf(LV1)).filter((t) => /^Create Artwork/.test(t.title)).map((t) => t.title)
        await expect.poll(async () => (await art()).length, { timeout: 15_000 }).toBe(3)
        s.saw(`At 3: ${(await art()).join(' | ')}`)
        await s.check('“… · Billboard 1”, “2”, “3” in order', async () => expect(await art()).toEqual([1, 2, 3].map((i) => `Create Artwork — Northwind Summer Launch · Billboard ${i}`)))
        await s.during(pg, 'At 3', pg.getByTestId('piece-panel-tasks'))
        s.did('Quantity → 1; Save; confirmed.')
        await pg.getByTestId('piece-panel-quantity').fill('1')
        await pg.getByTestId('piece-panel-save').click()
        await expect(conf).toBeVisible()
        s.saw(`It said: “${((await conf.textContent()) ?? '').replace(/\s+/g, ' ').trim()}”`)
        await pg.getByTestId('piece-panel-quantity-confirm-confirm').click()
        await banner(s, pg, null)
        await expect.poll(async () => (await art()).length, { timeout: 15_000 }).toBe(1)
        s.saw(`At 1: ${(await art()).join(' | ')}`)
        await s.check('the number goes: “Create Artwork — Northwind Summer Launch · Billboard”', async () => expect(await art()).toEqual(['Create Artwork — Northwind Summer Launch · Billboard']))
        await s.after(pg, 'Back at 1', pg.getByTestId('piece-panel-tasks'))
      })

    await step(30, 'am', 'New campaign → step 2 → no language pre-picked, cannot continue without one; new single job → step 3 same.',
      'On a new campaign’s step 2 and a new single job’s step 3 no language is chosen, and Next does not go on until one is.', async (s) => {
        const pg = await s.page('am')
        await nav(pg, 'campaigns')
        await s.before(pg, 'Before')
        s.did('New campaign: step 1 (Northwind Beverages, brand Northwind, name “Test script — languages”), Next.')
        await pg.goto('/campaigns/new')
        await expect(pg.getByTestId('wizard-step-1')).toBeVisible({ timeout: 20_000 })
        await pg.getByTestId('wizard-client').selectOption({ label: 'Northwind Beverages' })
        await pg.getByTestId('wizard-brand').selectOption({ label: 'Northwind' }).catch(() => {})
        await pg.getByTestId('wizard-name').fill(`Test script — languages ${Date.now() % 10000}`)
        await pg.getByTestId('wizard-next').click()
        await expect(pg.getByTestId('wizard-step-2')).toBeVisible({ timeout: 20_000 })
        await s.check('step 2: no language pre-picked', () => expect(pg.locator('[data-testid^="wizard-languages-picker-chip-"]')).toHaveCount(0))
        s.did('Wrote the proposition, left languages empty, pressed Next.')
        await pg.getByTestId('wizard-brief-proposition').fill('Cold before you get there.')
        await pg.getByTestId('wizard-next').click()
        await pg.waitForTimeout(2000)
        await s.check('it does not go on to step 3', async () => { await expect(pg.getByTestId('wizard-step-3')).toHaveCount(0); await expect(pg.getByTestId('wizard-step-2')).toBeVisible() })
        await s.during(pg, 'Campaign step 2 after Next with no language', pg.getByTestId('wizard-languages-picker'))
        const msgC = await pg.locator('[role="alert"], .form-error').allTextContents()
        s.saw(`Campaign step 2 says: ${msgC.map((x) => `“${x.trim()}”`).join(' ') || '(no message)'}`)
        s.did('New single job: client Northwind Beverages, the words, “Single execution”, Next; the brief, Next; on step 3 filled title, due, type Social Advertisement, Creative, owner, left languages empty, Next.')
        await pg.goto('/campaigns/new-job')
        await pg.getByTestId('sj-client').selectOption({ label: 'Northwind Beverages' })
        await pg.getByTestId('sj-words').fill('One summer story frame.')
        await pg.getByTestId('sj-brief-card-single_execution').click()
        await pg.getByTestId('sj-next').click()
        await expect(pg.getByTestId('sj-brief')).toBeVisible({ timeout: 20_000 })
        await pg.getByTestId('sj-field-task').fill('One story frame for the summer range.')
        await pg.getByTestId('sj-next').click()
        await expect(pg.getByTestId('sj-request')).toBeVisible({ timeout: 20_000 })
        await s.check('step 3: no language pre-picked', () => expect(pg.locator('[data-testid^="sj-languages-picker-chip-"]')).toHaveCount(0))
        await pg.getByTestId('sj-title').fill(`Test script — languages job ${Date.now() % 10000}`)
        await pg.getByTestId('sj-due').fill(D[7]!)
        await pg.getByTestId('sj-type').fill('Social Advertisement')
        await pg.getByTestId('sj-type-list').getByRole('option', { name: /Social Advertisement/ }).first().dispatchEvent('mousedown')
        await pg.getByTestId('sj-department').getByRole('radio', { name: 'Creative' }).click()
        const owner = pg.getByTestId('sj-owner-select')
        await owner.selectOption((await owner.locator('option', { hasText: 'Dev Team Lead' }).first().getAttribute('value'))!)
        await pg.getByTestId('sj-next').click()
        await pg.waitForTimeout(2500)
        await s.check('it does not go on to the review', async () => { await expect(pg.getByTestId('sj-review')).toHaveCount(0); await expect(pg.getByTestId('sj-request')).toBeVisible() })
        const msgJ = await pg.locator('[role="alert"], .form-error, [data-testid$="-missing"]').allTextContents()
        s.saw(`Single job step 3 says: ${msgJ.map((x) => `“${x.trim()}”`).join(' ') || '(no message)'}`)
        await s.after(pg, 'Single job step 3 after Next with no language', pg.getByTestId('sj-languages-picker'))
      })

    // ===================================================================== F ====
    await step(31, 'tl', 'A deliverable whose tasks are all approved → Re-open → Client amendment, tick a task, what the client asked, new date → back to its maker; “Amend 1”; as Dev Account Mgr the client’s page shows the month’s amendments.',
      'Re-open sends the ticked task back to the person who made it, counted as a client amendment; the deliverable reads “Amend 1”; the client’s page shows this month’s amendments.', async (s) => {
        // No deliverable on the database was fully approved, so LV-001 is made so first — each task through its
        // maker's task page (Start → upload → Send) and its reviewer's (Approve). Said in the report.
        const lv1 = await tasksOf(LV1)
        s.did(`Set-up (no deliverable was fully approved): LV-001’s ${lv1.length} tasks taken through the screens — each by its holder on the task page (Start, upload a file, Send for review), then approved by Dev Team Lead on the task page (Review → Approve).`)
        const already = lv1.filter((t) => t.status === 'done').length
        if (already) s.saw(`${already} of LV-001’s tasks were already done from an earlier pass of this set-up; the rest were taken through now.`)
        for (const t of lv1) {
          if (t.status === 'done') continue
          const holder = tagOfUser(t.assignee_id)
          if (!holder) throw new Error(`“${t.title}” has nobody — cannot be made`)
          const mp = await s.page(holder)
          await mp.goto(`/my-work/task/${t.id}`)
          if (t.status === 'todo') {
            await mp.getByTestId(`my-work-start-${t.id}`).click({ timeout: 20_000 })
            await expect(mp.getByTestId('task-page-status')).toHaveAttribute('data-status', 'in_progress', { timeout: 15_000 })
          }
          if ((await taskRow(t.id)).status === 'in_progress') {
            const chooser = mp.waitForEvent('filechooser')
            await mp.getByTestId('task-page-file').getByTestId('review-upload').click()
            await (await chooser).setFiles({ name: 'artwork.png', mimeType: 'image/png', buffer: PNG })
            await expect(mp.getByTestId(`my-work-submit-${t.id}`)).toBeEnabled({ timeout: 20_000 })
            await mp.getByTestId(`my-work-submit-${t.id}`).click()
            const untimed = mp.getByTestId('untimed-send')
            await Promise.race([untimed.waitFor({ state: 'visible', timeout: 10_000 }).then(() => untimed.click()), expect.poll(async () => (await taskRow(t.id)).status, { timeout: 10_000 }).toBe('review')]).catch(() => {})
            await expect.poll(async () => (await taskRow(t.id)).status, { timeout: 15_000 }).toBe('review')
          }
          const rp = await s.page('tl')
          await rp.goto(`/my-work/task/${t.id}`)
          await rp.getByTestId(`subtask-review-open-${t.id}`).click({ timeout: 20_000 })
          await rp.getByTestId(`subtask-review-approve-${t.id}`).click()
          await expect.poll(async () => (await taskRow(t.id)).status, { timeout: 15_000 }).toBe('done')
        }
        await expect.poll(async () => (await deliverable(LV1)).state, { timeout: 30_000 }).toBe('approved')
        s.saw('LV-001 is approved: every task done.')
        const ca = await lv1CA()
        const maker = ca.assignee_id
        const pg = await s.page('tl')
        await openCampaign(pg, CID)
        s.did('Campaigns → Northwind Summer Launch → Open LV-001 → Re-open.')
        await openDeliverable(pg, CID, LV1)
        await s.before(pg, 'LV-001, approved', pg.getByTestId('piece-drawer-reopen'))
        await pg.getByTestId('piece-drawer-reopen').click()
        const dlg = pg.getByTestId('reopen-dialog')
        await expect(dlg).toBeVisible()
        const reopenDue = D[6]!
        s.did(`Client amendment; ticked “${ca.title}”; what the client asked: “Make the bottle bigger and swap the price frame.”; new date ${reopenDue}; Re-open.`)
        await pg.getByTestId('reopen-dialog-kind-client_amendment').click()
        await pg.getByTestId(`reopen-dialog-task-${ca.id}`).check()
        await pg.getByTestId('reopen-dialog-reason').fill('Make the bottle bigger and swap the price frame.')
        await pg.getByTestId('reopen-dialog-due').fill(reopenDue)
        await s.during(pg, 'The Re-open window', dlg)
        await pg.getByTestId('reopen-dialog-submit').click()
        await banner(s, pg, null)
        await s.check('back to its maker, To do', async () => {
          await expect.poll(async () => (await taskRow(ca.id)).status, { timeout: 15_000 }).toBe('todo')
          expect((await taskRow(ca.id)).assignee_id).toBe(maker)
        })
        await s.check('counted as a client amendment', async () => expect((await rows<{ kind: string }>('sub_task_reopenings', `select=kind&sub_task_id=eq.${ca.id}`)).map((x) => x.kind)).toContain('client_amendment'))
        await openDeliverable(pg, CID, LV1)
        await s.check('the deliverable reads “Amend 1”', () => expect(pg.getByTestId('piece-drawer-amend')).toHaveText('Amend 1'))
        await s.during(pg, 'LV-001 after the re-open', pg.getByTestId('piece-drawer'))
        s.did('As Dev Account Mgr: opened the client Northwind Beverages.')
        const am = await s.page('am')
        await am.goto(`/clients/${camp!.client_id}`)
        await s.check('the client’s page shows the month’s amendments', () => expect(am.getByTestId('client-page')).toContainText(/amendments? this month/i, { timeout: 20_000 }))
        const line = am.getByText(/amendments? this month/i).first()
        if (await line.count()) s.saw(`Client page: “${((await line.textContent()) ?? '').trim()}”`)
        await s.after(am, 'Dev Account Mgr — the client’s page', line)
        st.reopened = ca.id
      })

    // ===================================================================== G ====
    await step(32, 'maker', 'Dev Maker → a task from My work → Ask Dev for more time → later day, reason, send.',
      'The ask for more time is sent and the task page says it is waiting.', async (s) => {
        const pg = await s.page('maker')
        const id = st.reopened ?? (await tasksOf(LV1)).find((t) => t.assignee_id === UID.maker && t.status === 'todo')?.id
        if (!id) s.skip('Dev Maker has no open task on these deliverables')
        await nav(pg, 'my-work')
        await s.before(pg, 'My work', pg.getByTestId(`my-work-open-${id}`))
        const t = await taskRow(id)
        const due = iraqDayOf(t.due_at)!
        let later = new Date(Date.parse(`${due}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
        while ([5, 6].includes(new Date(`${later}T12:00:00Z`).getUTCDay())) later = new Date(Date.parse(`${later}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
        s.did(`Opened “${t.title}” from My work; pressed the more-time button; day ${later} (it is due ${due}); why “The client’s new bottle shots arrive late.”; Send.`)
        await pg.getByTestId(`my-work-open-${id}`).click()
        const open = pg.getByTestId('task-more-time-open')
        await expect(open).toBeVisible({ timeout: 20_000 })
        s.saw(`The button reads “${((await open.textContent()) ?? '').trim()}”`)
        // Full names wherever a person is named (I74.42): the script's “Dev” is her lead, Dev Team Lead.
        await s.check('it reads “Ask Dev Team Lead for more time”', () => expect(open).toHaveText(/Ask Dev Team Lead for more time/))
        await open.click()
        await pg.getByTestId('task-more-time-day').fill(later)
        await pg.getByTestId('task-more-time-note').fill('The client’s new bottle shots arrive late.')
        await s.during(pg, 'The ask filled in', pg.getByTestId('task-more-time'))
        await pg.getByTestId('task-more-time-send').click()
        await s.check('it waits', () => expect(pg.getByTestId('task-more-time-pending')).toBeVisible({ timeout: 15_000 }))
        const ask = (await rows<{ id: string }>('sub_task_time_asks', `select=id&sub_task_id=eq.${id}&status=eq.pending`))[0]
        await s.check('the ask is on the database', () => expect(ask).toBeTruthy())
        st.timeAsk = ask?.id ?? ''
        st.timeTask = id
        st.timeDay = later
        await s.after(pg, 'After Send', pg.getByTestId('task-more-time-pending'))
      })

    await step(33, 'tl', 'Dev Team Lead → Schedule → Asks “Dev wants … too”, Give/No → Give → the task moves (if past the deliverable’s due date, the change form opens prefilled).',
      'The ask shows as “Dev wants … too” with Give and No; Give moves the task to the day asked.', async (s) => {
        if (!st.timeAsk) s.skip('no ask for more time was sent in step 32')
        const pg = await s.page('tl')
        await scheduleWeek(pg)
        const card = pg.getByTestId(`time-ask-${st.timeAsk}`)
        await expect(card).toBeVisible({ timeout: 15_000 })
        await s.before(pg, 'Before', card)
        s.saw(`Card: “${((await card.textContent()) ?? '').replace(/\s+/g, ' ').trim()}”`)
        await s.check('it reads “Dev Maker wants … too”', () => expect(card).toContainText(/Dev Maker wants .* too/))
        await s.check('with Give and No', async () => { await expect(pg.getByTestId(`time-ask-give-${st.timeAsk}`)).toBeVisible(); await expect(pg.getByTestId(`time-ask-no-${st.timeAsk}`)).toBeVisible() })
        s.did('Pressed Give.')
        await pg.getByTestId(`time-ask-give-${st.timeAsk}`).click()
        const change = pg.getByTestId('time-ask-change')
        await pg.waitForTimeout(2500)
        if (await change.count()) {
          s.saw('The change form to the account manager opened (the day is past the deliverable’s due date).')
          await s.during(pg, 'The change form', change)
          await pg.getByTestId('time-ask-change-reason').fill('Dev Maker needs the extra day for the new shots.')
          s.did('Wrote why; pressed Send.')
          await pg.getByTestId('time-ask-change-send').click()
        }
        await s.check(`the task moved to ${st.timeDay}`, () => expect.poll(async () => iraqDayOf((await taskRow(st.timeTask!)).due_at), { timeout: 15_000 }).toBe(st.timeDay))
        await s.after(pg, 'After Give')
      })

    // ===================================================================== H ====
    await step(34, 'maker', 'Dev Maker: Schedule opens on “Everyone”, no “Your team”, no To book, no Block time, no side column; LV-002 read-only (no pencil, ✕, Who, ticks); languages read-only.',
      'Her Schedule opens on Everyone with none of those controls; LV-002 shows its tasks with nothing to change; its languages cannot be changed.', async (s) => {
        const pg = await s.page('maker')
        await pg.goto('/')
        await s.before(pg, 'Before')
        s.did('Pressed Schedule.')
        await nav(pg, 'schedule')
        await s.during(pg, 'Her Schedule')
        await s.check('opens on “Everyone”', () => expect(pg.getByTestId('view-master')).toHaveAttribute('aria-selected', 'true'))
        await s.check('no “Your team”, no To book, no Block time, no side column', async () => {
          for (const k of ['view-team', 'to-book', 'block-time-open']) await expect(pg.getByTestId(k), k).toHaveCount(0)
          // the side column's frame is always in the page; for her it must hold nothing she can see
          expect(((await pg.getByTestId('schedule-side').innerText().catch(() => '')) ?? '').trim(), 'the side column is empty').toBe('')
        })
        s.did('Campaigns → Northwind Summer Launch → Open LV-002.')
        await openDeliverable(pg, CID, LV2)
        await s.check('LV-002: no pencil, ✕, Who or ticks', async () => {
          for (const k of ['edit', 'remove', 'who', 'select', 'rename']) await expect(pg.locator(`[data-testid^="piece-panel-tasks-${k}-"]`), k).toHaveCount(0)
          await expect(pg.getByTestId('piece-panel-tasks-select-all')).toHaveCount(0)
        })
        await s.check('languages read-only (no picker)', async () => { await expect(pg.getByTestId('piece-panel-languages')).toHaveCount(0); await expect(pg.getByTestId('piece-panel-languages-input')).toHaveCount(0) })
        s.saw(`What she sees of LV-002: “${((await pg.getByTestId('piece-drawer').textContent()) ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)}…”`)
        await s.after(pg, 'LV-002 for Dev Maker')
      })

    await step(35, 'am', 'Dev Account Mgr: the booking window’s Who says every pick is an ask to the person’s team lead; picking Dev Maker sends an ask to Dev Team Lead, not a booking (check DB).',
      'Who says every pick is an ask; after picking Dev Maker and sending, an ask waits on Dev Team Lead and nothing is booked.', async (s) => {
        const pg = await s.page('am')
        await scheduleWeek(pg)
        await s.before(pg, 'Her Schedule')
        const pick = pg.getByTestId(`to-book-${LV2}`)
        if (!(await pick.count())) s.skip('LV-002 is not in her To book')
        const row = (await tasksOf(LV2)).find((t) => /^Creative Direction/.test(t.title))!
        // An ask an earlier pass of this walk left on LV-002 (step 35 then) would block its row: she withdraws it first.
        for (const t of await tasksOf(LV2)) {
          const stray = (await requestsOn(t.id)).find((r) => r.status === 'pending' && r.requested_by === UID.am)
          if (stray && (await pg.getByTestId(`ask-withdraw-${stray.id}`).count())) {
            s.did(`Set-up: withdrew her own ask on “${t.title}” left by an earlier pass of this walk (Asked of other teams → Withdraw).`)
            await pg.getByTestId(`ask-withdraw-${stray.id}`).click()
            await expect.poll(async () => (await requestsOn(t.id)).find((r) => r.id === stray.id)?.status, { timeout: 15_000 }).not.toBe('pending')
          }
        }
        s.did(`To book → LV-002; clicked ${D2} on Dev Maker’s row; Who on “${row.title}”.`)
        await pick.click()
        await pg.getByTestId(`cell-${RES.maker}-${D2}`).click({ position: { x: 4, y: 4 } })
        await expect(pg.getByTestId(`book-row-${row.id}`)).toBeVisible({ timeout: 15_000 })
        await pg.getByTestId(`book-who-${row.id}`).click()
        const only = pg.getByTestId('book-who-list-ask-only')
        await s.check('Who says every pick is an ask to the person’s team lead', async () => { await expect(only).toBeVisible(); await expect(only).toContainText(/ask to their team lead/i) })
        if (await only.count()) s.saw(`It says: “${((await only.textContent()) ?? '').trim()}”`)
        await s.during(pg, 'Who, as the account manager', pg.getByTestId('book-who-list'))
        s.did('Picked Dev Maker; reviewer Dev Team Lead; pressed the button.')
        await pg.getByTestId(`book-who-list-${RES.maker}`).click()
        await pg.getByTestId('book-reviewer-add').selectOption({ label: 'Dev Team Lead' }).catch(() => {})
        if (((await pg.getByTestId(`book-hours-${row.id}`).textContent()) ?? '').startsWith('0')) {
          s.did('The row had 0 hours (the window refuses an ask for none): pressed + to 2 hours.')
          await hoursTo(pg, 'book', row.id, 2)
        }
        const rowsTxt = await pg.locator('[data-testid^="book-row-"]').allTextContents()
        s.saw(`The window’s rows: ${rowsTxt.map((x) => x.replace(/\s+/g, ' ').trim().slice(0, 120)).join(' | ')}`)
        const submit = pg.getByTestId('book-submit')
        s.saw(`The button read “${((await submit.textContent()) ?? '').trim()}”`)
        await s.during(pg, 'Ready to send', submit)
        await submit.click()
        await expect(pg.getByTestId('book-tasks')).toHaveCount(0, { timeout: 45_000 })
        const req = (await requestsOn(row.id))[0]
        s.saw(`Newest ask on the task: ${JSON.stringify(req)}`)
        await s.check('an ask for Dev Maker waits, sent by Dev Account Mgr, to the Design team', () => expect(req).toMatchObject({ status: 'pending', assignee_id: UID.maker, requested_by: UID.am, team_id: designTeam!.id }))
        await s.check('nothing is booked', async () => { expect((await taskRow(row.id)).assignee_id).toBeNull(); expect((await bookingsOf(row.id)).length).toBe(0) })
        const others = (await tasksOf(LV2)).filter((t) => t.assignee_id === UID.maker && t.id !== row.id)
        await s.check('she booked nobody else either (no LV-002 task became Dev Maker’s)', () => expect(others.map((t) => t.title)).toEqual([]))
        await pg.waitForTimeout(1500)
        const told = req ? await rows<{ user_id: string; type: string }>('notifications', `select=user_id,type&entity_id=eq.${req.id}`) : []
        const toldT = await rows<{ user_id: string; type: string }>('notifications', `select=user_id,type&entity_id=eq.${row.id}&type=eq.assignment_requested`)
        s.saw(`Told: ${[...told, ...toldT].map((x) => `${tagOfUser(x.user_id) ?? x.user_id} (${x.type})`).join(', ') || 'none'}`)
        await s.check('Dev Team Lead is told', () => expect([...told, ...toldT].map((x) => x.user_id)).toContain(UID.tl))
        await s.after(pg, 'After sending')
      })

    await step(36, 'motiontl', 'Dev Motion Lead: cannot answer an ask sent to Copy (if one waits); booking Dev Maker becomes an ask to Dev Team Lead.',
      'An ask to Copy is not his to answer; his pick of Dev Maker goes as an ask to the Design team’s lead, nothing booked.', async (s) => {
        const pg = await s.page('motiontl')
        const copyAsk = (await rows<{ id: string }>('sub_task_assignment_requests', `select=id&team_id=eq.${copyTeam!.id}&status=eq.pending&order=created_at.desc&limit=1`))[0]
        await pg.goto('/')
        await s.before(pg, 'Before')
        if (copyAsk) {
          s.did('Opened the link to a waiting Copy ask (/schedule?ask=…), as from a message.')
          await pg.goto(`/schedule?ask=${copyAsk.id}`)
          await expect(pg.getByTestId('schedule-grid')).toBeVisible({ timeout: 25_000 })
          await pg.waitForTimeout(2000)
          await s.check('the Copy ask is not among his asks', () => expect(pg.getByTestId(`ask-from-${copyAsk.id}`)).toHaveCount(0))
          await s.check('no answer window with Book for it', () => expect(pg.getByTestId('answer-ask-book')).toHaveCount(0))
          await s.during(pg, 'His Schedule, opened on the Copy ask’s link')
        } else s.saw('No ask to Copy was waiting on the database, so the first half could not be tried.')
        await scheduleWeek(pg)
        const pick = pg.getByTestId(`to-book-${LV2}`)
        if (!(await pick.count())) { s.saw('LV-002 is not in his To book.'); s.skip('LV-002 is not in Dev Motion Lead’s To book, so he has no booking window to pick Dev Maker in') }
        const row = (await tasksOf(LV2)).find((t) => /^Translation/.test(t.title))!
        s.did(`To book → LV-002; “Everyone”; clicked ${D2} on Dev Maker’s row; Who on “${row.title}” → Ask another team… → Design → Dev Maker.`)
        await pick.click()
        await pg.getByTestId('view-master').click()
        await pg.getByTestId(`cell-${RES.maker}-${D2}`).click({ position: { x: 4, y: 4 } })
        await expect(pg.getByTestId(`book-row-${row.id}`)).toBeVisible({ timeout: 15_000 })
        await pg.getByTestId(`book-who-${row.id}`).click()
        const names = await pg.getByTestId('book-who-list').locator('.sc-person-name').allTextContents()
        s.saw(`His Who lists: ${names.join(', ')}`)
        await pg.getByTestId('book-who-list-ask-other').click()
        await pg.getByTestId('book-who-list-ask-team').selectOption({ label: 'Design' })
        await s.during(pg, 'Ask another team → Design', pg.getByTestId('book-who-list'))
        await pg.getByTestId(`book-who-list-ask-${RES.maker}`).click()
        await pg.getByTestId('book-reviewer-add').selectOption({ label: 'Dev Team Lead' }).catch(() => {})
        if (((await pg.getByTestId(`book-hours-${row.id}`).textContent()) ?? '').startsWith('0')) {
          s.did('The row had 0 hours (the window refuses an ask for none): pressed + to 2 hours.')
          await hoursTo(pg, 'book', row.id, 2)
        }
        const rowsTxt = await pg.locator('[data-testid^="book-row-"]').allTextContents()
        s.saw(`The window’s rows: ${rowsTxt.map((x) => x.replace(/\s+/g, ' ').trim().slice(0, 120)).join(' | ')}`)
        const submit = pg.getByTestId('book-submit')
        s.saw(`The button read “${((await submit.textContent()) ?? '').trim()}”`)
        await submit.click()
        await expect(pg.getByTestId('book-tasks')).toHaveCount(0, { timeout: 45_000 })
        const req = (await requestsOn(row.id))[0]
        s.saw(`Newest ask on the task: ${JSON.stringify(req)}`)
        await s.check('an ask for Dev Maker waits on the Design team (Dev Team Lead answers)', () => expect(req).toMatchObject({ status: 'pending', assignee_id: UID.maker, requested_by: UID.motiontl, team_id: designTeam!.id }))
        await s.check('nothing is booked', async () => expect((await taskRow(row.id)).assignee_id).toBeNull())
        const his = (await tasksOf(LV2)).filter((t) => t.assignee_id === UID.motiontl).map((t) => t.title)
        s.saw(`LV-002 tasks on Dev Motion Lead now: ${his.join(', ') || 'none'}`)
        await s.after(pg, 'After sending')
      })

    await step(37, 'tl', 'Dev Team Lead: cannot edit a live deliverable’s fields directly; on a task Dev Maker has started (press Start as Dev Maker first) moving its day asks “Dev has started this — move it anyway?”; no Remove.',
      'LV-002’s fields are read-only for her; moving the started task’s day asks “Dev has started this — move it anyway?” before anything is saved, and Remove is not offered.', async (s) => {
        const pg = await s.page('tl')
        await openDeliverable(pg, CID, LV2)
        await s.before(pg, 'LV-002 for its owner', pg.getByTestId('piece-panel-ask-strip'))
        await s.check('no editable fields: the read-only strip with the Ask button', async () => {
          await expect(pg.getByTestId('piece-panel-ask-strip')).toBeVisible()
          for (const k of ['due', 'quantity', 'languages', 'type', 'name']) await expect(pg.getByTestId(`piece-panel-${k}`), k).toHaveCount(0)
        })
        const id = st.timeTask ?? st.reopened
        if (!id) s.skip('no task of Dev Maker’s to start')
        s.did('As Dev Maker: opened the task from My work and pressed Start.')
        const mk = await s.page('maker')
        await nav(mk, 'my-work')
        await mk.getByTestId(`my-work-open-${id}`).click()
        if ((await taskRow(id)).status === 'todo') await mk.getByTestId(`my-work-start-${id}`).click({ timeout: 20_000 })
        else s.saw('Dev Maker had already pressed Start on it in an earlier pass of this step (the move was not made then).')
        await s.during(mk, 'Dev Maker’s task page after Start', mk.getByTestId('task-page-status'))
        await expect.poll(async () => (await taskRow(id)).status, { timeout: 15_000 }).toBe('in_progress')
        const b = (await bookingsOf(id))[0]
        if (!b) s.skip('the started task has no booking on the Schedule')
        const day = iraqDayOf(b.starts_at)!
        s.did(`As Dev Team Lead: Schedule on the week of ${day}; clicked the task; Dates → another day.`)
        await pg.goto(`/schedule?on=${day}`)
        await expect(pg.getByTestId('schedule-grid')).toBeVisible({ timeout: 25_000 })
        await pg.getByTestId(`booking-${b.id}`).click()
        await expect(pg.getByTestId('edit-task')).toBeVisible({ timeout: 15_000 })
        await s.check('no Remove on a started task', async () => { await expect(pg.getByTestId('edit-remove-task')).toHaveCount(0); await expect(pg.getByTestId('edit-task-no-remove')).toBeVisible() })
        let other = new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
        while ([5, 6].includes(new Date(`${other}T12:00:00Z`).getUTCDay())) other = new Date(Date.parse(`${other}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
        s.saw(`The task’s booking starts ${day}; moving it to ${other}.`)
        await pg.getByTestId('edit-task-dates').click()
        for (let i = 0; i < 4 && !(await pg.getByTestId(`edit-task-dates-picker-day-${other}`).count()); i++) await pg.getByTestId('edit-task-dates-picker-next').click()
        await pickOneDay(pg, 'edit-task-dates-picker', other)
        const ask = pg.getByTestId('edit-task-started')
        await s.check('it asks “Dev has started this — move it anyway?”', async () => { await expect(ask).toBeVisible(); await expect(ask).toContainText(/Dev has started this/) })
        if (await ask.count()) s.saw(`It asks: “${((await ask.textContent()) ?? '').replace(/\s+/g, ' ').trim()}”`)
        await s.during(pg, 'The question before the move', ask)
        s.did('Pressed Keep (not moved).')
        if (await pg.getByTestId('edit-task-keep').count()) await pg.getByTestId('edit-task-keep').click()
        await s.check('nothing moved', async () => expect(iraqDayOf((await taskRow(id)).starts_at)).toBe(day))
        await s.after(pg, 'After Keep')
        await pg.keyboard.press('Escape').catch(() => {})
      })

    await step(38, 'copytl', 'Dev Copy Lead: cannot block time for Dev Maker; Block time offers only his own team.',
      'Block time’s Who lists only the Copy team (Dev Copy Lead, Dev Writer) — not Dev Maker.', async (s) => {
        const pg = await s.page('copytl')
        await scheduleWeek(pg)
        await s.before(pg, 'His Schedule', pg.getByTestId('block-time-open'))
        s.did('Pressed “+ Block time”, opened Who.')
        await pg.getByTestId('block-time-open').click()
        await expect(pg.getByTestId('block-time')).toBeVisible()
        const opts = await blockTimeOffers(pg)
        s.saw(`Who offers: ${opts.join(', ')}`)
        await s.check('only his own team (Dev Copy Lead, Dev Writer)', () => expect([...opts].map((x) => x.replace(/\s*·.*$/, '')).sort()).toEqual(['Dev Copy Lead', 'Dev Writer']))
        await s.check('Dev Maker is not offered', () => expect(opts.some((x) => x.includes('Dev Maker'))).toBe(false))
        await s.after(pg, 'Block time, as Dev Copy Lead', pg.getByTestId('block-time'))
        await pg.getByTestId('block-time-cancel').click().catch(() => {})
      })

    // ===================================================================== the report ====
    rep.flush()
    writeFileSync(path.join(OUT, 'REPORT.html'), await render(rep.steps, rep.notes, scratch))
  })
})

// ------------------------------------------------------------------------------ render ----

/** Each screenshot shrunk to ≤1200px wide and re-encoded, so the one file stays well under 15 MB. */
async function shrink(page: Page, file: string): Promise<string> {
  const src = `data:image/jpeg;base64,${readFileSync(path.join(OUT, file)).toString('base64')}`
  return page.evaluate(async (s) => {
    const img = new Image()
    img.src = s
    await img.decode()
    const w = Math.min(1200, img.naturalWidth)
    const h = Math.round((img.naturalHeight * w) / img.naturalWidth)
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    c.getContext('2d')!.drawImage(img, 0, 0, w, h)
    return c.toDataURL('image/jpeg', 0.66)
  }, src)
}

async function render(steps: StepRec[], notes: string[], page: Page): Promise<string> {
  await page.setContent('<html><body></body></html>')
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const count = (o: Outcome) => steps.filter((s) => s.outcome === o).length
  const badge = (o: Outcome) => `<span class="b b-${o.toLowerCase()}">${o}</span>`
  const reasonOf = (s: StepRec) => (s.outcome === 'Fail' && CAUSES[s.n] ? `${s.reason} — Cause: ${CAUSES[s.n]}` : s.reason)
  const o: string[] = []
  o.push(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Test script walk</title><style>
:root{--bg:#ffffff;--fg:#1d1d1f;--muted:#5b5b66;--line:#e3e3e8;--card:#f6f6f9;--pass:#1a7f37;--pass-bg:#e7f6ec;--fail:#b42318;--fail-bg:#fdecea;--skip:#8a5a00;--skip-bg:#fff4dc;--accent:#3b5bdb;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#15161a;--fg:#ececf1;--muted:#a3a3ad;--line:#2c2d34;--card:#1d1e23;--pass:#56d364;--pass-bg:#12261a;--fail:#ff7b72;--fail-bg:#2d1517;--skip:#e3b341;--skip-bg:#2a2214;--accent:#7c9bff}}
:root[data-theme="dark"]{--bg:#15161a;--fg:#ececf1;--muted:#a3a3ad;--line:#2c2d34;--card:#1d1e23;--pass:#56d364;--pass-bg:#12261a;--fail:#ff7b72;--fail-bg:#2d1517;--skip:#e3b341;--skip-bg:#2a2214;--accent:#7c9bff}
*{box-sizing:border-box}body{font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;max-width:1500px;margin:0 auto;padding:32px 24px;color:var(--fg);background:var(--bg)}
h1{font-size:28px;margin:0 0 8px}h2{margin:56px 0 8px;border-top:1px solid var(--line);padding-top:24px;font-size:21px}h3{margin:0;font-size:17px}
p{margin:6px 0}.muted{color:var(--muted)}a{color:var(--accent)}
.tally{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}.tally span{padding:6px 12px;border-radius:8px;font-weight:600}
.b{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.02em;white-space:nowrap}
.b-pass{color:var(--pass);background:var(--pass-bg)}.b-fail{color:var(--fail);background:var(--fail-bg)}.b-skipped{color:var(--skip);background:var(--skip-bg)}
.tablewrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px;margin:12px 0 24px}th,td{border-bottom:1px solid var(--line);padding:7px 8px;text-align:start;vertical-align:top}th{background:var(--card);position:sticky;top:0}
.step{border:1px solid var(--line);border-radius:12px;padding:18px;margin:22px 0;background:var(--bg)}
.step.is-fail{border-color:var(--fail)}.step.is-skipped{border-color:var(--skip)}
.head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}.num{font-weight:700;color:var(--muted)}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;margin:12px 0}dt{color:var(--muted);font-weight:600}dd{margin:0}
ul{margin:4px 0 0;padding-inline-start:20px}li{margin:2px 0}.ok{color:var(--pass)}.bad{color:var(--fail)}
.shots{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:12px}.shots figure{margin:0}.shots.one{grid-template-columns:1fr}
figcaption{font-size:12px;color:var(--muted);font-weight:600;margin-bottom:4px}figcaption b{text-transform:uppercase;letter-spacing:.04em}
img{max-width:100%;height:auto;border:1px solid var(--line);border-radius:8px;display:block}
.outcome{padding:10px 12px;border-radius:8px;margin:8px 0}.outcome.is-pass{background:var(--pass-bg)}.outcome.is-fail{background:var(--fail-bg)}.outcome.is-skipped{background:var(--skip-bg)}
td,dd,li,p{overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;background:var(--card);padding:8px;border-radius:6px;margin:4px 0}
@media (max-width:900px){.shots{grid-template-columns:1fr}body{padding:16px}dl{grid-template-columns:1fr}table{font-size:13px}}
</style></head><body>`)
  o.push('<h1>Edward’s test script — walked in the browser</h1>')
  o.push('<p>Every numbered step of the 4 October test script, done on the local stack in a real browser, signed in as the person the step names, by clicking and typing. Each step shows the screen before and after (and in between where a window opened), what was done, what was expected, and the outcome. Where the database is the proof, it was read after the step. All test accounts’ first name is “Dev”, so a screen that uses a first name reads “Dev”.</p>')
  for (const n of notes) o.push(`<p class="muted">${esc(n)}</p>`)
  o.push(`<div class="tally"><span class="b-pass">${count('Pass')} passed</span><span class="b-fail">${count('Fail')} failed</span><span class="b-skipped">${count('Skipped')} skipped</span><span class="muted">of ${steps.length} steps</span></div>`)
  o.push('<h2 id="summary">Summary</h2><div class="tablewrap"><table><thead><tr><th>#</th><th>Step</th><th>Who</th><th>Outcome</th><th>Why (for a Fail: the traced cause)</th></tr></thead><tbody>')
  for (const s of steps) {
    const short = s.text.length > 90 ? `${s.text.slice(0, 88)}…` : s.text
    const why = s.outcome === 'Fail' && CAUSES[s.n] ? CAUSES[s.n]! : reasonOf(s)
    o.push(`<tr><td><a href="#s${s.n}">${s.n}</a></td><td>${esc(short)}</td><td>${esc(s.who.split(' — ')[0]!)}</td><td>${badge(s.outcome)}</td><td>${esc(why.length > 260 ? `${why.slice(0, 258)}…` : why)}</td></tr>`)
  }
  o.push('</tbody></table></div>')
  for (const sec of Object.keys(SECTIONS)) {
    const list = steps.filter((s) => s.section === sec)
    if (!list.length) continue
    o.push(`<h2 id="sec-${sec}">${sec}. ${esc(SECTIONS[sec]!)}</h2>`)
    for (const s of list) {
      const cls = s.outcome.toLowerCase()
      o.push(`<section class="step is-${cls}" id="s${s.n}"><div class="head"><span class="num">Step ${s.n}</span><h3>${esc(s.text)}</h3>${badge(s.outcome)}</div>`)
      o.push('<dl>')
      o.push(`<dt>Signed in as</dt><dd>${esc(s.who)}</dd>`)
      o.push(`<dt>What was done</dt><dd>${s.did.length ? `<ul>${s.did.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : '—'}</dd>`)
      o.push(`<dt>Expected</dt><dd>${esc(s.expected)}</dd>`)
      if (s.seen.length) o.push(`<dt>Seen</dt><dd><ul>${s.seen.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></dd>`)
      if (s.checks.length) o.push(`<dt>Checks</dt><dd><ul>${s.checks.map((c) => `<li class="${c.ok ? 'ok' : 'bad'}">${c.ok ? '✓' : '✗'} ${esc(c.title)}${c.ok ? '' : `<pre>${esc(c.detail ?? '')}</pre>`}</li>`).join('')}</ul></dd>`)
      o.push('</dl>')
      o.push(`<div class="outcome is-${cls}"><b>${s.outcome}.</b> ${esc(reasonOf(s))}${s.error ? `<pre>${esc(s.error)}</pre>` : ''}</div>`)
      const by = (p: Phase) => s.shots.filter((x) => x.phase === p)
      const fig = async (x: Shot) => `<figure><figcaption><b>${x.phase}</b>${x.caption ? ` · ${esc(x.caption)}` : ''}</figcaption><img loading="lazy" src="${await shrink(page, x.file)}" alt="${esc(x.phase)} — ${esc(x.caption)}"></figure>`
      const pair = [...by('before'), ...by('after')]
      if (pair.length) o.push(`<div class="shots${pair.length === 1 ? ' one' : ''}">${(await Promise.all(pair.map(fig))).join('')}</div>`)
      const mid = by('during')
      if (mid.length) o.push(`<p class="muted" style="margin-top:12px">In between:</p><div class="shots${mid.length === 1 ? ' one' : ''}">${(await Promise.all(mid.map(fig))).join('')}</div>`)
      o.push('</section>')
    }
  }
  o.push('</body></html>')
  return o.join('\n')
}
