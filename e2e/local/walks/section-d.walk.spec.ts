import { test, expect, type Browser, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { authFile, PEOPLE } from '../fixtures'
import { attemptWrite, rows, userIdOf } from '../helpers/db'
import { mockProposal, pieceIds, reviewAndApprove, setPieceOwner, startCampaign, chooseLanguages } from '../helpers/campaign-wizard'

/**
 * Review walk — Figma section D, the running campaign (Edward, 24 Sep).
 *
 * The campaigns list (CG-00), the Grid (CG-01), the deliverable drawer (CG-04), Edit (CG-E1), Where
 * is everything (CG-03), the Season map (CG-02), the Board (CG-05), the Timeline (CG-06) and the
 * Brief (CG-07) — as the account manager, then as a team member, in Arabic and on a phone.
 *
 * THE DATA IS MADE HERE, THROUGH THE PRODUCT. No local campaign has its deliverables spread across
 * stages, so the walk makes one: the wizard (the model's proposal is the only thing mocked), then
 * each person does their part through the screen or through the RPC the screen calls, signed in as
 * that person — never the service role. The owners approve their task lists on the Grid (one list
 * is left waiting), the leads give tasks to makers, the makers start and submit, the reviewers
 * approve, the account manager marks one piece Delivered, and a lead records an outstanding input.
 *
 * ONE state is staged: a late deliverable. The product will not let a due date be set in the past,
 * so that one date is moved with the service role, and the report says so where it shows.
 *
 * There are NO fallbacks. The set-up and the navigation are hard assertions; what each screen
 * should show is a recorded check, and the report counts them.
 *
 * Run:
 *   WALK=1 npx playwright test --config playwright.local.config.ts e2e/local/walks/section-d.walk.spec.ts
 *
 * Writes `Claude outputs/reports/<date>-section-d/REPORT.html` — self-contained, every screenshot
 * embedded as a data URI, so the one file can be sent on its own (Edward, 22 Sep).
 */
const WALK = process.env.WALK === '1'
const iraqDay = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad' }).format(new Date(ms))
const DATE = process.env.WALK_DATE ?? iraqDay(Date.now())
const OUT = path.resolve('Claude outputs', 'reports', `${DATE}-section-d`)

interface Check { title: string; ok: boolean; detail?: string }
interface Step { n: number; title: string; actor: string; notes: string[]; shots: string[]; checks: Check[] }
interface Chapter { key: string; title: string; steps: Step[] }
interface Report { started: string; campaign: string | null; chapters: Chapter[] }

const reportFile = path.join(OUT, 'report.json')

class Walk {
  report: Report = { started: new Date().toISOString(), campaign: null, chapters: [] }
  chapter!: Chapter
  step!: Step
  shots = 0
  constructor() {
    // A fresh report every run: the walk makes its own campaign, so an older run's pictures
    // describe a different one.
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
  /** A picture of the page — or of one element, when `of` is given (a close-up of a card). */
  async shot(page: Page, slug: string, opts: { full?: boolean; caption?: string; of?: Locator } = {}) {
    this.shots += 1
    const name = `${String(this.shots).padStart(3, '0')}-${slug}.png`
    await page.addStyleTag({ content: '[data-testid="environment-bar"]{display:none!important}' }).catch(() => {})
    const full = opts.full
      ? await page.addStyleTag({ content: '.shell{block-size:auto!important;overflow:visible!important}.shell-main{overflow:visible!important}' })
      : null
    await page.waitForTimeout(400)
    const file = path.join(OUT, 'shots', name)
    if (opts.of) await opts.of.screenshot({ path: file })
    else await page.screenshot({ path: file, fullPage: opts.full ?? false })
    if (full) await full.evaluate((el) => (el as Element).remove())
    this.step.shots.push(`shots/${name}${opts.caption ? `|${opts.caption}` : ''}`)
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
  let pass = 0, fail = 0, steps = 0, shots = 0
  for (const c of r.chapters) for (const s of c.steps) {
    steps++
    shots += s.shots.length
    for (const k of s.checks) { if (k.ok) pass++; else fail++ }
  }
  const out: string[] = []
  out.push('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Section D walk</title>')
  out.push('<style>:root{color-scheme:light}body{font:15px/1.6 system-ui,sans-serif;max-width:1180px;margin:32px auto;padding:0 24px;color:#1d1d1f;background:#fff}'
    + 'img{max-width:100%;border:1px solid #ddd;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.08);margin:8px 0}'
    + 'figcaption{color:#666;font-style:italic;margin-bottom:24px}'
    + 'h2{margin-top:56px;border-top:1px solid #e5e5e5;padding-top:24px}h3{margin-top:32px}'
    + '.ok{color:#1a7f37}.bad{color:#b42318}pre{background:#f6f6f6;padding:8px 12px;border-radius:6px;font-size:13px;white-space:pre-wrap}'
    + 'nav ol{columns:2}.tally{font-size:17px;font-weight:600}'
    + '.frame{background:#eef4ff;border-inline-start:3px solid #3b6fd8;padding:10px 14px;border-radius:6px;margin:12px 0}'
    + '.staged{background:#fff8e6;border-inline-start:3px solid #d99b0a;padding:10px 14px;border-radius:6px;margin:12px 0}'
    + '@media (max-width:700px){nav ol{columns:1}body{padding:0 16px}}</style></head><body>')
  out.push('<h1>Section D — the running campaign</h1>')
  out.push(`<p>Walked ${esc(r.started.slice(0, 16).replace('T', ' '))} UTC on the local stack${r.campaign ? `, on <b>${esc(r.campaign)}</b>` : ''}. `
    + 'The campaign was made by this walk, through the product: every state on these screens was reached by the person who would reach it, '
    + 'except one late date, which is marked where it shows. Every screenshot is the state <b>after</b> the step completed. Nothing was saved from the Edit dialog.</p>')
  out.push(`<p class="tally">${steps} steps · ${shots} screenshots · checks: <span class="ok">${pass} passed</span>, <span class="${fail ? 'bad' : 'ok'}">${fail} failed</span>.</p>`)
  out.push('<nav><ol>')
  for (const c of r.chapters) out.push(`<li><a href="#${esc(c.key)}">${esc(c.title)}</a></li>`)
  out.push('</ol></nav>')
  for (const c of r.chapters) {
    out.push(`<h2 id="${esc(c.key)}">${esc(c.title)}</h2>`)
    for (const s of c.steps) {
      out.push(`<h3>${s.n}. ${esc(s.title)}</h3><p><i>As ${esc(s.actor)}.</i></p>`)
      for (const n of s.notes) {
        if (n.startsWith('FRAME:')) out.push(`<p class="frame">${esc(n.slice(6).trim())}</p>`)
        else if (n.startsWith('STAGED:')) out.push(`<p class="staged">${esc(n.slice(7).trim())}</p>`)
        else out.push(`<p>${esc(n)}</p>`)
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
  out.push('</body></html>')
  return out.join('\n')
}

// ------------------------------------------------------------------------------ the doors ----

const API = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
type Tag = keyof typeof PEOPLE

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

/** An RPC called AS a person — the same door the screen's button uses. Refused = the walk stops. */
async function rpcAs<T = unknown>(tag: Tag, fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: headersOf(tag), body: JSON.stringify(args) })
  const body = await res.text()
  expect(res.status, `${fn} as ${tag}: ${body}`).toBeLessThan(300)
  return (body ? JSON.parse(body) : null) as T
}
/** An Edge Function called AS a person (the app's `functions.invoke`). */
async function fnAs<T = unknown>(tag: Tag, name: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}/functions/v1/${name}`, { method: 'POST', headers: headersOf(tag), body: JSON.stringify(body) })
  const text = await res.text()
  expect(res.status, `${name} as ${tag}: ${text}`).toBeLessThan(300)
  return JSON.parse(text) as T
}
/** A table write AS a person, under their RLS (the app's `supabase.from(...).insert`). */
async function insertAs(tag: Tag, table: string, row: Record<string, unknown>) {
  const res = await fetch(`${API}/rest/v1/${table}`, { method: 'POST', headers: { ...headersOf(tag), Prefer: 'return=representation' }, body: JSON.stringify(row) })
  const text = await res.text()
  expect(res.status, `insert ${table} as ${tag}: ${text}`).toBeLessThan(300)
}

// ------------------------------------------------------------------------------ the browser ----

class Session {
  constructor(readonly browser: Browser) {}
  async as(tag: Tag, viewport = { width: 1440, height: 1000 }): Promise<Page> {
    const ctx = await this.browser.newContext({ storageState: authFile(tag), viewport })
    return ctx.newPage()
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

// ------------------------------------------------------------------------------ the campaign ----

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

/** The seven pieces, and what each is made to show. */
const PIECES = {
  hero:   { name: 'Hero key visual',   typeCode: 'ADV-003', quantity: 2, channel: 'Instagram', phaseNumber: 2, group: 0, owner: 'lead' },
  teaser: { name: 'Draw night teaser', typeCode: 'ADV-003', channel: 'TikTok',    phaseNumber: 2, group: 0, owner: 'tl' },
  reel:   { name: 'Winners reel',      typeCode: 'ADV-002', channel: 'YouTube',   phaseNumber: 3, group: 0, owner: 'tl' },
  copy:   { name: 'Launch copy',       typeCode: 'CNT-002', channel: 'Web',       phaseNumber: 2, group: 1, owner: 'content' },
  radio:  { name: 'Radio script',      typeCode: 'CNT-001', channel: 'Radio',     phaseNumber: 3, group: 1, owner: 'copytl' },
  terms:  { name: 'Prize terms page',  typeCode: 'CNT-002', channel: 'Web',       phaseNumber: 3, group: 1, owner: 'content' },
  bumper: { name: 'Motion bumper',     typeCode: 'ADV-003', channel: 'TikTok',    phaseNumber: 3, group: 0, owner: 'motiontl' },  // ADR-0116: every campaign piece is in a workstream
} as const
type Key = keyof typeof PIECES
const GROUPS = ['Season Visuals', 'Words & Radio'] as const

interface PieceRow {
  id: string; name: string; code: string | null; state: string; due_at: string | null; phase_id: string | null
  workstream_id: string | null; owner_user_id: string | null; tasks_approved_at: string | null
}
interface TaskRow { id: string; title: string; status: string; assignee_id: string | null; deliverable_id: string; sort_order: number }

const piecesOf = (cid: string) => rows<PieceRow>('deliverables',
  `select=id,name,code,state,due_at,phase_id,workstream_id,owner_user_id,tasks_approved_at,streams!inner(campaign_id)&streams.campaign_id=eq.${cid}`)
const tasksOfPiece = (id: string) => rows<TaskRow>('sub_tasks',
  `select=id,title,status,assignee_id,deliverable_id,sort_order&deliverable_id=eq.${id}&status=neq.cancelled&order=sort_order.asc,id.asc`)

{
  test.describe('Section D walk', () => {
    test.skip(!WALK, 'WALK=1 runs the review walk')
    test.setTimeout(30 * 60_000)
    test.use({ actionTimeout: 20_000 })

    test('section D — the running campaign, every view, three ways', async ({ browser }) => {
      const walk = new Walk()
      const s = new Session(browser)
      const stamp = Date.now().toString().slice(-6)
      const campaignName = `LUMA Season 3 · review ${stamp}`
      const today = iraqDay(Date.now())
      const phases = [
        { name: 'Warm-up', startsOn: addDays(today, -17), endsOn: addDays(today, -4) },
        { name: 'Draw weeks', startsOn: addDays(today, -3), endsOn: addDays(today, 6) },
        { name: 'Winners', startsOn: addDays(today, 7), endsOn: addDays(today, 20) },
      ]
      const uid: Record<string, string> = {}
      for (const tag of ['am', 'lead', 'tl', 'motiontl', 'content', 'copytl', 'deputy', 'maker', 'animator', 'writer'] as const) {
        uid[tag] = await userIdOf(PEOPLE[tag].email)
      }
      const [{ tenant_id: tenantId }] = await rows<{ tenant_id: string }>('user_profiles', `select=tenant_id&id=eq.${uid.am}`)

      // =============================================================== 0. the campaign ====
      walk.open('setup', '0 · How the walk made its campaign')

      walk.begin('The account manager raises the campaign through the wizard', 'the account manager')
      walk.note(`"${campaignName}" for Luma Retail: three phases (${phases.map((p) => `${p.name} ${p.startsOn} → ${p.endsOn}`).join('; ')}), the middle one holding today (${today}, Iraq). Two workstreams — ${GROUPS.join(' and ')} — every deliverable in one (ADR-0116); seven deliverables, typed from the catalogue, owned by Creative and Content leads.`)
      walk.note('Only the model\'s proposal is mocked (the network edge). The draft, the approval, the task lists and the notifications are the real app on the real database.')
      const [creative] = await rows<{ id: string }>('departments', 'select=id&name=eq.Creative')
      const [contentDept] = await rows<{ id: string }>('departments', 'select=id&name=eq.Content')
      const am = await s.as('am')
      await mockProposal(
        am,
        (Object.keys(PIECES) as Key[]).map((k) => {
          const p = PIECES[k]
          return { name: p.name, typeCode: p.typeCode, quantity: 'quantity' in p ? p.quantity : 1, channel: p.channel, phaseNumber: p.phaseNumber, group: p.group }
        }),
        [{ name: GROUPS[0], departmentId: creative.id }, { name: GROUPS[1], departmentId: contentDept.id }],
      )
      await startCampaign(am, { name: campaignName, client: 'Luma Retail', brand: null, accountManager: PEOPLE.am.name, phases })
      // Step 2 — the brief, a little more than the one required line, so the drawer and the Brief view have words.
      await am.getByTestId('wizard-brief-proposition').fill('Every purchase is a ticket to the draw.')
      await chooseLanguages(am, 'wizard-languages-picker', ['en'])
      await am.getByTestId('wizard-brief-background').fill('Season two doubled footfall; season three adds weekly draw nights.')
      await am.getByTestId('wizard-brief-task').fill('Fill the draw nights and name the winners fast.')
      await am.getByTestId('wizard-brief-insight').fill('People come back for the moment the number is read out.')
      await am.getByTestId('wizard-next').click()
      await expect(am.getByTestId('wizard-step-3')).toBeVisible()
      await expect(am.getByTestId('wizard-busy-propose')).toHaveCount(0, { timeout: 15_000 })
      // Step 3 — an owner on every piece (by its name), and an owner on each workstream.
      for (const id of await pieceIds(am)) {
        const text = (await am.getByTestId(`wizard-work-piece-${id}`).textContent()) ?? ''
        const key = (Object.keys(PIECES) as Key[]).find((k) => text.includes(PIECES[k].name))
        expect(key, `piece row "${text}" is one of the seven`).toBeTruthy()
        await setPieceOwner(am, id, PEOPLE[PIECES[key!].owner].name)
      }
      for (const sel of await am.locator('select[data-testid^="wizard-work-owner-"]').all()) {
        const gid = (await sel.getAttribute('data-testid'))!.replace('wizard-work-owner-', '')
        const gname = await am.getByTestId(`wizard-work-group-name-${gid}`).inputValue()
        const who = gname === GROUPS[0] ? PEOPLE.lead.name : PEOPLE.content.name
        const value = await sel.locator('option').filter({ hasText: who }).first().getAttribute('value')
        expect(value, `${who} is offered as ${gname}'s owner`).toBeTruthy()
        await sel.selectOption(value!)
      }
      await am.getByTestId('wizard-next').click()
      await expect(am.getByTestId('wizard-step-4')).toBeVisible()
      const campaignId = await reviewAndApprove(am)
      walk.report.campaign = campaignName
      await am.context().close()

      let pieces = await piecesOf(campaignId)
      const byKey = {} as Record<Key, PieceRow>
      for (const k of Object.keys(PIECES) as Key[]) {
        const row = pieces.find((p) => p.name === PIECES[k].name)
        expect(row, `${PIECES[k].name} was made`).toBeTruthy()
        byKey[k] = row!
      }
      const phaseRows = await rows<{ id: string; number: number; name: string }>('campaign_phases', `select=id,number,name&campaign_id=eq.${campaignId}&order=number`)
      const wsRows = await rows<{ id: string; name: string }>('workstreams', `select=id,name&campaign_id=eq.${campaignId}`)
      await walk.check('approved with seven deliverables, three phases and two workstreams', async () => {
        const [c] = await rows<{ status: string }>('campaigns', `select=status&id=eq.${campaignId}`)
        expect(c.status).toBe('approved')
        expect(pieces).toHaveLength(7)
        expect(phaseRows).toHaveLength(3)
        expect(wsRows.map((w) => w.name).sort()).toEqual([...GROUPS].sort())
      })
      const taskIds: Record<Key, TaskRow[]> = {} as Record<Key, TaskRow[]>
      for (const k of Object.keys(PIECES) as Key[]) taskIds[k] = await tasksOfPiece(byKey[k].id)
      await walk.check('every deliverable arrived with its task list, waiting for its owner', async () => {
        for (const k of Object.keys(PIECES) as Key[]) {
          expect(taskIds[k].length, PIECES[k].name).toBeGreaterThan(0)
          expect(byKey[k].tasks_approved_at, PIECES[k].name).toBeNull()
        }
      })
      walk.note(`Codes issued: ${(Object.keys(PIECES) as Key[]).map((k) => `${byKey[k].code} ${PIECES[k].name} (${taskIds[k].length} tasks)`).join(' · ')}.`)

      walk.begin('Each owner approves their own task lists on the Grid — one is left waiting', 'each deliverable\'s owner')
      walk.note(`${PEOPLE.tl.name} and ${PEOPLE.motiontl.name} press "Approve all"; ${PEOPLE.lead.name} approves the one left in Creative; ${PEOPLE.content.name} ticks two of the three in Words & Radio and approves those. ${PEOPLE.copytl.name}'s list for "${PIECES.radio.name}" is left waiting — so the list, the Grid and Where is everything have one to show.`)
      for (const tag of ['tl', 'motiontl', 'lead'] as const) {
        const p = await s.as(tag)
        await s.go(p, `/campaigns/${campaignId}`)
        await expect(p.getByTestId('campaign-task-lists')).toBeVisible()
        await p.getByTestId('campaign-task-lists-approve-all').click()
        const mine = (Object.keys(PIECES) as Key[]).filter((k) => PIECES[k].owner === tag)
        for (const k of mine) {
          await expect.poll(async () => (await rows<{ tasks_approved_at: string | null }>('deliverables', `select=tasks_approved_at&id=eq.${byKey[k].id}`))[0].tasks_approved_at, { timeout: 15_000 }).not.toBeNull()
        }
        await p.context().close()
      }
      {
        const p = await s.as('content')
        await s.go(p, `/campaigns/${campaignId}`)
        await expect(p.getByTestId('campaign-task-lists')).toBeVisible()
        await p.getByTestId(`campaign-task-lists-pick-${byKey.copy.id}`).check()
        await p.getByTestId(`campaign-task-lists-pick-${byKey.terms.id}`).check()
        await walk.shot(p, 'setup-content-picks', { of: p.getByTestId('campaign-task-lists'), caption: `${PEOPLE.content.name}'s panel: two of the three ticked. "${PIECES.radio.name}" is ${PEOPLE.copytl.name}'s and is left for them.` })
        await p.getByTestId('campaign-task-lists-approve-picked').click()
        for (const k of ['copy', 'terms'] as const) {
          await expect.poll(async () => (await rows<{ tasks_approved_at: string | null }>('deliverables', `select=tasks_approved_at&id=eq.${byKey[k].id}`))[0].tasks_approved_at, { timeout: 15_000 }).not.toBeNull()
        }
        await p.context().close()
      }
      await walk.check(`six lists approved; "${PIECES.radio.name}" still waits`, async () => {
        pieces = await piecesOf(campaignId)
        for (const p of pieces) {
          if (p.id === byKey.radio.id) expect(p.tasks_approved_at, p.name).toBeNull()
          else expect(p.tasks_approved_at, p.name).not.toBeNull()
        }
      })

      walk.begin('The owners give tasks to makers — some, not all', 'each deliverable\'s owner, through update_task_assignment')
      walk.note('The same RPC the schedule\'s assign dialog calls, signed in as the owner, followed by subtask-schedule as the app does. Each task is given a start today, a due date before its deliverable\'s, four hours, and its owner as the one required reviewer.')
      walk.note('The tasks that will be submitted are set to MANUAL review, so the maker\'s written account stands in for an uploaded file — the local stack has no file store to upload to. Everything else about the review is the product\'s own.')
      const assign = async (owner: Tag, task: TaskRow, maker: Tag, reviewer: Tag, pieceDue: string | null, manual: boolean) => {
        const dueDay = pieceDue ? iraqDay(Date.parse(pieceDue)) : addDays(today, 5)
        const taskDue = addDays(dueDay, -1) > today ? addDays(dueDay, -1) : addDays(today, 1)
        const out = await rpcAs<{ outcome: string; reschedule_needed: boolean }[]>(owner, 'update_task_assignment', {
          p_sub_task: task.id,
          p_title: task.title,
          p_assignee: uid[maker],
          p_reviewers: [{ user_id: uid[reviewer], is_mandatory: true }],
          p_starts_at: `${today}T06:00:00Z`,
          p_due_at: `${taskDue}T14:00:00Z`,
          p_hours: 4,
          p_review_mode: manual ? 'manual' : null,
        })
        expect(out[0]?.outcome, `${task.title} → ${maker}`).toBe('assigned')
        if (out[0]?.reschedule_needed) await fnAs(owner, 'subtask-schedule', { subTaskId: task.id })
      }
      const plan: { key: Key; owner: Tag; makers: (Tag | null)[]; manual: number }[] = [
        // Hero: done, in review, in progress, given and not started; the rest nobody's.
        { key: 'hero', owner: 'lead', makers: ['deputy', 'maker', 'deputy', 'animator'], manual: 2 },
        { key: 'teaser', owner: 'tl', makers: ['deputy', 'maker', 'deputy', 'maker'], manual: 4 },
        { key: 'reel', owner: 'tl', makers: ['deputy', 'maker', 'deputy', 'maker'], manual: 4 },
        { key: 'copy', owner: 'content', makers: ['writer'], manual: 0 },
        { key: 'terms', owner: 'content', makers: ['writer', 'writer', 'writer', 'writer'], manual: 0 },
        { key: 'bumper', owner: 'motiontl', makers: ['animator'], manual: 0 },
      ]
      for (const pl of plan) {
        for (let i = 0; i < pl.makers.length; i++) {
          const t = taskIds[pl.key][i]
          expect(t, `${PIECES[pl.key].name} has a task ${i + 1}`).toBeTruthy()
          await assign(pl.owner, t, pl.makers[i]!, pl.owner, byKey[pl.key].due_at, i < pl.manual)
        }
      }
      await walk.check('the tasks named above are assigned, the rest are nobody\'s', async () => {
        for (const pl of plan) {
          const ts = await tasksOfPiece(byKey[pl.key].id)
          ts.forEach((t, i) => {
            if (i < pl.makers.length) expect(t.assignee_id, t.title).toBe(uid[pl.makers[i]!])
            else expect(t.assignee_id, t.title).toBeNull()
          })
        }
      })

      walk.begin('Makers start, write what they did and submit; reviewers approve', 'the makers and the owners, through the RPCs My Work and the review panel call')
      walk.note(`"${PIECES.teaser.name}" and "${PIECES.reel.name}": all four tasks started, submitted and approved by ${PEOPLE.tl.name} — the last approval signs each deliverable off (Approved, the internal approval). "${PIECES.hero.name}": task 1 done, task 2 submitted and waiting for review, task 3 started, task 4 given and not started. "${PIECES.bumper.name}": ${PEOPLE.animator.name} starts task 1.`)
      const work = async (task: TaskRow, maker: Tag, to: 'in_progress' | 'review' | 'done', reviewer?: Tag) => {
        await rpcAs(maker, 'sub_task_start', { p_id: task.id })
        if (to === 'in_progress') return
        await insertAs(maker, 'review_feedback', { tenant_id: tenantId, sub_task_id: task.id, body: `Done: ${task.title}. Shared with the team on the drive.`, author_user_id: uid[maker] })
        // Sent straight after Start on purpose (the walk stages the states, not the timing): an
        // untimed round is refused unless accepted (ADR-0106 d.2), so it is accepted — "Send anyway".
        await rpcAs(maker, 'sub_task_submit', { p_id: task.id, p_manual_minutes: null, p_accept_untimed: true })
        if (to === 'review') return
        await rpcAs(reviewer!, 'sub_task_approve', { p_sub_task: task.id })
      }
      for (const k of ['teaser', 'reel'] as const) {
        const pl = plan.find((x) => x.key === k)!
        for (let i = 0; i < 4; i++) await work(taskIds[k][i], pl.makers[i]!, 'done', 'tl')
      }
      await work(taskIds.hero[0], 'deputy', 'done', 'lead')
      await work(taskIds.hero[1], 'maker', 'review')
      await work(taskIds.hero[2], 'deputy', 'in_progress')
      await work(taskIds.bumper[0], 'animator', 'in_progress')
      await walk.check('the two finished deliverables approved themselves; the others are in progress', async () => {
        pieces = await piecesOf(campaignId)
        const st = (k: Key) => pieces.find((p) => p.id === byKey[k].id)!.state
        expect(st('teaser')).toBe('approved')
        expect(st('reel')).toBe('approved')
        expect(st('hero')).toBe('in_progress')
        expect(st('bumper')).toBe('in_progress')
        const hero = await tasksOfPiece(byKey.hero.id)
        expect(hero.slice(0, 4).map((t) => t.status)).toEqual(['done', 'review', 'in_progress', 'todo'])
      })

      walk.begin('The account manager marks one approved deliverable Delivered', 'the account manager, through deliverable-transition')
      walk.note(`Delivered is the client's, pressed by hand once the client has approved it and has the final product. "${PIECES.reel.name}" is marked Delivered; "${PIECES.teaser.name}" stays Approved — out with the client.`)
      await fnAs('am', 'deliverable-transition', { deliverableId: byKey.reel.id, to: 'delivered', expectedState: 'approved' })
      await walk.check(`"${PIECES.reel.name}" is delivered`, async () => {
        const [d] = await rows<{ state: string }>('deliverables', `select=state&id=eq.${byKey.reel.id}`)
        expect(d.state).toBe('delivered')
      })

      walk.begin('An outstanding input is recorded on a deliverable', 'the Content lead, in the piece\'s panel')
      walk.note(`"${PIECES.copy.name}" is waiting on the client's legal wording. Recorded where the product records it — "Waiting on someone outside" in the piece's panel on the campaign page (ADR-0132, I68.14).`)
      {
        const p = await s.as('content')
        await s.go(p, `/campaigns/${campaignId}?piece=${byKey.copy.id}`)
        await expect(p.getByTestId('piece-panel')).toBeVisible()
        await p.getByTestId('external-input-add').click()
        await p.getByTestId('external-input-description').fill('Final legal wording for the prize draw')
        await p.getByTestId('external-input-awaited-from').fill('Luma legal team')
        await p.getByTestId('external-input-save').click()
        await expect(p.getByTestId('external-inputs-list')).toContainText('Final legal wording')
        await p.getByTestId('external-inputs-list').scrollIntoViewIfNeeded()
        await walk.shot(p, 'setup-waiting-on', { caption: `The piece's panel on the campaign page: waiting on Luma legal since today.` })
        await p.context().close()
      }
      await walk.check('the input is outstanding in the database', async () => {
        const inputs = await rows('deliverable_pending_inputs', `select=id&deliverable_id=eq.${byKey.copy.id}&satisfied_at=is.null`)
        expect(inputs).toHaveLength(1)
      })

      walk.begin('One deliverable is made late', 'the account manager (the phase) and the walk (the date)')
      walk.note(`"${PIECES.terms.name}" is moved into the first phase, ${phases[0].name}, by the account manager (move_deliverable_to_phase, the Edit dialog's phase field).`)
      await rpcAs('am', 'move_deliverable_to_phase', { p_deliverable: byKey.terms.id, p_phase: phaseRows[0].id })
      const lateDay = addDays(today, -7)
      const staged = await attemptWrite('PATCH', 'deliverables', `id=eq.${byKey.terms.id}`, { due_at: `${lateDay}T14:00:00Z` })
      expect(staged.status, staged.text).toBeLessThan(300)
      walk.note(`STAGED: the due date was moved into the past (${lateDay}) by the walk to show a late deliverable; the app does not allow it. Every other state on these screens was reached through the product.`)
      pieces = await piecesOf(campaignId)
      for (const k of Object.keys(PIECES) as Key[]) byKey[k] = pieces.find((p) => p.id === byKey[k].id)!
      await walk.check(`"${PIECES.terms.name}" is due ${lateDay}, in ${phases[0].name}, and nobody has started it`, async () => {
        expect(byKey.terms.phase_id).toBe(phaseRows[0].id)
        expect(iraqDay(Date.parse(byKey.terms.due_at!))).toBe(lateDay)
        expect((await tasksOfPiece(byKey.terms.id)).every((t) => t.status === 'todo' && t.assignee_id === uid.writer)).toBe(true)
      })

      // What the list's badges must say, from the rows (lib/campaigns/pulse, the same rules).
      const allTasks = (await Promise.all((Object.keys(PIECES) as Key[]).map((k) => tasksOfPiece(byKey[k].id)))).flat()
      const inputs = await rows<{ deliverable_id: string }>('deliverable_pending_inputs', `select=deliverable_id&deliverable_id=in.(${pieces.map((p) => p.id).join(',')})&satisfied_at=is.null`)
      const live = (st: string) => st !== 'done' && st !== 'cancelled'
      const expected = {
        total: pieces.filter((p) => p.state !== 'archived').length,
        delivered: pieces.filter((p) => p.state === 'delivered').length,
        waitingOnClient: pieces.filter((p) => p.state !== 'delivered' && (p.state === 'approved' || inputs.some((i) => i.deliverable_id === p.id))).length,
        tasksUnassigned: pieces
          .filter((p) => p.state !== 'approved' && p.state !== 'delivered' && p.tasks_approved_at != null)
          .reduce((n, p) => n + allTasks.filter((t) => t.deliverable_id === p.id && live(t.status) && !t.assignee_id).length, 0),
        taskListsToApprove: pieces.filter((p) => p.state !== 'approved' && p.state !== 'delivered' && p.tasks_approved_at == null
          && allTasks.some((t) => t.deliverable_id === p.id && live(t.status))).length,
      }
      walk.begin('What the database now holds', 'the walk, reading the rows')
      walk.note(`Seven deliverables: ${PIECES.hero.name} in progress (tasks in four states — its least advanced open task decides, ADR-0131); ${PIECES.teaser.name} Approved; ${PIECES.reel.name} Delivered; ${PIECES.copy.name} Blocked on an input; ${PIECES.radio.name} with its task list unapproved; ${PIECES.terms.name} late and not started; ${PIECES.bumper.name} in progress.`)
      walk.note(`From the rows, the card must read: ${expected.delivered} of ${expected.total} delivered · ${expected.waitingOnClient} waiting on client · ${expected.tasksUnassigned} tasks unassigned · ${expected.taskListsToApprove} task list to approve · and at least one at risk (the late one).`)

      const codeOf = (k: Key) => byKey[k].code ?? ''
      const campaignUrl = `/campaigns/${campaignId}`
      const page_wait = (p: Page) => p.waitForTimeout(500)
      const tab = async (p: Page, v: 'grid' | 'where' | 'seasonMap' | 'board' | 'timeline' | 'brief') => {
        await p.getByTestId(`campaign-tab-${v}`).click()
        await page_wait(p)
      }

      // ================================================================ 1. CG-00 ====
      walk.open('cg00', '1 · CG-00 · Campaigns list (Figma 1652:540)')
      const a = await s.as('am')
      walk.begin('Mine — the list opens on the account manager\'s own', 'the account manager')
      walk.note('FRAME: CG-00 asks for every campaign as a card — where it is in time, how much is delivered, its status and its alerts — with Mine / All, filters and one search that finds a campaign by anything inside it. Deliberately different: progress counts DELIVERED (the client\'s, pressed by hand), not the internal approval; the alerts are four separate badges, each shown only above zero.')
      await s.go(a, '/campaigns')
      await expect(a.getByTestId('campaigns-cards')).toBeVisible({ timeout: 30_000 })
      const [notMine] = await rows<{ id: string }>('campaigns', `select=id&status=in.(approved,pending_approval)&account_manager_id=eq.${await userIdOf(PEOPLE.am2.email)}&order=created_at.desc&limit=1`)
      await walk.check('Mine is pressed; the new campaign is on it, one another account manager runs is not', async () => {
        await expect(a.getByTestId('campaigns-scope-mine')).toHaveAttribute('aria-pressed', 'true')
        await expect(a.getByTestId(`campaign-row-${campaignId}`)).toHaveCount(1)
        await expect(a.getByTestId(`campaign-row-${notMine.id}`)).toHaveCount(0)
      })
      await walk.shot(a, 'cg00-mine', { caption: 'CG-00 as it opens — Mine. Approved campaigns first, then those awaiting approval.' })

      walk.begin('All — every campaign, everyone sees every one', 'the account manager')
      await a.getByTestId('campaigns-scope-all').click()
      await page_wait(a)
      await walk.check('All is pressed; a campaign that is not the account manager\'s is listed too', async () => {
        await expect(a.getByTestId('campaigns-scope-all')).toHaveAttribute('aria-pressed', 'true')
        const [other] = await rows<{ id: string }>('campaigns', `select=id&name=eq.${encodeURIComponent('Harbour Line Rebrand')}`)
        await expect(a.getByTestId(`campaign-row-${other.id}`)).toBeVisible()
      })
      await walk.shot(a, 'cg00-all', { caption: 'All — the whole agency\'s campaigns, most people only read them.' })

      walk.begin('A filter applied — the client', 'the account manager')
      await a.getByTestId('campaigns-filter-client').selectOption('Luma Retail')
      await page_wait(a)
      await walk.check('only Luma Retail\'s campaigns remain; the filter is marked as set', async () => {
        await expect(a.getByTestId('campaigns-filter-client')).toHaveClass(/is-set/)
        await expect(a.getByTestId(`campaign-row-${campaignId}`)).toBeVisible()
        const lines = await a.locator('[data-testid^="campaign-line-"]').allTextContents()
        expect(lines.length).toBeGreaterThan(0)
        for (const l of lines) expect(l).toContain('Luma Retail')
      })
      await walk.shot(a, 'cg00-filter', { caption: 'Client: Luma Retail. The select turns to say it is narrowing the list.' })
      await a.getByTestId('campaigns-filter-client').selectOption('')

      walk.begin(`The smart search finds the campaign by a deliverable code — ${codeOf('teaser')}`, 'the account manager')
      walk.note(`Nobody types "${campaignName}" to find it: the code on a deliverable is enough. The search also reads deliverable names and the people on the work.`)
      await a.getByTestId('campaigns-search').fill(codeOf('teaser'))
      await page_wait(a)
      await walk.check(`the campaign is found by "${codeOf('teaser')}"; the seeded Northwind campaign is not`, async () => {
        await expect(a.getByTestId(`campaign-row-${campaignId}`)).toBeVisible()
        const [nw] = await rows<{ id: string }>('campaigns', `select=id&name=eq.${encodeURIComponent('Northwind Summer Launch')}`)
        await expect(a.getByTestId(`campaign-row-${nw.id}`)).toHaveCount(0)
      })
      await walk.shot(a, 'cg00-search', { caption: `Search "${codeOf('teaser')}" — the campaign holding that deliverable.` })

      walk.begin('The card — its alert badges and its progress', 'the account manager')
      const card = a.getByTestId(`campaign-row-${campaignId}`)
      let cardAtRisk = -1
      await walk.check(`progress reads ${expected.delivered} of ${expected.total}`, async () => {
        await expect(a.getByTestId(`campaign-progress-${campaignId}`)).toContainText(`${expected.delivered} of ${expected.total}`)
      })
      await walk.check('at risk is shown (the late deliverable at least)', async () => {
        await expect(a.getByTestId(`campaign-alert-risk-${campaignId}`)).toContainText(/\d+ at risk/)
        cardAtRisk = Number((await a.getByTestId(`campaign-alert-risk-${campaignId}`).textContent())!.match(/\d+/)![0])
        expect(cardAtRisk).toBeGreaterThanOrEqual(1)
      })
      await walk.check(`waiting on client: ${expected.waitingOnClient} (the approved one, and the one waiting on an input)`, async () => {
        await expect(a.getByTestId(`campaign-alert-client-${campaignId}`)).toContainText(`${expected.waitingOnClient} waiting on client`)
      })
      await walk.check(`tasks unassigned: ${expected.tasksUnassigned}, counted under approved lists only`, async () => {
        await expect(a.getByTestId(`campaign-alert-unassigned-${campaignId}`)).toContainText(`${expected.tasksUnassigned} tasks unassigned`)
      })
      await walk.check(`task lists to approve: ${expected.taskListsToApprove}`, async () => {
        await expect(a.getByTestId(`campaign-task-lists-${campaignId}`)).toContainText(`${expected.taskListsToApprove} task list to approve`)
      })
      await walk.check('the card says where the campaign is in time: the middle phase, 2 of 3', async () => {
        await expect(a.getByTestId(`campaign-line-${campaignId}`)).toContainText(`${phases[1].name} · 2 of 3`)
      })
      await walk.shot(a, 'cg00-card', { of: card, caption: 'The card, close: client, phase, account manager; progress; status and the four alerts.' })

      walk.begin('A card\'s ⋯ menu, open', 'the account manager')
      await a.getByTestId(`campaign-menu-${campaignId}`).click()
      await walk.check('the menu offers Close out for an approved campaign', async () => {
        await expect(a.getByTestId(`campaign-close-out-${campaignId}`)).toBeVisible()
      })
      await walk.shot(a, 'cg00-menu', { caption: 'The ⋯ menu — the actions that are not the card\'s main one. Nothing was pressed.' })
      await a.keyboard.press('Escape')
      await expect(a.getByTestId(`campaign-close-out-${campaignId}`)).toHaveCount(0)

      // ================================================================ 2. CG-01 ====
      walk.open('cg01', '2 · CG-01 · Grid (Figma 1555:2)')
      walk.begin('The whole sheet', 'the account manager')
      walk.note('FRAME: CG-01 asks for the sheet the campaign is run from — grouped by workstream, one row per deliverable with its owner, who executes it, its due date, its status and whether its task list is approved. Deliberately different: every row is the deliverable and its OWNER; "Executed" names everyone holding a task on it; the task-by-task breakdown is in the drawer, not on the row; status is read from the tasks and never set.')
      await s.go(a, campaignUrl)
      await expect(a.getByTestId('campaign-grid')).toBeVisible()
      // ADR-0116 (27 Sep): every campaign piece is in a workstream — there is no "not in a workstream" group any more.
      await walk.check('two groups — the two workstreams — seven rows', async () => {
        await expect(a.locator('[data-testid^="campaign-grid-group-line-"]')).toHaveCount(2)
        for (const k of Object.keys(PIECES) as Key[]) await expect(a.getByTestId(`campaign-deliverable-${byKey[k].id}`)).toBeVisible()
      })
      await walk.check('each row names its owner', async () => {
        for (const k of Object.keys(PIECES) as Key[]) {
          await expect(a.getByTestId(`campaign-deliverable-owner-${byKey[k].id}`)).toHaveText(PEOPLE[PIECES[k].owner].name)
        }
      })
      await walk.check(`"Executed" on ${PIECES.hero.name} names every maker and counts the unassigned`, async () => {
        const ex = a.getByTestId(`campaign-grid-executed-${byKey.hero.id}`)
        for (const m of ['deputy', 'maker', 'animator'] as const) await expect(ex).toContainText(PEOPLE[m].name)
        const unassigned = (await tasksOfPiece(byKey.hero.id)).filter((t) => !t.assignee_id).length
        await expect(ex).toContainText(String(unassigned))
      })
      await walk.check(`the late deliverable's date is red; ${PIECES.radio.name}'s list reads as not approved`, async () => {
        await expect(a.getByTestId(`campaign-grid-due-${byKey.terms.id}`)).toHaveClass(/error-text/)
        await expect(a.getByTestId(`campaign-grid-approved-${byKey.radio.id}`)).toHaveText('Pending')
        await expect(a.getByTestId(`campaign-grid-approved-${byKey.hero.id}`)).not.toHaveText('Pending')
      })
      await walk.check(`${PIECES.teaser.name}, approved internally, reads "Approved" in the Status column (Edward, 24 Sep)`, async () => {
        await expect(a.getByTestId(`campaign-grid-status-${byKey.teaser.id}`)).toHaveText('Approved')
      })
      await walk.shot(a, 'cg01-sheet', { full: true, caption: 'CG-01 — the sheet, whole, with the task-lists panel above it and the workstreams below.' })

      walk.begin('The task-lists panel', 'the account manager')
      walk.note(`The second gate (ADR-0100): each owner approves their own deliverables' task lists. Only lists still waiting show here; the account manager sees "${PIECES.radio.name}" waiting on ${PEOPLE.copytl.name}.`)
      await walk.check(`the panel lists ${PIECES.radio.name}, waiting on ${PEOPLE.copytl.name}`, async () => {
        await expect(a.getByTestId('campaign-task-lists')).toBeVisible()
        await expect(a.getByTestId(`campaign-task-lists-row-${byKey.radio.id}`)).toBeVisible()
      })
      await a.getByTestId(`campaign-task-lists-toggle-${byKey.radio.id}`).click()
      await expect(a.getByTestId(`campaign-task-lists-tasks-${byKey.radio.id}`)).toBeVisible()
      await walk.shot(a, 'cg01-task-lists', { of: a.getByTestId('campaign-task-lists'), caption: 'The panel, with the waiting list opened: the tasks its owner is being asked to agree to, in order.' })

      const gridFilter = async (label: string, slug: string, apply: () => Promise<void>, expectShown: Key[], reset: () => Promise<void>) => {
        walk.begin(`Filter: ${label}`, 'the account manager')
        await apply()
        await page_wait(a)
        await walk.check(`shows ${expectShown.map((k) => PIECES[k].name).join(', ')} — and nothing else`, async () => {
          for (const k of Object.keys(PIECES) as Key[]) {
            await expect(a.getByTestId(`campaign-deliverable-${byKey[k].id}`)).toHaveCount(expectShown.includes(k) ? 1 : 0)
          }
        })
        await walk.shot(a, `cg01-filter-${slug}`, { caption: `Grid filtered by ${label}.` })
        await reset()
        await page_wait(a)
      }
      const ws = (name: string) => wsRows.find((w) => w.name === name)!.id
      await gridFilter(`workstream — ${GROUPS[1]}`, 'workstream',
        () => a.getByTestId('campaign-grid-filter-workstream').selectOption(ws(GROUPS[1])).then(() => {}),
        ['copy', 'radio', 'terms'],
        () => a.getByTestId('campaign-grid-filter-workstream').selectOption('').then(() => {}))
      await gridFilter(`phase — 3. ${phases[2].name}`, 'phase',
        () => a.getByTestId('campaign-phase-filter').selectOption(phaseRows[2].id).then(() => {}),
        ['reel', 'radio', 'bumper'],
        () => a.getByTestId('campaign-phase-filter').selectOption('').then(() => {}))
      await gridFilter(`owner — ${PEOPLE.content.name}`, 'owner',
        () => a.getByTestId('campaign-grid-filter-owner').selectOption(uid.content).then(() => {}),
        ['copy', 'terms'],
        () => a.getByTestId('campaign-grid-filter-owner').selectOption('').then(() => {}))
      await gridFilter('status — In progress', 'status',
        () => a.getByTestId('campaign-grid-filter-status').selectOption('in_progress').then(() => {}),
        // ADR-0131: the Hero's least advanced open task is not finished, so it reads In progress too.
        ['hero', 'bumper'],
        () => a.getByTestId('campaign-grid-filter-status').selectOption('').then(() => {}))
      await gridFilter('Needs approval', 'needs-approval',
        () => a.getByTestId('campaign-grid-filter-approval').click(),
        ['radio'],
        () => a.getByTestId('campaign-grid-filter-approval').click())

      // ================================================================ 3. CG-04 ====
      walk.open('cg04', '3 · CG-04 · The deliverable drawer — the editor, for those who may edit (Figma 1652:1448, ADR-0132)')
      walk.begin(`${PIECES.hero.name}, opened from the Grid`, 'the account manager')
      walk.note('FRAME: CG-04 asks for one deliverable opened — its status, its date, who has it and its whole story. Since ADR-0132 (30 Sep) the campaign page is the one page: for someone who may edit the piece, the drawer carries the editor (the piece panel) — every field, and the task list in four columns (Task · Assignee, read only · Due · Status). The "Open in Deliverables" door is gone; the read-only story is what a maker sees (chapter 9).')
      await a.getByTestId(`campaign-deliverable-open-${byKey.hero.id}`).click()
      await expect(a.getByTestId('piece-drawer')).toBeVisible()
      await expect(a.getByTestId('piece-panel')).toBeVisible()
      const heroTasks = await tasksOfPiece(byKey.hero.id)
      await walk.check('the owner, the code and the status are at the top — In progress: its least advanced open task has not finished (ADR-0131)', async () => {
        await expect(a.getByTestId('piece-drawer-owner')).toContainText(PEOPLE.lead.name)
        await expect(a.getByTestId('piece-drawer-code')).toHaveText(codeOf('hero'))
        await expect(a.getByTestId('piece-drawer-status')).toHaveText(/in progress/i)
      })
      await walk.check('the task list holds every task, each in its own state, the assignee read only', async () => {
        await expect(a.getByTestId(`piece-panel-task-${heroTasks[0].id}`)).toContainText('Done')
        await expect(a.getByTestId(`piece-panel-task-${heroTasks[1].id}`)).toContainText('In review')
        await expect(a.getByTestId(`piece-panel-task-${heroTasks[2].id}`)).toContainText('In progress')
        await expect(a.getByTestId(`piece-panel-task-${heroTasks[3].id}`)).toContainText('Not started')
        await expect(a.getByTestId(`piece-panel-task-${heroTasks[3].id}`)).toContainText(PEOPLE.animator.name)
        await expect(a.getByTestId(`piece-panel-task-${heroTasks[4].id}`)).toContainText('Unassigned')
        for (const task of heroTasks) await expect(a.getByTestId(`piece-panel-task-${task.id}`)).toBeVisible()
        await expect(a.getByTestId('piece-panel-tasks').locator('tbody select')).toHaveCount(0)
      })
      await walk.check('no Nudge, Escalate, Files or "Open in Deliverables" — the panel is the editor, and Close', async () => {
        await expect(a.getByTestId('piece-drawer-close')).toBeVisible()
        await expect(a.getByTestId('piece-drawer-full')).toHaveCount(0)
        await expect(a.getByTestId('piece-drawer').getByRole('button', { name: /nudge|escalate|files|open in deliverables/i })).toHaveCount(0)
      })
      await walk.shot(a, 'cg04-drawer', { caption: 'CG-04 on the one page — the deliverable, its owner, its fields to edit and its tasks one by one, with the brief lines it is made from.' })
      await walk.check('the brief lines the piece is made from are in the drawer', async () => {
        await expect(a.getByTestId('piece-drawer-brief')).toContainText('Every purchase is a ticket to the draw.')
      })
      await a.getByTestId('piece-drawer-close').click()
      await expect(a.getByTestId('piece-drawer')).toHaveCount(0)

      // ================================================================ 4. CG-E1 ====
      walk.open('cge1', '4 · CG-E1 · Editing a deliverable — in its panel (Figma 1710:604, ADR-0132)')
      walk.begin(`Edit on ${PIECES.hero.name}`, 'the account manager')
      walk.note('FRAME: CG-E1 asks for one dialog that edits a deliverable. Since ADR-0132 the grid\'s Edit opens the piece\'s panel: every field is edited in place, a correction to started work is DIRECT for those who may edit it (d.3), and a new date is checked against go-live before it is saved (ADR-0093, I68.12). The client asking for something different still goes as a change request ("The client asked for a change").')
      await a.getByTestId(`campaign-deliverable-edit-${byKey.hero.id}`).click()
      await expect(a.getByTestId('piece-panel')).toBeVisible()
      await walk.check('every field is offered: name, type, quantity, owner, due, channel, language, workstream, phase, brief lines', async () => {
        for (const f of ['name', 'type', 'quantity', 'owner', 'due', 'channel', 'language', 'workstream', 'phase', 'brief-lines']) {
          await expect(a.getByTestId(`piece-panel-${f}`).first()).toBeVisible()
        }
      })
      await walk.check('the owner is offered from the piece\'s own department\'s leads only (ADR-0128)', async () => {
        await a.getByTestId('piece-panel-owner').fill(PEOPLE.content.name)
        await expect(a.getByTestId(`piece-panel-owner-option-${uid.content}`)).toHaveCount(0)
        await a.getByTestId('piece-panel-owner').fill('')
      })
      const [camp] = await rows<{ go_live_at: string | null }>('campaigns', `select=go_live_at&id=eq.${campaignId}`)
      const afterGoLive = camp.go_live_at ? addDays(camp.go_live_at.slice(0, 10), 7) : '2099-12-31'
      await a.getByTestId('piece-panel-due').fill(afterGoLive)
      await walk.check(camp.go_live_at
        ? 'a date a week after go-live warns before Save — after go-live, the client\'s agreement needed (ADR-0093)'
        : 'the campaign has no go-live, so a later date gives no go-live warning', async () => {
        if (camp.go_live_at) await expect(a.getByTestId('piece-panel-due-warning')).toHaveAttribute('data-severity', 'after_go_live')
        else await expect(a.getByTestId('piece-panel-due-warning')).toHaveCount(0)
      })
      await walk.shot(a, 'cge1-panel', { caption: 'CG-E1 in the panel — name, type, quantity; owner, due (checked against go-live), channel, language; workstream, phase; brief lines; then the tasks.' })
      walk.note('Nothing is saved: the drawer is closed next, and the date stays as it was.')
      await a.getByTestId('piece-drawer-close').click()
      await expect(a.getByTestId('piece-drawer')).toHaveCount(0)
      await walk.check('closing without Save saved nothing — the date and the owner are as they were', async () => {
        const [d] = await rows<{ owner_user_id: string; due_at: string | null }>('deliverables', `select=owner_user_id,due_at&id=eq.${byKey.hero.id}`)
        expect(d.owner_user_id).toBe(uid.lead)
        expect(d.due_at?.slice(0, 10)).not.toBe(afterGoLive)
      })

      walk.begin('The client asked for a change — the change request (then Cancel)', 'the account manager')
      walk.note('The client asking for something different spends a round, so it still goes to the owner as a request (ADR-0110 kept for the client, ADR-0132 d.3). It is reached from the panel.')
      await a.getByTestId(`campaign-deliverable-edit-${byKey.hero.id}`).click()
      await a.getByTestId('piece-panel-client-change').click()
      await expect(a.getByTestId('edit-piece-dialog')).toBeVisible()
      await walk.check('the change-request dialog opens on the piece, its status shown and not offered', async () => {
        await expect(a.getByTestId('campaign-deliverable-form-status-in_progress')).toHaveAttribute('aria-current', 'step')
        await expect(a.getByTestId('campaign-deliverable-form-status').locator('select, input')).toHaveCount(0)
      })
      await walk.shot(a, 'cge1-client-change', { caption: 'The client\'s change: the Edit dialog, whose started-work fields go to the owner as a request.' })
      await a.getByTestId('campaign-deliverable-form-cancel').click()
      await expect(a.getByTestId('edit-piece-dialog')).toHaveCount(0)

      walk.begin('Close this deliverable — the confirmation (then Cancel)', 'the account manager')
      await a.getByTestId(`campaign-deliverable-edit-${byKey.hero.id}`).click()
      await expect(a.getByTestId('piece-panel')).toBeVisible()
      await a.getByTestId('piece-panel-close-piece').click()
      await expect(a.getByTestId('piece-panel-close-confirm-dialog')).toBeVisible()
      await walk.check('the question itemises the live work it would call off, and names the makers', async () => {
        await expect(a.getByTestId('piece-panel-close-confirm-detail')).toContainText(PEOPLE.deputy.name)
      })
      await walk.shot(a, 'cge1-close', { caption: 'Close is always asked first, and the question says what is lost, in numbers and names.' })
      await a.getByTestId('piece-panel-close-confirm-cancel').click()
      await expect(a.getByTestId('piece-panel-close-confirm-dialog')).toHaveCount(0)
      await a.getByTestId('piece-drawer-close').click()
      await expect(a.getByTestId('piece-drawer')).toHaveCount(0)
      await walk.check('nothing was closed', async () => {
        const [d] = await rows<{ state: string }>('deliverables', `select=state&id=eq.${byKey.hero.id}`)
        expect(d.state).toBe('in_progress')
      })

      // ================================================================ 5. CG-03 ====
      walk.open('cg03', '5 · CG-03 · Where is everything (Figma 1652:936)')
      walk.begin(`Default — today's phase, ${phases[1].name}`, 'the account manager')
      walk.note('FRAME: CG-03 asks for one row per deliverable — where it is, with whom, for how long, the one thing that moves it, its due date and the clock. Deliberately different: "with whom" is the deliverable\'s OWNER and department, never one task\'s person; "Blocked" is Waiting (sky blue); red means late and nothing else; it opens on the phase today falls in.')
      await tab(a, 'where')
      await expect(a.getByTestId('campaign-panel-where')).toBeVisible()
      const inPhase2: Key[] = ['hero', 'teaser', 'copy']
      await walk.check(`opens on ${phases[1].name} with its three deliverables`, async () => {
        await expect(a.getByTestId('where-filter-phase')).toHaveValue(phaseRows[1].id)
        await expect(a.locator('[data-testid^="where-row-"]')).toHaveCount(inPhase2.length)
        for (const k of inPhase2) await expect(a.getByTestId(`where-row-${byKey[k].id}`)).toBeVisible()
      })
      await walk.check(`${PIECES.copy.name} is Waiting, and says what it waits on`, async () => {
        await expect(a.getByTestId(`where-status-${byKey.copy.id}`)).toHaveText(/blocked/i)
        await expect(a.getByTestId(`where-next-${byKey.copy.id}`)).toContainText('1 outstanding input')
      })
      walk.note(`${PIECES.copy.name}'s clock reads "on time", not "waiting": the clock is the at-risk rule (ADR-0075), which says "waiting" only when an outstanding input is the one thing holding a date at risk. Nothing on this deliverable is at risk yet, so its Where column says Waiting and its clock says on time.`)
      await walk.check(`${PIECES.teaser.name} is with the client — no clock`, async () => {
        await expect(a.getByTestId(`where-clock-${byKey.teaser.id}`)).toHaveText('')
      })
      await walk.shot(a, 'cg03-default', { caption: `Where is everything as it opens — ${phases[1].name}, the phase today falls in.` })

      walk.begin('All phases — and the clock', 'the account manager')
      await a.getByTestId('where-filter-phase').selectOption('')
      await page_wait(a)
      await walk.check('all seven live deliverables are listed', async () => {
        await expect(a.locator('[data-testid^="where-row-"]')).toHaveCount(7)
      })
      await walk.check(`${PIECES.terms.name} is LATE, first in the list, in red`, async () => {
        await expect(a.getByTestId(`where-clock-${byKey.terms.id}`)).toHaveText(/late by/)
        await expect(a.locator('[data-testid^="where-row-"]').first()).toHaveAttribute('data-testid', `where-row-${byKey.terms.id}`)
        await expect(a.getByTestId(`where-row-${byKey.terms.id}`)).toHaveClass(/is-late/)
      })
      await walk.check(`${PIECES.radio.name}: its owner approves its task list next`, async () => {
        await expect(a.getByTestId(`where-next-${byKey.radio.id}`)).toContainText(PEOPLE.copytl.name)
      })
      await walk.check(`${PIECES.reel.name} is delivered`, async () => {
        await expect(a.getByTestId(`where-status-${byKey.reel.id}`)).toHaveText(/delivered/i)
      })
      const clocks = await Promise.all((Object.keys(PIECES) as Key[]).map(async (k) => `${PIECES[k].name}: ${(await a.getByTestId(`where-clock-${byKey[k].id}`).textContent())?.trim() || '— (finished)'}`))
      walk.note(`The clock, as the data gives it: ${clocks.join(' · ')}.`)
      await walk.check('the clock shows late and on time at once; finished work has none', async () => {
        const texts = await a.locator('[data-testid^="where-clock-"]').allTextContents()
        expect(texts.some((t) => /late by/.test(t))).toBe(true)
        expect(texts).toContain('on time')
        expect(texts.filter((t) => t.trim() === '')).toHaveLength(2)
      })
      await walk.check('the list card and this page agree on how many are late or at risk', async () => {
        const texts = await a.locator('[data-testid^="where-clock-"]').allTextContents()
        const here = texts.filter((t) => /late by|at risk/.test(t)).length
        expect(here, 'late or at risk on Where is everything').toBe(cardAtRisk)
      })
      await walk.shot(a, 'cg03-all', { caption: 'All phases: late first, then by date; finished work at the end with no clock.' })
      const staleNote = 'STAGED: the late deliverable\'s due date was moved into the past by the walk to show a late deliverable; the app does not allow it.'
      walk.note(staleNote)

      // ================================================================ 6. CG-02 ====
      walk.open('cg02', '6 · CG-02 · Season map (Figma 1577:2)')
      walk.begin('The map', 'the account manager')
      walk.note('FRAME: CG-02 asks for workstream × phase, one coloured square per deliverable, the current phase marked. Deliberately different: phases keep their names and dates, but the frame\'s event lines ("▲ Draw Night 1") are left out; Blocked is Waiting (sky blue); red is late only; internally approved shows as Approved (light green) and Delivered is the client\'s.')
      await tab(a, 'seasonMap')
      await expect(a.getByTestId('campaign-panel-season-map')).toBeVisible()
      await walk.check(`three phases, ${phases[1].name} marked current`, async () => {
        for (const ph of phaseRows) await expect(a.getByTestId(`season-map-phase-${ph.id}`)).toContainText(ph.name)
        await expect(a.getByTestId(`season-map-phase-${phaseRows[1].id}`)).toHaveClass(/is-current/)
        await expect(a.getByTestId(`season-map-phase-${phaseRows[0].id}`)).not.toHaveClass(/is-current/)
      })
      const squareOf: Record<Key, string> = { hero: 'in_progress', teaser: 'approved', reel: 'delivered', copy: 'waiting', radio: 'not_started', terms: 'late', bumper: 'in_progress' }
      await walk.check('each square is coloured by where its deliverable is — seven colours, seven deliverables', async () => {
        for (const k of Object.keys(PIECES) as Key[]) await expect(a.getByTestId(`season-square-${byKey[k].id}`)).toHaveClass(new RegExp(`is-${squareOf[k]}\\b`))
      })
      await walk.check(`${PIECES.terms.name} sits in ${phases[0].name}, in its workstream's row`, async () => {
        await expect(a.getByTestId(`season-map-cell-${ws(GROUPS[1])}-${phaseRows[0].id}`).getByTestId(`season-square-${byKey.terms.id}`)).toBeVisible()
      })
      await walk.shot(a, 'cg02-map', { full: true, caption: 'CG-02 — each row a workstream, each column a phase, each square a deliverable.' })
      walk.note(staleNote)

      walk.begin('A square pressed opens the drawer', 'the account manager')
      await a.getByTestId(`season-square-${byKey.terms.id}`).click()
      await expect(a.getByTestId('piece-drawer')).toBeVisible()
      await walk.check('the drawer is the late deliverable, "Was due" in red', async () => {
        await expect(a.getByTestId('piece-drawer')).toContainText(PIECES.terms.name)
        await expect(a.getByTestId('piece-drawer-due')).toHaveClass(/tag-breach/)
        await expect(a.getByTestId('piece-drawer-due')).toContainText('Was due')
      })
      await walk.shot(a, 'cg02-drawer', { caption: `The red square is ${PIECES.terms.name}: every task given to ${PEOPLE.writer.name}, none started, and the date passed.` })
      await a.getByTestId('piece-drawer-close').click()

      // ================================================================ 7. CG-05 ====
      walk.open('cg05', '7 · CG-05 · Board (Figma 1653:543)')
      walk.begin('Every column, each with its deliverable', 'the account manager')
      walk.note('FRAME: CG-05 asks for every deliverable as a card in the column of its stage. Deliberately different: a card is the deliverable and its OWNER, never its tasks; nothing is dragged — the columns move as the work does; the frame\'s Blocked column is Waiting; Approved (internal) and Delivered (the client\'s, pressed by hand) are separate columns.')
      await tab(a, 'board')
      await expect(a.getByTestId('campaign-panel-board')).toBeVisible()
      const columnOf: Record<Key, string> = { radio: 'unassigned', terms: 'notStarted', bumper: 'inProgress', copy: 'waiting', hero: 'inProgress', teaser: 'approved', reel: 'delivered' }
      for (const k of Object.keys(columnOf) as Key[]) {
        await walk.check(`${columnOf[k]} holds ${PIECES[k].name}, with its owner ${PEOPLE[PIECES[k].owner].name}`, async () => {
          await expect(a.getByTestId(`board-column-${columnOf[k]}`).getByTestId(`board-card-${byKey[k].id}`)).toBeVisible()
          await expect(a.getByTestId(`board-card-owner-${byKey[k].id}`)).toHaveText(PEOPLE[PIECES[k].owner].name)
          // ADR-0131: the Hero reads In progress now, beside the Motion bumper — that column holds two.
          const inColumn = (Object.keys(columnOf) as Key[]).filter((x) => columnOf[x] === columnOf[k]).length
          await expect(a.getByTestId(`board-count-${columnOf[k]}`)).toHaveText(String(inColumn))
        })
      }
      await walk.check('the late card says so; no card is draggable', async () => {
        await expect(a.getByTestId(`board-card-late-${byKey.terms.id}`)).toBeVisible()
        await expect(a.locator('[draggable="true"]')).toHaveCount(0)
      })
      await walk.check('the seven columns sit side by side in one row', async () => {
        const first = await a.getByTestId('board-column-unassigned').boundingBox()
        const last = await a.getByTestId('board-column-delivered').boundingBox()
        expect(last!.y, 'Delivered starts on the same line as Unassigned').toBe(first!.y)
      })
      await walk.shot(a, 'cg05-board', { full: true, caption: 'CG-05 — seven columns, one deliverable in each: the stages as the work put them.' })
      walk.note(staleNote)

      walk.begin('A card pressed opens the drawer', 'the account manager')
      await a.getByTestId(`board-card-${byKey.copy.id}`).click()
      await expect(a.getByTestId('piece-drawer')).toBeVisible()
      await walk.check(`the drawer is ${PIECES.copy.name}`, async () => {
        await expect(a.getByTestId('piece-drawer')).toContainText(PIECES.copy.name)
      })
      await walk.shot(a, 'cg05-drawer', { caption: `${PIECES.copy.name}, from the Waiting column: one task with ${PEOPLE.writer.name}, the rest nobody's yet.` })
      await a.getByTestId('piece-drawer-close').click()

      // ================================================================ 8. CG-06 ====
      walk.open('cg06', '8 · CG-06 · Timeline (Figma 1653:851)')
      walk.begin('The window — two weeks, opening three days before today', 'the account manager')
      walk.note('FRAME: CG-06 asks for a bar per deliverable across the working days it has — Friday and Saturday shaded, red once past due, hollow when nobody is on it. Deliberately different: one bar per DELIVERABLE, never per task (the drawer carries the tasks); the frame\'s event line is left out.')
      await tab(a, 'timeline')
      await expect(a.getByTestId('campaign-panel-timeline')).toBeVisible()
      await walk.check('today is marked; Friday and Saturday are shaded', async () => {
        await expect(a.getByTestId(`timeline-day-${today}`)).toHaveClass(/is-today/)
        const off = await a.locator('[data-testid^="timeline-day-"]').evaluateAll((els) => els.filter((e) => e.classList.contains('is-off')).length)
        expect(off).toBeGreaterThanOrEqual(2)
      })
      await walk.check(`${PIECES.terms.name}'s bar is red and runs to today; ${PIECES.copy.name}'s is Waiting; ${PIECES.teaser.name}'s is Approved`, async () => {
        await expect(a.getByTestId(`timeline-bar-${byKey.terms.id}`)).toHaveAttribute('data-tone', 'late')
        await expect(a.getByTestId(`timeline-bar-${byKey.copy.id}`)).toHaveAttribute('data-tone', 'waiting')
        await expect(a.getByTestId(`timeline-bar-${byKey.teaser.id}`)).toHaveAttribute('data-tone', 'approved')
      })
      await walk.check('every row names its owner', async () => {
        for (const k of Object.keys(PIECES) as Key[]) await expect(a.getByTestId(`timeline-owner-${byKey[k].id}`)).toHaveText(PEOPLE[PIECES[k].owner].name)
      })
      await walk.shot(a, 'cg06-window', { full: true, caption: 'CG-06 — the window as it opens. Bars past the window\'s end say so in words.' })
      walk.note(staleNote)

      walk.begin('Next week', 'the account manager')
      const range = await a.getByTestId('timeline-range').textContent()
      await a.getByTestId('timeline-next').click()
      await page_wait(a)
      await walk.check('the window moved a week', async () => {
        await expect(a.getByTestId('timeline-range')).not.toHaveText(range!)
        await expect(a.getByTestId(`timeline-day-${addDays(today, 4)}`)).toBeVisible()
      })
      await walk.shot(a, 'cg06-next', { full: true, caption: 'One week on: the Winners phase\'s deliverables come into the window.' })

      walk.begin('A bar pressed opens the drawer', 'the account manager')
      await a.getByTestId('timeline-prev').click()
      await page_wait(a)
      await a.getByTestId(`timeline-bar-${byKey.hero.id}`).click()
      await expect(a.getByTestId('piece-drawer')).toBeVisible()
      await walk.check(`the drawer is ${PIECES.hero.name}`, async () => {
        await expect(a.getByTestId('piece-drawer')).toContainText(PIECES.hero.name)
      })
      await walk.shot(a, 'cg06-drawer', { caption: `The bar for ${PIECES.hero.name} opens the same drawer as every other view.` })
      await a.getByTestId('piece-drawer-close').click()

      // ================================================================ 9. CG-07 ====
      walk.open('cg07', '9 · CG-07 · Brief (Figma 1711:522)')
      walk.begin('The brief, with its side rail', 'the account manager')
      walk.note('FRAME: CG-07 asks for the brief itself, beside a rail that says how complete it is and what it produced. Deliberately different: "What it produced" uses the season map\'s squares and colours (Waiting sky blue, Approved light green); nothing else.')
      await tab(a, 'brief')
      await expect(a.getByTestId('campaign-panel-brief')).toBeVisible()
      await walk.check('the proposition heads the brief', async () => {
        await expect(a.getByTestId('brief-view-headline')).toHaveText('Every purchase is a ticket to the draw.')
      })
      await walk.check('"What it produced" holds a square for each of the seven', async () => {
        for (const k of Object.keys(PIECES) as Key[]) await expect(a.getByTestId('brief-produced').getByTestId(`season-square-${byKey[k].id}`)).toBeVisible()
      })
      await walk.check('"What it produced" colours each square as the season map does (Launch copy Waiting)', async () => {
        for (const k of Object.keys(PIECES) as Key[]) {
          await expect(a.getByTestId('brief-produced').getByTestId(`season-square-${byKey[k].id}`), PIECES[k].name).toHaveClass(new RegExp(`is-${squareOf[k]}\\b`))
        }
      })
      await walk.check('the empty-fields card names what is not written — four of nine are', async () => {
        await expect(a.getByTestId('brief-itself-filled')).toHaveText('4 of 9')
        await expect(a.getByTestId('brief-empty-callout')).toBeVisible()
        await expect(a.getByTestId('brief-empty-fill')).toBeVisible()
      })
      await walk.shot(a, 'cg07-brief', { full: true, caption: 'CG-07 — the brief, and the rail: how much of it is written, what it produced, and what is empty.' })
      await walk.shot(a, 'cg07-rail', { of: a.getByTestId('brief-view-rail'), caption: 'The rail, close.' })
      await a.context().close()

      // ================================================================ 10. maker ====
      walk.open('maker', '10 · As a team member')
      const mk = await s.as('maker')
      walk.begin('The list — no ⋯ menu on the card', PEOPLE.maker.name)
      walk.note('FRAME: a team member reads every campaign and edits none of them: no Edit on any view, no ⋯ menu on the list.')
      await s.go(mk, '/campaigns')
      await expect(mk.getByTestId('campaigns-cards')).toBeVisible({ timeout: 30_000 })
      await mk.getByTestId('campaigns-search').fill(codeOf('teaser'))
      await page_wait(mk)
      await walk.check('the campaign is found; its card has no ⋯ menu and there is no New', async () => {
        await expect(mk.getByTestId(`campaign-row-${campaignId}`)).toBeVisible()
        await expect(mk.getByTestId(`campaign-menu-${campaignId}`)).toHaveCount(0)
        await expect(mk.getByTestId('campaigns-new-brief')).toHaveCount(0)
      })
      await walk.shot(mk, 'maker-list', { caption: 'The same card, for somebody who holds tasks on it: read, open — nothing else.' })

      walk.begin('The campaign page — no Edit anywhere', PEOPLE.maker.name)
      await s.go(mk, campaignUrl)
      await expect(mk.getByTestId('campaign-grid')).toBeVisible()
      await walk.check('the Grid offers Open on every row and Edit on none; no + Add, no Needs-approval buttons to press', async () => {
        await expect(mk.locator('[data-testid^="campaign-deliverable-open-"]')).toHaveCount(7)
        await expect(mk.locator('[data-testid^="campaign-deliverable-edit-"]')).toHaveCount(0)
        await expect(mk.getByTestId('campaign-add-deliverable')).toHaveCount(0)
        await expect(mk.getByTestId('campaign-task-lists-approve-all')).toHaveCount(0)
      })
      await walk.shot(mk, 'maker-grid', { full: true, caption: 'The Grid for a team member: every row, Open only.' })
      await mk.getByTestId(`campaign-deliverable-open-${byKey.hero.id}`).click()
      await expect(mk.getByTestId('piece-drawer')).toBeVisible()
      await walk.check('the drawer has no Edit', async () => {
        await expect(mk.getByTestId('piece-drawer-edit')).toHaveCount(0)
      })
      await walk.shot(mk, 'maker-drawer', { caption: `The drawer for ${PEOPLE.maker.name}: their own task in review, in the whole story — and no Edit.` })
      await mk.getByTestId('piece-drawer-close').click()
      for (const [v, sel] of [['where', 'where-edit-'], ['board', 'board-card-edit-'], ['timeline', 'timeline-edit-']] as const) {
        await tab(mk, v)
        await walk.check(`${v}: no Edit`, async () => {
          await expect(mk.locator(`[data-testid^="${sel}"]`)).toHaveCount(0)
        })
      }
      await tab(mk, 'board')
      await walk.shot(mk, 'maker-board', { full: true, caption: 'The Board for a team member — the same cards, no Edit link under any.' })
      await mk.context().close()

      // ================================================================ 11. Arabic ====
      walk.open('arabic', '11 · In Arabic')
      const ar = await s.as('am')
      walk.begin('The Grid, right to left', 'the account manager')
      walk.note('FRAME: the same screens in Arabic, right to left. Names written in Latin stay as they are.')
      await s.go(ar, campaignUrl, 'ar')
      await expect(ar.getByTestId('campaign-grid')).toBeVisible()
      await walk.check('the page is right-to-left and in Arabic', async () => {
        await expect(ar.locator('html')).toHaveAttribute('dir', 'rtl')
        await expect(ar.getByTestId('campaign-tab-grid')).not.toHaveText('Grid')
      })
      await walk.shot(ar, 'ar-grid', { full: true, caption: 'CG-01 in Arabic.' })

      walk.begin('The Board, right to left', 'the account manager')
      await tab(ar, 'board')
      await walk.check('every card in its column, right to left', async () => {
        for (const k of Object.keys(columnOf) as Key[]) await expect(ar.getByTestId(`board-column-${columnOf[k]}`).getByTestId(`board-card-${byKey[k].id}`)).toBeVisible()
      })
      await walk.shot(ar, 'ar-board', { full: true, caption: 'CG-05 in Arabic — the columns read from the right.' })

      walk.begin('The drawer, right to left', 'the account manager')
      await ar.getByTestId(`board-card-${byKey.hero.id}`).click()
      await expect(ar.getByTestId('piece-drawer')).toBeVisible()
      await walk.check('the drawer holds every task', async () => {
        await expect(ar.getByTestId('piece-panel-tasks').locator('tbody tr[data-testid^="piece-panel-task-"]')).toHaveCount(heroTasks.length)
      })
      await walk.shot(ar, 'ar-drawer', { caption: 'CG-04 in Arabic.' })
      await ar.getByTestId('piece-drawer-close').click()
      // Back to English, so the account manager's next session opens as it did before the walk.
      await s.go(ar, campaignUrl, 'en')
      await ar.context().close()

      // ================================================================ 12. phone ====
      walk.open('phone', '12 · On a phone (390 wide)')
      const ph = await s.as('am', { width: 390, height: 844 })
      walk.begin('The list', 'the account manager')
      walk.note('FRAME: the same three screens at 390 pixels wide — the width of a phone.')
      await s.go(ph, '/campaigns')
      await expect(ph.getByTestId('campaigns-cards')).toBeVisible({ timeout: 30_000 })
      await ph.getByTestId('campaigns-search').fill(codeOf('teaser'))
      await page_wait(ph)
      await walk.check('the card is on screen and the page does not scroll sideways', async () => {
        await expect(ph.getByTestId(`campaign-row-${campaignId}`)).toBeVisible()
        const over = await ph.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        expect(over).toBeLessThanOrEqual(1)
      })
      await walk.shot(ph, 'phone-list', { full: true, caption: 'The list on a phone, searched for the campaign.' })

      walk.begin('The Grid', 'the account manager')
      await s.go(ph, campaignUrl)
      await expect(ph.getByTestId('campaign-grid')).toBeVisible()
      await walk.check('the sheet scrolls inside its own box; the page does not scroll sideways', async () => {
        const over = await ph.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        expect(over).toBeLessThanOrEqual(1)
      })
      await walk.shot(ph, 'phone-grid', { full: true, caption: 'The Grid on a phone.' })

      walk.begin('The Board', 'the account manager')
      await tab(ph, 'board')
      await walk.check('every card is there', async () => {
        for (const k of Object.keys(columnOf) as Key[]) await expect(ph.getByTestId(`board-card-${byKey[k].id}`)).toHaveCount(1)
      })
      await walk.shot(ph, 'phone-board', { full: true, caption: 'The Board on a phone.' })
      await ph.context().close()

      walk.open('end', 'The campaign is left as it is')
      walk.begin('What stays on the local stack', 'the walk')
      walk.note(`"${campaignName}" stays approved and running, with the states above, so the screens can be opened again by hand. Nothing was saved from Edit, nothing was closed out.`)
    })
  })
}
