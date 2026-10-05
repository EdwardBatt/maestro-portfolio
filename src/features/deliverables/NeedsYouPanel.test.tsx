import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import '../../lib/i18n'
import type { AssignedWorkItem, AwaitingReviewItem } from './api/deliverables-api'
import type { UnassignedPiece } from './lib/needs-you'

/**
 * "Needs you" (ADR-0105 d.2, I59.10) — the new sources (Assign, Changes came back, New on you), the
 * grouping on screen, Later marking the task seen on the server, and a failing source said rather
 * than swallowed. The
 * approvals and the review cards keep their own suites (NeedsYouPanel.approvals / .reviews).
 */

const state = vi.hoisted(() => ({
  work: [] as AssignedWorkItem[],
  reviews: [] as AwaitingReviewItem[],
  pieces: [] as UnassignedPiece[],
  piecesError: null as Error | null,
  seenMutate: vi.fn(),
}))

vi.mock('./api/deliverables-api', () => ({
  useAwaitingMyReview: () => ({ data: state.reviews, isLoading: false, isError: false }),
  useMyAssignedWork: () => ({ data: state.work, isLoading: false }),
  useMarkTaskSeen: () => ({ mutate: state.seenMutate, isPending: false }),
}))
vi.mock('./api/pending-approvals-api', () => ({
  usePendingApprovals: () => ({ data: [], isLoading: false, isError: false }),
  pendingApprovalLink: () => null,
}))
vi.mock('./api/needs-you-api', () => ({
  useUnassignedPiecesIOwn: () => ({ data: state.pieces, isLoading: false, isError: !!state.piecesError, error: state.piecesError }),
}))
vi.mock('./api/needs-you-sources-api', () => {
  const none = { data: undefined, isError: false, error: null }
  return {
    useNeedsYouSources: () => ({
      rules: none, sentAt: none, cameBack: none, blocks: none, extensions: none, changes: none,
      messages: none, overload: none, escalations: none, client: none, scope: none, changeAsks: none,
    }),
  }
})
vi.mock('./api/requests-api', () => ({
  useCloseChangeRequest: () => ({ mutate: vi.fn(), isPending: false }),
  useAnswerTooMuch: () => ({ mutate: vi.fn(), isPending: false }),
  useSayTooMuch: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('../team/api/team-api', () => ({ useMyLoad: () => ({ data: null, isLoading: false, isError: false }) }))
vi.mock('./components/ReviewerModal', () => ({
  ReviewerModal: ({ item }: { item: AwaitingReviewItem }) => <div data-testid={`reviewer-modal-stub-${item.subTaskId}`} />,
}))
vi.mock('../notifications/AssignmentRequestActions', () => ({ AssignmentRequestActions: () => null }))
vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }))

import { NeedsYouPanel } from './NeedsYouPanel'

const day = (n: number) => new Date(new Date().setHours(12, 0, 0, 0) + n * 86_400_000).toISOString()

const task = (o: Partial<AssignedWorkItem> & { subTaskId: string }): AssignedWorkItem => ({
  title: 'Draw Night 1 opener',
  status: 'todo',
  priority: null,
  slaHours: 8,
  startsAt: null,
  dueAt: day(3),
  committedDueAt: null,
  scheduleOverridden: false,
  deliverableId: 'del0',
  deliverableName: 'Opener',
  deliverableState: 'in_progress',
  deliverableDueAt: null,
  revisionRound: 0,
  campaignId: 'cam1',
  campaignName: 'LUMA',
  goLiveAt: null,
  discipline: 'Motion',
  isAdhoc: false,
  assignerName: 'Fadia',
  reviewers: [],
  reviewMode: 'digital',
  assignedAt: null,
  revisionLimit: 2,
  ...o,
})

const piece = (o: Partial<UnassignedPiece> = {}): UnassignedPiece => ({
  deliverableId: 'd1',
  name: 'Post 2',
  campaignId: 'cam1',
  campaignName: 'LUMA',
  departmentId: 'dep1',
  department: 'Creative',
  unassignedCount: 2,
  since: day(-1),
  dueAt: day(2),
  ...o,
})

const renderPanel = () => render(<MemoryRouter><NeedsYouPanel /></MemoryRouter>)

beforeEach(() => {
  state.work = []
  state.reviews = []
  state.pieces = []
  state.piecesError = null
  state.seenMutate = vi.fn()
})

describe('Needs you — the owner\'s Assign (Q3)', () => {
  it('offers Assign on a piece I own with tasks nobody has, opening the Schedule filtered', () => {
    state.pieces = [piece()]
    renderPanel()
    const card = screen.getByTestId('needs-you-assign-d1')
    expect(within(card).getByTestId('needs-you-kind-d1')).toHaveTextContent('Assign')
    expect(card).toHaveTextContent('Post 2')
    expect(card).toHaveTextContent('LUMA · Creative')
    expect(screen.getByTestId('needs-you-assign-count-d1')).toHaveTextContent('2 tasks have nobody on them')
    expect(screen.getByTestId('needs-you-open-assign-d1')).toHaveAttribute('href', '/schedule?campaign=cam1&dept=dep1')
  })
})

describe('Needs you — the maker\'s items (Q38)', () => {
  it('says "changes came back" on a sent-back task, with its round of the limit, opening the task page', () => {
    state.work = [task({ subTaskId: 'cb', revisionRound: 1 })]
    renderPanel()
    expect(screen.getByTestId('needs-you-kind-cb')).toHaveTextContent('Changes came back')
    expect(screen.getByTestId('needs-you-changes-round-cb')).toHaveTextContent('Round 1 of 2')
    expect(screen.getByTestId('needs-you-open-changes_back-cb')).toHaveAttribute('href', '/my-work/task/cb')
  })

  it('does not list work that is finished, or with somebody else', () => {
    state.work = [
      task({ subTaskId: 'done', status: 'done', revisionRound: 1 }),
      task({ subTaskId: 'rev', status: 'review', revisionRound: 1 }),
    ]
    renderPanel()
    expect(screen.queryByTestId('needs-you-panel')).not.toBeInTheDocument()
  })

  it('says "new on you" for work given within a day — Open and Too much, no Later (Edward, 26 Sep)', () => {
    state.work = [task({ subTaskId: 'nw', assignedAt: new Date(Date.now() - 3_600_000).toISOString() })]
    const { unmount } = renderPanel()
    expect(screen.getByTestId('needs-you-kind-nw')).toHaveTextContent('New on you')
    expect(screen.getByTestId('needs-you-open-new_on_you-nw')).toHaveAttribute('href', '/my-work/task/nw')
    // Open · Too much; Too much opens the maker's dialog. No Later button.
    fireEvent.click(screen.getByTestId('needs-you-too-much-nw'))
    expect(screen.getByTestId('ny-too-much-dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('ny-too-much-cancel'))
    expect(screen.queryByTestId('needs-you-later-nw')).not.toBeInTheDocument()
    unmount()
    // Opened (seen on the server) — gone on the next visit, on any device.
    state.work = [task({ subTaskId: 'nw', assignedAt: new Date(Date.now() - 3_600_000).toISOString(), seenAt: new Date().toISOString() })]
    renderPanel()
    expect(screen.queryByTestId('needs-you-new_on_you-nw')).not.toBeInTheDocument()
  })

  it("does not read the browser's storage at all — seen is the server's", () => {
    const getItem = vi.fn(() => JSON.stringify(['nw2']))
    vi.stubGlobal('localStorage', { getItem, setItem: vi.fn() })
    state.work = [task({ subTaskId: 'nw2', assignedAt: new Date(Date.now() - 3_600_000).toISOString() })]
    renderPanel()
    expect(screen.getByTestId('needs-you-new_on_you-nw2')).toBeInTheDocument()
    expect(getItem).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe('Needs you — the groups on screen (D1)', () => {
  it('groups by the clock, most urgent first, and counts everything', () => {
    state.pieces = [piece({ deliverableId: 'later', dueAt: day(4) }), piece({ deliverableId: 'late', dueAt: day(-2) })]
    state.work = [task({ subTaskId: 'cb', revisionRound: 1, dueAt: day(0) })]
    state.reviews = [{
      subTaskId: 'rv', title: 'Create', dueAt: null, assigneeName: 'Lujain', deliverableId: 'd9', deliverableName: 'Eid banner set',
      deliverableState: 'in_progress', mineIsMandatory: true, reviewers: [], reviewMode: 'digital',
    }]
    renderPanel()
    expect(screen.getByTestId('needs-you-panel')).toHaveTextContent('Needs you (4)')
    const today = screen.getByTestId('needs-you-group-today')
    expect(within(today).getAllByRole('listitem').map((li) => li.getAttribute('data-testid')))
      .toEqual(['needs-you-assign-late', 'needs-you-changes_back-cb'])
    expect(within(today).getByText('Today or it slips')).toBeInTheDocument()
    expect(within(screen.getByTestId('needs-you-group-week')).getByTestId('needs-you-assign-later')).toBeInTheDocument()
    expect(within(screen.getByTestId('needs-you-group-quiet')).getByTestId('awaiting-review-item-rv')).toBeInTheDocument()
    // The groups read in order: today, this week, quietly.
    const groups = screen.getAllByTestId(/^needs-you-group-/).map((g) => g.getAttribute('data-testid'))
    expect(groups).toEqual(['needs-you-group-today', 'needs-you-group-week', 'needs-you-group-quiet'])
  })

  it('opens the review modal from a Review card', () => {
    state.reviews = [{
      subTaskId: 'rv', title: 'Create', dueAt: null, assigneeName: 'Lujain', deliverableId: 'd9', deliverableName: 'Eid banner set',
      deliverableState: 'in_progress', mineIsMandatory: false, reviewers: [], reviewMode: 'digital',
    }]
    renderPanel()
    fireEvent.click(screen.getByTestId('awaiting-review-open-rv'))
    expect(screen.getByTestId('reviewer-modal-stub-rv')).toBeInTheDocument()
  })

  it('says when a source failed, rather than a blank that reads as "nothing is waiting"', () => {
    state.piecesError = new Error('permission denied')
    renderPanel()
    expect(screen.getByTestId('needs-you-assign-load-error')).toHaveTextContent('permission denied')
  })

  it('renders nothing when nothing needs me', () => {
    renderPanel()
    expect(screen.queryByTestId('needs-you-panel')).not.toBeInTheDocument()
  })
})
