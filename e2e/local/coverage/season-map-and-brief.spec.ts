import { test, expect, type Browser, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { authFile, PEOPLE } from '../fixtures'
import { rows } from '../helpers/db'
import { releaseSingleJob, type ReleasedJob } from '../helpers/single-job'

/**
 * Coverage — the season map (Figma CG-02, I57.6) and the Brief view (CG-07, I57.7).
 *
 * A released job is promoted to a campaign, given two phases (the first holds today) and its piece
 * put in the first. The season map draws that piece as one square in its department × phase cell,
 * the current phase highlighted, and the square opens the piece drawer. The Brief counts its
 * written fields against the DATABASE, names the empty ones, and "Fill them in" — the approval
 * authority's alone — starts the edit that writes the brief back. Every expected value is read from
 * the rows, never from what an earlier run left.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}
const dayOut = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
const API = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

function tokenOf(tag: keyof typeof PEOPLE): string {
  const state = JSON.parse(readFileSync(authFile(tag), 'utf8')) as { origins: { localStorage: { name: string; value: string }[] }[] }
  for (const o of state.origins) {
    for (const item of o.localStorage) {
      if (item.name.endsWith('-auth-token')) return (JSON.parse(item.value) as { access_token: string }).access_token
    }
  }
  throw new Error(`no token for ${tag}`)
}
/** An RPC as a person — the set-up goes through the same doors the page uses. */
async function rpcAs(tag: keyof typeof PEOPLE, fn: string, args: Record<string, unknown>) {
  const res = await fetch(`${API}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${tokenOf(tag)}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  })
  return { status: res.status, body: await res.text() }
}

/** The nine strategy fields, in the brief's order (src/lib/brief/fields.ts). */
const STRATEGY = ['background', 'task', 'beautifulProblem', 'audiencePrimary', 'audienceSecondary', 'brandFunctionalBenefit', 'brandEmotionalBenefit', 'insight', 'proposition'] as const
const briefOf = async (id: string) => ((await rows<{ brief: Record<string, unknown> | null }>('campaigns', `select=brief&id=eq.${id}`))[0].brief ?? {}) as Record<string, unknown>
const isWritten = (v: unknown) => typeof v === 'string' && v.trim() !== ''

let job: ReleasedJob
let phaseNow: string
let phaseNext: string

test.describe('Coverage — the season map and the brief (CG-02, CG-07)', () => {
  test.beforeAll(async ({ browser }) => {
    const am = await as(browser, 'am')
    job = await releaseSingleJob(am, { title: `Season ${Date.now()}`, department: 'Creative', type: 'Social Advertisement' })
    await am.goto('/campaigns')
    await am.getByTestId('campaigns-scope-all').click()
    await am.getByTestId(`campaign-menu-${job.campaignId}`).click()
    await am.getByTestId(`campaign-promote-${job.campaignId}`).click()
    await am.getByTestId('campaign-promote-confirm').click()
    await expect(am).toHaveURL(new RegExp(`/campaigns/${job.campaignId}`), { timeout: 15_000 })
    await am.context().close()

    expect((await rpcAs('am', 'set_campaign_phases', { p_campaign: job.campaignId, p_enabled: true })).status).toBeLessThan(300)
    for (const [name, starts, ends] of [['Now', dayOut(0), dayOut(6)], ['Next', dayOut(7), dayOut(13)]] as const) {
      const r = await rpcAs('am', 'save_campaign_phase', { p_campaign: job.campaignId, p_phase: null, p_name: name, p_starts_on: starts, p_ends_on: ends })
      expect(r.status, r.body).toBeLessThan(300)
    }
    const phases = await rows<{ id: string; name: string }>('campaign_phases', `select=id,name&campaign_id=eq.${job.campaignId}`)
    phaseNow = phases.find((p) => p.name === 'Now')!.id
    phaseNext = phases.find((p) => p.name === 'Next')!.id
    const moved = await rpcAs('am', 'move_deliverable_to_phase', { p_deliverable: job.deliverableId, p_phase: phaseNow })
    expect(moved.status, moved.body).toBeLessThan(300)
  })

  test('season map: the piece is one square in its phase, coloured from its tasks; the current phase is marked; the square opens the drawer', async ({ browser }) => {
    // What the square must say, from the rows: a fresh piece's tasks are untouched and its date ahead.
    const [d] = await rows<{ state: string; due_at: string | null }>('deliverables', `select=state,due_at&id=eq.${job.deliverableId}`)
    const tasks = await rows<{ status: string }>('sub_tasks', `select=status&deliverable_id=eq.${job.deliverableId}&status=neq.cancelled`)
    expect(d.state).not.toBe('delivered')
    expect(d.due_at == null || Date.parse(d.due_at) > Date.now()).toBe(true)
    const expected = tasks.some((x) => x.status === 'review') ? 'is-in_review'
      : tasks.some((x) => x.status === 'in_progress') ? 'is-in_progress'
      : 'is-not_started'

    // Anyone who reads the campaign reads the map — the department lead here.
    const lead = await as(browser, 'lead')
    await lead.goto(`/campaigns/${job.campaignId}`)
    await lead.getByTestId('campaign-tab-seasonMap').click()
    await expect(lead.getByTestId('campaign-panel-season-map')).toBeVisible()
    await expect(lead.getByTestId(`season-map-phase-${phaseNow}`)).toContainText('Now')
    await expect(lead.getByTestId(`season-map-phase-${phaseNow}`)).toHaveClass(/is-current/)
    await expect(lead.getByTestId(`season-map-phase-${phaseNext}`)).not.toHaveClass(/is-current/)
    await expect(lead.getByTestId('season-map-phase-none')).toHaveCount(0)   // every piece has a phase
    const square = lead.getByTestId(`season-square-${job.deliverableId}`)
    await expect(square).toHaveClass(new RegExp(expected))
    await expect(square).toHaveAttribute('aria-label', /Social Advertisement/)
    await square.click()
    await expect(lead.getByTestId('piece-drawer')).toBeVisible()
    await lead.context().close()
  })

  test('brief: the fields filled and the empty ones match the row; the authority fills one in and it is saved', async ({ browser }) => {
    const before = await briefOf(job.campaignId)
    const empty = STRATEGY.filter((k) => !isWritten(before[k]))
    expect(empty.length).toBeGreaterThan(0)

    const am = await as(browser, 'am')
    await am.goto(`/campaigns/${job.campaignId}`)
    await am.getByTestId('campaign-tab-brief').click()
    await expect(am.getByTestId('campaign-panel-brief')).toBeVisible()
    await expect(am.getByTestId('brief-itself-filled')).toHaveText(`${STRATEGY.length - empty.length} of ${STRATEGY.length}`)
    await expect(am.getByTestId('brief-empty-callout')).toBeVisible()
    for (const k of empty) await expect(am.getByTestId(`campaign-master-brief-empty-${k}`)).toBeVisible()
    await expect(am.getByTestId(`brief-produced-legend`)).toBeVisible()

    // The square in "What it produced" opens the same drawer.
    await am.getByTestId(`season-square-${job.deliverableId}`).click()
    await expect(am.getByTestId('piece-drawer')).toBeVisible()
    await am.getByTestId('piece-drawer-close').click()
    await expect(am.getByTestId('piece-drawer')).toHaveCount(0)

    // "Fill them in" starts the edit; Save writes it to the row.
    const key = empty[0]
    await am.getByTestId('brief-empty-fill').click()
    await am.getByTestId(`campaign-master-brief-field-${key}`).fill('Written from the season map spec.')
    await am.getByTestId('campaign-master-brief-save').click()
    await expect(am.getByTestId('campaign-banner')).toContainText(/saved/i)
    await am.getByTestId('campaign-banner-close').click()
    await expect(am.getByTestId(`campaign-master-brief-${key}`)).toHaveText('Written from the season map spec.')
    await expect.poll(async () => (await briefOf(job.campaignId))[key]).toBe('Written from the season map spec.')
    await expect(am.getByTestId('brief-itself-filled')).toHaveText(`${STRATEGY.length - empty.length + 1} of ${STRATEGY.length}`)
    await am.context().close()
  })

  test('may NOT: a lead reads the brief and its gaps, and is offered no Edit, Generate or Fill', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await lead.goto(`/campaigns/${job.campaignId}`)
    await lead.getByTestId('campaign-tab-brief').click()
    await expect(lead.getByTestId('campaign-master-brief')).toBeVisible()
    // Fields are still empty in the row, so the callout is there — without its button.
    const brief = await briefOf(job.campaignId)
    expect(STRATEGY.some((k) => !isWritten(brief[k]))).toBe(true)
    await expect(lead.getByTestId('brief-empty-callout')).toBeVisible()
    await expect(lead.getByTestId('brief-itself-filled')).toBeVisible()
    await expect(lead.getByTestId('campaign-brief-edit')).toHaveCount(0)
    await expect(lead.getByTestId('campaign-generate-deliverables')).toHaveCount(0)
    await expect(lead.getByTestId('brief-empty-fill')).toHaveCount(0)
    // The API door is shut too, in words.
    const r = await rpcAs('lead', 'update_campaign_brief', { p_campaign: job.campaignId, p_brief: { proposition: 'Sneaky' } })
    expect(r.status).toBe(403)
    expect(r.body).toMatch(/outside your reach/)
    await lead.context().close()
  })
})
