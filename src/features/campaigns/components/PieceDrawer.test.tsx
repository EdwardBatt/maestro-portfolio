import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import '../../../lib/i18n'
import type { CampaignTask, DeliverableRow } from '../../deliverables/api/deliverables-api'
import { PieceDrawer } from './PieceDrawer'
import type { ChangeRequestRow } from '../lib/change-request'

const task = (over: Partial<CampaignTask>): CampaignTask => ({
  id: 't', title: 'Create artwork', hours: 8, status: 'todo', assigneeName: null, startsAt: null, dueAt: null, ...over,
})

const piece = (over: Partial<DeliverableRow> = {}): DeliverableRow => ({
  id: 'd1', name: 'Draw Night 1 opener', state: 'in_progress', dueAt: '2099-09-24T15:00:00Z', revisionRound: 0, revisionLimit: null,
  streamId: 's', streamName: null, taskCount: 3, unassignedCount: 1, typeName: 'Animation', ownerUserId: 'f', ownerName: 'Fadia',
  progress: { phase: 'in_progress', total: 3, unassigned: 1, done: 1, everTotal: 3, inReview: 0, inProgress: 0, notStarted: 0 }, assigneeNames: [], assignerNames: [],
  blockingReviewers: { names: [], allRequired: false }, discipline: 'Creative', departmentId: 'c', campaignId: 'cam',
  approvedVersion: null, tasksApprovedAt: null, tasksApprovedBy: null, canApproveTasks: false, campaignKind: 'campaign',
  workstreamId: null, code: 'DA-005', channel: 'All social',
  taskList: [
    task({ id: 'a', title: 'Develop concept', status: 'done', assigneeName: 'Zubaida' }),
    task({ id: 'b', title: 'Create artwork', status: 'in_progress', assigneeName: 'Lisa', dueAt: '2099-09-23T15:00:00Z' }),
    task({ id: 'c', title: 'Write copy', status: 'todo', assigneeName: null }),
    task({ id: 'x', title: 'Called off', status: 'cancelled', assigneeName: 'Omar' }),
  ],
  ...over,
})

const renderDrawer = (props: Partial<Parameters<typeof PieceDrawer>[0]> = {}) =>
  render(
    <MemoryRouter>
      <PieceDrawer piece={piece()} phaseName="Week 1" workstreamName="Design & Animation" brief={[]} onEdit={null} onClose={() => {}} {...props} />
    </MemoryRouter>,
  )

describe('PieceDrawer — CG-04, the piece and its tasks (I57.16)', () => {
  it('heads the drawer with the code, the status and the date, and names the OWNER — not one person "with" it', () => {
    renderDrawer()
    expect(screen.getByTestId('piece-drawer-code')).toHaveTextContent('DA-005')
    expect(screen.getByTestId('piece-drawer-status')).toHaveTextContent('In progress')
    expect(screen.getByTestId('piece-drawer-due')).toHaveTextContent(/^Due /)
    expect(screen.getByTestId('piece-drawer-sub')).toHaveTextContent('Animation · All social · Week 1 · Design & Animation')
    expect(screen.getByTestId('piece-drawer-owner')).toHaveTextContent('Owned by Fadia · Creative')
  })

  it('tells the whole story as the task list: every task, its assignee, where it is, in order', () => {
    renderDrawer()
    const steps = screen.getByTestId('piece-drawer-tasks').querySelectorAll('li')
    expect([...steps].map((s) => s.getAttribute('data-testid'))).toEqual(['piece-drawer-task-a', 'piece-drawer-task-b', 'piece-drawer-task-c'])
    expect(screen.getByTestId('piece-drawer-task-line-a')).toHaveTextContent('Zubaida · Done')
    expect(screen.getByTestId('piece-drawer-task-line-b')).toHaveTextContent(/^Lisa · In progress · due /)
    expect(screen.getByTestId('piece-drawer-task-line-c')).toHaveTextContent('Unassigned · Not started')
    // A cancelled task is not part of the story.
    expect(screen.queryByTestId('piece-drawer-task-x')).toBeNull()
  })

  it('marks a piece past its date', () => {
    renderDrawer({ piece: piece({ dueAt: '2020-01-01T15:00:00Z' }) })
    expect(screen.getByTestId('piece-drawer-due')).toHaveTextContent(/^Was due /)
  })

  it('says so when a piece has no tasks yet', () => {
    renderDrawer({ piece: piece({ taskList: [] }) })
    expect(screen.getByTestId('piece-drawer-no-tasks')).toBeInTheDocument()
  })

  it('shows the brief lines it is given, and nothing when there are none', () => {
    renderDrawer({ brief: [{ label: 'The task', value: 'Opener for Draw Night 1' }] })
    expect(screen.getByTestId('piece-drawer-brief')).toHaveTextContent('Opener for Draw Night 1')
  })

  it('no longer sends you to Deliverables (ADR-0132 d.8); Edit only where it is given, and closes', () => {
    const onClose = vi.fn()
    const onEdit = vi.fn()
    renderDrawer({ onClose, onEdit })
    expect(screen.queryByTestId('piece-drawer-full')).toBeNull()
    fireEvent.click(screen.getByTestId('piece-drawer-edit'))
    expect(onEdit).toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('piece-drawer-close'))
    expect(onClose).toHaveBeenCalled()
  })

  it('focuses the ✕ first, never the status pill whose card would cover the name (I67.6)', () => {
    renderDrawer()
    expect(document.activeElement).toBe(screen.getByTestId('piece-drawer-x'))
  })

  it('puts the editor in the story\'s place, and marks the task the person came from (ADR-0132)', () => {
    renderDrawer({ editor: <div data-testid="the-editor" />, onEdit: vi.fn() })
    expect(screen.getByTestId('the-editor')).toBeInTheDocument()
    expect(screen.queryByTestId('piece-drawer-tasks')).toBeNull()
    // The dialog's Edit is not offered beside an editor.
    expect(screen.queryByTestId('piece-drawer-edit')).toBeNull()
  })

  it('offers no Edit when none is given', () => {
    renderDrawer()
    expect(screen.queryByTestId('piece-drawer-edit')).toBeNull()
  })

  // I57.19: the internal approval reads Approved, not the tasks' "Complete".
  it('an internally approved deliverable reads Approved', () => {
    renderDrawer({ piece: piece({ state: 'approved', progress: { phase: 'complete', total: 0, unassigned: 0, done: 3, everTotal: 3, inReview: 0, inProgress: 0, notStarted: 0 } }) })
    expect(screen.getByTestId('piece-drawer-status')).toHaveTextContent('Approved')
  })
})

// ADR-0110 (I59.23): the newest change request on the piece, and where it stands.
describe('PieceDrawer — the change request on the piece (ADR-0110)', () => {
  const request = (over: Partial<ChangeRequestRow> = {}): ChangeRequestRow => ({
    id: 'r', deliverableId: 'd1', status: 'pending', requestedBy: 'am', requestedByName: 'Nadia', changes: { quantity: { from: '1', to: '3' } },
    askedBy: 'client', declineReason: null, counterText: null, counterDate: null, createdAt: '2099-09-20T10:00:00Z', closedAt: null,
    ...over,
  })

  it('none: nothing is said', () => {
    renderDrawer()
    expect(screen.queryByTestId('piece-drawer-change-request')).toBeNull()
  })

  it('pending: "Change requested · waiting on" the owner', () => {
    renderDrawer({ changeRequest: request() })
    expect(screen.getByTestId('piece-drawer-change-request-line')).toHaveTextContent('Change requested · waiting on Fadia')
    expect(screen.getByTestId('piece-drawer-change-request')).toHaveAttribute('data-status', 'pending')
  })

  it('pushed back: her words and date, waiting on the one who asked', () => {
    renderDrawer({ changeRequest: request({ status: 'pushed_back', counterText: 'Friday, not Wednesday', counterDate: '2099-09-26' }) })
    expect(screen.getByTestId('piece-drawer-change-request-line')).toHaveTextContent('Fadia pushed back · waiting on Nadia')
    expect(screen.getByTestId('piece-drawer-change-request-counter')).toHaveTextContent('Friday, not Wednesday')
    expect(screen.getByTestId('piece-drawer-change-request-counter')).toHaveTextContent('26')
  })

  it('declined: the reason; accepted: the outcome', () => {
    renderDrawer({ changeRequest: request({ status: 'declined', declineReason: 'Artwork is nearly done' }) })
    expect(screen.getByTestId('piece-drawer-change-request-line')).toHaveTextContent('Fadia declined the change: Artwork is nearly done')
  })

  it('accepted: the outcome', () => {
    renderDrawer({ changeRequest: request({ status: 'accepted' }) })
    expect(screen.getByTestId('piece-drawer-change-request-line')).toHaveTextContent('Fadia accepted the change')
  })
})
