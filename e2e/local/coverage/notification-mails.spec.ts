import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE } from '../fixtures'
import { rows, userIdOf } from '../helpers/db'
import { clearMailbox, expectMail, expectNoMail, readMailHtml } from '../helpers/mailpit'
import { releaseSingleJob, type ReleasedJob } from '../helpers/single-job'
import { addTaskOnPanel, approveTaskList, assignOnSchedule, closeCampaignBanner, workingDayFor } from '../helpers/piece'

/**
 * The notification emails, as decided one action at a time on 17 Sep (I52;
 * `docs/reference/notification-email-copy.md`, "Decided one action at a time"). Each step is a real
 * action by the real person, and the assertion is the mail Mailpit holds afterwards — its subject,
 * the sentence, and who it went to. Where Edward said nobody else is told, that is asserted too.
 *
 * Actions 1–7 are driven here end to end. Actions 8–15 are raised by other specs (schedule,
 * review cycle, booking requests, chat, attach); their rows are proven in pgTAP 125 and their
 * words are read from the same COPY map — the as-sent document is regenerated from a full run.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}
/** A write from the task page's own row answers with a line above it; it must be a success. */
async function manageNoteOk(page: Page) {
  const note = page.getByTestId('task-page-manage-note')
  await expect(note).toBeVisible()
  await expect(note).toHaveClass(/notice-ok/)
}
/** The piece's owner, changed on its panel (ADR-0132 d.2: the owner is one of the panel's fields), and saved. */
async function changeOwner(page: Page, ownerId: string) {
  await page.goto(`/campaigns/${job.campaignId}?piece=${job.deliverableId}`)
  await expect(page.getByTestId('piece-panel')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('piece-panel-owner').click()
  await page.getByTestId(`piece-panel-owner-option-${ownerId}`).dispatchEvent('mousedown')
  await page.getByTestId('piece-panel-save').click()
  await closeCampaignBanner(page)
  await expect
    .poll(async () => (await rows<{ owner_user_id: string | null }>('deliverables', `select=owner_user_id&id=eq.${job.deliverableId}`))[0]!.owner_user_id)
    .toBe(ownerId)
}
const tasksOf = (deliverableId: string) =>
  rows<{ id: string; title: string; status: string; assignee_id: string | null }>('sub_tasks', `select=id,title,status,assignee_id&deliverable_id=eq.${deliverableId}`)
const text = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/&#39;|&rsquo;/g, '’')
/** The mail's visible body, and the button's link. */
async function mailOf(address: string, subject: RegExp): Promise<{ body: string; link: string }> {
  const m = await expectMail(address, subject)
  const html = await readMailHtml(m.ID)
  const link = (html.match(/<a[^>]+href="([^"]+)"/) || [])[1] ?? ''
  return { body: text(html), link }
}

let job: ReleasedJob
const stamp = Date.now()

test.describe('Notification emails — what is required, to whom (I52)', () => {
  test('Action 1: the AM releases a job → its deliverable\'s owner is told to review the task list', async ({ browser }) => {
    await clearMailbox()
    const am = await as(browser, 'am')
    job = await releaseSingleJob(am, { title: `Mail job ${stamp}`, department: 'Creative', type: 'Social Advertisement' })
    await am.context().close()
    // The owner (the Creative lead) — Edward's sentence, the AM's name, the job's title.
    // I53.19 (21 Sep): one mail per owner, saying what they own and what is required; the
    // button opens the job (its page points at the deliverable).
    const { body, link } = await mailOf(PEOPLE.lead.email, new RegExp(`^Approved: Mail job ${stamp} — you own 1 deliverable$`))
    // One line per deliverable — name, phase (none on a job), due date — then what to do.
    expect(body).toContain(`${PEOPLE.am.name} approved Mail job ${stamp}. You own 1 deliverable on it:`)
    // I66.8 — "Sun, 18 Oct": weekday, day, month; the year only when it is not this year.
    expect(body).toMatch(/• Social Advertisement — due \w+, \d+ \w+( \d{4})?/)
    expect(body).toContain('You need to review the task list of each, then approve it so each task can be assigned.')
    expect(link).toContain(`/campaigns/${job.campaignId}`)
    // Nobody else: not a team lead by role, not the AM.
    await expectNoMail(PEOPLE.tl.email)
    await expectNoMail(PEOPLE.am.email)
  })

  test('Action 2: the owner is changed → the new owner is told it is theirs; the old owner who has it', async ({ browser }) => {
    await clearMailbox()
    // Since ADR-0132 d.2 the owner is a field of the piece's panel (I71.1).
    const traffic = await as(browser, 'traffic')
    await changeOwner(traffic, await userIdOf(PEOPLE.tl.email))
    await traffic.context().close()
    const fresh = await mailOf(PEOPLE.tl.email, /^Assigned to you: /)
    expect(fresh.body).toContain(`${PEOPLE.traffic.name} made you the owner of Social Advertisement on Mail job ${stamp}. Review its task list and approve it so each task can be assigned.`)
    // I57.44: no "brief" — there is none to approve since ADR-0100; the list here still waits.
    expect(fresh.body).not.toMatch(/brief/i)
    const old = await mailOf(PEOPLE.lead.email, /^No longer yours: /)
    expect(old.body).toContain(`Social Advertisement on Mail job ${stamp} is now owned by ${PEOPLE.tl.name}.`)
    await expectNoMail(PEOPLE.traffic.email)
    // Back to the lead for the rest, quietly.
    await clearMailbox()
    const back = await as(browser, 'traffic')
    await changeOwner(back, await userIdOf(PEOPLE.lead.email))
    await back.context().close()
  })

  test('Action 3: a task is assigned → the assignee is told what, when, and what to do', async ({ browser }) => {
    // Since ADR-0132 (I71.1): the owner approves the list and adds the task on the piece's panel, by its name and due
    // date; the Schedule gives it to the person, with its reviewer, review mode and hours. Only the assignment is
    // under test, so the mailbox is cleared after the approval.
    const lead = await as(browser, 'lead')
    await approveTaskList(lead, job)
    const on = await workingDayFor(PEOPLE.deputy.email, 7)
    const taskId = await addTaskOnPanel(lead, job, 'Mail task', on)
    await clearMailbox()
    await assignOnSchedule(lead, job, { taskId, assignee: PEOPLE.deputy.email, reviewer: PEOPLE.lead.email, day: on, hours: 4, reviewMode: 'manual' })
    await lead.context().close()
    const task = (await tasksOf(job.deliverableId)).find((t) => t.title === 'Mail task')!
    const { body, link } = await mailOf(PEOPLE.deputy.email, /^New task: Mail task$/)
    expect(body).toContain(`${PEOPLE.lead.name} assigned you Mail task on Mail job ${stamp}. It is due `)
    expect(body).toContain(' and estimated at 4 hours. Start it from My Work and submit it for review when it is done.')
    expect(link).toContain(`/my-work/task/${task.id}`)   // the maker's own task: its page (I59.45)
    await expectNoMail(PEOPLE.lead.email)
  })

  test('Action 4: the maker submits → the required reviewer is asked to approve or send back', async ({ browser }) => {
    await clearMailbox()
    const task = (await tasksOf(job.deliverableId)).find((t) => t.title === 'Mail task')!
    const maker = await as(browser, 'deputy')
    // Where the assignment mail pointed (I59.45): the task's own page — Start, the note and Send are there.
    await maker.goto(`/my-work/task/${task.id}`)
    await expect(maker.getByTestId('task-page')).toBeVisible()
    await maker.getByTestId(`my-work-start-${task.id}`).click()
    await maker.getByTestId(`task-comment-body-${task.id}`).fill('Done on paper.')
    await maker.getByTestId(`task-comment-submit-${task.id}`).click()
    await expect(maker.getByTestId(`task-review-gate-${task.id}`)).toContainText(/you can submit/i)
    await maker.getByTestId(`my-work-submit-${task.id}`).click()
    // ADR-0106 (I59.20): a round sent minutes after Start is untimed — the warning, then Send anyway.
    await maker.getByTestId('untimed-send').click()
    await expect.poll(async () => (await tasksOf(job.deliverableId)).find((t) => t.id === task.id)!.status).toBe('review')
    await maker.context().close()
    const { body, link } = await mailOf(PEOPLE.lead.email, /^Review needed: Mail task$/)
    expect(body).toContain(`${PEOPLE.deputy.name} submitted Mail task on Mail job ${stamp} for your review. Open it, review the work, and approve it or send it back with your changes.`)
    expect(link).toContain(`/my-work?task=${task.id}&kind=review`)   // a reviewer's turn: the review card (I59.45)
    await expectNoMail(PEOPLE.deputy.email)
  })

  test('Action 5: the reviewer sends it back → the maker is pointed at the feedback, never sent it', async ({ browser }) => {
    await clearMailbox()
    const task = (await tasksOf(job.deliverableId)).find((t) => t.title === 'Mail task')!
    const reviewer = await as(browser, 'lead')
    await reviewer.goto(`/my-work?task=${task.id}`)
    await expect(reviewer.getByTestId(`awaiting-review-item-${task.id}`)).toHaveAttribute('data-focused', 'true')
    await reviewer.getByTestId(`awaiting-review-open-${task.id}`).click()
    await reviewer.getByTestId(`task-comment-body-${task.id}`).fill('Not on paper — we need it in the deck.')
    await reviewer.getByTestId(`task-comment-submit-${task.id}`).click()
    await expect(reviewer.getByTestId(`task-review-thread-${task.id}`)).toContainText('Not on paper')
    // The task's row — its send-back with it — is on the task's page since ADR-0132 d.8 retired the deliverable
    // window (I71.1).
    await reviewer.goto(`/my-work/task/${task.id}`)
    await reviewer.getByTestId('task-page-manage').getByTestId(`subtask-request-changes-${task.id}`).click()
    await manageNoteOk(reviewer)
    await expect.poll(async () => (await tasksOf(job.deliverableId)).find((t) => t.id === task.id)!.status).toBe('todo')
    await reviewer.context().close()
    const { body, link } = await mailOf(PEOPLE.deputy.email, /^Changes requested: Mail task$/)
    expect(body).toContain(`${PEOPLE.lead.name} sent Mail task on Mail job ${stamp} back with feedback. Open it, make the changes and resubmit for review.`)
    expect(body).not.toContain('Not on paper')   // the comment is pointed to, never carried
    expect(link).toContain(`/my-work/task/${task.id}`)   // back to the maker: the task page, where the feedback is (I59.45)
  })

  test('Action 6a: the reviewer approves → the maker is told nothing more is needed', async ({ browser }) => {
    await clearMailbox()
    const task = (await tasksOf(job.deliverableId)).find((t) => t.title === 'Mail task')!
    const maker = await as(browser, 'deputy')
    await maker.goto('/my-work')
    await maker.getByTestId(`my-work-start-${task.id}`).click()
    await maker.getByTestId(`my-work-open-${task.id}`).click()
    await expect(maker.getByTestId('task-page')).toBeVisible()
    await maker.getByTestId(`task-comment-body-${task.id}`).fill('Now in the deck.')
    await maker.getByTestId(`task-comment-submit-${task.id}`).click()
    await maker.getByTestId(`my-work-submit-${task.id}`).click()
    // ADR-0106 (I59.20): a round sent minutes after Start is untimed — the warning, then Send anyway.
    await maker.getByTestId('untimed-send').click()
    await expect.poll(async () => (await tasksOf(job.deliverableId)).find((t) => t.id === task.id)!.status).toBe('review')
    await maker.context().close()
    await clearMailbox()
    const reviewer = await as(browser, 'lead')
    await reviewer.goto('/my-work')
    await reviewer.getByTestId(`awaiting-review-open-${task.id}`).click()
    await reviewer.getByTestId(`awaiting-review-approve-${task.id}`).click()
    await expect.poll(async () => (await tasksOf(job.deliverableId)).find((t) => t.id === task.id)!.status).toBe('done')
    await reviewer.context().close()
    const { body } = await mailOf(PEOPLE.deputy.email, /^Approved: Mail task$/)
    expect(body).toContain(`${PEOPLE.lead.name} approved Mail task on Mail job ${stamp}. Nothing more is needed from you on it.`)
    expect(body).not.toMatch(/\(Iraq time\)/)   // no facts line on finished work
  })

  test('Action 7: a task is cancelled → the assignee is told to stop', async ({ browser }) => {
    await clearMailbox()
    // Added on the piece's panel and given out on the Schedule (ADR-0132; I71.1), then cancelled from the task's own
    // row, which is on its page since the deliverable window was retired (d.8).
    const lead = await as(browser, 'lead')
    const on = await workingDayFor(PEOPLE.deputy.email, 8)
    const taskId = await addTaskOnPanel(lead, job, 'Mail task to cancel', on)
    // E11 (I59): assigned only with its hours.
    await assignOnSchedule(lead, job, { taskId, assignee: PEOPLE.deputy.email, reviewer: PEOPLE.lead.email, day: on, hours: 4 })
    const task = (await tasksOf(job.deliverableId)).find((t) => t.title === 'Mail task to cancel')!
    await clearMailbox()
    await lead.goto(`/my-work/task/${task.id}`)
    await lead.getByTestId('task-page-manage').getByTestId(`subtask-cancel-${task.id}`).click()
    await lead.getByTestId('subtask-cancel-confirm-confirm').click()
    await manageNoteOk(lead)
    await expect.poll(async () => (await tasksOf(job.deliverableId)).find((t) => t.id === task.id)?.status).toBe('cancelled')
    await lead.context().close()
    const { body } = await mailOf(PEOPLE.deputy.email, /^Cancelled: Mail task to cancel$/)
    expect(body).toContain(`${PEOPLE.lead.name} cancelled Mail task to cancel on Mail job ${stamp}. Stop work on it — it has been taken off your calendar and nothing more is needed from you.`)
    await expectNoMail(PEOPLE.lead.email)
  })
})
