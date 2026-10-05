import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import '../../../lib/i18n'
import type { DeliverableRow } from '../../deliverables/api/deliverables-api'
import type { WorkPhase } from '../../../lib/deliverables/work-phase'
import { CampaignBoard } from './CampaignBoard'
import type { ChangeRequestRow } from '../lib/change-request'

const NOW = Date.parse('2026-09-24T07:00:00Z')

const piece = (id: string, over: Partial<DeliverableRow> & { phase?: WorkPhase; unassigned?: number } = {}): DeliverableRow => ({
  id, name: `Piece ${id}`, state: 'in_progress', dueAt: '2026-09-30T15:00:00Z', revisionRound: 0, revisionLimit: null,
  streamId: 's', streamName: null, taskCount: 2, unassignedCount: over.unassigned ?? 0, typeName: null, ownerUserId: 'o', ownerName: 'Fadia',
  progress: { phase: over.phase ?? 'in_progress', total: 2, unassigned: over.unassigned ?? 0, done: 0, everTotal: 2, inReview: 0, inProgress: 0, notStarted: 0 },
  assigneeNames: ['Zubaida'], assignerNames: [], blockingReviewers: { names: [], allRequired: false }, discipline: 'Creative',
  departmentId: 'c', campaignId: 'cam', approvedVersion: null, tasksApprovedAt: null, tasksApprovedBy: null, canApproveTasks: false,
  campaignKind: 'campaign', workstreamId: null, code: `DA-${id}`,
  taskList: [{ id: `${id}-t`, title: 'Create artwork', hours: 8, status: 'in_progress', assigneeName: 'Zubaida', startsAt: null, dueAt: null }],
  ...over,
})

const renderBoard = (pieces: DeliverableRow[], props: Partial<Parameters<typeof CampaignBoard>[0]> = {}) => {
  const onOpenPiece = vi.fn()
  const onEditPiece = vi.fn()
  render(<CampaignBoard pieces={pieces} outstandingInputs={new Map()} onOpenPiece={onOpenPiece} onEditPiece={onEditPiece} today={NOW} {...props} />)
  return { onOpenPiece, onEditPiece }
}

describe('CampaignBoard — CG-05 (I57.8)', () => {
  it('shows the seven columns left to right, each with its count — one held-up column, called Blocked (I67.4)', () => {
    renderBoard([
      piece('1', { phase: 'not_started', state: 'draft', unassigned: 1 }),
      piece('2', { phase: 'not_started', state: 'draft' }),
      piece('3'),
      piece('4', { phase: 'in_review' }),
      piece('5', { state: 'delivered', phase: 'delivered' }),
      piece('6'),
      piece('7', { state: 'approved', phase: 'complete' }),
      piece('x', { state: 'archived', phase: 'complete' }),
    ], { outstandingInputs: new Map([['6', 2]]) })
    const panel = screen.getByTestId('campaign-panel-board')
    expect(panel).toHaveAttribute('role', 'tabpanel')
    const heads = [...panel.querySelectorAll('.board-column-name')].map((h) => h.textContent)
    expect(heads).toEqual(['Unassigned', 'Not started', 'In progress', 'Blocked', 'In review', 'Approved', 'Delivered'])
    expect(heads.filter((h) => h === 'Blocked')).toHaveLength(1)
    const counts = ['unassigned', 'notStarted', 'inProgress', 'waiting', 'inReview', 'approved', 'delivered'].map((c) => screen.getByTestId(`board-count-${c}`).textContent)
    expect(counts).toEqual(['1', '1', '1', '1', '1', '1', '1'])
    expect(screen.queryByTestId('board-card-x')).toBeNull()
    expect(within(screen.getByTestId('board-column-waiting')).getByText('Waiting on 2 inputs')).toBeInTheDocument()
  })

  it('a card reads the code, the piece and its OWNER — never the people on its tasks', () => {
    renderBoard([piece('1')])
    const card = screen.getByTestId('board-card-1')
    expect(card).toHaveTextContent('DA-1')
    expect(card).toHaveTextContent('Piece 1')
    expect(screen.getByTestId('board-card-owner-1')).toHaveTextContent('Fadia')
    expect(card).not.toHaveTextContent('Zubaida')
    expect(card).not.toHaveTextContent('Create artwork')
  })

  it('marks a late piece in red words, and not one still in time', () => {
    renderBoard([piece('1', { dueAt: '2026-09-20T15:00:00Z' }), piece('2')])
    expect(screen.getByTestId('board-card-late-1')).toHaveTextContent(/^Late · was due /)
    expect(screen.queryByTestId('board-card-late-2')).toBeNull()
  })

  it('pressing a card opens the drawer; Edit opens the edit dialog', () => {
    const { onOpenPiece, onEditPiece } = renderBoard([piece('1')])
    fireEvent.click(screen.getByTestId('board-card-1'))
    expect(onOpenPiece).toHaveBeenCalledWith('1')
    fireEvent.click(screen.getByTestId('board-card-edit-1'))
    expect(onEditPiece).toHaveBeenCalledWith('1')
    expect(onOpenPiece).toHaveBeenCalledTimes(1)
  })

  it('offers no Edit to a viewer who may not edit', () => {
    renderBoard([piece('1')], { onEditPiece: null })
    expect(screen.queryByTestId('board-card-edit-1')).toBeNull()
  })

  it('shows the first three cards of a column and "+ N more" shows the rest', () => {
    renderBoard(['1', '2', '3', '4', '5'].map((id) => piece(id)))
    const col = screen.getByTestId('board-column-inProgress')
    expect(within(col).getAllByRole('listitem')).toHaveLength(3)
    const more = screen.getByTestId('board-more-inProgress')
    expect(more).toHaveTextContent('+ 2 more')
    fireEvent.click(more)
    expect(within(col).getAllByRole('listitem')).toHaveLength(5)
    expect(more).toHaveTextContent('Show fewer')
    fireEvent.click(more)
    expect(within(col).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.queryByTestId('board-more-notStarted')).toBeNull()
  })

  it('has nothing to drag', () => {
    renderBoard([piece('1')])
    expect(screen.getByTestId('campaign-panel-board').querySelector('[draggable="true"]')).toBeNull()
  })
})

// ADR-0110 (I59.23): a live change request is said on the card; a settled one is not.
describe('CampaignBoard — a change request on the card (ADR-0110)', () => {
  const req = (status: ChangeRequestRow['status'], closedAt: string | null = null): ChangeRequestRow => ({
    id: 'r', deliverableId: 'a', status, requestedBy: 'am', requestedByName: 'Nadia', changes: {}, askedBy: 'us',
    declineReason: 'No', counterText: null, counterDate: null, createdAt: '2026-09-20T10:00:00Z', closedAt,
  })

  it('pending: "Change requested · waiting on" the owner', () => {
    renderBoard([piece('a', { phase: 'in_progress' })], { changeRequests: new Map([['a', req('pending')]]) })
    expect(screen.getByTestId('board-card-change-a')).toHaveTextContent(/Change requested · waiting on/)
  })

  it('accepted, or declined and closed: nothing on the card', () => {
    renderBoard([piece('a', { phase: 'in_progress' })], { changeRequests: new Map([['a', req('accepted')]]) })
    expect(screen.queryByTestId('board-card-change-a')).toBeNull()
  })

  it('declined and not closed: still said', () => {
    renderBoard([piece('a', { phase: 'in_progress' })], { changeRequests: new Map([['a', req('declined')]]) })
    expect(screen.getByTestId('board-card-change-a')).toHaveTextContent(/declined the change/)
  })
})
