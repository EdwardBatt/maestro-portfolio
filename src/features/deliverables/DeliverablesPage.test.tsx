import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import '../../lib/i18n'
import type { DeliverableRow, DeliverableDetail, SubTaskRow } from './api/deliverables-api'

/**
 * DeliverablesPage (ADR-0024, I2 Team Lead breakdown surface). The page is presentation over
 * the feature API + the pure state-machine; the api module reaches lib/env (throws in CI), so
 * it's mocked wholesale. The transition logic itself stays real (state-machine is pure) so the
 * test proves the surface offers exactly the transitions a caller's grants permit.
 */

const state = vi.hoisted(() => ({
  campaigns: [] as { id: string; name: string }[],
  /** I68.13: the campaign an old `?open=` link's deliverable belongs to, as the look-up answers (undefined = not asked). */
  pieceCampaign: undefined as string | null | undefined,
  deliverables: [] as DeliverableRow[],
  detail: null as DeliverableDetail | null,
  users: [] as { id: string; name: string; departmentId: string | null; teamId: string | null }[],
  leads: null as null | { id: string; name: string; departmentId: string | null; teamId: string | null; scope?: string | null }[],
  scope: 'tenant' as string | null,
  canManage: true,
  canReview: false,
  pendingRequests: new Map<string, { departmentName: string | null }>(),
  transitionMutate: vi.fn(),
  reassign: vi.fn(),
  removeTask: vi.fn(),
  resequence: vi.fn(),
  canReassign: false,
  upsertMutate: vi.fn(),
  cancelMutate: vi.fn(),
  requestChangesMutate: vi.fn(),
  approveMutate: vi.fn(),
  reviewers: [{ id: 'rev1', name: 'Reviewer One' }],
  adhoc: [] as DeliverableRow[],
  approveTasksMutate: vi.fn(),
  reminder: null as string | null,
  myUserId: 'me',
}))

// ADR-0069 (I36.4/I36.5): the Required input column and the external-inputs panel. Self-contained
// factory — the real module reaches lib/supabase → lib/env, which throws where no VITE_* exists.
const dependencies = vi.hoisted(() => ({ data: [] as unknown[] }))
const pendingInputs = vi.hoisted(() => ({ data: [] as unknown[] }))
vi.mock('./api/requirements-api', () => ({
  useTaskDependencies: () => dependencies,
  useRequirementCandidates: () => ({ data: [] }),
  usePendingInputs: () => pendingInputs,
  useAddDependency: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveDependency: () => ({ mutate: vi.fn(), isPending: false }),
  useAddPendingInput: () => ({ mutate: vi.fn(), isPending: false }),
  useMarkInputArrived: () => ({ mutate: vi.fn(), isPending: false }),
  isCyclicDependency: (e: unknown) => (e as { code?: string } | null)?.code === '22023',
  isRequirementMet: (status: string) => status === 'done' || status === 'cancelled',
}))

const reinstateMutate = vi.hoisted(() => vi.fn())
const cancelImpact = vi.hoisted(() => ({ value: { bookings: 2, isPlan: false, isAdhoc: false } }))

vi.mock('./api/deliverables-api', () => ({
  // ADR-0090: the owner's approval of the generated list, and the SJ-03 reminder above it.
  useApproveDeliverableTasks: () => ({ mutate: state.approveTasksMutate, isPending: false }),
  useTaskListReminder: () => ({ data: state.reminder }),
  useTaskListRules: () => ({ data: [] }),
  isHeldForOwnerReview: (row: { campaignKind: string | null; tasksApprovedAt: string | null }) =>
    row.campaignKind === 'single_job' && row.tasksApprovedAt === null,
  useCampaignOptions: () => ({ data: state.campaigns, isLoading: false, isError: false }),
  useCampaignDeliverables: () => ({ data: state.deliverables, isLoading: false, isError: false }),
  // The Ad-hoc tab's read-only archive.
  useAdhocDeliverables: () => ({ data: state.adhoc, isLoading: false, isError: false }),
  useDeliverable: () => ({ data: state.detail, isLoading: false, isError: false }),
  useDeliverableOfTask: () => ({ data: null, isLoading: false, isError: false }),
  useAssignableUsers: () => ({ data: state.users, isLoading: false, isError: false }),
  // ADR-0083 d.9: the owner picker offers leads. The fixture reuses `state.users`, so existing
  // owner-control assertions keep their people; `state.leads` narrows it where a test needs to.
  useDeliverableOwnerCandidates: () => ({ data: state.leads ?? state.users, isLoading: false, isError: false }),
  // I22.4 (ADR-0055): the owner control. Mocked flat — the reassign path itself is proven in
  // pgTAP 062, where the trigger rather than the RPC is what refuses.
  useReassignDeliverable: () => ({ mutate: state.reassign, isPending: false }),
  // I19.9 (ADR-0052 d.13): the remove control. What the SERVER does — delete a plan, cancel work
  // somebody started — is proven in pgTAP 065; this mock covers only what the surface decides.
  useRemoveSubTask: () => ({ mutate: state.removeTask, isPending: false }),
  // ADR-0068: reinstate, and the impact the confirmation reports before anything happens.
  useReinstateSubTask: () => ({ mutate: reinstateMutate, isPending: false }),
  fetchCancelImpact: vi.fn(async () => cancelImpact.value),
  // I19.9 (ADR-0052 d.14): the reorder control. That it writes sort_order and NOT the dates
  // is proven in pgTAP 065; here the question is only what order the surface asks for.
  useResequenceDeliverableTasks: () => ({ mutate: state.resequence, isPending: false }),
  useTransitionDeliverable: () => ({ mutate: state.transitionMutate, isPending: false }),
  useUpsertSubTask: () => ({ mutate: state.upsertMutate, isPending: false }),
  // A task is now CANCELLED, not destroyed — the row survives for the record.
  useCancelSubTask: () => ({ mutate: state.cancelMutate, isPending: false }),
  useRequestChangesSubTask: () => ({ mutate: state.requestChangesMutate, isPending: false }),
  useApproveSubTask: () => ({ mutate: state.approveMutate, isPending: false }),
  // ADR-0089 d.5: the optional reviewer's answer, and the label the server would give it.
  useRespondSubTask: () => ({ mutate: vi.fn(), isPending: false }),
  useMyResponseKind: () => ({ data: 'no_comment', isLoading: false, isError: false }),
  // ADR-0038: the add form now names a reviewer, so the picker has to resolve.
  useReviewers: () => ({ data: state.reviewers ?? [], isLoading: false, isError: false }),
}))

// The deliverable detail now renders <ReviewPanel>, whose review-api reaches lib/env in CI —
// stub it so the detail mounts. (Its own behaviour is covered in ReviewPanel.test.tsx.)
vi.mock('./api/review-api', () => ({
  useDeliverableVersions: () => ({ data: [], isLoading: false, isError: false }),
  useUploadVersion: () => ({ mutate: vi.fn(), isPending: false }),
  useVersionViewUrl: () => ({ data: null, isLoading: false, isError: false }),
  useVersionComments: () => ({ data: [], isLoading: false, isError: false }),
  useAddComment: () => ({ mutate: vi.fn(), isPending: false }),
  useResolveComment: () => ({ mutate: vi.fn(), isPending: false }),
}))

// ReviewPanel imports auth-context directly (I3.2); stub it so the real lib/env (which needs
// VITE_* and throws in CI) never loads through this suite.
vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'self-id' } }, claims: { tenantId: 't1' }, ready: true, signOut: vi.fn() }),
}))

// ChatPanel is covered by its own suite; stub it here (it reaches chat-api → lib/env in CI).
vi.mock('../chat/ChatPanel', () => ({ ChatPanel: () => null }))
// I68.13: the look-up an old bare link makes; the forwarding rule itself (`openLinkTarget`) is the real one.
vi.mock('../../lib/navigation/piece-campaign', async (orig) => ({
  ...(await orig<typeof import('../../lib/navigation/piece-campaign')>()),
  usePieceCampaign: (id: string | null) => ({
    isSuccess: Boolean(id) && state.pieceCampaign !== undefined,
    data: state.pieceCampaign ?? null,
  }),
  // A `?task=` link with no `?open=` looks its piece up (I74); these tests always name the piece.
  useTaskPiece: () => ({ data: null }),
}))

// ADR-0087 d.11: the "awaiting approval from …" line. Nothing pending in these tests; the line has
// its own assertion below. The real module reaches lib/supabase → lib/env.
vi.mock('../../lib/assignment-requests/api', () => ({
  usePendingAssignmentRequestsForTasks: () => ({ data: state.pendingRequests, isLoading: false }),
}))
// ADR-0088: the extension line on each task row reads its own api module (→ lib/env in CI).
vi.mock('./api/extensions-api', () => ({
  useLatestExtensionByTask: () => ({ data: new Map() }),
  useRequestExtension: () => ({ mutate: vi.fn(), isPending: false }),
  useWithdrawExtension: () => ({ mutate: vi.fn(), isPending: false }),
  useDecideExtension: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
  isRefused: () => false,
}))

// TaskResources has its own suite. Stubbed here for the reason ChatPanel is: it reaches
// api/task-resources-api → lib/supabase → lib/env, which THROWS when the VITE_ vars are absent.
// They are absent in CI and present locally, so leaving it real passes on a laptop and fails on the
// runner. Any new api module has to be mocked in every suite that reaches it, however indirectly.
vi.mock('./TaskResources', () => ({
  TaskResources: ({ subTaskId }: { subTaskId: string }) => (
    <div data-testid={`task-resources-stub-${subTaskId}`} />
  ),
}))

// The SLA-profile picker (targets-at-assignment) reads sla-api → lib/env in CI; stub the list.
vi.mock('../sla/api/sla-api', () => ({
  useSlaProfiles: () => ({
    data: [
      { id: 'sp1', name: 'Standard', workTypeId: null, workTypeName: null, turnaroundHours: 48, isDefault: false },
    ],
    isLoading: false,
    isError: false,
  }),
}))

vi.mock('../../app/permissions', () => ({
  usePermissions: () => ({
    scope: state.scope,
    can: (k: string) =>
      k === 'project_tasks:manage'
        ? state.canManage
        : k === 'reviews:moderate'
          ? state.canReview
          : k === 'deliverable_owner:manage'
            ? state.canReassign
            : false,
  }),
}))

// I41.10/I41.11: the extension arithmetic reads the tenant's buffer and calendar; the defaults here.
vi.mock('../../lib/deadlines/use-extension-context', () => ({
  useExtensionContext: () => ({ reviewBufferWorkingDays: 1, workingDays: [7, 1, 2, 3, 4], closures: [] }),
}))

import { DeliverablesPage } from './DeliverablesPage'

const CAMPAIGN = { id: 'cam1', name: 'Spring Launch' }

// Carries `goLiveAt` so `{ ...DRAFT, subTasks }` below satisfies `DeliverableDetail` (ADR-0088).
const DRAFT: DeliverableRow & { goLiveAt: string | null } = {
  id: 'd1',
  name: 'Hero Key Visual',
  state: 'draft',
  dueAt: '2026-09-01T00:00:00Z',
  goLiveAt: null,
  revisionRound: 0,
  revisionLimit: 3,
  streamId: 's1',
  workstreamId: null,
  streamName: 'Art',
  discipline: 'Art Direction',
  departmentId: null,
  ownerUserId: null,
  ownerName: null,
  typeName: null,
  taskCount: 0,
  unassignedCount: 0,
  // ADR-0132 d.8: a row that names its campaign is edited on the campaign page, not in this window. The
  // window's own tests therefore use a row with no campaign on it — the ad-hoc path that still opens here.
  campaignId: null,
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
}

const IN_REVIEW: DeliverableRow = { ...DRAFT, id: 'd2', name: 'Launch Film', state: 'in_review', revisionRound: 1 }

const SUBTASK: SubTaskRow = {
  id: 'st1',
  deliverableId: 'd1',
  title: 'Retouch',
  description: null,
  assigneeId: 'u1',
  assigneeName: 'Lina',
  departmentId: 'dep1',
  teamId: 'team1',
  slaHours: 6,
  slaProfileId: null,
  slaProfileName: null,
  slaProfileHours: null,
  startsAt: '2026-08-20T09:00:00Z',
  dueAt: '2026-08-21T00:00:00Z',
  committedDueAt: null,
  status: 'in_progress',
  scheduleOverridden: false,
  sortOrder: 1,
  createdAt: '2026-08-18T10:00:00Z',
  reviewers: [],
  reviewMode: 'digital',
}

function WhereAmI() {
  const l = useLocation()
  return <p data-testid="where-am-i">{`${l.pathname}${l.search}`}</p>
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DeliverablesPage />
    </MemoryRouter>,
  )
}

function pickCampaign() {
  fireEvent.change(screen.getByTestId('deliverables-campaign'), { target: { value: 'cam1' } })
}

describe('DeliverablesPage (ADR-0024, I2 breakdown surface)', () => {
  beforeEach(() => {
    state.campaigns = [CAMPAIGN]
    state.deliverables = []
    state.detail = null
    state.users = [{ id: 'u1', name: 'Lina', departmentId: 'dep1', teamId: 'team1' }]
    state.canManage = true
    state.canReview = false
    state.reviewers = [{ id: 'rev1', name: 'Reviewer One' }]
    state.transitionMutate = vi.fn()
    state.upsertMutate = vi.fn()
    state.cancelMutate = vi.fn()
    state.requestChangesMutate = vi.fn()
  })

  it('prompts for a campaign until one is picked', () => {
    renderPage()
    expect(screen.getByTestId('deliverables-pick')).toBeInTheDocument()
  })

  it('shows the empty state when a picked campaign has no deliverables', () => {
    renderPage()
    pickCampaign()
    expect(screen.getByTestId('deliverables-empty')).toBeInTheDocument()
  })

  it('lists deliverables with state + the transitions a manager may perform', () => {
    state.deliverables = [DRAFT]
    renderPage()
    pickCampaign()
    const row = screen.getByTestId('deliverable-row-d1')
    expect(row).toHaveTextContent('Hero Key Visual')
    // I40.22: the column shows where the WORK is, from the tasks — not the deliverable's stored
    // state, which read "In progress" from the moment it existed. This fixture carries no tasks.
    expect(row).toHaveTextContent('No tasks yet')
    expect(row).toHaveTextContent('0 / 3')
    // ADR-0118 d.5: draft offers only archive — it starts when its first task does, not on a Start press.
    expect(screen.queryByTestId('deliverable-start-d1')).not.toBeInTheDocument()
    expect(screen.getByTestId('deliverable-archive-d1')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('deliverable-archive-d1'))
    expect(state.transitionMutate).toHaveBeenCalledWith(
      expect.objectContaining({ deliverableId: 'd1', to: 'archived', expectedState: 'draft' }),
      expect.anything(),
    )
  })

  // ADR-0118 d.2 and d.5: no Approve and no Request changes on a deliverable, for anyone — its tasks
  // are reviewed, and it follows them.
  it('an in-review deliverable offers no Approve or Request changes, to a manager or a reviewer', () => {
    state.deliverables = [IN_REVIEW]
    renderPage()
    pickCampaign()
    expect(screen.queryByTestId('deliverable-approve-d2')).not.toBeInTheDocument()
    expect(screen.queryByTestId('deliverable-requestChanges-d2')).not.toBeInTheDocument()
    cleanup()
    state.canManage = false
    state.canReview = true
    renderPage()
    pickCampaign()
    expect(screen.queryByTestId('deliverable-approve-d2')).not.toBeInTheDocument()
    expect(screen.queryByTestId('deliverable-requestChanges-d2')).not.toBeInTheDocument()
  })

  it('an in-progress deliverable is not sent to review by hand (ADR-0118 d.5)', () => {
    state.deliverables = [{ ...DRAFT, state: 'in_progress' as const }]
    renderPage()
    pickCampaign()
    expect(screen.queryByTestId('deliverable-submit-d1')).not.toBeInTheDocument()
    expect(screen.getByTestId('deliverable-block-d1')).toBeInTheDocument()
  })

  // It used to render inline UNDER the table. On a tab with dozens of live items you would select
  // something near the top and the panel appeared past the fold, so it read as "nothing happened".
  it('opens a campaign\'s deliverable on its campaign page, in the piece\'s panel (ADR-0132 d.8)', () => {
    state.deliverables = [{ ...DRAFT, campaignId: 'cam1' }]
    render(
      <MemoryRouter initialEntries={['/deliverables']}>
        <Routes>
          <Route path="/deliverables" element={<DeliverablesPage />} />
          <Route path="/campaigns/:id" element={<WhereAmI />} />
        </Routes>
      </MemoryRouter>,
    )
    pickCampaign()
    fireEvent.click(screen.getByTestId('deliverable-open-d1'))
    expect(screen.queryByTestId('deliverable-detail-dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('where-am-i')).toHaveTextContent('/campaigns/cam1?piece=d1')
  })

  it('forwards an old link that opens a campaign\'s deliverable here to its campaign page', () => {
    state.deliverables = [{ ...DRAFT, campaignId: 'cam1' }]
    render(
      <MemoryRouter initialEntries={['/deliverables?campaign=cam1&open=d1']}>
        <Routes>
          <Route path="/deliverables" element={<DeliverablesPage />} />
          <Route path="/campaigns/:id" element={<WhereAmI />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('where-am-i')).toHaveTextContent('/campaigns/cam1?piece=d1')
  })

  it('forwards a bare old link (no campaign named) by looking the campaign up (I68.13)', () => {
    state.pieceCampaign = 'cam9'
    render(
      <MemoryRouter initialEntries={['/deliverables?open=d9&task=t9']}>
        <Routes>
          <Route path="/deliverables" element={<DeliverablesPage />} />
          <Route path="/campaigns/:id" element={<WhereAmI />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('where-am-i')).toHaveTextContent('/campaigns/cam9?piece=d9&task=t9')
    state.pieceCampaign = undefined
  })

  it('opens the detail in a modal, not inline below the list', () => {
    state.deliverables = [DRAFT]
    state.detail = { ...DRAFT, subTasks: [SUBTASK] }
    renderPage()
    pickCampaign()
    expect(screen.queryByTestId('deliverable-detail-dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('deliverable-open-d1'))
    const dialog = screen.getByTestId('deliverable-detail-dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    // The detail lives INSIDE the dialog — that is the whole point of the change.
    expect(dialog).toContainElement(screen.getByTestId('deliverable-detail'))
  })

  it('closes the modal', () => {
    state.deliverables = [DRAFT]
    state.detail = { ...DRAFT, subTasks: [SUBTASK] }
    renderPage()
    pickCampaign()
    fireEvent.click(screen.getByTestId('deliverable-open-d1'))
    fireEvent.click(screen.getByTestId('deliverable-detail-close'))
    expect(screen.queryByTestId('deliverable-detail-dialog')).not.toBeInTheDocument()
  })

  it('opening a deliverable reveals its sub-tasks and the add form for managers', () => {
    state.deliverables = [DRAFT]
    state.detail = { ...DRAFT, subTasks: [SUBTASK] }
    renderPage()
    pickCampaign()
    fireEvent.click(screen.getByTestId('deliverable-open-d1'))
    expect(screen.getByTestId('deliverable-detail')).toBeInTheDocument()
    expect(screen.getByTestId('subtask-row-st1')).toHaveTextContent('Retouch')
    expect(screen.getByTestId('subtask-row-st1')).toHaveTextContent('Lina')
    expect(screen.getByTestId('subtask-add-open')).toBeInTheDocument()
    expect(screen.getByTestId('subtask-cancel-st1')).toBeInTheDocument()
  })

  it('non-managers get a read-only breakdown — no add form, no cancel', () => {
    state.deliverables = [DRAFT]
    state.detail = { ...DRAFT, subTasks: [SUBTASK] }
    state.canManage = false
    state.canReview = true
    renderPage()
    pickCampaign()
    fireEvent.click(screen.getByTestId('deliverable-open-d1'))
    expect(screen.getByTestId('subtask-row-st1')).toBeInTheDocument()
    expect(screen.queryByTestId('subtask-add-open')).not.toBeInTheDocument()
    expect(screen.queryByTestId('subtask-cancel-st1')).not.toBeInTheDocument()
  })

  it('offers the SLA-profile picker and passes the chosen profile into the assignment (targets-at-assignment)', () => {
    state.deliverables = [DRAFT]
    state.detail = { ...DRAFT, subTasks: [] }
    renderPage()
    pickCampaign()
    fireEvent.click(screen.getByTestId('deliverable-open-d1'))
    fireEvent.click(screen.getByTestId('subtask-add-open')) // I51.5: the form is a dialog
    expect(screen.getByTestId('subtask-sla-profile')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('subtask-title'), { target: { value: 'Grade' } })
    fireEvent.change(screen.getByTestId('subtask-sla-profile'), { target: { value: 'sp1' } })
    fireEvent.submit(screen.getByTestId('subtask-add-form'))
    expect(state.upsertMutate).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Grade', slaProfileId: 'sp1' }),
      expect.anything(),
    )
  })

  it('shows the inherited-SLA fallback when a sub-task has neither manual hours nor a profile', () => {
    state.deliverables = [DRAFT]
    state.detail = { ...DRAFT, subTasks: [{ ...SUBTASK, id: 'st5', slaHours: null, slaProfileId: null, slaProfileName: null, slaProfileHours: null }] }
    renderPage()
    pickCampaign()
    fireEvent.click(screen.getByTestId('deliverable-open-d1'))
    expect(screen.getByTestId('subtask-sla-st5')).toHaveTextContent('Inherited')
  })

  it('a reviewer can request changes on a submitted (review) sub-task (ADR-0030)', () => {
    state.deliverables = [DRAFT]
    state.detail = { ...DRAFT, subTasks: [{ ...SUBTASK, id: 'st9', status: 'review' }] }
    state.canManage = false
    state.canReview = true
    renderPage()
    pickCampaign()
    fireEvent.click(screen.getByTestId('deliverable-open-d1'))
    fireEvent.click(screen.getByTestId('subtask-request-changes-st9'))
    expect(state.requestChangesMutate).toHaveBeenCalledWith('st9', expect.anything())
  })

  it('offers no Request Changes on a sub-task that is not in review', () => {
    state.deliverables = [DRAFT]
    state.detail = { ...DRAFT, subTasks: [SUBTASK] } // in_progress
    state.canManage = false
    state.canReview = true
    renderPage()
    pickCampaign()
    fireEvent.click(screen.getByTestId('deliverable-open-d1'))
    expect(screen.queryByTestId('subtask-request-changes-st1')).not.toBeInTheDocument()
  })

  // ---------------------------------------------------------------- ADR-0043 ----

  it('appoints SEVERAL reviewers, with mandatory set per person', () => {
    state.deliverables = [DRAFT]
    state.detail = { ...DRAFT, subTasks: [] }
    state.users = [{ id: 'u1', name: 'Lina', departmentId: 'dep1', teamId: 'team1' }]
    state.reviewers = [{ id: 'rev1', name: 'Reviewer One' }, { id: 'rev2', name: 'Reviewer Two' }]
    renderPage()
    pickCampaign()
    fireEvent.click(screen.getByTestId('deliverable-open-d1'))

    fireEvent.click(screen.getByTestId('subtask-add-open')) // I51.5: the form is a dialog
    fireEvent.change(screen.getByTestId('subtask-title'), { target: { value: 'Retouch' } })
    fireEvent.change(screen.getByTestId('subtask-assignee'), { target: { value: 'u1' } })
    fireEvent.change(screen.getByTestId('subtask-reviewer-add'), { target: { value: 'rev1' } })
    fireEvent.change(screen.getByTestId('subtask-reviewer-add'), { target: { value: 'rev2' } })
    fireEvent.change(screen.getByTestId('subtask-hours'), { target: { value: '4' } }) // E11
    // ADR-0089 d.3: the first person added is the required one; the mark moves by ticking the
    // other person first, then unticking. A brand-compliance sign-off that cannot be skipped, next
    // to a second pair of eyes that can.
    fireEvent.click(screen.getByTestId('subtask-reviewer-mandatory-rev2'))
    fireEvent.click(screen.getByTestId('subtask-reviewer-mandatory-rev1'))
    fireEvent.click(screen.getByTestId('subtask-add-submit'))

    expect(state.upsertMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewers: [
          { userId: 'rev1', isMandatory: false },
          { userId: 'rev2', isMandatory: true },
        ],
      }),
      expect.anything(),
    )
  })

  it('refuses to assign work with nobody appointed to review it (ADR-0043 d.4)', () => {
    state.deliverables = [DRAFT]
    state.detail = { ...DRAFT, subTasks: [] }
    state.users = [{ id: 'u1', name: 'Lina', departmentId: 'dep1', teamId: 'team1' }]
    renderPage()
    pickCampaign()
    fireEvent.click(screen.getByTestId('deliverable-open-d1'))
    fireEvent.click(screen.getByTestId('subtask-add-open')) // I51.5: the form is a dialog
    fireEvent.change(screen.getByTestId('subtask-title'), { target: { value: 'Retouch' } })
    fireEvent.change(screen.getByTestId('subtask-assignee'), { target: { value: 'u1' } })
    fireEvent.click(screen.getByTestId('subtask-add-submit'))
    expect(state.upsertMutate).not.toHaveBeenCalled()
  })

  it('refuses to assign work without its hours, and says so (E11, I59)', () => {
    state.deliverables = [DRAFT]
    state.detail = { ...DRAFT, subTasks: [] }
    state.users = [{ id: 'u1', name: 'Lina', departmentId: 'dep1', teamId: 'team1' }]
    state.reviewers = [{ id: 'rev1', name: 'Reviewer One' }]
    renderPage()
    pickCampaign()
    fireEvent.click(screen.getByTestId('deliverable-open-d1'))
    fireEvent.click(screen.getByTestId('subtask-add-open'))
    fireEvent.change(screen.getByTestId('subtask-title'), { target: { value: 'Retouch' } })
    fireEvent.change(screen.getByTestId('subtask-assignee'), { target: { value: 'u1' } })
    fireEvent.change(screen.getByTestId('subtask-reviewer-add'), { target: { value: 'rev1' } })
    fireEvent.click(screen.getByTestId('subtask-add-submit'))
    expect(state.upsertMutate).not.toHaveBeenCalled()
    expect(screen.getByTestId('subtask-add-error')).toHaveTextContent('hours')
    fireEvent.change(screen.getByTestId('subtask-hours'), { target: { value: '6' } })
    fireEvent.click(screen.getByTestId('subtask-add-submit'))
    expect(state.upsertMutate).toHaveBeenCalledWith(expect.objectContaining({ assigneeId: 'u1', slaHours: 6 }), expect.anything())
  })

  // ADR-0087 d.11: wherever a task's status is shown, a task with a booking request out says
  // which department it is waiting on. The request is the lead's to answer, not this page's, so
  // the line is a statement, not a control.
  it('says a task is awaiting approval from the department its booking request went to (ADR-0087 d.11)', () => {
    state.deliverables = [DRAFT]
    state.detail = { ...DRAFT, subTasks: [{ ...SUBTASK, id: 'stq', status: 'todo' }, { ...SUBTASK, id: 'st-plain', status: 'todo' }] }
    state.pendingRequests = new Map([['stq', { departmentName: 'Production' }]])
    renderPage()
    pickCampaign()
    fireEvent.click(screen.getByTestId('deliverable-open-d1'))
    expect(screen.getByTestId('subtask-awaiting-approval-stq')).toHaveTextContent('awaiting approval from Production')
    expect(screen.queryByTestId('subtask-awaiting-approval-st-plain')).toBeNull()
    state.pendingRequests = new Map()
  })

  it('names the reviewers a task in review is waiting for, mandatory ones marked (d.8)', () => {
    state.deliverables = [DRAFT]
    state.detail = {
      ...DRAFT,
      subTasks: [{
        ...SUBTASK,
        id: 'stw',
        status: 'review',
        reviewers: [
          { userId: 'rev1', name: 'Reviewer One', isMandatory: true, approvedAt: null, respondedAt: null, response: null, isActive: true },
          { userId: 'rev2', name: 'Reviewer Two', isMandatory: false, approvedAt: '2026-08-27T09:00:00Z', respondedAt: null, response: null, isActive: true },
        ],
      }],
    }
    renderPage()
    pickCampaign()
    fireEvent.click(screen.getByTestId('deliverable-open-d1'))
    const waiting = screen.getByTestId('subtask-waiting-on-stw')
    expect(waiting).toHaveTextContent('Reviewer One')
    expect(screen.getByTestId('subtask-waiting-on-stw-required-rev1')).toBeInTheDocument()
    // Reviewer Two has already agreed — naming them would send somebody to chase the wrong person.
    expect(waiting).not.toHaveTextContent('Reviewer Two')
  })

  /**
   * I40.22. Edward, 8 Sep: "show the mandatory reviewer/s as they are the only ones that block the
   * work." This is a TRACKING surface — the question is what is holding the work up, and an
   * optional reviewer is not an answer. My Work and Awaiting Review still name everybody, because
   * there the question is who is looking at your work.
   */
  it('names only the reviewers who actually block the work', () => {
    state.deliverables = [DRAFT]
    state.detail = {
      ...DRAFT,
      subTasks: [{
        ...SUBTASK,
        id: 'stb',
        status: 'review',
        reviewers: [
          { userId: 'rev1', name: 'Mandatory Mo', isMandatory: true, approvedAt: null, respondedAt: null, response: null, isActive: true },
          { userId: 'rev2', name: 'Optional Ola', isMandatory: false, approvedAt: null, respondedAt: null, response: null, isActive: true },
        ],
      }],
    }
    renderPage()
    pickCampaign()
    fireEvent.click(screen.getByTestId('deliverable-open-d1'))
    const waiting = screen.getByTestId('subtask-waiting-on-stb')
    expect(waiting).toHaveTextContent('Mandatory Mo')
    // Outstanding, but cannot hold the work up — naming them here is noise on a tracking screen.
    expect(waiting).not.toHaveTextContent('Optional Ola')
  })

  /**
   * I40.22. The status column read the deliverable's stored state, which is `in_progress` from the
   * moment it exists — so a deliverable whose tasks nobody had touched looked exactly like one
   * under way. That is the opposite of what a tracking surface is for.
   */
  it('says NOT STARTED when the work is assigned and nobody has pressed Start', () => {
    state.deliverables = [{
      ...DRAFT,
      state: 'in_progress',
      progress: { phase: 'not_started', total: 2, unassigned: 0, done: 0, everTotal: 2, inReview: 0, inProgress: 0, notStarted: 2 },
    }]
    renderPage()
    pickCampaign()
    const cell = screen.getByTestId('deliverable-phase-d1')
    expect(cell).toHaveTextContent('Not started')
    // I67.4: the bar's count, and the hover card's numbers behind the status word.
    expect(screen.getByTestId('progress-bar-d1')).toHaveTextContent('0 of 2 done')
    expect(screen.getByTestId('progress-tip-d1-body')).toHaveTextContent('2 of 2 – Not started')
  })

  it('marks the tasks nobody is on, so planned and forgotten do not look the same', () => {
    state.deliverables = [{
      ...DRAFT,
      progress: { phase: 'in_progress', total: 3, unassigned: 2, done: 1, everTotal: 4, inReview: 0, inProgress: 0, notStarted: 0 },
    }]
    renderPage()
    pickCampaign()
    const cell = screen.getByTestId('deliverable-phase-d1')
    expect(cell).toHaveTextContent('In progress')
    expect(cell).toHaveTextContent('1 of 4 done')
    expect(cell).toHaveTextContent('2 unassigned')
  })

  /**
   * I40.22. The column was the deliverable's OWNER, and on ad-hoc the owner and the assignee are the
   * same person — the schedule creates both from one action — so it repeated the next column and
   * said nothing (Edward, 8 Sep). Who handed the work out is the half that was missing.
   */
  it('separates who HANDED OUT the work from who is doing it', () => {
    state.deliverables = [{
      ...DRAFT,
      assignerNames: ['Amir Director'],
      assigneeNames: ['Sara Designer', 'Yusuf Retoucher'],
    }]
    renderPage()
    pickCampaign()
    expect(screen.getByTestId('deliverable-assigners-d1')).toHaveTextContent('Amir Director')
    expect(screen.getByTestId('deliverable-assignees-d1')).toHaveTextContent('Sara Designer, Yusuf Retoucher')
  })

  it('names the mandatory reviewers holding a task up, and nobody else', () => {
    state.deliverables = [{ ...DRAFT, blockingReviewers: { names: ['Mandatory Mo'], allRequired: true } }]
    renderPage()
    pickCampaign()
    expect(screen.getByTestId('deliverable-blocked-by-d1')).toHaveTextContent('Mandatory Mo')
  })

  /**
   * I40.22. Filter options are derived from the rows, never hand-written: a filter offering a
   * status nothing is in — or missing somebody who IS on the work — is worse than no filter, and a
   * hand-written list is the drift this project has paid for three times (traps.md).
   */
  it('filters by column, and offers only values the rows actually hold', () => {
    state.deliverables = [
      { ...DRAFT, id: 'd1', name: 'Hero KV', assigneeNames: ['Sara Designer'] },
      { ...DRAFT, id: 'd2', name: 'Film cutdown', assigneeNames: ['Yusuf Retoucher'] },
    ]
    renderPage()
    pickCampaign()
    expect(screen.getByTestId('deliverable-row-d1')).toBeInTheDocument()
    expect(screen.getByTestId('deliverable-row-d2')).toBeInTheDocument()

    fireEvent.change(screen.getByTestId('deliverable-filter-assignee'), { target: { value: 'Sara Designer' } })
    expect(screen.getByTestId('deliverable-row-d1')).toBeInTheDocument()
    expect(screen.queryByTestId('deliverable-row-d2')).not.toBeInTheDocument()
  })

  /** A filtered list with no count cannot be trusted: "three deliverables" or "three of forty"? */
  it('counts what the filters left, not only what the search box left', () => {
    state.deliverables = [
      { ...DRAFT, id: 'd1', assigneeNames: ['Sara Designer'] },
      { ...DRAFT, id: 'd2', assigneeNames: ['Yusuf Retoucher'] },
      { ...DRAFT, id: 'd3', assigneeNames: ['Yusuf Retoucher'] },
    ]
    renderPage()
    pickCampaign()
    // Nothing narrowed yet, so no count — a count against the whole list is noise.
    expect(screen.queryByTestId('deliverables-search-count-live')).not.toBeInTheDocument()

    fireEvent.change(screen.getByTestId('deliverable-filter-assignee'), { target: { value: 'Yusuf Retoucher' } })
    expect(screen.getByTestId('deliverables-search-count-live')).toHaveTextContent('2 of 3')
  })

  it('never hides work without a way back — clearing restores everything', () => {
    state.deliverables = [
      { ...DRAFT, id: 'd1', assigneeNames: ['Sara Designer'] },
      { ...DRAFT, id: 'd2', assigneeNames: ['Yusuf Retoucher'] },
    ]
    renderPage()
    pickCampaign()
    fireEvent.change(screen.getByTestId('deliverable-filter-assignee'), { target: { value: 'Sara Designer' } })
    fireEvent.click(screen.getByTestId('deliverable-filters-clear'))
    expect(screen.getByTestId('deliverable-row-d2')).toBeInTheDocument()
  })

  it('says so plainly when nobody handed the work out', () => {
    // Legacy ad-hoc work created before the assigner was recorded. An em-dash, not a blank cell.
    state.deliverables = [{ ...DRAFT, assignerNames: [] }]
    renderPage()
    pickCampaign()
    expect(screen.getByTestId('deliverable-assigners-d1')).toHaveTextContent('—')
  })

  /**
   * I40.26. Ad-hoc work — most of this tenant's — had no way to change who reviews it. The campaign
   * branch appoints reviewers at creation and the schedule's edit modal can change them afterwards;
   * the ad-hoc panel had neither, and a task cannot complete without its mandatory reviewers
   * agreeing. Somebody named in error, or since departed, was a dead end (Edward, 8 Sep).
   */
  /**
   * I40.27. Approving lived only in the reviewer's inbox on My Work, so a manager looking straight
   * at a task waiting on them had no way to act on it (Edward, 8 Sep). Shown only to an APPOINTED
   * reviewer who has not yet acted — `public.sub_task_approve` refuses anybody else, explicitly
   * "not any moderator at large" (ADR-0043), so a permission-based button would always error.
   */
  it('offers approve and request-changes to an appointed reviewer who has not acted', async () => {
    const adhoc = { ...DRAFT, id: 'ad2', streamId: null, campaignId: null, state: 'in_progress' as const }
    state.deliverables = [adhoc]
    state.adhoc = [adhoc]
    state.detail = {
      ...adhoc,
      subTasks: [{
        ...SUBTASK, id: 'ast2', status: 'review', assigneeId: 'u1',
        reviewers: [{ userId: 'self-id', name: 'Me', isMandatory: true, approvedAt: null, respondedAt: null, response: null, isActive: true }],
      }],
    }
    renderPage()
    fireEvent.click(screen.getByTestId('deliverables-tab-adhoc'))
    fireEvent.click(screen.getByTestId('deliverable-open-ad2'))
    fireEvent.click(screen.getByTestId('adhoc-approve-ast2'))
    await vi.waitFor(() => expect(state.approveMutate).toHaveBeenCalledWith('ast2', expect.anything()))
  })

  // ADR-0089 d.5/d.7 — the ad-hoc door offers the same two verbs as the inbox, from the same
  // component, so it cannot offer a press the database refuses.
  it('offers Done, not Approve, to an OPTIONAL reviewer (ADR-0089 d.5)', () => {
    const adhoc = { ...DRAFT, id: 'ad4', streamId: null, campaignId: null, state: 'in_progress' as const }
    state.deliverables = [adhoc]
    state.adhoc = [adhoc]
    state.detail = {
      ...adhoc,
      subTasks: [{
        ...SUBTASK, id: 'ast4', status: 'review', assigneeId: 'u1',
        reviewers: [
          { userId: 'someone-else', name: 'Omar', isMandatory: true, approvedAt: null, respondedAt: null, response: null, isActive: true },
          { userId: 'self-id', name: 'Me', isMandatory: false, approvedAt: null, respondedAt: null, response: null, isActive: true },
        ],
      }],
    }
    renderPage()
    fireEvent.click(screen.getByTestId('deliverables-tab-adhoc'))
    fireEvent.click(screen.getByTestId('deliverable-open-ad4'))
    expect(screen.getByTestId('adhoc-respond-ast4')).toHaveTextContent('Done — no comment')
    expect(screen.queryByTestId('adhoc-approve-ast4')).not.toBeInTheDocument()
  })

  it('withholds Approve from the required reviewer while an optional one has not answered, naming them (ADR-0089 d.7)', () => {
    const adhoc = { ...DRAFT, id: 'ad5', streamId: null, campaignId: null, state: 'in_progress' as const }
    state.deliverables = [adhoc]
    state.adhoc = [adhoc]
    state.detail = {
      ...adhoc,
      subTasks: [{
        ...SUBTASK, id: 'ast5', status: 'review', assigneeId: 'u1',
        reviewers: [
          { userId: 'self-id', name: 'Me', isMandatory: true, approvedAt: null, respondedAt: null, response: null, isActive: true },
          { userId: 'silent', name: 'Zara', isMandatory: false, approvedAt: null, respondedAt: null, response: null, isActive: true },
        ],
      }],
    }
    renderPage()
    fireEvent.click(screen.getByTestId('deliverables-tab-adhoc'))
    fireEvent.click(screen.getByTestId('deliverable-open-ad5'))
    expect(screen.getByTestId('adhoc-approve-ast5')).toBeDisabled()
    expect(screen.getByTestId('adhoc-waiting-for-answers-ast5')).toHaveTextContent('Zara')
    // ADR-0089 addendum d.14: the send-back waits for the same answers.
    expect(screen.getByTestId('adhoc-request-changes-ast5')).toBeDisabled()
  })

  it('drops the actions for an optional reviewer who has answered — they are finished with this version', () => {
    const adhoc = { ...DRAFT, id: 'ad6', streamId: null, campaignId: null, state: 'in_progress' as const }
    state.deliverables = [adhoc]
    state.adhoc = [adhoc]
    state.detail = {
      ...adhoc,
      subTasks: [{
        ...SUBTASK, id: 'ast6', status: 'review', assigneeId: 'u1',
        reviewers: [
          { userId: 'someone-else', name: 'Omar', isMandatory: true, approvedAt: null, respondedAt: null, response: null, isActive: true },
          { userId: 'self-id', name: 'Me', isMandatory: false, approvedAt: null, respondedAt: '2026-09-11T09:00:00Z', response: 'feedback', isActive: true },
        ],
      }],
    }
    renderPage()
    fireEvent.click(screen.getByTestId('deliverables-tab-adhoc'))
    fireEvent.click(screen.getByTestId('deliverable-open-ad6'))
    expect(screen.queryByTestId('adhoc-review-actions-ast6')).not.toBeInTheDocument()
  })

  it('shows nothing to somebody who is not a reviewer on it — the RPC would refuse them anyway', () => {
    const adhoc = { ...DRAFT, id: 'ad3', streamId: null, campaignId: null, state: 'in_progress' as const }
    state.deliverables = [adhoc]
    state.adhoc = [adhoc]
    state.detail = {
      ...adhoc,
      subTasks: [{
        ...SUBTASK, id: 'ast3', status: 'review', assigneeId: 'u1',
        reviewers: [{ userId: 'someone-else', name: 'Omar', isMandatory: true, approvedAt: null, respondedAt: null, response: null, isActive: true }],
      }],
    }
    renderPage()
    fireEvent.click(screen.getByTestId('deliverables-tab-adhoc'))
    fireEvent.click(screen.getByTestId('deliverable-open-ad3'))
    expect(screen.queryByTestId('adhoc-review-actions-ast3')).toBeNull()
  })

  it('shows nothing once I have already given my approval', () => {
    const adhoc = { ...DRAFT, id: 'ad4', streamId: null, campaignId: null, state: 'in_progress' as const }
    state.deliverables = [adhoc]
    state.adhoc = [adhoc]
    state.detail = {
      ...adhoc,
      subTasks: [{
        ...SUBTASK, id: 'ast4', status: 'review', assigneeId: 'u1',
        reviewers: [{ userId: 'self-id', name: 'Me', isMandatory: true, approvedAt: '2026-09-08T10:00:00Z', respondedAt: null, response: null, isActive: true }],
      }],
    }
    renderPage()
    fireEvent.click(screen.getByTestId('deliverables-tab-adhoc'))
    fireEvent.click(screen.getByTestId('deliverable-open-ad4'))
    expect(screen.queryByTestId('adhoc-review-actions-ast4')).toBeNull()
  })

  it('lets an ad-hoc task change who reviews it', async () => {
    const adhoc = { ...DRAFT, id: 'ad1', streamId: null, campaignId: null, state: 'in_progress' as const }
    state.deliverables = [adhoc]
    state.adhoc = [adhoc]
    state.detail = {
      ...adhoc,
      subTasks: [{ ...SUBTASK, id: 'ast1', title: 'Retouch', assigneeId: 'u1', reviewers: [] }],
    }
    renderPage()
    fireEvent.click(screen.getByTestId('deliverables-tab-adhoc'))
    fireEvent.click(screen.getByTestId('deliverable-open-ad1'))
    expect(screen.getByTestId('adhoc-reviewers-ast1')).toBeInTheDocument()

    fireEvent.change(screen.getByTestId('adhoc-reviewer-ast1-add'), { target: { value: 'rev1' } })
    await vi.waitFor(() => expect(state.upsertMutate).toHaveBeenCalled())
    // Only the reviewers change: `save_sub_task` coalesces the rest, and the title it already has
    // is sent because the RPC refuses an empty one.
    // ADR-0089 d.3: the first person appointed is the required one.
    expect(state.upsertMutate.mock.calls[0]![0]).toMatchObject({
      id: 'ast1',
      title: 'Retouch',
      reviewers: [{ userId: 'rev1', isMandatory: true }],
    })
  })

  it('says nothing about reviewers on a task that is not in review', () => {
    state.deliverables = [DRAFT]
    // The reviewers list must be NON-EMPTY and outstanding, or this passes for the wrong reason:
    // WaitingOn renders null for an empty list whatever the status, so an empty fixture never
    // exercises the status condition at all and the guard could be deleted unnoticed.
    state.detail = {
      ...DRAFT,
      subTasks: [{
        ...SUBTASK,
        status: 'in_progress',
        reviewers: [{ userId: 'rev1', name: 'Reviewer One', isMandatory: true, approvedAt: null, respondedAt: null, response: null, isActive: true }],
      }],
    }
    renderPage()
    pickCampaign()
    fireEvent.click(screen.getByTestId('deliverable-open-d1'))
    expect(screen.queryByTestId('subtask-waiting-on-st1')).not.toBeInTheDocument()
    // Scoped to the row: the add form's picker legitimately lists the same person as an option.
    expect(screen.getByTestId('subtask-row-st1')).not.toHaveTextContent('Reviewer One')
  })

  it('drops a reviewer who then becomes the assignee, instead of submitting a doomed appointment', () => {
    state.deliverables = [DRAFT]
    state.detail = { ...DRAFT, subTasks: [] }
    state.users = [
      { id: 'u1', name: 'Lina', departmentId: 'dep1', teamId: 'team1' },
      { id: 'rev1', name: 'Reviewer One', departmentId: 'dep1', teamId: 'team1' },
    ]
    renderPage()
    pickCampaign()
    fireEvent.click(screen.getByTestId('deliverable-open-d1'))
    fireEvent.click(screen.getByTestId('subtask-add-open')) // I51.5: the form is a dialog
    fireEvent.change(screen.getByTestId('subtask-title'), { target: { value: 'Retouch' } })
    fireEvent.change(screen.getByTestId('subtask-assignee'), { target: { value: 'u1' } })
    fireEvent.change(screen.getByTestId('subtask-reviewer-add'), { target: { value: 'rev1' } })
    expect(screen.getByTestId('subtask-reviewer-row-rev1')).toBeInTheDocument()
    // Now make that same person the assignee. Excluding them from the OPTIONS is not enough — the
    // appointment already made is still in the form, and the database would refuse it on save with
    // a message about a choice the person can no longer see.
    fireEvent.change(screen.getByTestId('subtask-assignee'), { target: { value: 'rev1' } })
    expect(screen.queryByTestId('subtask-reviewer-row-rev1')).not.toBeInTheDocument()
  })
})

// The Ad-hoc tab is an approved-only archive, so it answers different questions from the campaign
// tab: Discipline comes from the stream and is structurally NULL here (it rendered as a column of
// dashes), the revision round matters far less than WHICH version was signed off, and until now the
// tab rendered no actions at all — approved ad-hoc work could never be tidied away.
describe('DeliverablesPage — the Ad-hoc tab', () => {
  beforeEach(() => {
    state.transitionMutate.mockReset()
    state.canManage = true
    state.adhoc = [
      {
        id: 'ad1', name: 'Test Task - POST 1', state: 'approved', dueAt: '2026-08-25',
        revisionRound: 2, revisionLimit: null, streamId: null, streamName: null,
        discipline: null, departmentId: null, ownerUserId: null,
  ownerName: null, typeName: null, taskCount: 0, unassignedCount: 0, campaignId: null, approvedVersion: 3,
  progress: { phase: 'no_tasks', total: 0, unassigned: 0, done: 0, everTotal: 0, inReview: 0, inProgress: 0, notStarted: 0 },
  assigneeNames: [],
  assignerNames: [],
  blockingReviewers: { names: [], allRequired: false },
  tasksApprovedAt: null, tasksApprovedBy: null, canApproveTasks: false, campaignKind: null,
  workstreamId: null,
      },
    ]
  })

  function openAdhoc() {
    render(<MemoryRouter><DeliverablesPage /></MemoryRouter>)
    fireEvent.click(screen.getByTestId('deliverables-tab-adhoc'))
  }

  it('shows the approved VERSION, not the revision round', () => {
    openAdhoc()
    expect(screen.getByTestId('deliverable-version-ad1')).toHaveTextContent('v3')
    expect(screen.getByTestId('deliverable-version-ad1')).not.toHaveTextContent('2')
  })

  it('drops the Discipline column, which is always empty here', () => {
    openAdhoc()
    expect(screen.queryByText('Discipline')).not.toBeInTheDocument()
  })

  it('offers Archive on FINISHED work, and archives it without ceremony', () => {
    // taskCount 0 — nothing live underneath, so nothing is lost and ADR-0080 d.7 deliberately does
    // not warn. A dialog with nothing in it is the ceremony that teaches people to dismiss dialogs.
    openAdhoc()
    fireEvent.click(screen.getByTestId('deliverable-archive-ad1'))
    expect(state.transitionMutate).toHaveBeenCalled()
  })

  /**
   * ADR-0080 d.10/d.11. This is the press that stranded three of Fadia's tasks on 9 Sep: the
   * Ad-hoc tab filters every other action away, so a LIVE row carried one button, it said Archive,
   * and it archived the container and left the work assigned to somebody who could not remove it.
   */
  describe('live work (ADR-0080)', () => {
    beforeEach(() => {
      state.adhoc = [{
        ...state.adhoc[0], id: 'ad1', state: 'in_progress',
        taskCount: 1, assigneeNames: ['Fadia Wael Amin'],
      }]
    })

    it('says Cancel, not Archive, while work is still live', () => {
      openAdhoc()
      expect(screen.getByTestId('deliverable-cancelJob-ad1')).toHaveTextContent('Cancel job')
      expect(screen.queryByTestId('deliverable-archive-ad1')).not.toBeInTheDocument()
    })

    it('warns before calling the work off, and does nothing until confirmed', () => {
      openAdhoc()
      fireEvent.click(screen.getByTestId('deliverable-cancelJob-ad1'))
      // The load-bearing assertion: the press alone must not write anything.
      expect(state.transitionMutate).not.toHaveBeenCalled()
      const dialog = screen.getByTestId('deliverable-archive-confirm-dialog')
      // d.7 — itemised, not "are you sure". It names who is holding the work, because d.6 lets the
      // archiver call off work in a department they could not otherwise touch.
      expect(dialog).toHaveTextContent('Fadia Wael Amin')
      expect(dialog).toHaveTextContent('1 task will be cancelled.')
      expect(dialog).toHaveTextContent('cannot be undone')
    })

    it('archives once confirmed', () => {
      openAdhoc()
      fireEvent.click(screen.getByTestId('deliverable-cancelJob-ad1'))
      fireEvent.click(screen.getByTestId('deliverable-archive-confirm-confirm'))
      expect(state.transitionMutate).toHaveBeenCalledWith(
        expect.objectContaining({ deliverableId: 'ad1', to: 'archived' }),
        expect.anything(),
      )
    })

    it('leaves the work alone when the warning is dismissed', () => {
      openAdhoc()
      fireEvent.click(screen.getByTestId('deliverable-cancelJob-ad1'))
      fireEvent.click(screen.getByTestId('deliverable-archive-confirm-cancel'))
      expect(state.transitionMutate).not.toHaveBeenCalled()
      expect(screen.queryByTestId('deliverable-archive-confirm-dialog')).not.toBeInTheDocument()
    })
  })

  it('offers ONLY Archive — delivery and reopen are campaign moves', () => {
    openAdhoc()
    expect(screen.queryByTestId('deliverable-markDelivered-ad1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('deliverable-reopen-ad1')).not.toBeInTheDocument()
  })

  it('shows a dash when nothing was ever uploaded', () => {
    state.adhoc = [{ ...state.adhoc[0], approvedVersion: null }]
    openAdhoc()
    expect(screen.getByTestId('deliverable-version-ad1')).toHaveTextContent('—')
  })
})

// ============================================================================
// I22.4 (ADR-0055) — the owner control.
//
// What the server does is proven in pgTAP 062, where removing the trigger fails four assertions
// including "a direct PATCH is refused". These tests cover only what the SURFACE decides: whether
// to offer the attempt, and that it never swallows a refusal.
// ============================================================================
describe("DeliverablesPage — a deliverable owner", () => {
  beforeEach(() => {
    state.campaigns = [CAMPAIGN]
    state.deliverables = [{ ...DRAFT, ownerUserId: 'u1' }]
    state.detail = { ...DRAFT, ownerUserId: 'u1', subTasks: [] }
    state.users = [
      { id: 'u1', name: 'Lina', departmentId: 'dep1', teamId: 'team1' },
      { id: 'u2', name: 'Omar', departmentId: 'dep2', teamId: null },
    ]
    state.canManage = true
    state.canReassign = false
    state.reassign = vi.fn()
  })

  function open() {
    renderPage()
    pickCampaign()
    fireEvent.click(screen.getByTestId('deliverable-open-d1'))
  }

  it('names the owner, because a deliverable nobody owns is the thing to notice', () => {
    open()
    expect(screen.getByTestId('deliverable-owner-name')).toHaveTextContent('Lina')
  })

  it('offers no way to change it without deliverable_owner:manage', () => {
    open()
    expect(screen.queryByTestId('deliverable-owner-change')).not.toBeInTheDocument()
  })

  // project_tasks:manage is deliberately TRUE throughout this block. Before ADR-0055 that alone
  // was enough to reassign anything in the tenant; the control must not reappear for it.
  it('offers it to a deliverable_owner:manage holder, and hands the RPC the new owner', () => {
    state.canReassign = true
    open()
    fireEvent.click(screen.getByTestId('deliverable-owner-change'))
    fireEvent.change(screen.getByTestId('deliverable-owner-select'), { target: { value: 'u2' } })
    fireEvent.click(screen.getByTestId('deliverable-owner-save'))
    expect(state.reassign).toHaveBeenCalledWith(
      { deliverableId: 'd1', ownerUserId: 'u2' },
      expect.anything(),
    )
  })

  // ADR-0083 d.9 (11 Sep): on campaign work the picker offers LEADS, and a department-scoped
  // viewer is offered leads in the deliverable's own department — the trigger would refuse the
  // rest. Traffic (tenant scope) sees every lead. Narrowed-to-nothing falls back to every lead.
  it('offers only leads as owners on campaign work, narrowed to the department for a department lead', () => {
    state.canReassign = true
    state.detail = { ...DRAFT, ownerUserId: 'u1', departmentId: 'dep1', subTasks: [] }
    state.leads = [
      { id: 'l1', name: 'Creative Lead', departmentId: 'dep1', teamId: null, scope: 'department' },
      { id: 'l2', name: 'Copy Lead', departmentId: 'dep1', teamId: 'team1', scope: 'team' },
      { id: 'l3', name: 'Production Lead', departmentId: 'dep2', teamId: null, scope: 'department' },
    ]
    state.scope = 'department'
    open()
    fireEvent.click(screen.getByTestId('deliverable-owner-change'))
    // d.11: campaign work never offers "Nobody" — the first option is a placeholder, not an unset.
    const names = Array.from(screen.getByTestId('deliverable-owner-select').querySelectorAll('option')).map((o) => o.textContent)
    expect(names).toEqual(['Choose a lead…', 'Creative Lead', 'Copy Lead'])
    expect(screen.getByTestId('deliverable-owner')).toHaveTextContent(/leads only/i)
    state.leads = null
  })

  // I66.9 (Edward, 29 Sep): only the deliverable's own department's leads, whoever is looking — Traffic too.
  it("offers a tenant-scoped viewer only the deliverable's own department's leads", () => {
    state.canReassign = true
    state.detail = { ...DRAFT, ownerUserId: 'u1', departmentId: 'dep1', subTasks: [] }
    state.leads = [
      { id: 'l1', name: 'Creative Lead', departmentId: 'dep1', teamId: null, scope: 'department' },
      { id: 'l3', name: 'Production Lead', departmentId: 'dep2', teamId: null, scope: 'department' },
    ]
    state.scope = 'tenant'
    open()
    fireEvent.click(screen.getByTestId('deliverable-owner-change'))
    const names = Array.from(screen.getByTestId('deliverable-owner-select').querySelectorAll('option')).map((o) => o.textContent)
    expect(names).toEqual(['Choose a lead…', 'Creative Lead'])
    state.leads = null
  })

  // ADR-0083 d.11 (12 Sep): on campaign work the owner cannot be cleared to nobody — "Nobody" is
  // never offered and the only empty option is a disabled placeholder.
  it('never offers "Nobody" on campaign work, so the owner cannot be cleared', () => {
    state.canReassign = true
    open()
    fireEvent.click(screen.getByTestId('deliverable-owner-change'))
    const opts = Array.from(
      screen.getByTestId('deliverable-owner-select').querySelectorAll('option'),
    ) as HTMLOptionElement[]
    expect(opts.map((o) => o.textContent)).not.toContain('Nobody yet')
    const empty = opts.find((o) => o.value === '')
    expect(empty?.disabled).toBe(true)
    expect(state.reassign).not.toHaveBeenCalled()
  })

  // ADR-0083 d.12: a department with no lead offers its team leads, with the reason shown.
  it('offers the department team leads with an explanation when the department has no lead', () => {
    state.canReassign = true
    state.detail = { ...DRAFT, ownerUserId: 'u1', departmentId: 'dep1', subTasks: [] }
    state.leads = [
      { id: 't1', name: 'Copy Team Lead', departmentId: 'dep1', teamId: 'team1', scope: 'team' },
      { id: 't2', name: 'Art Team Lead', departmentId: 'dep1', teamId: 'team2', scope: 'team' },
    ]
    state.scope = 'tenant'
    open()
    fireEvent.click(screen.getByTestId('deliverable-owner-change'))
    expect(screen.getByTestId('deliverable-owner')).toHaveTextContent(/no lead yet/i)
    const names = Array.from(screen.getByTestId('deliverable-owner-select').querySelectorAll('option')).map((o) => o.textContent)
    expect(names).toEqual(['Choose a lead…', 'Copy Team Lead', 'Art Team Lead'])
    state.leads = null
  })
})

// ============================================================================
// I19.9 (ADR-0052 d.12/d.14) — editing the task list.
//
// The server halves are proven in pgTAP 065: what "remove" means for a plan versus for work
// somebody started, and that reordering leaves every date byte-identical. These tests cover the
// three things the SURFACE decides — which order it asks for, that it withdraws the control when
// the list on screen is not the whole list, and that an edit sends only the fields being edited.
// ============================================================================
const PLAN_TASK: SubTaskRow = {
  ...SUBTASK,
  id: 'st2',
  title: 'Storyboard',
  assigneeId: null,
  assigneeName: null,
  status: 'todo',
  sortOrder: 2,
  createdAt: '2026-08-18T11:00:00Z',
}
const THIRD_TASK: SubTaskRow = { ...PLAN_TASK, id: 'st3', title: 'Grade', sortOrder: 3 }

describe('DeliverablesPage — editing the task list (I19.9)', () => {
  beforeEach(() => {
    state.campaigns = [CAMPAIGN]
    state.deliverables = [DRAFT]
    state.detail = { ...DRAFT, subTasks: [SUBTASK, PLAN_TASK, THIRD_TASK] }
    state.canManage = true
    state.canReview = false
    state.resequence = vi.fn()
    state.upsertMutate = vi.fn()
  })

  function open() {
    renderPage()
    pickCampaign()
    fireEvent.click(screen.getByTestId('deliverable-open-d1'))
  }

  it('hands the RPC the WHOLE list in its new order, not just the row that moved', () => {
    open()
    fireEvent.click(screen.getByTestId('subtask-move-down-st1'))
    expect(state.resequence).toHaveBeenCalledWith(
      { deliverableId: 'd1', orderedIds: ['st2', 'st1', 'st3'] },
      expect.anything(),
    )
  })

  it('moves a task up', () => {
    open()
    fireEvent.click(screen.getByTestId('subtask-move-up-st3'))
    expect(state.resequence).toHaveBeenCalledWith(
      { deliverableId: 'd1', orderedIds: ['st1', 'st3', 'st2'] },
      expect.anything(),
    )
  })

  it('cannot move the first task up or the last one down', () => {
    open()
    expect(screen.getByTestId('subtask-move-up-st1')).toBeDisabled()
    expect(screen.getByTestId('subtask-move-down-st3')).toBeDisabled()
  })

  // The whole list or nothing: resequence assigns each position from the array it is handed, so
  // reordering a filtered view would renumber the visible rows and interleave the hidden ones.
  it('withdraws the reorder control while the unassigned filter is on', () => {
    open()
    fireEvent.click(screen.getByTestId('deliverable-unassigned-filter'))
    expect(screen.queryByTestId('subtask-move-up-st2')).not.toBeInTheDocument()
  })

  it('offers no reorder control to somebody who cannot manage tasks', () => {
    state.canManage = false
    state.canReview = true
    open()
    expect(screen.queryByTestId('subtask-move-down-st1')).not.toBeInTheDocument()
  })

  // ADR-0052 d.12. save_sub_task coalesces every parameter, so sending only these two is what
  // stops a retitle wiping the assignee, the hours or the reviewer appointments.
  it('sends only the title and the date it retitled and re-dated', () => {
    open()
    fireEvent.click(screen.getByTestId('subtask-edit-st1'))
    fireEvent.change(screen.getByTestId('subtask-edit-title-st1'), { target: { value: 'Retouch v2' } })
    fireEvent.change(screen.getByTestId('subtask-edit-due-st1'), { target: { value: '2026-09-10' } })
    fireEvent.click(screen.getByTestId('subtask-edit-save-st1'))
    expect(state.upsertMutate).toHaveBeenCalledWith(
      {
        id: 'st1',
        deliverableId: 'd1',
        title: 'Retouch v2',
        // ADR-0076 d.3: a deadline is the CLOSE of its day — 18:00 Iraq, which is 15:00Z.
        dueAt: '2026-09-10T15:00:00.000Z',
      },
      expect.anything(),
    )
  })

  // ADR-0059 d.4. The mode is a person's decision, changeable after assignment — discovering at the
  // shoot that there is nothing to upload is normal, and a mode that could only be set once would be
  // a second dead end. It is sent ONLY when it moved, which is what keeps the assertion above
  // literally true rather than nearly so.
  it('sends the review mode when it changed, and not when it did not', () => {
    open()
    fireEvent.click(screen.getByTestId('subtask-edit-st1'))
    fireEvent.change(screen.getByTestId('subtask-edit-review-mode-st1'), { target: { value: 'manual' } })
    fireEvent.click(screen.getByTestId('subtask-edit-save-st1'))
    expect(state.upsertMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'st1', reviewMode: 'manual' }),
      expect.anything(),
    )
  })

  it('shows each task’s review mode on the table', () => {
    open()
    expect(screen.getByTestId('subtask-review-mode-st1')).toHaveTextContent('Digital review')
  })

  it('leaves the row alone when the edit is cancelled', () => {
    open()
    fireEvent.click(screen.getByTestId('subtask-edit-st1'))
    fireEvent.change(screen.getByTestId('subtask-edit-title-st1'), { target: { value: 'Discarded' } })
    fireEvent.click(screen.getByTestId('subtask-edit-cancel-st1'))
    expect(state.upsertMutate).not.toHaveBeenCalled()
    expect(screen.getByTestId('subtask-row-st1')).toHaveTextContent('Retouch')
  })

  it('will not save a task with no title', () => {
    open()
    fireEvent.click(screen.getByTestId('subtask-edit-st1'))
    fireEvent.change(screen.getByTestId('subtask-edit-title-st1'), { target: { value: '  ' } })
    expect(screen.getByTestId('subtask-edit-save-st1')).toBeDisabled()
  })
})

/**
 * Narrowing a list by typing — ONE BOX PER GROUP (Edward, 30 Aug).
 *
 * Live work and finished work are two different lists that happen to share a page. A single search
 * across both narrows the one you are not reading, which is why the first attempt was wrong.
 */
describe('DeliverablesPage — searching each group', () => {
  beforeEach(() => {
    state.adhoc = [
      { ...DRAFT, id: 'a1', name: 'Hero film', state: 'in_progress', typeName: 'Long-form Video', discipline: 'Production' },
      { ...DRAFT, id: 'a2', name: 'Ramadan KV', state: 'in_progress', typeName: 'Key Visual', discipline: 'Creative' },
      { ...DRAFT, id: 'a3', name: 'Print run', state: 'approved', typeName: 'Print Advertisement', discipline: 'Creative' },
      { ...DRAFT, id: 'a4', name: 'Hero film v1', state: 'approved', typeName: 'Long-form Video', discipline: 'Production' },
    ]
  })

  const openAdhoc = () => {
    renderPage()
    fireEvent.click(screen.getByTestId('deliverables-tab-adhoc'))
  }

  it('gives each group its own box', () => {
    openAdhoc()
    expect(screen.getByTestId('deliverables-search-live')).toBeInTheDocument()
    expect(screen.getByTestId('deliverables-search-complete')).toBeInTheDocument()
  })

  // THE assertion. Searching Live must leave Complete exactly as it was — "Hero film v1" is
  // complete and matches "hero", and it has to stay on screen.
  it('searching one group leaves the other untouched', () => {
    openAdhoc()
    fireEvent.change(screen.getByTestId('deliverables-search-live'), { target: { value: 'hero' } })
    expect(screen.getByTestId('deliverable-row-a1')).toBeInTheDocument()
    expect(screen.queryByTestId('deliverable-row-a2')).toBeNull()
    // Complete is untouched: both its rows are still there.
    expect(screen.getByTestId('deliverable-row-a3')).toBeInTheDocument()
    expect(screen.getByTestId('deliverable-row-a4')).toBeInTheDocument()
  })

  it('searches the complete group on its own', () => {
    openAdhoc()
    fireEvent.change(screen.getByTestId('deliverables-search-complete'), { target: { value: 'print' } })
    expect(screen.getByTestId('deliverable-row-a3')).toBeInTheDocument()
    expect(screen.queryByTestId('deliverable-row-a4')).toBeNull()
    expect(screen.getByTestId('deliverable-row-a1')).toBeInTheDocument()
  })

  it('finds a deliverable by its department', () => {
    openAdhoc()
    fireEvent.change(screen.getByTestId('deliverables-search-live'), { target: { value: 'creative' } })
    expect(screen.getByTestId('deliverable-row-a2')).toBeInTheDocument()
    expect(screen.queryByTestId('deliverable-row-a1')).toBeNull()
  })

  // The heading counts what the GROUP holds, not what the search left — otherwise "2 complete"
  // quietly becomes "2 matching" and the number stops meaning anything.
  it('keeps the group count true while the search narrows the rows', () => {
    openAdhoc()
    fireEvent.change(screen.getByTestId('deliverables-search-live'), { target: { value: 'hero' } })
    expect(screen.getByTestId('deliverables-search-count-live').textContent).toContain('1')
    expect(screen.getByTestId('deliverable-group-live').textContent).toContain('(2)')
  })

  // An empty result is not an empty group, and saying "nothing here yet" would be a lie.
  it('says nothing matched, not that the group is empty', () => {
    openAdhoc()
    fireEvent.change(screen.getByTestId('deliverables-search-live'), { target: { value: 'zzzz' } })
    expect(screen.getByTestId('deliverable-group-empty-live').textContent).toMatch(/nothing here matches/i)
  })

  it('shows everything again when a box is cleared', () => {
    openAdhoc()
    fireEvent.change(screen.getByTestId('deliverables-search-live'), { target: { value: 'hero' } })
    fireEvent.change(screen.getByTestId('deliverables-search-live'), { target: { value: '' } })
    expect(screen.getByTestId('deliverable-row-a2')).toBeInTheDocument()
    expect(screen.queryByTestId('deliverables-search-count-live')).toBeNull()
  })
})

// ADR-0068 (I36.1/I36.2) — cancelling asks first, and says what it costs.
describe('DeliverablesPage — cancelling is confirmed and can be undone (ADR-0068)', () => {
  beforeEach(() => {
    state.cancelMutate.mockReset()
    state.removeTask.mockReset()
    reinstateMutate.mockReset()
    cancelImpact.value = { bookings: 2, isPlan: false, isAdhoc: false }
  })

  async function openTaskWithCancel() {
    state.deliverables = [DRAFT]
    state.detail = { ...DRAFT, subTasks: [SUBTASK] }
    renderPage()
    pickCampaign()
    fireEvent.click(screen.getByTestId('deliverable-open-d1'))
    return screen.findByTestId(`subtask-cancel-${SUBTASK.id}`)
  }

  it('does NOT cancel on the click — it asks first', async () => {
    const button = await openTaskWithCancel()
    fireEvent.click(button)
    await screen.findByTestId('subtask-cancel-confirm-dialog')
    expect(state.cancelMutate).not.toHaveBeenCalled()
  })

  it('says what is lost, in numbers (d.2)', async () => {
    const button = await openTaskWithCancel()
    fireEvent.click(button)
    const detail = await screen.findByTestId('subtask-cancel-confirm-detail')
    // The assignee, so they know somebody is being told; the count, so "off the calendar" is a
    // number rather than a feeling; and that reinstating does not bring the calendar back.
    expect(detail).toHaveTextContent('2')
    // Campaign work CAN be reinstated, so it is promised — the ad-hoc case says the opposite.
    expect(detail).toHaveTextContent('unassigned and unscheduled')
  })

  it('cancels once confirmed', async () => {
    const button = await openTaskWithCancel()
    fireEvent.click(button)
    fireEvent.click(await screen.findByTestId('subtask-cancel-confirm-confirm'))
    expect(state.cancelMutate).toHaveBeenCalledWith(SUBTASK.id, expect.anything())
  })

  it('changes nothing when dismissed', async () => {
    const button = await openTaskWithCancel()
    fireEvent.click(button)
    fireEvent.click(await screen.findByTestId('subtask-cancel-confirm-cancel'))
    expect(state.cancelMutate).not.toHaveBeenCalled()
    expect(screen.queryByTestId('subtask-cancel-confirm-dialog')).not.toBeInTheDocument()
  })

  // d.3 — the two outcomes are distinguished BEFORE the click, using the same predicate the
  // function uses, so the dialog cannot promise one and get the other.
  it('a PLAN is described as a removal that loses nothing, and goes through remove', async () => {
    cancelImpact.value = { bookings: 0, isPlan: true, isAdhoc: false }
    const button = await openTaskWithCancel()
    fireEvent.click(button)

    const detail = await screen.findByTestId('subtask-cancel-confirm-detail')
    expect(detail).toHaveTextContent('Nothing is lost')

    fireEvent.click(screen.getByTestId('subtask-cancel-confirm-confirm'))
    expect(state.removeTask).toHaveBeenCalledWith(SUBTASK.id, expect.anything())
    expect(state.cancelMutate).not.toHaveBeenCalled()
  })
})

/**
 * I36.1 — ad-hoc work had none of this, on the tab that holds most of the tenant's deliverables.
 *
 * `DeliverableDetail` returns EARLY for ad-hoc work (`streamId == null && campaignId == null`) and
 * rendered only the review panel, the task's resources and chat — no task table, and therefore no
 * cancel, no reinstate and no way to say what the task was waiting for. Edward found it by looking
 * for a cancel option that had never been there. The suite had no ad-hoc detail coverage at all,
 * which is why nothing said so.
 */
describe('DeliverablesPage — ad-hoc work gets the same controls (I36.1)', () => {
  const ADHOC_TASK = { ...SUBTASK, id: 'as1', status: 'todo' as const }
  const ADHOC = {
    ...DRAFT,
    id: 'a9',
    name: 'Retouch',
    state: 'in_progress' as const,
    streamId: null,
    workstreamId: null,
    campaignId: null,
  }

  beforeEach(() => {
    state.cancelMutate.mockReset()
    reinstateMutate.mockReset()
    cancelImpact.value = { bookings: 1, isPlan: false, isAdhoc: true }
    state.adhoc = [ADHOC]
    state.detail = { ...ADHOC, subTasks: [ADHOC_TASK] }
  })

  function openAdhocDetail() {
    renderPage()
    fireEvent.click(screen.getByTestId('deliverables-tab-adhoc'))
    fireEvent.click(screen.getByTestId('deliverable-open-a9'))
  }

  it('offers Cancel on an ad-hoc task — the gap Edward reported', async () => {
    openAdhocDetail()
    expect(await screen.findByTestId('subtask-cancel-as1')).toBeInTheDocument()
  })

  it('asks before cancelling here too, with the same dialog', async () => {
    openAdhocDetail()
    fireEvent.click(await screen.findByTestId('subtask-cancel-as1'))
    expect(await screen.findByTestId('subtask-cancel-confirm-dialog')).toBeInTheDocument()
    expect(state.cancelMutate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('subtask-cancel-confirm-confirm'))
    expect(state.cancelMutate).toHaveBeenCalledWith('as1', expect.anything())
  })

  /**
   * Edward, 3 Sep, after seeing the whole picture: ad-hoc cancellation stays IRREVERSIBLE and the
   * warning says so, rather than the state machine being amended to allow an undo.
   *
   * `sub_task_cancel` archives an ad-hoc deliverable once its last live task goes (ADR-0061 d.6)
   * and `archived` is terminal (ADR-0024), so reinstating the task alone would leave live work
   * under a dead container. Ad-hoc assignment is being retired, so the mechanism is not worth
   * changing — the PROMISE is what changes.
   */
  it('warns that ad-hoc cancellation cannot be undone, and offers no false undo', async () => {
    openAdhocDetail()
    fireEvent.click(await screen.findByTestId('subtask-cancel-as1'))
    const detail = await screen.findByTestId('subtask-cancel-confirm-detail')
    expect(detail).toHaveTextContent('cannot be reinstated')
    expect(detail).not.toHaveTextContent('You can reinstate it afterwards')
  })

  it('does NOT put a Cancel button back on genuinely finished work', async () => {
    // An approved ad-hoc deliverable has a DONE task, not a cancelled one, so the exception above
    // does not reopen controls on work that is properly complete.
    state.adhoc = [{ ...ADHOC, state: 'approved' as const }]
    state.detail = {
      ...ADHOC,
      state: 'approved' as const,
      subTasks: [{ ...ADHOC_TASK, status: 'done' as const }],
    }
    openAdhocDetail()
    await screen.findByTestId('deliverable-detail')
    expect(screen.queryByTestId('subtask-cancel-as1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('subtask-reinstate-as1')).not.toBeInTheDocument()
  })

  it('can say what ad-hoc work is waiting for', async () => {
    openAdhocDetail()
    // Both halves: the per-task requirement cell, and the deliverable's external inputs.
    expect(await screen.findByTestId('required-input-as1')).toBeInTheDocument()
    expect(screen.getByTestId('external-inputs')).toBeInTheDocument()
  })
})

/**
 * ADR-0090: a single job's generated task list is a proposal until its owner approves it — one
 * button where the list lives (d.7), the SJ-03 reminder above it, and "awaiting the owner's
 * review" wherever unassigned work is counted (d.3b). Campaign deliverables keep the gate they
 * have (d.6), so none of this appears on them.
 */
describe('DeliverablesPage — the owner approves the task list (ADR-0090)', () => {
  // Typed like DRAFT so `{ ...HELD, subTasks }` satisfies `DeliverableDetail`, which ADR-0088 gave `goLiveAt`.
  const HELD: DeliverableRow & { goLiveAt: string | null } = {
    ...DRAFT,
    campaignKind: 'single_job',
    tasksApprovedAt: null,
    // The server's answer (can_approve_tasks): this viewer is the owner, so they may approve.
    canApproveTasks: true,
    ownerUserId: 'self-id',
    ownerName: 'Fadia',
    taskCount: 3,
    unassignedCount: 3,
  }

  beforeEach(() => {
    state.campaigns = [CAMPAIGN]
    state.users = [{ id: 'self-id', name: 'Fadia', departmentId: 'dep1', teamId: null }, { id: 'u1', name: 'Lina', departmentId: 'dep1', teamId: 'team1' }]
    state.canManage = true
    state.canReassign = false
    state.approveTasksMutate = vi.fn()
    state.reminder = null
  })

  it('offers Approve task list to the owner while the list is unapproved, and the press calls the RPC', () => {
    state.deliverables = [HELD]
    state.detail = { ...HELD, subTasks: [SUBTASK] }
    renderPage()
    pickCampaign()
    fireEvent.click(screen.getByTestId('deliverable-open-d1'))
    fireEvent.click(screen.getByTestId('task-list-approve'))
    expect(state.approveTasksMutate).toHaveBeenCalledWith('d1', expect.anything())
  })

  it('shows the SJ-03 reminder above the list until approved, and lets the owner dismiss it', () => {
    state.reminder = 'waiting on the client logo'
    state.deliverables = [HELD]
    state.detail = { ...HELD, subTasks: [SUBTASK] }
    renderPage()
    pickCampaign()
    fireEvent.click(screen.getByTestId('deliverable-open-d1'))
    expect(screen.getByTestId('task-list-risk')).toHaveTextContent('waiting on the client logo')
    fireEvent.click(screen.getByTestId('task-list-risk-dismiss'))
    expect(screen.queryByTestId('task-list-risk')).toBeNull()
  })

  it('names the owner rather than offering the button to somebody the server will not admit (e.g. the account manager)', () => {
    state.deliverables = [{ ...HELD, ownerUserId: 'u1', ownerName: 'Lina', canApproveTasks: false }]
    state.detail = { ...HELD, ownerUserId: 'u1', ownerName: 'Lina', canApproveTasks: false, subTasks: [SUBTASK] }
    renderPage()
    pickCampaign()
    // On the list: unassigned, but not work anybody should assign yet (d.3b).
    expect(screen.getByTestId('deliverable-held-d1')).toHaveTextContent("awaiting the owner's review — Lina")
    fireEvent.click(screen.getByTestId('deliverable-open-d1'))
    expect(screen.queryByTestId('task-list-approve')).toBeNull()
    expect(screen.getByTestId('task-list-held')).toHaveTextContent('Lina')
  })

  // d.4: the person who could have changed the owner may act for an absent one.
  it('offers the button to a holder of deliverable_owner:manage who is not the owner', () => {
    state.canReassign = true
    state.deliverables = [{ ...HELD, ownerUserId: 'u1' }]
    state.detail = { ...HELD, ownerUserId: 'u1', subTasks: [SUBTASK] }
    renderPage()
    pickCampaign()
    fireEvent.click(screen.getByTestId('deliverable-open-d1'))
    expect(screen.getByTestId('task-list-approve')).toBeInTheDocument()
  })

  it('shows the stamp once approved, naming who', () => {
    state.deliverables = [{ ...HELD, tasksApprovedAt: '2026-09-11T09:00:00Z', tasksApprovedBy: 'self-id', unassignedCount: 3 }]
    state.detail = { ...HELD, tasksApprovedAt: '2026-09-11T09:00:00Z', tasksApprovedBy: 'self-id', subTasks: [SUBTASK] }
    renderPage()
    pickCampaign()
    // Approved: plain unassigned work now, not held.
    expect(screen.queryByTestId('deliverable-held-d1')).toBeNull()
    fireEvent.click(screen.getByTestId('deliverable-open-d1'))
    expect(screen.getByTestId('task-list-approved')).toHaveTextContent('Task list approved by Fadia')
    expect(screen.queryByTestId('task-list-approve')).toBeNull()
  })

  // I66.13 (Edward, 29 Sep): the Needs-you cards open this window for campaign pieces too — so the list is approved
  // here, and the piece can be closed here.
  it('offers the task-list approval and Close on a campaign deliverable', () => {
    state.deliverables = [{ ...HELD, campaignKind: 'campaign' }]
    state.detail = { ...HELD, campaignKind: 'campaign', subTasks: [SUBTASK] }
    renderPage()
    pickCampaign()
    fireEvent.click(screen.getByTestId('deliverable-open-d1'))
    expect(screen.getByTestId('task-list-approve')).toBeInTheDocument()
    expect(screen.getByTestId('deliverable-close')).toBeInTheDocument()
  })

  it('a piece whose every task was cancelled offers no approval, and closes after asking', () => {
    state.deliverables = [{ ...HELD, campaignKind: 'campaign' }]
    state.detail = { ...HELD, campaignKind: 'campaign', state: 'in_progress', subTasks: [{ ...SUBTASK, status: 'cancelled' }] }
    renderPage()
    pickCampaign()
    fireEvent.click(screen.getByTestId('deliverable-open-d1'))
    expect(screen.queryByTestId('task-list-approval')).toBeNull()
    fireEvent.click(screen.getByTestId('deliverable-close'))
    expect(screen.getByTestId('deliverable-close-confirm-dialog')).toHaveTextContent('Nothing is live on it')
    expect(state.transitionMutate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('deliverable-close-confirm-confirm'))
    expect(state.transitionMutate).toHaveBeenCalledWith(
      expect.objectContaining({ deliverableId: 'd1', to: 'archived', expectedState: 'in_progress' }),
      expect.anything(),
    )
  })
})
