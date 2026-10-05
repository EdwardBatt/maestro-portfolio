import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import '../../../lib/i18n'
import type { CampaignTask, DeliverableRow } from '../../deliverables/api/deliverables-api'
import type { CampaignPhase } from '../api/campaign-detail-api'
import type { PieceRisk } from '../lib/where-is-everything'
import { WhereIsEverything } from './WhereIsEverything'

const task = (over: Partial<CampaignTask> = {}): CampaignTask => ({
  id: 't', title: 'Create artwork', hours: 8, status: 'todo', assigneeName: 'Zubaida', startsAt: null, dueAt: null, ...over,
})
const piece = (id: string, over: Partial<DeliverableRow> = {}): DeliverableRow => ({
  id, name: `Piece ${id}`, code: `DA-${id}`, state: 'in_progress', dueAt: '2026-10-01T15:00:00Z', revisionRound: 0, revisionLimit: null,
  streamId: 's', streamName: null, taskCount: 1, unassignedCount: 0, typeName: 'Carousel', ownerUserId: 'fadia', ownerName: 'Fadia',
  progress: { phase: 'in_progress', total: 1, unassigned: 0, done: 0, everTotal: 1, inReview: 0, inProgress: 0, notStarted: 0 }, assigneeNames: [], assignerNames: [],
  blockingReviewers: { names: [], allRequired: false }, discipline: 'Creative', departmentId: 'creative', campaignId: 'c',
  approvedVersion: null, tasksApprovedAt: '2026-09-20T08:00:00Z', tasksApprovedBy: null, canApproveTasks: false, campaignKind: 'campaign',
  workstreamId: 'da', phaseId: 'w1', taskList: [task({ status: 'in_progress' })], ...over,
})
const risk = (level: PieceRisk['assessment']['level'], over: Partial<PieceRisk> = {}, late = 0): PieceRisk => ({
  assessment: { level, reasons: [], waiting: [], lateByWorkingDays: late }, outstandingInputs: 0, since: null, waitingSince: null, ...over,
})
const phases: CampaignPhase[] = [
  { id: 'w1', number: 1, name: 'Week 1', startsOn: '2026-09-21', endsOn: '2026-09-27' } as CampaignPhase,
  { id: 'w2', number: 2, name: 'Week 2', startsOn: '2026-09-28', endsOn: '2026-10-04' } as CampaignPhase,
]
const workstreams = [{ id: 'da', name: 'Design & Animation' }]
const TODAY = Date.parse('2026-09-24T12:00:00Z')

const pieces = [
  piece('1', { name: 'Payment-chime carousel', progress: { phase: 'in_review', total: 1, unassigned: 0, done: 0, everTotal: 1, inReview: 0, inProgress: 0, notStarted: 0 } }),
  piece('2', { name: 'Draw Night opener', ownerUserId: 'jaafar', ownerName: 'Jaafar', discipline: 'Production' }),
  piece('3', { name: 'Winner card set', phaseId: 'w2', workstreamId: null }),
]
const riskMap = new Map<string, PieceRisk>([
  ['1', risk('on_time', { since: '2026-09-24T09:00:00Z' })],
  ['2', risk('late', { since: '2026-09-22T11:00:00Z' }, 3)],
  ['3', risk('waiting', { outstandingInputs: 1, since: '2026-09-01T00:00:00Z', waitingSince: '2026-09-24T10:00:00Z' })],
])

const renderIt = (over: Partial<Parameters<typeof WhereIsEverything>[0]> = {}) => {
  const onOpenPiece = vi.fn()
  const onEditPiece = vi.fn()
  render(
    <WhereIsEverything
      pieces={pieces} phases={phases} workstreams={workstreams} risk={riskMap}
      onOpenPiece={onOpenPiece} onEditPiece={onEditPiece} today={TODAY} {...over}
    />,
  )
  return { onOpenPiece, onEditPiece }
}
const rowIds = () => screen.getAllByTestId(/^where-row-/).map((r) => r.getAttribute('data-testid'))

describe('WhereIsEverything — CG-03 (I57.10)', () => {
  it('opens on the phase today falls in, late first, each row the piece, its OWNER and department, how long, next, the clock', () => {
    renderIt()
    expect(screen.getByTestId('campaign-panel-where')).toHaveAttribute('role', 'tabpanel')
    expect(screen.getByTestId('where-filter-phase')).toHaveValue('w1')
    expect(rowIds()).toEqual(['where-row-2', 'where-row-1'])   // week 2's piece is filtered out

    const late = screen.getByTestId('where-row-2')
    expect(late).toHaveTextContent('DA-2')
    expect(within(late).getByTestId('where-status-2')).toHaveTextContent('In progress')
    expect(screen.getByTestId('where-owner-2')).toHaveTextContent('Jaafar · Production')
    expect(screen.getByTestId('where-since-2')).toHaveTextContent('2 days')
    expect(screen.getByTestId('where-next-2')).toHaveTextContent('It goes in for review')
    expect(screen.getByTestId('where-clock-2')).toHaveTextContent('late by 3 days')

    expect(screen.getByTestId('where-status-1')).toHaveTextContent('In review')
    expect(screen.getByTestId('where-since-1')).toHaveTextContent('3h')
    expect(screen.getByTestId('where-next-1')).toHaveTextContent('Approve or send changes')
    expect(screen.getByTestId('where-clock-1')).toHaveTextContent('on time')
    expect(screen.getByTestId('where-note')).toHaveTextContent(/owner/)
  })

  it('a piece with an outstanding input is Blocked, counted from the input (I67.4: "Waiting" retired)', () => {
    renderIt()
    fireEvent.change(screen.getByTestId('where-filter-phase'), { target: { value: '' } })
    expect(rowIds()).toEqual(['where-row-2', 'where-row-1', 'where-row-3'])
    expect(screen.getByTestId('where-status-3')).toHaveTextContent('Blocked')
    expect(screen.getByTestId('where-since-3')).toHaveTextContent('2h')
    expect(screen.getByTestId('where-next-3')).toHaveTextContent('1 outstanding input(s) come in')
    expect(screen.getByTestId('where-clock-3')).toHaveTextContent('blocked')
  })

  it('filters by workstream, owner and where it is; an empty result says so in one line', () => {
    renderIt()
    fireEvent.change(screen.getByTestId('where-filter-phase'), { target: { value: '' } })
    fireEvent.change(screen.getByTestId('where-filter-workstream'), { target: { value: 'none' } })
    expect(rowIds()).toEqual(['where-row-3'])
    fireEvent.change(screen.getByTestId('where-filter-workstream'), { target: { value: '' } })
    fireEvent.change(screen.getByTestId('where-filter-owner'), { target: { value: 'jaafar' } })
    expect(rowIds()).toEqual(['where-row-2'])
    fireEvent.change(screen.getByTestId('where-filter-status'), { target: { value: 'delivered' } })
    expect(screen.queryAllByTestId(/^where-row-/)).toHaveLength(0)
    expect(screen.getByTestId('where-empty')).toHaveTextContent('Nothing matches these filters.')
  })

  it('the row, Open and Edit: the row and Open open the drawer; Edit opens the dialog and nothing else', () => {
    const { onOpenPiece, onEditPiece } = renderIt()
    fireEvent.click(screen.getByTestId('where-row-1'))
    expect(onOpenPiece).toHaveBeenLastCalledWith('1')
    fireEvent.click(screen.getByTestId('where-open-2'))
    expect(onOpenPiece).toHaveBeenLastCalledWith('2')
    expect(onOpenPiece).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByTestId('where-edit-2'))
    expect(onEditPiece).toHaveBeenCalledWith('2')
    expect(onOpenPiece).toHaveBeenCalledTimes(2)
  })

  it('no Edit for a viewer who may not edit; no workstream filter where the campaign has none; weeks where it has no phases (I63)', () => {
    renderIt({ onEditPiece: null, phases: [], workstreams: [] })
    expect(screen.queryByTestId('where-edit-1')).toBeNull()
    expect(screen.getByTestId('where-open-1')).toBeInTheDocument()
    // I63 (Edward, 28 Sep): without phases, the filter offers the weeks the season map draws.
    expect(screen.getByTestId('where-filter-phase')).toHaveTextContent('All weeks')
    expect(screen.queryByTestId('where-filter-workstream')).toBeNull()
    expect(rowIds()).toHaveLength(3)
  })

  it("no clock and no duration for a delivered piece; the owner's name in the next step", () => {
    renderIt({
      pieces: [
        piece('d', { state: 'delivered', progress: { phase: 'delivered', total: 0, unassigned: 0, done: 1, everTotal: 1, inReview: 0, inProgress: 0, notStarted: 0 } }),
        piece('u', { tasksApprovedAt: null, progress: { phase: 'not_started', total: 1, unassigned: 1, done: 0, everTotal: 1, inReview: 0, inProgress: 0, notStarted: 0 }, taskList: [task({ assigneeName: null })] }),
      ],
      risk: new Map([['d', risk('done', { since: '2026-09-01T00:00:00Z' })], ['u', risk('at_risk', { since: '2026-09-23T10:00:00Z' })]]),
      phases: [],
    })
    expect(screen.getByTestId('where-status-d')).toHaveTextContent('Delivered')
    expect(screen.getByTestId('where-clock-d')).toBeEmptyDOMElement()
    expect(screen.getByTestId('where-since-d')).toHaveTextContent('—')
    expect(screen.getByTestId('where-status-u')).toHaveTextContent('Unassigned')
    expect(screen.getByTestId('where-next-u')).toHaveTextContent('Fadia approves its task list')
    expect(screen.getByTestId('where-clock-u')).toHaveTextContent('at risk')
    expect(rowIds()).toEqual(['where-row-u', 'where-row-d'])
  })

  it('a campaign with no pieces says so in one line', () => {
    renderIt({ pieces: [], risk: new Map() })
    expect(screen.getByTestId('where-empty')).toHaveTextContent('No deliverables on this campaign yet.')
  })
})
