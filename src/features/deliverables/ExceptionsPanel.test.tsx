import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../../lib/i18n'
import type { AssignedWorkItem, AwaitingReviewItem } from './api/deliverables-api'
import type { PendingApproval } from './api/pending-approvals-api'

/**
 * The exceptions strip on My Work, and specifically the split ADR-0043 d.8 requires.
 *
 * "In review" used to be ONE number, adding work I submitted and am waiting on to work waiting on
 * ME to review. Those are opposite problems — one is waiting on somebody else, one is waiting on me
 * — and a reviewer holding up three mandatory sign-offs should see that as its own figure rather
 * than folded into a total they cannot act on.
 *
 * The api reaches `lib/env`, which throws when the VITE_ vars are absent (they are, in CI), so it
 * is mocked — traps.md.
 */

const state = vi.hoisted(() => ({
  work: [] as AssignedWorkItem[],
  awaiting: [] as AwaitingReviewItem[],
  approvals: [] as PendingApproval[],
  drafts: [] as string[],
  grants: new Set<string>(),
}))

vi.mock('./api/deliverables-api', () => ({
  useMyAssignedWork: () => ({ data: state.work }),
  useAwaitingMyReview: () => ({ data: state.awaiting }),
}))

vi.mock('./api/pending-approvals-api', () => ({
  usePendingApprovals: () => ({ data: state.approvals }),
}))

vi.mock('../campaigns/api/campaign-api', () => ({
  useMyDrafts: (id: string | null) => ({ data: id ? state.drafts : undefined }),
}))

vi.mock('../../app/permissions', () => ({
  usePermissions: () => ({ can: (k: string) => state.grants.has(k) }),
}))

vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'me' } } }),
}))

import { ExceptionsPanel } from './ExceptionsPanel'

const task = (over: Partial<AssignedWorkItem> & { subTaskId: string }): AssignedWorkItem => ({
  title: 'Retouch',
  status: 'todo',
  priority: null,
  slaHours: null,
  startsAt: null,
  dueAt: null,
  committedDueAt: null,
  scheduleOverridden: false,
  deliverableId: 'd1',
  deliverableName: 'KV',
  deliverableState: 'in_progress',
  deliverableDueAt: null,
  revisionRound: 0,
  campaignId: 'c1',
  campaignName: 'Spring',
  goLiveAt: null,
  discipline: null,
  isAdhoc: false,
  assignerName: 'Nadia',
  reviewers: [],
  reviewMode: 'digital',
  ...over,
})

const inbox = (subTaskId: string): AwaitingReviewItem => ({
  subTaskId,
  title: 'Someone else’s work',
  dueAt: null,
  reviewMode: 'digital',
  assigneeName: 'Sam',
  deliverableId: 'd9',
  deliverableName: 'Film',
  deliverableState: 'in_review',
  mineIsMandatory: true,
  reviewers: [],
})

describe('ExceptionsPanel (ADR-0043 d.8)', () => {
  beforeEach(() => {
    state.work = []
    state.awaiting = []
    state.approvals = []
    state.drafts = []
    state.grants = new Set()
  })

  it('counts work I submitted separately from work waiting on me to review', () => {
    state.work = [task({ subTaskId: 's1', status: 'review' }), task({ subTaskId: 's2', status: 'todo' })]
    state.awaiting = [inbox('x1'), inbox('x2'), inbox('x3')]
    render(<ExceptionsPanel />)
    // Previously these were added together and reported as a single "4".
    expect(screen.getByTestId('exception-inReview')).toHaveTextContent('1')
    expect(screen.getByTestId('exception-toReview')).toHaveTextContent('3')
  })

  it('shows a reviewer with nothing of their own that they are still holding work up', () => {
    state.work = []
    state.awaiting = [inbox('x1'), inbox('x2')]
    render(<ExceptionsPanel />)
    expect(screen.getByTestId('exception-inReview')).toHaveTextContent('0')
    expect(screen.getByTestId('exception-toReview')).toHaveTextContent('2')
  })

  it('still counts the rest of the strip over OPEN work only', () => {
    state.work = [
      task({ subTaskId: 's1', status: 'todo' }),
      task({ subTaskId: 's2', status: 'done' }),
    ]
    render(<ExceptionsPanel />)
    expect(screen.getByTestId('exception-assigned')).toHaveTextContent('1')
    expect(screen.getByTestId('exception-notStarted')).toHaveTextContent('1')
  })
})

const approval = (kind: PendingApproval['kind'], id: string): PendingApproval => ({
  kind, id, title: id, campaignId: 'c1', campaignName: 'Spring', department: null, since: null, targetId: id, deliverableId: null,
})

describe('ExceptionsPanel — the approval exceptions (I66.2)', () => {
  beforeEach(() => {
    state.work = []
    state.awaiting = []
    state.approvals = []
    state.drafts = []
    state.grants = new Set()
  })

  it('counts only what waits on me: my drafts, the briefs and the task lists I may approve', () => {
    state.grants = new Set(['projects:manage'])
    state.drafts = ['c7', 'c8']
    state.approvals = [
      approval('campaign', 'c1'),
      approval('task_list', 'd1'), approval('task_list', 'd2'), approval('task_list', 'd3'),
      approval('booking_request', 'q1'),
    ]
    render(<ExceptionsPanel />)
    expect(screen.getByTestId('exception-unfinishedBriefs')).toHaveTextContent('2')
    expect(screen.getByTestId('exception-briefsAwaiting')).toHaveTextContent('1')
    expect(screen.getByTestId('exception-taskListsNotApproved')).toHaveTextContent('3')
  })

  it('leaves the brief figures off for someone who cannot raise work, and keeps the task lists', () => {
    state.approvals = [approval('task_list', 'd1')]
    render(<ExceptionsPanel />)
    expect(screen.queryByTestId('exception-unfinishedBriefs')).toBeNull()
    expect(screen.queryByTestId('exception-briefsAwaiting')).toBeNull()
    expect(screen.getByTestId('exception-taskListsNotApproved')).toHaveTextContent('1')
  })
})
