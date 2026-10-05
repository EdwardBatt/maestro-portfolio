import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import '../../lib/i18n'
import type { PendingApproval } from './api/pending-approvals-api'

/**
 * The approvals in "Needs you" (I59.10) — moved here from WaitingForYouPanel.test.tsx when that
 * panel folded into Needs you; every assertion is kept. I53.16 — "Waiting for you". The list is the
 * database's; this proves the panel shows what
 * arrives, names the kind, links each row to where it is answered, answers a booking request in
 * place, and disappears when nothing is waiting — without swallowing a real error.
 */
const state = vi.hoisted(() => ({
  rows: [] as PendingApproval[],
  isLoading: false,
  error: null as Error | null,
}))

vi.mock('./api/pending-approvals-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api/pending-approvals-api')>()
  return {
    ...actual,
    usePendingApprovals: () => ({ data: state.rows, isLoading: state.isLoading, isError: !!state.error, error: state.error }),
  }
})
// Needs you's other sources, empty here: this file is about the approvals.
vi.mock('./api/deliverables-api', () => ({
  useAwaitingMyReview: () => ({ data: [], isLoading: false, isError: false }),
  useMyAssignedWork: () => ({ data: [], isLoading: false }),
  useMarkTaskSeen: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('./api/needs-you-api', () => ({
  useUnassignedPiecesIOwn: () => ({ data: [], isLoading: false, isError: false }),
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
}))
vi.mock('./components/ReviewerModal', () => ({ ReviewerModal: () => null }))
vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }))

// The booking request's Approve / Refuse is the inbox's own component (ADR-0087 d.11); it reaches
// the database on its own and is proven in its own test.
vi.mock('../notifications/AssignmentRequestActions', () => ({
  AssignmentRequestActions: ({ subTaskId }: { subTaskId: string }) => <div data-testid={`request-actions-${subTaskId}`} />,
}))

import { NeedsYouPanel } from './NeedsYouPanel'

const mk = (o: Partial<PendingApproval> & { kind: PendingApproval['kind']; id: string }): PendingApproval => ({
  title: 'Ramadan 2027',
  campaignId: 'c1',
  campaignName: null,
  department: 'Creative',
  since: '2026-09-20T09:00:00Z',
  targetId: 'target',
  deliverableId: null,
  ...o,
})

const renderPanel = () => render(<MemoryRouter><NeedsYouPanel /></MemoryRouter>)

describe('Needs you — approvals (I53.16, I59.10)', () => {
  beforeEach(() => {
    state.rows = []
    state.isLoading = false
    state.error = null
  })

  it('renders nothing when nothing is waiting', () => {
    renderPanel()
    expect(screen.queryByTestId('needs-you-panel')).not.toBeInTheDocument()
  })

  it('shows a real error rather than an empty space', () => {
    state.error = new Error('permission denied')
    renderPanel()
    expect(screen.getByTestId('waiting-for-you-load-error')).toHaveTextContent('permission denied')
  })

  it('lists each approval with its kind, its context, and a way to the place it is answered', () => {
    state.rows = [
      mk({ kind: 'department_brief', id: 'b1', targetId: 'dept1' }),
      mk({ kind: 'task_list', id: 'd1', title: 'Teaser statics x3', campaignName: 'Teaser statics', targetId: 'd1', deliverableId: 'd1' }),
      mk({ kind: 'extension_request', id: 'x1', title: 'Create Artwork', campaignName: 'Teaser statics', targetId: 't1', deliverableId: 'd1' }),
      mk({ kind: 'campaign', id: 'c2', title: 'Harbour rebrand', campaignId: 'c2', department: null, targetId: 'c2' }),
    ]
    renderPanel()
    expect(screen.getByTestId('needs-you-panel')).toHaveTextContent('Needs you (4)')
    // The RPC gives an approval no clock yet (I59.24 brings one): every approval sits in "Quietly".
    for (const id of ['department_brief-b1', 'task_list-d1', 'extension_request-x1', 'campaign-c2']) {
      expect(screen.getByTestId(`waiting-for-you-${id}`)).toHaveAttribute('data-group', 'quiet')
    }
    // The waiting time, as the old row said it.
    expect(screen.getByTestId('waiting-for-you-department_brief-b1')).toHaveTextContent(/since/)

    const brief = screen.getByTestId('waiting-for-you-department_brief-b1')
    expect(within(brief).getByTestId('waiting-for-you-kind-b1')).toHaveTextContent('Department brief')
    expect(brief).toHaveTextContent('Ramadan 2027')
    expect(brief).toHaveTextContent('Creative')
    // I53.22: on the department's own tab.
    expect(within(brief).getByTestId('waiting-for-you-open-b1')).toHaveAttribute('href', '/campaigns/c1?tab=dept1')

    expect(within(screen.getByTestId('waiting-for-you-task_list-d1')).getByTestId('waiting-for-you-open-d1'))
      .toHaveAttribute('href', '/campaigns/c1?piece=d1')   // ADR-0132 d.8
    expect(within(screen.getByTestId('waiting-for-you-extension_request-x1')).getByTestId('waiting-for-you-open-x1'))
      .toHaveAttribute('href', '/campaigns/c1?piece=d1&task=t1')
    expect(within(screen.getByTestId('waiting-for-you-campaign-c2')).getByTestId('waiting-for-you-open-c2'))
      .toHaveAttribute('href', '/campaigns/c2')
  })

  it('says an UNWRITTEN brief as the thing to do, and opens the department tab (I53.22)', () => {
    state.rows = [mk({ kind: 'department_brief_unwritten', id: 'c3', title: 'LUMA Season 2', campaignId: 'c3', campaignName: null, department: 'Creative', targetId: 'dept1' })]
    renderPanel()
    const row = screen.getByTestId('waiting-for-you-department_brief_unwritten-c3')
    expect(within(row).getByTestId('waiting-for-you-kind-c3')).toHaveTextContent('Brief to write')
    expect(row).toHaveTextContent("Write Creative's brief for LUMA Season 2")
    expect(within(row).getByTestId('waiting-for-you-open-c3')).toHaveAttribute('href', '/campaigns/c3?tab=dept1')
  })

  // I74.26 (ADR-0139): an ask from another team has its own card on top of My work (AsksFromOtherTeams), with the
  // time left to answer — so Needs you no longer lists it, and nothing is said twice.
  it('leaves an ask from another team to its own card on top of My work', () => {
    state.rows = [mk({ kind: 'booking_request', id: 'q1', title: 'Create Artwork', targetId: 't9', deliverableId: 'd1' })]
    renderPanel()
    expect(screen.queryByTestId('waiting-for-you-booking_request-q1')).not.toBeInTheDocument()
  })
})
