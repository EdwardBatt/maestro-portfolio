import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../../../lib/i18n'
import type { EditablePiece, EditableTask } from '../api/task-editor-api'

/**
 * ADR-0140 d.1–d.4 (I74.7–I74.9): the one task editor. What it must hold:
 *  - every detail is in the one form (name, notes, hours, person, days, waits for, reviewers, review);
 *  - a started task's person or days move only after "move it anyway?", and the resend carries the confirmation;
 *  - "Keep" leaves the person and the days, and still saves the rest;
 *  - before the list is approved, Who and Dates are not offered;
 *  - another team's days come back as a request, said in place.
 */
const m = vi.hoisted(() => ({
  save: vi.fn(async () => ({ outcome: 'saved' as 'saved' | 'requested' })),
  grants: new Set<string>(['bookings:create']),
}))
vi.mock('../api/task-editor-api', () => ({
  saveTask: m.save,
  useAskAnotherTeam: () => ({ mutate: vi.fn() }),
  usePieceTaskList: () => ({ data: null, isLoading: true }),
}))
vi.mock('../api/deliverables-api', () => ({ useReviewers: () => ({ data: [{ id: 'inas', name: 'Inas' }, { id: 'fadia', name: 'Fadia' }] }) }))
vi.mock('../api/requirements-api', () => ({ useTaskDependencies: () => ({ data: [], isLoading: false }) }))
vi.mock('../../../lib/assignment-requests/api', () => ({ usePendingAssignmentRequestsForTasks: () => ({ data: new Map() }) }))
vi.mock('../../../app/auth-context', () => ({ useAuth: () => ({ claims: { tenantId: 't1' }, session: { user: { id: 'me' } } }) }))
vi.mock('../../../app/permissions', () => ({ usePermissions: () => ({ can: (k: string) => m.grants.has(k), scope: 'team' }) }))
const ZUBAIDA = { id: 'r-zubaida', name: 'Zubaida Jamil', kind: 'human', userId: 'u-zubaida', jobTitle: 'Junior designer' }
vi.mock('../../schedule/hooks/use-people-week', () => ({
  sundayOfIso: () => '2030-01-06',
  usePeopleWeek: () => ({
    people: [{ resource: ZUBAIDA, freeHours: 31, weekHours: 40, note: { kind: 'none' } }],
    resById: new Map([['r-zubaida', ZUBAIDA]]),
    resByUser: new Map([['u-zubaida', ZUBAIDA]]),
    isWorking: () => true,
    loadOn: () => ({ state: 'free', bookedHours: 0, freeHours: 8, overHours: 0, overload: null }),
    workingCols: () => [0, 1, 2, 3, 4],
    spanFor: () => ({ startsAt: '2030-01-10T06:00:00.000Z', dueAt: '2030-01-10T15:00:00.000Z' }),
    asksOnly: false,
    ready: true,
  }),
}))

import { TaskEditorForm } from './TaskEditor'

const piece = (approved = true): EditablePiece => ({
  id: 'd1', name: 'Post 2', code: null, dueAt: '2030-01-16T15:00:00Z', tasksApprovedAt: approved ? '2030-01-01T09:00:00Z' : null,
  ownerUserId: 'me', canApproveTasks: true, campaignId: 'c1', campaignName: 'LUMA',
})
const task = (over: Partial<EditableTask> = {}): EditableTask => ({
  id: 't2', deliverableId: 'd1', title: 'Create artwork', notes: '', hours: 6, status: 'in_progress',
  assigneeId: 'u-zubaida', assigneeName: 'Zubaida Jamil', startsAt: '2030-01-08T06:00:00Z', dueAt: '2030-01-08T15:00:00Z',
  reviewMode: 'digital', reviewers: [{ userId: 'inas', name: 'Inas', isMandatory: true, approvedAt: null, respondedAt: null, response: null, isActive: true }],
  started: true, fromWorkflow: true, departmentId: null, teamId: null, ...over,
})
const sibling: EditableTask = { ...task(), id: 't1', title: 'Develop concept', started: false, status: 'done' }

const renderForm = (t: EditableTask, p: EditablePiece = piece()) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TaskEditorForm task={t} piece={p} siblings={[sibling, t]} edges={[]} mayBook={m.grants.has('bookings:create')} testId="te" />
    </QueryClientProvider>,
  )

beforeEach(() => {
  m.save.mockClear()
  m.grants = new Set(['bookings:create'])
})

describe('TaskEditorForm', () => {
  it('carries every detail: name, notes, hours, who, dates, waits for, reviewers and review', () => {
    renderForm(task({ started: false, status: 'todo' }))
    for (const id of ['te-title', 'te-notes', 'te-hours', 'te-who', 'te-dates', 'te-waits', 'te-reviewer', 'te-review-digital']) {
      expect(screen.getByTestId(id)).toBeInTheDocument()
    }
    expect(screen.getByTestId('te-who')).toHaveTextContent('Zubaida Jamil')
    expect(screen.getByTestId('te-waits-t1')).toHaveTextContent('Develop concept')
  })

  it('asks before moving a started task, then resends with the confirmation', async () => {
    renderForm(task())
    fireEvent.click(screen.getByTestId('te-dates'))
    fireEvent.click(screen.getByTestId('te-dates-picker-day-2030-01-10'))
    fireEvent.click(screen.getByTestId('te-dates-picker-day-2030-01-10'))
    expect(screen.getByTestId('te-started')).toHaveTextContent('Zubaida Jamil has started this.')
    expect(screen.queryByTestId('te-save')).toBeNull()
    await act(async () => { fireEvent.click(screen.getByTestId('te-move-anyway')) })
    expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ subTaskId: 't2', confirmStarted: true, draft: expect.objectContaining({ from: '2030-01-10', to: '2030-01-10' }) }))
  })

  it('"Keep" leaves the days and still saves the rest', async () => {
    renderForm(task())
    fireEvent.change(screen.getByTestId('te-notes'), { target: { value: 'Arabic leads' } })
    fireEvent.click(screen.getByTestId('te-dates'))
    fireEvent.click(screen.getByTestId('te-dates-picker-day-2030-01-10'))
    await act(async () => { fireEvent.click(screen.getByTestId('te-keep')) })
    expect(m.save).toHaveBeenCalledWith(expect.objectContaining({
      confirmStarted: false,
      draft: expect.objectContaining({ from: '2030-01-08', to: '2030-01-08', notes: 'Arabic leads' }),
    }))
  })

  it('says a request in place when the days went to another team', async () => {
    m.save.mockResolvedValueOnce({ outcome: 'requested' })
    renderForm(task({ started: false, status: 'todo' }))
    fireEvent.click(screen.getByTestId('te-more'))
    await act(async () => { fireEvent.click(screen.getByTestId('te-save')) })
    expect(screen.getByTestId('te-note')).toHaveTextContent('Sent to their team lead as an ask')
  })

  it('offers no Who before the task list is approved', () => {
    renderForm(task({ assigneeId: null, assigneeName: null, started: false, status: 'todo' }), piece(false))
    expect(screen.queryByTestId('te-who')).toBeNull()
    expect(screen.getByTestId('te-who-fixed')).toHaveTextContent('Picked once the task list is approved')
  })

  it('says a started task cannot be removed', () => {
    renderForm(task())
    expect(screen.getByTestId('te-no-remove')).toBeInTheDocument()
  })
  // Test script step 14 (4 Oct): the form opened on a stale read of a BOOKED task (nobody, no days, no hours); the
  // fresh read landed while it was open; Save then took the person off and the hours change was lost.
  it('never sends a change the user did not make when the task is read again while open', async () => {
    const stale = task({ assigneeId: null, assigneeName: null, startsAt: null, dueAt: null, hours: null, started: false, status: 'todo' })
    const booked = task({ hours: 2, started: false, status: 'todo' })
    const qc = new QueryClient()
    const view = (t: EditableTask) => (
      <QueryClientProvider client={qc}>
        <TaskEditorForm task={t} piece={piece()} siblings={[sibling, t]} edges={[]} mayBook testId="te" />
      </QueryClientProvider>
    )
    const r = render(view(stale))
    r.rerender(view(booked))
    expect(screen.getByTestId('te-who')).toHaveTextContent('Zubaida Jamil')
    fireEvent.click(screen.getByTestId('te-more'))
    fireEvent.click(screen.getByTestId('te-more'))
    await act(async () => { fireEvent.click(screen.getByTestId('te-save')) })
    const sent = (m.save.mock.calls[0] as unknown as [{ before: { assigneeId: string | null; hours: number | null }; draft: { assigneeId: string | null; hours: number | null } }])[0]
    expect(sent.before).toMatchObject({ assigneeId: 'u-zubaida', hours: 2 })
    expect(sent.draft).toMatchObject({ assigneeId: 'u-zubaida', hours: 4 })
  })

  it('keeps the user’s own edit when the task is read again while open', () => {
    const qc = new QueryClient()
    const view = (t: EditableTask) => (
      <QueryClientProvider client={qc}>
        <TaskEditorForm task={t} piece={piece()} siblings={[sibling, t]} edges={[]} mayBook testId="te" />
      </QueryClientProvider>
    )
    const r = render(view(task({ started: false, status: 'todo' })))
    fireEvent.change(screen.getByTestId('te-notes'), { target: { value: 'Arabic leads' } })
    r.rerender(view(task({ started: false, status: 'todo', title: 'Create artwork v2' })))
    expect(screen.getByTestId('te-notes')).toHaveValue('Arabic leads')
    expect(screen.getByTestId('te-title')).toHaveValue('Create artwork v2')
  })
})
