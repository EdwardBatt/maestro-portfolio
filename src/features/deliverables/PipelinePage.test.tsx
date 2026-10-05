import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import '../../lib/i18n'
import type { DeliverableRow } from './api/deliverables-api'

/**
 * PipelinePage (ADR-0024, I2.4). api module reaches lib/env (throws in CI) → mocked; the board
 * reshaping stays real (pure), so the test proves swimlanes/columns and deep links are built from
 * the campaign's deliverables.
 */

const state = vi.hoisted(() => ({
  campaigns: [{ id: 'cam1', name: 'Spring Launch' }],
  rows: [] as DeliverableRow[],
  isLoading: false,
  isError: false,
}))

vi.mock('./api/deliverables-api', () => ({
  useCampaignOptions: () => ({ data: state.campaigns, isLoading: false, isError: false }),
  useCampaignDeliverables: () => ({ data: state.rows, isLoading: state.isLoading, isError: state.isError }),
  // ADR-0096 d.12: phases off on every fixture here; the filter is offered only when there are some.
  useCampaignPhaseOptions: () => ({ data: [], isLoading: false, isError: false }),
}))

import { PipelinePage } from './PipelinePage'

const mk = (o: Partial<DeliverableRow> & { id: string }): DeliverableRow => ({
  name: o.id,
  state: 'draft',
  dueAt: null,
  revisionRound: 0,
  ownerUserId: null,
  ownerName: null,
  typeName: null,
  taskCount: 0,
  unassignedCount: 0,
  revisionLimit: null,
  streamId: 's1',
  workstreamId: null,
  streamName: 'Art',
  discipline: 'Creative',
  departmentId: null,
  campaignId: 'cam1',
  approvedVersion: null,
  // I40.22: where the work actually is, derived from the tasks. Fixtures here carry no tasks.
  progress: { phase: 'no_tasks', total: 0, unassigned: 0, done: 0, everTotal: 0, inReview: 0, inProgress: 0, notStarted: 0 },
  assigneeNames: [],
  assignerNames: [],
  blockingReviewers: { names: [], allRequired: false },
  tasksApprovedAt: null,
  tasksApprovedBy: null,
  canApproveTasks: false,
  campaignKind: 'campaign',
  ...o,
})

function renderPage() {
  return render(
    <MemoryRouter>
      <PipelinePage />
    </MemoryRouter>,
  )
}
const pick = () => fireEvent.change(screen.getByTestId('pipeline-campaign'), { target: { value: 'cam1' } })

const phase = (p: DeliverableRow['progress']['phase']): DeliverableRow['progress'] => ({ phase: p, total: 1, unassigned: 0, done: 0, everTotal: 1, inReview: 0, inProgress: 0, notStarted: 0 })

describe('PipelinePage (ADR-0024, I2.4)', () => {
  beforeEach(() => {
    state.rows = []
    state.isLoading = false
    state.isError = false
  })

  it('prompts for a campaign first', () => {
    renderPage()
    expect(screen.getByTestId('pipeline-pick')).toBeInTheDocument()
  })

  it('empty state when the campaign has no deliverables', () => {
    renderPage()
    pick()
    expect(screen.getByTestId('pipeline-empty')).toBeInTheDocument()
  })

  // The lanes are departments and the columns are where the WORK is (I40.22) — the same badge the
  // Deliverables page wears, never the container's own "Draft".
  it('lays deliverables into per-department swimlanes and work-phase columns', () => {
    state.rows = [
      mk({ id: 'a', departmentId: 'd1', progress: phase('not_started') }),
      mk({ id: 'b', departmentId: 'd1', progress: phase('in_review') }),
      mk({ id: 'c', departmentId: 'd2', discipline: 'Production', progress: phase('complete') }),
    ]
    renderPage()
    pick()
    expect(screen.getByTestId('pipeline-lane-d1')).toBeInTheDocument()
    expect(screen.getByTestId('pipeline-lane-d2')).toBeInTheDocument()
    const startCol = screen.getByTestId('pipeline-col-d1-not_started')
    expect(within(startCol).getByTestId('pipeline-card-a')).toBeInTheDocument()
    const reviewCol = screen.getByTestId('pipeline-col-d1-in_review')
    expect(within(reviewCol).getByTestId('pipeline-card-b')).toBeInTheDocument()
    expect(screen.queryByText('Draft')).not.toBeInTheDocument()
  })

  it('shows the blocked column only when something is blocked, and deep-links cards', () => {
    state.rows = [mk({ id: 'a', departmentId: 'd1', progress: phase('blocked') })]
    renderPage()
    pick()
    expect(screen.getByTestId('pipeline-col-d1-blocked')).toBeInTheDocument()
    expect(screen.getByTestId('pipeline-card-a')).toHaveAttribute('href', '/deliverables?campaign=cam1&open=a')
  })
})
