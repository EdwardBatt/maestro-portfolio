import { test, expect, type Browser, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { authFile, PEOPLE } from '../fixtures'
import { attemptWrite, rows } from '../helpers/db'
import { approveTaskList, closeCampaignBanner } from '../helpers/piece'
import { approveSingleJob, type ReleasedJob, pickJobLanguages } from '../helpers/single-job'
import { API, ANON, blockTimeFill, day, idOf, resourceIdOf, restAs, rpcAs, tokenOf, workday, type Tag } from '../helpers/i74'
import { mockBucket } from './running-the-week.kit'

/**
 * Review walk — the Schedule rework (I74; ADR-0139/0140/0141/0142): every frame of Figma section L (SC-01…SC-30)
 * and N (CP-01…CP-12), and the nine mock-ups drawn for what the Figma does not show, each BESIDE the built screen.
 *
 * ONE STORY, made here through the product on a fresh local reset. The account manager (Dev Account Mgr) releases six
 * Creative single jobs, each owned by the Design team lead (Dev Team Lead — Fadia's part in the Figma); the team lead
 * approves their lists, books her own team (Dev Team Lead, Dev Deputy Lead, Dev Maker), asks the Copy team (its lead,
 * Dev Copy Lead, is Amira's part) for the copy, and the Copy lead answers. The pieces are given out, moved, cancelled,
 * changed, asked about, re-opened and blocked around — every press is a real press, signed in as the person who would
 * make it. A few fixtures go through the door a button calls, as that person (said where it happens).
 *
 * ONE STAGED STATE: an ask that has waited four working hours. Its asked-at time is set back through the service role
 * and the escalation sweep (a timer's job on production, not running locally) is run once for that piece. Marked amber.
 *
 * NO FALLBACKS. The set-up is hard (the walk stops if the product refuses it); after that each step's action and checks
 * are recorded — a step that cannot be done is a failed check that says why — and the test fails at the end if any
 * check failed. Read report.json.
 *
 * Run (fresh reset; e2e/.auth re-signed by the setup project; functions serving):
 *   WALK=1 npx playwright test --config playwright.local.config.ts e2e/local/walks/schedule-rework.walk.spec.ts
 * Writes `Claude outputs/reports/<date>-schedule-rework/REPORT.html` — one self-contained file, every image embedded.
 * The Figma frames and the mock-ups are read from `Claude outputs/reports/schedule-rework-frames/` (the Figma desktop
 * server's renders of each frame, and the mock-up page's drawn screens).
 */
const WALK = process.env.WALK === '1'
const iraqDay = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad' }).format(new Date(ms))
const DATE = process.env.WALK_DATE ?? iraqDay(Date.now())
const OUT = path.resolve('Claude outputs', 'reports', `${DATE}-schedule-rework`)
const FRAMES = path.resolve('Claude outputs', 'reports', 'schedule-rework-frames')
const VIEW = { width: 1440, height: 1050 }

// ------------------------------------------------------------------------------ the report ----

interface Check { title: string; ok: boolean; detail?: string }
interface Step {
  chapter: number; n: number; title: string; actor: string; does: string; frames: string[]
  differs: string | null; staged: string | null; shots: { file: string; caption: string }[]; checks: Check[]
}
const CHAPTERS = [
  'Book the tasks',
  'While booking — the Brief, the Files, add a link',
  'Shape the tasks — add, waits for, warnings, a task for another team, remove',
  'Book it, and move between weeks',
  'Change what is booked — a booking, a task, all tasks, remove one, cancel',
  'The other lead answers — My work, the Schedule, the answers back, after 4 hours',
  'The piece on the campaign page — suggested list, approve, assign, give all to one person',
  'Ask the account manager to change it — ask, waiting, accepted, kept; her answer',
  'Re-open, and client amendments',
  'Block time',
  'More time',
  'Refused — as a person sees it',
]
const FRAME_LABEL = (k: string) => (k.startsWith('m') ? `Mock-up ${k.slice(1)}` : k === 'SC-21n' ? 'SC-21 (next week)' : k === 'SC-21e' ? 'SC-21 (Edit all tasks) — drawn by SC-27' : k)
const firstLines = (e: unknown) => ((e as Error)?.message ?? String(e)).split('\n').filter((l) => l.trim()).slice(0, 8).join('\n')

class Walk {
  steps: Step[] = []
  step!: Step
  shots = 0
  story: string[] = []
  constructor() {
    if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true })
    mkdirSync(path.join(OUT, 'shots'), { recursive: true })
    this.flush()
  }
  begin(chapter: number, title: string, actor: Tag, does: string, frames: string[], differs: string | null = null, staged: string | null = null) {
    const n = this.steps.filter((s) => s.chapter === chapter).length + 1
    this.step = { chapter, n, title, actor: ACTOR(actor), does, frames, differs, staged, shots: [], checks: [] }
    this.steps.push(this.step)
    this.flush()
  }
  async check(title: string, fn: () => Promise<unknown> | unknown): Promise<boolean> {
    try { await fn(); this.step.checks.push({ title, ok: true }); this.flush(); return true } catch (e) {
      this.step.checks.push({ title, ok: false, detail: firstLines(e) }); this.flush(); return false
    }
  }
  /** A whole action the step needs. Refused or impossible = a failed check in words; the walk goes on. */
  act(title: string, fn: () => Promise<unknown> | unknown) { return this.check(`done: ${title}`, fn) }
  async shot(page: Page, slug: string, caption = '', of?: Locator, full = false) {
    this.shots += 1
    const name = `${String(this.shots).padStart(3, '0')}-${slug}.jpg`
    try {
      await page.addStyleTag({ content: '[data-testid="environment-bar"],[data-testid="update-bar"]{display:none!important}' }).catch(() => {})
      await page.waitForTimeout(600)
      const file = path.join(OUT, 'shots', name)
      // A whole page (the left column runs below the fold): the shell's own scroller let out, then put back.
      const tall = full ? await page.addStyleTag({ content: '.shell{block-size:auto!important;overflow:visible!important}.shell-main{overflow:visible!important}' }) : null
      if (tall) await page.waitForTimeout(300)
      if (of) await of.screenshot({ path: file, type: 'jpeg', quality: 72 })
      else await page.screenshot({ path: file, type: 'jpeg', quality: 72, fullPage: full })
      if (tall) await tall.evaluate((el) => (el as Element).remove())
      this.step.shots.push({ file: `shots/${name}`, caption })
    } catch (e) {
      this.step.checks.push({ title: `screenshot "${slug}" taken`, ok: false, detail: firstLines(e) })
    }
    this.flush()
  }
  failures() { return this.steps.reduce((n, s) => n + s.checks.filter((c) => !c.ok).length, 0) }
  flush() {
    writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ story: this.story, steps: this.steps }, null, 2))
  }
}

const ROLE: Record<string, string> = {
  power_admin: 'Power Admin', scheduler: 'Traffic', account_manager: 'account manager', account_director: 'account director',
  department_lead: 'department lead', team_lead: 'team lead', deputy_team_lead: 'deputy team lead', team_member: 'team member', ceo: 'CEO',
}
function ACTOR(tag: Tag): string {
  const p = PEOPLE[tag] as { name: string; role: string; department?: string; team?: string }
  const where = p.team ? `${p.team} team, ${p.department}` : p.department ? p.department : ''
  return `${p.name} — ${ROLE[p.role] ?? p.role}${where ? `, ${where}` : ''}`
}

// ------------------------------------------------------------------------------ the doors ----

/** Place a given task on the calendar the way the editors do after an assignment (`subtask-schedule`), as the person. */
async function scheduleAs(tag: Tag, subTaskId: string) {
  const res = await fetch(`${API}/functions/v1/subtask-schedule`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${await tokenOf(tag)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ subTaskId }),
  })
  expect(res.status, `subtask-schedule as ${tag}: ${await res.text()}`).toBeLessThan(300)
}
const at = (isoDay: string, h: number) => `${isoDay}T${String(h - 3).padStart(2, '0')}:00:00Z`
/** `update_task_assignment` as the person — the door every task editor's Save calls. */
async function giveAs(tag: Tag, subTaskId: string, title: string, to: Tag, reviewer: Tag, day: string, hours: number, dayTo = day) {
  const out = await rpcAs<{ outcome: string }[]>(tag, 'update_task_assignment', {
    p_sub_task: subTaskId, p_title: title, p_assignee: await idOf(to),
    p_reviewers: [{ user_id: await idOf(reviewer), is_mandatory: true }],
    p_starts_at: at(day, 9), p_due_at: at(dayTo, 17), p_hours: hours, p_review_mode: 'manual',
  })
  expect(out[0]!.outcome, `${title} given to ${to}`).toBe('assigned')
  await scheduleAs(tag, subTaskId)
}
type T = { id: string; title: string; status: string; assignee_id: string | null; starts_at: string | null; due_at: string | null; sla_hours: number | null }
const tasksOf = (d: string) => rows<T>('sub_tasks', `select=id,title,status,assignee_id,starts_at,due_at,sla_hours&deliverable_id=eq.${d}&status=neq.cancelled&order=sort_order.asc,unit_index.asc`)
const taskRow = async (id: string) => (await rows<T>('sub_tasks', `select=id,title,status,assignee_id,starts_at,due_at,sla_hours&id=eq.${id}`))[0]!
const bookingsOf = (id: string) => rows<{ id: string; resource_id: string; starts_at: string; state: string }>('bookings', `select=id,resource_id,starts_at,state&sub_task_id=eq.${id}&state=neq.cancelled&order=starts_at`)
const requestsOn = (id: string) => rows<{ id: string; status: string; team_id: string | null; assignee_id: string | null; created_at: string }>('sub_task_assignment_requests', `select=id,status,team_id,assignee_id,created_at&sub_task_id=eq.${id}&order=created_at.desc`)
const iraqDayOf = (ts: string) => new Date(Date.parse(ts) + 3 * 3_600_000).toISOString().slice(0, 10)
const COPY_TEAM = 'd0000000-0000-4000-8000-00000000d105'
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

/** The reviewer goes on the task first (as the booking window does), then the ask — `request_task_booking`, as the asker. */
async function askCopyAs(tag: Tag, task: T, deliverableId: string, neededBy: string, note: string): Promise<string> {
  await rpcAs(tag, 'save_sub_task', { p_sub_task: task.id, p_deliverable: deliverableId, p_title: task.title, p_reviewers: [{ user_id: await idOf(tag), is_mandatory: true }] })
  return rpcAs<string>(tag, 'request_task_booking', { p_sub_task: task.id, p_team: COPY_TEAM, p_assignee: null, p_hours: 2, p_needed_by: neededBy, p_note: note })
}

// ------------------------------------------------------------------------------ the browser ----

/** Re-runs on one database need fresh job names (a client's job names are unique); the fresh-reset run uses none. */
const SUFFIX = process.env.WALK_SUFFIX ?? ''
/**
 * The single-job flow (SJ-v3-01 → SJ-04) as the account manager — the steps of `releaseSingleJob`, with the two
 * questions this walk's tight dates meet answered: "Wed is 1 day short — not a block" (Continue) and a look-alike
 * job (Keep them separate). A Creative Social Advertisement owned by the Design team lead.
 */
async function releaseJob(page: Page, title: string, client: string, due: string): Promise<ReleasedJob> {
  await page.goto('/campaigns/new-job')
  await page.getByTestId('sj-client').selectOption({ label: client })
  await page.getByTestId('sj-words').fill('Social statics for the summer range.')
  await page.getByTestId('sj-brief-card-single_execution').click()
  await page.getByTestId('sj-next').click()
  await expect(page.getByTestId('sj-brief')).toBeVisible()
  await page.getByTestId('sj-field-task').fill('Design the summer range posts — Arabic first, English beside it.')
  await page.getByTestId('sj-next').click()
  await expect(page.getByTestId('sj-request')).toBeVisible()
  await page.getByTestId('sj-title').fill(title)
  await page.getByTestId('sj-due').fill(due)
  const picker = page.getByTestId('sj-type')
  await picker.fill('Social Advertisement')
  await page.getByTestId('sj-type-list').getByRole('option', { name: /Social Advertisement/ }).first().dispatchEvent('mousedown')
  await page.getByTestId('sj-department').getByRole('radio', { name: 'Creative' }).click()
  await pickJobLanguages(page)
  const owner = page.getByTestId('sj-owner-select')
  await owner.selectOption((await owner.locator('option', { hasText: PEOPLE.tl.name }).first().getAttribute('value'))!)
  await page.getByTestId('sj-next').click()
  const short = page.getByTestId('sj-short-continue')
  const similar = page.getByTestId('sj-similar-separate')
  const review = page.getByTestId('sj-review')
  for (let i = 0; i < 3; i++) {
    const seen = await Promise.any([
      short.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'short' as const),
      similar.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'similar' as const),
      review.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'review' as const),
    ])
    if (seen === 'review') break
    if (seen === 'short') await short.click()
    if (seen === 'similar') await similar.click()
  }
  await expect(review).toBeVisible()
  const campaignId = await approveSingleJob(page)
  const [d] = await rows<{ id: string; owner_user_id: string }>('deliverables', `select=id,owner_user_id,streams!inner(campaign_id)&streams.campaign_id=eq.${campaignId}`)
  expect(d, `the piece of ${title}`).toBeTruthy()
  return { title, campaignId, deliverableId: d!.id, ownerUserId: d!.owner_user_id }
}

async function as(browser: Browser, tag: Tag): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag), viewport: VIEW })
  const page = await ctx.newPage()
  await mockBucket(page)
  await page.route('https://drive.example.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: 'the working file' }))
  return page
}
async function schedule(page: Page, on: string) {
  await page.goto(`/schedule?on=${on}`)
  await expect(page.getByTestId('schedule-grid')).toBeVisible({ timeout: 25_000 })
  await page.waitForLoadState('networkidle').catch(() => {})
}
async function panel(page: Page, job: ReleasedJob) {
  await page.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
  await expect(page.getByTestId('piece-panel')).toBeVisible({ timeout: 25_000 })
  await page.waitForLoadState('networkidle').catch(() => {})
}
async function pickRange(page: Page, picker: string, from: string, to: string) {
  await page.getByTestId(`${picker}-day-${from}`).click()
  await page.getByTestId(`${picker}-day-${to}`).click()
}
async function pickOneDay(page: Page, picker: string, d: string) {
  await page.getByTestId(`${picker}-day-${d}`).click()
  await page.getByTestId(`${picker}-day-${d}`).click()
  await page.getByTestId(`${picker}-done`).click()
}
/** Hours: press + until the row reads `n` hours. */
async function hoursTo(page: Page, prefix: string, key: string, n: number) {
  const box = page.getByTestId(`${prefix}-hours-${key}`)
  const read = async () => Number(((await box.textContent()) ?? '').replace(/[^0-9.]/g, '') || '0')
  for (let i = 0; i < 20; i++) {
    const now = await read()
    if (now === n) return
    await page.getByTestId(`${prefix}-${now < n ? 'more' : 'less'}-${key}`).click()
    await expect.poll(read, { timeout: 5_000 }).not.toBe(now)
  }
  expect(await read(), `${key} at ${n}h`).toBe(n)
}

// ------------------------------------------------------------------------------ the walk ----

test.describe('Schedule rework walk (Figma L and N)', () => {
  test.skip(!WALK, 'review walk — run with WALK=1')
  test.setTimeout(45 * 60_000)
  test.use({ actionTimeout: 15_000 })

  test('every frame beside the built screen', async ({ browser, page: scratch }) => {
    const w = new Walk()
    // The working days, from a Sunday (Baghdad's week, Sun–Thu): today when it is one, else the coming Sunday — so
    // D0–D4 are one week on the grid whatever day the walk runs (run on a Monday, "from today" put D4 in next week).
    const toSunday = (7 - new Date(`${day(0)}T12:00:00Z`).getUTCDay()) % 7
    const D: string[] = []
    for (let i = 0, n = toSunday; D.length < 25; n++) { const d = workday(n); if (!D.includes(d)) D.push(d); i++ }
    const [D0, D1, D2, D3, D4] = D as [string, string, string, string, string]
    const weekOf = D1
    w.story.push(`Walked ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC on a fresh local reset. The working week shown is ${D0} – ${D4}.`)

    // ===================================================================== SET-UP (hard) ====
    const res = { maker: await resourceIdOf('maker'), deputy: await resourceIdOf('deputy'), tl: await resourceIdOf('tl'), writer: await resourceIdOf('writer') }
    const am = await as(browser, 'am')
    const tl = await as(browser, 'tl')
    type Piece = ReleasedJob & { name: string }
    async function release(title: string, name: string, client: string, due: string): Promise<Piece> {
      const job = await releaseJob(am, title + SUFFIX, client, due)
      expect(job.ownerUserId, `${title} is owned by the Design team lead`).toBe(await idOf('tl'))
      // The account manager names the piece on its panel (only she changes a deliverable — ADR-0141 d.1).
      await panel(am, job)
      await am.getByTestId('piece-panel-name').fill(name)
      await am.getByTestId('piece-panel-save').click()
      await closeCampaignBanner(am)
      await expect.poll(async () => (await rows<{ name: string }>('deliverables', `select=name&id=eq.${job.deliverableId}`))[0]!.name).toBe(name)
      return { ...job, name }
    }
    const P1 = await release('Summer launch — post 2', 'Post 2 — the lemon fizz carousel', 'Northwind Beverages', D4)
    const P2 = await release('Summer launch — post 3', 'Post 3 — what is new in the range', 'Northwind Beverages', D[9]!)
    const P3 = await release('Summer launch — stories', 'Story set — three quick frames', 'Northwind Beverages', D[10]!)
    const P4 = await release('Harbour Line — digital banners', 'Digital banner', 'Harbour Line Logistics', D3)
    const P5 = await release('Summer launch — reel', 'Reel — the bottling line', 'Northwind Beverages', D[8]!)
    const P6 = await release('Summer launch — key visual', 'Key visual — the summer bottle', 'Northwind Beverages', D[12]!)
    for (const p of [P1, P4, P5, P6]) await approveTaskList(tl, p)
    const [t1, t2, t3, t4] = (await tasksOf(P1.deliverableId)) as [T, T, T, T]
    const p4 = await tasksOf(P4.deliverableId)
    const p5 = await tasksOf(P5.deliverableId)
    const p6 = await tasksOf(P6.deliverableId)
    expect(t4, 'Post 2 has its four tasks').toBeTruthy()

    // Work already on the week (given through update_task_assignment as the team lead — the door every editor's Save calls).
    await giveAs('tl', p4[0]!.id, p4[0]!.title, 'deputy', 'tl', D2, 3)
    await giveAs('tl', p4[1]!.id, p4[1]!.title, 'maker', 'tl', D1, 2)
    await giveAs('tl', p4[3]!.id, p4[3]!.title, 'maker', 'tl', D1, 4)
    // The Copy work on two other pieces is asked of Copy (request_task_booking, as the team lead — the window's door).
    const askOffer = await askCopyAs('tl', p5[2]!, P5.deliverableId, D3, 'Arabic and English lines for the reel captions.')
    const askNo = await askCopyAs('tl', p4[2]!, P4.deliverableId, D2, 'Three banner headlines, Arabic first.')
    // A finished piece for the re-open: every task given to the maker, made, sent, approved — each as the person.
    {
      const [{ tenant_id }] = await rows<{ tenant_id: string }>('campaigns', `select=tenant_id&id=eq.${P6.campaignId}`)
      for (const t of p6) {
        await giveAs('tl', t.id, t.title, 'maker', 'tl', D[11]!, 1)
        await rpcAs('maker', 'sub_task_start', { p_id: t.id })
        const fb = await restAs('maker', 'POST', 'review_feedback', '', { tenant_id, sub_task_id: t.id, body: `Done: ${t.title}.`, author_user_id: await idOf('maker') })
        expect(fb.status, fb.text).toBeLessThan(300)
        await rpcAs('maker', 'sub_task_submit', { p_id: t.id, p_manual_minutes: null, p_accept_untimed: true })
        await rpcAs('tl', 'sub_task_approve', { p_sub_task: t.id })
      }
      await expect.poll(async () => (await rows<{ state: string }>('deliverables', `select=state&id=eq.${P6.deliverableId}`))[0]!.state, { timeout: 20_000 }).toBe('approved')
    }
    w.story.push('Set-up, through the product: the account manager released six Creative single jobs (each owned by Dev Team Lead) and named each piece on its panel; the team lead approved four task lists; three tasks of the banner job were given to Dev Maker and Dev Deputy Lead this week; two Copy tasks were asked of the Copy team; the key-visual piece was made, sent and approved, so it can be re-opened.')

    // ===================================================================== 11. More time — the maker asks (real, before SC-01) ====
    const mk = await as(browser, 'maker')
    w.begin(11, 'The maker asks her lead for more time', 'maker',
      'On her task page Dev Maker presses "Ask for more time", picks the day she needs and says why. It goes to her own team lead — not to the account manager.',
      ['m9'])
    await w.act('the maker opens her task and asks for more time', async () => {
      await mk.goto(`/my-work/task/${p4[1]!.id}`)
      await mk.getByTestId('task-more-time-open').click({ timeout: 25_000 })
      await mk.getByTestId('task-more-time-day').fill(D4)
      await mk.getByTestId('task-more-time-note').fill('The client sent new product shots this morning.')
    })
    await w.shot(mk, 'more-time-ask', 'Dev Maker’s task page, the ask filled in')
    await w.act('Send', async () => {
      await mk.getByTestId('task-more-time-send').click()
      await expect(mk.getByTestId('task-more-time-pending')).toBeVisible()
    })
    const timeAsk = (await rows<{ id: string }>('sub_task_time_asks', `select=id&sub_task_id=eq.${p4[1]!.id}&status=eq.pending`))[0]
    await w.check('the ask waits on her team lead', () => expect(timeAsk).toBeTruthy())

    // ===================================================================== 1. Book the tasks ====
    w.begin(1, 'The team lead’s Schedule', 'tl',
      'Dev Team Lead opens the Schedule. On the left, the pieces waiting to be booked and the asks waiting on her; on the right, her own team’s week with each day’s free hours.',
      ['SC-01'],
      'Her grid shows her own team — three people in the seed (Design) — as ADR-0139 d.6 says. The account manager’s pieces show as “To book” once their task lists are approved.')
    await w.act('open the Schedule on this week', () => schedule(tl, weekOf))
    await w.check('her own team only — the Motion animator is not on her grid', async () => {
      await expect(tl.getByTestId(`cell-${res.maker}-${D1}`)).toBeVisible()
      await expect(tl.getByTestId(`cell-${await resourceIdOf('animator')}-${D1}`)).toHaveCount(0)
    })
    await w.check('To book lists the approved pieces', async () => {
      for (const p of [P1, P5]) await expect(tl.getByTestId(`to-book-${p.deliverableId}`)).toBeVisible()
    })
    await w.check('the maker’s ask for more time is in Asks', () => expect(tl.getByTestId(`time-ask-${timeAsk?.id}`)).toBeVisible())
    await w.shot(tl, 'sc01', '', undefined, true)

    w.begin(1, 'Narrow To book by client', 'tl', 'She opens the client menu above the list: each client with how many of its pieces are waiting.', ['SC-02b'])
    await w.act('open the client menu', async () => {
      await tl.getByTestId('to-book-client').click()
      await expect(tl.getByTestId('to-book-client-menu')).toBeVisible()
    })
    await w.shot(tl, 'sc02b')
    await tl.keyboard.press('Escape')

    w.begin(1, 'Pick a piece', 'tl', 'She clicks “Post 2 — the lemon fizz carousel”. It is picked; a line above the grid says to click a day on someone’s row.', ['SC-02'])
    await w.act('pick Post 2', async () => {
      await tl.getByTestId(`to-book-${P1.deliverableId}`).click()
      await expect(tl.getByTestId('schedule-picked')).toBeVisible()
    })
    await w.shot(tl, 'sc02')

    w.begin(1, 'Click a day: the booking window opens', 'tl',
      'She clicks Monday on Dev Maker’s row. The window lists the piece’s four tasks from its workflow, each with hours, who and dates.',
      ['SC-03'],
      'The window also carries “Who checks the work” (reviewers chosen with the existing picker — Edward, 3 Oct, I74.22). The workflow gives these tasks no hours, so each starts at none.')
    await w.act('click Monday on Dev Maker’s row', async () => {
      await tl.getByTestId(`cell-${res.maker}-${D1}`).click({ position: { x: 4, y: 4 } })
      await expect(tl.getByTestId(`book-row-${t1.id}`)).toBeVisible({ timeout: 15_000 })
    })
    await w.shot(tl, 'sc03')

    w.begin(1, 'Tick every task and give them to one person', 'tl',
      'She sets the hours, ticks all four rows and opens “Pick a person” on the dark bar: her team, each with the hours free that week, and “Ask another team…”.', ['SC-03b'])
    await w.act('hours 2, 3, 2, 4 and tick all', async () => {
      await hoursTo(tl, 'book', t1.id, 2); await hoursTo(tl, 'book', t2.id, 3); await hoursTo(tl, 'book', t3.id, 2); await hoursTo(tl, 'book', t4.id, 4)
      await tl.getByTestId('book-select-all').check()
      await expect(tl.getByTestId('book-bulk')).toBeVisible()
      await tl.getByTestId('book-bulk-who').click()
      await expect(tl.getByTestId(`book-bulk-who-list-${res.maker}`)).toBeVisible()
    })
    await w.shot(tl, 'sc03b')

    w.begin(1, 'Applied to all: the warning', 'tl',
      'She picks Dev Maker and Monday and presses Apply. Every row takes her; the line at the foot warns that Monday is now over a full day — a warning, never a block.', ['SC-03c'])
    await w.act('Dev Maker on Monday, Apply', async () => {
      await tl.getByTestId(`book-bulk-who-list-${res.maker}`).click()
      await tl.getByTestId('book-bulk-day').click()
      await tl.getByTestId(`book-bulk-day-picker-day-${D1}`).click()
      await tl.getByTestId('book-bulk-day-picker-done').click()
      await tl.getByTestId('book-bulk-apply').click()
      await expect(tl.getByTestId(`book-who-${t4.id}`)).toContainText(PEOPLE.maker.name)
    })
    await w.shot(tl, 'sc03c')
    await w.act('Cancel — nothing is written', async () => {
      await tl.getByTestId('book-cancel').click()
      await expect(tl.getByTestId('book-submit')).toHaveCount(0)
    })
    await w.check('nothing was booked', async () => expect((await taskRow(t1.id)).assignee_id).toBeNull())

    w.begin(1, 'One task at a time: Who', 'tl',
      'She opens the window again and gives the first task to Dev Maker on Monday, then opens Who on the second: her team, the freest first, and “Ask another team…”.', ['SC-04'])
    await w.act('open again; first task to Dev Maker on Monday; open Who on the second', async () => {
      await tl.getByTestId(`cell-${res.maker}-${D1}`).click({ position: { x: 4, y: 4 } })
      await expect(tl.getByTestId(`book-row-${t1.id}`)).toBeVisible({ timeout: 15_000 })
      await tl.getByTestId(`book-who-${t1.id}`).click()
      await tl.getByTestId(`book-who-list-${res.maker}`).click()
      await tl.getByTestId(`book-dates-${t1.id}`).click()
      await pickOneDay(tl, 'book-dates-picker', D1)
      await hoursTo(tl, 'book', t1.id, 2)
      await tl.getByTestId(`book-who-${t2.id}`).click()
      await expect(tl.getByTestId('book-who-list')).toBeVisible()
    })
    await w.shot(tl, 'sc04')

    w.begin(1, 'Pick the dates', 'tl', 'Dev Maker for the second task; the dates calendar shows each day’s free hours for her. She picks Tuesday to Wednesday.', ['SC-05'])
    await w.act('Dev Maker; Tuesday to Wednesday', async () => {
      await tl.getByTestId(`book-who-list-${res.maker}`).click()
      await hoursTo(tl, 'book', t2.id, 3)
      await tl.getByTestId(`book-dates-${t2.id}`).click()
      await expect(tl.getByTestId('book-dates-picker')).toBeVisible()
      await pickRange(tl, 'book-dates-picker', D2, D3)
    })
    await w.shot(tl, 'sc05')

    w.begin(1, 'Dates past the due date', 'tl', 'She tries the next week instead. The calendar says in red that it ends after the piece’s due date — she can still book; it would go to the account manager.', ['SC-06'])
    await w.act('pick two days after the due date', async () => {
      await pickRange(tl, 'book-dates-picker', D[6]!, D[7]!)
    })
    await w.shot(tl, 'sc06')
    await w.act('back to Tuesday–Wednesday, Done', async () => {
      await pickRange(tl, 'book-dates-picker', D2, D3)
      await tl.getByTestId('book-dates-picker-done').click()
      await expect(tl.getByTestId('book-dates-picker')).toHaveCount(0)
    })

    // ===================================================================== 2. While booking ====
    w.begin(2, 'The Brief tab', 'tl', 'In the same window she opens Brief: the piece’s brief, read only.', ['SC-07'])
    await w.act('open Brief', async () => {
      await tl.getByTestId('book-tab-brief').click()
      await expect(tl.locator('[data-testid="book-brief"], [data-testid="book-brief-none"]')).toHaveCount(1)
    })
    await w.shot(tl, 'sc07')

    w.begin(2, 'The Files tab', 'tl', 'Files: what came with the brief, the piece’s Library folder, and the links and files her team added.', ['SC-08'])
    await w.act('open Files', async () => {
      await tl.getByTestId('book-tab-files').click()
      await expect(tl.locator('[data-testid="book-files"], [data-testid="book-files-none"]')).toHaveCount(1)
    })
    await w.shot(tl, 'sc08')

    w.begin(2, 'Add a link', 'tl', 'She presses “Add a link”, pastes the address and names it, and presses Add. She owns this deliverable, so the link goes into its own Library folder at the first press — nobody in her team needs to hold a task of the client first (Edward, 4 Oct, I74.28).', ['SC-09'])
    await w.act('fill the link form', async () => {
      await tl.getByTestId('book-files-add-link').click()
      await tl.getByTestId('book-files-link-url').fill('https://drive.example.com/file/lemon-fizz-copy')
      await tl.getByTestId('book-files-link-name').fill('Arabic copy from the client')
    })
    await w.shot(tl, 'sc09')
    await w.act('press Add', async () => {
      await tl.getByTestId('book-files-link-add').click()
      await expect(tl.getByTestId('book-files-link-form')).toHaveCount(0)
    })
    await w.check('the link is in the deliverable’s own folder, at the first press', async () => {
      const [folder] = await rows<{ id: string }>('asset_folders', `select=id&deliverable_id=eq.${P1.deliverableId}&kind=eq.deliverable`)
      expect(folder, 'the deliverable has its folder').toBeTruthy()
      const added = await rows<{ folder_id: string }>('assets', `select=folder_id&name=eq.${encodeURIComponent('Arabic copy from the client')}&deleted_at=is.null`)
      expect(added.map((a) => a.folder_id)).toEqual([folder!.id])
    })
    await w.check('it is listed on the Files tab, with no refusal', async () => {
      await expect(tl.getByTestId('book-files')).toContainText('Arabic copy from the client')
      await expect(tl.getByTestId('book-files-error')).toHaveCount(0)
    })
    await w.shot(tl, 'sc09-added', 'After pressing Add — the link is listed in the deliverable’s folder')

    // ===================================================================== 3. Shape the tasks ====
    w.begin(3, 'Add a task', 'tl', 'Back on Tasks, “+ Add a task” offers the workflow’s steps not already on the piece, and “Something else…”.', ['SC-11'])
    await w.act('open Add a task', async () => {
      await tl.getByTestId('book-tab-tasks').click()
      await tl.getByTestId('book-add-task').click()
      await expect(tl.getByTestId('book-add-own')).toBeVisible()
    })
    await w.shot(tl, 'sc11')

    w.begin(3, 'A task of her own', 'tl', '“Something else…” adds a row with its name box open; she types it.', ['SC-12'])
    await w.act('Something else… and type its name', async () => {
      await tl.getByTestId('book-add-own').click()
      await tl.getByTestId('book-name-new:1').fill('Voice-over script check')
    })
    await w.shot(tl, 'sc12')
    await w.act('Enter', async () => {
      await tl.getByTestId('book-name-new:1').press('Enter')
      await expect(tl.getByTestId('book-row-new:1')).toContainText('Voice-over script check')
    })

    w.begin(3, 'What a task waits for', 'tl', 'Under each task, “Waits for …” opens a list: nothing, or one or more of the other tasks.', ['SC-13'])
    await w.act('open Waits for on the Create Artwork task', async () => {
      await tl.getByTestId(`book-waits-${t4.id}`).click()
      await expect(tl.getByTestId('book-waits-none')).toBeVisible()
    })
    await w.shot(tl, 'sc13')
    await w.act('tick Develop Concept; close', async () => {
      await tl.getByTestId(`book-waits-${t4.id}-${t2.id}`).check()
      await tl.keyboard.press('Escape')
    })

    w.begin(3, 'Warnings — and she can still book', 'tl',
      'She gives the first task 4 hours on Monday (Dev Maker already has 8 there), starts Create Artwork on Monday though it waits for a task ending Wednesday, and dates the own task after the due day. Each row says what is wrong; nothing is blocked.', ['SC-14'])
    await w.act('make the three warnings', async () => {
      await hoursTo(tl, 'book', t1.id, 4)
      await tl.getByTestId(`book-who-${t4.id}`).click()
      await tl.getByTestId(`book-who-list-${res.maker}`).click()
      await tl.getByTestId(`book-dates-${t4.id}`).click()
      await pickOneDay(tl, 'book-dates-picker', D1)
      await hoursTo(tl, 'book', t4.id, 4)
      await tl.getByTestId('book-who-new:1').click()
      await tl.getByTestId(`book-who-list-${res.deputy}`).click()
      await tl.getByTestId('book-dates-new:1').click()
      await pickOneDay(tl, 'book-dates-picker', D[6]!)
      await hoursTo(tl, 'book', 'new:1', 1)
    })
    await w.check('the foot counts what to check, and the button still books', async () => {
      await expect(tl.getByTestId('book-summary')).toContainText(/to check/)
      await expect(tl.getByTestId('book-submit')).toBeEnabled()
    })
    await w.shot(tl, 'sc14')
    await w.act('fix them: 2 hours; Create Artwork on Thursday; the own task on Thursday', async () => {
      await hoursTo(tl, 'book', t1.id, 2)
      await tl.getByTestId(`book-dates-${t4.id}`).click()
      await pickOneDay(tl, 'book-dates-picker', D4)
      await tl.getByTestId('book-dates-new:1').click()
      await pickOneDay(tl, 'book-dates-picker', D4)
    })

    w.begin(3, 'Ask another team — pick the team, then the person or the lead', 'tl',
      'Who on Write Copy → “Ask another team…”. She picks the Copy team; its people follow with their free hours, and first “Anyone — their lead decides”.', ['m1'])
    await w.act('Ask another team… → Copy', async () => {
      await tl.getByTestId(`book-who-${t3.id}`).click()
      await tl.getByTestId('book-who-list-ask-other').click()
      await tl.getByTestId('book-who-list-ask-team').selectOption(COPY_TEAM)
      await expect(tl.getByTestId('book-who-list-ask-anyone')).toBeVisible()
    })
    await w.shot(tl, 'm1')

    w.begin(3, 'A task for another team', 'tl', 'She leaves it to the Copy lead. The row turns into an ask: the team, a note for their lead, the day it is needed by. Nothing is booked on Copy’s people until their lead answers.', ['SC-15'])
    await w.act('Anyone — their lead decides; a note; needed by Wednesday', async () => {
      await tl.getByTestId('book-who-list-ask-anyone').click()
      await expect(tl.getByTestId(`book-ask-${t3.id}`)).toBeVisible()
      await tl.getByTestId(`book-ask-${t3.id}-note`).fill('Arabic and English lines for the five frames. The English is in the brief.')
      await tl.getByTestId(`book-dates-${t3.id}`).click()
      await tl.getByTestId(`book-ask-day-picker-day-${D3}`).click()
      await tl.getByTestId('book-ask-day-picker-done').click()
      await hoursTo(tl, 'book', t3.id, 2)
    })
    await w.shot(tl, 'sc15')

    w.begin(3, 'Remove a task — with Undo', 'tl', 'She removes her own Voice-over row with its ✕. A line says it is removed, with Undo, until she books.', ['SC-16'])
    await w.act('✕ on the own task', async () => {
      await tl.getByTestId('book-remove-new:1').click()
      await expect(tl.getByTestId('book-undo')).toBeVisible()
    })
    await w.shot(tl, 'sc16')

    // ===================================================================== 4. Book it ====
    w.begin(4, 'Ready to book', 'tl', 'She picks who checks the work. The foot sums it up, and the button says what will happen: book 3 tasks, send 1 ask.', ['SC-17'],
      'The reviewer row (“Who checks the work”) is extra to the frame — Edward, 3 Oct (I74.22).')
    await w.act('choose the reviewer: Dev Dept Lead', async () => {
      await tl.getByTestId('book-reviewer-add').selectOption(await idOf('lead'))
      await expect(tl.getByTestId('book-submit')).toHaveText(/Book 3 tasks, send 1 ask/)
    })
    await w.shot(tl, 'sc17')

    w.begin(4, 'Booked', 'tl',
      'She presses it. The three tasks land on Dev Maker’s week; the ask waits on the left under “Asked of other teams” and as a ⏳ chip on the grid’s “Other teams” row; a note at the foot says who is told, with Undo.', ['SC-18'])
    await w.act('Book 3 tasks, send 1 ask', async () => {
      await tl.getByTestId('book-submit').click()
      await expect(tl.getByTestId('book-submit')).toHaveCount(0, { timeout: 45_000 })
      await expect(tl.getByTestId('schedule-toast')).toBeVisible()
    })
    const askBooked = (await requestsOn(t3.id))[0]
    await w.check('three booked on Dev Maker, one ask pending on Copy', async () => {
      for (const t of [t1, t2, t4]) await expect.poll(async () => (await taskRow(t.id)).assignee_id, { timeout: 20_000 }).toBe(await idOf('maker'))
      expect(askBooked).toMatchObject({ status: 'pending', team_id: COPY_TEAM, assignee_id: null })
      expect((await taskRow(t3.id)).assignee_id).toBeNull()
    })
    await w.shot(tl, 'sc18', '', undefined, true)

    w.begin(4, 'Later: the ask still waiting', 'tl', 'Opening the Schedule again later, the ask card says how long ago she asked, with “See the ask” and “Withdraw”.', ['SC-19'])
    await w.act('open the Schedule again', () => schedule(tl, weekOf))
    await w.check('the ask card is there', () => expect(tl.getByTestId(`ask-sent-${askBooked?.id}`)).toBeVisible())
    await w.shot(tl, 'sc19', '', undefined, true)

    w.begin(4, 'The weeks menu', 'tl', 'The week button opens the weeks around it, each with how full her team is, and “Jump to a date…”.', ['SC-20'])
    await w.act('open the weeks menu', async () => {
      await tl.getByTestId('week-menu-open').click()
      await expect(tl.getByTestId('week-menu')).toBeVisible()
    })
    await w.shot(tl, 'sc20')

    w.begin(4, 'Next week', 'tl', 'She picks next week. The grid moves; “Back to this week” appears beside the week button.', ['SC-21n'])
    await w.act('pick next week', async () => {
      await tl.getByTestId('week-option-1').click()
      await expect(tl.getByTestId('nav-today')).toBeVisible()
    })
    await w.shot(tl, 'sc21-next')
    await w.act('back to this week', async () => { await tl.getByTestId('nav-today').click(); await schedule(tl, weekOf) })

    // ===================================================================== 5. Change what is booked ====
    const p4t0Booking = (await bookingsOf(p4[0]!.id))[0]!
    w.begin(5, 'A booking’s pop-up', 'tl', 'She clicks Dev Deputy Lead’s banner booking on Tuesday. The pop-up shows who, the days, the hours, the task and where it is, with Save, Open the piece, Edit all tasks, and Cancel this booking.', ['SC-23'])
    await w.act('click the booking', async () => {
      await tl.getByTestId(`booking-${p4t0Booking.id}`).click()
      await expect(tl.getByTestId('task-popup')).toBeVisible()
      await expect(tl.getByTestId('edit-task')).toBeVisible({ timeout: 15_000 })
    })
    await w.shot(tl, 'sc23')

    w.begin(5, 'Cancel this booking', 'tl', '“Cancel this booking” asks inline what it does. Yes takes Dev Deputy Lead off, frees her day, and the task goes back to To book.', ['SC-24'],
      'Who is told differs from the frame: the person and their team lead are told, not the account manager (Edward, 3 Oct — ADR-0140 d.5).')
    await w.act('Cancel this booking', async () => {
      await tl.getByTestId('edit-cancel-booking').click()
      await expect(tl.getByTestId('edit-cancel-ask')).toBeVisible()
    })
    await w.shot(tl, 'sc24')
    await w.act('Yes', async () => {
      await tl.getByTestId('edit-cancel-yes').click()
      await expect(tl.getByTestId('task-popup')).toHaveCount(0)
    })
    await w.check('the task is back with nobody, the deputy and her team lead told — not the account manager', async () => {
      await expect.poll(async () => (await taskRow(p4[0]!.id)).assignee_id).toBeNull()
      const told = (await rows<{ user_id: string }>('notifications', `select=user_id&type=eq.task_unassigned&entity_id=eq.${p4[0]!.id}`)).map((x) => x.user_id)
      expect(told).toContain(await idOf('deputy'))
      expect(told).not.toContain(await idOf('am'))
    })

    const t4Booking = (await bookingsOf(t4.id))[0]!
    w.begin(5, 'A task’s pop-up', 'tl', 'She clicks Create Artwork on Thursday. The same pop-up, for a task of a piece: every detail editable, and the piece’s other tasks with where each stands.', ['SC-26'])
    await w.act('click Create Artwork', async () => {
      await schedule(tl, weekOf)
      await tl.getByTestId(`booking-${t4Booking.id}`).click()
      await expect(tl.getByTestId('edit-task')).toBeVisible({ timeout: 15_000 })
    })
    await w.shot(tl, 'sc26')

    w.begin(5, 'Remove one task', 'tl', '“Remove this task” on a booked task asks inline first. She keeps it.', ['SC-27'])
    await w.act('Remove this task → asked', async () => {
      await tl.getByTestId('edit-remove-task').click()
      await expect(tl.getByTestId('edit-remove-ask')).toBeVisible()
    })
    await w.shot(tl, 'sc27-remove')
    await w.act('Keep it', async () => { await tl.getByTestId('edit-remove-keep').click(); await expect(tl.getByTestId('edit-remove-ask')).toHaveCount(0) })

    w.begin(5, 'Edit all tasks', 'tl', '“Edit all tasks” opens the same editor over the whole piece: pick a task on the left, change it on the right.', ['SC-21e'],
      'The Figma has one table with every row editable at once; the build is a list with one editor beside it (ADR-0140 d.1: one editor for every detail, wherever it is met).')
    await w.act('Edit all tasks', async () => {
      await tl.getByTestId('edit-all-tasks').click()
      await expect(tl.getByTestId('edit-all-list')).toBeVisible()
    })
    await w.shot(tl, 'sc21-edit-all')
    await w.act('close', async () => { await tl.getByTestId('edit-all-close').click(); await tl.keyboard.press('Escape').catch(() => {}) })

    w.begin(5, 'A started task asks before it moves', 'tl',
      'Dev Maker has started Creative Direction. Her lead moves its day in the pop-up: before anything is saved it asks “Dev has started this — move it anyway?”. She presses Move it. Remove is not offered on a started task.', ['m3'])
    await w.act('the maker starts her task (the Start button’s door, as her)', () => rpcAs('maker', 'sub_task_start', { p_id: t1.id }))
    const t1Booking = (await bookingsOf(t1.id))[0]!
    await w.act('open it and move it to Tuesday', async () => {
      await schedule(tl, weekOf)
      await tl.getByTestId(`booking-${t1Booking.id}`).click()
      await expect(tl.getByTestId('edit-task')).toBeVisible({ timeout: 15_000 })
      await tl.getByTestId('edit-task-dates').click()
      await pickOneDay(tl, 'edit-task-dates-picker', D2)
      await expect(tl.getByTestId('edit-task-started')).toBeVisible()
    })
    await w.check('no Remove on a started task', () => expect(tl.getByTestId('edit-task-no-remove')).toBeVisible())
    await tl.getByTestId('edit-task-move-anyway').scrollIntoViewIfNeeded()
    await w.shot(tl, 'm3')
    await w.act('Move it', async () => { await tl.getByTestId('edit-task-move-anyway').click() })
    await w.check('it moved to Tuesday, still hers', async () => {
      await expect.poll(async () => iraqDayOf((await taskRow(t1.id)).starts_at!)).toBe(D2)
      expect((await taskRow(t1.id)).assignee_id).toBe(await idOf('maker'))
    })
    await tl.keyboard.press('Escape').catch(() => {})

    // ===================================================================== 6. The other lead answers ====
    const cp = await as(browser, 'copytl')
    w.begin(6, 'The Copy lead’s My work', 'copytl', 'Dev Copy Lead opens My work. Asks from other teams come first, each with the time left to answer, with “Answer on your Schedule”, “Read the brief” and “Say no…”.', ['SC-28'])
    await w.act('open My work', async () => {
      await cp.goto('/my-work')
      await expect(cp.getByTestId(`my-work-ask-${askBooked?.id}`)).toBeVisible({ timeout: 25_000 })
    })
    await w.shot(cp, 'sc28')

    w.begin(6, 'Answer on the Schedule', 'copytl', '“Answer on your Schedule” opens the ask over her own team’s week: the note, the brief and files, who, the days and the hours. She books Dev Writer on the day asked.', ['SC-29'])
    await w.act('Answer on your Schedule', async () => {
      await cp.getByTestId(`my-work-ask-answer-${askBooked?.id}`).click()
      await expect(cp.getByTestId('answer-ask')).toBeVisible({ timeout: 25_000 })
      await cp.getByTestId('answer-ask-who').click()
      await cp.getByTestId(`answer-ask-who-list-${res.writer}`).click()
      await cp.getByTestId('answer-ask-from').fill(D3)
      await cp.getByTestId('answer-ask-to').fill(D3)
      await expect(cp.getByTestId('answer-ask-day-ok')).toBeVisible()
    })
    await w.shot(cp, 'sc29')
    await w.act('Book', async () => {
      await cp.getByTestId('answer-ask-book').click()
      await expect(cp.getByTestId('answer-ask')).toHaveCount(0, { timeout: 25_000 })
    })
    await w.check('Write Copy is now Dev Writer’s, booked', async () => {
      await expect.poll(async () => (await taskRow(t3.id)).assignee_id, { timeout: 20_000 }).toBe(await idOf('writer'))
    })
    await w.act('offer another day on the reel’s ask; say no to the banner’s, with a reason', async () => {
      await schedule(cp, weekOf)
      await cp.getByTestId(`ask-from-${askOffer}`).click()
      await cp.getByTestId('answer-ask-who').click()
      await cp.getByTestId(`answer-ask-who-list-${res.writer}`).click()
      await cp.getByTestId('answer-ask-from').fill(D4)
      await cp.getByTestId('answer-ask-to').fill(D4)
      await cp.getByTestId('answer-ask-offer').click()
      await expect(cp.getByTestId('answer-ask')).toHaveCount(0, { timeout: 25_000 })
      await cp.getByTestId(`ask-from-${askNo}`).click()
      await cp.getByTestId('answer-ask-no').click()
      await cp.getByTestId('answer-ask-reason').fill('Copy is full on Harbour Line this week.')
      await cp.getByTestId('answer-ask-no-send').click()
      await expect(cp.getByTestId('answer-ask')).toHaveCount(0, { timeout: 25_000 })
    })

    w.begin(6, 'The answers come back', 'tl', 'Back on Dev Team Lead’s Schedule, each answer is a card under “Asked of other teams”: booked (OK), an offer of another day (Take it / Ask again), and a no with the reason (Ask another team / Do it in your team).', ['SC-30'])
    await w.act('open the Schedule', () => schedule(tl, weekOf))
    await w.check('three answers: booked, offer, no', async () => {
      await expect(tl.getByTestId(`ask-sent-${askBooked?.id}`)).toBeVisible()
      await expect(tl.getByTestId(`ask-take-${askOffer}`)).toBeVisible()
      await expect(tl.getByTestId(`ask-other-${askNo}`)).toBeVisible()
    })
    await w.shot(tl, 'sc30', '', undefined, true)

    // ===================================================================== 7. The piece on the campaign page ====
    w.begin(7, 'The suggested list', 'tl', 'Dev Team Lead opens Post 3 from its campaign. Before she approves, the tasks are the workflow’s suggestion: no Who, no Dates — hours, names and the list itself are hers to shape.', ['CP-01'],
      'The piece’s format, language, hours and due day sit in a read-only strip with “Ask Dev Account Mgr to change it” (ADR-0141).')
    await w.act('open Post 3', () => panel(tl, P2))
    const q = (await tasksOf(P2.deliverableId)) as [T, T, T, T]
    await w.check('no Who before approval', () => expect(tl.getByTestId(`piece-panel-tasks-who-${q[0].id}`)).toHaveCount(0))
    await w.shot(tl, 'cp01')

    w.begin(7, 'Change the suggestion', 'tl', 'She renames the first task, gives each its hours, and removes one — a line offers Undo for a few seconds.', ['CP-02'],
      'The walk pressed Undo afterwards to keep the task (the frame leaves it removed).')
    await w.act('rename, hours, remove', async () => {
      await tl.getByTestId(`piece-panel-tasks-rename-${q[0].id}`).click()
      await tl.getByTestId(`piece-panel-tasks-name-${q[0].id}`).fill('Creative direction — summer range visual')
      await tl.getByTestId(`piece-panel-tasks-name-${q[0].id}`).press('Enter')
      await expect.poll(async () => (await taskRow(q[0].id)).title).toBe('Creative direction — summer range visual')
      for (const [t, h] of [[q[0], 1], [q[1], 4], [q[2], 2], [q[3], 6]] as const) {
        await hoursTo(tl, 'piece-panel-tasks', t.id, h)
        await expect.poll(async () => Number((await taskRow(t.id)).sla_hours)).toBe(h)
      }
      await tl.getByTestId(`piece-panel-tasks-remove-${q[3].id}`).click()
      await expect(tl.getByTestId('piece-panel-tasks-undo')).toBeVisible()
    })
    await w.shot(tl, 'cp02')
    await w.act('Undo', async () => {
      await tl.getByTestId('piece-panel-tasks-undo-button').click()
      await expect(tl.getByTestId(`piece-panel-tasks-row-${q[3].id}`)).toBeVisible()
    })

    w.begin(7, 'Add a task of her own', 'tl', '“+ Add a task” takes a name of at least three letters.', ['CP-03'])
    await w.act('add “Motion version — 6s loop”', async () => {
      await tl.getByTestId('piece-panel-tasks-add').click()
      await tl.getByTestId('piece-panel-tasks-add-name').fill('Motion version — 6s loop')
    })
    await w.shot(tl, 'cp03')
    let own = ''
    await w.act('Add', async () => {
      await tl.getByTestId('piece-panel-tasks-add-save').click()
      await expect.poll(async () => (await rows<{ id: string }>('sub_tasks', `select=id&deliverable_id=eq.${P2.deliverableId}&title=eq.${encodeURIComponent('Motion version — 6s loop')}`)).length).toBe(1)
      own = (await rows<{ id: string }>('sub_tasks', `select=id&deliverable_id=eq.${P2.deliverableId}&title=eq.${encodeURIComponent('Motion version — 6s loop')}`))[0]!.id
      await hoursTo(tl, 'piece-panel-tasks', own, 3)
    })
    await w.act('Approve the list', async () => {
      await tl.getByTestId('piece-panel-tasks-approve').click()
      await closeCampaignBanner(tl)
      await expect(tl.getByTestId('piece-panel-tasks-open-schedule')).toBeVisible()
    })

    const amOnP2 = await as(browser, 'am')
    w.begin(7, 'The same list, seen by the account manager', 'am',
      'Dev Account Mgr opens the same approved list and Who on a row. Every person she picks becomes an ask to that person’s team lead — the list says so.', ['m4'])
    await w.act('open Post 3; Who on Develop Concept', async () => {
      await panel(amOnP2, P2)
      await amOnP2.getByTestId(`piece-panel-tasks-who-${q[1].id}`).click()
      await expect(amOnP2.getByTestId('piece-panel-tasks-who-pop')).toBeVisible()
    })
    await w.shot(amOnP2, 'm4-am')
    await amOnP2.keyboard.press('Escape')

    w.begin(7, 'Approved: pick who and the dates on the piece', 'tl', 'Back with Dev Team Lead: once approved, each row has Who and Dates — the same pickers as the Schedule, her team with their free hours and “Ask another team…”.', ['CP-04'])
    await w.act('open Who on Develop Concept', async () => {
      await panel(tl, P2)
      await tl.getByTestId(`piece-panel-tasks-who-${q[1].id}`).click()
      await expect(tl.getByTestId('piece-panel-tasks-who-pop')).toBeVisible()
    })
    await w.shot(tl, 'cp04')

    w.begin(7, 'All booked; Write Copy asked of Copy', 'tl',
      'She books herself, Dev Maker and Dev Deputy Lead on their rows, picks who checks the work, and asks the Copy team for Write Copy. Each row carries a pencil (Edit) beside the ✕.', ['CP-05', 'm4'])
    let askWaiting = ''
    await w.act('reviewer, then the Copy ask, then the rows, Save', async () => {
      await tl.getByTestId(`piece-panel-tasks-who-${q[1].id}`).click()
      await tl.getByTestId(`piece-panel-tasks-people-${res.maker}`).click()
      await tl.getByTestId(`piece-panel-tasks-dates-${q[1].id}`).click()
      await pickOneDay(tl, 'piece-panel-tasks-dates-picker', D3)
      await tl.getByTestId(`piece-panel-tasks-who-${q[0].id}`).click()
      await tl.getByTestId(`piece-panel-tasks-people-${res.tl}`).click()
      await tl.getByTestId(`piece-panel-tasks-dates-${q[0].id}`).click()
      await pickOneDay(tl, 'piece-panel-tasks-dates-picker', D2)
      await tl.getByTestId(`piece-panel-tasks-who-${q[3].id}`).click()
      await tl.getByTestId(`piece-panel-tasks-people-${res.maker}`).click()
      await tl.getByTestId(`piece-panel-tasks-dates-${q[3].id}`).click()
      await pickOneDay(tl, 'piece-panel-tasks-dates-picker', D4)
      await tl.getByTestId(`piece-panel-tasks-who-${own}`).click()
      await tl.getByTestId(`piece-panel-tasks-people-${res.deputy}`).click()
      await tl.getByTestId(`piece-panel-tasks-dates-${own}`).click()
      await pickOneDay(tl, 'piece-panel-tasks-dates-picker', D4)
      await tl.getByTestId('piece-panel-tasks-reviewer-line').click()
      await tl.getByTestId('piece-panel-tasks-reviewer').selectOption(await idOf('lead'))
      await tl.getByTestId('piece-panel-tasks-save').click()
      await closeCampaignBanner(tl)
      await rpcAs('tl', 'save_sub_task', { p_sub_task: q[2].id, p_deliverable: P2.deliverableId, p_title: q[2].title, p_reviewers: [{ user_id: await idOf('lead'), is_mandatory: true }] })
      await panel(tl, P2)
      await tl.getByTestId(`piece-panel-tasks-who-${q[2].id}`).click()
      await tl.getByTestId('piece-panel-tasks-people-ask-other').click()
      await tl.getByTestId('piece-panel-tasks-people-ask-team').selectOption(COPY_TEAM)
      await tl.getByTestId('piece-panel-tasks-people-ask-anyone').click()
      await closeCampaignBanner(tl)
      await expect(tl.getByTestId(`piece-panel-tasks-asked-${q[2].id}`)).toBeVisible()
      askWaiting = (await requestsOn(q[2].id))[0]!.id
    })
    await w.check('four booked, one asked', async () => {
      for (const t of [q[0], q[1], q[3]]) await expect.poll(async () => (await taskRow(t.id)).assignee_id).not.toBeNull()
      expect((await requestsOn(q[2].id))[0]!.status).toBe('pending')
    })
    await w.shot(tl, 'cp05')
    await w.shot(tl, 'cp05-list', 'The task list — four booked, Write Copy asked of Copy, Edit and ✕ on each row', tl.getByTestId('piece-panel-tasks'))

    // CP-10..12 — Post 3's sibling: the story set
    await approveTaskList(tl, P3)
    const s = await tasksOf(P3.deliverableId)
    w.begin(7, 'Tick the tasks', 'tl', 'On the story set, approved, she sets the hours and ticks every row: the dark bar offers to give them to one person on one day.', ['CP-10'])
    await w.act('hours; tick all', async () => {
      await panel(tl, P3)
      // Every task gets its hours: a task with none cannot be assigned (`hours_required`) — five since the translation task (I74.36).
      for (const [i, h] of [[0, 2], [1, 3], [2, 1], [3, 2], [4, 1]] as const) if (s[i]) await hoursTo(tl, 'piece-panel-tasks', s[i]!.id, h)
      await tl.getByTestId('piece-panel-tasks-select-all').check()
      await expect(tl.getByTestId('piece-panel-tasks-bulk')).toBeVisible()
    })
    await w.shot(tl, 'cp10')
    w.begin(7, 'Give them to one person', 'tl', '“Pick a person” on the bar: her team with the hours free.', ['CP-11'])
    await w.act('open Pick a person', async () => {
      await tl.getByTestId('piece-panel-tasks-bulk-who').click()
      await expect(tl.getByTestId('piece-panel-tasks-bulk-who-pop')).toBeVisible()
    })
    await w.shot(tl, 'cp11')
    w.begin(7, 'Applied — one day, the hours checked', 'tl', 'Dev Deputy Lead on Wednesday, Apply: every row takes her, and the line under them checks the day’s hours.', ['CP-12'])
    await w.act('Dev Deputy Lead, Wednesday, Apply', async () => {
      await tl.getByTestId(`piece-panel-tasks-bulk-people-${res.deputy}`).click()
      await tl.getByTestId('piece-panel-tasks-bulk-day').click()
      await tl.getByTestId(`piece-panel-tasks-bulk-day-picker-day-${D3}`).click()
      await tl.getByTestId('piece-panel-tasks-bulk-apply').click()
      await expect(tl.getByTestId('piece-panel-tasks-bulk-line')).toBeVisible()
    })
    await w.shot(tl, 'cp12')
    await w.act('choose the reviewer and Save', async () => {
      await tl.getByTestId('piece-panel-tasks-reviewer').selectOption(await idOf('lead'))
      await tl.getByTestId('piece-panel-tasks-save').click()
      await closeCampaignBanner(tl)
    })
    await w.check('every task of the story set is Dev Deputy Lead’s', async () => {
      for (const t of s) await expect.poll(async () => (await taskRow(t.id)).assignee_id).toBe(await idOf('deputy'))
    })

    // ===================================================================== 8. Ask the account manager ====
    w.begin(8, 'The owner reads the piece; the account manager edits it', 'tl',
      'Dev Team Lead owns Post 3, but its format, language, hours and due day are read only for her, with “Ask Dev Account Mgr to change it”.', ['m6'])
    await w.act('open Post 3', () => panel(tl, P2))
    await w.check('read-only strip, no fields', async () => {
      await expect(tl.getByTestId('piece-panel-ask-strip')).toBeVisible()
      await expect(tl.getByTestId('piece-panel-due')).toHaveCount(0)
    })
    await w.shot(tl, 'm6-owner', 'The owner’s view')
    await w.act('the account manager opens the same piece', () => panel(amOnP2, P2))
    await w.check('her fields are editable, no Ask', async () => {
      await expect(amOnP2.getByTestId('piece-panel-due')).toBeVisible()
      await expect(amOnP2.getByTestId('piece-panel-ask-ask')).toHaveCount(0)
    })
    await w.shot(amOnP2, 'm6-am', 'The account manager’s view of the same piece')

    w.begin(8, 'Ask the account manager to change it', 'tl', 'She presses “Ask Dev Account Mgr to change it”: what isn’t right, the new values, and why. Nothing changes until the account manager answers.', ['CP-06'])
    await w.act('fill the form: hours and due date', async () => {
      await tl.getByTestId('piece-panel-ask-ask').click()
      await expect(tl.getByTestId('piece-panel-ask-form')).toBeVisible()
      await tl.getByTestId('piece-panel-ask-form-kind-hours').click()
      await tl.getByTestId('piece-panel-ask-form-kind-due_date').click()
      await tl.getByTestId('piece-panel-ask-form-hours').fill('16')
      await tl.getByTestId('piece-panel-ask-form-due').fill(D[11]!)
      await tl.getByTestId('piece-panel-ask-form-reason').fill('Five frames in two languages is closer to 16 hours, and the motion loop is new.')
    })
    await w.shot(tl, 'cp06')
    await w.act('Send', async () => {
      await tl.getByTestId('piece-panel-ask-form-send').click()
      await expect(tl.getByTestId('piece-panel-ask-form')).toHaveCount(0)
    })

    w.begin(8, 'Waiting on the account manager', 'tl', 'The piece shows the ask waiting, with what was asked; her booked tasks keep their dates. She can withdraw it.', ['CP-07'])
    await w.check('waiting', () => expect(tl.getByTestId('piece-panel-ask-waiting')).toBeVisible())
    await w.shot(tl, 'cp07')

    w.begin(8, 'The account manager answers', 'am', 'Dev Account Mgr opens the piece, reads the ask, and answers: accept, change it, or keep it as it is. She accepts.', ['m5'],
      'Mock-up 5’s left half (the form opened from a drag) is shown in step 8.7; this is the account manager’s side.')
    await w.act('See the ask → Answer → Accept', async () => {
      await panel(amOnP2, P2)
      await amOnP2.getByTestId('piece-panel-ask-see').click()
      await amOnP2.getByTestId('piece-panel-ask-answer').click()
      await expect(amOnP2.getByTestId('piece-panel-ask-answer-dialog')).toBeVisible()
      await amOnP2.getByTestId('piece-panel-ask-answer-dialog-mode-accept').click()
      await amOnP2.getByTestId('piece-panel-ask-answer-dialog-note').fill('Agreed with the client: 16 hours is fine, and the later day.')
    })
    await w.shot(amOnP2, 'am-answer')
    await w.act('Send', async () => {
      await amOnP2.getByTestId('piece-panel-ask-answer-dialog-submit').click()
      await expect(amOnP2.getByTestId('piece-panel-ask-answer-dialog')).toHaveCount(0)
    })

    w.begin(8, 'Accepted', 'tl', 'Dev Team Lead sees the answer on the piece: accepted, the new hours and day, and who was told.', ['CP-08'])
    await w.act('open Post 3', () => panel(tl, P2))
    await w.check('accepted', () => expect(tl.getByTestId('piece-panel-ask-answered')).toHaveAttribute('data-status', 'accepted', { timeout: 20_000 }))
    await w.shot(tl, 'cp08')
    await w.act('OK', () => tl.getByTestId('piece-panel-ask-ok').click())

    w.begin(8, 'Kept as it is', 'tl', 'She asks again — Arabic first. Dev Account Mgr keeps it as it is, with her reason; Dev Team Lead reads it on the piece, with Reply.', ['CP-09'])
    await w.act('ask (language), the account manager keeps it', async () => {
      await tl.getByTestId('piece-panel-ask-ask').click()
      await tl.getByTestId('piece-panel-ask-form-kind-language').click()
      await tl.getByTestId('piece-panel-ask-form-reason').fill('The client reads Arabic first; can the English follow?')
      await tl.getByTestId('piece-panel-ask-form-send').click()
      await expect(tl.getByTestId('piece-panel-ask-waiting')).toBeVisible()
      await panel(amOnP2, P2)
      await amOnP2.getByTestId('piece-panel-ask-answer').click()
      await amOnP2.getByTestId('piece-panel-ask-answer-dialog-mode-keep').click()
      await amOnP2.getByTestId('piece-panel-ask-answer-dialog-note').fill('The client signed the English off on Thursday — keep both as they are.')
      await amOnP2.getByTestId('piece-panel-ask-answer-dialog-submit').click()
      await expect(amOnP2.getByTestId('piece-panel-ask-answer-dialog')).toHaveCount(0)
      await panel(tl, P2)
      await expect(tl.getByTestId('piece-panel-ask-answered')).toHaveAttribute('data-status', 'kept', { timeout: 20_000 })
    })
    await w.shot(tl, 'cp09')

    w.begin(8, 'The same form, from a drag past the due date', 'tl',
      'On the Schedule she drags Dev Maker’s banner artwork from Monday to Thursday — past the banner’s due day (Wednesday). The warning offers to ask the account manager; the form opens filled in with Thursday.', ['m5'],
      'The walk pressed Cancel on the form (its Send is walked from the piece above).')
    const p4t3Booking = (await bookingsOf(p4[3]!.id))[0]!
    await w.act('drag Monday → Thursday; ask', async () => {
      await schedule(tl, weekOf)
      const dt = await tl.evaluateHandle(() => new DataTransfer())
      await tl.getByTestId(`booking-${p4t3Booking.id}`).dispatchEvent('dragstart', { dataTransfer: dt })
      const cell = tl.getByTestId(`cell-${res.maker}-${D4}`)
      await cell.dispatchEvent('dragover', { dataTransfer: dt })
      await cell.dispatchEvent('drop', { dataTransfer: dt })
      await expect(tl.getByTestId('drop-warning-extension')).toBeVisible({ timeout: 15_000 })
    })
    await w.shot(tl, 'm5-warning', 'The drop warning')
    await w.act('Ask the account manager', async () => {
      await tl.getByTestId('drop-warning-extension').click()
      await expect(tl.getByTestId('schedule-change-ask')).toBeVisible()
      await expect(tl.getByTestId('schedule-change-ask-moved')).toBeVisible()
    })
    await w.shot(tl, 'm5-form', 'The one change form, filled in from the drag')
    await w.act('Cancel', async () => { await tl.getByTestId('schedule-change-ask-cancel').click(); await expect(tl.getByTestId('schedule-change-ask')).toHaveCount(0) })

    // ===================================================================== 6 (cont.). After 4 hours — STAGED ====
    w.begin(6, 'Unanswered after 4 working hours', 'traffic',
      'The Copy ask on Post 3 has not been answered. After 4 working hours it is put before Traffic and the Content department lead as well; the first to act settles it. Dev Traffic sees it on the Schedule, marked unanswered.', ['m2'], null,
      'STAGED: the ask’s asked-at time was set back a week through the service role, and the escalation sweep (a timer on production; not running locally) was run once for this piece. Everything shown after that is the product’s own.')
    await w.act('set the ask back and run the sweep (service role)', async () => {
      const back = await attemptWrite('PATCH', 'sub_task_assignment_requests', `id=eq.${askWaiting}`, { created_at: new Date(Date.now() - 7 * 86_400_000).toISOString() })
      expect(back.status, back.text).toBeLessThan(300)
      const r = await fetch(`${API}/rest/v1/rpc/run_escalation_sweep_for`, {
        method: 'POST', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ p_deliverable: P2.deliverableId }),
      })
      expect(r.status, await r.text()).toBeLessThan(300)
      await expect.poll(async () => (await rows<{ escalated_at: string | null }>('sub_task_assignment_requests', `select=escalated_at&id=eq.${askWaiting}`))[0]!.escalated_at).not.toBeNull()
    })
    const tr = await as(browser, 'traffic')
    await w.act('Traffic opens the Schedule', async () => {
      await schedule(tr, weekOf)
      await expect(tr.getByTestId(`ask-from-${askWaiting}`)).toBeVisible({ timeout: 20_000 })
      await tr.getByTestId(`ask-from-${askWaiting}`).click()
      await expect(tr.getByTestId('answer-ask')).toBeVisible()
    })
    await w.check('marked unanswered', () => expect(tr.getByTestId('answer-ask-unanswered')).toBeVisible())
    await w.shot(tr, 'm2-traffic', 'Dev Traffic')
    const ct = await as(browser, 'content')
    await w.act('the Content department lead opens his Schedule', async () => {
      await schedule(ct, weekOf)
      await expect(ct.getByTestId(`ask-from-${askWaiting}`)).toBeVisible({ timeout: 20_000 })
    })
    await w.shot(ct, 'm2-content', 'Dev Content Lead (department lead)')

    // ===================================================================== 9. Re-open ====
    w.begin(9, 'Re-open a delivered piece as a client amendment', 'tl',
      'The key-visual piece was approved. The client asks for a change: Dev Team Lead opens it from the campaign and presses Re-open — why (client amendment or our own fix), which task, what the client asked, the new day, the hours. It goes back to the person who made it.', ['m7'])
    await w.act('open the piece; Re-open; fill it', async () => {
      await tl.goto(`/campaigns/${P6.campaignId}`)
      await tl.getByTestId('campaign-tab-grid').click()
      await tl.getByTestId(`campaign-deliverable-open-${P6.deliverableId}`).click()
      await expect(tl.getByTestId('piece-drawer')).toBeVisible({ timeout: 20_000 })
      await tl.getByTestId('piece-drawer-reopen').click()
      await expect(tl.getByTestId('reopen-dialog')).toBeVisible()
      await tl.getByTestId('reopen-dialog-kind-client_amendment').click()
      await tl.getByTestId(`reopen-dialog-task-${p6[3]!.id}`).check()
      await tl.getByTestId('reopen-dialog-reason').fill('The client wants the bottle bigger and the price frame swapped for the new offer.')
      await tl.getByTestId('reopen-dialog-due').fill(D[13]!)
      await tl.getByTestId('reopen-dialog-hours').fill('3')
      await expect(tl.getByTestId('reopen-dialog-who')).toBeVisible()
    })
    await w.shot(tl, 'm7-dialog')
    await w.act('Re-open', async () => {
      await tl.getByTestId('reopen-dialog-submit').click()
      await closeCampaignBanner(tl)
    })
    await w.check('back to Dev Maker, counted as a client amendment', async () => {
      await expect.poll(async () => (await taskRow(p6[3]!.id)).status).toBe('todo')
      expect((await taskRow(p6[3]!.id)).assignee_id).toBe(await idOf('maker'))
      const [r] = await rows<{ kind: string }>('sub_task_reopenings', `select=kind&sub_task_id=eq.${p6[3]!.id}`)
      expect(r!.kind).toBe('client_amendment')
    })
    w.begin(9, 'Counted: “Amend 1”', 'tl', 'The piece now reads “Amend 1”; the campaign counts the month’s amendments.', ['m7'])
    await w.act('open the campaign and the piece again', async () => {
      await tl.goto(`/campaigns/${P6.campaignId}`)
      await expect(tl.getByText(/amendments? this month/)).toBeVisible({ timeout: 20_000 })
      await tl.getByTestId('campaign-tab-grid').click()
      await tl.getByTestId(`campaign-deliverable-open-${P6.deliverableId}`).click()
      await expect(tl.getByTestId('piece-drawer-amend')).toHaveText('Amend 1')
    })
    await w.shot(tl, 'm7-amend')
    w.begin(9, 'The account manager sees the client’s month', 'am', 'On the client’s page, Dev Account Mgr sees the amendments this month and their hours.', ['m7'])
    const [{ client_id }] = await rows<{ client_id: string }>('campaigns', `select=client_id&id=eq.${P6.campaignId}`)
    await w.act('open Northwind Beverages', async () => {
      await am.goto(`/clients/${client_id}`)
      await expect(am.getByTestId('client-page')).toContainText(/amendments? this month/, { timeout: 20_000 })
    })
    await w.shot(am, 'm7-client')

    // ===================================================================== 10. Block time ====
    w.begin(10, 'Block time on someone’s week', 'tl', '“+ Block time” under the asks: Leave or Internal work, who (her own team), the days. Dev Deputy Lead is off on Thursday.', ['SC-22', 'm8'],
      '“Amend on delivered work” is gone — an amend re-opens the task instead (ADR-0142 d.4). Who and the dates are the Schedule’s own pickers (I74.27): one dates box for the span, as on a task’s Edit.')
    await w.act('open Block time; Leave; Dev Deputy Lead; Thursday', async () => {
      await schedule(tl, weekOf)
      await tl.getByTestId('block-time-open').click()
      await expect(tl.getByTestId('block-time')).toBeVisible()
      await tl.getByTestId('block-time-leave').click()
      await blockTimeFill(tl, res.deputy, D4)
    })
    await w.shot(tl, 'sc22')
    await w.act('Save', async () => {
      await tl.getByTestId('block-time-save').click()
      await expect(tl.getByTestId('block-time')).toHaveCount(0)
    })
    await w.act('the Schedule again', () => schedule(tl, weekOf))
    await w.check('Thursday reads On leave for Dev Deputy Lead', () => expect(tl.getByTestId(`cell-${res.deputy}-${D4}`)).toContainText('On leave'))
    await w.shot(tl, 'sc22-after', 'The grid after: Thursday is leave for Dev Deputy Lead')
    const leave = (await rows<{ id: string }>('resource_unavailability', `select=id&resource_id=eq.${res.deputy}&kind=eq.leave`))[0]
    w.begin(10, 'It is on the Leave page too', 'admin', 'The leave is the same record the Leave page reads — no second step.', ['m8'])
    const ad = await as(browser, 'admin')
    await w.act('open the Leave page', async () => {
      await ad.goto('/people/leave')
      await expect(ad.getByTestId(`leave-row-${leave?.id}`)).toBeVisible({ timeout: 20_000 })
    })
    await w.shot(ad, 'm8-leave')

    // ===================================================================== 11. More time — the answer ====
    w.begin(11, 'Her lead gives it — past the piece’s due day', 'tl',
      'Dev Team Lead presses “Give …” on Dev Maker’s ask. The day runs past the banner piece’s own due date, so the one change form to the account manager opens, already filled in.', ['m9'])
    await w.act('Give', async () => {
      await schedule(tl, weekOf)
      await tl.getByTestId(`time-ask-give-${timeAsk?.id}`).click()
      await expect(tl.getByTestId('time-ask-change')).toBeVisible({ timeout: 15_000 })
    })
    await w.shot(tl, 'm9-change')
    await w.act('Send', async () => {
      await tl.getByTestId('time-ask-change-reason').fill('Dev Maker needs Thursday for the new product shots.')
      await tl.getByTestId('time-ask-change-send').click()
      await expect(tl.getByTestId('time-ask-change')).toHaveCount(0)
    })
    await w.check('the task’s day moved; an ask waits on the account manager', async () => {
      await expect.poll(async () => iraqDayOf((await taskRow(p4[1]!.id)).due_at!)).toBe(D4)
      const asks = await rows<{ status: string }>('deliverable_change_asks', `select=status&deliverable_id=eq.${P4.deliverableId}&status=eq.pending`)
      expect(asks.length).toBe(1)
    })

    // ===================================================================== 12. Refused ====
    w.begin(12, 'A team member reads the piece — nothing to change', 'maker', 'Dev Maker opens Post 3. She reads it — each task with who has it — with no Who, no pencil, no ✕, no ticks.', [])
    await w.act('open Post 3', async () => {
      await mk.goto(`/campaigns/${P2.campaignId}?piece=${P2.deliverableId}`)
      await expect(mk.getByTestId('piece-drawer')).toBeVisible({ timeout: 20_000 })
    })
    await w.check('no editing controls', async () => {
      for (const tid of ['piece-panel', 'piece-panel-tasks', `piece-panel-tasks-who-${q[0].id}`, `piece-panel-tasks-edit-${q[0].id}`, 'piece-panel-tasks-select-all']) await expect(mk.getByTestId(tid)).toHaveCount(0)
    })
    await w.shot(mk, 'refused-maker-piece')

    w.begin(12, 'The account manager books nobody — her pick is an ask', 'am', 'Dev Account Mgr opens the booking window for the reel and Who: the list says every pick is sent to that person’s team lead.', [])
    await w.act('pick the reel; click a day; open Who', async () => {
      await schedule(am, weekOf)
      await am.getByTestId(`to-book-${P5.deliverableId}`).click()
      const [first] = await tasksOf(P5.deliverableId)
      const cells = am.locator('[data-testid^="cell-"]')
      await cells.first().click({ position: { x: 4, y: 4 } })
      await expect(am.getByTestId(`book-row-${first!.id}`)).toBeVisible({ timeout: 15_000 })
      await am.getByTestId(`book-who-${first!.id}`).click()
      await expect(am.getByTestId('book-who-list-ask-only')).toBeVisible()
    })
    await w.shot(am, 'refused-am-asks')
    await am.keyboard.press('Escape')

    w.begin(12, 'A team member’s Schedule opens on Everyone, with no Block time', 'maker', 'Dev Maker books nobody, so her Schedule offers no “Your team” tab and opens on “Everyone” (Edward, 4 Oct, I74.30) — with no “Block time” and no To book.', [])
    await w.act('open her Schedule', async () => {
      await mk.goto('/schedule')
      await expect(mk.getByTestId('surface-schedule')).toBeVisible({ timeout: 20_000 })
    })
    await w.check('no “Your team” tab; “Everyone” is selected', async () => {
      await expect(mk.getByTestId('view-team')).toHaveCount(0)
      await expect(mk.getByTestId('view-master')).toHaveAttribute('aria-selected', 'true')
    })
    await w.check('no Block time', () => expect(mk.getByTestId('block-time-open')).toHaveCount(0))
    await w.shot(mk, 'refused-maker-schedule', 'Her Schedule opens on “Everyone”')

    // ===================================================================== the report ====
    writeFileSync(path.join(OUT, 'REPORT.html'), await render(w, scratch))
    expect(w.failures(), 'every check passed — read report.json').toBe(0)
  })
})

// ------------------------------------------------------------------------------ render ----

/** Every frame, its verdict against the built screen — written after reading both side by side. */
const VERDICT: Record<string, { s: 'Matches' | 'Differs' | 'Not built'; why?: string }> = {
  'SC-01': { s: 'Differs', why: 'the older view switch and filter row stay above the grid; Friday and Saturday show as narrow closed columns; pieces read 0h because this workflow gives its tasks no hours' },
  'SC-03': { s: 'Differs', why: 'adds “Reviewers” (who checks the work, chosen with the existing picker — Edward, 3 Oct, I74.22); hours start at none' },
  'SC-07': { s: 'Matches', why: 'shows the brief’s own fields — this single job’s brief is short' },
  'SC-08': { s: 'Differs', why: '“From the brief” and “From the Library” appear only when they hold files; this piece has none' },
  'SC-09': { s: 'Differs', why: 'files and links go to the deliverable’s own Library folder (ADR-0134 d.22), not Working files; the owner’s link goes in at the first press (fixed 4 Oct, I74.28 — no longer a defect)' },
  'SC-11': { s: 'Differs', why: 'only “Something else…”: every workflow step is already on the piece' },
  'SC-17': { s: 'Differs', why: 'the reviewers row is extra (I74.22)' },
  'SC-18': { s: 'Differs', why: 'the piece stays in To book while its Copy task waits; the note names who is told — the account manager is not' },
  'SC-21e': { s: 'Differs', why: 'a list with one editor beside it instead of one table editable all at once (ADR-0140 d.1); removal is asked in the task’s pop-up' },
  'SC-22': { s: 'Differs', why: 'no “Amend on delivered work” (ADR-0142 d.4); one dates box for the span, as on a task’s Edit (I74.27)' },
  'SC-23': { s: 'Differs', why: 'a task’s booking opens the task’s own pop-up, every detail editable (ADR-0140 d.1), not the frame’s booking form' },
  'SC-24': { s: 'Differs', why: 'the person and their lead are told, not the account manager (Edward, 3 Oct — ADR-0140 d.5)' },
  'SC-26': { s: 'Differs', why: 'every detail editable (name, notes, hours, who, days, waits for, reviewers, review) — ADR-0140 d.1' },
  'SC-27': { s: 'Differs', why: 'removing a booked task is asked inline in its pop-up rather than inside Edit all tasks; a started task shows no Remove (step 5.6)' },
  'SC-28': { s: 'Differs', why: 'My work keeps its own top tiles (assigned, overdue …) instead of the frame’s four; the ask cards match' },
  'CP-05': { s: 'Differs', why: 'the deliverable opens in a side panel over the campaign page (as CP-01), not a centred window; the asked row reads “Asked Copy”, with the Copy team in Who' },
  'CP-01': { s: 'Differs', why: 'the piece opens in a side panel over the campaign page, not a centred window; the deliverable is a read-only strip with “Ask … to change it”' },
  'm5': { s: 'Differs', why: 'the drag first shows the late-drop warning, whose “Ask the account manager to change the due date” opens the form' },
  'm8': { s: 'Differs', why: 'Who and the dates are browser boxes (I74.27, open)' },
}

async function frameJpeg(page: Page, key: string): Promise<string> {
  const png = path.join(FRAMES, `${key}.png`)
  if (!existsSync(png)) return ''
  await page.setViewportSize({ width: 1600, height: 1200 })
  await page.setContent(`<body style="margin:0;background:#fff"><img id="i" src="data:image/png;base64,${readFileSync(png).toString('base64')}"></body>`)
  await page.locator('#i').waitFor()
  const buf = await page.locator('#i').screenshot({ type: 'jpeg', quality: 70 })
  return `data:image/jpeg;base64,${buf.toString('base64')}`
}

async function render(w: Walk, page: Page): Promise<string> {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const shot = (f: string) => `data:image/jpeg;base64,${readFileSync(path.join(OUT, f)).toString('base64')}`
  const frameSrc = new Map<string, string>()
  for (const s of w.steps) for (const k of s.frames) if (!frameSrc.has(k)) frameSrc.set(k, await frameJpeg(page, k))
  let pass = 0, fail = 0
  for (const s of w.steps) for (const c of s.checks) { if (c.ok) pass++; else fail++ }
  const pairs = w.steps.reduce((n, s) => n + Math.min(s.frames.length, s.shots.length), 0)
  const o: string[] = []
  o.push(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Schedule rework review</title><style>
:root{--bg:#fff;--fg:#1d1d1f;--muted:#5b5b66;--line:#e6e6ea;--card:#f7f7f9;--ok:#1a7f37;--bad:#b42318;--warn-bg:#fff6e0;--warn-line:#d99b0a;--diff-bg:#eef3ff;--diff-line:#3b6fd8;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#15161a;--fg:#ececf1;--muted:#a3a3ad;--line:#2c2d34;--card:#1d1e23;--ok:#4ac26b;--bad:#ff7b72;--warn-bg:#2d2414;--warn-line:#d99b0a;--diff-bg:#17213a;--diff-line:#6b9bff}}
:root[data-theme="dark"]{--bg:#15161a;--fg:#ececf1;--muted:#a3a3ad;--line:#2c2d34;--card:#1d1e23;--ok:#4ac26b;--bad:#ff7b72;--warn-bg:#2d2414;--warn-line:#d99b0a;--diff-bg:#17213a;--diff-line:#6b9bff}
body{font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;max-width:1500px;margin:0 auto;padding:32px 24px;color:var(--fg);background:var(--bg)}
h1{font-size:28px;margin:0 0 8px}h2{margin-top:56px;border-top:1px solid var(--line);padding-top:24px}h3{margin:40px 0 4px}
.who{color:var(--muted);margin:0 0 8px}.does{margin:4px 0 12px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start;margin:8px 0}.pair figure{margin:0}
figcaption{font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}
img{max-width:100%;height:auto;border:1px solid var(--line);border-radius:8px;display:block}
.empty{border:1px dashed var(--line);border-radius:8px;padding:24px;color:var(--muted);font-size:13px}
.differs{background:var(--diff-bg);border-inline-start:3px solid var(--diff-line);padding:8px 12px;border-radius:6px;margin:10px 0}
.staged{background:var(--warn-bg);border-inline-start:3px solid var(--warn-line);padding:8px 12px;border-radius:6px;margin:10px 0}
table{border-collapse:collapse;width:100%;font-size:14px;margin:12px 0 24px}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:start;vertical-align:top}th{background:var(--card)}
.ok{color:var(--ok)}.bad{color:var(--bad)}.tally{font-size:17px;font-weight:600}
details summary{cursor:pointer;font-weight:600;margin:6px 0}pre{background:var(--card);padding:8px;border-radius:6px;white-space:pre-wrap;font-size:12px}
ul.checks{font-size:13px;color:var(--muted);margin:6px 0 0}
a{color:var(--diff-line)}
@media (max-width:900px){.pair{grid-template-columns:1fr}body{padding:16px}table{font-size:13px}}
</style></head><body>`)
  o.push('<h1>The Schedule rework — Figma beside the build</h1>')
  o.push('<p>Every frame of Figma section L (the Schedule) and section N (a piece opened from its campaign), and the nine mock-ups drawn for decisions the Figma does not show, each beside the same screen in the finished build. Walked in a browser on the local stack, signed in as the person who would do each thing; every picture is the real state after the step. The people are the test accounts (“Dev …”); in the Figma they are Fadia (the lead booking — here Dev Team Lead), Zubaida (the maker — Dev Maker), Amira (the other team’s lead — Dev Copy Lead) and Inas (the account manager — Dev Account Mgr). Every test account’s first name is “Dev”, so where a screen uses a first name it reads “Dev decides”, “Ask Dev for more time”.</p>')
  for (const l of w.story) o.push(`<p>${esc(l)}</p>`)
  o.push(`<p class="tally">${w.steps.length} steps · ${pairs} Figma/build pairs · checks: <span class="ok">${pass} passed</span>, <span class="${fail ? 'bad' : 'ok'}">${fail} failed</span>.</p>`)

  // Summary table: every frame and its verdict.
  const where = new Map<string, string>()
  for (const s of w.steps) for (const k of s.frames) if (!where.has(k)) where.set(k, `${s.chapter}.${s.n}`)
  const ORDER = ['SC-01', 'SC-02', 'SC-02b', 'SC-03', 'SC-03b', 'SC-03c', 'SC-04', 'SC-05', 'SC-06', 'SC-07', 'SC-08', 'SC-09', 'SC-11', 'SC-12', 'SC-13', 'SC-14', 'SC-15', 'SC-16', 'SC-17', 'SC-18', 'SC-19', 'SC-20', 'SC-21n', 'SC-21e', 'SC-22', 'SC-23', 'SC-24', 'SC-26', 'SC-27', 'SC-28', 'SC-29', 'SC-30',
    'CP-01', 'CP-02', 'CP-03', 'CP-04', 'CP-05', 'CP-06', 'CP-07', 'CP-08', 'CP-09', 'CP-10', 'CP-11', 'CP-12', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9']
  o.push('<h2 id="summary">Every frame, at a glance</h2><table><thead><tr><th>Frame</th><th>Step</th><th>Verdict</th></tr></thead><tbody>')
  for (const k of ORDER) {
    const v = VERDICT[k] ?? { s: where.has(k) ? 'Matches' : 'Not built', why: where.has(k) ? undefined : 'not shot by the walk' }
    const step = where.get(k)
    o.push(`<tr><td>${esc(FRAME_LABEL(k))}</td><td>${step ? `<a href="#s${step.replace('.', '-')}">${step}</a>` : '—'}</td><td class="${v.s === 'Matches' ? 'ok' : v.s === 'Differs' ? '' : 'bad'}"><b>${v.s}</b>${v.why ? ` — ${esc(v.why)}` : ''}</td></tr>`)
  }
  o.push('</tbody></table>')
  o.push(REFUSALS_HTML)

  CHAPTERS.forEach((title, ci) => {
    const steps = w.steps.filter((s) => s.chapter === ci + 1)
    if (!steps.length) return
    o.push(`<h2 id="c${ci + 1}">${ci + 1} · ${esc(title)}</h2>`)
    for (const s of steps) {
      o.push(`<h3 id="s${s.chapter}-${s.n}">${s.chapter}.${s.n} ${esc(s.title)}</h3><p class="who">Signed in as <b>${esc(s.actor)}</b></p><p class="does">${esc(s.does)}</p>`)
      if (s.staged) o.push(`<p class="staged">${esc(s.staged)}</p>`)
      const n = Math.max(s.frames.length, s.shots.length)
      for (let i = 0; i < n; i++) {
        const k = s.frames[i]
        const sh = s.shots[i]
        const left = k ? (frameSrc.get(k) ? `<figure><figcaption>${k.startsWith('m') ? 'Drawn for the decisions, 3 Oct' : 'Figma'} · ${esc(FRAME_LABEL(k))}</figcaption><img src="${frameSrc.get(k)}" alt="Figma ${esc(k)}"></figure>` : `<div class="empty">Frame ${esc(k)} missing</div>`)
          : '<div class="empty">No frame — the build only</div>'
        const right = sh ? `<figure><figcaption>Built${sh.caption ? ` · ${esc(sh.caption)}` : ''}</figcaption><img src="${shot(sh.file)}" alt="built"></figure>` : '<div class="empty">No screenshot — see the checks below</div>'
        o.push(`<div class="pair">${left}${right}</div>`)
      }
      const differs = s.differs ?? s.frames.map((k) => VERDICT[k]).filter((v) => v?.s === 'Differs').map((v) => v!.why).join(' ')
      if (differs) o.push(`<p class="differs"><b>Differs:</b> ${esc(differs)}</p>`)
      const bad = s.checks.filter((c) => !c.ok)
      o.push(`<ul class="checks">${s.checks.map((c) => `<li class="${c.ok ? 'ok' : 'bad'}">${c.ok ? '✓' : '✗'} ${esc(c.title)}${c.ok ? '' : `<pre>${esc(c.detail ?? '')}</pre>`}</li>`).join('')}</ul>`)
      void bad
    }
  })
  o.push('</body></html>')
  return o.join('\n')
}

/** The refused cases the browser specs prove (e2e/local/coverage/*.spec.ts) — named, not screenshotted one by one. */
const REFUSALS_HTML = `<h2 id="refused">What is refused — proved by the browser tests</h2>
<p>Each of these is a browser test that tries the thing, sees it refused (or not offered), and checks the database did not change. Four of them are shown as a person sees them in section 12.</p>
<ul>
<li><b>Booking (schedule-booking.spec.ts)</b> — the account manager books nobody: her pick of a person is an ask to that person’s team lead, and the direct door asks too; a team lead’s Who never lists another team; a department lead’s never lists another department; a team lead cannot turn her own team into an ask (“book them directly”).</li>
<li><b>Asks (schedule-asks.spec.ts)</b> — another team’s lead, the department lead, the deputy while her leader is at work, and the asker herself may not answer an ask (“answered by the lead of the team asked”); a second answer is refused once the first settled it; only the asker takes an offer; saying no needs a reason; an ask for a task nobody checks is refused (reviewer required).</li>
<li><b>The task editor (task-editor.spec.ts)</b> — a started task cannot be removed (not offered, and the server says so); its days do not move without “Move it”; the owner’s move of another team’s days becomes an ask to their lead — nothing moves; saving a task is no back door to another team’s days.</li>
<li><b>The campaign page (campaign-assign.spec.ts)</b> — a team member sees the task list read-only and the server refuses her assignment; an ask from the panel for a task nobody checks is held until “Checked by” is picked.</li>
<li><b>Changing the deliverable (change-ask.spec.ts)</b> — the owner’s direct due-date, type and details edits are refused in the account manager’s name; a team member may not use the form (“ask your lead”); the account manager is not offered the ask (she changes it herself); another lead may not answer for her; the retired per-task extension is refused.</li>
<li><b>Re-open (reopen-amendment.spec.ts)</b> — another department’s lead and a team member are offered no Re-open and are refused (“outside your reach”); nothing re-opened, nothing counted.</li>
<li><b>Block time (block-time.spec.ts)</b> — a team lead cannot block time for another team’s person (the database refuses); a team member is not offered Block time and her own write is refused.</li>
<li><b>More time (more-time.spec.ts)</b> — another team’s lead is not shown the ask and is refused; the maker cannot answer her own; a person not on the task cannot ask.</li>
<li><b>Older windows (legacy-windows.spec.ts)</b> — a team member is not let onto the old Deliverables window; someone other than the asker is offered no Withdraw on an old booking’s request.</li>
</ul>`
