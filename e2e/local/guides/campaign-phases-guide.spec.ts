import { test, expect, type Browser, type Locator, type Page } from '@playwright/test'
import path from 'node:path'
import { authFile, PASSWORD, PEOPLE } from '../fixtures'
import { attemptWrite, rows, userIdOf } from '../helpers/db'
import { pieceIds, setPieceOwner, chooseLanguages } from '../helpers/campaign-wizard'

/**
 * The screenshots for guides 12 (a campaign with phases) and 13 (viewing and managing a campaign),
 * shot from ONE real walk on the local stack with real-world names — LUMA Season 2 for Luma
 * Retail, the campaign the team's own spreadsheet was built for (docs/reference/). Guides are test
 * artefacts: real states in every screenshot, every branch walked, re-shot when the flow changes.
 *
 * Rewritten 25 Sep (I57.32, I57.33) for the five-step wizard (phases on step 1, dates on step 4)
 * and the campaign page of section D (the views, the drawer, Edit; no department tabs, no rings).
 *
 * THE DATA IS MADE THROUGH THE PRODUCT, as the people who would make it: the account manager runs
 * the wizard; each owner approves their own task lists on the Grid; owners give tasks to makers
 * and makers start, submit and are approved through the RPCs the screens call, signed in as
 * themselves. Only the model's proposal is mocked (the network edge), so the pictures are the same
 * every run. Every step is a hard assertion — no "if it is there, shoot it" branches.
 *
 * Runs only with `GUIDE_SHOTS=1` (it writes into docs/guides/images/); skipped in the ordinary
 * suite. Re-runnable on a used database: a "LUMA Season 2" left by an earlier run is renamed out
 * of the way first (a fixture rewind, not the product — the name is unique per workspace).
 *
 *   GUIDE_SHOTS=1 npx playwright test -c playwright.local.config.ts e2e/local/guides
 */
const GUIDE_SHOTS = process.env.GUIDE_SHOTS === '1'
const IMAGES = path.resolve('docs/guides/images')
const NAME = 'LUMA Season 2'
const API = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
type Tag = keyof typeof PEOPLE

// ------------------------------------------------------------------------------ the browser ----

async function as(browser: Browser, tag: Tag): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag), viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()
  return page
}
/** Open a page in English. The language is remembered on the profile, so it is checked every time. */
async function go(page: Page, url: string) {
  await page.goto(url)
  await page.getByTestId('locale-toggle').first().waitFor({ state: 'visible', timeout: 20_000 })
  await page.waitForLoadState('networkidle').catch(() => {})
  if ((await page.locator('html').getAttribute('dir')) === 'rtl') {
    await page.getByTestId('locale-toggle').first().click()
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  }
}
async function shot(page: Page, name: string, opts: { full?: boolean; of?: Locator } = {}) {
  await page.addStyleTag({ content: '[data-testid="environment-bar"]{display:none!important}' })
  // The document does not scroll — `.shell-main` does (traps.md) — so a whole-page capture first
  // lets the document scroll, and puts the shell back afterwards.
  const full = opts.full
    ? await page.addStyleTag({ content: '.shell{block-size:auto!important;overflow:visible!important}.shell-main{overflow:visible!important}' })
    : null
  await page.waitForTimeout(500)
  const file = path.join(IMAGES, name)
  if (opts.of) await opts.of.screenshot({ path: file })
  else await page.screenshot({ path: file, fullPage: opts.full ?? false })
  if (full) await full.evaluate((el) => (el as Element).remove())
}

// ------------------------------------------------------------------------------ the doors ----

/**
 * A fresh access token for a seeded person — signed in with the seed's password, the same login the
 * setup project makes. Read fresh rather than from the saved storage state, whose token expires
 * after an hour.
 */
const tokens = new Map<Tag, string>()
async function tokenOf(tag: Tag): Promise<string> {
  const have = tokens.get(tag)
  if (have) return have
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email: PEOPLE[tag].email, password: PASSWORD }),
  })
  const body = (await res.json()) as { access_token?: string }
  expect(body.access_token, `sign-in as ${tag}`).toBeTruthy()
  tokens.set(tag, body.access_token!)
  return body.access_token!
}
const headersOf = async (tag: Tag) => ({ apikey: ANON, Authorization: `Bearer ${await tokenOf(tag)}`, 'content-type': 'application/json' })
/** An RPC called AS a person — the same door the screen's button uses. Refused = the walk stops. */
async function rpcAs<T = unknown>(tag: Tag, fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: await headersOf(tag), body: JSON.stringify(args) })
  const body = await res.text()
  expect(res.status, `${fn} as ${tag}: ${body}`).toBeLessThan(300)
  return (body ? JSON.parse(body) : null) as T
}
async function fnAs<T = unknown>(tag: Tag, name: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}/functions/v1/${name}`, { method: 'POST', headers: await headersOf(tag), body: JSON.stringify(body) })
  const text = await res.text()
  expect(res.status, `${name} as ${tag}: ${text}`).toBeLessThan(300)
  return JSON.parse(text) as T
}
async function insertAs(tag: Tag, table: string, row: Record<string, unknown>) {
  const res = await fetch(`${API}/rest/v1/${table}`, { method: 'POST', headers: { ...(await headersOf(tag)), Prefer: 'return=representation' }, body: JSON.stringify(row) })
  expect(res.status, `insert ${table} as ${tag}: ${await res.text()}`).toBeLessThan(300)
}

// ------------------------------------------------------------------------------ the campaign ----

const iraqDay = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad' }).format(new Date(ms))
const TODAY = iraqDay(Date.now())
const day = (n: number) => new Date(Date.parse(`${TODAY}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

/** LUMA Season 2 — the four phases the guide is written around. Pre-Launch runs from today. */
const PHASES = [
  { name: 'Pre-Launch', start: day(0), end: day(6) },
  { name: 'Week 1', start: day(7), end: day(13) },
  { name: 'Week 2', start: day(14), end: day(20) },
  { name: 'Weeks 3–4', start: day(21), end: day(34) },
]
/** The spreadsheet's workstreams. A workstream groups the work; each piece belongs to its owner's department (ADR-0102). */
const GROUPS = ['Films & motion', 'Social', 'Words'] as const
/** What the model proposes from the brief — the sheet's rows, as catalogue entries. */
const PROPOSAL = [
  { key: 'animation', name: 'Animation', quantity: 1, typeCode: 'VID-015', phaseNumber: 1, group: 0, owner: 'motiontl', from: 'a LUMA-is-back teaser for all social' },
  { key: 'banner', name: 'Digital Banner', quantity: 3, typeCode: 'DIG-006', phaseNumber: 1, group: 1, owner: 'tl', from: 'SuperKite home banner, splash and Gini banner' },
  // ADR-0128 (I66.9, 29 Sep): an owner is one of the piece's workstream's department's leads — Films & motion is Creative;
  // the department lead owns the TVC and, unlike the three below, does not approve here: its list stays waiting.
  { key: 'tvc', name: 'TVC', quantity: 1, typeCode: 'VID-001', phaseNumber: 2, group: 0, owner: 'lead', from: 'the main spot for Al Rabiaa' },
  { key: 'carousel', name: 'Carousel', quantity: 2, typeCode: 'SOC-002', phaseNumber: 2, group: 1, owner: 'tl', from: 'what is new in Season Two, and the rules' },
  { key: 'static', name: 'Static Post', quantity: 4, typeCode: 'SOC-001', phaseNumber: 3, group: 1, owner: 'tl', from: 'the weekly draw reminders' },
  { key: 'reel', name: 'Reel', quantity: 2, typeCode: 'SOC-004', phaseNumber: 4, group: 0, owner: 'motiontl', from: 'winner stories after each draw' },
  { key: 'caption', name: 'Caption', quantity: 1, typeCode: 'CNT-004', phaseNumber: null, group: 2, owner: 'copytl', from: 'Arabic first, Kurdish adaptation' },
] as const
type Key = (typeof PROPOSAL)[number]['key']

async function mockProposal(page: Page) {
  const [creative] = await rows<{ id: string }>('departments', 'select=id&name=eq.Creative')
  const [content] = await rows<{ id: string }>('departments', 'select=id&name=eq.Content')
  await page.route('**/functions/v1/generate-deliverables', async (route) => {
    await new Promise((r) => setTimeout(r, 300))
    await route.fulfill({ json: {
      deliverables: PROPOSAL.map((p) => ({
        name: p.name, quantity: p.quantity, typeCode: p.typeCode, needsType: false, note: null,
        channel: null, phaseNumber: p.phaseNumber, from: p.from, group: p.group,
      })),
      groups: [
        { name: GROUPS[0], departmentId: creative.id },
        { name: GROUPS[1], departmentId: creative.id },
        { name: GROUPS[2], departmentId: content.id },
      ],
      vocabulary: { types: 'offered', channels: 'offered' },
    } })
  })
}

interface PieceRow { id: string; name: string; code: string | null; state: string; due_at: string | null; phase_id: string | null; tasks_approved_at: string | null }
interface TaskRow { id: string; title: string; status: string; assignee_id: string | null }
const piecesOf = (cid: string) => rows<PieceRow>('deliverables',
  `select=id,name,code,state,due_at,phase_id,tasks_approved_at,streams!inner(campaign_id)&streams.campaign_id=eq.${cid}&state=neq.archived`)
const tasksOf = (id: string) => rows<TaskRow>('sub_tasks',
  `select=id,title,status,assignee_id&deliverable_id=eq.${id}&status=neq.cancelled&order=sort_order.asc,id.asc`)
const phasesOf = (cid: string) => rows<{ id: string; number: number; name: string }>('campaign_phases', `select=id,number,name&campaign_id=eq.${cid}&order=number`)

let campaignId = ''

test.describe.configure({ mode: 'serial' })

test.describe('Guide shots — LUMA Season 2 with four phases (guides 12 and 13)', () => {
  test.skip(!GUIDE_SHOTS, 'GUIDE_SHOTS=1 writes the guide screenshots')
  test.setTimeout(15 * 60_000)
  test.use({ actionTimeout: 20_000 })

  test('guide 12 — the campaign with four phases, step by step', async ({ browser }) => {
    // Fixture rewind: the guide's campaign carries a real name, and the name is unique. An earlier
    // run's campaign is renamed out of the way and closed, so it leaves the list the pictures show.
    for (const old of await rows<{ id: string }>('campaigns', `select=id&or=(name.eq.${encodeURIComponent(NAME)},name.like.${encodeURIComponent(`${NAME} · earlier guide run*`)})&status=neq.closed`)) {
      const r = await attemptWrite('PATCH', 'campaigns', `id=eq.${old.id}`, { name: `${NAME} · earlier guide run ${old.id.slice(0, 8)}`, status: 'closed' })
      expect(r.status, r.text).toBeLessThan(300)
    }

    const am = await as(browser, 'am2')
    await mockProposal(am)

    // The door in: Campaigns → + New.
    await go(am, '/campaigns')
    await expect(am.getByTestId('campaigns-cards')).toBeVisible({ timeout: 30_000 })
    await expect(am.getByTestId('campaigns-new-brief')).toBeVisible()
    await shot(am, '12-01-campaigns-list.png')

    // ---- Step 1 — the campaign, and its phases.
    await go(am, '/campaigns/new')
    await expect(am.getByTestId('wizard-step-1')).toBeVisible()
    await shot(am, '12-02-step1-empty.png', { full: true })
    await am.getByTestId('wizard-client').selectOption({ label: 'Luma Retail' })
    await am.getByTestId('wizard-name').fill(NAME)
    // ADR-0116 (27 Sep): no switch — the Phases card is always there, and a campaign uses phases once it has one.
    await expect(am.getByTestId('wizard-phases-add')).toBeVisible()
    await shot(am, '12-03-step1-named-phases-on.png', { full: true })
    for (let i = 0; i < PHASES.length; i++) {
      await am.getByTestId('wizard-phases-add').click()
      await expect(am.getByTestId('wizard-phase-dialog-dialog')).toBeVisible()
      await am.getByTestId('wizard-phase-dialog-name').fill(PHASES[i].name)
      if (i === 0) await am.getByTestId('wizard-phase-dialog-starts').fill(PHASES[i].start)
      // Every phase after the first starts the day after the one before — filled in, not typed.
      else await expect(am.getByTestId('wizard-phase-dialog-starts')).toHaveValue(PHASES[i].start)
      await am.getByTestId('wizard-phase-dialog-date').fill(PHASES[i].end)
      if (i === 1) await shot(am, '12-04-add-phase-dialog.png')
      await am.getByTestId('wizard-phase-dialog-submit').click()
      await expect(am.getByTestId('wizard-phase-dialog-dialog')).toHaveCount(0)
    }
    await expect(am.locator('[data-testid^="wizard-phases-row-"]')).toHaveCount(4)
    // ADR-0116 d.2: no Workstreams switch either — every campaign piece is in a workstream.
    await expect(am.getByTestId('wizard-workstreams-toggle')).toHaveCount(0)
    await shot(am, '12-05-step1-four-phases.png', { full: true })
    await am.getByTestId('wizard-next').click()

    // ---- Step 2 — the brief.
    await expect(am.getByTestId('wizard-step-2')).toBeVisible()
    await am.getByTestId('wizard-brief-background').fill('Season 1 of LUMA made SuperKite the wallet people talk about on a Friday night. Season 2 runs four weekly draws from launch, live on Al Rabiaa TV with a stream inside the app.')
    await am.getByTestId('wizard-brief-task').fill('Bring people back for Season 2 and keep them buying through the four draws — a teaser before launch, then posts, reminders and winner stories every week.')
    await am.getByTestId('wizard-brief-insight').fill('Every ordinary purchase already feels like a small win when the payment chime sounds; LUMA turns that chime into a ticket.')
    await am.getByTestId('wizard-brief-proposition').fill('Every purchase is a ticket. Every Friday is a draw.')
    await chooseLanguages(am, 'wizard-languages-picker', ['en'])
    await shot(am, '12-06-step2-brief.png', { full: true })
    await am.getByTestId('wizard-next').click()

    // ---- Step 3 — the work: the proposal, an owner on every piece.
    await expect(am.getByTestId('wizard-step-3')).toBeVisible()
    await expect(am.getByTestId('wizard-busy-propose')).toHaveCount(0, { timeout: 20_000 })
    const ids = await pieceIds(am)
    expect(ids).toHaveLength(PROPOSAL.length)
    await expect(am.locator('[data-testid^="wizard-work-group-name-"]')).toHaveCount(GROUPS.length)
    await shot(am, '12-07-step3-proposed.png', { full: true })
    // Each piece's owner, in its dialog. The first one is photographed open.
    for (const id of ids) {
      const text = (await am.getByTestId(`wizard-work-piece-${id}`).textContent()) ?? ''
      const p = PROPOSAL.find((x) => text.includes(x.name))
      expect(p, `row "${text}" is one of the proposal`).toBeTruthy()
      if (p!.key === 'animation') {
        await am.getByTestId(`wizard-work-edit-${id}`).click()
        await am.getByTestId('wizard-piece-owner').selectOption({ label: PEOPLE[p!.owner].name })
        await shot(am, '12-08-piece-dialog.png')
        await am.getByTestId('wizard-piece-save').click()
        await expect(am.getByTestId('wizard-piece-save')).toHaveCount(0)
      } else {
        await setPieceOwner(am, id, PEOPLE[p!.owner].name)
      }
    }
    // Each workstream is somebody's to answer for.
    const groupOwner: Record<string, Tag> = { [GROUPS[0]]: 'motiontl', [GROUPS[1]]: 'tl', [GROUPS[2]]: 'copytl' }
    for (const sel of await am.locator('select[data-testid^="wizard-work-owner-"]').all()) {
      const gid = (await sel.getAttribute('data-testid'))!.replace('wizard-work-owner-', '')
      const gname = await am.getByTestId(`wizard-work-group-name-${gid}`).inputValue()
      const who = PEOPLE[groupOwner[gname]!].name
      const value = await sel.locator('option').filter({ hasText: who }).first().getAttribute('value')
      expect(value, `${who} is offered for ${gname}`).toBeTruthy()
      await sel.selectOption(value!)
    }
    await expect(am.locator('[data-testid^="wizard-work-warn-"]')).toHaveCount(0)
    await shot(am, '12-09-step3-owned.png', { full: true })
    await am.getByTestId('wizard-next').click()

    // ---- Step 4 — timing: planned back from each phase's end; the unplaced Caption placed by a date.
    await expect(am.getByTestId('wizard-step-4')).toBeVisible()
    await expect(am.locator('[data-testid^="wizard-timing-row-"]').first()).toBeVisible()
    await expect(am.getByTestId('wizard-timing-unplaced')).toBeVisible()
    await shot(am, '12-10-step4-timing.png', { full: true })
    // "+ Add a phase" on the strip opens the same dialog as step 1, its start filled in after the last phase.
    await am.getByTestId('wizard-timing-add-phase').click()
    await expect(am.getByTestId('wizard-timing-phase-dialog-dialog')).toBeVisible()
    await expect(am.getByTestId('wizard-timing-phase-dialog-starts')).toHaveValue(day(35))
    await am.getByTestId('wizard-timing-phase-dialog-cancel').click()
    await expect(am.getByTestId('wizard-timing-phase-dialog-dialog')).toHaveCount(0)
    const place = am.locator('[data-testid^="wizard-timing-place-"]')
    await expect(place).toHaveCount(1)
    const captionId = (await place.getAttribute('data-testid'))!.replace('wizard-timing-place-', '')
    await am.getByTestId(`wizard-timing-place-${captionId}`).click()
    await expect(am.getByTestId('wizard-timing-piece-dialog')).toBeVisible()
    // A date in Week 1 puts it in Week 1 — the date chooses the phase.
    await am.getByTestId('wizard-timing-piece-due').fill(day(11))
    await expect(am.getByTestId('wizard-timing-piece-in-phase').or(am.getByTestId('wizard-timing-piece-moves'))).toContainText('Week 1')
    await shot(am, '12-11-step4-date-chooses-phase.png')
    await am.getByTestId('wizard-timing-piece-save').click()
    await expect(am.getByTestId('wizard-timing-piece-dialog')).toHaveCount(0)
    await expect(am.getByTestId('wizard-timing-unplaced')).toHaveCount(0)
    // Week 1's tab now holds the Caption.
    const tabs = am.locator('[data-testid^="wizard-timing-phase-"]:not([data-testid*="-edit-"])')
    await tabs.filter({ hasText: 'Week 1' }).first().click()
    await expect(am.getByTestId(`wizard-timing-row-${captionId}`)).toBeVisible()
    await shot(am, '12-12-step4-week-1.png', { full: true })
    await am.getByTestId('wizard-next').click()

    // ---- Step 5 — review, and approve.
    await expect(am.getByTestId('wizard-step-5')).toBeVisible()
    await expect(am.getByTestId('wizard-review-consequences')).toBeVisible()
    await shot(am, '12-13-step5-review.png', { full: true })
    await am.getByTestId('wizard-review-approve').click()
    await expect(am).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/, { timeout: 30_000 })
    campaignId = am.url().split('/').pop()!
    await expect(am.getByTestId('campaign-grid')).toBeVisible()
    const [c] = await rows<{ status: string }>('campaigns', `select=status&id=eq.${campaignId}`)
    expect(c.status).toBe('approved')
    expect(await piecesOf(campaignId)).toHaveLength(PROPOSAL.length)
    expect(await phasesOf(campaignId)).toHaveLength(4)
    await expect(am.getByTestId('campaign-task-lists')).toBeVisible()
    await shot(am, '12-14-campaign-page.png', { full: true })
    await am.context().close()
  })

  test('guide 13 — the campaign run: the list, every view, managing phases and pieces', async ({ browser }) => {
    expect(campaignId, 'guide 12 made the campaign').toBeTruthy()
    const uid: Record<string, string> = {}
    for (const tag of ['am2', 'tl', 'motiontl', 'edittl', 'copytl', 'maker', 'deputy', 'animator', 'writer'] as const) uid[tag] = await userIdOf(PEOPLE[tag].email)
    const [{ tenant_id: tenantId }] = await rows<{ tenant_id: string }>('user_profiles', `select=tenant_id&id=eq.${uid.am2}`)
    const phases = await phasesOf(campaignId)
    const pieces = await piecesOf(campaignId)
    const by = {} as Record<Key, PieceRow>
    for (const p of PROPOSAL) {
      const row = pieces.find((r) => r.name === p.name)
      expect(row, p.name).toBeTruthy()
      by[p.key] = row!
    }
    const url = `/campaigns/${campaignId}`

    // ================= the data, made by the people who would make it =================
    // Each owner approves their own task lists on the Grid; the TVC's is left waiting on its owner.
    for (const tag of ['tl', 'motiontl', 'copytl'] as const) {
      const p = await as(browser, tag)
      await go(p, url)
      await expect(p.getByTestId('campaign-task-lists')).toBeVisible()
      await p.getByTestId('campaign-task-lists-approve-all').click()
      for (const q of PROPOSAL.filter((x) => x.owner === tag)) {
        await expect.poll(async () => (await rows<{ tasks_approved_at: string | null }>('deliverables', `select=tasks_approved_at&id=eq.${by[q.key].id}`))[0].tasks_approved_at, { timeout: 15_000 }).not.toBeNull()
      }
      await p.context().close()
    }
    // Owners give tasks to makers; makers start, submit; the owner approves.
    const assign = async (owner: Tag, task: TaskRow, maker: Tag, due: string, manual: boolean) => {
      const out = await rpcAs<{ outcome: string; reschedule_needed: boolean }[]>(owner, 'update_task_assignment', {
        p_sub_task: task.id, p_title: task.title, p_assignee: uid[maker],
        p_reviewers: [{ user_id: uid[owner], is_mandatory: true }],
        p_starts_at: `${TODAY}T06:00:00Z`, p_due_at: `${due}T14:00:00Z`, p_hours: 3, p_review_mode: manual ? 'manual' : null,
      })
      expect(out[0]?.outcome, `${task.title} → ${maker}`).toBe('assigned')
      if (out[0]?.reschedule_needed) await fnAs(owner, 'subtask-schedule', { subTaskId: task.id })
    }
    const work = async (task: TaskRow, maker: Tag, to: 'in_progress' | 'review' | 'done', reviewer?: Tag) => {
      await rpcAs(maker, 'sub_task_start', { p_id: task.id })
      if (to === 'in_progress') return
      await insertAs(maker, 'review_feedback', { tenant_id: tenantId, sub_task_id: task.id, body: `Done: ${task.title}. On the shared drive.`, author_user_id: uid[maker] })
      // Sent straight after Start on purpose (the guide stages the states, not the timing): an
      // untimed round is refused unless accepted (ADR-0106 d.2), so it is accepted — "Send anyway".
      await rpcAs(maker, 'sub_task_submit', { p_id: task.id, p_manual_minutes: null, p_accept_untimed: true })
      if (to === 'review') return
      await rpcAs(reviewer!, 'sub_task_approve', { p_sub_task: task.id })
    }
    // The Animation: every task done and approved — it approves itself.
    const anim = await tasksOf(by.animation.id)
    for (const t of anim) await assign('motiontl', t, 'animator', day(5), true)
    for (const t of anim) await work(t, 'animator', 'done', 'motiontl')
    // The Digital Banner: one done, one in review, one in progress, the rest given and waiting.
    const banner = await tasksOf(by.banner.id)
    expect(banner.length).toBeGreaterThanOrEqual(4)
    for (let i = 0; i < 4; i++) await assign('tl', banner[i], i % 2 ? 'deputy' : 'maker', day(5), i < 2)
    await work(banner[0], 'maker', 'done', 'tl')
    await work(banner[1], 'deputy', 'review')
    await work(banner[2], 'maker', 'in_progress')
    // The Carousel: two tasks given, none started.
    const carousel = await tasksOf(by.carousel.id)
    for (let i = 0; i < 2; i++) await assign('tl', carousel[i], 'maker', day(12), false)
    await expect.poll(async () => (await rows<{ state: string }>('deliverables', `select=state&id=eq.${by.animation.id}`))[0].state).toBe('approved')
    // The account manager marks the Animation delivered — the client has it.
    await fnAs('am2', 'deliverable-transition', { deliverableId: by.animation.id, to: 'delivered', expectedState: 'approved' })

    // ================= the campaigns list =================
    const am = await as(browser, 'am2')
    await mockMore(am)
    await go(am, '/campaigns')
    await expect(am.getByTestId('campaigns-cards')).toBeVisible({ timeout: 30_000 })
    await expect(am.getByTestId('campaigns-scope-mine')).toHaveAttribute('aria-pressed', 'true')
    await am.getByTestId('campaigns-search').fill(NAME)
    const card = am.getByTestId(`campaign-row-${campaignId}`)
    await expect(card).toBeVisible()
    await shot(am, '13-01-campaigns-list.png')
    await expect(am.getByTestId(`campaign-progress-${campaignId}`)).toContainText(`1 of ${PROPOSAL.length}`)
    await expect(am.getByTestId(`campaign-line-${campaignId}`)).toContainText('Pre-Launch · 1 of 4')
    await expect(am.getByTestId(`campaign-task-lists-${campaignId}`)).toContainText('1 task list to approve')
    await shot(am, '13-02-campaign-card.png', { of: card })
    // The smart search: a deliverable's code finds its campaign.
    await am.getByTestId('campaigns-search').fill(by.tvc.code!)
    await expect(card).toBeVisible()
    await shot(am, '13-03-search-by-code.png')
    await am.getByTestId(`campaign-menu-${campaignId}`).click()
    await expect(am.getByTestId(`campaign-close-out-${campaignId}`)).toBeVisible()
    await shot(am, '13-04-card-menu.png')
    await am.keyboard.press('Escape')

    // ================= the page: the Grid =================
    await go(am, url)
    await expect(am.getByTestId('campaign-grid')).toBeVisible()
    await expect(am.getByTestId('campaign-tab-grid')).toHaveAttribute('aria-selected', 'true')
    await expect(am.getByTestId(`campaign-task-lists-row-${by.tvc.id}`)).toBeVisible()
    for (const p of PROPOSAL) await expect(am.getByTestId(`campaign-deliverable-${by[p.key].id}`)).toBeVisible()
    await shot(am, '13-05-grid.png', { full: true })
    await am.getByTestId('campaign-phase-filter').selectOption(phases[0].id)
    await expect(am.getByTestId(`campaign-deliverable-${by.banner.id}`)).toBeVisible()
    await expect(am.getByTestId(`campaign-deliverable-${by.tvc.id}`)).toHaveCount(0)
    await shot(am, '13-06-grid-pre-launch.png')
    await am.getByTestId('campaign-phase-filter').selectOption('')

    // The drawer: one deliverable, its owner, its tasks one by one — for someone who may edit it, in the panel (ADR-0132).
    await am.getByTestId(`campaign-deliverable-open-${by.banner.id}`).click()
    await expect(am.getByTestId('piece-drawer')).toBeVisible()
    await expect(am.getByTestId('piece-drawer-owner')).toContainText(PEOPLE.tl.name)
    await expect(am.getByTestId(`piece-panel-task-${banner[1].id}`)).toContainText('In review')
    await shot(am, '13-07-drawer.png')
    await am.getByTestId('piece-drawer-close').click()

    // Edit (ADR-0132 d.2 — the grid's Edit opens the piece's panel): the Carousel moves from Week 1 to Week 2.
    await am.getByTestId(`campaign-deliverable-edit-${by.carousel.id}`).click()
    await expect(am.getByTestId('piece-panel')).toBeVisible()
    await am.getByTestId('piece-panel-phase').selectOption(phases[2].id)
    // I57.36 / I68.11: the new phase asks about the date the moment it is picked; the date follows it.
    await expect(am.getByTestId('piece-panel-phase-date')).toBeVisible()
    await shot(am, '13-08-edit-move-phase.png')
    await am.getByTestId('piece-panel-phase-date-move').click()
    await am.getByTestId('piece-panel-save').click()
    await notice(am, /saved/i)
    await closeNotice(am)
    await am.getByTestId('piece-drawer-x').click()
    await expect(am.getByTestId('piece-panel')).toHaveCount(0)
    await expect.poll(async () => (await rows<{ phase_id: string }>('deliverables', `select=phase_id&id=eq.${by.carousel.id}`))[0].phase_id).toBe(phases[2].id)

    // Manage phases: add, a refused delete, a refused turn-off, the empty one removed.
    await am.getByTestId('campaign-phases-manage').click()
    await expect(am.getByTestId('campaign-phases-dialog')).toBeVisible()
    await shot(am, '13-09-manage-phases.png')
    await am.getByTestId('campaign-phase-add-name').fill('Post-Season')
    await am.getByTestId('campaign-phase-add-start').fill(day(35))
    await am.getByTestId('campaign-phase-add-end').fill(day(41))
    await am.getByTestId('campaign-phase-add').click()
    await expect(am.locator('[data-testid^="campaign-phase-row-"]')).toHaveCount(5)
    await am.getByTestId(`campaign-phase-delete-${phases[0].id}`).click()
    await notice(am, /./)
    await shot(am, '13-10-delete-refused.png')
    await closeNotice(am)
    expect(await phasesOf(campaignId), 'the phase holding work is still there').toHaveLength(5)
    const [post] = await rows<{ id: string }>('campaign_phases', `select=id&campaign_id=eq.${campaignId}&number=eq.5`)
    await am.getByTestId(`campaign-phase-delete-${post.id}`).click()
    await expect(am.locator('[data-testid^="campaign-phase-row-"]')).toHaveCount(4)
    await am.getByTestId('campaign-phases-off').click()
    await notice(am, /./)
    await shot(am, '13-11-turn-off-refused.png')
    await closeNotice(am)
    expect((await rows<{ has_phases: boolean }>('campaigns', `select=has_phases&id=eq.${campaignId}`))[0].has_phases, 'phases are still on').toBe(true)
    await am.getByTestId('campaign-phases-done').click()
    await expect(am.getByTestId('campaign-phases-dialog')).toHaveCount(0)

    // Add a deliverable on the Grid.
    await am.getByTestId('campaign-add-deliverable').click()
    await expect(am.getByTestId('campaign-deliverable-form')).toBeVisible()
    await am.getByTestId('campaign-deliverable-form-type').fill('Campaign Key Visual')
    await am.getByTestId('campaign-deliverable-form-type-list').getByRole('option').first().dispatchEvent('mousedown')
    // ADR-0116 d.3: a campaign piece is in a workstream — Social, Creative's, so its leads are offered (ADR-0128).
    await am.getByTestId('campaign-deliverable-form-workstream').selectOption({ label: GROUPS[1] })
    await am.getByTestId('campaign-deliverable-form-owner').fill(PEOPLE.tl.name)
    await am.getByTestId('campaign-deliverable-form-owner-list').getByRole('option', { name: new RegExp(PEOPLE.tl.name) }).first().dispatchEvent('mousedown')
    await am.getByTestId('campaign-deliverable-form-phase').selectOption(phases[1].id)
    await am.getByTestId('campaign-deliverable-form-due').fill(day(12))
    await shot(am, '13-12-add-deliverable.png')
    await am.getByTestId('campaign-deliverable-form-submit').click()
    await expect(am.getByTestId('campaign-deliverable-form')).toHaveCount(0)
    await expect.poll(async () => (await piecesOf(campaignId)).length).toBe(PROPOSAL.length + 1)
    await notice(am, /added/i)
    await closeNotice(am)

    // ================= the other views =================
    await am.getByTestId('campaign-tab-where').click()
    await expect(am.getByTestId('campaign-panel-where')).toBeVisible()
    await expect(am.getByTestId('where-filter-phase')).toHaveValue(phases[0].id)
    await shot(am, '13-13-where-is-everything.png', { full: true })

    await am.getByTestId('campaign-tab-seasonMap').click()
    await expect(am.getByTestId('campaign-panel-season-map')).toBeVisible()
    await expect(am.getByTestId(`season-map-phase-${phases[0].id}`)).toHaveClass(/is-current/)
    await expect(am.getByTestId(`season-square-${by.animation.id}`)).toHaveClass(/is-delivered\b/)
    await shot(am, '13-14-season-map.png', { full: true })

    await am.getByTestId('campaign-tab-board').click()
    await expect(am.getByTestId('campaign-panel-board')).toBeVisible()
    await expect(am.getByTestId('board-column-delivered').getByTestId(`board-card-${by.animation.id}`)).toBeVisible()
    // ADR-0131 (30 Sep): the word follows the least advanced open task — the Banner has one in progress and one not
    // started beside the one in review, so it is In progress.
    await expect(am.getByTestId('board-column-inProgress').getByTestId(`board-card-${by.banner.id}`)).toBeVisible()
    await shot(am, '13-15-board.png', { full: true })

    await am.getByTestId('campaign-tab-timeline').click()
    await expect(am.getByTestId('campaign-panel-timeline')).toBeVisible()
    await expect(am.getByTestId(`timeline-day-${TODAY}`)).toHaveClass(/is-today/)
    await shot(am, '13-16-timeline.png', { full: true })

    // ================= the brief: read, edit, propose more =================
    await am.getByTestId('campaign-tab-brief').click()
    await expect(am.getByTestId('campaign-panel-brief')).toBeVisible()
    await expect(am.getByTestId('brief-view-headline')).toHaveText('Every purchase is a ticket. Every Friday is a draw.')
    await shot(am, '13-17-brief.png', { full: true })
    await am.getByTestId('campaign-brief-edit').click()
    await am.getByTestId('campaign-master-brief-field-task').fill('Bring people back for Season 2 and keep them buying through the four draws. Numbers, prizes and dates stay in brackets until the client confirms. The draw is السحب — never lottery.')
    await shot(am, '13-18-edit-brief.png', { full: true })
    await am.getByTestId('campaign-master-brief-save').click()
    await notice(am, /saved/i)
    await closeNotice(am)
    await expect.poll(async () => (await rows<{ brief: { task?: string } }>('campaigns', `select=brief&id=eq.${campaignId}`))[0].brief.task ?? '').toContain('never lottery')
    await am.getByTestId('campaign-generate-deliverables').click()
    await expect(am.getByTestId('campaign-generate-dialog')).toBeVisible()
    const grow = am.locator('[data-testid^="campaign-generate-row-"]').first()
    await expect(grow).toBeVisible({ timeout: 20_000 })
    const gid = (await grow.getAttribute('data-testid'))!.replace('campaign-generate-row-', '')
    // ADR-0116 d.3: the batch goes into a workstream, chosen above the table — Social, Creative's (ADR-0128).
    await am.getByTestId('campaign-generate-workstream').selectOption({ label: GROUPS[1] })
    await am.getByTestId(`campaign-generate-owner-${gid}`).fill(PEOPLE.tl.name)
    await am.getByTestId(`campaign-generate-owner-${gid}-list`).getByRole('option', { name: new RegExp(PEOPLE.tl.name) }).first().dispatchEvent('mousedown')
    await am.getByTestId(`campaign-generate-due-${gid}`).fill(day(18))
    await shot(am, '13-19-propose-more.png')
    await am.getByTestId('campaign-generate-submit').click()
    await expect(am.getByTestId('campaign-generate-dialog')).toHaveCount(0)
    await expect.poll(async () => (await piecesOf(campaignId)).length).toBe(PROPOSAL.length + 2)
    await notice(am, /added/i)
    await closeNotice(am)

    // ================= the campaign elsewhere =================
    await go(am, `/pipeline?campaign=${campaignId}`)
    await expect(am.getByTestId('pipeline-grid')).toBeVisible()
    await shot(am, '13-20-pipeline.png', { full: true })
    // Opened on the first day the maker is booked on this campaign — the grid shows a week.
    const [makerRes] = await rows<{ id: string }>('resources', `select=id&user_id=eq.${uid.maker}&is_active=eq.true`)
    const [first] = await rows<{ starts_at: string }>('bookings', `select=starts_at&resource_id=eq.${makerRes.id}&sub_task_id=in.(${banner.slice(0, 4).map((t) => t.id).join(',')})&state=eq.confirmed&order=starts_at.asc&limit=1`)
    expect(first, 'the maker is booked on the Digital Banner').toBeTruthy()
    await go(am, `/schedule?view=project&campaign=${campaignId}&on=${iraqDay(Date.parse(first.starts_at))}`)
    await expect(am.getByTestId('filter-phase')).toBeVisible()
    await am.getByTestId('filter-phase').selectOption(phases[0].id)
    await expect(am.getByTestId(`row-${makerRes.id}`)).toBeVisible()
    await shot(am, '13-21-schedule-by-phase.png')
    await am.context().close()

    // ================= a team member reads it =================
    const mk = await as(browser, 'maker')
    await go(mk, url)
    await expect(mk.getByTestId('campaign-grid')).toBeVisible()
    await expect(mk.locator('[data-testid^="campaign-deliverable-edit-"]')).toHaveCount(0)
    await expect(mk.getByTestId('campaign-add-deliverable')).toHaveCount(0)
    await expect(mk.getByTestId('campaign-phases-manage')).toHaveCount(0)
    await shot(mk, '13-22-team-member.png', { full: true })
    await mk.context().close()
  })
})

/** The page's notice dialog: every outcome and every refusal lands in it. Read it, then close it. */
async function notice(page: Page, says: RegExp) {
  await expect(page.getByTestId('campaign-banner')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('campaign-banner')).toContainText(says)
}
async function closeNotice(page: Page) {
  await page.getByTestId('campaign-banner-close').click()
  await expect(page.getByTestId('campaign-banner')).toHaveCount(0)
}

/** "Propose more" — the model answers with one piece the campaign does not have yet. */
async function mockMore(page: Page) {
  await page.route('**/functions/v1/generate-deliverables', async (route) => {
    await route.fulfill({ json: {
      deliverables: [{ name: 'Story', quantity: 6, typeCode: 'SOC-003', needsType: false, note: null, channel: null, phaseNumber: 2, from: 'countdown stories on draw days', group: null }],
      groups: [],
      vocabulary: { types: 'offered', channels: 'offered' },
    } })
  })
}
