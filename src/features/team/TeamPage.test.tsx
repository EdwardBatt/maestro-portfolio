import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../../lib/i18n'
import type { TeamLoadGroup, TeamLoadPerson } from './api/team-api'
import type { TeamTask } from './api/team-view-api'

/**
 * The team / department view (I59.12, I59.13 — ADR-0105 d.4 / d.5). Every read is mocked at its
 * hook; the page's own decisions — scope, rows, grouping, figures, the week, the bars, the drag and
 * its warnings — run for real.
 */

const viewer = vi.hoisted(() => ({
  scope: 'team' as null | 'team' | 'department' | 'tenant' | 'account' | 'self',
  teamId: 'T1' as string | null,
  departmentId: 'D1' as string | null,
}))

const person = (over: Partial<TeamLoadPerson>): TeamLoadPerson => ({
  id: 'p', name: 'P', nickname: null, teamId: null, teamName: null, departmentId: 'D1', departmentName: 'Creative',
  bookedHours: 0, bookingCount: 0, nominalHours: 40, utilPct: 0, warnPct: 100, ceilingPct: 120, level: 'ok', over: false,
  ...over,
})
const THIS_WEEK: TeamLoadGroup[] = [
  { key: 'team:Art', label: 'Art & Video', kind: 'team', people: [
    person({ id: 'r-z', name: 'Zubaida', teamId: 'T1', teamName: 'Art & Video', bookedHours: 36, utilPct: 90 }),
    person({ id: 'r-f', name: 'Fadia', teamId: 'T1', teamName: 'Art & Video', bookedHours: 12, utilPct: 30 }),
  ] },
  { key: 'team:Copy', label: 'Copy', kind: 'team', people: [
    person({ id: 'r-a', name: 'Abeer', teamId: 'T2', teamName: 'Copy', bookedHours: 22, utilPct: 55 }),
  ] },
  { key: 'dept:Creative', label: 'Creative', kind: 'department', people: [
    person({ id: 'r-l', name: 'Creative lead' }),
  ] },
  { key: 'team:Perf', label: 'Performance', kind: 'team', people: [
    person({ id: 'r-o', name: 'Omar', teamId: 'T9', teamName: 'Performance', departmentId: 'D9', departmentName: 'Strategy' }),
  ] },
]
const NEXT_WEEK: TeamLoadGroup[] = [
  { key: 'team:Art', label: 'Art & Video', kind: 'team', people: [
    person({ id: 'r-z', name: 'Zubaida', teamId: 'T1', teamName: 'Art & Video', bookedHours: 48, utilPct: 120, level: 'over', over: true }),
    person({ id: 'r-f', name: 'Fadia', teamId: 'T1', teamName: 'Art & Video', bookedHours: 0, utilPct: 0 }),
  ] },
]

const loadCalls = vi.hoisted(() => [] as number[])
vi.mock('./api/team-api', () => ({
  useTeamLoad: (weekOf: Date) => {
    loadCalls.push(weekOf.getTime())
    // The week the page asked for, by its distance from 20 Sep.
    const offset = Math.floor((weekOf.getTime() - Date.parse('2026-09-20T00:00:00Z')) / (7 * 86_400_000))
    const groups = offset === 1 ? NEXT_WEEK : offset === 2 ? [] : THIS_WEEK
    return { week: { start: '', end: '', label: '' }, groups, isLoading: false, isError: false }
  },
}))

vi.mock('../../lib/supabase', () => ({ supabaseUntyped: {}, supabase: {} }))

const office = { name: 'Baghdad', timezone: 'UTC', workingDays: [7, 1, 2, 3, 4] }
const res = (id: string, name: string, userId: string, teamId: string | null, departmentId: string) => ({
  id, name, nickname: null, kind: 'human', userId, teamId, teamName: null, departmentId, departmentName: 'Creative',
  officeId: 'o1', capacityModel: 'load_based', requiresApproval: false, warnAtPct: 100, ceilingPct: 200, poolSize: null, office,
})
const RESOURCES = [
  res('r-z', 'Zubaida', 'u-z', 'T1', 'D1'), res('r-f', 'Fadia', 'u-f', 'T1', 'D1'), res('r-a', 'Abeer', 'u-a', 'T2', 'D1'),
  res('r-l', 'Creative lead', 'u-l', null, 'D1'), res('r-o', 'Omar', 'u-o', 'T9', 'D9'),
]
const SUN = Date.parse('2026-09-20T00:00:00Z')
const H = 3_600_000
const bk = (id: string, resourceId: string, subTaskId: string, day: number, loadPct = 100) => ({
  id, resourceId, subTaskId, state: 'confirmed', loadPct, start: SUN + day * 86_400_000 + 6 * H, end: SUN + day * 86_400_000 + 14 * H,
  taskName: null, bookingTitle: null, notes: null, campaignId: null, campaignName: null, deliverableId: null, seriesId: null, phaseId: null, priority: null,
})
const BOOKINGS = [
  bk('b1', 'r-z', 't-post2', 0), bk('b2', 'r-z', 't-post2', 1),
  bk('b3', 'r-z', 't-other', 2), // Zubaida's Tuesday is full
  bk('b4', 'r-f', 't-winner', 3),
  bk('b5', 'r-a', 't-copy', 1),
]
const reassign = vi.hoisted(() => vi.fn())
vi.mock('../schedule/api/schedule-api', () => ({
  useScheduleResources: () => ({ data: RESOURCES, isLoading: false }),
  useScheduleBookings: () => ({ data: BOOKINGS }),
  useScheduleBlackouts: () => ({ data: [] }),
  useReassignTaskToResource: () => ({ mutate: reassign, isPending: false }),
}))

const task = (over: Partial<TeamTask>): TeamTask => ({
  id: 't', title: 'Design', deliverableId: 'd', pieceName: 'Post 2', campaignId: 'c1', campaignName: 'LUMA',
  workstreamId: null, workstreamName: null, status: 'in_progress', revisionNumber: 0, assigneeId: 'u-z',
  startsAt: null, dueAt: null, committedDueAt: null, hours: 8, departmentId: 'D1', teamId: 'T1',
  deliverableDueAt: null, goLiveAt: null, waitingOn: null,
  ownerId: null, deliverableDepartmentId: 'D1', reviewerIds: ['u-l'],
  assignedAt: null, tasksApprovedAt: null, roundStartedAt: null, roundSentAt: null, blockedSince: null,
  ...over,
})
const TASKS: TeamTask[] = [
  task({ id: 't-post2', pieceName: 'Post 2', title: 'Design', workstreamId: 'w1', workstreamName: 'Draw nights', hours: 16,
    startsAt: '2026-09-20T06:00:00Z', dueAt: '2026-09-21T14:00:00Z', committedDueAt: '2026-09-24T14:00:00Z',
    deliverableDueAt: '2026-09-24T14:00:00Z', roundStartedAt: '2026-09-21T08:00:00Z' }),
  task({ id: 't-winner', pieceName: 'Winner cards', title: 'Motion', assigneeId: 'u-f', status: 'review',
    startsAt: '2026-09-23T06:00:00Z', dueAt: '2026-09-23T14:00:00Z', committedDueAt: '2026-09-30T14:00:00Z',
    roundSentAt: '2026-09-22T04:00:00Z' }),
  task({ id: 't-copy', pieceName: 'Eid', title: 'Copy', assigneeId: 'u-a', teamId: 'T2', waitingOn: 'Arabic copy',
    status: 'todo', assignedAt: '2026-09-21T08:00:00Z' }),
  // E1: owned by the Art & Video lead - on the team's view and the department's.
  task({ id: 't-nobody', pieceName: 'Week 2 explainer', title: 'Animation', assigneeId: null, hours: 4, teamId: null, dueAt: '2026-09-30T14:00:00Z',
    status: 'todo', ownerId: 'u-t1lead', tasksApprovedAt: '2026-09-20T08:00:00Z' }),
  // E1: PLACED on Art & Video but owned by the department lead - the department's view only.
  task({ id: 't-placed', pieceName: 'Launch film', title: 'Edit', assigneeId: null, hours: 6, teamId: 'T1', status: 'todo',
    ownerId: 'u-l', dueAt: '2026-10-02T14:00:00Z' }),
]
const extra = vi.hoisted(() => ({ tasks: [] as unknown[] }))
vi.mock('./api/team-view-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api/team-view-api')>()),
  useTeamViewTasks: () => ({ data: [...TASKS, ...(extra.tasks as TeamTask[])], isError: false }),
  useTeamMemberIds: (teamId: string | null) => ({ data: teamId === 'T1' ? ['u-z', 'u-f', 'u-t1lead'] : [], isLoading: false }),
  useJobTitles: () => ({ data: new Map([['u-z', 'Motion designer']]) }),
}))

// Zubaida owns a late piece; so does Omar (another department); one piece has no owner.
const late = (ownerId: string | null, taskId: string) => ({
  state: 'in_progress', dueAt: '2020-01-05T15:00:00Z', taskListApprovedAt: '2020-01-01T00:00:00Z', ownerId,
  reviewerId: null, workstreamOwnerId: null, outstandingInputs: 0,
  tasks: [{ id: taskId, status: 'in_progress', assigneeId: null, committedStartsAt: null, committedDueAt: null, hours: null, submittedAt: null }],
})
vi.mock('../campaigns/api/campaign-pulse-api', () => ({
  useCampaignPulse: () => ({ data: new Map([['c1', { pieces: [late('u-z', 't-post2'), late('u-o', 't-omar'), late(null, 't-x')] }]]) }),
}))

vi.mock('../admin/api/admin-api', () => ({
  useDepartments: () => ({ data: [{ id: 'D9', name: 'Strategy' }, { id: 'D1', name: 'Creative' }], isLoading: false }),
  useWorkDepartments: () => ({ data: [{ id: 'D9', name: 'Strategy' }, { id: 'D1', name: 'Creative' }], isLoading: false }),
  useTeams: () => ({ data: [{ id: 'T1', name: 'Art & Video', departmentId: 'D1', departmentName: 'Creative' }] }),
}))
vi.mock('../../app/permissions', () => ({
  usePermissions: () => ({ can: () => true, scope: viewer.scope, teamId: viewer.teamId, departmentId: viewer.departmentId, ready: true }),
}))
vi.mock('../schedule/hooks/use-write-scope', () => ({
  useWriteScope: () => ({
    can: () => true, ready: true, canWriteResource: () => true, canRequestResource: () => false,
    refusalFor: () => ({ key: 'schedule.notAuthorised', params: {} }), routeFor: () => 'direct',
  }),
}))
vi.mock('../schedule/components/BookingDialog', () => ({
  BookingDialog: (p: { draft: unknown; onClose: () => void }) => (
    <div data-testid="booking-dialog">
      <span data-testid="booking-draft">{JSON.stringify(p.draft)}</span>
      <button type="button" onClick={p.onClose} data-testid="booking-cancel">close</button>
    </div>
  ),
}))
// ADR-0141 d.2/d.5: a move past the piece's due date opens the one change form, filled in with the day.
vi.mock('../campaigns/components/ChangeAskDialog', () => ({
  ChangeAskDialog: (p: { fromSubTaskId: string; initialDueDay?: string }) => (
    <div data-testid="team-extension-request">{p.fromSubTaskId} {p.initialDueDay}</div>
  ),
}))

import { TeamPage } from './TeamPage'

function renderPage(path = '/team') {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <TeamPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
const drop = (taskId: string, resourceId: string, iso: string) =>
  fireEvent.drop(screen.getByTestId(`tv-cell-${resourceId}-${iso}`), { dataTransfer: { getData: () => taskId } })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-22T09:00:00Z')) // a Tuesday
  viewer.scope = 'team'
  viewer.teamId = 'T1'
  viewer.departmentId = 'D1'
  reassign.mockReset()
  loadCalls.length = 0
  extra.tasks = []
})
afterEach(() => vi.useRealTimers())

describe('scope — who sees which rows (ADR-0105 d.4)', () => {
  it('a team lead sees their team, no headings, under "<team>, this week"', () => {
    renderPage()
    expect(screen.getByTestId('team-title')).toHaveTextContent('Art & Video, this week')
    expect(screen.getByTestId('team-row-r-z')).toBeInTheDocument()
    expect(screen.getByTestId('team-row-r-f')).toBeInTheDocument()
    expect(screen.queryByTestId('team-row-r-a')).toBeNull()
    expect(screen.queryByTestId('team-group-team:T1')).toBeNull()
    expect(screen.queryByTestId('team-department-picker')).toBeNull()
  })

  it('a department lead sees the department under team headings, each with its %, and No team', () => {
    viewer.scope = 'department'
    renderPage()
    expect(screen.getByTestId('team-title')).toHaveTextContent('Creative, this week')
    expect(screen.getByTestId('team-group-team:T1')).toHaveTextContent('Art & Video · 60%')
    expect(screen.getByTestId('team-group-team:T2')).toHaveTextContent('Copy · 55%')
    expect(screen.getByTestId('team-group-none')).toHaveTextContent('No team')
    expect(within(screen.getByTestId('team-section-none')).getByTestId('team-row-r-l')).toBeInTheDocument()
    expect(screen.queryByTestId('team-row-r-o')).toBeNull()
  })

  it('anyone else picks a department — their own if they have one, else the first alphabetically', () => {
    viewer.scope = 'tenant'
    viewer.departmentId = null
    renderPage()
    const picker = screen.getByTestId('team-department-picker') as HTMLSelectElement
    expect(picker.value).toBe('D1') // Creative before Strategy
    fireEvent.change(picker, { target: { value: 'D9' } })
    expect(screen.getByTestId('team-row-r-o')).toBeInTheDocument()
    expect(screen.queryByTestId('team-row-r-z')).toBeNull()
  })

  it('Nobody yet on a team = work on pieces a team member owns; the department sees every unassigned task (E1)', () => {
    const { unmount } = renderPage()
    const nobody = screen.getByTestId('team-row-nobody')
    expect(within(nobody).getByTestId('tv-bar-t-nobody')).toBeInTheDocument()
    expect(within(nobody).queryByTestId('tv-bar-t-placed')).toBeNull() // placed on the team, owned outside it
    unmount()
    viewer.scope = 'department'
    renderPage()
    const dept = screen.getByTestId('team-row-nobody')
    expect(within(dept).getByTestId('tv-bar-t-placed')).toBeInTheDocument()
    expect(within(dept).getByTestId('tv-bar-t-nobody')).toBeInTheDocument()
  })

  it('a team-scoped role with no team keeps today\'s message and shows nothing else', () => {
    viewer.teamId = null
    renderPage()
    expect(screen.getByTestId('team-unassigned')).toBeInTheDocument()
    expect(screen.queryByTestId('team-kpis')).toBeNull()
    expect(screen.queryByTestId('team-timeline')).toBeNull()
  })
})

describe('the week — as the Schedule\'s arrows', () => {
  it('moves a week at a time and comes home on This week', () => {
    renderPage()
    expect(screen.getByTestId('team-week-today')).toBeDisabled()
    fireEvent.click(screen.getByTestId('team-week-next'))
    expect(screen.getByTestId('team-title')).toHaveTextContent('Art & Video, week of Sun, 27 Sep')
    expect(loadCalls.some((at) => at >= Date.parse('2026-09-27T00:00:00Z') && at < Date.parse('2026-09-28T00:00:00Z'))).toBe(true)
    fireEvent.click(screen.getByTestId('team-week-prev'))
    fireEvent.click(screen.getByTestId('team-week-prev'))
    expect(screen.getByTestId('team-title')).toHaveTextContent('week of Sun, 13 Sep')
    fireEvent.click(screen.getByTestId('team-week-today'))
    expect(screen.getByTestId('team-title')).toHaveTextContent('Art & Video, this week')
  })

  it('opens on the week of ?on=', () => {
    renderPage('/team?on=2026-10-01')
    expect(screen.getByTestId('team-title')).toHaveTextContent('week of Sun, 27 Sep')
  })
})

describe('the four figures', () => {
  it('Team, At risk (pieces the people shown own), Unassigned and In review', () => {
    renderPage()
    expect(screen.getByTestId('team-kpi-load')).toHaveTextContent('2 people · 60%')
    expect(screen.getByTestId('team-kpi-at-risk')).toHaveTextContent('1')
    expect(screen.getByTestId('team-kpi-unassigned')).toHaveTextContent('1')
    expect(screen.getByTestId('team-kpi-review')).toHaveTextContent('1')
  })

  it('each opens its tab, filtered', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('team-figure-unassigned'))
    expect(screen.getByTestId('team-filter')).toHaveTextContent('Unassigned')
    expect(screen.getByTestId('team-piece-t-nobody')).toBeInTheDocument()
    expect(screen.queryByTestId('team-piece-t-post2')).toBeNull()
    fireEvent.click(screen.getByTestId('team-figure-at-risk'))
    expect(screen.getByTestId('team-piece-t-post2')).toBeInTheDocument()
    expect(screen.queryByTestId('team-piece-t-nobody')).toBeNull()
    fireEvent.click(screen.getByTestId('team-figure-review'))
    expect(screen.getByTestId('team-piece-t-winner')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('team-filter-clear'))
    expect(screen.getByTestId('team-piece-t-nobody')).toBeInTheDocument()
    expect(screen.getByTestId('team-piece-t-post2')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('team-figure-team'))
    expect(screen.getByTestId('team-load')).toBeInTheDocument()
  })
})

describe('Timeline — one bar per task, coloured by its status (I67.3)', () => {
  it('draws each task once, coloured by where it is, and the work nobody has', () => {
    renderPage()
    const post = screen.getByTestId('tv-bar-t-post2')
    expect(post).toHaveAttribute('data-status', 'inProgress')
    expect(post).toHaveTextContent('Post 2 · Design')
    expect(screen.getByTestId('tv-bar-t-winner')).toHaveAttribute('data-status', 'review')
    expect(screen.getByTestId('tv-bar-t-nobody')).toHaveAttribute('data-status', 'unassigned')
    expect(screen.getByTestId('tv-bar-state-t-winner')).toHaveTextContent('review')
    expect(within(screen.getByTestId('team-row-nobody')).getByTestId('tv-bar-t-nobody')).toHaveTextContent('4h')
    expect(screen.getByTestId('team-row-pct-r-z')).toHaveTextContent('90%')
    expect(screen.getByTestId('team-row-r-z')).toHaveTextContent('Motion designer')
  })

  it('Nobody yet: undated work wraps as full-label chips across the week, still draggable', () => {
    extra.tasks = [
      task({ id: 't-undated', pieceName: 'Autumn key visual', title: 'Creative Direction — Autumn key visual', assigneeId: null,
        hours: 4, status: 'todo', ownerId: 'u-t1lead' }),
    ]
    renderPage()
    const nobody = screen.getByTestId('team-row-nobody')
    const strip = within(nobody).getByTestId('team-nobody-undated')
    const chip = within(strip).getByTestId('tv-bar-t-undated')
    expect(chip).toHaveClass('tv-chip')
    expect(chip).toHaveTextContent('Autumn key visual · Creative Direction')
    expect(chip).not.toHaveTextContent('— Autumn key visual')
    expect(chip).toHaveTextContent('4h')
    expect(chip).toHaveTextContent('drag to a person')
    expect(chip.style.insetInlineStart).toBe('') // in the flow, not pinned to the first day
    // Dated work nobody has still sits on its days, outside the strip.
    expect(within(strip).queryByTestId('tv-bar-t-nobody')).toBeNull()
    expect(within(nobody).getByTestId('tv-bar-t-nobody').style.insetInlineStart).not.toBe('')
    // And the chip drags exactly as a bar does.
    expect(chip).toHaveAttribute('draggable', 'true')
    const setData = vi.fn()
    fireEvent.dragStart(chip, { dataTransfer: { setData } })
    expect(setData).toHaveBeenCalledWith('text/team-task', 't-undated')
    drop('t-undated', 'r-f', '2026-09-22')
    fireEvent.click(screen.getByTestId('team-assign-confirm-apply'))
    expect(reassign).toHaveBeenCalledWith(
      { subTaskId: 't-undated', targetUserId: 'u-f', targetIsoDate: '2026-09-22', timezone: 'UTC' },
      expect.anything(),
    )
  })

  it('keys the statuses, and the workstream filter fades the rest', () => {
    renderPage()
    const key = screen.getByTestId('team-key')
    for (const word of ['Not started', 'In progress', 'In review', 'Changes requested', 'Blocked', 'Unassigned']) {
      expect(key).toHaveTextContent(word)
    }
    expect(key).not.toHaveTextContent('Draw nights')
    fireEvent.change(screen.getByTestId('team-workstream-filter'), { target: { value: 'w1' } })
    expect(screen.getByTestId('tv-bar-t-winner')).toHaveClass('tv-bar-faded')
    expect(screen.getByTestId('tv-bar-t-post2')).not.toHaveClass('tv-bar-faded')
  })

  it('marks today', () => {
    renderPage()
    expect(screen.getByTestId('team-today-line')).toBeInTheDocument()
  })
})

describe('dragging on the timeline — the Schedule\'s assignment and checks (ADR-0105 d.5)', () => {
  it('from Nobody yet onto a person: asks once, then assigns through the reassignment', () => {
    renderPage()
    drop('t-nobody', 'r-f', '2026-09-22')
    expect(reassign).not.toHaveBeenCalled()
    expect(screen.getByTestId('team-assign-body')).toHaveTextContent('Give it to Fadia')
    fireEvent.click(screen.getByTestId('team-assign-confirm-apply'))
    expect(reassign).toHaveBeenCalledWith(
      { subTaskId: 't-nobody', targetUserId: 'u-f', targetIsoDate: '2026-09-22', timezone: 'UTC' },
      expect.anything(),
    )
  })

  it('Cancel on the confirmation moves nothing', () => {
    renderPage()
    drop('t-nobody', 'r-f', '2026-09-22')
    fireEvent.click(screen.getByTestId('team-assign-confirm-cancel'))
    expect(reassign).not.toHaveBeenCalled()
  })

  it('past the committed date: L6 — Move it anyway moves it, on the same row with no second question', () => {
    renderPage()
    drop('t-post2', 'r-z', '2026-09-24') // two days from Thursday ends Friday, after the 24th
    expect(screen.getByTestId('team-move-warning-message')).toHaveTextContent('1 day late')
    fireEvent.click(screen.getByTestId('team-move-warning-confirm'))
    expect(reassign).toHaveBeenCalledWith(expect.objectContaining({ subTaskId: 't-post2', targetUserId: 'u-z', targetIsoDate: '2026-09-24' }), expect.anything())
    expect(screen.queryByTestId('team-assign-confirm')).toBeNull()
  })

  it('L6 — keep the date and give it to someone with room', () => {
    renderPage()
    drop('t-post2', 'r-z', '2026-09-24')
    fireEvent.click(screen.getByTestId('team-move-warning-keep-date'))
    fireEvent.click(screen.getByTestId('team-move-warning-keep-date-r-f'))
    expect(reassign).toHaveBeenCalledWith(expect.objectContaining({ targetUserId: 'u-f', targetIsoDate: '2026-09-20' }), expect.anything())
  })

  it('L6 — ask for the extension opens today\'s request, pre-filled, and moves nothing', () => {
    renderPage()
    drop('t-post2', 'r-z', '2026-09-24')
    fireEvent.click(screen.getByTestId('team-move-warning-extension'))
    expect(screen.getByTestId('team-extension-request')).toHaveTextContent('t-post2 2026-09-25')
    expect(reassign).not.toHaveBeenCalled()
  })

  it("ADR-0141 d.2: past the commitment but on or before the piece's due date, no change form is offered", () => {
    extra.tasks = [task({ id: 't-early', pieceName: 'Post 3', title: 'Design', hours: 8, assigneeId: 'u-f',
      startsAt: '2026-09-20T06:00:00Z', dueAt: '2026-09-20T14:00:00Z', committedDueAt: '2026-09-21T14:00:00Z',
      deliverableDueAt: '2026-09-30T14:00:00Z' })]
    renderPage()
    drop('t-early', 'r-z', '2026-09-24')
    expect(screen.getByTestId('team-move-warning-dialog')).toBeInTheDocument()
    expect(screen.queryByTestId('team-move-warning-extension')).toBeNull()
  })

  it('L6 — Cancel moves nothing', () => {
    renderPage()
    drop('t-post2', 'r-z', '2026-09-24')
    fireEvent.click(screen.getByTestId('team-move-warning-cancel'))
    expect(screen.queryByTestId('team-move-warning-dialog')).toBeNull()
    expect(reassign).not.toHaveBeenCalled()
  })

  it('at the warn level: L7 — give it to the freest person instead', () => {
    renderPage()
    drop('t-winner', 'r-z', '2026-09-22') // Zubaida's Tuesday is already full
    expect(screen.getByText('Zubaida is at 90% already')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('team-move-warning-instead'))
    expect(reassign).toHaveBeenCalledWith(expect.objectContaining({ subTaskId: 't-winner', targetUserId: 'u-f', targetIsoDate: '2026-09-22' }), expect.anything())
  })

  it('from Nobody yet onto a person, a task with no reviewer opens the assignment dialog, pre-filled', () => {
    extra.tasks = [task({ id: 't-norev', assigneeId: null, ownerId: 'u-t1lead', reviewerIds: [], hours: 8, status: 'todo', deliverableId: 'd-9' })]
    renderPage()
    drop('t-norev', 'r-f', '2026-09-22')
    expect(reassign).not.toHaveBeenCalled()
    expect(screen.queryByTestId('team-assign-confirm')).toBeNull()
    expect(JSON.parse(screen.getByTestId('booking-draft').textContent!)).toEqual({
      resourceId: 'r-f', isoDate: '2026-09-22', endIsoDate: '2026-09-22', campaignId: 'c1', deliverableId: 'd-9', subTaskId: 't-norev', hoursPerDay: '8',
    })
    fireEvent.click(screen.getByTestId('booking-cancel'))
    expect(screen.queryByTestId('booking-dialog')).toBeNull()
  })

  it('and so does one whose only reviewer is the person it lands on', () => {
    extra.tasks = [task({ id: 't-selfrev', assigneeId: null, ownerId: 'u-t1lead', reviewerIds: ['u-f'], status: 'todo' })]
    renderPage()
    drop('t-selfrev', 'r-f', '2026-09-22')
    expect(screen.getByTestId('booking-dialog')).toBeInTheDocument()
    expect(reassign).not.toHaveBeenCalled()
  })

  it('a task with no hours opens it with the hours left empty, to be entered (E11)', () => {
    extra.tasks = [task({ id: 't-nohours', assigneeId: null, ownerId: 'u-t1lead', hours: null, status: 'todo' })]
    renderPage()
    drop('t-nohours', 'r-f', '2026-09-22')
    expect(JSON.parse(screen.getByTestId('booking-draft').textContent!)).toMatchObject({ subTaskId: 't-nohours', hoursPerDay: '' })
    expect(reassign).not.toHaveBeenCalled()
  })

  it('a day off warns in the same dialog', () => {
    renderPage()
    drop('t-winner', 'r-f', '2026-09-25') // Friday
    expect(screen.getByTestId('team-move-warning-detail')).toBeInTheDocument()
    expect(reassign).not.toHaveBeenCalled()
  })
})

describe('By person, By piece, Load', () => {
  it('By person: the name opens the Schedule on this person and week; one plain line each', () => {
    viewer.scope = 'department'
    renderPage('/team?tab=person')
    expect(screen.getByTestId('team-person-open-r-z')).toHaveAttribute('href', '/schedule?who=Zubaida&on=2026-09-20')
    expect(screen.getByTestId('team-person-line-r-a')).toHaveTextContent('Waiting on Arabic copy.')
    expect(screen.getByTestId('team-person-line-r-l')).toHaveTextContent('Nothing booked.')
    expect(screen.getByTestId('team-person-line-r-f')).toHaveTextContent('Free Sun, Mon, Tue and Thu.')
  })

  it('By piece: unassigned and late first, then by due; Move and Assign open the Schedule filtered', () => {
    renderPage('/team?tab=piece')
    const ids = screen.getAllByTestId(/^team-piece-t-/).map((r) => r.getAttribute('data-testid'))
    expect(ids).toEqual(['team-piece-t-nobody', 'team-piece-t-post2', 'team-piece-t-winner'])
    expect(screen.getByTestId('team-piece-move-t-post2')).toHaveAttribute('href', '/schedule?view=project&campaign=c1&who=Zubaida&on=2026-09-20')
    expect(screen.getByTestId('team-piece-assign-t-nobody')).toHaveAttribute('href', '/schedule?dept=D1&on=2026-09-20')
  })

  it('By piece "For": time in the current state, real time (E2)', () => {
    viewer.scope = 'department'
    renderPage('/team?tab=piece')
    expect(screen.getByRole('columnheader', { name: 'For' })).toBeInTheDocument()
    expect(screen.getByTestId('team-piece-for-t-post2')).toHaveTextContent('1 day') // in progress since Start
    expect(screen.getByTestId('team-piece-for-t-winner')).toHaveTextContent('5h') // in review since sent
    expect(screen.getByTestId('team-piece-for-t-nobody')).toHaveTextContent('2 days') // since the task list's approval
    expect(screen.getByTestId('team-piece-for-t-copy')).toHaveTextContent('Assigned · 1 day')
    expect(screen.getByTestId('team-piece-for-t-placed')).toHaveTextContent('—') // no approval time to read
  })

  it('Load: three weeks, the team total, one sentence a week', () => {
    renderPage('/team?tab=load')
    expect(screen.getByTestId('team-load-total-0')).toHaveTextContent('60% booked')
    expect(screen.getByTestId('team-load-sentence-0')).toHaveTextContent('Nobody is over and nobody is empty.')
    expect(screen.getByTestId('team-load-sentence-1')).toHaveTextContent('Over: Zubaida. Nothing booked: Fadia.')
    expect(within(screen.getByTestId('team-load-row-r-z')).getAllByText('—')).toHaveLength(1) // the third week has no rows
  })

  it('renders the company news', () => {
    renderPage()
    expect(screen.getByTestId('news-feed')).toBeInTheDocument()
  })
})
