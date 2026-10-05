import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import '../../../lib/i18n'
import type { EditableTask, PieceTaskList } from '../../deliverables/api/task-editor-api'

/**
 * ADR-0140 (I74.7, I74.10–I74.12): the piece's task list on the campaign page. What it must hold:
 *  - before approval it is the suggested list — no Who, "Approve N tasks" through the existing approval;
 *  - once approved, Who and Dates are offered to those who book, never to a team member (who holds project_tasks:manage);
 *  - every row has a pencil beside its ✕, and a started task shows 🔒 instead of ✕;
 *  - removing an unbooked task waits for its undo before anything is sent;
 *  - ticking rows gives them to one person on one day, and Save sends each through the one save path.
 */
const m = vi.hoisted(() => ({
  grants: new Set<string>(['project_tasks:manage', 'bookings:create']),
  scope: 'team' as string,
  list: null as unknown as PieceTaskList,
  approve: vi.fn(),
  remove: vi.fn(),
  save: vi.fn(async () => ({ outcome: 'saved' as const })),
  upsert: vi.fn(),
  pending: new Map<string, unknown>(),
}))

vi.mock('../../../app/permissions', () => ({ usePermissions: () => ({ can: (k: string) => m.grants.has(k), scope: m.scope }) }))
vi.mock('../../../app/auth-context', () => ({ useAuth: () => ({ session: { user: { id: 'me' } }, claims: { tenantId: 't1' } }) }))
vi.mock('../../../lib/assignment-requests/api', () => ({ usePendingAssignmentRequestsForTasks: () => ({ data: m.pending, refetch: vi.fn() }) }))
vi.mock('../../deliverables/api/deliverables-api', () => ({
  useApproveDeliverableTasks: () => ({ mutate: m.approve, isPending: false }),
  useRemoveSubTask: () => ({ mutate: m.remove, isPending: false }),
  useUpsertSubTask: () => ({ mutate: m.upsert, isPending: false }),
  useReviewers: () => ({ data: [{ id: 'inas', name: 'Inas' }] }),
}))
vi.mock('../../deliverables/api/requirements-api', () => ({ useTaskDependencies: () => ({ data: [], isLoading: false, refetch: vi.fn() }) }))
vi.mock('../../deliverables/api/task-editor-api', () => ({
  usePieceTaskList: () => ({ data: m.list, isLoading: false, refetch: vi.fn() }),
  useAskAnotherTeam: () => ({ mutate: vi.fn() }),
  saveTask: m.save,
}))
vi.mock('../../deliverables/components/TaskEditor', () => ({
  TaskEditorDialog: (p: { taskId: string | null; all: boolean }) => <div data-testid="editor-dialog" data-task={p.taskId ?? ''} data-all={String(p.all)} />,
  WaitsForPicker: () => null,
}))
const ZUBAIDA = { id: 'r-zubaida', name: 'Zubaida Jamil', kind: 'human', userId: 'u-zubaida', jobTitle: 'Junior designer' }
vi.mock('../../schedule/hooks/use-people-week', () => ({
  sundayOfIso: () => '2030-01-06',
  usePeopleWeek: () => ({
    people: [{ resource: ZUBAIDA, freeHours: 40, weekHours: 40, note: { kind: 'none' } }],
    resById: new Map([['r-zubaida', ZUBAIDA]]),
    resByUser: new Map([['u-zubaida', ZUBAIDA]]),
    isWorking: () => true,
    loadOn: () => ({ state: 'free', bookedHours: 0, freeHours: 8, overHours: 0, overload: null }),
    workingCols: () => [0, 1, 2, 3, 4],
    spanFor: () => ({ startsAt: '2026-10-01T06:00:00.000Z', dueAt: '2026-10-01T14:00:00.000Z' }),
    asksOnly: false,
    ready: true,
  }),
}))
vi.mock('../../schedule/api/book-api', () => ({ usePieceWorkflow: () => ({ data: { name: 'Static post', nameAr: null, steps: [] } }) }))
vi.mock('./ChangeAskDialog', () => ({ ChangeAskDialog: () => null }))

import { PieceTasks } from './PieceTasks'

const task = (over: Partial<EditableTask> & { id: string }): EditableTask => ({
  deliverableId: 'd1', title: over.id, notes: '', hours: 2, status: 'todo', assigneeId: null, assigneeName: null,
  startsAt: null, dueAt: null, reviewMode: 'digital', reviewers: [], started: false, fromWorkflow: true,
  departmentId: null, teamId: null, ...over,
})
const piece = (approvedAt: string | null) => ({
  id: 'd1', name: 'Post 2', code: 'DA-003', dueAt: '2026-10-01T15:00:00Z', tasksApprovedAt: approvedAt,
  ownerUserId: 'me', canApproveTasks: true, campaignId: 'c1', campaignName: 'LUMA',
})

const renderList = (markTaskId: string | null = null) =>
  render(<MemoryRouter><PieceTasks deliverableId="d1" markTaskId={markTaskId} onBanner={vi.fn()} testId="pt" /></MemoryRouter>)

beforeEach(() => {
  m.grants = new Set(['project_tasks:manage', 'bookings:create'])
  m.scope = 'team'
  m.approve.mockReset()
  m.remove.mockReset()
  m.save.mockClear()
  m.pending = new Map()
})

describe('before approval — the suggested list (CP-01…CP-03)', () => {
  beforeEach(() => {
    m.list = { piece: piece(null), tasks: [task({ id: 'Develop concept' }), task({ id: 'Motion version', fromWorkflow: false })] }
  })

  it('says Maestro suggested them, marks workflow tasks Suggested and your own Not booked, and offers no Who', () => {
    renderList()
    expect(screen.getByTestId('pt-banner')).toHaveTextContent('Maestro suggested these')
    expect(screen.getByTestId('pt-status-Develop concept')).toHaveTextContent('Suggested')
    expect(screen.getByTestId('pt-status-Motion version')).toHaveTextContent('Not booked')
    expect(screen.queryByTestId('pt-who-Develop concept')).toBeNull()
  })

  it('I74.51: the account manager holds every grant but the server will not let her approve — no Approve', () => {
    m.scope = 'account'
    m.list = { ...m.list, piece: { ...m.list.piece, ownerUserId: 'someone-else', canApproveTasks: false } }
    renderList()
    expect(screen.queryByTestId('pt-approve')).toBeNull()
  })

  it('I74.51: a lead of the department who is not the owner is offered Approve when the server admits her', () => {
    m.scope = 'team'
    m.list = { ...m.list, piece: { ...m.list.piece, ownerUserId: 'someone-else', canApproveTasks: true } }
    renderList()
    expect(screen.getByTestId('pt-approve')).toHaveTextContent('Approve 2 tasks')
  })

  it('approves through the existing approval — "Approve 2 tasks"', () => {
    renderList()
    fireEvent.click(screen.getByTestId('pt-approve'))
    expect(m.approve).toHaveBeenCalledWith('d1', expect.anything())
    expect(screen.getByTestId('pt-approve')).toHaveTextContent('Approve 2 tasks')
  })

  it('removes an unbooked task only once its undo has passed', () => {
    vi.useFakeTimers()
    try {
      renderList()
      fireEvent.click(screen.getByTestId('pt-remove-Develop concept'))
      expect(screen.queryByTestId('pt-row-Develop concept')).toBeNull()
      expect(screen.getByTestId('pt-undo')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('pt-undo-button'))
      expect(screen.getByTestId('pt-row-Develop concept')).toBeInTheDocument()
      expect(m.remove).not.toHaveBeenCalled()
      fireEvent.click(screen.getByTestId('pt-remove-Develop concept'))
      act(() => { vi.advanceTimersByTime(9000) })
      expect(m.remove).toHaveBeenCalledWith('Develop concept', expect.anything())
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('once approved — Who and Dates on every row (CP-04, CP-05, CP-10…CP-12)', () => {
  beforeEach(() => {
    m.list = {
      piece: piece('2026-09-28T09:00:00Z'),
      tasks: [
        task({ id: 't1', title: 'Creative direction', assigneeId: 'u-zubaida', assigneeName: 'Zubaida Jamil', status: 'in_progress', started: true, reviewers: [{ userId: 'inas', name: 'Inas', isMandatory: true, approvedAt: null, respondedAt: null, response: null, isActive: true }] }),
        task({ id: 't2', title: 'Develop concept' }),
        task({ id: 't3', title: 'Create artwork' }),
      ],
    }
  })

  it('gives every row a pencil; a started task shows the lock instead of the ✕', () => {
    renderList('t2')
    for (const id of ['t1', 't2', 't3']) expect(screen.getByTestId(`pt-edit-${id}`)).toBeInTheDocument()
    expect(screen.getByTestId('pt-locked-t1')).toBeInTheDocument()
    expect(screen.queryByTestId('pt-remove-t1')).toBeNull()
    expect(screen.getByTestId('pt-remove-t2')).toBeInTheDocument()
    expect(screen.getByTestId('pt-row-t2')).toHaveAttribute('data-marked', 'true')
    fireEvent.click(screen.getByTestId('pt-edit-t3'))
    expect(screen.getByTestId('editor-dialog')).toHaveAttribute('data-task', 't3')
  })

  it('offers Who and Dates to someone who books, with the status of each row', () => {
    renderList()
    expect(screen.getByTestId('pt-who-t2')).toBeInTheDocument()
    expect(screen.getByTestId('pt-dates-t2')).toBeInTheDocument()
    expect(screen.getByTestId('pt-status-t1')).toHaveTextContent('In progress')
    expect(screen.getByTestId('pt-status-t2')).toHaveTextContent('Not booked')
  })

  it('I74.53: the account manager (every grant, account reach) sees the rows read only — no pencil, no ✕, no hours', () => {
    m.scope = 'account'
    m.list = { ...m.list, piece: { ...m.list.piece, ownerUserId: 'someone-else', canApproveTasks: false } }
    renderList()
    expect(screen.queryByTestId('pt-edit-t2')).toBeNull()
    expect(screen.queryByTestId('pt-remove-t2')).toBeNull()
    expect(screen.queryByTestId('pt-more-t2')).toBeNull()
    // Who and the ticks stay: her pick of a person is an ask to that person's lead (ADR-0139 d.1), not an edit.
    expect(screen.getByTestId('pt-who-t2')).toBeInTheDocument()
  })

  it('a team member (project_tasks:manage, no booking) sees the rows read only — no Who, no pencil, no ticks', () => {
    m.grants = new Set(['project_tasks:manage'])
    m.scope = 'self'
    m.list = { ...m.list, piece: { ...m.list.piece, ownerUserId: 'someone-else' } }
    renderList()
    expect(screen.queryByTestId('pt-who-t2')).toBeNull()
    expect(screen.getByTestId('pt-who-ro-t1')).toHaveTextContent('Zubaida')
    expect(screen.queryByTestId('pt-edit-t2')).toBeNull()
    expect(screen.queryByTestId('pt-select-t2')).toBeNull()
    expect(screen.queryByTestId('pt-save')).toBeNull()
  })

  it('ticks two rows, gives them to one person on one day, asks who checks them, and books each through the one save', async () => {
    renderList()
    fireEvent.click(screen.getByTestId('pt-select-t2'))
    fireEvent.click(screen.getByTestId('pt-select-t3'))
    fireEvent.click(screen.getByTestId('pt-bulk-who'))
    fireEvent.click(screen.getByTestId('pt-bulk-people-r-zubaida'))
    fireEvent.click(screen.getByTestId('pt-bulk-day'))
    fireEvent.click(screen.getByTestId('pt-bulk-day-picker-day-2030-01-08'))
    fireEvent.click(screen.getByTestId('pt-bulk-apply'))
    expect(screen.getByTestId('pt-bulk-line')).toHaveTextContent('4h for Zubaida')
    expect(screen.getByTestId('pt-save')).toBeDisabled()
    fireEvent.change(screen.getByTestId('pt-reviewer'), { target: { value: 'inas' } })
    expect(screen.getByTestId('pt-save')).toHaveTextContent('Book 2 tasks')
    await act(async () => { fireEvent.click(screen.getByTestId('pt-save')) })
    expect(m.save).toHaveBeenCalledTimes(2)
    expect(m.save).toHaveBeenCalledWith(expect.objectContaining({
      subTaskId: 't2',
      draft: expect.objectContaining({ assigneeId: 'u-zubaida', from: '2030-01-08', to: '2030-01-08', reviewers: [{ userId: 'inas', isMandatory: true }] }),
      span: { startsAt: '2026-10-01T06:00:00.000Z', dueAt: '2026-10-01T14:00:00.000Z' },
    }))
  })

  it('asks before moving a started task when the server says so, and resends with the confirmation', async () => {
    m.save.mockImplementationOnce(async () => { throw Object.assign(new Error('started'), { hint: 'task_started', details: 'Zubaida Jamil' }) })
    renderList()
    fireEvent.click(screen.getByTestId('pt-more-t1'))
    await act(async () => { fireEvent.click(screen.getByTestId('pt-save')) })
    expect(screen.getByTestId('pt-started-t1')).toHaveTextContent('Zubaida Jamil has started this.')
    await act(async () => { fireEvent.click(screen.getByTestId('pt-move-anyway-t1')) })
    expect(m.save).toHaveBeenLastCalledWith(expect.objectContaining({ subTaskId: 't1', confirmStarted: true }))
  })
})

describe('an ask that names only a team (ADR-0139, I74 fix-up)', () => {
  it('says which team was asked — "⏳ Copy · asked" and "Asked Copy" — not "Asked another team"', () => {
    m.list = { piece: piece('2026-09-30T10:00:00Z'), tasks: [task({ id: 't1', title: 'Write Copy' })] }
    m.pending = new Map([['t1', { id: 'q1', subTaskId: 't1', resourceName: null, departmentName: 'Content', teamId: 'tm-copy', teamName: 'Copy' }]])
    renderList()
    expect(screen.getByTestId('pt-asked-t1')).toHaveTextContent('⏳ Copy · asked')
    expect(screen.getByTestId('pt-status-t1')).toHaveTextContent('Asked Copy')
  })
})

describe('a failed "Add a task" says why, and offers Report only when something broke (I74.55, ADR-0092 d.3)', () => {
  const addAndFail = (err: unknown) => {
    m.upsert.mockImplementation((_a: unknown, o: { onError: (e: unknown) => void }) => o.onError(err))
    const onBanner = vi.fn()
    render(<MemoryRouter><PieceTasks deliverableId="d1" markTaskId={null} onBanner={onBanner} testId="pt" /></MemoryRouter>)
    fireEvent.click(screen.getByTestId('pt-add'))
    fireEvent.change(screen.getByTestId('pt-add-name'), { target: { value: 'Extra frame' } })
    fireEvent.click(screen.getByTestId('pt-add-save'))
    return onBanner.mock.calls.at(-1)?.[0] as { kind: string; text: string; reportable?: boolean }
  }
  beforeEach(() => {
    m.upsert.mockReset()
    m.list = { piece: piece(null), tasks: [task({ id: 'Develop concept' })] }
  })

  it('a refusal outside her reach says so — no "Try again", no Report', () => {
    const b = addAndFail({ code: '42501', message: 'new row violates row-level security policy for table "sub_tasks"' })
    expect(b.kind).toBe('error')
    expect(b.text).toMatch(/outside your reach/i)
    expect(b.text).not.toMatch(/try again/i)
    expect(b.reportable).toBe(false)
  })

  it('an unexpected failure offers Report, with its cause', () => {
    const b = addAndFail({ code: 'XX000', message: 'boom' })
    expect(b.kind).toBe('error')
    expect(b.reportable).toBe(true)
  })
})
