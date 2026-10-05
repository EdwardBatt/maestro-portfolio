import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import '../../../lib/i18n'
import type { DeliverableRow } from '../../deliverables/api/deliverables-api'

/**
 * CG-E1 — Edit a deliverable (I57.11). What is pinned: every field opens on what the piece holds;
 * the status is SHOWN and cannot be pressed; each save path calls its own existing write and no
 * other; after approval the date opens the evidenced dialog (ADR-0088 d.7a) instead of taking a
 * free date; closing asks first (ADR-0080 d.7); and a refusal is worded, never reportable (ADR-0092).
 */
const m = vi.hoisted(() => ({
  update: vi.fn(),
  move: vi.fn(),
  reassign: vi.fn(),
  transition: vi.fn(),
  grants: new Set<string>(['project_tasks:manage', 'deliverable_owner:manage']),
  scope: 'tenant' as string,
  // ADR-0110 (I59.23): what the change-request read returns — unstarted unless a test says so.
  context: { started: false, openRequest: null, escalationHours: 8, tasks: [] } as Record<string, unknown>,
  request: vi.fn(),
  folder: vi.fn(),
  file: vi.fn(),
}))

// ADR-0123 d.3: the client's working week — Iraq's here.
vi.mock('../../../lib/calendar/client-calendar', () => ({
  useClientCalendar: () => ({ calendar: { workingDays: [7, 1, 2, 3, 4] }, isLoading: false }),
  useWorkCalendar: () => ({ calendar: { workingDays: [7, 1, 2, 3, 4] }, isLoading: false }),
}))
vi.mock('../../../app/permissions', () => ({
  usePermissions: () => ({ can: (k: string) => m.grants.has(k), scope: m.scope }),
}))
vi.mock('../api/campaign-detail-api', () => ({
  useUpdateCampaignDeliverable: () => ({ mutateAsync: m.update, isPending: false }),
  useMoveDeliverableToPhase: () => ({ mutateAsync: m.move, isPending: false }),
}))
vi.mock('../../deliverables/api/deliverables-api', () => ({
  useReassignDeliverable: () => ({ mutateAsync: m.reassign, isPending: false }),
  useTransitionDeliverable: () => ({ mutate: m.transition, isPending: false }),
  useDeliverableOwnerCandidates: () => ({
    data: [
      { id: 'fadia', name: 'Fadia Lead', departmentId: 'creative', teamId: null, scope: 'department' },
      // I66.9: Walid leads the piece's own department; Omar leads another, so he is only offered for a piece
      // whose department has no lead at all.
      { id: 'walid', name: 'Walid Lead', departmentId: 'creative', teamId: null, scope: 'department' },
      { id: 'omar', name: 'Omar Lead', departmentId: 'live', teamId: null, scope: 'department' },
    ],
  }),
}))
// ADR-0102: the department preview names the new owner's department.
vi.mock('../../admin/api/admin-api', () => ({
  useDepartments: () => ({ data: [{ id: 'creative', name: 'Creative' }, { id: 'live', name: 'Live streams' }] }),
}))
vi.mock('../../admin/api/deliverable-types-api', () => ({
  useDeliverableCatalogue: () => ({ items: [{ id: 'type-carousel', code: 'SOC-002', name: 'Carousel', category: 'Social' }], isLoading: false, isError: false }),
}))
// The page module reaches lib/supabase → lib/env; the banner wording is the real classifier.
vi.mock('../../deliverables/DeliverablesPage', async () => {
  const { classifyWriteFailure } = await import('../../../lib/errors/classify')
  return {
    failed: (err: unknown, fallback: string, outside: string, t?: (k: string, o?: Record<string, unknown>) => string) => ({
      kind: 'error',
      ...classifyWriteFailure(err, fallback, outside, t),
    }),
  }
})
vi.mock('../api/change-requests-api', () => ({
  useChangeRequestContext: () => ({ data: m.context, isLoading: false }),
  useRequestDeliverableChange: () => ({ mutateAsync: m.request, isPending: false }),
}))
// The evidence is filed as the evidenced date dialog files it (ADR-0088 d.7a).
vi.mock('../api/document-filing-api', () => ({
  fetchCampaignReferencesFolder: (id: string) => m.folder(id),
  useFileDocuments: () => ({ mutateAsync: m.file }),
}))
vi.mock('./DeliverableDueAtDialog', () => ({
  DeliverableDueAtDialog: ({ deliverableId, onClose, initialDay, reason, testId = 'deliverable-due-change' }: {
    deliverableId: string; onClose: () => void; initialDay?: string | null; reason?: string | null; testId?: string
  }) => (
    <div data-testid={`${testId}-dialog`}>
      {deliverableId}
      <span data-testid={`${testId}-initial`}>{initialDay ?? ''}</span>
      <span data-testid={`${testId}-reason`}>{reason ?? ''}</span>
      <button type="button" onClick={onClose} data-testid={`${testId}-cancel`}>x</button>
    </div>
  ),
}))
// I57.36: the planned date comes from the office calendar and the tenant's rule — the real
// arithmetic, on the Iraqi week, with the defaults.
vi.mock('../../../lib/calendar/office-calendars-api', async () => {
  const { IRAQ_WORKING_CALENDAR } = await import('../../../lib/campaigns/go-live-dates')
  return { usePlanningCalendar: () => ({ calendar: IRAQ_WORKING_CALENDAR, office: null, isLoading: false }) }
})
vi.mock('../../../lib/settings/scheduling-settings-api', async () => {
  const real = await vi.importActual<typeof import('../../../lib/settings/scheduling-settings-api')>('../../../lib/settings/scheduling-settings-api')
  return { ...real, useSchedulingSettings: () => ({ data: undefined }) }
})

import { EditPieceDialog, type EditPieceDialogProps } from './EditPieceDialog'
import { pieceStatusStep } from '../lib/piece-status'

const PHASES = [
  { id: 'p1', number: 1, name: 'Week 1', startsOn: '2099-09-18', endsOn: '2099-09-25' },
  { id: 'p2', number: 2, name: 'Week 2', startsOn: '2099-09-26', endsOn: '2099-10-02' },
]

const piece = (over: Partial<DeliverableRow> = {}): DeliverableRow => ({
  id: 'd1', name: 'Post 2 — the payment-chime carousel', state: 'in_progress', dueAt: '2099-09-24T15:00:00Z', priority: 'medium',
  revisionRound: 0, revisionLimit: null, streamId: 's', streamName: null, taskCount: 3, unassignedCount: 0, typeName: 'Carousel',
  deliverableTypeId: 'type-carousel', quantity: 1, phaseId: 'p1', ownerUserId: 'fadia', ownerName: 'Fadia Lead',
  progress: { phase: 'in_progress', total: 3, unassigned: 0, done: 1, everTotal: 3, inReview: 0, inProgress: 0, notStarted: 0 }, assigneeNames: ['Zubaida'], assignerNames: [],
  blockingReviewers: { names: [], allRequired: false }, discipline: 'Creative', departmentId: 'creative', campaignId: 'cam',
  approvedVersion: null, tasksApprovedAt: null, tasksApprovedBy: null, canApproveTasks: false, campaignKind: 'campaign',
  workstreamId: null, code: 'DA-003', channel: null,
  ...over,
} as DeliverableRow)

function view(over: Partial<EditPieceDialogProps> = {}) {
  const props: EditPieceDialogProps = {
    piece: piece(),
    campaignId: 'cam',
    clientId: 'client',
    goLiveAt: '2099-10-10T15:00:00Z',
    phases: PHASES,
    campaignApproved: true,
    canMovePhase: true,
    canChangePromise: true,
    onClose: vi.fn(),
    onBanner: vi.fn(),
    ...over,
  }
  render(<EditPieceDialog {...props} />)
  return props
}

const save = async () => {
  await act(async () => {
    fireEvent.click(screen.getByTestId('campaign-deliverable-form-submit'))
  })
}

describe('EditPieceDialog — CG-E1 (I57.11)', () => {
  beforeEach(() => {
    for (const f of [m.update, m.move, m.reassign, m.transition]) f.mockReset()
    m.update.mockResolvedValue(undefined)
    m.move.mockResolvedValue(undefined)
    m.reassign.mockResolvedValue(undefined)
    m.grants = new Set(['project_tasks:manage', 'deliverable_owner:manage'])
    m.scope = 'tenant'
    m.context = { started: false, openRequest: null, escalationHours: 8, tasks: [] }
  })

  it('opens on what the piece holds: name, type, phase, due, department, owner, priority, quantity', () => {
    view()
    expect(screen.getByTestId('campaign-deliverable-form-name')).toHaveValue('Post 2 — the payment-chime carousel')
    expect(screen.getByTestId('campaign-deliverable-form-type-chip')).toBeInTheDocument()
    expect(screen.getByTestId('campaign-deliverable-form-phase')).toHaveValue('p1')
    expect(screen.getByTestId('campaign-deliverable-form-due')).toHaveTextContent(/24/)
    expect(screen.getByTestId('campaign-deliverable-form-department')).toHaveTextContent('Creative')
    expect(screen.getByTestId('campaign-deliverable-form-owner')).toHaveValue('Fadia Lead')
    expect(screen.getByTestId('campaign-deliverable-form-priority')).toHaveTextContent('Medium')
    expect(screen.getByTestId('campaign-deliverable-form-quantity')).toHaveValue(1)
  })

  it('SHOWS the status, the current stage marked, and offers nothing to press', () => {
    view()
    expect(screen.getByTestId('campaign-deliverable-form-status-in_progress')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByTestId('campaign-deliverable-form-status-not_started')).not.toHaveAttribute('aria-current')
    expect(screen.getByTestId('campaign-deliverable-form-status')).toHaveTextContent(/Not started.*In progress.*In review.*Delivered/)
    expect(screen.getByTestId('campaign-deliverable-form-status').querySelectorAll('button, input, select')).toHaveLength(0)
    expect(screen.queryByTestId('campaign-deliverable-form-status-closed')).toBeNull()
  })

  // Edward, 24 Sep: the internal approval shows as Approved; the client's own comes later.
  it('reads the stage: approved (internal) is Approved; archived is Closed', () => {
    const p = piece()
    expect(pieceStatusStep({ ...p, state: 'approved', progress: { ...p.progress, phase: 'complete' } })).toBe('approved')
    expect(pieceStatusStep({ ...p, state: 'delivered', progress: { ...p.progress, phase: 'delivered' } })).toBe('delivered')
    expect(pieceStatusStep({ ...p, state: 'blocked', progress: { ...p.progress, phase: 'blocked' } })).toBe('in_progress')
    expect(pieceStatusStep({ ...p, progress: { ...p.progress, phase: 'no_tasks' } })).toBe('not_started')
    expect(pieceStatusStep({ ...p, state: 'archived' })).toBe('closed')
  })

  it('name, type and quantity save through update_campaign_deliverable — and nothing else is written', async () => {
    const props = view()
    fireEvent.change(screen.getByTestId('campaign-deliverable-form-name'), { target: { value: 'Post 2' } })
    fireEvent.change(screen.getByTestId('campaign-deliverable-form-quantity'), { target: { value: '3' } })
    await save()
    expect(m.update).toHaveBeenCalledWith({ campaignId: 'cam', deliverableId: 'd1', name: 'Post 2', deliverableTypeId: 'type-carousel', quantity: 3 })
    expect(m.move).not.toHaveBeenCalled()
    expect(m.reassign).not.toHaveBeenCalled()
    expect(props.onBanner).toHaveBeenCalledWith({ kind: 'ok', text: 'Deliverable saved.' })
    expect(props.onClose).toHaveBeenCalled()
  })

  it('the phase saves through move_deliverable_to_phase', async () => {
    view()
    fireEvent.change(screen.getByTestId('campaign-deliverable-form-phase'), { target: { value: 'p2' } })
    await save()
    expect(m.move).toHaveBeenCalledWith({ campaignId: 'cam', deliverableId: 'd1', phaseId: 'p2' })
    expect(m.update).not.toHaveBeenCalled()
  })

  it('I57.36: moving the phase moves the date — the evidenced dialog opens on the new phase’s planned day', async () => {
    const { phaseDueDate, IRAQ_WORKING_CALENDAR } = await import('../../../lib/timing/plan-back')
    const p = view()
    fireEvent.change(screen.getByTestId('campaign-deliverable-form-phase'), { target: { value: 'p2' } })
    // Said before saving: the date follows the phase, on the client's agreement.
    expect(screen.getByTestId('campaign-deliverable-form-due-moves')).toHaveTextContent('Week 2')
    await save()
    expect(m.move).toHaveBeenCalledWith({ campaignId: 'cam', deliverableId: 'd1', phaseId: 'p2' })
    expect(screen.getByTestId('campaign-deliverable-form-due-move-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('campaign-deliverable-form-due-move-initial')).toHaveTextContent(
      phaseDueDate({ endsOn: '2099-10-02' }, IRAQ_WORKING_CALENDAR),
    )
    expect(screen.getByTestId('campaign-deliverable-form-due-move-reason')).toHaveTextContent('Week 2')
    // Cancelling there keeps the old date and closes Edit — the phase has moved either way.
    fireEvent.click(screen.getByTestId('campaign-deliverable-form-due-move-cancel'))
    expect(p.onClose).toHaveBeenCalled()
  })

  it('I57.36: without the right to change the promise, the phase moves and the date stays — and says so', async () => {
    const p = view({ canChangePromise: false })
    fireEvent.change(screen.getByTestId('campaign-deliverable-form-phase'), { target: { value: 'p2' } })
    expect(screen.getByTestId('campaign-deliverable-form-due-moves')).toHaveTextContent(/account manager/)
    await save()
    expect(m.move).toHaveBeenCalled()
    expect(screen.queryByTestId('campaign-deliverable-form-due-move-dialog')).toBeNull()
    expect(p.onClose).toHaveBeenCalled()
  })

  it('I57.36: "inside the phase" is said only when the date is inside it', () => {
    view({ piece: piece({ dueAt: '2099-10-01T15:00:00Z' }) })
    expect(screen.getByText(/Outside Week 1/)).toBeInTheDocument()
    expect(screen.queryByText(/^Inside the phase/)).toBeNull()
  })

  it('the owner saves through reassign_deliverable', async () => {
    view()
    const owner = screen.getByTestId('campaign-deliverable-form-owner')
    fireEvent.focus(owner)
    fireEvent.change(owner, { target: { value: 'Walid' } })
    fireEvent.mouseDown(screen.getByRole('option', { name: /Walid Lead/ }))
    await save()
    expect(m.reassign).toHaveBeenCalledWith({ deliverableId: 'd1', ownerUserId: 'walid' })
    expect(m.update).not.toHaveBeenCalled()
  })

  // ADR-0102 d.6: the department follows the owner, and a new owner in another department is said
  // before saving; the same department, or no new owner, says nothing.
  it("offers only the piece's own department's leads (I66.9)", () => {
    view()
    const owner = screen.getByTestId('campaign-deliverable-form-owner')
    fireEvent.focus(owner)
    fireEvent.change(owner, { target: { value: 'Omar' } })
    expect(screen.queryByRole('option', { name: /Omar Lead/ })).toBeNull()
  })

  it('a piece whose department has no lead offers every lead, and says where a new owner moves it', () => {
    view({ piece: piece({ departmentId: 'strategy' }) })
    expect(screen.queryByTestId('campaign-deliverable-form-department-moves')).toBeNull()
    const owner = screen.getByTestId('campaign-deliverable-form-owner')
    fireEvent.focus(owner)
    fireEvent.change(owner, { target: { value: 'Omar' } })
    fireEvent.mouseDown(screen.getByRole('option', { name: /Omar Lead/ }))
    expect(screen.getByTestId('campaign-deliverable-form-department-moves')).toHaveTextContent('Moves to Live streams with the new owner.')
  })

  it('nothing changed: Save writes nothing and closes', async () => {
    const props = view()
    await save()
    expect(m.update).not.toHaveBeenCalled()
    expect(m.move).not.toHaveBeenCalled()
    expect(m.reassign).not.toHaveBeenCalled()
    expect(props.onClose).toHaveBeenCalled()
  })

  it('a blank name is refused in the dialog', async () => {
    const props = view()
    fireEvent.change(screen.getByTestId('campaign-deliverable-form-name'), { target: { value: '   ' } })
    await save()
    expect(screen.getByTestId('campaign-deliverable-form-error')).toBeInTheDocument()
    expect(m.update).not.toHaveBeenCalled()
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('after approval the due date opens the evidenced dialog — never a free date — and hands back', () => {
    view()
    expect(screen.getByTestId('campaign-deliverable-form-due').tagName).toBe('BUTTON')
    fireEvent.click(screen.getByTestId('campaign-deliverable-form-due'))
    expect(screen.getByTestId('deliverable-due-change-dialog')).toHaveTextContent('d1')
    expect(screen.queryByTestId('campaign-deliverable-form')).toBeNull()
    fireEvent.click(screen.getByTestId('deliverable-due-change-cancel'))
    expect(screen.getByTestId('campaign-deliverable-form')).toBeInTheDocument()
  })

  it('before approval, or without the right to change the promise, the date is read, not offered', () => {
    view({ campaignApproved: false })
    expect(screen.queryByTestId('campaign-deliverable-form-due')).toBeNull()
    expect(screen.getByTestId('campaign-deliverable-form-due-fixed')).toHaveTextContent(/24/)
  })

  it('no phase move, no owner change without the grant: both read, and Save writes neither', async () => {
    m.grants = new Set(['project_tasks:manage'])
    view({ canMovePhase: false })
    expect(screen.queryByTestId('campaign-deliverable-form-phase')).toBeNull()
    expect(screen.getByTestId('campaign-deliverable-form-phase-fixed')).toHaveTextContent('1. Week 1')
    expect(screen.queryByTestId('campaign-deliverable-form-owner')).toBeNull()
    expect(screen.getByTestId('campaign-deliverable-form-owner-fixed')).toHaveTextContent('Fadia Lead')
  })

  it('closing asks first, itemising the live work, and only then archives', () => {
    const props = view()
    fireEvent.click(screen.getByTestId('campaign-deliverable-form-close'))
    expect(m.transition).not.toHaveBeenCalled()
    expect(screen.getByTestId('campaign-deliverable-form-close-confirm-detail')).toHaveTextContent(/3 task/)
    expect(screen.getByTestId('campaign-deliverable-form-close-confirm-detail')).toHaveTextContent(/Zubaida/)
    // Cancel goes back to the form, nothing written.
    fireEvent.click(screen.getByTestId('campaign-deliverable-form-close-confirm-cancel'))
    expect(screen.getByTestId('campaign-deliverable-form')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('campaign-deliverable-form-close'))
    fireEvent.click(screen.getByTestId('campaign-deliverable-form-close-confirm-confirm'))
    expect(m.transition.mock.calls[0][0]).toEqual({ deliverableId: 'd1', to: 'archived', expectedState: 'in_progress' })
    m.transition.mock.calls[0][1].onSuccess()
    expect(props.onBanner).toHaveBeenCalledWith({ kind: 'ok', text: 'Deliverable closed.' })
  })

  it('offers no Close where the lifecycle or the grants do not allow it', () => {
    view({ piece: piece({ state: 'in_review' }) })
    expect(screen.queryByTestId('campaign-deliverable-form-close')).toBeNull()
  })

  it('a refusal is worded and not reportable; a failure is worded and reportable', async () => {
    m.update.mockRejectedValueOnce({ code: '42501', message: 'new row violates row-level security policy' })
    const props = view()
    fireEvent.change(screen.getByTestId('campaign-deliverable-form-name'), { target: { value: 'Not mine' } })
    await save()
    const refusal = (props.onBanner as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(refusal).toMatchObject({ kind: 'error', reportable: false })
    expect(refusal.text).not.toMatch(/row-level security/)

    m.update.mockRejectedValueOnce({ code: 'PGRST202', message: 'Could not find the function in the schema cache' })
    const again = view()
    fireEvent.change(screen.getAllByTestId('campaign-deliverable-form-name')[1], { target: { value: 'Will fail' } })
    await act(async () => {
      fireEvent.click(screen.getAllByTestId('campaign-deliverable-form-submit')[1])
    })
    const failure = (again.onBanner as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(failure).toMatchObject({ kind: 'error', reportable: true })
    expect(failure.text).not.toMatch(/schema cache/)
  })
})

/**
 * ADR-0110 + addendum (I59.23, CG-E2): on STARTED work, type, quantity and due date do not save —
 * Save opens the warning, which sends them to the owner as a change request; name, phase and owner
 * still save straight away (E6); who asked is required; the evidence is asked for, never required
 * (E5); one request is open per piece.
 */
describe('EditPieceDialog — a change to started work is a request (ADR-0110)', () => {
  const STARTED = {
    started: true,
    openRequest: null,
    escalationHours: 8,
    tasks: [
      { id: 't1', title: 'Concept', status: 'done', bookedHours: 4, timedHours: 3.5 },
      { id: 't2', title: 'Artwork', status: 'in_progress', bookedHours: 6, timedHours: 1 },
      { id: 't3', title: 'Copy', status: 'todo', bookedHours: 2, timedHours: 0 },
    ],
  }
  beforeEach(() => {
    for (const f of [m.update, m.move, m.reassign, m.transition, m.request, m.folder, m.file]) f.mockReset()
    m.update.mockResolvedValue(undefined)
    m.move.mockResolvedValue(undefined)
    m.reassign.mockResolvedValue(undefined)
    m.request.mockResolvedValue('req-1')
    m.folder.mockResolvedValue('refs')
    m.file.mockResolvedValue([{ ok: true, assetId: 'asset-1' }])
    m.grants = new Set(['project_tasks:manage', 'deliverable_owner:manage'])
    m.scope = 'tenant'
    m.context = STARTED
  })

  const pickOwner = (name: RegExp, typed: string) => {
    const owner = screen.getByTestId('campaign-deliverable-form-owner')
    fireEvent.focus(owner)
    fireEvent.change(owner, { target: { value: typed } })
    fireEvent.mouseDown(screen.getByRole('option', { name }))
  }
  const send = async () => {
    await act(async () => {
      fireEvent.click(screen.getByTestId('change-request-send'))
    })
  }

  it('not started: quantity saves straight away and no request opens', async () => {
    m.context = { ...STARTED, started: false }
    view()
    expect(screen.queryByTestId('campaign-deliverable-form-started')).toBeNull()
    fireEvent.change(screen.getByTestId('campaign-deliverable-form-quantity'), { target: { value: '3' } })
    await save()
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ quantity: 3 }))
    expect(screen.queryByTestId('change-request-dialog')).toBeNull()
    expect(m.request).not.toHaveBeenCalled()
  })

  it('started: says so, and a quantity change is NOT saved — the warning opens with before and after, and the cost', async () => {
    const p = view()
    expect(screen.getByTestId('campaign-deliverable-form-started')).toHaveTextContent('Fadia Lead')
    fireEvent.change(screen.getByTestId('campaign-deliverable-form-quantity'), { target: { value: '3' } })
    await save()
    expect(m.update).not.toHaveBeenCalled()
    expect(p.onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('change-request-change-quantity')).toHaveTextContent(/1.*→.*3/)
    expect(screen.queryByTestId('change-request-change-type')).toBeNull()
    // The work put in: the started tasks (not the one still to do), their booked and timed hours.
    expect(screen.getByTestId('change-request-cost-total')).toHaveTextContent('2 tasks started — 10 h booked, 4.5 h timed.')
    expect(screen.getByTestId('change-request-cost-task-t1')).toBeInTheDocument()
    expect(screen.queryByTestId('change-request-cost-task-t3')).toBeNull()
    expect(screen.getByTestId('change-request-lands')).toHaveTextContent('24')
    expect(screen.getByTestId('change-request-escalates')).toHaveTextContent(/Fadia Lead has until .*, then it escalates/)
    expect(screen.getByTestId('change-request-send')).toHaveTextContent('Send it to Fadia Lead as a change request')
    // A quantity is not a date: no evidence is asked for.
    expect(screen.queryByTestId('change-request-evidence')).toBeNull()
  })

  it('no escalation rule: no clock line', async () => {
    m.context = { ...STARTED, escalationHours: null }
    view()
    fireEvent.change(screen.getByTestId('campaign-deliverable-form-quantity'), { target: { value: '3' } })
    await save()
    expect(screen.queryByTestId('change-request-escalates')).toBeNull()
  })

  it('who asked is required: Send without it says so and sends nothing', async () => {
    view()
    fireEvent.change(screen.getByTestId('campaign-deliverable-form-quantity'), { target: { value: '3' } })
    await save()
    await send()
    expect(screen.getByTestId('change-request-error')).toHaveTextContent('Say who asked for this')
    expect(m.request).not.toHaveBeenCalled()
  })

  it('Send: request_deliverable_change with the changes, who asked and the cost; the page is told', async () => {
    const p = view()
    fireEvent.change(screen.getByTestId('campaign-deliverable-form-quantity'), { target: { value: '3' } })
    await save()
    fireEvent.click(screen.getByTestId('change-request-asked-by-us'))
    await send()
    expect(m.request).toHaveBeenCalledWith({
      deliverableId: 'd1',
      changes: { quantity: { to: '3' } },
      askedBy: 'us',
      cost: { started_tasks: 2, booked_hours: 10, timed_hours: 4.5, lands_on: '2099-09-24' },
      evidenceAssetId: null,
    })
    expect(p.onBanner).toHaveBeenCalledWith({ kind: 'ok', text: 'Sent to Fadia Lead as a change request.' })
    expect(p.onClose).toHaveBeenCalled()
  })

  it('Keep it as it was sends nothing and closes', async () => {
    const p = view()
    fireEvent.change(screen.getByTestId('campaign-deliverable-form-quantity'), { target: { value: '3' } })
    await save()
    fireEvent.click(screen.getByTestId('change-request-keep'))
    expect(m.request).not.toHaveBeenCalled()
    expect(p.onClose).toHaveBeenCalled()
  })

  it('the name saves straight away, its type and quantity written back unchanged; the quantity is asked', async () => {
    const p = view()
    fireEvent.change(screen.getByTestId('campaign-deliverable-form-name'), { target: { value: 'Post 2' } })
    fireEvent.change(screen.getByTestId('campaign-deliverable-form-quantity'), { target: { value: '2' } })
    await save()
    expect(m.update).toHaveBeenCalledWith({ campaignId: 'cam', deliverableId: 'd1', name: 'Post 2', deliverableTypeId: 'type-carousel', quantity: 1 })
    // I59.47 (option A): no notice while the change request is still being asked.
    expect(p.onBanner).not.toHaveBeenCalled()
    expect(screen.getByTestId('change-request-change-quantity')).toBeInTheDocument()
  })

  it('E6: the owner saves straight away, with no request, even on started work', async () => {
    const p = view()
    pickOwner(/Walid Lead/, 'Walid')
    await save()
    expect(m.reassign).toHaveBeenCalledWith({ deliverableId: 'd1', ownerUserId: 'walid' })
    expect(screen.queryByTestId('change-request-dialog')).toBeNull()
    expect(p.onClose).toHaveBeenCalled()
  })

  it('a new owner and a new quantity: the owner saves, and the request goes to the NEW owner', async () => {
    view()
    pickOwner(/Walid Lead/, 'Walid')
    fireEvent.change(screen.getByTestId('campaign-deliverable-form-quantity'), { target: { value: '2' } })
    await save()
    expect(m.reassign).toHaveBeenCalled()
    expect(screen.getByTestId('change-request-send')).toHaveTextContent('Walid Lead')
  })

  it('the due date is a day on started work; a new one asks for evidence, and Send goes without it (E5)', async () => {
    view()
    expect(screen.queryByTestId('campaign-deliverable-form-due')).toBeNull()
    fireEvent.change(screen.getByTestId('campaign-deliverable-form-due-day'), { target: { value: '2099-09-30' } })
    await save()
    expect(screen.getByTestId('change-request-change-due')).toHaveTextContent('30')
    expect(screen.getByTestId('change-request-evidence')).toBeInTheDocument()
    expect(screen.getByTestId('change-request-lands')).toHaveTextContent('30')
    fireEvent.click(screen.getByTestId('change-request-asked-by-client'))
    await send()
    expect(m.file).not.toHaveBeenCalled()
    expect(m.request).toHaveBeenCalledWith(expect.objectContaining({
      changes: { due: { to: '2099-09-30' } }, askedBy: 'client', evidenceAssetId: null,
    }))
  })

  it('evidence given is filed in the campaign References first, then named to the request', async () => {
    view()
    fireEvent.change(screen.getByTestId('campaign-deliverable-form-due-day'), { target: { value: '2099-09-30' } })
    await save()
    const f = new File(['ok'], 'client-email.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByTestId('change-request-evidence'), { target: { files: [f] } })
    fireEvent.click(screen.getByTestId('change-request-asked-by-client'))
    await send()
    expect(m.folder).toHaveBeenCalledWith('cam')
    expect(m.file).toHaveBeenCalledWith({ folderId: 'refs', clientId: 'client', files: [f] })
    expect(m.request).toHaveBeenCalledWith(expect.objectContaining({ evidenceAssetId: 'asset-1' }))
  })

  it('without the right to move the promise, the date on started work is read, not offered', () => {
    view({ canChangePromise: false })
    expect(screen.queryByTestId('campaign-deliverable-form-due-day')).toBeNull()
    expect(screen.getByTestId('campaign-deliverable-form-due-fixed')).toBeInTheDocument()
  })

  it('a phase move whose date follows puts the new phase day on the request, not the evidenced dialog', async () => {
    const { phaseDueDate, IRAQ_WORKING_CALENDAR } = await import('../../../lib/timing/plan-back')
    view()
    fireEvent.change(screen.getByTestId('campaign-deliverable-form-phase'), { target: { value: 'p2' } })
    await save()
    expect(m.move).toHaveBeenCalledWith({ campaignId: 'cam', deliverableId: 'd1', phaseId: 'p2' })
    expect(screen.queryByTestId('campaign-deliverable-form-due-move-dialog')).toBeNull()
    fireEvent.click(screen.getByTestId('change-request-asked-by-us'))
    await send()
    expect(m.request).toHaveBeenCalledWith(expect.objectContaining({
      changes: { due: { to: phaseDueDate({ endsOn: '2099-10-02' }, IRAQ_WORKING_CALENDAR) } },
    }))
  })

  it('E7: on started work the type note says a new type goes to the owner', () => {
    view()
    expect(screen.getByTestId('campaign-deliverable-form-type-note')).toHaveTextContent('goes to the owner as a change request')
  })

  it('one open per piece: the form says so, and Save shows it instead of starting another', async () => {
    m.context = {
      ...STARTED,
      openRequest: {
        id: 'r0', deliverableId: 'd1', status: 'pending', requestedBy: 'am', requestedByName: 'Nadia AM',
        changes: { due: { from: '2099-09-24 15:00:00+00', to: '2099-10-01' } }, askedBy: 'client',
        declineReason: null, counterText: null, counterDate: null, createdAt: '2099-09-20T10:00:00Z', closedAt: null,
      },
    }
    view()
    expect(screen.getByTestId('campaign-deliverable-form-open-request')).toHaveTextContent('Change requested · waiting on Fadia Lead')
    fireEvent.change(screen.getByTestId('campaign-deliverable-form-quantity'), { target: { value: '3' } })
    await save()
    expect(screen.getByTestId('change-request-already-open')).toBeInTheDocument()
    expect(screen.getByTestId('change-request-open-changes')).toHaveTextContent(/24.*→.*1/)
    expect(screen.queryByTestId('change-request-send')).toBeNull()
    expect(m.request).not.toHaveBeenCalled()
  })

  it('a refusal from the database is shown worded in the warning', async () => {
    m.request.mockRejectedValueOnce({ code: '55000', message: 'a change request on this deliverable is already open — it is answered first' })
    view()
    fireEvent.change(screen.getByTestId('campaign-deliverable-form-quantity'), { target: { value: '3' } })
    await save()
    fireEvent.click(screen.getByTestId('change-request-asked-by-client'))
    await send()
    expect(screen.getByTestId('change-request-error')).toHaveTextContent('already open')
  })
})
