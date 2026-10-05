import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../../lib/i18n'
import type { DeliverableRow } from '../../deliverables/api/deliverables-api'
import type { WorkPhase } from '../../../lib/deliverables/work-phase'
import type { CampaignPhase } from '../api/campaign-detail-api'
import { SeasonMap } from './SeasonMap'

const TODAY = Date.parse('2026-09-24T09:00:00Z')

const piece = (over: Partial<DeliverableRow> & { phase?: WorkPhase } = {}): DeliverableRow => {
  const { phase = 'in_progress', ...rest } = over
  return {
    id: 'd1', name: 'Piece', state: 'in_progress', dueAt: '2099-01-01T15:00:00Z', revisionRound: 0, revisionLimit: null,
    streamId: 's', streamName: null, taskCount: 1, unassignedCount: 0, typeName: null, ownerUserId: null, ownerName: null,
    progress: { phase, total: 1, unassigned: 0, done: 0, everTotal: 1, inReview: 0, inProgress: 0, notStarted: 0 }, assigneeNames: [], assignerNames: [],
    blockingReviewers: { names: [], allRequired: false }, discipline: 'Creative', departmentId: 'dep-c', campaignId: 'cam',
    approvedVersion: null, tasksApprovedAt: null, tasksApprovedBy: null, canApproveTasks: false, campaignKind: 'campaign',
    workstreamId: null, phaseId: null, code: null, taskList: [],
    ...rest,
  } as DeliverableRow
}

const PHASES: CampaignPhase[] = [
  { id: 'p1', number: 1, name: 'Pre-launch', startsOn: '2026-09-12', endsOn: '2026-09-17' },
  { id: 'p2', number: 2, name: 'Week 1', startsOn: '2026-09-18', endsOn: '2026-09-25' },
]
const WS = [{ id: 'w1', name: 'Design & Animation', ownerName: 'Fadia' }]

describe('SeasonMap — CG-02, workstream × phase (I57.6)', () => {
  it('heads each column with the phase name and its dates, and highlights the current one', () => {
    render(<SeasonMap pieces={[piece({ workstreamId: 'w1', phaseId: 'p1' })]} phases={PHASES} workstreams={WS} onOpenPiece={() => {}} today={TODAY} />)
    expect(screen.getByTestId('campaign-panel-season-map')).toHaveAttribute('role', 'tabpanel')
    expect(screen.getByTestId('season-map-phase-p1')).toHaveTextContent('Pre-launch')
    expect(screen.getByTestId('season-map-phase-p2')).toHaveTextContent(/Week 1.*18 Sep.*25 Sep/)
    expect(screen.getByTestId('season-map-phase-p2')).toHaveClass('is-current')
    expect(screen.getByTestId('season-map-phase-p1')).not.toHaveClass('is-current')
    // No piece without a phase: no "No phase" column.
    expect(screen.queryByTestId('season-map-phase-none')).toBeNull()
  })

  it('puts one square per piece in its workstream × phase cell, and a row says how much is delivered', () => {
    const onOpen = vi.fn()
    render(
      <SeasonMap
        pieces={[
          piece({ id: 'a', workstreamId: 'w1', phaseId: 'p1', state: 'delivered', phase: 'delivered' }),
          piece({ id: 'b', workstreamId: 'w1', phaseId: 'p2', dueAt: '2026-09-01T15:00:00Z' }),
          piece({ id: 'c', workstreamId: null, phaseId: null, phase: 'not_started' }),
          piece({ id: 'x', workstreamId: 'w1', phaseId: 'p2', state: 'archived' }),
        ]}
        phases={PHASES} workstreams={WS} onOpenPiece={onOpen} today={TODAY}
      />,
    )
    expect(screen.getByTestId('season-map-row-line-w1')).toHaveTextContent('1 of 2 delivered')
    expect(screen.getByTestId('season-map-cell-w1-p1')).toContainElement(screen.getByTestId('season-square-a'))
    expect(screen.getByTestId('season-square-a')).toHaveClass('is-delivered')
    expect(screen.getByTestId('season-map-cell-w1-p2')).toContainElement(screen.getByTestId('season-square-b'))
    expect(screen.getByTestId('season-square-b')).toHaveClass('is-late')
    // The piece in no workstream and no phase: its own row, the trailing column.
    expect(screen.getByTestId('season-map-row-none')).toHaveTextContent('Not in a workstream')
    expect(screen.getByTestId('season-map-phase-none')).toHaveTextContent('No phase')
    expect(screen.getByTestId('season-map-cell-none-none')).toContainElement(screen.getByTestId('season-square-c'))
    expect(screen.getByTestId('season-square-c')).toHaveClass('is-not_started')
    // Archived: not made, not drawn.
    expect(screen.queryByTestId('season-square-x')).toBeNull()
    fireEvent.click(screen.getByTestId('season-square-b'))
    expect(onOpen).toHaveBeenCalledWith('b')
  })

  it('rows are departments when the campaign has no workstreams', () => {
    render(<SeasonMap pieces={[piece({ id: 'a', phaseId: 'p1', departmentId: 'dep-c', discipline: 'Creative' })]} phases={PHASES} workstreams={[]} onOpenPiece={() => {}} today={TODAY} />)
    expect(screen.getByTestId('season-map-row-dep-c')).toHaveTextContent('Creative')
  })

  it('maps a campaign without phases by week (I63.5, Edward 28 Sep)', () => {
    render(<SeasonMap pieces={[piece({ id: 'a', dueAt: '2026-09-24T12:00:00Z' })]} phases={[]} workstreams={[]} onOpenPiece={() => {}} today={TODAY} />)
    expect(screen.getByTestId('season-map-grid')).toBeInTheDocument()
    expect(screen.getByTestId('season-map-phase-week:2026-09-20')).toHaveTextContent('Week 1')
  })
})
