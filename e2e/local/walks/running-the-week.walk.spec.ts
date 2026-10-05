import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
import { PEOPLE } from '../fixtures'
import { attemptWrite, rows, userIdOf } from '../helpers/db'
import { mockProposal, pieceIds, reviewAndApprove, setPieceOwner, startCampaign, chooseLanguages } from '../helpers/campaign-wizard'
import { approveSingleJob, fillSingleJobToReview, releaseSingleJob, type ReleasedJob, pickJobLanguages } from '../helpers/single-job'
import {
  PNG, Session, Walk, addDays, dragOnSchedule, dragOnTeam, fnAs, insertAs, iraqDay, rpcAs, runEscalationSweep, sundayOf, type Tag,
} from './running-the-week.kit'

/**
 * Review walk — running the week (I59, 25 Sep): My Work, Needs you, the task page, the team and
 * department views, and the new flows (ADR-0105 – 0113), role by role, EN then a short AR pass.
 *
 * ONE STORY, made here through the product: a campaign with two workstreams and four pieces, and a
 * single job. The account manager raises both; the owners approve their task lists and give tasks
 * with hours; then the maker's week, the owner's and team lead's answers, the department lead's
 * view, the account manager's answers, Traffic and the admin, and the cross-cutting bits.
 *
 * THE MAKER IS THE DEPUTY (Dev Deputy Lead), as in every I59 coverage spec: the long-lived local
 * database has given Dev Maker ~250 live tasks (review-and-my-work.spec.ts says why). Dev Maker
 * still appears — as the person the owners book, and as the full person the L7 warning is about.
 *
 * What the walk STAGES (marked amber in the report, and nothing else):
 *   * the over-capacity card — the admin lowers the tenant's over-capacity percentage on the
 *     Escalations screen for one look, then puts it back;
 *   * one escalation — the single job's task-list approval is moved 25 hours back with the service
 *     role, and the sweep (`stall-sweep`'s job, service role only) is run once.
 *
 * NO FALLBACKS. The story's set-up is hard (the walk stops if the product refuses it); every step
 * after that is recorded — a step that cannot be done is a failed check that says why, and the walk
 * goes on to the next. The test fails at the end if any check failed; read report.json.
 *
 * Run (the local stack, after the setup project has written e2e/.auth/*):
 *   WALK=1 npx playwright test --config playwright.local.config.ts e2e/local/walks/running-the-week.walk.spec.ts
 *
 * Writes `Claude outputs/reports/<date>-running-the-week/REPORT.html` — one self-contained file.
 */
const WALK = process.env.WALK === '1'
const DATE = process.env.WALK_DATE ?? iraqDay(Date.now())
const OUT = path.resolve('Claude outputs', 'reports', `${DATE}-running-the-week`)

type TaskRow = { id: string; title: string; status: string; assignee_id: string | null; starts_at: string | null; due_at: string | null; sort_order: number }
const tasksOfPiece = (id: string) => rows<TaskRow>('sub_tasks',
  `select=id,title,status,assignee_id,starts_at,due_at,sort_order&deliverable_id=eq.${id}&status=neq.cancelled&order=sort_order.asc,id.asc`)
const taskRow = async (id: string) => (await rows<TaskRow>('sub_tasks', `select=id,title,status,assignee_id,starts_at,due_at,sort_order&id=eq.${id}`))[0]!
const statusOf = async (id: string) => (await taskRow(id))?.status
const messagesOf = (d: string, kind: string) =>
  rows<{ id: string; status: string | null; recipients: string[] }>('piece_messages', `select=id,status,recipients&deliverable_id=eq.${d}&kind=eq.${kind}&order=created_at.asc`)
const inputsOf = (d: string) =>
  rows<{ id: string; sub_task_id: string | null; satisfied_at: string | null; description: string }>(
    'deliverable_pending_inputs', `select=id,sub_task_id,satisfied_at,description&deliverable_id=eq.${d}&order=requested_at.asc`)
const pendingExtension = async (t: string) =>
  (await rows<{ request_id: string; stage: string }>('sub_task_extension_requests', `select=request_id,stage&sub_task_id=eq.${t}&is_pending=eq.true`))[0]
const changeRequest = async (id: string) =>
  (await rows<{ id: string; status: string; closed_at: string | null }>('deliverable_change_requests', `select=id,status,closed_at&id=eq.${id}`))[0]
async function resourceIdOf(name: string): Promise<string> {
  const [r] = await rows<{ id: string }>('resources', `select=id&name=eq.${encodeURIComponent(name)}&is_active=eq.true`)
  expect(r, `resource ${name}`).toBeTruthy()
  return r.id
}

/** The four campaign pieces, in two workstreams (both Creative) — ADR-0116: every campaign piece is in one. */
const PIECES = {
  kv:     { name: 'Autumn key visual', typeCode: 'ADV-003', channel: 'Instagram', group: 0, owner: 'tl' },
  reel:   { name: 'Launch reel',       typeCode: 'ADV-002', channel: 'YouTube',   group: 1, owner: 'lead' },
  poster: { name: 'Store poster',      typeCode: 'ADV-003', channel: 'In-store',  group: 0, owner: 'lead' },
  teaser: { name: 'Teaser cut-down',   typeCode: 'ADV-003', channel: 'TikTok',    group: 1, owner: 'lead' },
} as const
type Key = keyof typeof PIECES
const GROUPS = ['Autumn visuals', 'Motion & social'] as const

/** The org page's "Done" dialog after a save: read it as a success, close it. */
async function orgSaved(page: Page) {
  const dialog = page.getByTestId('org-banner-dialog')
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await expect(dialog).not.toContainText(/could not|only someone/i)
  await page.getByTestId('org-banner-close').click()
  await expect(page.locator('.notice-dialog')).toHaveCount(0)
}
type Rule = { id: string; kind: string; hours: number; role_ids: string[]; relative: string[] }
const ruleOf = async (kind: string) => (await rows<Rule>('tenant_escalation_rules', `select=id,kind,hours,role_ids,relative&kind=eq.${kind}`))[0]!
const overCapacityPct = async () => (await rows<{ over_capacity_pct: number }>('tenant_reminder_settings', 'select=over_capacity_pct'))[0]!.over_capacity_pct
/** Put a rule back to what it was, through the screen (escalation-settings.spec.ts's restore). */
async function restoreRule(page: Page, was: Rule) {
  const kind = was.kind
  await page.getByTestId(`escalation-hours-${kind}`).fill(String(was.hours))
  const now = await ruleOf(kind)
  for (const id of now.role_ids.filter((x) => !was.role_ids.includes(x))) await page.getByTestId(`escalation-role-remove-${kind}-${id}`).click()
  for (const id of was.role_ids.filter((x) => !now.role_ids.includes(x))) await page.getByTestId(`escalation-role-add-${kind}`).selectOption(id)
  for (const p of ['owner', 'account_manager', 'owner_department_lead', 'assignee_team_lead', 'reviewers']) {
    const box = page.getByTestId(`escalation-person-${kind}-${p}`)
    if ((await box.isChecked()) !== was.relative.includes(p)) await box.click()
  }
}

{
  test.describe('Running the week walk', () => {
    test.skip(!WALK, 'WALK=1 runs the review walk')
    test.setTimeout(45 * 60_000)
    test.use({ actionTimeout: 20_000 })

    test('running the week — My Work, Needs you, the task page, team and department, the new flows', async ({ browser }) => {
      const walk = new Walk(OUT, 'Running the week — My Work, Needs you, Team')
      const s = new Session(browser)
      // Plain names (Edward, 25 Sep: human-readable): the walk runs on a freshly reset database, so
      // nothing it makes collides with an earlier run.
      const today = iraqDay(Date.now())
      const dow = new Date(`${today}T12:00:00Z`).getUTCDay()
      // The planned work sits in NEXT week (Sunday–Thursday), so every bar has working days to land
      // on whatever day the walk is run; the team views open on that week.
      const week = addDays(sundayOf(today), 7)
      const campaignName = 'Northwind Autumn Push'
      const jobTitle = 'Autumn social set'
      const uid: Record<string, string> = {}
      for (const tag of ['am', 'lead', 'tl', 'deputy', 'maker', 'animator', 'writer', 'traffic', 'motiontl'] as const) uid[tag] = await userIdOf(PEOPLE[tag].email)
      const [{ tenant_id: tenantId }] = await rows<{ tenant_id: string }>('user_profiles', `select=tenant_id&id=eq.${uid.am}`)
      const res = {
        deputy: await resourceIdOf(PEOPLE.deputy.name),
        maker: await resourceIdOf(PEOPLE.maker.name),
        animator: await resourceIdOf(PEOPLE.animator.name),
      }
      const restore: { pct: number | null; extensionAm: Rule | null } = { pct: null, extensionAm: null }
      // The rules panels (Before you start, the task page, the review screen) show only what a job carries,
      // and a job carries its CLIENT's dos and don'ts, snapshotted at release (src/lib/brief/rules.ts).
      // Northwind has none on this database, so the walk gives it two for the run and puts them back after.
      const [northwind] = await rows<{ id: string; profile: Record<string, unknown> | null }>('clients', 'select=id,profile&name=eq.Northwind%20Beverages')
      const northwindProfile = northwind!.profile ?? {}
      await attemptWrite('PATCH', 'clients', `id=eq.${northwind!.id}`, { profile: { ...northwindProfile, rules: [
        { kind: 'do', text: 'Arabic is the master; English follows it' },
        { kind: 'dont', text: 'Never show the price without the offer terms' },
      ] } })

      walk.story(`The story: "${campaignName}" for Northwind Beverages — two workstreams (${GROUPS.join(', ')}) and four pieces, owned by ${PEOPLE.tl.name} (Design team lead) and ${PEOPLE.lead.name} (Creative department lead) — and one single job, "${jobTitle}", owned by ${PEOPLE.lead.name}. ${PEOPLE.am.name} is the account manager on both.`)
      walk.story(`The maker is ${PEOPLE.deputy.name}: the local database has given ${PEOPLE.maker.name} about 250 live tasks from earlier test runs, which would bury the screens. ${PEOPLE.maker.name} still appears — booked by the owners, and as the full person the "at the ceiling" warning is about.`)
      walk.story(`Walked on ${today} (Iraq). The planned campaign work sits in the week of ${week}, so the team views open on that week.`)

      try {
        // ================================================================ 0. the story ====
        walk.open('setup', '0 · How the walk made its story')

        walk.begin('The account manager raises the campaign through the wizard', PEOPLE.am.name)
        walk.note('Only the model\'s proposal is mocked (the network edge). The draft, the approval, the task lists and the notifications are the real app on the real database.')
        const [creative] = await rows<{ id: string }>('departments', 'select=id&name=eq.Creative')
        const am0 = await s.as('am')
        await mockProposal(
          am0,
          (Object.keys(PIECES) as Key[]).map((k) => ({ name: PIECES[k].name, typeCode: PIECES[k].typeCode, channel: PIECES[k].channel, phaseNumber: 1, group: PIECES[k].group })),
          [{ name: GROUPS[0], departmentId: creative.id }, { name: GROUPS[1], departmentId: creative.id }],
        )
        await startCampaign(am0, {
          name: campaignName, client: 'Northwind Beverages', accountManager: PEOPLE.am.name,
          phases: [
            { name: 'Launch', startsOn: addDays(today, -3), endsOn: addDays(week, 6) },
            { name: 'Sustain', startsOn: addDays(week, 7), endsOn: addDays(week, 27) },
          ],
        })
        await am0.getByTestId('wizard-brief-proposition').fill('Autumn tastes better cold.')
        await chooseLanguages(am0, 'wizard-languages-picker', ['en'])
        await am0.getByTestId('wizard-brief-background').fill('The summer range sold out; autumn brings two new flavours.')
        await am0.getByTestId('wizard-brief-task').fill('Launch the two autumn flavours in store and on social.')
        await am0.getByTestId('wizard-next').click()
        await expect(am0.getByTestId('wizard-step-3')).toBeVisible()
        await expect(am0.getByTestId('wizard-busy-propose')).toHaveCount(0, { timeout: 15_000 })
        for (const id of await pieceIds(am0)) {
          const text = (await am0.getByTestId(`wizard-work-piece-${id}`).textContent()) ?? ''
          const key = (Object.keys(PIECES) as Key[]).find((k) => text.includes(PIECES[k].name))
          expect(key, `piece row "${text}" is one of the four`).toBeTruthy()
          await setPieceOwner(am0, id, PEOPLE[PIECES[key!].owner].name)
        }
        for (const sel of await am0.locator('select[data-testid^="wizard-work-owner-"]').all()) {
          const value = await sel.locator('option').filter({ hasText: PEOPLE.lead.name }).first().getAttribute('value')
          expect(value, `${PEOPLE.lead.name} is offered as a workstream owner`).toBeTruthy()
          await sel.selectOption(value!)
        }
        await am0.getByTestId('wizard-next').click()
        await expect(am0.getByTestId('wizard-step-4')).toBeVisible()
        const campaignId = await reviewAndApprove(am0)
        await am0.context().close()

        const pieceRows = await rows<{ id: string; name: string; workstream_id: string | null }>('deliverables',
          `select=id,name,workstream_id,streams!inner(campaign_id)&streams.campaign_id=eq.${campaignId}`)
        const P = {} as Record<Key, { id: string; workstream_id: string | null }>
        for (const k of Object.keys(PIECES) as Key[]) {
          const row = pieceRows.find((p) => p.name === PIECES[k].name)
          expect(row, `${PIECES[k].name} was made`).toBeTruthy()
          P[k] = row!
        }
        const wsRows = await rows<{ id: string; name: string }>('workstreams', `select=id,name&campaign_id=eq.${campaignId}`)
        const wsId = (name: string) => wsRows.find((w) => w.name === name)?.id ?? ''
        await walk.check('approved, four pieces, two workstreams', async () => {
          expect(pieceRows).toHaveLength(4)
          expect(wsRows.map((w) => w.name).sort()).toEqual([...GROUPS].sort())
        })

        walk.begin('The owners approve their task lists on the campaign page', `${PEOPLE.tl.name} and ${PEOPLE.lead.name}`)
        for (const tag of ['tl', 'lead'] as const) {
          const p = await s.as(tag)
          await s.go(p, `/campaigns/${campaignId}`)
          await expect(p.getByTestId('campaign-task-lists')).toBeVisible()
          await p.getByTestId('campaign-task-lists-approve-all').click()
          for (const k of (Object.keys(PIECES) as Key[]).filter((x) => PIECES[x].owner === tag)) {
            await expect.poll(async () => (await rows<{ tasks_approved_at: string | null }>('deliverables', `select=tasks_approved_at&id=eq.${P[k].id}`))[0].tasks_approved_at, { timeout: 15_000 }).not.toBeNull()
          }
          await p.context().close()
        }

        walk.begin('The owners give tasks, with hours, through the Schedule\'s own door', 'each piece\'s owner, through update_task_assignment')
        walk.note(`The RPC the Schedule's assignment dialog calls, signed in as the owner, then subtask-schedule as the app does. Every task is given its hours (E11). Planned in the week of ${week}.`)
        const T = {} as Record<Key, TaskRow[]>
        for (const k of Object.keys(PIECES) as Key[]) T[k] = await tasksOfPiece(P[k].id)
        const assign = async (owner: Tag, task: TaskRow, who: Tag, startDay: string, dueDay: string, hours: number, mode: 'manual' | null = null) => {
          const out = await rpcAs<{ outcome: string; reschedule_needed: boolean }[]>(owner, 'update_task_assignment', {
            p_sub_task: task.id, p_title: task.title, p_assignee: uid[who],
            p_reviewers: [{ user_id: uid[owner], is_mandatory: true }],
            p_starts_at: `${startDay}T06:00:00Z`, p_due_at: `${dueDay}T14:00:00Z`, p_hours: hours, p_review_mode: mode,
          })
          expect(out[0]?.outcome, `${task.title} → ${who}`).toBe('assigned')
          if (out[0]?.reschedule_needed) await fnAs(owner, 'subtask-schedule', { subTaskId: task.id })
        }
        for (const k of Object.keys(PIECES) as Key[]) expect(T[k].length, `${PIECES[k].name} has tasks`).toBeGreaterThanOrEqual(k === 'reel' ? 3 : 2)
        await assign('tl', T.kv[0], 'deputy', week, addDays(week, 1), 4)            // dragged late on the team view (L6)
        await assign('tl', T.kv[1], 'maker', addDays(week, 1), addDays(week, 2), 4)  // dragged late on the Schedule
        await assign('lead', T.reel[0], 'maker', week, addDays(week, 2), 4)          // started — a change to it is a request
        await assign('lead', T.reel[1], 'animator', addDays(week, 1), addDays(week, 3), 6) // Motion's row in the department view
        await assign('lead', T.reel[2], 'maker', week, addDays(week, 4), 36)         // fills the maker's week (L7)
        await assign('lead', T.poster[0], 'deputy', addDays(week, 2), addDays(week, 3), 4)
        await assign('lead', T.teaser[0], 'maker', week, addDays(week, 1), 2, 'manual')  // started — Edit becomes a request
        await rpcAs('maker', 'sub_task_start', { p_id: T.reel[0].id })
        await rpcAs('maker', 'sub_task_start', { p_id: T.teaser[0].id })
        walk.note(`${PIECES.kv.name}: task 1 → ${PEOPLE.deputy.name}, task 2 → ${PEOPLE.maker.name}, the rest nobody's. ${PIECES.reel.name}: ${PEOPLE.maker.name} (started), ${PEOPLE.animator.name}, and 36 hours to ${PEOPLE.maker.name}. ${PIECES.poster.name}: ${PEOPLE.deputy.name}. ${PIECES.teaser.name}: ${PEOPLE.maker.name} (started).`)

        walk.begin('Two more pieces of set-up', `${PEOPLE.tl.name}, then ${PEOPLE.lead.name} in the piece's panel`)
        walk.note(`A task with hours and a reviewer, given to nobody, on ${PIECES.kv.name} (the one the team lead drags onto a full person) — written by its owner through save_sub_task, the call the retired Deliverables window made: the panel adds a task by name and date only, and hours come with the assignment (ADR-0132 d.2); an owner's added task counts as approved (d.4). Then an outstanding input from the client on ${PIECES.poster.name}, in its panel on the campaign page (I68.14).`)
        await rpcAs('tl', 'save_sub_task', {
          p_sub_task: null, p_deliverable: P.kv.id, p_title: 'Resize for stories',
          p_reviewers: [{ user_id: uid.lead, is_mandatory: true }], p_sla_hours: 4,
        })
        const resize = (await tasksOfPiece(P.kv.id)).find((t) => t.title === 'Resize for stories')
        expect(resize, 'the unassigned task with hours was added').toBeTruthy()
        const lead0 = await s.as('lead')
        await s.go(lead0, `/campaigns/${campaignId}?piece=${P.poster.id}`)
        await expect(lead0.getByTestId('piece-panel')).toBeVisible()
        await lead0.getByTestId('external-input-add').click()
        await lead0.getByTestId('external-input-description').fill('Final store dimensions')
        await lead0.getByTestId('external-input-awaited-from').fill('Northwind retail team')
        await lead0.getByTestId('external-input-save').click()
        await expect(lead0.getByTestId('external-inputs-list')).toContainText('Final store dimensions')
        const [clientInput] = (await inputsOf(P.poster.id)).filter((i) => i.description === 'Final store dimensions')
        expect(clientInput, 'the client input is recorded').toBeTruthy()
        await lead0.context().close()

        walk.begin('The account manager releases the single job; its owner approves the list and gives the maker five tasks', `${PEOPLE.am.name}, then ${PEOPLE.lead.name}`)
        const am1 = await s.as('am')
        const job: ReleasedJob = await releaseSingleJob(am1, { title: jobTitle, department: 'Creative', type: 'Social Advertisement' })
        await am1.context().close()
        expect(job.ownerUserId, 'the Creative job is owned by the Creative lead').toBe(uid.lead)
        const lead1 = await s.as('lead')
        // ADR-0132: the job's own page, its one piece open — the task list is approved in the panel.
        await s.go(lead1, `/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
        await lead1.getByTestId('piece-panel-approve').click()
        await expect(lead1.getByTestId('piece-panel-approved')).toBeVisible()
        const J = {
          work: 'Carousel layout',
          fresh: 'Stories cut-down',
          digital: 'Hero banner',
          manual: 'Client call notes',
          done: 'Alt text for the set',
        } as const
        const modes: Record<keyof typeof J, string | null> = { work: null, fresh: null, digital: 'digital', manual: 'manual', done: 'manual' }
        // The five tasks the maker holds: set-up, through save_sub_task — the call the retired window made — with the
        // assignee, hours, reviewer and review mode it set. (The panel adds by name and date only; ADR-0132 d.2.)
        for (const k of Object.keys(J) as (keyof typeof J)[]) {
          await rpcAs('lead', 'save_sub_task', {
            p_sub_task: null, p_deliverable: job.deliverableId, p_title: J[k],
            p_reviewers: [{ user_id: uid.lead, is_mandatory: true }], p_assignee: uid.deputy,
            p_sla_hours: k === 'done' ? 1 : 4, p_review_mode: modes[k],
          })
        }
        await lead1.context().close()
        const jobTasks = await tasksOfPiece(job.deliverableId)
        const JT = {} as Record<keyof typeof J, TaskRow>
        for (const k of Object.keys(J) as (keyof typeof J)[]) {
          const t = jobTasks.find((x) => x.title === J[k])
          expect(t, `${J[k]} was added`).toBeTruthy()
          JT[k] = t!
        }
        const workflow = jobTasks.filter((t) => !Object.values(J).includes(t.title as never))
        expect(workflow.length, 'the job\'s workflow tasks').toBeGreaterThanOrEqual(3)
        // Two of the workflow's tasks are dated for the maker's Today and This week; the rest stay
        // nobody's, so the owner is asked to assign them.
        const tomorrow = addDays(today, 1)
        await walk.act(`workflow task "${workflow[0].title}" → ${PEOPLE.deputy.name}, due today`, () => assign('lead', workflow[0], 'deputy', today, today, 2))
        // "Begun" means its booked span has STARTED. Starting it today at 09:00 Baghdad failed the check
        // on a non-working day (26 Sep, a Saturday: the scheduler moved it to Sunday) and on any run before
        // 09:00 — so it starts on the deputy's last working day before today, per their own office.
        const [office] = await rows<{ offices: { working_days: number[] } | null }>('resources', `select=offices(working_days)&user_id=eq.${uid.deputy}`)
        const works = new Set(office?.offices?.working_days ?? [7, 1, 2, 3, 4])   // ISO: 7 = Sunday
        const isoDay = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay() || 7
        let begunFrom = addDays(today, -1)
        while (!works.has(isoDay(begunFrom))) begunFrom = addDays(begunFrom, -1)
        await walk.act(`workflow task "${workflow[1].title}" → ${PEOPLE.deputy.name}, begun ${begunFrom}, due tomorrow`, () => assign('lead', workflow[1], 'deputy', begunFrom, tomorrow, 2))
        // One finished task, so Completed has something to fold: started, written up, sent, approved.
        await rpcAs('deputy', 'sub_task_start', { p_id: JT.done.id })
        await insertAs('deputy', 'review_feedback', { tenant_id: tenantId, sub_task_id: JT.done.id, body: 'Alt text written for all six frames.', author_user_id: uid.deputy })
        await rpcAs('deputy', 'sub_task_submit', { p_id: JT.done.id, p_manual_minutes: null, p_accept_untimed: true })
        await rpcAs('lead', 'sub_task_approve', { p_sub_task: JT.done.id })
        await walk.check(`"${J.done}" is done`, async () => expect(await statusOf(JT.done.id)).toBe('done'))
        walk.note(`Five tasks on ${PEOPLE.deputy.name}: ${Object.values(J).join(', ')} ("${J.done}" already finished and approved, through the RPCs My Work and the review call), plus two of the workflow's own. ${workflow.length - 2} workflow tasks are left for nobody.`)

        // ================================================================ 1. the maker ====
        walk.open('maker', `1 · The maker — ${PEOPLE.deputy.name}`)
        const mk = await s.as('deputy')

        walk.begin('My Work, as the week starts', PEOPLE.deputy.name)
        walk.note('FRAME: M1 — My Work stays personal and the same for everyone (ADR-0105 d.1): the greeting, attendance, the counts, Needs you, the five lists (Today · This week · Later · Waiting on someone else · Completed, folded), and on the right Your week and Before you start.')
        await s.go(mk, '/my-work')
        await expect(mk.getByTestId('surface-my-work')).toBeVisible({ timeout: 30_000 })
        await walk.check('the greeting, attendance and the counts row are there', async () => {
          await expect(mk.getByTestId('my-work-greeting')).toBeVisible()
          await expect(mk.getByTestId('attendance-widget')).toBeVisible()
          await expect(mk.getByTestId('exceptions-panel')).toBeVisible()
        })
        await walk.check('Needs you tells the maker what is new on them — the four open tasks just given', async () => {
          await expect(mk.getByTestId('needs-you-panel')).toBeVisible()
          for (const k of ['work', 'fresh', 'digital', 'manual'] as const) {
            await expect(mk.getByTestId(`needs-you-new_on_you-${JT[k].id}`), J[k]).toBeVisible()
            await expect(mk.getByTestId(`needs-you-kind-${JT[k].id}`)).toHaveText('New on you')
          }
        })
        await walk.check(`Today holds "${workflow[0].title}" (due today)`, async () => {
          await expect(mk.getByTestId('today-tasks-panel').getByTestId(`my-work-item-${workflow[0].id}`)).toBeVisible()
        })
        await walk.check(`"${workflow[1].title}" has begun (its booked span started on the last working day), so it is in Today although it is due tomorrow — the rule as built: due today, overdue, or begun`, async () => {
          const panel = 'today-tasks-panel'
          await expect(mk.getByTestId(panel).getByTestId(`my-work-item-${workflow[1].id}`)).toBeVisible()
        })
        await walk.check('Later is shown; Completed is folded shut with the finished task inside', async () => {
          await expect(mk.getByTestId('later-tasks-panel')).toBeVisible()
          await expect(mk.getByTestId('completed-tasks-panel')).toBeVisible()
          await expect(mk.getByTestId('completed-tasks-panel').getByTestId(`my-work-item-${JT.done.id}`)).toBeHidden()
        })
        await walk.check('Your week and Before you start are in the right column', async () => {
          await expect(mk.getByTestId('your-week')).toBeVisible()
          await expect(mk.getByTestId('before-you-start')).toBeVisible()
        })
        await walk.shot(mk, 'maker-my-work', { full: true, caption: 'My Work: greeting, attendance, counts; Needs you on top of the lists; Your week and Before you start on the right. The maker can open, start or put off each task.' })
        await walk.shot(mk, 'maker-needs-you', { of: mk.getByTestId('needs-you-panel'), caption: 'Needs you, close: "New on you" for each task just given — Open, Too much, or Later.' })
        await walk.shot(mk, 'maker-your-week', { of: mk.getByTestId('your-week'), caption: 'Your week: the maker\'s booked hours day by day, and how full the week is.' })
        await walk.shot(mk, 'maker-before-you-start', { of: mk.getByTestId('before-you-start'), caption: 'Before you start: the next task\'s client rules and brief lines, shown to be followed — nothing to tick.' })
        await walk.act('open Completed', async () => {
          await mk.getByTestId('completed-tasks-toggle').click()
          await expect(mk.getByTestId('completed-tasks-panel').getByTestId(`my-work-item-${JT.done.id}`)).toBeVisible()
        })
        await walk.shot(mk, 'maker-completed', { of: mk.getByTestId('completed-tasks-panel'), caption: 'Completed, unfolded by its toggle: the finished, approved task.' })

        walk.begin('"Too much" — telling whoever assigned it', PEOPLE.deputy.name)
        await walk.act(`press Too much on "${J.fresh}"`, async () => {
          await mk.getByTestId(`needs-you-too-much-${JT.fresh.id}`).click()
          await expect(mk.getByTestId('ny-too-much-dialog')).toBeVisible()
        })
        await walk.check(`the dialog names ${PEOPLE.lead.name} (who assigned it) and shows the maker's week`, async () => {
          await expect(mk.getByTestId('ny-too-much-told')).toContainText(PEOPLE.lead.name)
          await expect(mk.getByTestId('ny-too-much-week')).toBeVisible()
        })
        await mk.getByTestId('ny-too-much-note').fill('Three launches this week — could someone take the cut-down?').catch(() => {})
        await walk.shot(mk, 'maker-too-much', { caption: 'Too much: the maker\'s week goes with the note to the person who assigned it. Send or Cancel.' })
        await walk.act('send it', async () => {
          await mk.getByTestId('ny-too-much-send').click()
          await expect.poll(async () => (await messagesOf(job.deliverableId, 'too_much')).filter((m) => m.status === 'open').length).toBe(1)
        })

        walk.begin('Opening a new task clears it from New on you — seen, on every device', PEOPLE.deputy.name)
        await walk.act(`open "${J.manual}" and come back to My Work`, async () => {
          await expect(mk.getByTestId(`needs-you-later-${JT.manual.id}`)).toHaveCount(0)
          await mk.goto(`/my-work/task/${JT.manual.id}`)
          // Seen is stamped once the page has loaded the task — wait for it before leaving.
          await expect(mk.getByTestId('task-page')).toBeVisible({ timeout: 15_000 })
          await expect.poll(async () => (await rows<{ assignee_seen_at: string | null }>('sub_tasks', `select=assignee_seen_at&id=eq.${JT.manual.id}`))[0]?.assignee_seen_at ?? null, { timeout: 15_000 }).not.toBeNull()
          await mk.goto('/my-work')
          await expect(mk.getByTestId(`needs-you-new_on_you-${JT.manual.id}`)).toHaveCount(0)
        })
        await walk.check('it is marked seen on the server (I59.33), and stays in its list', async () => {
          await expect.poll(async () => (await rows<{ assignee_seen_at: string | null }>('sub_tasks', `select=assignee_seen_at&id=eq.${JT.manual.id}`))[0]?.assignee_seen_at ?? null).not.toBeNull()
          await expect(mk.getByTestId(`my-work-item-${JT.manual.id}`)).toBeVisible()
        })

        walk.begin('The task page — the brief, the rules, Start, the timer', PEOPLE.deputy.name)
        walk.note('FRAME: M2 — a task\'s own page, opened from Open and from notifications (ADR-0105 d.3). Every pop-up My Work used to open is here.')
        await walk.act(`Open "${J.work}" from Needs you`, async () => {
          await mk.getByTestId(`needs-you-open-new_on_you-${JT.work.id}`).click()
          await expect(mk).toHaveURL(new RegExp(`/my-work/task/${JT.work.id}$`))
        })
        await walk.check('the header, the steps, the brief; not started, so no Send', async () => {
          await expect(mk.getByTestId('task-page-title')).toContainText(J.work)
          await expect(mk.getByTestId('task-page-status')).toHaveAttribute('data-status', 'todo')
          await expect(mk.getByTestId('task-page-step-todo')).toHaveAttribute('data-current', 'true')
          await expect(mk.getByTestId('task-page-brief')).toBeVisible()
          await expect(mk.getByTestId(`my-work-submit-${JT.work.id}`)).toHaveCount(0)
        })
        await walk.check('the client\'s rules are shown on the page', async () => {
          await expect(mk.getByTestId('task-page-rules')).toBeVisible()
        })
        await walk.shot(mk, 'maker-task-page', { full: true, caption: 'The task page before Start: what the task is, the brief, the rules, who reviews it. The maker can Start, ask, or say they are blocked.' })
        await walk.act('press Start', async () => {
          await mk.getByTestId(`my-work-start-${JT.work.id}`).click()
          await expect.poll(() => statusOf(JT.work.id)).toBe('in_progress')
        })
        await walk.check('in progress, and the timer runs', async () => {
          await expect(mk.getByTestId('task-page-step-in_progress')).toHaveAttribute('data-current', 'true')
          await expect(mk.getByTestId('task-page-timer')).toBeVisible()
        })
        await walk.shot(mk, 'maker-task-started', { caption: 'Started: the step moves on and the timer counts from Start (ADR-0030).' })

        walk.begin('I\'m blocked — the dialog, then the waiting line', PEOPLE.deputy.name)
        await walk.act('open I\'m blocked', async () => {
          await mk.getByTestId('task-page-blocked-open').click()
          await expect(mk.getByTestId('block-dialog')).toBeVisible()
        })
        await walk.check(`the dialog says ${PEOPLE.lead.name} (the owner) is told; Send waits for what is missing`, async () => {
          await expect(mk.getByTestId('block-told')).toContainText(PEOPLE.lead.name)
          await expect(mk.getByTestId('block-send')).toBeDisabled()
        })
        await walk.act('say what is missing, who has it, what is needed', async () => {
          await mk.getByTestId('block-kind-copy').check()
          await mk.getByTestId('block-who').fill(PEOPLE.writer.name)
          await mk.getByTestId('block-need').fill('The Arabic headline for slide 1')
        })
        await walk.shot(mk, 'maker-blocked-dialog', { caption: 'I\'m blocked: what kind of thing is missing, who has it, what you need. The owner and the account manager are told; the clock is shown.' })
        let blockId = ''
        await walk.act('send it', async () => {
          await mk.getByTestId('block-send').click()
          await expect(mk.getByTestId('block-dialog')).toHaveCount(0)
          await expect.poll(async () => (await inputsOf(job.deliverableId)).filter((i) => i.sub_task_id === JT.work.id && !i.satisfied_at).length).toBe(1)
          blockId = (await inputsOf(job.deliverableId)).find((i) => i.sub_task_id === JT.work.id && !i.satisfied_at)!.id
        })
        await walk.check('the page now shows the waiting line, with Clear', async () => {
          await expect(mk.getByTestId(`task-page-input-${blockId}`)).toContainText('The Arabic headline')
          await expect(mk.getByTestId(`task-page-input-clear-${blockId}`)).toBeVisible()
        })
        await walk.shot(mk, 'maker-blocked-line', { of: mk.getByTestId('task-page-inputs'), caption: 'Waiting on: the block, who has it, and since when — blocked time comes off the timer. The maker clears it when it arrives.' })

        walk.begin('Ask someone — picking a person', PEOPLE.deputy.name)
        let questionId = ''
        await walk.act('open Ask someone', async () => {
          await mk.getByTestId('task-page-ask').click()
          await expect(mk.getByTestId('ask-dialog')).toBeVisible()
        })
        await walk.check('the account manager is picked already; the piece\'s people are listed first', async () => {
          await expect(mk.getByTestId(`ask-person-${uid.am}`)).toBeChecked()
          await expect(mk.getByTestId('ask-piece-people')).toBeVisible()
        })
        await walk.act(`search for ${PEOPLE.writer.name} and add them`, async () => {
          await mk.getByTestId('ask-search').fill(PEOPLE.writer.name)
          await mk.getByTestId(`ask-person-${uid.writer}`).check()
          await expect(mk.getByTestId('ask-told')).toContainText(PEOPLE.writer.name)
          await mk.getByTestId('ask-body').fill('Is the autumn headline final, or still with the client?')
        })
        await walk.shot(mk, 'maker-ask', { caption: 'Ask someone: anyone in the agency, the piece\'s people first, the account manager already picked. Each is told by notification and email.' })
        await walk.act('send the question', async () => {
          await mk.getByTestId('ask-send').click()
          await expect.poll(async () => (await messagesOf(job.deliverableId, 'question')).length).toBe(1)
          questionId = (await messagesOf(job.deliverableId, 'question'))[0].id
        })
        await walk.check('the question is on the page\'s Questions list', async () => {
          await expect(mk.getByTestId(`task-page-question-${questionId}`)).toContainText('autumn headline')
        })
        await walk.shot(mk, 'maker-questions', { of: mk.getByTestId('task-page-questions'), caption: 'Questions: what was asked on this piece, and the replies as they come.' })

        walk.begin('Ask for more time', PEOPLE.deputy.name)
        const ext = `my-work-extension-${JT.work.id}`
        let extensionId = ''
        await walk.act('open Ask for more time and fill it', async () => {
          await mk.getByTestId(`${ext}-ask`).click()
          await expect(mk.getByTestId(`${ext}-request-dialog`)).toBeVisible()
          await mk.getByTestId(`${ext}-request-day`).fill(addDays(today, 30))
          await mk.getByTestId(`${ext}-request-reason`).fill('The client\'s photography arrives next week.')
        })
        await walk.shot(mk, 'maker-extension', { caption: 'Ask for more time: the day asked for and why. It goes to the piece\'s owner first (ADR-0109).' })
        await walk.act('send it — it waits on the owner', async () => {
          await mk.getByTestId(`${ext}-request-send`).click()
          await expect.poll(async () => (await pendingExtension(JT.work.id))?.stage).toBe('owner')
          extensionId = (await pendingExtension(JT.work.id))!.request_id
          await expect(mk.getByTestId(`${ext}-line`)).toHaveAttribute('data-state', 'pending')
        })

        walk.begin('Send straight after Start — the untimed warning', PEOPLE.deputy.name)
        await s.go(mk, `/my-work/task/${JT.digital.id}`)
        await walk.act(`start "${J.digital}" and upload V1`, async () => {
          await mk.getByTestId(`my-work-start-${JT.digital.id}`).click()
          await expect.poll(() => statusOf(JT.digital.id)).toBe('in_progress')
          const chooser = mk.waitForEvent('filechooser')
          await mk.getByTestId('task-page-file').getByTestId('review-upload').click()
          await (await chooser).setFiles({ name: 'hero-v1.png', mimeType: 'image/png', buffer: PNG })
          await expect.poll(async () => (await rows('media_records', `select=id&sub_task_id=eq.${JT.digital.id}`)).length).toBe(1)
        })
        await walk.act('press Send for review a minute after Start', async () => {
          await mk.getByTestId(`my-work-submit-${JT.digital.id}`).click()
          await expect(mk.getByTestId('untimed-dialog')).toBeVisible()
        })
        await walk.check(`the warning names the allocation and ${PEOPLE.lead.name}, who is told`, async () => {
          await expect(mk.getByTestId('untimed-told')).toContainText(PEOPLE.lead.name)
        })
        await walk.shot(mk, 'maker-untimed', { caption: 'Sent under 15 minutes after Start, the round is untimed: warned first. Send anyway records the allocated hours, marked untimed; Cancel sends nothing.' })
        await walk.act('Send anyway', async () => {
          await mk.getByTestId('untimed-send').click()
          await expect.poll(() => statusOf(JT.digital.id)).toBe('review')
        })
        await walk.check('the round is recorded untimed', async () => {
          await expect.poll(async () => (await rows<{ untimed: boolean }>('task_time_entries', `select=untimed&sub_task_id=eq.${JT.digital.id}&round=eq.0`))[0]?.untimed).toBe(true)
        })

        walk.begin('The reviewer pins V1 and sends it back', PEOPLE.lead.name)
        walk.note('Set-up for the next step, through the review screen: one pin on the image, then Request changes.')
        let pinId = ''
        let v1Id = ''
        {
          const rv = await s.as('lead')
          await s.go(rv, '/my-work')
          await walk.act('pin the image and send it back', async () => {
            await rv.getByTestId(`awaiting-review-open-${JT.digital.id}`).click({ timeout: 30_000 })
            const img = rv.getByTestId('review-img')
            await expect(img).toBeVisible({ timeout: 15_000 })
            await img.click({ position: { x: 30, y: 30 } })
            await rv.getByTestId('comment-body').fill('Move the logo to the bottom right.')
            await rv.getByTestId('comment-submit').click()
            v1Id = (await rows<{ id: string }>('media_records', `select=id&sub_task_id=eq.${JT.digital.id}&order=version.asc`))[0].id
            await expect.poll(async () => (await rows<{ id: string }>('review_feedback', `select=id&media_record_id=eq.${v1Id}`)).length).toBe(1)
            pinId = (await rows<{ id: string }>('review_feedback', `select=id&media_record_id=eq.${v1Id}`))[0].id
          })
          await walk.shot(rv, 'reviewer-pin', { caption: 'The review screen: the pin on V1, its comment, and the rules beside the file.' })
          await walk.act('Request changes', async () => {
            await rv.getByTestId(`awaiting-review-request-changes-${JT.digital.id}`).click()
            await expect.poll(() => statusOf(JT.digital.id)).toBe('todo')
          })
          await rv.context().close()
        }

        walk.begin('Changes came back — the M4 page with its pin', PEOPLE.deputy.name)
        walk.note('FRAME: M4 — the previous version with its pins, To fix, earlier rounds folded, Upload V2, Send V2 back.')
        await s.go(mk, '/my-work')
        await walk.check('Needs you says "Changes came back", with the round', async () => {
          await expect(mk.getByTestId(`needs-you-changes_back-${JT.digital.id}`)).toBeVisible({ timeout: 30_000 })
          await expect(mk.getByTestId(`needs-you-changes-round-${JT.digital.id}`)).toBeVisible()
        })
        await walk.shot(mk, 'maker-changes-back-card', { of: mk.getByTestId(`needs-you-changes_back-${JT.digital.id}`), caption: 'Changes came back: which task, which round, how long ago. Open goes to the page as it came back.' })
        await walk.act('Open it', async () => {
          await mk.getByTestId(`needs-you-open-changes_back-${JT.digital.id}`).click()
          await expect(mk.getByTestId('task-page-changes')).toBeVisible()
        })
        await walk.check('the previous version, its pin in To fix', async () => {
          await expect(mk.getByTestId('task-page-status')).toHaveAttribute('data-status', 'changes')
          await expect(mk.getByTestId('task-page-prev-version').getByTestId('review-img')).toBeVisible({ timeout: 15_000 })
          await expect(mk.getByTestId(`task-page-pin-${pinId}`)).toContainText('bottom right')
        })
        await walk.shot(mk, 'maker-m4', { full: true, caption: 'M4: V1 with the reviewer\'s pin, To fix, the earlier rounds folded, and Upload V2.' })

        walk.begin('Answering the pin — Reply, Mark done, Undo', PEOPLE.deputy.name)
        // M4 (E16): the pin controls sit in the To fix list, beside the file — the whole changes view.
        const prev = mk.getByTestId('task-page-changes')
        await walk.act('Reply', async () => {
          await prev.getByTestId(`pin-reply-open-${pinId}`).click()
          await expect(prev.getByTestId(`pin-reply-form-${pinId}`)).toBeVisible()
          await prev.getByTestId(`pin-reply-body-${pinId}`).fill('Moved — see V2.')
        })
        await walk.shot(mk, 'maker-pin-reply', { of: prev, caption: 'Reply under the pin: the maker answers the reviewer where the note is.' })
        await walk.act('send the reply', async () => {
          await prev.getByTestId(`pin-reply-submit-${pinId}`).click()
          await expect(prev.getByTestId(`pin-replies-${pinId}`)).toContainText('Moved — see V2.')
        })
        await walk.act('Mark done', async () => {
          await prev.getByTestId(`pin-mark-done-${pinId}`).click()
          await expect(mk.getByTestId(`task-page-pin-${pinId}`)).toHaveAttribute('data-done', 'true')
        })
        await walk.check(`To fix says who marked it done — ${PEOPLE.deputy.name}`, async () => {
          await expect(mk.getByTestId(`task-page-pin-done-${pinId}`)).toContainText(PEOPLE.deputy.name)
        })
        await walk.shot(mk, 'maker-pin-done', { caption: 'Marked done: struck through in To fix, with who did it. Undo is the maker\'s; Re-open is the reviewer\'s.' })
        await walk.act('Undo, then done again', async () => {
          await prev.getByTestId(`pin-undo-${pinId}`).click()
          await expect(mk.getByTestId(`task-page-pin-${pinId}`)).not.toHaveAttribute('data-done', 'true')
          await walk.shot(mk, 'maker-pin-undone', { of: mk.getByTestId('task-page-to-fix'), caption: 'After Undo: the pin is open again in To fix.' })
          await prev.getByTestId(`pin-mark-done-${pinId}`).click()
          await expect(mk.getByTestId(`task-page-pin-${pinId}`)).toHaveAttribute('data-done', 'true')
        })

        walk.begin('Send V2', PEOPLE.deputy.name)
        await walk.act('Start the new round, upload V2', async () => {
          await mk.getByTestId(`my-work-start-${JT.digital.id}`).click()
          await expect.poll(() => statusOf(JT.digital.id)).toBe('in_progress')
          const chooser = mk.waitForEvent('filechooser')
          await mk.getByTestId('task-page-upload-next').click()
          await (await chooser).setFiles({ name: 'hero-v2.png', mimeType: 'image/png', buffer: PNG })
          await expect(mk.getByTestId('task-page-next-attached')).toBeVisible()
        })
        await walk.shot(mk, 'maker-v2-ready', { full: true, caption: 'V2 attached beside V1 and its pin. Send V2 back sends it to the same reviewers.' })
        await walk.act('Send V2 back (warned as untimed again; Send anyway)', async () => {
          await mk.getByTestId(`my-work-submit-${JT.digital.id}`).click()
          await mk.getByTestId('untimed-send').click()
          await expect.poll(() => statusOf(JT.digital.id)).toBe('review')
        })

        walk.begin('My Work after the round', PEOPLE.deputy.name)
        await s.go(mk, '/my-work')
        await walk.check(`"${J.digital}" waits on someone else, naming ${PEOPLE.lead.name}`, async () => {
          await expect(mk.getByTestId('waiting-tasks-panel').getByTestId(`my-work-item-${JT.digital.id}`)).toBeVisible()
          await expect(mk.getByTestId(`my-work-waiting-on-${JT.digital.id}`)).toContainText(PEOPLE.lead.name)
        })
        await walk.shot(mk, 'maker-after', { full: true, caption: 'Waiting on someone else: the task in review, and who has it. New on you has gone for what the maker opened or put off.' })
        await mk.context().close()

        // ================================================================ 2. owner / team lead ====
        walk.open('owner', `2 · The owner and the team lead — ${PEOPLE.lead.name}, ${PEOPLE.tl.name}`)

        walk.begin('The account manager asks for two changes to started work', PEOPLE.am.name)
        walk.note(`Through request_deliverable_change — the door the campaign page's Edit calls (that dialog is shown in chapter 4). One on the job (the due date, costed), one on ${PIECES.reel.name}.`)
        let crA = '', crB = ''
        await walk.act('ask both', async () => {
          crA = await rpcAs<string>('am', 'request_deliverable_change', {
            p_deliverable: job.deliverableId, p_changes: { due: { to: addDays(today, 40) } }, p_asked_by: 'client',
            p_cost: { started_tasks: 2, booked_hours: 8, timed_hours: 1.5, lands_on: addDays(today, 40) },
          })
          crB = await rpcAs<string>('am', 'request_deliverable_change', {
            p_deliverable: P.reel.id, p_changes: { due: { to: addDays(week, 20) } }, p_asked_by: 'us',
            p_cost: { started_tasks: 1, booked_hours: 4, timed_hours: 0, lands_on: addDays(week, 20) },
          })
          expect(crA).toBeTruthy()
          expect(crB).toBeTruthy()
        })

        const ld = await s.as('lead')
        walk.begin('Needs you, for the owner', PEOPLE.lead.name)
        walk.note('FRAME: Needs you (ADR-0105 d.2, D1): everything asking the owner to act, grouped by the clock — today or it slips, this week, quietly — most urgent first.')
        await s.go(ld, '/my-work')
        await expect(ld.getByTestId('needs-you-panel')).toBeVisible({ timeout: 30_000 })
        await walk.check('the job\'s Assign card, the block, Too much, the extension and both change requests are there', async () => {
          await expect(ld.getByTestId(`needs-you-assign-${job.deliverableId}`)).toBeVisible()
          await expect(ld.getByTestId(`needs-you-blocked-${blockId}`)).toBeVisible()
          await expect(ld.getByTestId(`needs-you-forward-${extensionId}`)).toBeVisible()
          await expect(ld.getByTestId(`needs-you-decide-change-${crA}`)).toBeVisible()
          await expect(ld.getByTestId(`needs-you-decide-change-${crB}`)).toBeVisible()
          await expect(ld.locator('[data-kind="too_much"]').first()).toBeVisible()
        })
        await walk.shot(ld, 'owner-needs-you', { full: true, caption: 'The owner\'s Needs you: assign, a blocked maker, too much, an extension, two change requests and the reviews — each with its clock.' })

        walk.begin('Assign — opens the Schedule, filtered', PEOPLE.lead.name)
        await walk.check('the card counts the tasks nobody has', async () => {
          await expect(ld.getByTestId(`needs-you-kind-${job.deliverableId}`)).toHaveText('Assign')
          await expect(ld.getByTestId(`needs-you-assign-count-${job.deliverableId}`)).toContainText(String(workflow.length - 2))
        })
        await walk.shot(ld, 'owner-assign-card', { of: ld.getByTestId(`needs-you-assign-${job.deliverableId}`), caption: 'Assign: the piece, how many tasks nobody has, since the list was approved.' })
        await walk.act('press Assign', async () => {
          await ld.getByTestId(`needs-you-open-assign-${job.deliverableId}`).click()
          await expect(ld).toHaveURL(new RegExp(`/schedule\\?campaign=${job.campaignId}&dept=`))
          await expect(ld.getByTestId('schedule-grid')).toBeVisible()
        })
        await walk.shot(ld, 'owner-assign-schedule', { caption: 'The Schedule, narrowed to the job\'s campaign and department — where assigning is done (Q31).' })

        walk.begin('Someone is blocked — Nudge', PEOPLE.lead.name)
        await s.go(ld, '/my-work')
        await walk.check('the card has its clock ("escalates in …")', async () => {
          await expect(ld.getByTestId(`needs-you-clock-${blockId}`)).toContainText('escalates in')
        })
        await walk.shot(ld, 'owner-blocked-card', { of: ld.getByTestId(`needs-you-blocked-${blockId}`), caption: 'Someone is blocked: who, on what, what they need, and when it escalates. Nudge or Reassign.' })
        await walk.act('open Nudge', async () => {
          await ld.getByTestId(`needs-you-nudge-${blockId}`).click()
          await expect(ld.getByTestId('ny-nudge-dialog')).toBeVisible()
        })
        await walk.check(`the nudge goes to ${PEOPLE.writer.name}, taken from "who has it"`, async () => {
          await expect(ld.getByTestId('ny-nudge-told')).toContainText(PEOPLE.writer.name)
        })
        await ld.getByTestId('ny-nudge-body').fill('Could you send the Arabic headline today?').catch(() => {})
        await walk.shot(ld, 'owner-nudge', { caption: 'Nudge: a notification and an email to whoever has what the maker needs, recorded on the piece.' })
        await walk.act('send the nudge', async () => {
          await ld.getByTestId('ny-nudge-send').click()
          await expect.poll(async () => (await messagesOf(job.deliverableId, 'nudge')).some((m) => m.recipients.includes(uid.writer))).toBe(true)
        })

        walk.begin('Too much — Keep it, and Rebalance', PEOPLE.lead.name)
        const tooMuch1 = (await messagesOf(job.deliverableId, 'too_much')).find((m) => m.status === 'open')?.id ?? ''
        await walk.shot(ld, 'owner-too-much-card', { of: ld.getByTestId(`needs-you-too_much-${tooMuch1}`), caption: 'Too much: the maker\'s note and week. Rebalance opens the Schedule; Keep it leaves it with them.' })
        await walk.act('Keep it with them', async () => {
          await ld.getByTestId(`needs-you-keep-${tooMuch1}`).click()
          await expect.poll(async () => (await messagesOf(job.deliverableId, 'too_much')).find((m) => m.id === tooMuch1)?.status).toBe('kept')
        })
        walk.note(`${PEOPLE.deputy.name} says it again (the same dialog as in chapter 1), and this time the owner rebalances.`)
        let tooMuch2 = ''
        await walk.act('the maker says Too much a second time', async () => {
          const again = await s.as('deputy')
          await s.go(again, '/my-work')
          await again.getByTestId(`needs-you-too-much-${JT.fresh.id}`).click({ timeout: 30_000 })
          await again.getByTestId('ny-too-much-note').fill('Still three launches.')
          await again.getByTestId('ny-too-much-send').click()
          await expect.poll(async () => (await messagesOf(job.deliverableId, 'too_much')).filter((m) => m.status === 'open').length).toBe(1)
          tooMuch2 = (await messagesOf(job.deliverableId, 'too_much')).find((m) => m.status === 'open')!.id
          await again.context().close()
        })
        await walk.act('Rebalance — the Schedule opens', async () => {
          await s.go(ld, '/my-work')
          await ld.getByTestId(`needs-you-rebalance-${tooMuch2}`).click({ timeout: 30_000 })
          await expect(ld).toHaveURL(/\/schedule\?campaign=/)
          await expect.poll(async () => (await messagesOf(job.deliverableId, 'too_much')).find((m) => m.id === tooMuch2)?.status).toBe('rebalanced')
        })
        await walk.shot(ld, 'owner-rebalance', { caption: 'Rebalance: the Schedule on the job\'s campaign, to give the work to someone with room.' })

        walk.begin('Extension — the owner\'s step: Decline, or Forward with a note', PEOPLE.lead.name)
        walk.note('FRAME: ADR-0109 — the piece\'s owner judges an extension first. Forward needs a note (E3); Decline ends it.')
        await s.go(ld, '/my-work')
        await walk.act('press Decline — the dialog opens on Decline', async () => {
          await ld.getByTestId(`needs-you-decline-${extensionId}`).click({ timeout: 30_000 })
          await expect(ld.getByTestId('ny-ext-owner-mode-decline')).toBeChecked()
        })
        await walk.shot(ld, 'owner-extension-decline', { caption: 'The owner\'s step, on Decline: the maker\'s reason, the dates, and a reason for declining.' })
        await walk.act('switch to Forward — Send waits for the note', async () => {
          await ld.getByTestId('ny-ext-owner-mode-forward').check()
          await expect(ld.getByTestId('ny-ext-owner-send')).toBeDisabled()
          await ld.getByTestId('ny-ext-owner-text').fill('Fair — the photography is late from the client.')
        })
        await walk.shot(ld, 'owner-extension-forward', { caption: 'Forward to the account manager, with the owner\'s note (required).' })
        await walk.act('Forward it', async () => {
          await ld.getByTestId('ny-ext-owner-send').click()
          await expect.poll(async () => (await pendingExtension(JT.work.id))?.stage).toBe('am')
        })

        walk.begin('A change request — See what it costs, then Decide', PEOPLE.lead.name)
        walk.note('FRAME: ADR-0110 — a change to started work is a request the owner answers: accept, decline with a reason, or push back with words and a date.')
        await walk.act('See what it costs', async () => {
          await ld.getByTestId(`needs-you-change-cost-${crA}`).click({ timeout: 30_000 })
          await expect(ld.getByTestId('ny-change-cost-cost-work')).toContainText('2 tasks started')
        })
        await walk.shot(ld, 'owner-change-cost', { caption: 'What it costs: the tasks started, the hours booked and timed, where the piece lands.' })
        await ld.getByTestId('ny-change-cost-close').click().catch(() => {})
        await walk.act('Decide — the three answers', async () => {
          await ld.getByTestId(`needs-you-decide-change-${crA}`).click()
          await expect(ld.getByTestId('ny-change-decide-change-due')).toBeVisible()
          await expect(ld.getByTestId('ny-change-decide-told')).toContainText(PEOPLE.am.name)
          for (const m of ['accept', 'decline', 'push_back']) await expect(ld.getByTestId(`ny-change-decide-mode-${m}`)).toBeVisible()
        })
        await walk.shot(ld, 'owner-change-decide', { caption: 'Decide: before → after, who asked; Accept, Decline (with a reason) or Push back (words and a date).' })
        await walk.act('Push back with a date', async () => {
          await ld.getByTestId('ny-change-decide-mode-push_back').check()
          await ld.getByTestId('ny-change-decide-text').fill('A week later, not three.')
          await ld.getByTestId('ny-change-decide-date').fill(addDays(today, 25))
        })
        await walk.shot(ld, 'owner-change-push-back', { caption: 'Push back: the owner\'s version goes back to the account manager.' })
        await walk.act('send the push-back', async () => {
          await ld.getByTestId('ny-change-decide-send').click()
          await expect.poll(async () => (await changeRequest(crA))?.status).toBe('pushed_back')
        })
        await walk.act(`Decline the one on ${PIECES.reel.name}, with a reason`, async () => {
          await ld.getByTestId(`needs-you-decide-change-${crB}`).click({ timeout: 30_000 })
          await ld.getByTestId('ny-change-decide-mode-decline').check()
          await ld.getByTestId('ny-change-decide-text').fill('The client has not agreed it.')
          await walk.shot(ld, 'owner-change-decline', { caption: 'Decline: the reason goes to the account manager.' })
          await ld.getByTestId('ny-change-decide-send').click()
          await expect.poll(async () => (await changeRequest(crB))?.status).toBe('declined')
        })

        walk.begin('Over capacity', PEOPLE.lead.name)
        restore.pct = await overCapacityPct()
        walk.note(`STAGED: the tenant's over-capacity line is ${restore.pct}%. For this one look the admin lowers it to 5% on the Escalations screen (the same field chapter 5 shows) and puts it back straight after — so the card appears for whoever in the team is booked past it this week (the walk's own work sits next week, so this week's bookings are light).`)
        await walk.act('the admin lowers the line to 50%', async () => {
          const ad = await s.as('admin')
          await s.go(ad, '/admin/organization')
          await ad.getByTestId('escalation-over-capacity').fill('5')
          await ad.getByTestId('escalation-settings-save').click()
          await orgSaved(ad)
          await ad.context().close()
        })
        await s.go(ld, '/my-work')
        const over = ld.locator('[data-kind="over_capacity"]').first()
        let overId = ''
        await walk.check('an Over capacity card is in the lead\'s Needs you', async () => {
          await expect(over).toBeVisible({ timeout: 30_000 })
          overId = ((await over.getAttribute('data-testid')) ?? '').replace('needs-you-over_capacity-', '')
        })
        await walk.shot(ld, 'owner-over-capacity', { of: over, caption: 'Over capacity: who, how booked this week against the line. Rebalance opens the Schedule on them; See the week opens Team.' })
        await walk.act('See the week', async () => {
          await ld.getByTestId(`needs-you-see-week-${overId}`).click()
          await expect(ld).toHaveURL(/\/team/)
        })
        await walk.act(`the admin puts the line back to ${restore.pct}%`, async () => {
          const ad = await s.as('admin')
          await s.go(ad, '/admin/organization')
          await ad.getByTestId('escalation-over-capacity').fill(String(restore.pct))
          await ad.getByTestId('escalation-settings-save').click()
          await orgSaved(ad)
          await ad.context().close()
          expect(await overCapacityPct()).toBe(restore.pct)
          restore.pct = null
        })
        await ld.context().close()

        // ---- the team view, as the Design team lead ----
        const tl = await s.as('tl')
        walk.begin('The team view — figures, the timeline, the key', PEOPLE.tl.name)
        walk.note('FRAME: Team (ADR-0105 d.4) — the team lead\'s team only: Team (people, % booked) · At risk · Unassigned · In review; four tabs; bars are TASKS, coloured by their STATUS with the status as the key (I67.3, ADR-0131); the workstream is a filter.')
        await s.go(tl, `/team?on=${week}`)
        await expect(tl.getByTestId('team-timeline')).toBeVisible({ timeout: 30_000 })
        await walk.check('the four figures', async () => {
          for (const f of ['team', 'at-risk', 'unassigned', 'review']) await expect(tl.getByTestId(`team-figure-${f}`)).toBeVisible()
        })
        await walk.check(`the Design team only: ${PEOPLE.deputy.name} and ${PEOPLE.maker.name}, not ${PEOPLE.animator.name} (Motion); no department picker`, async () => {
          await expect(tl.getByTestId(`team-row-${res.deputy}`)).toBeVisible()
          await expect(tl.getByTestId(`team-row-${res.maker}`)).toBeVisible()
          await expect(tl.getByTestId(`team-row-${res.animator}`)).toHaveCount(0)
          await expect(tl.getByTestId('team-department-picker')).toHaveCount(0)
        })
        await walk.check('the key is the status; the bars are on the people, each coloured by its task\'s status', async () => {
          for (const k of ['notStarted', 'inProgress', 'review', 'changes', 'blocked', 'unassigned']) await expect(tl.getByTestId(`team-key-${k}`)).toBeVisible()
          await expect(tl.getByTestId(`tv-bar-${T.reel[0].id}`)).toHaveAttribute('data-status', 'inProgress')
          await expect(tl.getByTestId(`tv-bar-${T.kv[0].id}`)).toBeVisible()
          await expect(tl.getByTestId(`tv-bar-${T.reel[0].id}`)).toBeVisible()
        })
        await walk.check(`Nobody yet holds "${resize!.title}" — a task on a piece the team lead owns (E1)`, async () => {
          await expect(tl.getByTestId('team-row-nobody').getByTestId(`tv-bar-${resize!.id}`)).toBeVisible()
        })
        await walk.shot(tl, 'tl-team', { full: true, caption: `The team view on the week of ${week}: the figures, the key, one row per person with their % booked, Nobody yet at the foot. Drag a bar to move or give it.` })
        await walk.shot(tl, 'tl-figures', { of: tl.getByTestId('team-kpis'), caption: 'The figures: each opens its tab, filtered.' })

        walk.begin('The workstream filter', PEOPLE.tl.name)
        await walk.act(`filter to ${GROUPS[0]}`, async () => {
          await tl.getByTestId('team-workstream-filter').selectOption(wsId(GROUPS[0]))
        })
        await walk.check(`${PIECES.kv.name}'s bar stays; ${PIECES.reel.name}'s fades`, async () => {
          await expect(tl.getByTestId(`tv-bar-${T.kv[0].id}`)).not.toHaveClass(/tv-bar-faded/)
          await expect(tl.getByTestId(`tv-bar-${T.reel[0].id}`)).toHaveClass(/tv-bar-faded/)
        })
        await walk.shot(tl, 'tl-filter', { full: true, caption: `Workstream: ${GROUPS[0]} — every other workstream fades.` })
        await tl.getByTestId('team-workstream-filter').selectOption('').catch(() => {})

        walk.begin('The week arrows', PEOPLE.tl.name)
        const titleBefore = await tl.getByTestId('team-title').textContent()
        await walk.act('next week, then back', async () => {
          await tl.getByTestId('team-week-next').click()
          await expect(tl.getByTestId('team-title')).not.toHaveText(titleBefore ?? '')
          await walk.shot(tl, 'tl-next-week', { caption: 'A week on: the header says which week.' })
          await tl.getByTestId('team-week-prev').click()
          await expect(tl.getByTestId('team-title')).toHaveText(titleBefore ?? '')
        })

        walk.begin('A drag past the committed date — L6, Move it anyway', PEOPLE.tl.name)
        const late = addDays(week, 3)
        await walk.act(`drag "${T.kv[0].title}" to ${late}`, async () => {
          await dragOnTeam(tl, T.kv[0].id, res.deputy, late)
          await expect(tl.getByTestId('team-move-warning-dialog')).toBeVisible()
        })
        await walk.check('the warning is the "after the date" one (L6), and offers Keep the date, Ask for the extension, Move it anyway, Cancel', async () => {
          await expect(tl.getByTestId('team-move-warning-dialog')).toHaveClass(/move-warning-late/)
          for (const b of ['keep-date', 'extension', 'confirm', 'cancel']) await expect(tl.getByTestId(`team-move-warning-${b}`)).toBeVisible()
        })
        await walk.shot(tl, 'tl-l6', { caption: 'L6: the move lands after the committed date. Keep the date (give it to someone with room), ask for the extension, move it anyway, or cancel — warned, never refused.' })
        await walk.act('Move it anyway', async () => {
          await tl.getByTestId('team-move-warning-confirm').click()
          await expect.poll(async () => (await taskRow(T.kv[0].id)).starts_at?.slice(0, 10), { timeout: 20_000 }).toBe(late)
        })
        await walk.shot(tl, 'tl-after-l6', { full: true, caption: 'Moved: the bar sits on its new day and shows late.' })

        walk.begin('A drag onto someone full — L7', PEOPLE.tl.name)
        await s.go(tl, `/team?on=${week}`)
        await walk.act(`drag "${resize!.title}" from Nobody yet onto ${PEOPLE.maker.name}`, async () => {
          await dragOnTeam(tl, resize!.id, res.maker, week)
          await expect(tl.getByTestId('team-move-warning-dialog')).toBeVisible()
        })
        await walk.check('the warning is the "at the ceiling" one (L7), offering the freest person instead', async () => {
          await expect(tl.getByTestId('team-move-warning-dialog')).toHaveClass(/move-warning-ceiling/)
          await expect(tl.getByTestId('team-move-warning-instead')).toBeVisible()
        })
        await walk.shot(tl, 'tl-l7', { caption: `L7: ${PEOPLE.maker.name} is full this week. Give it to the freest person instead, give it to them anyway, or cancel.` })
        await walk.act('Cancel — nothing is given', async () => {
          await tl.getByTestId('team-move-warning-cancel').click()
          expect((await taskRow(resize!.id)).assignee_id).toBeNull()
        })

        walk.begin('By person, By piece (the For column), Load', PEOPLE.tl.name)
        await walk.act('By person', async () => {
          await tl.getByTestId('team-tab-person').click()
          await expect(tl.getByTestId('team-by-person')).toBeVisible()
        })
        await walk.shot(tl, 'tl-by-person', { full: true, caption: 'By person: each person\'s week and notes; the name opens the Schedule on them.' })
        await walk.act('By piece', async () => {
          await tl.getByTestId('team-tab-piece').click()
          await expect(tl.getByTestId('team-by-piece')).toBeVisible()
        })
        await walk.check('the For column says how long each task has been where it is (E2)', async () => {
          await expect(tl.getByRole('columnheader', { name: 'For' })).toBeVisible()
          await expect(tl.getByTestId(`team-piece-for-${resize!.id}`)).toHaveText(/^(under 1h|\d+h|\d+ days?)$/)
        })
        await walk.shot(tl, 'tl-by-piece', { full: true, caption: 'By piece: every task by its piece — who, where it is, and For how long; Move or Assign open the Schedule.' })
        await walk.act('Load', async () => {
          await tl.getByTestId('team-tab-load').click()
          await expect(tl.getByTestId('team-load')).toBeVisible()
        })
        await walk.shot(tl, 'tl-load', { full: true, caption: 'Load: three weeks, each person\'s booked hours against their capacity, in sentences.' })
        await tl.context().close()

        // ================================================================ 3. department lead ====
        walk.open('dept', `3 · The department lead — ${PEOPLE.lead.name}`)
        const dl = await s.as('lead')
        const [designTeam] = await rows<{ team_id: string | null }>('user_profiles', `select=team_id&id=eq.${uid.tl}`)
        const [motionTeam] = await rows<{ team_id: string | null }>('user_profiles', `select=team_id&id=eq.${uid.motiontl}`)
        walk.begin('The department view, grouped by team', PEOPLE.lead.name)
        walk.note('FRAME: the department view (Q4) — the team view\'s four tabs, people grouped under their team with the team\'s load on each heading, people with no team under "No team". Nobody yet is every unassigned task in the department.')
        await s.go(dl, `/team?on=${week}`)
        await expect(dl.getByTestId('team-timeline')).toBeVisible({ timeout: 30_000 })
        await walk.check('Design and Motion each have a heading, with their people', async () => {
          await expect(dl.getByTestId(`team-group-team:${designTeam.team_id}`)).toBeVisible()
          await expect(dl.getByTestId(`team-group-team:${motionTeam.team_id}`)).toBeVisible()
          await expect(dl.getByTestId(`team-section-team:${designTeam.team_id}`).getByTestId(`team-row-${res.deputy}`)).toBeVisible()
          await expect(dl.getByTestId(`team-section-team:${motionTeam.team_id}`).getByTestId(`team-row-${res.animator}`)).toBeVisible()
        })
        await walk.check('people with no team sit under "No team"', async () => {
          await expect(dl.getByTestId('team-section-none')).toBeVisible()
        })
        await walk.check('Nobody yet holds the whole department\'s unassigned work — the job\'s tasks too', async () => {
          await expect(dl.getByTestId('team-row-nobody').getByTestId(`tv-bar-${workflow[2].id}`)).toBeVisible()
        })
        await walk.shot(dl, 'dept-timeline', { full: true, caption: 'The Creative department: Design, Motion, No team — each heading with its load; Nobody yet across the department.' })
        for (const [tab, id, caption] of [
          ['person', 'team-by-person', 'By person, for the department: grouped the same way.'],
          ['piece', 'team-by-piece', 'By piece, for the department: every piece with Creative work.'],
          ['load', 'team-load', 'Load, for the department.'],
        ] as const) {
          walk.begin(`The department's ${tab === 'person' ? 'By person' : tab === 'piece' ? 'By piece' : 'Load'}`, PEOPLE.lead.name)
          await walk.act(`open ${tab}`, async () => {
            await dl.getByTestId(`team-tab-${tab}`).click()
            await expect(dl.getByTestId(id)).toBeVisible()
          })
          await walk.shot(dl, `dept-${tab}`, { full: true, caption })
        }
        await dl.context().close()

        // ================================================================ 4. account manager ====
        walk.open('am', `4 · The account manager — ${PEOPLE.am.name}`)
        const am = await s.as('am')
        walk.begin('Needs you, for the account manager', PEOPLE.am.name)
        await s.go(am, '/my-work')
        await expect(am.getByTestId('needs-you-panel')).toBeVisible({ timeout: 30_000 })
        await walk.check('the forwarded extension, the pushed-back and the declined change, the client input and the question are there', async () => {
          await expect(am.getByTestId(`needs-you-decide-extension-${extensionId}`)).toBeVisible()
          await expect(am.getByTestId(`needs-you-accept-counter-${crA}`)).toBeVisible()
          await expect(am.getByTestId(`needs-you-close-change-${crB}`)).toBeVisible()
          await expect(am.getByTestId(`needs-you-mark-received-${clientInput.id}`)).toBeVisible()
          await expect(am.getByTestId(`needs-you-reply-${questionId}`)).toBeVisible()
        })
        await walk.shot(am, 'am-needs-you', { full: true, caption: 'The account manager\'s Needs you: an extension to decide, a pushed-back and a declined change, a client input, a question.' })

        walk.begin('The extension, the account manager\'s step — approve a shorter one', PEOPLE.am.name)
        await walk.act('open Decide', async () => {
          await am.getByTestId(`needs-you-decide-extension-${extensionId}`).click()
          await expect(am.getByTestId('ny-ext-am-owner-note')).toContainText('photography')
        })
        await walk.act('Approve a shorter one — between the commitment and the day asked', async () => {
          await am.getByTestId('ny-ext-am-mode-shorter').check()
          const max = await am.getByTestId('ny-ext-am-day').getAttribute('max')
          expect(max).toBe(addDays(today, 29))
          await am.getByTestId('ny-ext-am-day').fill(addDays(today, 20))
          await am.getByTestId('ny-ext-am-note').fill('Twenty days, not thirty.')
        })
        await walk.shot(am, 'am-extension-shorter', { caption: 'The account manager\'s step: the owner\'s note, then Approve, Approve a shorter one (a day up to the one asked) or Refuse.' })
        await walk.act('send', async () => {
          await am.getByTestId('ny-ext-am-send').click()
          await expect.poll(async () => pendingExtension(JT.work.id)).toBeUndefined()
        })

        walk.begin('A pushed-back change — Accept their version, or Withdraw', PEOPLE.am.name)
        await walk.act('open Accept their version', async () => {
          await am.getByTestId(`needs-you-accept-counter-${crA}`).click()
          await expect(am.getByTestId('ny-change-counter-mode-accept')).toBeVisible()
          await expect(am.getByTestId('ny-change-counter-mode-withdraw')).toBeVisible()
        })
        await walk.shot(am, 'am-counter', { caption: 'Pushed back: your version beside theirs. Accept theirs, or Withdraw (and send a new request later). There is no Insist.' })
        await walk.act('accept their version', async () => {
          await am.getByTestId('ny-change-counter-mode-accept').check()
          await am.getByTestId('ny-change-counter-send').click()
          await expect.poll(async () => (await changeRequest(crA))?.status).toBe('counter_accepted')
        })

        walk.begin('A declined change — Send a new request, or Close', PEOPLE.am.name)
        await walk.check('Send a new request goes to the piece\'s Edit', async () => {
          await expect(am.getByTestId(`needs-you-send-new-request-${crB}`)).toHaveAttribute('href', `/campaigns/${campaignId}?edit=${P.reel.id}`)
        })
        await walk.shot(am, 'am-declined', { of: am.getByTestId(`needs-you-change_declined-${crB}`), caption: 'Declined, with the owner\'s reason. Send a new request (the piece\'s Edit), or Close.' })
        await walk.act('Close', async () => {
          await am.getByTestId(`needs-you-close-change-${crB}`).click()
          await expect.poll(async () => (await changeRequest(crB))?.closed_at ?? null).not.toBeNull()
        })

        walk.begin('Waiting on the client — Mark received', PEOPLE.am.name)
        await walk.shot(am, 'am-client-card', { of: am.getByTestId(`needs-you-client_waiting-${clientInput.id}`), caption: 'Waiting on the client: what, from whom, for how long (real time).' })
        await walk.act('Mark received', async () => {
          await am.getByTestId(`needs-you-mark-received-${clientInput.id}`).click()
          await expect(am.getByTestId('ny-received-dialog')).toBeVisible()
        })
        await walk.shot(am, 'am-received', { caption: 'Mark received: one press — the owner and the maker are told.' })
        await walk.act('confirm', async () => {
          await am.getByTestId('ny-received-send').click()
          await expect.poll(async () => (await inputsOf(P.poster.id)).find((i) => i.id === clientInput.id)?.satisfied_at ?? null).not.toBeNull()
        })

        walk.begin('A question — Reply', PEOPLE.am.name)
        await walk.act('open Reply', async () => {
          await am.getByTestId(`needs-you-reply-${questionId}`).click()
          await expect(am.getByTestId('ny-reply-question')).toContainText('autumn headline')
          await am.getByTestId('ny-reply-body').fill('Final — the client signed it off this morning.')
        })
        await walk.shot(am, 'am-reply', { caption: 'Reply: the question, and the answer — to the asker, on the piece\'s Questions.' })
        await walk.act('send', async () => {
          await am.getByTestId('ny-reply-send').click()
          await expect.poll(async () => (await messagesOf(job.deliverableId, 'reply')).length).toBe(1)
        })

        walk.begin('Reduced scope — Record the acknowledgement', PEOPLE.am.name)
        walk.note('A second single job, due tomorrow — released short of its lead time, which asks for the client\'s acknowledgement and never blocks the work.')
        let shortId = ''
        await walk.act('release a job due tomorrow (reduced scope)', async () => {
          await am.goto('/campaigns/new-job')
          await am.getByTestId('sj-client').selectOption({ label: 'Northwind Beverages' })
          await am.getByTestId('sj-words').fill('One store static, tomorrow.')
          await am.getByTestId('sj-brief-card-single_execution').click()
          await am.getByTestId('sj-next').click()
          await am.getByTestId('sj-field-task').fill('Design one store static.')
          await am.getByTestId('sj-next').click()
          await am.getByTestId('sj-title').fill('Store static for tomorrow')
          await am.getByTestId('sj-due').fill(addDays(today, 1))
          await am.getByTestId('sj-department').getByRole('radio', { name: 'Creative' }).click()
          await pickJobLanguages(am)
          await am.getByTestId('sj-next').click()
          await am.getByTestId('sj-short-continue').click()
          const prompt = am.getByTestId('sj-similar-dialog')
          const review = am.getByTestId('sj-review')
          const first = await Promise.any([
            prompt.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'prompt' as const),
            review.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'review' as const),
          ])
          if (first === 'prompt') await am.getByTestId('sj-similar-separate').click()
          await expect(am.getByTestId('sj-review-reduced-scope')).toBeVisible()
          shortId = await approveSingleJob(am)
        })
        await s.go(am, '/my-work')
        await walk.act('open Record the acknowledgement', async () => {
          await am.getByTestId(`needs-you-record-ack-${shortId}`).click({ timeout: 30_000 })
          await expect(am.getByTestId('ny-scope-ack-days')).toBeVisible()
          await expect(am.getByTestId('ny-scope-ack-send')).toBeDisabled()
          await am.getByTestId('ny-scope-ack-by').fill('Ahmed (Northwind)')
          await am.getByTestId('ny-scope-ack-via').selectOption('email')
          await am.getByTestId('ny-scope-ack-at').fill(`${today}T10:30`)
          await am.getByTestId('ny-scope-ack-note').fill('Understood — a lighter version is fine.')
        })
        await walk.shot(am, 'am-scope-ack', { caption: 'Reduced scope: how short it is, who at the client acknowledged it, how and when. Recorded — it never blocks the work.' })
        await walk.act('record it', async () => {
          await am.getByTestId('ny-scope-ack-send').click()
          await expect.poll(async () => (await rows<{ acknowledged_by: string }>('scope_acknowledgements', `select=acknowledged_by&campaign_id=eq.${shortId}`))[0]?.acknowledged_by).toBe('Ahmed (Northwind)')
        })

        walk.begin('Edit on a started piece — the change-request warning', PEOPLE.am.name)
        walk.note(`FRAME: CG-E2 — a new due date on ${PIECES.teaser.name}, which ${PEOPLE.maker.name} has started, is not saved: it becomes a request to the owner. Who asked is required; the client's evidence is asked for, never required (E5).`)
        await walk.act('open Edit and give a new due date', async () => {
          await s.go(am, `/campaigns/${campaignId}`)
          await am.getByTestId('campaign-tab-grid').click()
          // ADR-0132 d.3: the grid's Edit opens the panel; the client's change is its own route, which opens this dialog.
          await am.getByTestId(`campaign-deliverable-edit-${P.teaser.id}`).click()
          await am.getByTestId('piece-panel-client-change').click()
          await expect(am.getByTestId('campaign-deliverable-form')).toBeVisible()
          await expect(am.getByTestId('campaign-deliverable-form-started')).toBeVisible()
        })
        await walk.shot(am, 'am-edit-started', { caption: 'Edit says the work has started, and who owns it: a change to type, quantity or date will be a request.' })
        await walk.act('Save — the warning opens instead', async () => {
          await am.getByTestId('campaign-deliverable-form-due-day').fill(addDays(week, 12))
          await am.getByTestId('campaign-deliverable-form-submit').click()
          await expect(am.getByTestId('change-request-dialog')).toBeVisible()
        })
        await walk.check('it shows the change, the cost, the owner\'s clock, and asks for evidence', async () => {
          await expect(am.getByTestId('change-request-cost-total')).toContainText('1 task started')
          await expect(am.getByTestId('change-request-escalates')).toContainText(`${PEOPLE.lead.name} has until`)
          await expect(am.getByTestId('change-request-evidence')).toBeVisible()
        })
        await walk.shot(am, 'am-change-request', { caption: 'The change request: before → after, the started task and hours, when the owner must answer; who asked (the client spends a round); the evidence field.' })
        await walk.act('Send without saying who asked — refused in words', async () => {
          await am.getByTestId('change-request-send').click()
          await expect(am.getByTestId('change-request-error')).toContainText('Say who asked')
        })
        await walk.shot(am, 'am-change-request-who', { caption: 'Who asked is the one required answer.' })
        await walk.act('"The client", no evidence — sent', async () => {
          await am.getByTestId('change-request-asked-by-client').check()
          await am.getByTestId('change-request-send').click()
          await expect(am.getByTestId('campaign-banner')).toContainText(`Sent to ${PEOPLE.lead.name} as a change request`)
        })
        await walk.check('one pending request, with no evidence; the date unchanged', async () => {
          const reqs = await rows<{ status: string; evidence_asset_id: string | null }>('deliverable_change_requests', `select=status,evidence_asset_id&deliverable_id=eq.${P.teaser.id}`)
          expect(reqs).toHaveLength(1)
          expect(reqs[0]).toMatchObject({ status: 'pending', evidence_asset_id: null })
        })

        walk.begin('The department picker on Team', PEOPLE.am.name)
        walk.note('FRAME: roles with no department of their own pick one (Q5).')
        await walk.act('open Team and pick Creative', async () => {
          await s.go(am, `/team?on=${week}`)
          await am.getByTestId('team-department-picker').selectOption(creative.id)
          await expect(am.getByTestId('team-title')).toContainText('Creative')
        })
        await walk.shot(am, 'am-team-picker', { full: true, caption: 'The account manager\'s Team: a department picker, then the same department view.' })
        await am.context().close()

        // ================================================================ 5. traffic / admin ====
        walk.open('traffic', '5 · Traffic and the admin')
        const ad = await s.as('admin')
        walk.begin('The Escalations settings', PEOPLE.admin.name)
        walk.note('FRAME: ADR-0108 — every escalation is real time and editable: its hours, the roles and the people relative to the piece; the over-capacity line; the untimed minutes; the filler words.')
        await s.go(ad, '/admin/organization')
        await walk.check('every rule is a row with its hours; the over-capacity % and untimed minutes are fields; Save waits for a change', async () => {
          await expect(ad.getByTestId('escalation-settings-form')).toBeVisible()
          for (const k of ['unassigned', 'blocked', 'extension_owner', 'extension_am']) await expect(ad.getByTestId(`escalation-row-${k}`)).toBeVisible()
          await expect(ad.getByTestId('escalation-over-capacity')).toBeVisible()
          await expect(ad.getByTestId('escalation-untimed-minutes')).toBeVisible()
          await expect(ad.getByTestId('escalation-settings-save')).toBeDisabled()
        })
        await walk.shot(ad, 'admin-escalations', { of: ad.getByTestId('escalation-settings-form'), caption: 'Escalations: each rule\'s hours, the roles it reaches, the people relative to the piece; the over-capacity line and the untimed minutes.' })
        await walk.act('change the blocked rule\'s hours (not saved)', async () => {
          await ad.getByTestId('escalation-hours-blocked').fill('30')
          await expect(ad.getByTestId('escalation-settings-save')).toBeEnabled()
        })
        await walk.shot(ad, 'admin-escalations-changed', { of: ad.getByTestId('escalation-row-blocked'), caption: 'A rule changed: Save turns on. (Not saved — the page is reloaded.)' })
        await ad.reload()

        walk.begin('A rule that reaches nobody', PEOPLE.admin.name)
        restore.extensionAm = await ruleOf('extension_am')
        await walk.act('take every role and person off the AM step\'s rule, and save', async () => {
          for (const id of restore.extensionAm!.role_ids) await ad.getByTestId(`escalation-role-remove-extension_am-${id}`).click()
          for (const p of restore.extensionAm!.relative) await ad.getByTestId(`escalation-person-extension_am-${p}`).click()
          await ad.getByTestId('escalation-settings-save').click()
          await orgSaved(ad)
          await ad.reload()
        })
        await walk.check('it says "Reaches nobody — escalated to Traffic instead"', async () => {
          await expect(ad.getByTestId('escalation-nobody-extension_am')).toContainText(/Reaches nobody — escalated to Traffic instead/)
        })
        await walk.shot(ad, 'admin-reaches-nobody', { of: ad.getByTestId('escalation-row-extension_am'), caption: 'A rule with nobody on it says so: it falls back to Traffic (E9).' })
        await walk.act('put it back as it was', async () => {
          await restoreRule(ad, restore.extensionAm!)
          await ad.getByTestId('escalation-settings-save').click()
          await orgSaved(ad)
          const now = await ruleOf('extension_am')
          expect(now.role_ids.sort()).toEqual([...restore.extensionAm!.role_ids].sort())
          expect(now.relative.sort()).toEqual([...restore.extensionAm!.relative].sort())
          restore.extensionAm = null
        })

        walk.begin('Filler words', PEOPLE.admin.name)
        const word = 'placeholder'
        await walk.check('the built-in words are shown, with no remove', async () => {
          await expect(ad.getByTestId('filler-words-built-in')).toContainText('tbd')
          await expect(ad.getByTestId('filler-words-built-in').getByRole('button')).toHaveCount(0)
        })
        let wordId = ''
        await walk.act(`add "${word}"`, async () => {
          await ad.getByTestId('filler-word-form').getByTestId('filler-word-input').fill(word)
          await ad.getByTestId('filler-word-add').click()
          await orgSaved(ad)
          wordId = (await rows<{ id: string }>('tenant_filler_words', `select=id&word=eq.${word}`))[0].id
        })
        await walk.shot(ad, 'admin-filler', { full: true, caption: 'Filler words: the built-in list, and the tenant\'s own — each with a remove that asks twice.' })
        await walk.act('remove it (armed, then confirmed)', async () => {
          await ad.getByTestId(`filler-word-remove-${wordId}`).click()
          await expect(ad.getByTestId(`filler-word-remove-${wordId}`)).toHaveAttribute('data-armed', 'true')
          await ad.getByTestId(`filler-word-remove-${wordId}`).click()
          await orgSaved(ad)
        })
        await ad.context().close()

        walk.begin('An escalated item in Needs you', PEOPLE.traffic.name)
        walk.note(`STAGED: the job's task list was approved minutes ago; the unassigned rule waits ${(await ruleOf('unassigned')).hours} hours. The walk moves the approval 25 hours back with the service role and runs the sweep once — the job \`stall-sweep\` runs on its timer. Everything the sweep sends is the product's own.`)
        await walk.act('stage the clock and run the sweep', async () => {
          const moved = await attemptWrite('PATCH', 'deliverables', `id=eq.${job.deliverableId}`, { tasks_approved_at: new Date(Date.now() - 25 * 3_600_000).toISOString() })
          expect(moved.status, moved.text).toBeLessThan(300)
          await runEscalationSweep(job.deliverableId)
        })
        let escId = ''
        await walk.check('Traffic has an "escalated" notification on the job', async () => {
          const [n] = await rows<{ id: string }>('notifications', `select=id&user_id=eq.${uid.traffic}&entity_id=eq.${job.deliverableId}&type=eq.escalated&order=created_at.desc`)
          expect(n, 'an escalated notification to Traffic').toBeTruthy()
          escId = n.id
        })
        const tr = await s.as('traffic')
        await s.go(tr, '/my-work')
        await walk.check('it is in Traffic\'s Needs you, in "today or it slips"', async () => {
          await expect(tr.getByTestId(`needs-you-escalated-${escId}`)).toBeVisible({ timeout: 30_000 })
          await expect(tr.getByTestId(`needs-you-escalated-${escId}`)).toHaveAttribute('data-group', 'today')
        })
        await walk.shot(tr, 'traffic-escalated', { of: tr.getByTestId(`needs-you-escalated-${escId}`), caption: 'Escalated to you: what stalled, whose it is, how long past its hours. Open goes to the Schedule for unassigned work.' })
        await walk.act('Open', async () => {
          await tr.getByTestId(`needs-you-open-escalated-${escId}`).click()
          await expect(tr).toHaveURL(new RegExp(`/schedule\\?campaign=${job.campaignId}`))
        })

        walk.begin('The Schedule\'s assignment dialog, restyled', PEOPLE.traffic.name)
        walk.note('FRAME: L2 — the same fields and the same behaviour, restyled (Q31): no new picker.')
        await walk.act(`open Add on ${PEOPLE.deputy.name}'s ${week}`, async () => {
          await s.go(tr, `/schedule?on=${week}`)
          await expect(tr.getByTestId('schedule-grid')).toBeVisible()
          const cell = tr.getByTestId(`cell-${res.deputy}-${week}`)
          await cell.hover()
          await tr.getByTestId(`add-${res.deputy}-${week}`).click()
          await expect(tr.getByTestId('booking-dialog')).toBeVisible()
        })
        await walk.check('the L2 header: the person, their week', async () => {
          await expect(tr.getByTestId('booking-l2-heading')).toBeVisible()
          await expect(tr.getByTestId('booking-l2-person')).toContainText(PEOPLE.deputy.name)
        })
        await walk.shot(tr, 'traffic-assign-dialog', { caption: 'The assignment dialog: who, their week, the piece and task, the hours, the reviewers. Cancel — nothing is booked.' })
        await tr.getByTestId('booking-cancel').click().catch(() => {})

        walk.begin('A move warning on the Schedule', PEOPLE.traffic.name)
        const [chip] = await rows<{ id: string }>('bookings', `select=id&sub_task_id=eq.${T.kv[1].id}&state=in.(soft_hold,tentative,confirmed)&order=starts_at.asc`)
        await walk.act(`drag "${T.kv[1].title}" past its committed date`, async () => {
          expect(chip, `a booking for ${T.kv[1].title}`).toBeTruthy()
          await s.go(tr, `/schedule?on=${week}`)
          await dragOnSchedule(tr, chip.id, res.maker, addDays(week, 4))
          await expect(tr.getByTestId('drop-warning-dialog')).toBeVisible()
        })
        await walk.check('the same L6 dialog as the team view', async () => {
          await expect(tr.getByTestId('drop-warning-dialog')).toHaveClass(/move-warning-late/)
        })
        await walk.shot(tr, 'traffic-move-warning', { caption: 'The Schedule\'s drag says the same thing as the team view\'s: after the committed date — keep the date, ask, move anyway, or cancel.' })
        await walk.act('Cancel — nothing moved', async () => {
          await tr.getByTestId('drop-warning-cancel').click()
          await expect(tr.getByTestId('drop-warning-dialog')).toHaveCount(0)
        })
        await tr.context().close()

        // ================================================================ 6. cross-cutting ====
        walk.open('cross', '6 · Across every role')
        walk.begin('The side menu, per role', 'six people')
        walk.note('FRAME: the side menu keeps every item each role has today, restyled (Q35).')
        for (const tag of ['deputy', 'tl', 'lead', 'am', 'traffic', 'admin'] as const) {
          const p = await s.as(tag)
          await s.go(p, '/my-work')
          await walk.check(`${PEOPLE[tag].name}: My Work is in the menu and marked current`, async () => {
            await expect(p.getByTestId('nav-my-work')).toHaveClass(/active/)
          })
          if (tag === 'lead' || tag === 'tl') await walk.check(`${PEOPLE[tag].name}: Team is in the menu`, async () => expect(p.getByTestId('nav-team')).toBeVisible())
          if (tag === 'admin') await walk.check(`${PEOPLE[tag].name}: Organization is in the menu`, async () => expect(p.getByTestId('nav-admin-organization')).toBeVisible())
          if (tag === 'deputy') await walk.check(`${PEOPLE[tag].name}: no admin items`, async () => expect(p.getByTestId('nav-admin-organization')).toHaveCount(0))
          await walk.shot(p, `menu-${tag}`, { of: p.locator('aside.sidebar'), caption: `The side menu for ${PEOPLE[tag].name} (${PEOPLE[tag].role}).` })
          await p.context().close()
        }

        walk.begin('The chime switch', PEOPLE.deputy.name)
        const ch = await s.as('deputy')
        await s.go(ch, '/my-work')
        await walk.check('on by default, a switch', async () => {
          await expect(ch.getByTestId('notif-chime-switch')).toHaveAttribute('role', 'switch')
          await expect(ch.getByTestId('notif-chime-switch')).toHaveAttribute('aria-checked', 'true')
        })
        await walk.shot(ch, 'chime-on', { of: ch.locator('.topbar'), caption: 'By the bell: the chime switch, on — notifications that ask for action chime.' })
        await walk.act('switch it off — remembered on this device — then on again', async () => {
          await ch.getByTestId('notif-chime-switch').click()
          await expect(ch.getByTestId('notif-chime-switch')).toHaveAttribute('aria-checked', 'false')
          expect(await ch.evaluate(() => localStorage.getItem('maestro.notificationChime'))).toBe('off')
          await walk.shot(ch, 'chime-off', { of: ch.locator('.topbar'), caption: 'Off.' })
          await ch.getByTestId('notif-chime-switch').click()
          await expect(ch.getByTestId('notif-chime-switch')).toHaveAttribute('aria-checked', 'true')
        })
        await ch.context().close()

        walk.begin('Filler refused at release, the field named; "N/A" accepted', PEOPLE.am.name)
        walk.note('FRAME: ADR-0111 — filler (XYZ, TBD, lorem ipsum, "…", digits only…) is refused at release with the field named; "N/A" and a number on its own are real answers (E13).')
        const fa = await s.as('am')
        await walk.act('the warning beside the field, as it is typed', async () => {
          await fa.goto('/campaigns/new-job')
          await fa.getByTestId('sj-client').selectOption({ label: 'Northwind Beverages' })
          await fa.getByTestId('sj-words').fill('Two autumn statics.')
          await fa.getByTestId('sj-brief-card-single_execution').click()
          await fa.getByTestId('sj-next').click()
          await fa.getByTestId('sj-field-task').fill('TBD')
          await expect(fa.getByTestId('sj-field-task-filler')).toContainText('is placeholder text')
        })
        await walk.shot(fa, 'filler-warning', { caption: 'Typed "TBD": the brief says, beside the field, that it is placeholder text.' })
        await walk.act('release with "XYZ 123" — refused, naming the field and its text', async () => {
          await fillSingleJobToReview(fa, { title: 'Eid store window poster', department: 'Creative', task: 'XYZ 123' })
          await fa.getByTestId('sj-approve').click()
          const prompt = fa.getByTestId('sj-similar-dialog')
          const error = fa.getByTestId('sj-error')
          const first = await Promise.any([
            prompt.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'prompt' as const),
            error.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'error' as const),
          ])
          if (first === 'prompt') await fa.getByTestId('sj-similar-separate').click()
          await expect(fa.getByTestId('sj-error')).toContainText(/still says 'XYZ 123' — write the real/i)
        })
        await walk.shot(fa, 'filler-refused', { caption: 'Refused at release: which field, what it says, and what to write instead. An answer, not a fault — nothing to report.' })
        await fa.context().close()
        const na = await s.as('am')
        await walk.act('release with "N/A" in the task — accepted', async () => {
          const released = await releaseSingleJob(na, { title: 'Price list reprint', department: 'Creative', task: 'N/A' })
          expect(released.deliverableId).toBeTruthy()
        })
        await walk.shot(na, 'filler-na-released', { caption: '"N/A" is a real answer: the job is released and opens on its campaign page.' })
        await na.context().close()

        walk.begin('A manual-review note, answered by the maker', `${PEOPLE.deputy.name} and ${PEOPLE.lead.name}`)
        walk.note(`"${J.manual}" is reviewed by hand: the maker writes what they did, the reviewer writes back. Set-up: the maker starts, writes and sends through the RPCs My Work calls; the reviewer's note and Request changes are pressed on the review screen.`)
        let noteId = ''
        await walk.act('the maker sends the manual round', async () => {
          await rpcAs('deputy', 'sub_task_start', { p_id: JT.manual.id })
          await insertAs('deputy', 'review_feedback', { tenant_id: tenantId, sub_task_id: JT.manual.id, body: 'Call notes shared on the drive — three decisions, two open points.', author_user_id: uid.deputy })
          await rpcAs('deputy', 'sub_task_submit', { p_id: JT.manual.id, p_manual_minutes: null, p_accept_untimed: true })
          expect(await statusOf(JT.manual.id)).toBe('review')
        })
        const rv2 = await s.as('lead')
        await s.go(rv2, '/my-work')
        await walk.act('the reviewer writes a note and sends it back', async () => {
          await rv2.getByTestId(`awaiting-review-open-${JT.manual.id}`).click({ timeout: 30_000 })
          await rv2.getByTestId(`task-comment-body-${JT.manual.id}`).fill('Add who owns each open point.')
          await rv2.getByTestId(`task-comment-submit-${JT.manual.id}`).click()
          await expect.poll(async () => (await rows<{ id: string }>('review_feedback', `select=id&sub_task_id=eq.${JT.manual.id}&author_user_id=eq.${uid.lead}`)).length).toBe(1)
          noteId = (await rows<{ id: string }>('review_feedback', `select=id&sub_task_id=eq.${JT.manual.id}&author_user_id=eq.${uid.lead}`))[0].id
          await walk.shot(rv2, 'manual-reviewer-note', { caption: 'The reviewer\'s note on a manual task — there is no file, so the note is the review.' })
          await rv2.getByTestId(`awaiting-review-request-changes-${JT.manual.id}`).click()
          await expect.poll(() => statusOf(JT.manual.id)).toBe('todo')
        })
        await rv2.context().close()
        const mn = await s.as('deputy')
        await s.go(mn, `/my-work/task/${JT.manual.id}`)
        await walk.act('the maker replies under the note', async () => {
          const thread = mn.getByTestId(`task-review-thread-${JT.manual.id}`)
          await thread.getByTestId(`pin-reply-open-${noteId}`).click()
          await thread.getByTestId(`pin-reply-body-${noteId}`).fill('Added — owners named for both.')
          await thread.getByTestId(`pin-reply-submit-${noteId}`).click()
          await expect(thread.getByTestId(`pin-replies-${noteId}`)).toContainText('owners named')
        })
        await walk.shot(mn, 'manual-maker-reply', { of: mn.getByTestId('task-page-file'), caption: 'The maker\'s reply under the reviewer\'s note, with Mark done beside it — the same answers as a pin on a file.' })
        await mn.context().close()

        // ================================================================ 7. Arabic ====
        walk.open('arabic', '7 · In Arabic (right to left)')
        const arM = await s.as('deputy')
        walk.begin('My Work', PEOPLE.deputy.name)
        await s.go(arM, '/my-work', 'ar')
        await walk.check('right to left, and in Arabic', async () => {
          await expect(arM.locator('html')).toHaveAttribute('dir', 'rtl')
          await expect(arM.getByTestId('needs-you-panel')).toBeVisible({ timeout: 30_000 })
          await expect(arM.getByTestId(`needs-you-kind-${JT.fresh.id}`)).not.toHaveText('New on you')
        })
        await walk.shot(arM, 'ar-my-work', { full: true, caption: 'My Work in Arabic: Needs you, the lists, Your week — mirrored.' })
        walk.begin('The task page', PEOPLE.deputy.name)
        await s.go(arM, `/my-work/task/${JT.digital.id}`, 'ar')
        await walk.check('the task page is right to left', async () => {
          await expect(arM.getByTestId('task-page-title')).toBeVisible()
          await expect(arM.locator('html')).toHaveAttribute('dir', 'rtl')
        })
        await walk.shot(arM, 'ar-task-page', { full: true, caption: 'The task page in Arabic, in review after V2.' })
        await s.go(arM, '/my-work', 'en')
        await arM.context().close()
        const arT = await s.as('tl')
        walk.begin('The team view', PEOPLE.tl.name)
        await s.go(arT, `/team?on=${week}`, 'ar')
        await walk.check('the timeline reads from the right', async () => {
          await expect(arT.getByTestId('team-timeline')).toBeVisible({ timeout: 30_000 })
          await expect(arT.locator('html')).toHaveAttribute('dir', 'rtl')
          await expect(arT.getByTestId('team-tab-timeline')).not.toHaveText('Timeline')
        })
        await walk.shot(arT, 'ar-team', { full: true, caption: 'The team view in Arabic: days run right to left; names written in Latin stay as they are.' })
        await s.go(arT, `/team?on=${week}`, 'en')
        await arT.context().close()

        walk.open('end', 'What stays on the local stack')
        walk.begin('Left as it is', 'the walk')
        walk.note(`"${campaignName}" and "${jobTitle}" stay, in the states above, so the screens can be opened again by hand. The tenant's escalation settings are as they were; the one change request on ${PIECES.teaser.name} is pending with ${PEOPLE.lead.name}.`)
      } finally {
        await attemptWrite('PATCH', 'clients', `id=eq.${northwind!.id}`, { profile: northwindProfile }).catch(() => {})
        // The tenant's settings go back whatever happened above — never left escalating on the
        // wrong line (escalation-settings.spec.ts's lesson).
        if (restore.pct != null || restore.extensionAm) {
          const ad = await s.as('admin')
          await s.go(ad, '/admin/organization').catch(() => {})
          if (restore.extensionAm) await restoreRule(ad, restore.extensionAm).catch(() => {})
          if (restore.pct != null) await ad.getByTestId('escalation-over-capacity').fill(String(restore.pct)).catch(() => {})
          const save = ad.getByTestId('escalation-settings-save')
          if (await save.isEnabled().catch(() => false)) {
            await save.click().catch(() => {})
            await orgSaved(ad).catch(() => {})
          }
          await ad.context().close()
        }
        walk.flush()
      }
      expect(walk.failures(), `checks failed — read ${walk.reportFile}`).toBe(0)
    })
  })
}
