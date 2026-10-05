import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows, slaEvents, waitForNotification } from '../helpers/db'
import { mockProposal, ownTheWork, pieceIds, reviewAndApprove, setDue, startCampaign, timingRowIds, writeBrief, chooseLanguages } from '../helpers/campaign-wizard'

/**
 * docs/RETEST-REDESIGN.md — G: the full campaign (the wizard, end to end), as it is since CB-v3
 * (I56.18–I56.23, 24 Sep): the brief on step 2, the proposal on The work, timing given through
 * each row's Edit, and approval then the OWNERS' task lists (ADR-0100 d.2) — the department brief
 * is retired (ADR-0100 d.6).
 *
 * One model call is mocked at the network edge: `generate-deliverables`. Everything else — the
 * draft, the dates, the warning, the submit, the approval, the notifications — is the real app on
 * the real database.
 */
const PIECES = [
  { name: 'Key visual', typeCode: 'ADV-006', channel: 'OOH' },
  { name: 'Launch copy', typeCode: 'ADV-003', channel: 'Instagram' },
]

/** A Sunday at least three weeks out (a working day in Baghdad; Sun−2 working days = Wednesday). */
function sundayThreeWeeksOut(): string {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + 21 + ((7 - d.getUTCDay()) % 7))
  return d.toISOString().slice(0, 10)
}
/** The wizard's own words for "N dates filled from the go-live" (I57.17): read from the English
 *  locale, so the step follows the copy instead of breaking each time it is reworded. */
const here = path.dirname(fileURLToPath(import.meta.url))
const EN = JSON.parse(readFileSync(path.join(here, '../../../src/locales/en.json'), 'utf8')) as {
  campaigns: { wizard: { datesFilled_other: string } }
}
const datesFilled = (count: number) => EN.campaigns.wizard.datesFilled_other.replace('{{count}}', String(count))

const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

/**
 * Steps 1–3 with no phases and no workstreams: two pieces, owned by the Creative team lead and the
 * Content lead. Leaves the wizard on step 4 (timing).
 */
async function toTiming(page: Page, name: string) {
  await mockProposal(page, PIECES)
  await startCampaign(page, { name, workstreams: false })
  await writeBrief(page)
  await ownTheWork(page, [PEOPLE.tl.name, PEOPLE.content.name])
}

async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}

test.describe('Section G — full campaign', () => {
  test.use({ storageState: authFile('am') })

  test('G1 — brief → the work (an owner each, never "Nobody") → timing → approve; every owner is told', async ({ page }) => {
    const name = `G1 launch ${Date.now()}`
    await mockProposal(page, PIECES)
    await startCampaign(page, { name, workstreams: false })
    // The account manager pre-fills from the client (Northwind → Dev Account Mgr).
    await writeBrief(page)
    // The owner picker offers leads, never "Nobody" and never a team member.
    const [first] = await pieceIds(page)
    await page.getByTestId(`wizard-work-edit-${first}`).click()
    const owners = await page.getByTestId('wizard-piece-owner').locator('option').allTextContents()
    expect(owners.join('|')).not.toMatch(/Nobody/)
    expect(owners).not.toContain(PEOPLE.maker.name)
    await page.getByTestId('wizard-piece-cancel').click()
    await ownTheWork(page, [PEOPLE.tl.name, PEOPLE.content.name])

    await page.getByTestId('wizard-golive').fill(sundayThreeWeeksOut())
    const id = await reviewAndApprove(page)
    await expect(page.getByTestId('campaign-tabs')).toBeVisible()

    const [c] = await rows<{ status: string; go_live_at: string | null }>('campaigns', `select=status,go_live_at&id=eq.${id}`)
    expect(c.status).toBe('approved')
    expect(c.go_live_at).toBeTruthy()
    const dels = await rows<{ owner_user_id: string | null; due_at: string | null }>('deliverables', `select=owner_user_id,due_at,streams!inner(campaign_id)&streams.campaign_id=eq.${id}`)
    expect(dels).toHaveLength(2)
    expect(dels.every((d) => d.owner_user_id && d.due_at)).toBe(true)
    // Every owner was told the work is theirs (the second gate starts here, ADR-0100 d.2).
    await waitForNotification(PEOPLE.tl.email, 'campaign_approved')
    await waitForNotification(PEOPLE.content.email, 'campaign_approved')
  })

  test('G1a — the go-live offsets count WORKING days: a Sunday go-live is due the Wednesday before', async ({ page }) => {
    const name = `G1a offsets ${Date.now()}`
    await toTiming(page, name)
    // Standing advice is an (i) tip (Edward, 24 Sep), and it states the offsets before anything is typed.
    await page.getByTestId('wizard-timing-golive-tip-button').click()
    await expect(page.getByTestId('wizard-timing-golive-tip-body')).toContainText(/delivery 2 working days before it/)
    await expect(page.getByTestId('wizard-timing-golive-tip-body')).toContainText(/4 working days before that/)
    const sunday = sundayThreeWeeksOut()
    await page.getByTestId('wizard-golive').fill(sunday)
    await expect(page.getByTestId('wizard-golive-note')).toContainText(datesFilled(2))
    const id = await reviewAndApprove(page)
    const dels = await rows<{ due_at: string }>('deliverables', `select=due_at,streams!inner(campaign_id)&streams.campaign_id=eq.${id}`)
    // Sun → Thu (1) → Wed (2): never the Friday.
    for (const d of dels) expect(d.due_at.slice(0, 10)).toBe(shift(sunday, -4))
  })

  test('G1b — a due date inside the window WARNS and is allowed; so is one after go-live (ADR-0093); the override is recorded', async ({ page }) => {
    await toTiming(page, `G1b tight ${Date.now()}`)
    const sunday = sundayThreeWeeksOut()
    await page.getByTestId('wizard-golive').fill(sunday)
    const [rowId] = await timingRowIds(page)
    await expect(page.getByTestId(`wizard-timing-row-${rowId}`)).toContainText('Key visual')
    const warning = page.getByTestId(`wizard-timing-due-warning-${rowId}`)

    // One working day left (Thursday): tight, allowed, with the arithmetic stated.
    await setDue(page, shift(sunday, -3), rowId)
    await expect(warning).toHaveAttribute('data-severity', 'tight')
    await expect(warning).toContainText(/Tight\./)
    await expect(warning).toContainText(/1 working day\(s\) left before go-live; the rule asks for 2/)

    // The go-live day itself: impossible, still allowed.
    await setDue(page, sunday, rowId)
    await expect(warning).toHaveAttribute('data-severity', 'impossible')

    // After go-live (ADR-0093): a warning naming the client's agreement — allowed, like the others.
    await setDue(page, shift(sunday, 1), rowId)
    await expect(warning).toHaveAttribute('data-severity', 'after_go_live')
    await expect(warning).toContainText(/client's agreement/)
    await expect(page.getByTestId('wizard-error')).toHaveCount(0)

    // Submit as it stands: the override lands in sla_events against that piece, saying what the
    // person was shown.
    const id = await reviewAndApprove(page)
    const dels = await rows<{ id: string; name: string }>('deliverables', `select=id,name,streams!inner(campaign_id)&streams.campaign_id=eq.${id}`)
    const keyVisual = dels.find((d) => d.name === 'Key visual')!
    const events = await slaEvents(keyVisual.id, 'due_date_override')
    expect(events).toHaveLength(1)
    expect(events[0].payload).toMatchObject({ severity: 'after_go_live', required_days: 2 })
    expect(events[0].actor_user_id).toBeTruthy()
  })

  test('G2 — a draft resumes where it was left, not at step 1', async ({ page }) => {
    const name = `G2 draft ${Date.now()}`
    await mockProposal(page, PIECES)
    await startCampaign(page, { name })
    await page.getByTestId('wizard-brief-proposition').fill('Resumed proposition.')
    await chooseLanguages(page, 'wizard-languages-picker', ['en'])
    await page.getByTestId('wizard-brief-insight').fill('Resumed insight.')
    await page.getByTestId('wizard-next').click() // saves step 2 into the draft
    await expect(page.getByTestId('wizard-step-3')).toBeVisible()

    const [draft] = await rows<{ id: string; status: string }>('campaigns', `select=id,status&name=eq.${encodeURIComponent(name)}`)
    expect(draft.status).toBe('draft')

    // From the Drafts list, Resume opens the wizard with what was typed on step 2 still there.
    await page.goto('/campaigns')
    await page.getByTestId(`campaign-draft-resume-${draft.id}`).click()
    await expect(page).toHaveURL(new RegExp(`/campaigns/new\\?draft=${draft.id}`))
    await expect(page.getByTestId('wizard-name')).toHaveValue(name)
    await page.goto(`/campaigns/new?draft=${draft.id}&step=2`)
    await expect(page.getByTestId('wizard-step-2')).toBeVisible()
    await expect(page.getByTestId('wizard-brief-proposition')).toHaveValue('Resumed proposition.')
    await expect(page.getByTestId('wizard-brief-insight')).toHaveValue('Resumed insight.')
  })

  // CG-01 (I57.4, 24 Sep): the page opens on the Grid — every department's pieces, grouped — and the
  // brief is one tab away. The department tabs are gone.
  test('G3 — the campaign page opens on the grid, every piece on it; the brief is on Brief', async ({ page }) => {
    const [c] = await rows<{ id: string }>('campaigns', `select=id&name=eq.${encodeURIComponent('Northwind Summer Launch')}`)
    await page.goto(`/campaigns/${c.id}`)
    await expect(page.getByTestId('campaign-tabs')).toBeVisible()
    await expect(page.getByTestId('campaign-tab-grid')).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('[data-testid^="campaign-grid-status-"]')).toHaveCount(4)
    await expect(page.getByTestId('campaign-grid-table')).toContainText('Key visual - summer range')
    await expect(page.getByTestId('campaign-grid-table')).toContainText('Launch copy and captions')
    const [creative] = await rows<{ id: string }>('departments', `select=id&name=eq.Creative`)
    await expect(page.getByTestId(`campaign-tab-${creative.id}`)).toHaveCount(0)
    await page.getByTestId('campaign-tab-brief').click()
    await expect(page.getByTestId('campaign-master-brief')).toContainText('Cold before you get there.')
  })

  // ADR-0100 d.2 (23 Sep) and Edward, 24 Sep: once the campaign is approved, each piece's owner is
  // told, and must approve its task list before any of it can be assigned — on the department's
  // tab, all or selected. The department brief this test used to walk is retired.
  test('G4 — each owner approves their own task lists; nobody else can', async ({ browser, page }) => {
    const name = `G4 lists ${Date.now()}`
    await toTiming(page, name)
    await page.getByTestId('wizard-golive').fill(sundayThreeWeeksOut())
    const id = await reviewAndApprove(page)
    const [piece] = await rows<{ id: string }>('deliverables', `select=id,streams!inner(campaign_id)&streams.campaign_id=eq.${id}&name=eq.Launch%20copy`)

    // A team member reads the list and is told whose it is — no tick, no button.
    const maker = await as(browser, 'maker')
    await maker.goto(`/campaigns/${id}`)
    await expect(maker.getByTestId(`campaign-task-lists-not-yours-${piece.id}`)).toContainText(PEOPLE.content.name)
    await expect(maker.getByTestId(`campaign-task-lists-pick-${piece.id}`)).toHaveCount(0)
    await maker.context().close()

    // The owner opens the list, reads it, and approves it.
    const lead = await as(browser, 'content')
    await lead.goto(`/campaigns/${id}`)
    // On the Grid the waiting list is counted on "Needs approval" and the piece reads Pending.
    await expect(lead.getByTestId(`campaign-grid-approved-${piece.id}`)).toContainText('Pending')
    // The owner reads — and may edit — the list in the panel's task list (ADR-0140), not the read-only list.
    await lead.getByTestId(`campaign-task-lists-toggle-${piece.id}`).click()
    // A task is named "<Step> — <Campaign>" now, not by the deliverable (I74.39): the editor shows this piece's own tasks.
    const listed = await rows<{ title: string }>('sub_tasks', `select=title&deliverable_id=eq.${piece.id}&status=neq.cancelled`)
    expect(listed.length, 'the approved campaign gave the piece its tasks').toBeGreaterThan(0)
    for (const t of listed) {
      expect(t.title).toContain(` — ${name}`)
      await expect(lead.getByTestId(`campaign-task-lists-editor-${piece.id}`)).toContainText(t.title)
    }
    // ADR-0140 (I74.12): the owner's editor is the piece panel's own task list — add your own is offered on it.
    await expect(lead.getByTestId(`campaign-task-lists-editor-${piece.id}`).getByTestId(`campaign-task-lists-tasks-${piece.id}-add`)).toBeVisible()
    await lead.getByTestId(`campaign-task-lists-pick-${piece.id}`).check()
    await lead.getByTestId('campaign-task-lists-approve-picked').click()
    await expect(lead.getByTestId(`campaign-task-lists-accepted-${piece.id}`)).toBeVisible()
    await expect(lead.getByTestId(`campaign-grid-approved-${piece.id}`)).toContainText('Yes')
    const [row] = await rows<{ tasks_approved_at: string | null }>('deliverables', `select=tasks_approved_at&id=eq.${piece.id}`)
    expect(row.tasks_approved_at).toBeTruthy()
    await lead.context().close()
  })

  test('G5 — nothing asks a department to write a brief any more, for anybody (ADR-0100 d.6)', async ({ browser }) => {
    const [c] = await rows<{ id: string }>('campaigns', `select=id&name=eq.${encodeURIComponent('Northwind Summer Launch')}`)
    for (const tag of ['maker', 'admin'] as const) {
      const p = await as(browser, tag)
      await p.goto(`/campaigns/${c.id}`)
      await p.getByTestId('campaign-tab-brief').click()
      await expect(p.getByTestId('campaign-master-brief')).toBeVisible()
      await expect(p.locator('[data-testid^="campaign-department-nobrief-"]'), tag).toHaveCount(0)
      await expect(p.getByTestId('campaign-write-briefs'), tag).toHaveCount(0)
      await p.context().close()
    }
  })
})
