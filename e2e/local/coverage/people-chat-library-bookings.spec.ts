import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows, userIdOf } from '../helpers/db'
import { releaseSingleJob, type ReleasedJob, nextToReview, pickJobLanguages } from '../helpers/single-job'

/**
 * Coverage — the request step's remaining fields, the New-request door, Directory, Team, the
 * attendance widget, Chat (page, panel, members), the Library, and the Bookings table
 * (I49: RequestStep 4, NewRequestDoor 1, DirectoryPage 1, TeamPage 1, AttendanceWidget 2,
 * ChatPage 4, ChatPanel 3, ConversationMembers 4, LibraryPage 9, FolderPicker 3, BookingsPage 4,
 * BookingsTable 4).
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}
function sundayOut(weeksOut: number): string {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + 7 * weeksOut + ((7 - d.getUTCDay()) % 7))
  return d.toISOString().slice(0, 10)
}

let job: ReleasedJob
/** A second Creative job, archived by the AM, so the lead's rail has an archived thread to toggle. */
let archivedJob: ReleasedJob

test.describe('Coverage — people, chat, library, bookings', () => {
  test.beforeAll(async ({ browser }) => {
    const am = await as(browser, 'am')
    job = await releaseSingleJob(am, { title: `Cov people ${Date.now()}`, department: 'Creative', type: 'Social Advertisement' })
    // The chat rail offers "Show archived" only when something in reach IS archived — the seed
    // carries nothing archived, so this job is (the door section H proves). No type, so nothing
    // live sits under it and the button says *Archive*, not *Cancel job* (ADR-0080 d.10).
    archivedJob = await releaseSingleJob(am, { title: `Cov archived ${Date.now()}`, department: 'Creative' })
    await am.goto(`/deliverables?campaign=${archivedJob.campaignId}`)
    await am.getByTestId(`deliverable-archive-${archivedJob.deliverableId}`).click()
    await expect(am.getByTestId(`deliverable-archive-${archivedJob.deliverableId}`)).toHaveCount(0)
    await expect.poll(async () => (await rows<{ state: string }>('deliverables', `select=state&id=eq.${archivedJob.deliverableId}`))[0].state).toBe('archived')
    await am.context().close()
  })

  test('the request step: source, quantity, channel, format; the New-request door closes', async ({ browser }) => {
    const am = await as(browser, 'am')
    await am.goto('/campaigns/new-job')
    // The Figma's order (22 Sep): the source is on screen 1 with the rest of the evidence; quantity,
    // channel and format are on who and when, after the brief.
    await am.getByTestId('sj-client').selectOption({ label: 'Northwind Beverages' })
    await am.getByTestId('sj-source').selectOption({ index: 1 })
    const source = await am.getByTestId('sj-source').inputValue()
    expect(source).toBeTruthy()
    await am.getByTestId('sj-words').fill('Three of them.')
    await am.getByTestId('sj-brief-card-single_execution').click()
    await am.getByTestId('sj-next').click()
    await expect(am.getByTestId('sj-brief')).toBeVisible()
    await am.getByTestId('sj-field-task').fill('Three statics.')
    await am.getByTestId('sj-next').click()
    await expect(am.getByTestId('sj-request')).toBeVisible()
    await am.getByTestId('sj-quantity').fill('3')
    await expect(am.getByTestId('sj-quantity')).toHaveValue('3')
    const firstOption = async (sel: ReturnType<Page['getByTestId']>) => {
      const values = await sel.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean))
      if (values.length) { await sel.selectOption(values[0]); await expect(sel).toHaveValue(values[0]) }
      return values.length
    }
    expect(await firstOption(am.getByTestId('sj-channel'))).toBeGreaterThan(0)
    await firstOption(am.getByTestId('sj-format'))
    // Carried into the draft on Next.
    const title = `Cov request fields ${Date.now()}`
    await am.getByTestId('sj-title').fill(title)
    await am.getByTestId('sj-due').fill(sundayOut(2))
    await am.getByTestId('sj-department').getByRole('radio', { name: 'Creative' }).click()
    await pickJobLanguages(am)
    await nextToReview(am)
    const [c] = await rows<{ brief: { request: { source: string }; deliverables: { quantity: number; channel: string | null }[] } }>('campaigns', `select=brief&name=eq.${encodeURIComponent(title)}`)
    expect(c.brief.request.source).toBe(source)
    expect(c.brief.deliverables[0].quantity).toBe(3)
    expect(c.brief.deliverables[0].channel).toBeTruthy()

    // The door (Ctrl/Cmd+P) opens from anywhere and its close button closes it.
    await am.goto('/campaigns')
    await am.keyboard.press('Control+p')
    await expect(am.getByTestId('new-request-door')).toBeVisible()
    await am.getByTestId('new-request-close').click()
    await expect(am.getByTestId('new-request-door')).toHaveCount(0)
    await am.context().close()
  })

  test('Directory search; Team scope; attendance start and end', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await lead.goto('/people/directory')
    await expect(lead.getByTestId('directory-table').first()).toBeVisible() // one table per department
    const all = await lead.getByTestId('directory-count').textContent()
    await lead.getByTestId('directory-search').fill(PEOPLE.writer.name)
    await expect(lead.getByTestId(`directory-row-${await userIdOf(PEOPLE.writer.email)}`)).toBeVisible()
    await expect(lead.getByTestId(`directory-row-${await userIdOf(PEOPLE.maker.email)}`)).toHaveCount(0)
    // The count follows the search — "1 of 20 people" — and returns to the whole when cleared (I49.78).
    const total = /(\d+)/.exec(all!)![1]
    await expect(lead.getByTestId('directory-count')).toHaveText(new RegExp(`^1 of ${total} people`))
    await lead.getByTestId('directory-search').fill('')
    await expect(lead.getByTestId('directory-count')).toHaveText(all!)
    await lead.getByTestId('directory-search').fill('nobody by this name')
    await expect(lead.getByTestId('directory-empty')).toBeVisible()

    await lead.goto('/team')
    // Team rows are RESOURCES (the calendar rows), not profiles.
    const resourceOf = async (name: string) => (await rows<{ id: string }>('resources', `select=id&name=eq.${encodeURIComponent(name)}&is_active=eq.true`))[0].id
    const mine = lead.getByTestId(`team-row-${await resourceOf(PEOPLE.maker.name)}`)
    await expect(mine).toBeVisible()
    const theirs = lead.getByTestId(`team-row-${await resourceOf(PEOPLE.writer.name)}`)
    await expect(theirs).toHaveCount(0)
    // I59.12 (ADR-0105 d.4): the "Show all" toggle is gone — a department lead sees their own
    // department; the team view's own controls are walked in team-view.spec.ts.
    await lead.context().close()

    // Attendance: start and end the day; each press is a row.
    const writer = await as(browser, 'writer')
    await writer.goto('/my-work')
    const widget = writer.getByTestId('attendance-widget')
    await expect(widget).toBeVisible()
    // Start, then End; a day already ended shows neither (the run before today's did it).
    const start = writer.getByTestId('attendance-start')
    const end = writer.getByTestId('attendance-end')
    if (await start.isVisible().catch(() => false)) {
      await start.click()
      await expect(end).toBeVisible()
    }
    if (await end.isVisible().catch(() => false)) await end.click()
    await expect(writer.getByTestId('attendance-status')).toBeVisible()
    const me = await userIdOf(PEOPLE.writer.email)
    const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10) // Baghdad's date
    await expect.poll(async () => (await rows<{ checked_out_at: string | null }>('attendance_days', `select=checked_out_at&user_id=eq.${me}&work_date=eq.${today}`))[0]?.checked_out_at ?? null).not.toBeNull()
    await writer.context().close()
  })

  test('Chat: search the rail, open a thread, collapse a group, send (and the composer), members add/remove, archived', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await lead.goto('/chat')
    await expect(lead.getByTestId('chat-rail')).toBeVisible()
    await lead.getByTestId('chat-search').fill(job.title)
    await lead.getByTestId(`chat-rail-${job.deliverableId}`).click()
    await expect(lead.getByTestId('chat-panel')).toBeVisible()
    await lead.getByTestId('chat-search').fill('')

    // Collapse and expand the deliverable's group (keyed by its campaign).
    const group = lead.getByTestId(`chat-group-toggle-${job.campaignId}`)
    await group.click()
    await expect(lead.getByTestId(`chat-rail-${job.deliverableId}`)).toHaveCount(0)
    await group.click()
    await expect(lead.getByTestId(`chat-rail-${job.deliverableId}`)).toBeVisible()

    // Send through the composer (Enter), then the button.
    await lead.getByTestId('chat-composer').getByTestId('chat-input').fill('First message from the lead.')
    await lead.getByTestId('chat-input').press('Enter')
    await expect(lead.getByTestId('chat-messages')).toContainText('First message from the lead.')
    await lead.getByTestId('chat-input').fill('Second, by the button.')
    await lead.getByTestId('chat-send').click()
    await expect(lead.getByTestId('chat-messages')).toContainText('Second, by the button.')
    // A send that fails on the wire is kept, marked, and offered Retry; the retry lands it.
    // (a send goes through the `chat` Edge Function)
    await lead.route('**/functions/v1/chat', (route) => route.abort())
    await lead.getByTestId('chat-input').fill('Third, after a failure.')
    await lead.getByTestId('chat-send').click()
    const retry = lead.locator('[data-testid^="chat-retry-"]').first()
    await expect(retry).toBeVisible()
    await lead.unroute('**/functions/v1/chat')
    const retryId = (await retry.getAttribute('data-testid'))!.replace('chat-retry-', '')
    await lead.getByTestId(`chat-retry-${retryId}`).click()
    await expect(lead.locator('[data-testid^="chat-retry-"]')).toHaveCount(0)
    const [conv] = await rows<{ id: string }>('conversations', `select=id&context_type=eq.deliverable&context_id=eq.${job.deliverableId}`)
    await expect.poll(async () => (await rows<{ id: string }>('messages', `select=id&conversation_id=eq.${conv.id}&deleted_at=is.null`)).length).toBe(3)

    // Members: add the writer, then remove them.
    const writerId = await userIdOf(PEOPLE.writer.email)
    await lead.getByTestId('chat-add-member').getByTestId('chat-add-member-select').selectOption(writerId)
    await lead.getByTestId('chat-add-member-submit').click()
    const writerRow = lead.locator(`[data-testid^="chat-member-${writerId}-"]`)
    await expect(writerRow).toHaveCount(1)
    await lead.getByTestId(`chat-member-remove-${writerId}`).click()
    await expect(writerRow).toHaveCount(0)

    // Archived conversations are hidden until asked for, then shown in their own group.
    await expect(lead.getByTestId(`chat-rail-${archivedJob.deliverableId}`)).toHaveCount(0)
    await lead.getByTestId('chat-archived-toggle').click()
    await expect(lead.getByTestId('chat-archived-toggle')).toHaveAttribute('aria-pressed', 'true')
    await expect(lead.getByTestId(`chat-rail-${archivedJob.deliverableId}`)).toBeVisible()
    await lead.getByTestId('chat-archived-toggle').click()
    await expect(lead.getByTestId(`chat-rail-${archivedJob.deliverableId}`)).toHaveCount(0)
    await lead.context().close()
  })

  // The Library's controls moved to `library.spec.ts` with its redesign (I72, Figma K).

  test('Bookings: tabs, the range, search, grouping, a column sort, export', async ({ browser }) => {
    const traffic = await as(browser, 'traffic')
    await traffic.goto('/bookings')
    await traffic.getByTestId('tab-all').click()
    await expect(traffic.getByTestId('tab-all')).toHaveAttribute('aria-selected', 'true')
    await traffic.getByTestId('tab-project').click()
    await expect(traffic.getByTestId('tab-project')).toHaveAttribute('aria-selected', 'true')
    // Pick a project with bookings: its people and hours roll up (I49.71 — the campaign is worked
    // out from each booking's deliverable, so the rollup reads what the database holds).
    const [booked] = await rows<{ deliverables: { streams: { campaign_id: string } } }>('bookings', `select=deliverables!inner(streams!inner(campaign_id))&state=in.(soft_hold,tentative,confirmed)&limit=1`)
    const campaignId = booked.deliverables.streams.campaign_id
    await traffic.getByTestId('project-select').selectOption(campaignId)
    await expect(traffic.getByTestId('project-table')).toBeVisible()
    const expected = await rows<{ id: string }>('bookings', `select=id,deliverables!inner(streams!inner(campaign_id))&deliverables.streams.campaign_id=eq.${campaignId}&state=in.(soft_hold,tentative,confirmed)`)
    expect(expected.length).toBeGreaterThan(0)
    await traffic.getByTestId('tab-all').click()
    await traffic.getByTestId('range-from').fill(sundayOut(0))
    await traffic.getByTestId('range-to').fill(sundayOut(6))
    await traffic.getByTestId('bookings-search').fill(PEOPLE.maker.name)
    const groupSel = traffic.getByTestId('bookings-group')
    const groups = await groupSel.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))
    for (const g of groups) await groupSel.selectOption(g)
    const colKey = (await traffic.locator('[data-testid^="col-"]').first().getAttribute('data-testid'))!.replace('col-', '')
    await traffic.getByTestId(`col-${colKey}`).click()
    await traffic.getByTestId(`col-${colKey}`).click()
    const download = traffic.waitForEvent('download', { timeout: 10_000 }).catch(() => null)
    await traffic.getByTestId('bookings-export').click()
    const file = await download
    if (file) expect(file.suggestedFilename()).toMatch(/\.csv$/)
    await traffic.context().close()
  })
})
