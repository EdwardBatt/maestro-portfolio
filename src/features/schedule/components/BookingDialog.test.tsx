import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../../lib/i18n'
import type { ScheduleResource } from '../api/schedule-api'

/**
 * Project mode on the booking dialog (ADR-0060).
 *
 * **This is the suite that would have caught the defect.** ADR-0029 is titled *booking-based
 * assignment*, and `bookings.sub_task_id` is commented *"the sub-task this booking assigns"* — but
 * Project mode wrote the booking and never touched `sub_tasks.assignee_id`. Booking a campaign task
 * onto somebody gave them a calendar block, left the task unassigned everywhere it is displayed,
 * and notified nobody. Nothing failed; there was simply no assertion that submitting Project mode
 * assigns anything.
 *
 * So the assertions here are about WHICH CALL IS MADE, not about the form rendering. Every one of
 * them would have passed on the old code except the two that matter, and those are 1 and 2.
 *
 * Every import that reaches `lib/supabase` is mocked: it parses the VITE_ vars with Zod and THROWS
 * when they are absent, which they are in CI — traps.md.
 */

const state = vi.hoisted(() => ({
  updateTask: vi.fn(),
  upsertSubTask: vi.fn(),
  createBooking: vi.fn(),
  createAdhoc: vi.fn(async (_a: Record<string, unknown>) => ({ subTaskId: 'st-adhoc' })),
  addTaskResources: vi.fn(),
  campaigns: [{ id: 'c1', name: 'Ramadan 2027', kind: 'campaign' }] as { id: string; name: string; kind: 'campaign' | 'single_job' }[],
  deliverables: [{ id: 'd1', name: 'Billboard, Karrada' }] as { id: string; name: string }[],
  subTasks: [{ id: 's1', title: 'Installation' }],
  subTasksLoading: false,
  updateTaskPending: false,
  route: 'direct' as 'direct' | 'request' | 'unplaced',
  writeReach: true,
  listGate: { approved: true, ownerName: 'Fadia Wael Amin' } as { approved: boolean; ownerName: string | null },
}))

vi.mock('../api/schedule-api', () => ({
  useCampaigns: () => ({ data: state.campaigns, isLoading: false }),
  useProjectTasks: () => ({ data: state.deliverables, isLoading: false }),
  useAssignableSubTasks: () => ({ data: state.subTasks, isLoading: state.subTasksLoading }),
  useCreateBooking: () => ({ mutateAsync: state.createBooking, isPending: false }),
  useUpdateTaskAssignment: () => ({ mutateAsync: state.updateTask, isPending: state.updateTaskPending }),
  readTaskListGate: async () => state.listGate,
}))

vi.mock('../../deliverables/api/deliverables-api', () => ({
  useAssignableUsers: () => ({ data: [{ id: 'u-sam', name: 'Sam', departmentId: 'dept-prod', teamId: 'team-a' }] }),
  useReviewers: () => ({ data: [{ id: 'u-omar', name: 'Omar' }], isLoading: false }),
  useUpsertSubTask: () => ({ mutateAsync: state.upsertSubTask, isPending: false }),
  useRescheduleTask: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateAdhocDeliverable: () => ({ mutateAsync: state.createAdhoc, isPending: false }),
}))

vi.mock('../../deliverables/api/task-resources-api', () => ({
  addTaskResources: state.addTaskResources,
}))

vi.mock('../../deliverables/TaskResources', () => ({
  StagedTaskResources: () => <div data-testid="staged-resources" />,
}))

vi.mock('../../../app/permissions', () => ({
  usePermissions: () => ({ can: () => true, departmentId: 'dept-creative', teamId: null }),
}))

vi.mock('../../../app/auth-context', () => ({
  useAuth: () => ({ claims: { tenantId: 't1' }, session: { user: { id: 'me' } } }),
}))

// ADR-0087: the route mirror. 'direct' here; the request wording has its own suite below.
vi.mock('../hooks/use-write-scope.ts', () => ({
  useWriteScope: () => ({
    can: () => true, ready: true, scope: 'tenant',
    inScope: () => true, canWriteResource: () => true,
    refusalFor: () => ({ key: 'schedule.notAuthorised', params: {} }),
    routeFor: () => state.route, canRequestResource: () => state.route === 'request',
    inWriteReach: () => state.writeReach,
  }),
}))

import { BookingDialog } from './BookingDialog'

const person: ScheduleResource = {
  id: 'r-sam', name: 'Sam', nickname: null, kind: 'human',
  departmentId: 'dept-prod', departmentName: 'Production', teamId: 'team-a', teamName: 'A',
  officeId: 'o1', userId: 'u-sam', capacityModel: 'load_based', requiresApproval: false,
  warnAtPct: 100, ceilingPct: 200, poolSize: null,
  office: { name: 'Baghdad', timezone: 'UTC', workingDays: [0, 1, 2, 3, 4] },
}
const camera: ScheduleResource = { ...person, id: 'r-cam', name: 'RED Komodo', kind: 'equipment', userId: null }

function open(resource: ScheduleResource = person) {
  return render(
    <BookingDialog
      draft={{ resourceId: resource.id, isoDate: '2027-03-01' }}
      resources={[resource]}
      bookings={[]}
      blackouts={[]}
      onClose={() => {}}
    />,
  )
}

/** Fill the Project form the way a person would, top to bottom. */
function fillProject({ task = 's1', newName = '' }: { task?: string; newName?: string } = {}) {
  fireEvent.change(screen.getByTestId('booking-project'), { target: { value: 'c1' } })
  fireEvent.change(screen.getByTestId('booking-deliverable-select'), { target: { value: 'd1' } })
  fireEvent.change(screen.getByTestId('booking-subtask-select'), { target: { value: task } })
  if (newName) fireEvent.change(screen.getByTestId('booking-new-task'), { target: { value: newName } })
  fireEvent.change(screen.getByTestId('booking-project-reviewer-add'), { target: { value: 'u-omar' } })
}

beforeEach(() => {
  state.updateTask.mockReset().mockResolvedValue({ reschedule_needed: true })
  state.upsertSubTask.mockReset().mockResolvedValue({ id: 's-new' })
  state.createBooking.mockReset().mockResolvedValue({ needsApproval: false })
  state.createAdhoc.mockReset().mockResolvedValue({ subTaskId: 'st-adhoc' })
  state.campaigns = [{ id: 'c1', name: 'Ramadan 2027', kind: 'campaign' }]
  state.deliverables = [{ id: 'd1', name: 'Billboard, Karrada' }]
  state.addTaskResources.mockReset().mockResolvedValue(null)
  state.subTasks = [{ id: 's1', title: 'Installation' }]
  state.subTasksLoading = false
  state.updateTaskPending = false
})

describe('Project mode ASSIGNS (ADR-0060 d.1)', () => {
  // 1. THE assertion. The old code called createBooking and nothing else.
  it('assigns the task to the person, with reviewers and review mode', async () => {
    open()
    fillProject()
    fireEvent.submit(screen.getByTestId('booking-dialog'))
    await vi.waitFor(() => expect(state.updateTask).toHaveBeenCalled())
    expect(state.updateTask.mock.calls[0]![0]).toMatchObject({
      subTaskId: 's1',
      assigneeId: 'u-sam',
      reviewers: [expect.objectContaining({ userId: 'u-omar' })],
      reviewMode: 'digital',
    })
  })

  /**
   * I41.2. Booking Thursday for "2 days x 8h" recorded the task as due FRIDAY, because the due date
   * was read off the end date that was typed. The spreader then found one working day in
   * Thursday-Friday and put all 16 hours on Thursday. The due date has to be the last day the work
   * was actually PLACED on.
   */
  it('carries the due date to the next working day when the span crosses a day off', async () => {
    // ISO weekdays: Baghdad works Sun-Thu, so Friday and Saturday are off.
    open({ ...person, office: { name: 'Baghdad', timezone: 'UTC', workingDays: [7, 1, 2, 3, 4] } })
    fillProject()
    fireEvent.change(screen.getByTestId('booking-hours'), { target: { value: '8' } })
    fireEvent.change(screen.getByTestId('booking-date'), { target: { value: '2026-09-03' } })   // Thu
    fireEvent.change(screen.getByTestId('booking-end-date'), { target: { value: '2026-09-04' } }) // Fri
    // and it says so before the button, not only on the grid afterwards
    // I66.8: the day in words; the year only in another year, so the check names this one.
    expect(screen.getByTestId('booking-ends-on')).toHaveTextContent(new Date().getFullYear() === 2026 ? 'Sun, 6 Sep' : 'Sun, 6 Sep 2026')

    fireEvent.submit(screen.getByTestId('booking-dialog'))
    await vi.waitFor(() => expect(state.updateTask).toHaveBeenCalled())
    const sent = state.updateTask.mock.calls[0]![0]
    expect(sent.startsAt.slice(0, 10)).toBe('2026-09-03')
    expect(sent.dueAt.slice(0, 10)).toBe('2026-09-06') // Sunday, not the typed Friday
    expect(sent.hours).toBe(16) // both days' work is still there
  })

  it('leaves the due date alone when the span holds no day off', async () => {
    open({ ...person, office: { name: 'Baghdad', timezone: 'UTC', workingDays: [7, 1, 2, 3, 4] } })
    fillProject()
    fireEvent.change(screen.getByTestId('booking-hours'), { target: { value: '8' } })
    fireEvent.change(screen.getByTestId('booking-date'), { target: { value: '2026-09-07' } })   // Mon
    fireEvent.change(screen.getByTestId('booking-end-date'), { target: { value: '2026-09-08' } }) // Tue
    expect(screen.queryByTestId('booking-ends-on')).toBeNull()

    fireEvent.submit(screen.getByTestId('booking-dialog'))
    await vi.waitFor(() => expect(state.updateTask).toHaveBeenCalled())
    expect(state.updateTask.mock.calls[0]![0].dueAt.slice(0, 10)).toBe('2026-09-08')
  })

  // 2. The other half of the same fact: it must not go back to booking-transition.
  it('does not create a bare booking', async () => {
    open()
    fillProject()
    fireEvent.submit(screen.getByTestId('booking-dialog'))
    await vi.waitFor(() => expect(state.updateTask).toHaveBeenCalled())
    expect(state.createBooking).not.toHaveBeenCalled()
  })

  it('sends the mode the person chose', async () => {
    open()
    fillProject()
    fireEvent.change(screen.getByTestId('booking-review-mode'), { target: { value: 'manual' } })
    fireEvent.submit(screen.getByTestId('booking-dialog'))
    await vi.waitFor(() => expect(state.updateTask).toHaveBeenCalled())
    expect(state.updateTask.mock.calls[0]![0]).toMatchObject({ reviewMode: 'manual' })
  })

  // ADR-0043 d.4 refuses an assigned task with no reviewer at commit. Collecting no reviewer is
  // precisely what made this branch booking-only, so the form has to ask before the database does.
  it('refuses to submit without a reviewer, and assigns nothing', () => {
    open()
    fireEvent.change(screen.getByTestId('booking-project'), { target: { value: 'c1' } })
    fireEvent.change(screen.getByTestId('booking-deliverable-select'), { target: { value: 'd1' } })
    fireEvent.change(screen.getByTestId('booking-subtask-select'), { target: { value: 's1' } })
    fireEvent.submit(screen.getByTestId('booking-dialog'))
    expect(state.updateTask).not.toHaveBeenCalled()
    expect(state.createBooking).not.toHaveBeenCalled()
  })

  it('refuses to submit without a deliverable', () => {
    open()
    fireEvent.change(screen.getByTestId('booking-project'), { target: { value: 'c1' } })
    fireEvent.submit(screen.getByTestId('booking-dialog'))
    expect(state.updateTask).not.toHaveBeenCalled()
  })
})

describe('a new task is a SUB-TASK of the selected deliverable (ADR-0060 d.8)', () => {
  // It used to create a new DELIVERABLE in an invented `General` stream, which surfaced on the
  // campaign page as its own section rather than under the deliverable the person was looking at.
  // ADR-0087 d.12: created UNASSIGNED, then given out through `update_task_assignment` — the one
  // path on which an out-of-reach assignee becomes a request instead of a refusal. Creating it
  // assigned put the assignment through ADR-0040's trigger, which knows nothing of requests.
  it('creates it under that deliverable unassigned, then assigns it through the one path, with its reviewers', async () => {
    open()
    fillProject({ task: '', newName: 'Second install' })
    fireEvent.submit(screen.getByTestId('booking-dialog'))
    await vi.waitFor(() => expect(state.updateTask).toHaveBeenCalled())
    expect(state.upsertSubTask.mock.calls[0]![0]).toMatchObject({
      deliverableId: 'd1',
      title: 'Second install',
      assigneeId: null,
      materialise: false,
      reviewers: [expect.objectContaining({ userId: 'u-omar' })],
    })
    expect(state.updateTask.mock.calls[0]![0]).toMatchObject({
      subTaskId: 's-new',
      title: 'Second install',
      assigneeId: 'u-sam',
      reviewers: [expect.objectContaining({ userId: 'u-omar' })],
    })
    expect(state.createBooking).not.toHaveBeenCalled()
  })

  // The department is what the /deliverables form has always passed and update_task_assignment
  // never did — work given to Production must stop counting against Creative (d.9).
  it('stamps the assignee’s department and team on the new task', async () => {
    open()
    fillProject({ task: '', newName: 'Second install' })
    fireEvent.submit(screen.getByTestId('booking-dialog'))
    await vi.waitFor(() => expect(state.upsertSubTask).toHaveBeenCalled())
    expect(state.upsertSubTask.mock.calls[0]![0]).toMatchObject({
      departmentId: 'dept-prod',
      teamId: 'team-a',
    })
  })

  // I71.2 (Edward, 1 Oct, A): anyone but the owner adding a task re-opens an approved list (ADR-0132 d.4), so the
  // assignment would be refused. The dialog stops at "added", names the owner, and assigns nothing.
  it('stops at "added" and names the owner when adding the task re-opened the list', async () => {
    state.listGate = { approved: false, ownerName: 'Fadia Wael Amin' }
    try {
      open()
      fillProject({ task: '', newName: 'Second install' })
      fireEvent.submit(screen.getByTestId('booking-dialog'))
      await vi.waitFor(() => expect(screen.getByTestId('booking-result')).toHaveTextContent(
        'Added Second install. Fadia Wael Amin must approve the task list before it can be booked.'))
      expect(state.upsertSubTask).toHaveBeenCalled()
      expect(state.updateTask).not.toHaveBeenCalled()
      expect(state.createBooking).not.toHaveBeenCalled()
    } finally {
      state.listGate = { approved: true, ownerName: 'Fadia Wael Amin' }
    }
  })

  // I71.4: a lead schedules anyone (ADR-0098) but writes tasks only in their own reach. A direct assignment across
  // departments placed the new task on the assignee's department, which the insert policy refused — every time.
  it('places it on the caller’s own department when they cannot write the assignee’s, then assigns directly', async () => {
    state.writeReach = false
    try {
      open()
      fillProject({ task: '', newName: 'Second install' })
      fireEvent.submit(screen.getByTestId('booking-dialog'))
      await vi.waitFor(() => expect(state.updateTask).toHaveBeenCalled())
      expect(state.upsertSubTask.mock.calls[0]![0]).toMatchObject({ departmentId: 'dept-creative', assigneeId: null })
      expect(state.updateTask.mock.calls[0]![0]).toMatchObject({ subTaskId: 's-new', assigneeId: 'u-sam' })
    } finally {
      state.writeReach = true
    }
  })

  it('refuses an empty new-task name', () => {
    open()
    fillProject({ task: '', newName: '' })
    fireEvent.submit(screen.getByTestId('booking-dialog'))
    expect(state.upsertSubTask).not.toHaveBeenCalled()
  })
})

describe('a person outside your reach is asked for, not refused (ADR-0087 d.2, d.12)', () => {
  beforeEach(() => {
    state.route = 'request'
    state.updateTask.mockReset().mockResolvedValue({ outcome: 'requested', requestId: 'q1', reschedule_needed: false })
  })
  afterEach(() => {
    state.route = 'direct'
  })

  // The mirror's one job: wording BEFORE submit. The server decides.
  it('says before submit that this will be sent to the department for approval, and offers only project work', () => {
    open()
    expect(screen.getByTestId('booking-will-request').textContent).toContain('Production')
    // d.15: ad-hoc creation keeps refusing out of reach, so it is not offered.
    expect(screen.queryByTestId('mode-adhoc')).toBeNull()
    expect(screen.getByTestId('booking-submit').textContent).toBe('Send request')
  })

  it('reads the answer: a request assigns nothing, schedules nothing, and says so', async () => {
    open()
    fillProject({ task: 's1' })
    fireEvent.submit(screen.getByTestId('booking-dialog'))
    await vi.waitFor(() => expect(state.updateTask).toHaveBeenCalled())
    expect(state.updateTask.mock.calls[0]![0]).toMatchObject({ subTaskId: 's1', assigneeId: 'u-sam' })
    await vi.waitFor(() => expect(screen.getByTestId('booking-result').textContent).toContain('Request sent'))
    expect(state.createBooking).not.toHaveBeenCalled()
    expect(screen.queryByTestId('booking-unscheduled')).toBeNull()
  })

  // A new task for an out-of-reach person is placed where the CALLER can write it, then requested.
  it('creates a new task on the requester’s own placement, then requests it', async () => {
    open()
    fillProject({ task: '', newName: 'Studio day' })
    fireEvent.submit(screen.getByTestId('booking-dialog'))
    await vi.waitFor(() => expect(state.updateTask).toHaveBeenCalled())
    expect(state.upsertSubTask.mock.calls[0]![0]).toMatchObject({ assigneeId: null, materialise: false })
    // What matters is that it is NOT the assignee's (dept-prod), which the caller cannot write.
    expect(state.upsertSubTask.mock.calls[0]![0].departmentId).not.toBe('dept-prod')
    expect(state.updateTask.mock.calls[0]![0]).toMatchObject({ subTaskId: 's-new', assigneeId: 'u-sam' })
  })

  // d.13: the server refuses a request nobody could answer, with a hint the dialog reads.
  it('shows the unplaced refusal when the server says nobody scoped can reach them', async () => {
    state.updateTask.mockReset().mockRejectedValue(Object.assign(new Error('unplaced'), { code: '42501', hint: 'unplaced_resource' }))
    open()
    fillProject({ task: 's1' })
    fireEvent.submit(screen.getByTestId('booking-dialog'))
    await vi.waitFor(() => expect(screen.getByTestId('booking-error').textContent).toContain('isn’t assigned to a department or team'))
  })
})

describe('what Project mode no longer offers (ADR-0060 d.6, d.7)', () => {
  // d.7, Edward: "it could assign 14 steps to one person."
  it('has no "whole deliverable" option — a task is always chosen', () => {
    open()
    fireEvent.change(screen.getByTestId('booking-project'), { target: { value: 'c1' } })
    fireEvent.change(screen.getByTestId('booking-deliverable-select'), { target: { value: 'd1' } })
    const options = Array.from(screen.getByTestId('booking-subtask-select').querySelectorAll('option'))
    expect(options.map((o) => o.textContent)).not.toContain('Whole deliverable')
  })

  // d.6: work cannot be assigned to a camera. Equipment goes on a task as a REQUIREMENT instead,
  // which is why the requirements picker moved into this mode (d.10).
  it('is not offered on an equipment resource', () => {
    open(camera)
    expect(screen.queryByTestId('booking-project')).toBeNull()
    // A camera is still reservable as a block of time, with a note.
    expect(screen.getByTestId('booking-adhoc-text')).toBeInTheDocument()
  })

  // I66.10 (Edward, 29 Sep): ad-hoc work is switched off. On a person there is no mode to choose — only a task
  // from a project — and nothing can reach create_adhoc_deliverable from here.
  it('offers no ad-hoc work on a person: only a task from a project (I66.10)', () => {
    open()
    expect(screen.queryByTestId('mode-adhoc')).toBeNull()
    expect(screen.queryByTestId('mode-project')).toBeNull()
    expect(screen.queryByTestId('booking-adhoc-text')).toBeNull()
    expect(screen.queryByTestId('booking-adhoc-reviewer')).toBeNull()
    expect(screen.getByTestId('booking-project')).toBeInTheDocument()
    fireEvent.submit(screen.getByTestId('booking-dialog'))
    expect(state.createAdhoc).not.toHaveBeenCalled()
  })

  // ADR-0090 d.3a: a held task is not offered anywhere assignment starts — absence, not a disabled
  // entry. The narrowing is the database's (`assignable_deliverables`, pgTAP 133), read from the
  // same function the gate reads; the dialog offers exactly what arrives and adds no rule of its own.
  it('offers exactly the deliverables the server says are assignable, nothing else (ADR-0090 d.3a)', () => {
    state.campaigns = [{ id: 'c1', name: 'Ramadan teaser posts', kind: 'single_job' }]
    state.deliverables = [{ id: 'd-ok', name: 'Approved list' }]
    open()
    fireEvent.change(screen.getByTestId('booking-project'), { target: { value: 'c1' } })
    const options = Array.from(screen.getByTestId('booking-deliverable-select').querySelectorAll('option')).map((o) => o.textContent)
    expect(options).toEqual(['Select deliverable…', 'Approved list'])
  })

  it('offers the requirements picker on a person, so the camera goes on the task', () => {
    open()
    fireEvent.change(screen.getByTestId('booking-project'), { target: { value: 'c1' } })
    fireEvent.change(screen.getByTestId('booking-deliverable-select'), { target: { value: 'd1' } })
    expect(screen.getByTestId('staged-resources')).toBeInTheDocument()
  })
})

describe('the submit button blocks while it is working (ADR-0061 d.3)', () => {
  // Two of the five duplicate tasks on 27 Aug were 4.2 and 1.4 seconds apart. `busy` was wired to
  // the PLAIN BOOKING mutation, so during an assignment the button neither spun nor disabled and a
  // second press made a second task.
  it('is disabled while the assignment is in flight', () => {
    state.updateTaskPending = true
    open()
    expect(screen.getByTestId('booking-submit')).toBeDisabled()
  })

  it('is enabled when nothing is in flight', () => {
    open()
    expect(screen.getByTestId('booking-submit')).not.toBeDisabled()
  })
})

describe('the task picker (ADR-0060 d.3)', () => {
  it('says so when every task is already assigned, rather than showing an empty list', () => {
    state.subTasks = []
    open()
    fireEvent.change(screen.getByTestId('booking-project'), { target: { value: 'c1' } })
    fireEvent.change(screen.getByTestId('booking-deliverable-select'), { target: { value: 'd1' } })
    expect(screen.getByTestId('booking-no-assignable-tasks')).toBeInTheDocument()
  })
})

/**
 * I59.14 (ADR-0105 d.5, Q31): the dialog in L2's look — the ASSIGN eyebrow, the piece as the
 * heading, a context line, the person with their week, and who is told. Cosmetic only: every field
 * above is still there and still behaves as it did.
 */
describe('BookingDialog — L2 look (I59.14)', () => {
  it('opens as New booking, with the person, their week and who is told', () => {
    open()
    expect(screen.getByTestId('booking-l2-heading')).toHaveTextContent('New booking')
    expect(screen.getByTestId('booking-dialog').querySelector('.tag')).toHaveTextContent('Assign')
    expect(screen.getByTestId('booking-l2-person')).toHaveTextContent('Sam')
    expect(screen.getByTestId('booking-l2-pct')).toHaveTextContent('0% booked')
    expect(screen.getByTestId('booking-l2-told')).toHaveTextContent('Sam sees it in My work')
  })

  it('takes the piece as its heading once one is chosen, and keeps every field', () => {
    open()
    fillProject()
    expect(screen.getByTestId('booking-l2-heading')).toHaveTextContent('Billboard, Karrada — Installation')
    for (const id of ['booking-project', 'booking-deliverable-select', 'booking-subtask-select', 'booking-date', 'booking-end-date', 'booking-hours', 'booking-provisional', 'booking-confirmed', 'booking-submit', 'booking-cancel']) {
      expect(screen.getByTestId(id)).toBeInTheDocument()
    }
  })

  it('equipment is booked, not assigned, and names nobody to tell', () => {
    open(camera)
    expect(screen.getByTestId('booking-dialog').querySelector('.tag')).toHaveTextContent('Book')
    expect(screen.queryByTestId('booking-l2-person')).toBeNull()
    expect(screen.queryByTestId('booking-l2-told')).toBeNull()
  })
})

/**
 * I59 (settled 25 Sep): the team view's "Nobody yet" drop that cannot finish — no reviewer, or no
 * hours (E11) — opens this dialog with the task already chosen, so only what is missing is asked.
 */
describe('BookingDialog — opened pre-filled from the team view (I59)', () => {
  const prefilled = (hoursPerDay?: string) =>
    render(
      <BookingDialog
        draft={{ resourceId: person.id, isoDate: '2027-03-01', endIsoDate: '2027-03-02', campaignId: 'c1', deliverableId: 'd1', subTaskId: 's1', hoursPerDay }}
        resources={[person]}
        bookings={[]}
        blackouts={[]}
        onClose={() => {}}
      />,
    )

  it('opens on the person, the days, the campaign, the piece and the task; only the reviewer is asked', async () => {
    prefilled('4')
    expect(screen.getByTestId('booking-project')).toHaveValue('c1')
    expect(screen.getByTestId('booking-deliverable-select')).toHaveValue('d1')
    expect(screen.getByTestId('booking-subtask-select')).toHaveValue('s1')
    expect(screen.getByTestId('booking-date')).toHaveValue('2027-03-01')
    expect(screen.getByTestId('booking-end-date')).toHaveValue('2027-03-02')
    expect(screen.getByTestId('booking-hours')).toHaveValue(4)
    fireEvent.submit(screen.getByTestId('booking-dialog'))
    expect(screen.getByTestId('booking-error')).toBeInTheDocument() // the reviewer is still asked for
    expect(state.updateTask).not.toHaveBeenCalled()
    fireEvent.change(screen.getByTestId('booking-project-reviewer-add'), { target: { value: 'u-omar' } })
    fireEvent.submit(screen.getByTestId('booking-dialog'))
    await vi.waitFor(() => expect(state.updateTask).toHaveBeenCalled())
    expect(state.updateTask.mock.calls[0]![0]).toMatchObject({ subTaskId: 's1', assigneeId: 'u-sam', hours: 8 })
  })

  it('a task with no hours opens with the hours empty, and nothing is assigned until they are entered (E11)', () => {
    prefilled('')
    expect(screen.getByTestId('booking-hours')).toHaveValue(null)
    fireEvent.change(screen.getByTestId('booking-project-reviewer-add'), { target: { value: 'u-omar' } })
    fireEvent.submit(screen.getByTestId('booking-dialog'))
    expect(screen.getByTestId('booking-error')).toBeInTheDocument()
    expect(state.updateTask).not.toHaveBeenCalled()
  })
})
