import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import '../../lib/i18n'

/**
 * I66.6 — the list the Dashboard's "Task lists not approved" opens: the same rows the card counted, over the
 * viewer's reach, oldest first, each naming who it waits on. The data hooks are mocked (they reach lib/env).
 */
const todo = { id: 't', status: 'todo' as const, assigneeId: null, committedStartsAt: null, committedDueAt: null, hours: null, submittedAt: null, reviewerIds: [] }
const piece = (id: string, owner: string, over = {}) => ({
  id, name: `Piece ${id}`, campaignId: 'c1', state: 'in_progress', dueAt: null, taskListApprovedAt: null, ownerId: owner,
  reviewerId: null, workstreamOwnerId: null, outstandingInputs: 0, tasks: [todo], ...over,
})
const NOW = Date.now()

vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ session: { user: { id: 'fadia' } } }) }))
vi.mock('../dashboard/api/dashboard-data', () => ({
  useApprovalReach: () => ({ reach: { kind: 'people', ids: new Set(['fadia', 'omar']) }, isLoading: false }),
  useBriefRows: () => ({ data: [] }),
  usePeopleNames: () => ({ data: new Map([['omar', 'Osama Bakri'], ['nour', 'Noor Kanaan']]) }),
  useCompanyWork: () => ({
    campaigns: [{ id: 'c1', name: 'Mall Anniversary', clientName: 'Mall', goLiveAt: null, status: 'approved', accountManagerId: 'inas' }],
    pieces: [
      piece('a', 'omar'),
      piece('b', 'fadia'),
      piece('c', 'nour'), // outside the reach
      piece('d', 'omar', { taskListApprovedAt: '2026-09-20T00:00:00Z' }), // approved
      piece('e', 'omar', { tasks: [] }), // no tasks — asks for tasks, not counted (I66.3)
    ],
    isLoading: false,
    isError: false,
  }),
  useTaskListWaiting: () => ({
    data: new Map([['a', new Date(NOW - 3 * 3600_000).toISOString()], ['b', new Date(NOW - 50 * 3600_000).toISOString()]]),
    isLoading: false,
    isError: false,
    dataUpdatedAt: NOW,
  }),
}))

import { TaskListsWaitingPage } from './TaskListsWaitingPage'

describe('TaskListsWaitingPage (I66.6)', () => {
  it('lists what the card counted, the longest-waiting first, naming who each waits on', () => {
    render(<MemoryRouter><TaskListsWaitingPage /></MemoryRouter>)
    const rows = within(screen.getByTestId('task-lists-waiting-table')).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual(['task-list-waiting-row-b', 'task-list-waiting-row-a'])
    expect(screen.getByTestId('task-list-waiting-owner-b')).toHaveTextContent('you')
    expect(screen.getByTestId('task-list-waiting-owner-a')).toHaveTextContent('Osama Bakri')
    expect(rows[0]).toHaveTextContent('2 days')
    expect(rows[1]).toHaveTextContent('3 hours')
    expect(screen.getByTestId('task-list-waiting-open-a')).toHaveAttribute('href', '/campaigns/c1?piece=a')
    expect(screen.getByTestId('task-lists-waiting-count')).toHaveTextContent('2 task lists waiting')
  })
})
