import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../../lib/i18n'
import type { DeliverableRow } from '../../deliverables/api/deliverables-api'

/**
 * The piece's panel (ADR-0132) — what I68.11, I68.12 and I68.14 add to it:
 *  - a new phase ASKS about the due date, and "Move" puts the phase's planned day in the date (I57.36, as Edit piece);
 *  - a new due date shows the ADR-0093 warning before Save, and proceeding past it is recorded (`due_date_override`);
 *  - "Waiting on someone outside" and the deliverable's chat are in the panel, now the Deliverables window is retired.
 */
const m = vi.hoisted(() => ({
  editDirect: vi.fn(async () => ({})),
  recordOverride: vi.fn(async () => undefined),
  move: vi.fn(async () => undefined),
  grants: new Set<string>(['project_tasks:manage', 'deliverable_owner:manage']),
  outstanding: 0 as number | null,
  asks: [] as unknown[],
  withdraw: vi.fn(),
}))

vi.mock('../../../lib/calendar/client-calendar', async () => {
  const { IRAQ_WORKING_CALENDAR } = await import('../../../lib/campaigns/go-live-dates')
  return { useClientCalendar: () => ({ calendar: IRAQ_WORKING_CALENDAR, isLoading: false }) }
})
vi.mock('../../../lib/settings/scheduling-settings-api', async () => {
  const real = await vi.importActual<typeof import('../../../lib/settings/scheduling-settings-api')>('../../../lib/settings/scheduling-settings-api')
  return { ...real, useSchedulingSettings: () => ({ data: undefined }) }
})
vi.mock('../../../app/permissions', () => ({ usePermissions: () => ({ can: (k: string) => m.grants.has(k) }) }))
vi.mock('../../admin/api/deliverable-types-api', () => ({
  useDeliverableCatalogue: () => ({ items: [{ id: 'type-carousel', code: 'SOC-002', name: 'Carousel', category: 'Social' }], isLoading: false, isError: false }),
  useLanguageWords: () => ({ options: [{ code: 'ar', label: 'Arabic' }], words: (c: readonly string[] | null | undefined) => (c ?? []).join(', ') }),
  useAddLanguage: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('../../deliverables/DeliverablesPage', () => ({ failed: () => ({ kind: 'error', text: 'failed' }) }))
vi.mock('../../deliverables/api/deliverables-api', () => ({
  useApproveDeliverableTasks: () => ({ mutate: vi.fn(), isPending: false }),
  useDeliverableOwnerCandidates: () => ({ data: [] }),
  useReassignDeliverable: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveSubTask: () => ({ mutate: vi.fn(), isPending: false }),
  useTransitionDeliverable: () => ({ mutate: vi.fn(), isPending: false }),
  useUpsertSubTask: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('../api/campaign-detail-api', () => ({
  useMoveDeliverableToPhase: () => ({ mutateAsync: m.move, isPending: false }),
  useUpdateCampaignDeliverable: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdatePieceDetails: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('../api/workstreams-api', () => ({ useMoveDeliverableToWorkstream: () => ({ mutateAsync: vi.fn(), isPending: false }) }))
vi.mock('../api/piece-edit-api', () => ({
  useAddTaskToPiece: () => ({ mutate: vi.fn(), isPending: false }),
  useChangeDeliverableType: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEditPieceDirect: () => ({ mutateAsync: m.editDirect, isPending: false }),
  usePreviewQuantityChange: () => ({ data: null, isLoading: false, isError: false }),
  usePreviewTypeChange: () => ({ data: null, isLoading: false, isError: false }),
}))
vi.mock('../../deliverables/api/extensions-api', () => ({
  useOutstandingHours: () => ({ data: m.outstanding }),
  useRecordDueDateOverride: () => ({ mutateAsync: m.recordOverride, isPending: false }),
}))
vi.mock('../../deliverables/api/requirements-api', () => ({
  usePendingInputs: () => ({
    data: [{ id: 'in1', description: 'Offer terms for the launch film', awaitedFrom: 'client', askedOn: null, createdAt: '2099-09-20T09:00:00Z' }],
    isLoading: false,
  }),
  useAddPendingInput: () => ({ mutate: vi.fn(), isPending: false }),
  useMarkInputArrived: () => ({ mutate: vi.fn(), isPending: false }),
}))
// ADR-0141 (I74.13–I74.15): the piece header's reads and writes.
vi.mock('../api/change-asks-api', () => ({
  usePieceAskContext: () => ({
    data: {
      id: 'd1', name: 'Campus OOH', code: 'LV-021', dueAt: '2099-09-24T15:00:00Z', channel: 'Instagram', languages: ['ar'],
      quantity: 1, typeName: 'Carousel', campaignId: 'cam', campaignName: 'LUMA', accountManagerId: 'inas',
      accountManagerName: 'Inas', hours: 12,
      tasks: [{ id: 't1', title: 'Create artwork', status: 'todo', hours: 6, dueAt: null, assigneeId: 'zubaida', assigneeName: 'Zubaida' }],
    },
  }),
  usePieceChangeAsks: () => ({ data: m.asks }),
  useWithdrawDeliverableChange: () => ({ mutate: m.withdraw, isPending: false }),
  useAskDeliverableChange: () => ({ mutate: vi.fn(), isPending: false }),
  useAnswerDeliverableChange: () => ({ mutate: vi.fn(), isPending: false }),
}))
// ADR-0140: the piece's task list is its own component with its own suite (PieceTasks.test.tsx).
vi.mock('./PieceTasks', () => ({ PieceTasks: (p: { deliverableId: string; testId?: string }) => <div data-testid={p.testId ?? 'piece-tasks'} data-deliverable={p.deliverableId} /> }))
vi.mock('../../chat/ChatPanel', () => ({
  ChatPanel: ({ contextType, contextId }: { contextType: string; contextId: string }) => <div data-testid={`chat-${contextType}-${contextId}`} />,
}))

import { PiecePanel, type PiecePanelProps } from './PiecePanel'

const PHASES = [
  { id: 'p1', number: 1, name: 'Week 1', startsOn: '2099-09-18', endsOn: '2099-09-25' },
  { id: 'p2', number: 2, name: 'Week 2', startsOn: '2099-09-26', endsOn: '2099-10-02' },
]

const piece = (over: Partial<DeliverableRow> = {}): DeliverableRow => ({
  id: 'd1', name: 'Campus OOH', state: 'in_progress', dueAt: '2099-09-24T15:00:00Z', priority: 'medium',
  revisionRound: 0, revisionLimit: null, streamId: 's', streamName: null, taskCount: 2, unassignedCount: 0, typeName: 'Carousel',
  deliverableTypeId: 'type-carousel', quantity: 1, phaseId: 'p1', ownerUserId: 'fadia', ownerName: 'Fadia Lead',
  progress: { phase: 'in_progress', total: 2, unassigned: 0, done: 0, everTotal: 2, inReview: 0, inProgress: 1, notStarted: 1 },
  assigneeNames: [], assignerNames: [], blockingReviewers: { names: [], allRequired: false }, discipline: 'Creative',
  departmentId: 'creative', campaignId: 'cam', approvedVersion: null, tasksApprovedAt: '2099-09-19T09:00:00Z',
  tasksApprovedBy: null, canApproveTasks: false, campaignKind: 'campaign', workstreamId: null, code: 'LV-021', channel: null,
  taskList: [],
  ...over,
} as DeliverableRow)

const view = (over: Partial<PiecePanelProps> = {}) =>
  render(
    <PiecePanel
      piece={piece()}
      campaignId="cam"
      clientId="client"
      goLiveAt="2099-10-01T15:00:00Z"
      isSingleJob={false}
      phases={PHASES}
      workstreams={[]}
      campaignApproved
      canMovePhase
      markTaskId={null}
      onBanner={vi.fn()}
      onClosed={vi.fn()}
      {...over}
    />,
  )

beforeEach(() => {
  m.editDirect.mockClear()
  m.recordOverride.mockClear()
  m.move.mockClear()
  m.outstanding = 0
  m.asks = []
  m.withdraw.mockClear()
})

describe('PiecePanel — a new phase asks about the due date (I68.11, I57.36)', () => {
  it('asks the moment the phase is picked, and "Move" puts the phase\'s planned day in the date', async () => {
    const { phaseDueDate, IRAQ_WORKING_CALENDAR } = await import('../../../lib/timing/plan-back')
    const planned = phaseDueDate({ endsOn: '2099-10-02' }, IRAQ_WORKING_CALENDAR)
    view()
    fireEvent.change(screen.getByTestId('piece-panel-phase'), { target: { value: 'p2' } })
    expect(screen.getByTestId('piece-panel-phase-date')).toHaveTextContent('Week 2')
    fireEvent.click(screen.getByTestId('piece-panel-phase-date-move'))
    expect(screen.queryByTestId('piece-panel-phase-date')).toBeNull()
    fireEvent.click(screen.getByTestId('piece-panel-save'))
    await vi.waitFor(() => expect(m.editDirect).toHaveBeenCalledWith({ deliverableId: 'd1', dueDay: planned }))
    await vi.waitFor(() => expect(m.move).toHaveBeenCalledWith({ campaignId: 'cam', deliverableId: 'd1', phaseId: 'p2' }))
  })

  it('"Keep" moves the phase and leaves the date', async () => {
    view()
    fireEvent.change(screen.getByTestId('piece-panel-phase'), { target: { value: 'p2' } })
    fireEvent.click(screen.getByTestId('piece-panel-phase-date-keep'))
    fireEvent.click(screen.getByTestId('piece-panel-save'))
    await vi.waitFor(() => expect(m.move).toHaveBeenCalled())
    expect(m.editDirect).not.toHaveBeenCalled()
  })
})

describe('PiecePanel — a new due date is checked against go-live (I68.12, ADR-0093)', () => {
  it('warns before Save when the date is after go-live, and records the override when saved', async () => {
    view()
    fireEvent.change(screen.getByTestId('piece-panel-due'), { target: { value: '2099-10-05' } })
    expect(screen.getByTestId('piece-panel-due-warning')).toHaveAttribute('data-severity', 'after_go_live')
    fireEvent.click(screen.getByTestId('piece-panel-save'))
    await vi.waitFor(() => expect(m.recordOverride).toHaveBeenCalled())
    expect(m.recordOverride).toHaveBeenCalledWith(expect.objectContaining({ deliverableId: 'd1', dueDay: '2099-10-05', severity: 'after_go_live', goLiveDay: '2099-10-01' }))
  })

  it('says nothing and records nothing for a date comfortably before go-live', async () => {
    view({ goLiveAt: '2099-12-31T15:00:00Z' })
    fireEvent.change(screen.getByTestId('piece-panel-due'), { target: { value: '2099-09-22' } })
    expect(screen.queryByTestId('piece-panel-due-warning')).toBeNull()
    fireEvent.click(screen.getByTestId('piece-panel-save'))
    await vi.waitFor(() => expect(m.editDirect).toHaveBeenCalled())
    expect(m.recordOverride).not.toHaveBeenCalled()
  })
})

describe('PiecePanel — what the retired window carried (I68.14)', () => {
  it('lists what the piece waits for from outside, and mounts the deliverable\'s chat', () => {
    view()
    expect(screen.getByText('Offer terms for the launch film')).toBeInTheDocument()
    expect(screen.getByTestId('chat-deliverable-d1')).toBeInTheDocument()
  })
})

const ask = (over: Record<string, unknown> = {}) => ({
  id: 'a1', deliverableId: 'd1', askedBy: 'fadia', askedByName: 'Fadia Lead', kinds: ['hours', 'due_date'],
  requestedDueDay: '2099-09-27', requestedHours: 16, reason: 'Five frames in two languages', fromSubTaskId: null,
  status: 'pending', answeredBy: null, answeredByName: null, answeredAt: null, answerNote: null, appliedDueDay: null,
  appliedHours: null, escalatedAt: null, createdAt: new Date(Date.now() - 20 * 60_000).toISOString(), ...over,
})

describe('PiecePanel — only the account manager changes the deliverable (ADR-0141, I74.13–I74.15)', () => {
  it("the account manager's side keeps the fields editable and no header strip", () => {
    view({ mayChangeFields: true, viewerId: 'inas' })
    expect(screen.getByTestId('piece-panel-name')).toBeInTheDocument()
    expect(screen.queryByTestId('piece-panel-ask-strip')).toBeNull()
  })

  it('the owner reads the fields in the header and asks the account manager by name; the owner and phase stay hers', () => {
    view({ mayChangeFields: false, viewerId: 'fadia' })
    expect(screen.queryByTestId('piece-panel-name')).toBeNull()
    expect(screen.queryByTestId('piece-panel-due')).toBeNull()
    expect(screen.queryByTestId('piece-panel-client-change')).toBeNull()
    expect(screen.getByTestId('piece-panel-ask-strip')).toHaveTextContent('About 12')
    expect(screen.getByTestId('piece-panel-ask-ask')).toHaveTextContent('Inas')
    expect(screen.getByTestId('piece-panel-phase')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('piece-panel-ask-ask'))
    expect(screen.getByTestId('piece-panel-ask-form-send')).toBeDisabled()
  })

  it('while her ask waits, the strip shows what was asked and the banner offers See and Withdraw', () => {
    m.asks = [ask()]
    view({ mayChangeFields: false, viewerId: 'fadia' })
    expect(screen.getByTestId('piece-panel-ask-hours')).toHaveTextContent('asked 16')
    expect(screen.getByTestId('piece-panel-ask-waiting')).toHaveTextContent(/Waiting on Inas/i)
    expect(screen.queryByTestId('piece-panel-ask-ask')).toBeNull()
    fireEvent.click(screen.getByTestId('piece-panel-ask-see'))
    expect(screen.getByTestId('piece-panel-ask-reason')).toHaveTextContent('Five frames')
    fireEvent.click(screen.getByTestId('piece-panel-ask-withdraw'))
    expect(m.withdraw).toHaveBeenCalledWith('a1', expect.anything())
  })

  it('the account manager sees a waiting ask with Answer, not Withdraw', () => {
    m.asks = [ask()]
    view({ mayChangeFields: true, viewerId: 'inas' })
    expect(screen.getByTestId('piece-panel-ask-answer')).toBeInTheDocument()
    expect(screen.queryByTestId('piece-panel-ask-withdraw')).toBeNull()
  })

  it('a kept ask shows her reason to the asker with Reply and OK; an accepted one says who was told', () => {
    m.asks = [ask({ status: 'kept', answeredBy: 'inas', answeredByName: 'Inas', answeredAt: '2099-09-20T09:00:00Z', answerNote: 'The draw is Friday' })]
    const { unmount } = view({ mayChangeFields: false, viewerId: 'fadia' })
    expect(screen.getByTestId('piece-panel-ask-answered')).toHaveTextContent('The draw is Friday')
    expect(screen.getByTestId('piece-panel-ask-reply')).toBeInTheDocument()
    unmount()
    m.asks = [ask({ id: 'a2', status: 'accepted', answeredBy: 'inas', answeredByName: 'Inas', answeredAt: '2099-09-20T09:00:00Z', appliedHours: 16, appliedDueDay: '2099-09-27' })]
    view({ mayChangeFields: false, viewerId: 'fadia' })
    expect(screen.getByTestId('piece-panel-ask-told')).toHaveTextContent('Zubaida')
    expect(screen.getByTestId('piece-panel-ask-hours')).toHaveTextContent('16 · was 12')
  })
})

describe('PiecePanel — the fields follow the saved deliverable (test script, 4 Oct)', () => {
  it('an accepted ask that moves the due date reaches the box, and Save stays dark', () => {
    const props = {
      campaignId: 'cam', clientId: 'client', goLiveAt: '2099-12-31T15:00:00Z', isSingleJob: false, phases: PHASES, workstreams: [],
      campaignApproved: true, canMovePhase: true, markTaskId: null, onBanner: vi.fn(), onClosed: vi.fn(),
    }
    const r = render(<PiecePanel piece={piece({ dueAt: '2099-09-25T15:00:00Z' })} {...props} />)
    expect(screen.getByTestId('piece-panel-due')).toHaveValue('2099-09-25')
    r.rerender(<PiecePanel piece={piece({ dueAt: '2099-11-05T15:00:00Z' })} {...props} />)
    expect(screen.getByTestId('piece-panel-due')).toHaveValue('2099-11-05')
    expect(screen.getByTestId('piece-panel-save')).toBeDisabled()
  })

  it('a field the person is editing keeps their edit', () => {
    const props = {
      campaignId: 'cam', clientId: 'client', goLiveAt: '2099-12-31T15:00:00Z', isSingleJob: false, phases: PHASES, workstreams: [],
      campaignApproved: true, canMovePhase: true, markTaskId: null, onBanner: vi.fn(), onClosed: vi.fn(),
    }
    const r = render(<PiecePanel piece={piece({ dueAt: '2099-09-25T15:00:00Z' })} {...props} />)
    fireEvent.change(screen.getByTestId('piece-panel-due'), { target: { value: '2099-09-28' } })
    r.rerender(<PiecePanel piece={piece({ dueAt: '2099-11-05T15:00:00Z' })} {...props} />)
    expect(screen.getByTestId('piece-panel-due')).toHaveValue('2099-09-28')
  })
})
