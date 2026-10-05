import { afterEach, describe, expect, it, beforeEach, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import '../../lib/i18n'
import type { DeliverableRow } from '../deliverables/api/deliverables-api'
import type { CampaignDetail } from './api/campaign-detail-api'

/**
 * The page that failed silently (I16.6).
 *
 * On 27 Aug `useCampaignDetail` threw a PostgREST 42703 and this page rendered "that campaign could
 * not be found" for a day — the approval gate had no reachable UI and nothing said why. The rule
 * that came out of it is Edward's, verbatim: "ANYWHERE AN ERROR COULD OCCUR IT SHOULD NOT FAIL
 * SILENTLY." So the cases below are mostly about what the page says when a read FAILS, and that it
 * never dresses a failure up as an empty campaign or a missing one.
 */

const state = vi.hoisted(() => ({
  /** ADR-0099 / I56.3: empty by default — grouping is OPTIONAL, so "no workstreams" is the
   *  ordinary case and every assertion in this file sits under it. */
  workstreams: { data: [] as unknown[], isLoading: false, isError: false },
  writeBriefs: vi.fn(),
  saveBrief: vi.fn(),
  canManage: true,
  /** I52.16: the viewer's reach — 'tenant' / 'all_accounts' may approve and change the manager. */
  scope: 'department' as string,
  deptTemplates: new Map<string, { departmentId: string; departmentName: string; templates: { id: string; briefType: string; nameEn: string; fields: { key: string; en: string; guidance?: string }[] }[] }>(),
  /** The tenant's whole catalogue — what a department with none of its own picks from (6 Sep). */
  allTemplates: [] as { id: string; briefType: string; nameEn: string; isDefault: boolean; fields: { key: string; en: string; guidance?: string }[] }[],
  campaign: {
    data: null as CampaignDetail | null,
    isLoading: false,
    isError: false,
    error: null as unknown,
  },
  deliverables: {
    data: [] as DeliverableRow[],
    isLoading: false,
    isError: false,
    error: null as unknown,
  },
  // ADR-0088: pending extension requests under the campaign, keyed to a deliverable by `deliverableId`.
  extensionRequests: [] as { deliverableId: string; requestId: string }[],
  pendingInputs: [] as { id: string; description: string; awaitedFrom: string; askedOn: string | null; createdAt: string }[],
  /** ADR-0132: the catalogue the panel's Type picks from — empty unless a test needs it. */
  catalogueItems: [] as { id: string; name: string; code: string; category: string }[],
}))

// ADR-0123 d.3: the client's working week — Iraq's here.
vi.mock('../../lib/calendar/client-calendar', () => ({
  useClientCalendar: () => ({ calendar: { workingDays: [7, 1, 2, 3, 4] }, isLoading: false }),
  useWorkCalendar: () => ({ calendar: { workingDays: [7, 1, 2, 3, 4] }, isLoading: false }),
}))
const updateDeliverableMutateAsync = vi.hoisted(() => vi.fn(async () => undefined))
const updateDetailsMutateAsync = vi.hoisted(() => vi.fn(async () => undefined))
const renameCampaignMutate = vi.hoisted(() => vi.fn())
vi.mock('./api/campaign-detail-api', () => ({
  useCampaignDetail: () => state.campaign,
  useBriefTemplateFields: () => ({ data: {}, isLoading: false, isError: false }),
  useApproveCampaign: () => ({ mutate: vi.fn(), isPending: false }),
  useSetCampaignAccountManager: () => ({ mutate: vi.fn(), isPending: false }),
  // ADR-0096: phases off on every fixture here; the phase surfaces have their own suite.
  useCampaignPhases: () => ({ data: [], isLoading: false, isError: false }),
  useSetCampaignPhases: () => ({ mutate: vi.fn(), isPending: false }),
  useMoveDeliverableToPhase: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateCampaignBrief: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSingleJobBrief: () => ({ mutate: vi.fn(), isPending: false }),
  useRenameCampaign: () => ({ mutate: renameCampaignMutate, isPending: false }),
  useUpdateCampaignDeliverable: () => ({ mutate: vi.fn(), mutateAsync: updateDeliverableMutateAsync, isPending: false }),
  // ADR-0132 d.2: channel, language and brief lines.
  useUpdatePieceDetails: () => ({ mutateAsync: updateDetailsMutateAsync, isPending: false }),
}))
// ADR-0103/0104: the re-open mirror and the brief reader — neither is what this suite is about.
vi.mock('../deliverables/api/reopen-api', () => ({
  useReopenableDeliverables: () => ({ data: new Set<string>() }),
  useFinishedTasks: () => ({ data: [], isLoading: false }),
  useReopenDeliverable: () => ({ mutate: vi.fn(), isPending: false }),
}))
// ADR-0141 / ADR-0142: the piece header and the amendment counts.
vi.mock('./api/change-asks-api', () => ({
  usePieceAskContext: () => ({ data: null }),
  usePieceChangeAsks: () => ({ data: [] }),
  useWithdrawDeliverableChange: () => ({ mutate: vi.fn(), isPending: false }),
  useAskDeliverableChange: () => ({ mutate: vi.fn(), isPending: false }),
  useAnswerDeliverableChange: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('../../lib/amendments/amendment-summary', async (orig) => ({
  ...(await orig<typeof import('../../lib/amendments/amendment-summary')>()),
  useAmendmentSummary: () => ({ data: new Map() }),
}))
vi.mock('./api/brief-ingest-api', () => ({
  useIngestBrief: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('./api/campaign-api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useReopenCampaign: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('../clients/api/clients-api', () => ({
  useAccountManagers: () => ({ data: [], isLoading: false }),
}))

const renameMutate = vi.hoisted(() => vi.fn())
const approveTasksMutate = vi.hoisted(() => vi.fn())
const risk = vi.hoisted(() => ({ text: null as string | null }))
vi.mock('../deliverables/api/deliverables-api', () => ({
  // I71.7: the brief's "what could stop this", above the panel's Approve.
  useTaskListReminder: () => ({ data: risk.text }),
  useCampaignDeliverables: () => state.deliverables,
  useRenameDeliverable: () => ({ mutate: renameMutate, isPending: false }),
  // ADR-0100 d.2 (23 Sep): the department tab's second gate is the owners accepting their task
  // lists, so the page now reaches for this.
  useApproveDeliverableTasks: () => ({ mutate: approveTasksMutate, isPending: false }),
  // ADR-0099 / I56.3: who may be named as a workstream's owner.
  useDeliverableOwnerCandidates: () => ({ data: [] }),
  // CG-E1 (I57.11): the Edit dialog's owner change and Close.
  useReassignDeliverable: () => ({ mutate: vi.fn(), isPending: false }),
  useTransitionDeliverable: () => ({ mutate: vi.fn(), isPending: false }),
  // ADR-0132 (I68.3): the panel's task list — edit a row, remove one.
  useUpsertSubTask: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveSubTask: () => ({ mutate: vi.fn(), isPending: false }),
  deliverableKeys: { byCampaign: (id: string) => ['deliverables', 'campaign', id] },
}))

// ADR-0132 (I68.3/I68.4): the panel's add row and the direct type change.
const addTaskMutate = vi.hoisted(() => vi.fn())
const changeTypeMutateAsync = vi.hoisted(() => vi.fn(async () => undefined))
const editDirectMutateAsync = vi.hoisted(() => vi.fn(async () => ({ cancelled: 0, added: 0, quantity: 1, dueAt: null })))
vi.mock('./api/piece-edit-api', () => ({
  useAddTaskToPiece: () => ({ mutate: addTaskMutate, isPending: false }),
  useChangeDeliverableType: () => ({ mutateAsync: changeTypeMutateAsync, isPending: false }),
  // ADR-0132 d.2-d.3: quantity and due date, direct.
  useEditPieceDirect: () => ({ mutateAsync: editDirectMutateAsync, isPending: false }),
  usePreviewQuantityChange: () => ({
    data: { cancelled: [{ id: 'u3', title: 'Create Artwork 3', status: 'todo', assigneeName: 'Abeer Saad' }], added: [], approvedAfter: false },
    isLoading: false,
    isError: false,
  }),
  usePreviewTypeChange: () => ({
    data: { cancelled: [{ id: 't1', title: 'Design', assigneeName: 'Zubaida Jamil' }], kept: [{ id: 't0', title: 'Creative Direction' }], added: ['Design — Social static'] },
    isLoading: false,
    isError: false,
  }),
}))
// ADR-0132 d.1: Promote on a single job's header.
const promoteMutate = vi.hoisted(() => vi.fn())
const addPendingInput = vi.hoisted(() => vi.fn())
vi.mock('../intake/api/intake-api', () => ({ usePromoteSingleJob: () => ({ mutate: promoteMutate, isPending: false }) }))

// I57.8–I57.10: what a piece waits on, and the clock — their own reads, stubbed empty here; the
// views have their own suites.
vi.mock('./api/outstanding-inputs-api', () => ({ useOutstandingInputs: () => ({ data: new Map() }) }))
// I68.14: the panel's "Waiting on someone outside" (ADR-0069) — the window's own list, moved into the panel.
vi.mock('../deliverables/api/requirements-api', async (orig) => ({
  ...(await orig<typeof import('../deliverables/api/requirements-api')>()),
  usePendingInputs: () => ({ data: state.pendingInputs ?? [], isLoading: false }),
  useAddPendingInput: () => ({ mutate: addPendingInput, isPending: false }),
  useMarkInputArrived: () => ({ mutate: vi.fn(), isPending: false }),
}))
// ADR-0110 (I59.23): the change requests the drawer and the Board card read.
vi.mock('./api/change-requests-api', () => ({
  useCampaignChangeRequests: () => ({ data: new Map() }),
  useChangeRequestContext: () => ({ data: { started: false, openRequest: null, escalationHours: null, tasks: [] }, isLoading: false }),
  useRequestDeliverableChange: () => ({ mutateAsync: async () => 'r', isPending: false }),
}))
vi.mock('./api/campaign-risk-api', () => ({ useCampaignRisk: () => ({ data: new Map() }) }))
vi.mock('../admin/api/deliverable-types-api', () => ({
  useDeliverableCatalogue: () => ({ items: state.catalogueItems, isLoading: false, isError: false }),
  // ADR-0117 addendum (Q18): the tenant's languages, to choose from and to name a deliverable's with.
  useLanguageWords: () => ({
    options: [{ code: 'en', label: 'English' }, { code: 'ar', label: 'Arabic' }, { code: 'ku', label: 'Kurdish' }],
    words: (codes: readonly string[] | null | undefined) =>
      (codes ?? []).map((c) => ({ en: 'English', ar: 'Arabic', ku: 'Kurdish' } as Record<string, string>)[c] ?? c).join(', '),
  }),
  useAddLanguage: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

// ADR-0099 / I56.3 — the workstreams panel on the All tab. Empty by default: grouping is OPTIONAL,
// so "no groups" is the ordinary case and every assertion in this file sits under it.
const saveWorkstreamMutate = vi.hoisted(() => vi.fn())
const moveWorkstreamMutate = vi.hoisted(() => vi.fn())
const removeWorkstreamMutate = vi.hoisted(() => vi.fn())
vi.mock('./api/workstreams-api', () => ({
  useWorkstreams: () => state.workstreams,
  useSaveWorkstream: () => ({ mutate: saveWorkstreamMutate, isPending: false }),
  useMoveDeliverableToWorkstream: () => ({ mutate: moveWorkstreamMutate, isPending: false }),
  useRemoveWorkstream: () => ({ mutate: removeWorkstreamMutate, isPending: false }),
}))

vi.mock('../admin/api/admin-api', () => ({
  useDepartments: () => ({ data: [{ id: 'dep1', name: 'Content' }] }),
}))

// ADR-0088: the pending-extension line against each deliverable, and the d.7a date-change dialog,
// read their own api module (→ lib/env in CI). Stubbed; the dialog has its own suite.
vi.mock('../deliverables/api/extensions-api', () => ({
  useCampaignExtensionRequests: () => ({ data: state.extensionRequests, isLoading: false, isError: false }),
  useChangeDeliverableDueAt: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRecordDueDateOverride: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useOutstandingHours: () => ({ data: 0, isLoading: false }),
  isRefused: () => false,
}))
vi.mock('../../lib/calendar/office-calendars-api', () => ({
  usePlanningCalendar: () => ({ calendar: { workingDays: [7, 1, 2, 3, 4] }, office: null, isLoading: false }),
}))
vi.mock('../../lib/settings/scheduling-settings-api', () => ({
  DEFAULT_SCHEDULING_SETTINGS: { rule: { deliveryDaysBeforeGoLive: 2, commenceDaysBeforeDelivery: 4 }, reviewBufferWorkingDays: 1 },
  useSchedulingSettings: () => ({ data: undefined, isLoading: false }),
}))
vi.mock('./api/document-filing-api', () => ({
  fetchCampaignReferencesFolder: vi.fn(async () => 'folder-1'),
  useFileDocuments: () => ({ mutateAsync: vi.fn(async () => [{ name: 'x', ok: true, assetId: 'a1' }]) }),
}))

// The sub-task editor has its own suite; it reaches api → lib/supabase → lib/env, which throws
// where no VITE_* exists (CI).
vi.mock('../deliverables/DeliverablesPage', () => ({
  DeliverableDetail: ({ deliverableId }: { deliverableId: string }) => (
    <div data-testid={`deliverable-detail-stub-${deliverableId}`} />
  ),
  failed: (_e: unknown, text: string) => ({ kind: 'error' as const, text }),
}))

// I16.4: writing the department briefs reaches the Edge Function and the tenant claims, so the
// hook and the template list are stubbed the same way every other api on this page is.
vi.mock('./api/department-briefs-api', () => ({
  masterBriefText: (b: Record<string, string>) => Object.values(b).join(', '),
  useWriteDepartmentBriefs: () => ({ mutate: state.writeBriefs, isPending: false }),
  useSaveDepartmentBrief: () => ({ mutate: state.saveBrief, isPending: false }),
}))
// Each department carries its own template now (ADR-0048 d.5): no campaign-wide type, no picker.
// The campaign room has its own suite. Stubbed here for the reason every other api on this page
// is: importing it reaches chat-api → lib/supabase → lib/env, which throws where no VITE_* exists
// (docs/memory/traps.md — "a component test dies at IMPORT when a new import reaches lib/env").
// ADR-0140: the piece's task list is its own component with its own suite (PieceTasks.test.tsx).
vi.mock('./components/PieceTasks', () => ({ PieceTasks: (p: { deliverableId: string; markTaskId: string | null; testId?: string }) => <div data-testid={p.testId ?? 'piece-tasks'} data-deliverable={p.deliverableId} data-mark={p.markTaskId ?? ''} /> }))
vi.mock('../chat/ChatPanel', () => ({
  ChatPanel: ({ contextType, contextId }: { contextType: string; contextId: string }) => (
    <div data-testid={`chat-panel-stub-${contextType}-${contextId}`} />
  ),
}))

// ADR-0065: the department section now carries a concepts panel, whose api reaches lib/env in CI.
// Stubbed here; its own behaviour is covered in components/ConceptsPanel.test.tsx.
vi.mock('./components/ConceptsPanel', () => ({
  ConceptsPanel: ({ briefId }: { briefId: string }) => (
    <div data-testid={`concepts-panel-stub-${briefId}`} />
  ),
}))

vi.mock('./api/department-templates-api', () => ({
  useDepartmentTemplates: () => ({ data: state.deptTemplates, isLoading: false }),
  // The fallback catalogue, for a department nobody has assigned a template to (6 Sep).
  useAllBriefTemplates: () => ({ data: state.allTemplates, isLoading: false }),
}))

// Reading a campaign and rewriting its briefs are different rights, so `can` has to be answerable
// per test rather than always true.
vi.mock('../../app/permissions', () => ({
  usePermissions: () => ({ can: (g: string) => (g === 'projects:manage' ? state.canManage : true), scope: state.scope ?? 'department' }),
}))
vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'me' } }, claims: { tenantId: 't1' } }),
}))

// ADR-0070 I37.5: the department section carries an approve control. The api reaches
// lib/supabase → lib/env (traps.md), and its mutation needs a QueryClient this suite does not
// mount — so it is stubbed, and the assertions below are about the SECTION, not the button.
vi.mock('./api/brief-approval-api', () => ({
}))

import { CampaignPage } from './CampaignPage'

const CAMPAIGN: CampaignDetail = {
  id: 'cam1',
  name: 'Zeta Ramadan',
  status: 'pending_approval',
  kind: 'campaign',
  clientId: 'cli1',
  clientName: 'Zeta',
  brandName: 'Zeta KW',
  accountManagerId: 'me',
  clientAccountManagerId: null,
  accountManagerName: 'Nadia Amin',
  clientAccountManagerName: null,
  createdAt: '2026-09-10T08:00:00Z',
  updatedAt: null,
  createdByName: 'Mira Adel',
  updatedByName: null,
  approvedAt: null,
  goLiveAt: null,
  hasPhases: false,
  briefType: null,
  brief: { objective: 'Grow reach' },
  briefs: [],
  promotedJob: null,
}

const deliverable = (o: Partial<DeliverableRow> & { id: string }): DeliverableRow => ({
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
  streamId: null,
  workstreamId: null,
  streamName: null,
  discipline: null,
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
      <CampaignPage />
    </MemoryRouter>,
  )
}

/**
 * Open one of the campaign's views (CG-01, I57.4). The department tabs were retired on 24 Sep (I57
 * answer 6): the page opens on the GRID, where the work of every department is, and the brief —
 * the campaign's, a single job's, and any legacy department brief — is on Brief.
 */
function openView(view: 'brief' | 'grid') {
  fireEvent.click(screen.getByTestId(`campaign-tab-${view}`))
}

describe('CampaignPage (ADR-0048 d.9, I16.6)', () => {
  beforeEach(() => {
    state.campaign = { data: CAMPAIGN, isLoading: false, isError: false, error: null }
    state.deliverables = { data: [], isLoading: false, isError: false, error: null }
  })

  // ---- I34.7: the layout, and the people it never named -------------------------------

  it('opens the campaign brief section by default on Brief', () => {
    // Open by default on purpose: a screen that hides work until asked is a screen where work gets
    // missed. The value is closing what you have finished reviewing.
    state.deliverables = {
      data: [deliverable({ id: 'd1', departmentId: 'dep1', discipline: 'Content' })],
      isLoading: false, isError: false, error: null,
    }
    renderPage()
    openView('brief')
    expect(screen.getByTestId('campaign-master-brief-details')).toHaveAttribute('open')
  })

  // With no workstreams the grid groups by department (ADR-0099: grouping is optional), headed with
  // the department's name and how many of its pieces are delivered.
  it('groups the grid by department when the campaign has no workstreams', () => {
    state.deliverables = {
      data: [
        deliverable({ id: 'd1', departmentId: 'dep1', discipline: 'Content' }),
        deliverable({ id: 'd2', departmentId: 'dep1', discipline: 'Content', state: 'delivered' }),
      ],
      isLoading: false, isError: false, error: null,
    }
    renderPage()
    expect(screen.getByTestId('campaign-grid-group-dep1')).toHaveTextContent('Content')
    expect(screen.getByTestId('campaign-grid-group-line-dep1')).toHaveTextContent('2 deliverables · 1 delivered')
  })

  it('names the account manager, who was in the data and on no screen', () => {
    renderPage()
    expect(screen.getByTestId('campaign-account-manager')).toHaveTextContent('Nadia Amin')
  })

  it('says so when nobody can approve, rather than leaving a blank', () => {
    // An approval surface with no approver is a fact to show, not an empty line to skip past.
    state.campaign = {
      data: { ...CAMPAIGN, accountManagerId: null, accountManagerName: null },
      isLoading: false, isError: false, error: null,
    }
    renderPage()
    expect(screen.getByTestId('campaign-account-manager')).toHaveTextContent('Not assigned')
  })

  it('names each deliverable owner, and marks the unowned ones', () => {
    state.deliverables = {
      data: [
        deliverable({ id: 'd1', departmentId: 'dep1', discipline: 'Creative', ownerName: 'Sara Adel' }),
        deliverable({ id: 'd2', departmentId: 'dep1', discipline: 'Creative', ownerName: null }),
      ],
      isLoading: false, isError: false, error: null,
    }
    renderPage()
    expect(screen.getByTestId('campaign-deliverable-owner-d1')).toHaveTextContent('Sara Adel')
    expect(screen.getByTestId('campaign-deliverable-owner-d2')).toHaveTextContent('Unassigned')
  })

  // Edward, 24 Sep: the owner is the lead accountable; the WORK is split across people, and every
  // one of them is shown — never one name standing in for the piece.
  it('names everyone holding a task on a piece, and counts the tasks nobody has', () => {
    const task = (id: string, assigneeName: string | null, status: 'todo' | 'in_progress' | 'review' | 'done') =>
      ({ id, title: id, hours: 8, status, assigneeName, startsAt: null, dueAt: null })
    state.deliverables = {
      data: [deliverable({
        id: 'd1', departmentId: 'dep1', discipline: 'Creative', ownerName: 'Fadia', taskCount: 3,
        taskList: [task('a', 'Zubaida', 'done'), task('b', 'Lisa', 'review'), task('c', null, 'todo')],
      })],
      isLoading: false, isError: false, error: null,
    }
    renderPage()
    expect(screen.getByTestId('campaign-deliverable-owner-d1')).toHaveTextContent('Fadia')
    expect(screen.getByTestId('campaign-grid-executed-d1')).toHaveTextContent('Zubaida, Lisa · 1 unassigned')
  })

  it('shows the performance band only when the campaign has one', () => {
    // Five "Not applicable" panels under a Performance heading is five panels of nothing, on
    // exactly the campaigns most likely to be purely creative.
    renderPage()
    openView('brief')
    expect(screen.queryByTestId('campaign-perf-heading')).not.toBeInTheDocument()

    state.campaign = {
      data: { ...CAMPAIGN, brief: { task: 'Launch', perfBudget: 'AED 250k' } },
      isLoading: false, isError: false, error: null,
    }
    cleanup()
    renderPage()
    openView('brief')
    expect(screen.getByTestId('campaign-perf-heading')).toBeInTheDocument()
    expect(screen.getByTestId('campaign-perf-brief-perfBudget')).toHaveTextContent('AED 250k')
  })

  it('keeps an N/A field on the page rather than dropping it', () => {
    // ADR-0048 d.6: N/A means considered-and-irrelevant. Dropping it would leave a reader unable
    // to tell that from a field nobody filled in.
    state.campaign = {
      data: { ...CAMPAIGN, brief: { task: 'Launch', insight: 'N/A' } },
      isLoading: false, isError: false, error: null,
    }
    renderPage()
    openView('brief')
    expect(screen.getByTestId('campaign-master-brief-insight')).toHaveTextContent('Not applicable')
  })

  it('renders a failed campaign read as a failure, not as "not found"', () => {
    // The 27 Aug bug exactly: the query threw, `data` was undefined, and `if (!c)` claimed the
    // campaign did not exist. A failed read and a missing row are different facts.
    state.campaign = {
      data: null,
      isLoading: false,
      isError: true,
      error: new Error('column streams.brief does not exist'),
    }
    renderPage()
    const failed = screen.getByTestId('campaign-load-failed')
    expect(failed).toBeInTheDocument()
    expect(failed).toHaveAttribute('role', 'alert')
    expect(screen.getByTestId('campaign-load-failed-reason')).toHaveTextContent(
      'column streams.brief does not exist',
    )
    expect(screen.queryByText(/could not be found/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('campaign-grid-empty')).not.toBeInTheDocument()
  })

  it('reads the message off a PostgREST error object, which is not an Error', () => {
    state.campaign = {
      data: null,
      isLoading: false,
      isError: true,
      error: { code: '42703', message: 'column deliverables.brief_type does not exist' },
    }
    renderPage()
    expect(screen.getByTestId('campaign-load-failed-reason')).toHaveTextContent(
      'column deliverables.brief_type does not exist',
    )
  })

  it('renders a failed deliverables read as a failure, NOT as an empty campaign', () => {
    // `deliverables.data ?? []` used to turn a thrown query into zero sections, which the page
    // then announced as "this campaign has no deliverables yet" — a confident wrong answer.
    state.deliverables = {
      data: [],
      isLoading: false,
      isError: true,
      error: new Error('permission denied for table deliverables'),
    }
    renderPage()
    expect(screen.getByTestId('campaign-deliverables-failed')).toHaveAttribute('role', 'alert')
    expect(screen.getByTestId('campaign-deliverables-failed-reason')).toHaveTextContent(
      'permission denied for table deliverables',
    )
    expect(screen.queryByTestId('campaign-grid-empty')).not.toBeInTheDocument()
    expect(screen.getByTestId('campaign-grid-failed')).toBeInTheDocument()
    // The campaign itself loaded, so what IS known is still on screen.
    expect(screen.getByTestId('surface-campaign')).toHaveTextContent('Zeta Ramadan')
  })

  it('still shows the empty state when the reads succeeded and there is genuinely nothing', () => {
    renderPage()
    expect(screen.getByTestId('campaign-grid-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('campaign-deliverables-failed')).not.toBeInTheDocument()
    expect(screen.queryByTestId('campaign-load-failed')).not.toBeInTheDocument()
  })

  it('shows "not found" only when the read succeeded and returned nothing', () => {
    state.campaign = { data: null, isLoading: false, isError: false, error: null }
    renderPage()
    expect(screen.queryByTestId('campaign-load-failed')).not.toBeInTheDocument()
    expect(screen.getByText(/could not be found/i)).toBeInTheDocument()
  })

  it('shows a department brief on Brief, whether or not the department has work yet', () => {
    // ADR-0048 d.9: every brief has to be readable on the screen where it is approved.
    state.campaign = {
      data: {
        ...CAMPAIGN,
        briefs: [
          {
            id: 'b1',
            departmentId: 'd-film',
            departmentName: 'Film',
            briefType: 'film',
            values: { objective: 'Shoot the TVC' }, approvedAt: null, approvedByName: null,
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    }
    state.deliverables = {
      data: [deliverable({ id: 'd1', departmentId: 'd-creative', discipline: 'Creative' })],
      isLoading: false,
      isError: false,
      error: null,
    }
    renderPage()
    expect(screen.getByTestId('campaign-grid-group-d-creative')).toBeInTheDocument()
    openView('brief')
    expect(screen.getByTestId('campaign-department-brief-d-film')).toHaveTextContent('Shoot the TVC')
  })
})

// Edward, 29 Aug: the approval message showed with no button, on a campaign nobody could approve.
// `app.approve_campaign` resolves the approver as coalesce(campaign, client); the surface read only
// the campaign's, which `create_campaign_from_brief` never sets — so the button was unreachable on
// every wizard-created campaign, and the person actually allowed to press it was told they were not.
describe('CampaignPage — who may approve (29 Aug)', () => {
  const pending = (over: Partial<CampaignDetail>): CampaignDetail => ({
    ...CAMPAIGN, status: 'pending_approval', accountManagerId: null, clientAccountManagerId: null, ...over,
  })

  it('offers approval when the CLIENT names you, even though the campaign does not', () => {
    state.campaign = { data: pending({ clientAccountManagerId: 'me' }), isLoading: false, isError: false, error: null }
    renderPage()
    expect(screen.getByTestId('campaign-approve')).toBeInTheDocument()
  })

  it('still offers it when the campaign names you directly', () => {
    state.campaign = { data: pending({ accountManagerId: 'me', clientAccountManagerId: 'someone-else' }), isLoading: false, isError: false, error: null }
    renderPage()
    expect(screen.getByTestId('campaign-approve')).toBeInTheDocument()
  })

  // I52.16 (Edward, 17 Sep): the campaign row named the wrong person and a Power Admin could not
  // approve — the screen offered the button to the one resolved name only, though the database
  // admits tenant-wide and all-accounts reach (ADR-0083 addendum d.14). The backup that was required.
  it('offers approval to a tenant-wide viewer (Power Admin, Traffic) whoever the row names (I52.16)', () => {
    state.scope = 'tenant'
    state.campaign = { data: pending({ accountManagerId: 'someone-else' }), isLoading: false, isError: false, error: null }
    renderPage()
    expect(screen.getByTestId('campaign-approve')).toBeInTheDocument()
    // and may correct who the manager is (I52.17)
    expect(screen.getByTestId('campaign-account-manager-change')).toBeInTheDocument()
    state.scope = 'department'
  })

  it('offers it to an all-accounts viewer (Account Director) too, and not to a department lead', () => {
    state.scope = 'all_accounts'
    state.campaign = { data: pending({ accountManagerId: 'someone-else' }), isLoading: false, isError: false, error: null }
    renderPage()
    expect(screen.getByTestId('campaign-approve')).toBeInTheDocument()
    cleanup()
    state.scope = 'department'
    renderPage()
    expect(screen.queryByTestId('campaign-approve')).not.toBeInTheDocument()
    expect(screen.queryByTestId('campaign-account-manager-change')).not.toBeInTheDocument()
  })

  // ADR-0137 (I73.2): the approval authority renames a live campaign; a draft's name is the wizard's.
  it('offers Rename beside the name to its account manager, not to a department lead, and sends the new name', () => {
    state.campaign = { data: pending({ accountManagerId: 'me', status: 'approved' }), isLoading: false, isError: false, error: null }
    renderPage()
    fireEvent.click(screen.getByTestId('campaign-rename-open'))
    fireEvent.change(screen.getByTestId('campaign-rename-input'), { target: { value: '  Spring Launch 2  ' } })
    fireEvent.click(screen.getByTestId('campaign-rename-save'))
    expect(renameCampaignMutate).toHaveBeenCalledWith({ campaignId: expect.any(String), name: 'Spring Launch 2' }, expect.anything())
    cleanup()
    state.campaign = { data: pending({ accountManagerId: 'someone-else', status: 'approved' }), isLoading: false, isError: false, error: null }
    renderPage()
    expect(screen.queryByTestId('campaign-rename-open')).not.toBeInTheDocument()
  })

  it('says NOBODY can approve when neither names anyone, rather than blaming an absent person', () => {
    state.campaign = { data: pending({}), isLoading: false, isError: false, error: null }
    renderPage()
    expect(screen.queryByTestId('campaign-approve')).not.toBeInTheDocument()
    expect(screen.getByTestId('campaign-approve-denied')).toHaveTextContent(/no account manager is set/i)
  })

  it('names the account manager as the blocker only when there actually is one', () => {
    state.campaign = { data: pending({ clientAccountManagerId: 'someone-else' }), isLoading: false, isError: false, error: null }
    renderPage()
    expect(screen.getByTestId('campaign-approve-denied')).toHaveTextContent(/only.*account manager/i)
  })
})

/**
 * ADR-0048 d.9 — the page names the approver.
 *
 * It had the id all along and never showed a name, so the best it could say was "the account
 * manager". That is not an answer to the only question the reader has, which is who to chase.
 */
describe('CampaignPage — naming the approver (30 Aug)', () => {
  it('names them in the waiting note', () => {
    state.campaign.data = { ...CAMPAIGN, accountManagerId: 'someone-else', accountManagerName: 'Nadia Amin' }
    renderPage()
    expect(screen.getByTestId('campaign-pending-note').textContent).toContain('Nadia Amin')
  })

  it('names them in the refusal too', () => {
    state.campaign.data = { ...CAMPAIGN, accountManagerId: 'someone-else', accountManagerName: 'Nadia Amin' }
    renderPage()
    expect(screen.getByTestId('campaign-approve-denied').textContent).toContain('Nadia Amin')
  })

  // The name follows the same coalesce the approval does: the campaign's own, else the client's.
  it('falls back to the client’s manager when the campaign names nobody', () => {
    state.campaign.data = {
      ...CAMPAIGN,
      accountManagerId: null,
      accountManagerName: null,
      clientAccountManagerId: 'someone-else',
      clientAccountManagerName: 'Omar Client-Manager',
    }
    renderPage()
    expect(screen.getByTestId('campaign-pending-note').textContent).toContain('Omar Client-Manager')
  })

  // Still the honest sentence when there is genuinely nobody — never a name-shaped blank.
  it('says nobody can approve it when neither level names anyone', () => {
    state.campaign.data = {
      ...CAMPAIGN, accountManagerId: null, accountManagerName: null,
      clientAccountManagerId: null, clientAccountManagerName: null,
    }
    renderPage()
    expect(screen.getByTestId('campaign-approve-denied').textContent).toContain('No account manager')
  })
})

// Edward, 24 Sep: "We need to retain the legacy data, but brief controls can be removed". A
// campaign that already carries a department brief still shows it — read only — and nothing on the
// tab writes, edits or asks for one.
describe('CampaignPage — a legacy department brief is kept, read only (ADR-0100 d.6)', () => {
  beforeEach(() => {
    state.canManage = true
    state.campaign.data = {
      ...CAMPAIGN,
      briefs: [{
        id: 'b1', departmentId: 'dept-creative', departmentName: 'Creative',
        briefType: '360', values: { objective: 'Reach young Iraqis in Ramadan' }, approvedAt: null, approvedByName: null,
      }],
    }
    state.deliverables.data = [deliverable({ id: 'd1', name: 'Hero film', departmentId: 'dept-creative', discipline: 'Creative' })]
  })

  it('shows the brief it already has, with no Edit', () => {
    renderPage()
    openView('brief')
    expect(screen.getByTestId('campaign-department-brief-dept-creative')).toHaveTextContent('Reach young Iraqis in Ramadan')
    expect(screen.queryByTestId('campaign-department-brief-dept-creative-edit')).toBeNull()
  })

  // ADR-0084: a single job's ONE brief is this department brief, written by the account manager.
  // Retiring the campaign's department brief must not take the single job's edit with it.
  it('keeps the edit on a single job, whose only brief this is', () => {
    state.campaign.data = { ...state.campaign.data!, kind: 'single_job' }
    renderPage()
    openView('brief')
    expect(screen.getByTestId('campaign-department-brief-dept-creative-edit')).toBeInTheDocument()
  })

  // I56.28 (Edward, 24 Sep): concepts are off the page until it is decided where they live.
  it('shows no concepts panel, even beside a brief', () => {
    renderPage()
    openView('brief')
    expect(screen.queryByTestId('concepts-panel-stub-b1')).toBeNull()
  })

  it('offers nothing to write one where there is none', () => {
    state.campaign.data = { ...CAMPAIGN, briefs: [] }
    renderPage()
    openView('brief')
    expect(screen.queryByTestId('campaign-department-nobrief-dept-creative')).toBeNull()
    expect(screen.queryByTestId('campaign-write-briefs')).toBeNull()
    expect(screen.queryByText(/Generate the brief/i)).toBeNull()
  })
})

/**
 * The page head (CG-01, Edward 24 Sep, option a): NO rings. The per-piece rings and the phase strip
 * came off the campaign page — the frame draws neither — and what they said is on the grid (Status,
 * Executed), the season map and the brief. `StatusRollupStrip` keeps its own suite: the campaign
 * CHAT ROOM still heads itself with it.
 */
describe('CampaignPage — the head carries no rings; phases are managed beside the tabs', () => {
  afterEach(() => { vi.useRealTimers() })
  beforeEach(() => {
    state.campaign = { data: CAMPAIGN, isLoading: false, isError: false, error: null }
    state.deliverables = { data: [], isLoading: false, isError: false, error: null }
  })

  it('shows no rings, whatever the work', () => {
    state.deliverables.data = [
      deliverable({ id: 'a', name: 'Hero film', state: 'approved', taskTotal: 4, doneCount: 4 }),
      deliverable({ id: 'b', name: 'Cutdowns', state: 'in_progress', taskCount: 6, unassignedCount: 6, taskTotal: 6, doneCount: 0 }),
    ]
    renderPage()
    expect(screen.queryByTestId('campaign-status-overall')).toBeNull()
    expect(screen.queryByTestId('campaign-phases')).toBeNull()
  })

  it('says how big the campaign is on one line: pieces, and the people on it', () => {
    const task = (id: string, assigneeName: string | null) => ({ id, title: id, hours: 8, status: 'todo' as const, assigneeName, startsAt: null, dueAt: null })
    state.deliverables.data = [
      deliverable({ id: 'a', ownerName: 'Fadia', taskList: [task('t1', 'Zubaida'), task('t2', 'Lisa')] }),
      deliverable({ id: 'b', ownerName: 'Fadia', taskList: [task('t3', 'Zubaida')] }),
      deliverable({ id: 'c', state: 'archived', ownerName: 'Somebody else' }),
    ]
    renderPage()
    // Two live pieces; Fadia, Zubaida and Lisa — each once; the closed piece counts for nothing.
    // I63.1 (Edward, 28 Sep, A): the frame's line — pieces, delivered, at risk, and who approves.
    expect(screen.getByTestId('campaign-summary')).toHaveTextContent('2 deliverables · 0 delivered')
    expect(screen.getByTestId('campaign-summary')).toHaveTextContent('Nadia Amin approves')
  })

  // ADR-0096 d.4: phases are the campaign's shape — its approval authority's. The account manager
  // here is the viewer, so the campaign without phases offers to turn them on, beside the tabs.
  it('offers to turn phases on beside the tabs, to the authority, with the reason as a tip', () => {
    renderPage()
    expect(screen.getByTestId('campaign-phases-on')).toBeInTheDocument()
    expect(screen.getByTestId('campaign-phases-on-tip')).toBeInTheDocument()
    expect(screen.queryByTestId('campaign-phases-manage')).toBeNull()
  })

  it('offers Manage phases once the campaign has them', () => {
    state.campaign.data = { ...CAMPAIGN, hasPhases: true }
    renderPage()
    expect(screen.getByTestId('campaign-phases-manage')).toBeInTheDocument()
    expect(screen.queryByTestId('campaign-phases-on')).toBeNull()
  })

  it('offers neither to somebody outside the authority, nor on a single job', () => {
    state.campaign.data = { ...CAMPAIGN, accountManagerId: 'someone-else', hasPhases: true }
    renderPage()
    expect(screen.queryByTestId('campaign-phases-manage')).toBeNull()
    // Nor "Edit this brief" on the header — the Brief tab's own rule (a team member reads the brief, edits nothing).
    expect(screen.queryByTestId('campaign-edit-brief')).toBeNull()
    cleanup()
    state.campaign.data = { ...CAMPAIGN, kind: 'single_job' }
    renderPage()
    expect(screen.queryByTestId('campaign-phases-on')).toBeNull()
  })

  it('shows a due date per deliverable, which is what makes a state readable as late', () => {
    // I66.8: a date shows its year only when it is not this year, so pin "today" (the date only).
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-29T09:00:00Z'))
    // 15:00Z is 18:00 Iraq — the close of the working day, which is what a deadline IS (ADR-0076).
    state.deliverables.data = [deliverable({ id: 'a', dueAt: '2026-09-04T15:00:00Z' })]
    renderPage()
    // ADR-0075 addendum (20 Sep): a deliverable's date is a DAY on the page — never a clock time.
    // Short on the grid (CG-01), as the frame sets it.
    expect(screen.getByTestId('campaign-grid-due-a')).toHaveTextContent('Fri, 4 Sep')
    expect(screen.getByTestId('campaign-deliverable-a')).not.toHaveTextContent('18:00')
  })

  it('does NOT mount chat here — chat is its own surface (ADR-0063)', () => {
    // Mounted inline on 31 Aug and removed the same day: "the chat is not meant to be at the bottom
    // of each section, but a separate page altogether, Discord style". `/chat` is `I32`.
    state.deliverables.data = [deliverable({ id: 'a', taskCount: 3 })]
    renderPage()
    expect(screen.queryByTestId('chat-panel-stub-campaign-cam1')).toBeNull()
  })
})

describe('CampaignPage — the views, and the grid that took over the department tabs (CG-01, I57.4)', () => {
  const twoDepartments: DeliverableRow[] = [
    deliverable({ id: 'd1', name: 'Hero film', departmentId: 'dept-creative', discipline: 'Creative' }),
    deliverable({ id: 'd2', name: 'Reel', departmentId: 'dept-content', discipline: 'Content' }),
  ]

  beforeEach(() => {
    state.campaign.data = CAMPAIGN
    state.deliverables.data = twoDepartments
    state.workstreams = { data: [], isLoading: false, isError: false }
  })

  it('offers Brief and Grid, and no tab per department', () => {
    renderPage()
    expect(screen.getByTestId('campaign-tab-brief')).toBeInTheDocument()
    expect(screen.getByTestId('campaign-tab-grid')).toBeInTheDocument()
    expect(screen.queryByTestId('campaign-tab-dept-creative')).toBeNull()
    expect(screen.queryByTestId('campaign-tab-all')).toBeNull()
  })

  it('opens on the grid, with every department\'s work on it', () => {
    renderPage()
    expect(screen.getByTestId('campaign-tab-grid')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('campaign-deliverable-d1')).toHaveTextContent('Hero film')
    expect(screen.getByTestId('campaign-deliverable-d2')).toHaveTextContent('Reel')
    expect(screen.queryByTestId('campaign-master-brief-details')).toBeNull()
  })

  it('groups by workstream when the campaign has them, and says who manages each', () => {
    state.workstreams = {
      data: [{ id: 'ws1', name: 'Launch films', departmentId: 'dept-creative', departmentName: 'Creative', ownerUserId: 'u1', ownerName: 'Inas', deliverableCount: 1 }],
      isLoading: false, isError: false,
    }
    state.deliverables.data = [{ ...twoDepartments[0], workstreamId: 'ws1' }, twoDepartments[1]]
    renderPage()
    expect(screen.getByTestId('campaign-grid-group-ws1')).toHaveTextContent('Launch films')
    expect(screen.getByTestId('campaign-grid-group-line-ws1')).toHaveTextContent('Inas manages')
    expect(screen.getByTestId('campaign-grid-group-none')).toHaveTextContent('Not in a workstream')
  })

  // A link may still name an old tab (My Work's "Write Creative's brief" used a department id).
  it('opens an old department link on the grid, and the old campaign-brief link on Brief', () => {
    render(<MemoryRouter initialEntries={['/campaigns/cam1?tab=dept-creative']}><CampaignPage /></MemoryRouter>)
    expect(screen.getByTestId('campaign-tab-grid')).toHaveAttribute('aria-selected', 'true')
    cleanup()
    render(<MemoryRouter initialEntries={['/campaigns/cam1?tab=campaign']}><CampaignPage /></MemoryRouter>)
    expect(screen.getByTestId('campaign-tab-brief')).toHaveAttribute('aria-selected', 'true')
  })

  // ADR-0100 d.2: the owners accept their task lists on the grid now — the panel shows while lists
  // wait on an approved campaign, and "Needs approval" narrows the sheet to those pieces.
  it('shows the task lists waiting for their owners, and Needs approval narrows the sheet to them', () => {
    state.campaign.data = { ...CAMPAIGN, status: 'approved', approvedAt: '2026-09-06T09:00:00Z' }
    state.deliverables.data = [
      deliverable({ id: 'd1', name: 'Hero film', departmentId: 'dept-creative', discipline: 'Creative', taskCount: 3 }),
      deliverable({ id: 'd2', name: 'Reel', departmentId: 'dept-content', discipline: 'Content', taskCount: 2, tasksApprovedAt: '2026-09-07T09:00:00Z' }),
    ]
    renderPage()
    expect(screen.getByTestId('campaign-task-lists')).toBeInTheDocument()
    expect(screen.getByTestId('campaign-grid-approved-d1')).toHaveTextContent('Pending')
    expect(screen.getByTestId('campaign-grid-approved-d2')).toHaveTextContent('Yes')
    fireEvent.click(screen.getByTestId('campaign-grid-filter-approval'))
    expect(screen.getByTestId('campaign-deliverable-d1')).toBeInTheDocument()
    expect(screen.queryByTestId('campaign-deliverable-d2')).toBeNull()
  })

  it('shows no approval panel before the campaign is approved — there are no task lists to accept yet', () => {
    state.deliverables.data = [deliverable({ id: 'd1', name: 'Hero film', departmentId: 'dept-creative', discipline: 'Creative', taskCount: 3 })]
    renderPage()
    expect(screen.queryByTestId('campaign-task-lists')).toBeNull()
  })

  it('filters by owner, and says so plainly when the filters match nothing', () => {
    state.deliverables.data = [
      deliverable({ id: 'd1', departmentId: 'dept-creative', discipline: 'Creative', ownerUserId: 'u1', ownerName: 'Fadia' }),
      deliverable({ id: 'd2', departmentId: 'dept-creative', discipline: 'Creative', ownerUserId: 'u2', ownerName: 'Jaafar' }),
    ]
    renderPage()
    fireEvent.change(screen.getByTestId('campaign-grid-filter-owner'), { target: { value: 'u2' } })
    expect(screen.queryByTestId('campaign-deliverable-d1')).toBeNull()
    expect(screen.getByTestId('campaign-deliverable-d2')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('campaign-grid-filter-status'), { target: { value: 'in_review' } })
    expect(screen.getByTestId('campaign-grid-no-matches')).toBeInTheDocument()
  })

  // CG-04 (I57.16): Open opens the piece drawer — its tasks one by one, each with its assignee.
  it('opens a piece in the drawer, with every task and who has it', () => {
    state.deliverables.data = [{
      ...twoDepartments[0],
      ownerName: 'Fadia',
      taskList: [
        { id: 't1', title: 'Develop concept', hours: 8, status: 'done', assigneeName: 'Zubaida', startsAt: null, dueAt: null },
        { id: 't2', title: 'Create artwork', hours: 8, status: 'review', assigneeName: 'Lisa', startsAt: null, dueAt: null },
      ],
    }]
    renderPage()
    fireEvent.click(screen.getByTestId('campaign-deliverable-open-d1'))
    expect(screen.getByTestId('piece-drawer-owner')).toHaveTextContent('Owned by Fadia')
    // ADR-0132 d.2 / ADR-0140: for someone who may edit the piece, the story is its task list — `PieceTasks`, whose
    // rows (who has each task, its status) are tested in its own suite.
    expect(screen.getByTestId('piece-panel-tasks')).toHaveAttribute('data-deliverable', 'd1')
    fireEvent.click(screen.getByTestId('piece-drawer-close'))
    expect(screen.queryByTestId('piece-drawer')).toBeNull()
  })

  // I57.19: the internal approval reads Approved on the Grid (Edward, 24 Sep).
  it('reads an internally approved deliverable as Approved, not Complete', () => {
    state.deliverables.data = [deliverable({ id: 'd1', departmentId: 'dept-creative', discipline: 'Creative', state: 'approved', progress: { phase: 'complete', total: 0, unassigned: 0, done: 2, everTotal: 2, inReview: 0, inProgress: 0, notStarted: 0 } })]
    renderPage()
    expect(screen.getByTestId('campaign-grid-status-d1')).toHaveTextContent('Approved')
  })

  // I57.24: a filter that empties a group hides its heading.
  it('hides a group the filters have emptied', () => {
    state.deliverables.data = [
      deliverable({ id: 'd1', departmentId: 'dept-creative', discipline: 'Creative', ownerUserId: 'u1', ownerName: 'Fadia' }),
      deliverable({ id: 'd2', departmentId: 'dept-content', discipline: 'Content', ownerUserId: 'u2', ownerName: 'Abeer' }),
    ]
    renderPage()
    fireEvent.change(screen.getByTestId('campaign-grid-filter-owner'), { target: { value: 'u2' } })
    expect(screen.queryByTestId('campaign-grid-group-dept-creative')).toBeNull()
    expect(screen.getByTestId('campaign-grid-group-dept-content')).toBeInTheDocument()
  })
})

/**
 * ADR-0088 on the campaign page: the pending request against the deliverable (d.10), and the one
 * route by which the promised date changes (d.7a) — offered only on an approved campaign, and
 * opening a dialog that will not save without the client's agreement attached.
 */
describe('CampaignPage — deadline extensions and the promised date (ADR-0088)', () => {
  beforeEach(() => {
    state.campaign.data = { ...CAMPAIGN, status: 'approved', approvedAt: '2026-09-06T09:00:00Z' }
    state.deliverables.data = [
      deliverable({ id: 'd1', name: 'Hero film', departmentId: 'dept-creative', discipline: 'Creative', dueAt: '2026-09-25T15:00:00Z' }),
    ]
    state.extensionRequests = [{ deliverableId: 'd1', requestId: 'r1' }]
  })

  // I59 Track 11: Needs you's "Send a new request" (Track 6) links to `/campaigns/:id?edit=<piece>`. ADR-0132 d.2:
  // the piece's panel is the editor now, so the link opens it.
  it('opens the piece a link names (?edit=) in its editing panel, and nothing for an id not on the campaign', () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/campaigns/cam?edit=d1']}>
        <CampaignPage />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('piece-panel')).toBeInTheDocument()
    unmount()
    render(
      <MemoryRouter initialEntries={['/campaigns/cam?edit=not-here']}>
        <CampaignPage />
      </MemoryRouter>,
    )
    expect(screen.queryByTestId('piece-panel')).not.toBeInTheDocument()
  })

  it('says how many extension requests are pending against the deliverable', () => {
    renderPage()
    expect(screen.getByTestId('campaign-deliverable-extensions-d1')).toHaveTextContent('1')
  })

  // CG-E1 (I57.11): the date is changed from Edit — its Due field opens the evidenced dialog.
  // I59 E5: the attachment is asked for, never required — Save is open without it.
  // ADR-0132 d.3: the due date is corrected directly by those who may edit the piece — a day, due at 18:00 Iraq.
  it('saves a new due date directly, as a day', async () => {
    editDirectMutateAsync.mockClear()
    renderPage()
    fireEvent.click(screen.getByTestId('campaign-deliverable-edit-d1'))
    fireEvent.change(screen.getByTestId('piece-panel-due'), { target: { value: '2026-10-12' } })
    fireEvent.click(screen.getByTestId('piece-panel-save'))
    await vi.waitFor(() => expect(editDirectMutateAsync).toHaveBeenCalledWith({ deliverableId: 'd1', dueDay: '2026-10-12' }))
  })

  // The client asking for something different still goes as a change request — the Edit dialog's route.
  it('keeps "The client asked for a change", which opens the change-request route', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('campaign-deliverable-edit-d1'))
    fireEvent.click(screen.getByTestId('piece-panel-client-change'))
    expect(screen.getByTestId('campaign-deliverable-form')).toBeInTheDocument()
    expect(screen.queryByTestId('piece-panel')).toBeNull()
  })
})

/**
 * I54.15 — the campaign page is where somebody decides what a department picks up first, so the
 * priority mark belongs on the deliverable's name here exactly as it does on My Work.
 */
describe('CampaignPage — priority on a deliverable row (I54.15)', () => {
  beforeEach(() => {
    state.campaign = { data: CAMPAIGN, isLoading: false, isError: false, error: null }
    state.deliverables = { data: [], isLoading: false, isError: false, error: null }
  })

  it('marks a high-priority deliverable, and names it in words for a reader who cannot see colour', () => {
    state.deliverables = {
      data: [deliverable({ id: 'd1', departmentId: 'dep1', discipline: 'Content', priority: 'high' })],
      isLoading: false, isError: false, error: null,
    }
    renderPage()
    const mark = screen.getByTestId('campaign-deliverable-priority-d1')
    expect(mark).toHaveAttribute('data-priority', 'high')
    expect(mark).toHaveTextContent('High')
  })

  it('leaves a deliverable with no priority unmarked', () => {
    state.deliverables = {
      data: [deliverable({ id: 'd1', departmentId: 'dep1', discipline: 'Content' })],
      isLoading: false, isError: false, error: null,
    }
    renderPage()
    expect(screen.queryByTestId('campaign-deliverable-priority-d1')).not.toBeInTheDocument()
  })
})

/**
 * ADR-0132 (I68.2, I68.3, I68.6, I68.7): the campaign page is the one page. A link opens a piece's panel on the task
 * the person came from; the panel edits the piece and its task list; a single job keeps the six tabs, greyed where
 * they would be empty; the header carries Edit the brief, Add a deliverable and — on a single job — Promote.
 */
describe('the one page (ADR-0132)', () => {
  const task = (id: string, title: string, status: 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled' = 'todo') =>
    ({ id, title, hours: null, status, assigneeName: status === 'todo' ? null : 'Zubaida Jamil', startsAt: null, dueAt: '2026-10-01T15:00:00Z' })
  const withTasks = (o: Partial<DeliverableRow> = {}) =>
    deliverable({ id: 'd1', name: 'Campus OOH', state: 'in_progress', deliverableTypeId: 'ooh', typeName: 'OOH poster', dueAt: '2026-10-01T15:00:00Z',
      taskList: [task('t0', 'Creative Direction', 'done'), task('t1', 'Design', 'in_progress'), task('t2', 'Translation')], ...o })
  const renderAt = (url: string) =>
    render(
      <MemoryRouter initialEntries={[url]}>
        <CampaignPage />
      </MemoryRouter>,
    )
  beforeEach(() => {
    state.campaign = { data: { ...CAMPAIGN, status: 'approved' }, isLoading: false, isError: false, error: null }
    state.deliverables = { data: [withTasks()], isLoading: false, isError: false, error: null }
    addTaskMutate.mockReset()
  })
  afterEach(() => { cleanup(); state.catalogueItems = [] })

  it('opens the piece a link names, with the task the person came from marked (?piece=&task=)', () => {
    renderAt('/campaigns/cam?piece=d1&task=t1')
    expect(screen.getByTestId('piece-panel')).toBeInTheDocument()
    // The task list marks it (PieceTasks.test.tsx asserts the row's mark and "you came from here").
    expect(screen.getByTestId('piece-panel-tasks')).toHaveAttribute('data-mark', 't1')
  })

  it('keeps the panel open on the same piece when the tab changes', () => {
    renderAt('/campaigns/cam?piece=d1')
    fireEvent.click(screen.getByTestId('campaign-tab-board'))
    expect(screen.getByTestId('piece-panel')).toBeInTheDocument()
  })

  // ADR-0140 (I74.10–I74.12) retired the four-column table and its name-and-date add row: the suggested list, Who and
  // Dates, add-your-own and "Approve N tasks" are `PieceTasks`, tested in PieceTasks.test.tsx.

  // I71.7 (Edward, 1 Oct, A): lost when ADR-0132 d.8 retired the window — back above Approve, dismissable per visit.
  it('shows the brief’s risk above the task-list approval, and Close hides it', () => {
    risk.text = 'Legal must sign off the copy'
    try {
      renderAt('/campaigns/cam?piece=d1')
      expect(screen.getByTestId('piece-panel-risk-note')).toHaveTextContent('Legal must sign off the copy')
      fireEvent.click(screen.getByTestId('piece-panel-risk-dismiss'))
      expect(screen.queryByTestId('piece-panel-risk')).toBeNull()
      // The list and its Approve (PieceTasks) stay.
      expect(screen.getByTestId('piece-panel-tasks')).toBeInTheDocument()
    } finally {
      risk.text = null
    }
  })

  it('shows the Back button at the top and the foot, and Edit the brief and Add a deliverable on the header', () => {
    renderAt('/campaigns/cam')
    expect(screen.getByTestId('campaign-back')).toBeInTheDocument()
    expect(screen.getByTestId('campaign-back-foot')).toBeInTheDocument()
    expect(screen.getByTestId('campaign-edit-brief')).toBeInTheDocument()
    expect(screen.queryByTestId('campaign-promote-job')).toBeNull()
  })

  it('a single job: the same six tabs, Board and Where is everything greyed with one deliverable, Promote on the header', () => {
    state.campaign = { data: { ...CAMPAIGN, status: 'approved', kind: 'single_job' }, isLoading: false, isError: false, error: null }
    renderAt('/campaigns/cam')
    for (const v of ['brief', 'where', 'grid', 'seasonMap', 'board', 'timeline']) {
      expect(screen.getByTestId(`campaign-tab-${v}`)).toBeInTheDocument()
    }
    expect(screen.getByTestId('campaign-tab-board')).toBeDisabled()
    expect(screen.getByTestId('campaign-tab-where')).toBeDisabled()
    expect(screen.getByTestId('campaign-tab-board-why')).toBeInTheDocument()
    // It is dated, so the season map and the timeline have something to show.
    expect(screen.getByTestId('campaign-tab-seasonMap')).toBeEnabled()
    expect(screen.getByTestId('campaign-tab-timeline')).toBeEnabled()
    expect(screen.getByTestId('campaign-tab-grid')).toBeEnabled()
    expect(screen.getByTestId('campaign-promote-job')).toBeInTheDocument()
    expect(screen.queryByTestId('campaign-open-deliverable')).toBeNull()
  })

  it('a single job with nothing dated greys the season map and the timeline too', () => {
    state.campaign = { data: { ...CAMPAIGN, status: 'approved', kind: 'single_job' }, isLoading: false, isError: false, error: null }
    state.deliverables = { data: [withTasks({ dueAt: null })], isLoading: false, isError: false, error: null }
    renderAt('/campaigns/cam')
    expect(screen.getByTestId('campaign-tab-seasonMap')).toBeDisabled()
    expect(screen.getByTestId('campaign-tab-timeline')).toBeDisabled()
  })

  it('asks before a new type replaces the list: what is cancelled, who is told, what is kept, what is added', async () => {
    state.catalogueItems = [
      { id: 'ooh', name: 'OOH poster', code: 'OOH', category: 'Print' },
      { id: 'static', name: 'Social static', code: 'SST', category: 'Social' },
    ]
    renderAt('/campaigns/cam?piece=d1')
    fireEvent.change(screen.getByTestId('piece-panel-type'), { target: { value: 'Social static' } })
    fireEvent.mouseDown(screen.getByTestId('piece-panel-type-option-static'))
    fireEvent.click(screen.getByTestId('piece-panel-save'))
    const confirm = screen.getByTestId('piece-panel-type-confirm-dialog')
    expect(confirm).toHaveTextContent('Design')
    expect(confirm).toHaveTextContent('Zubaida Jamil')
    expect(confirm).toHaveTextContent('Creative Direction')
    expect(confirm).toHaveTextContent('Design — Social static')
    fireEvent.click(screen.getByTestId('piece-panel-type-confirm-confirm'))
    await vi.waitFor(() => expect(changeTypeMutateAsync).toHaveBeenCalledWith({ deliverableId: 'd1', typeId: 'static' }))
  })

  it('asks before a new quantity cancels units, naming them and who is told, then changes it directly', async () => {
    editDirectMutateAsync.mockClear()
    renderAt('/campaigns/cam?piece=d1')
    fireEvent.change(screen.getByTestId('piece-panel-quantity'), { target: { value: '2' } })
    fireEvent.click(screen.getByTestId('piece-panel-save'))
    const confirm = screen.getByTestId('piece-panel-quantity-confirm-dialog')
    expect(confirm).toHaveTextContent('Create Artwork 3')
    expect(confirm).toHaveTextContent('Abeer Saad')
    expect(editDirectMutateAsync).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('piece-panel-quantity-confirm-confirm'))
    await vi.waitFor(() => expect(editDirectMutateAsync).toHaveBeenCalledWith({ deliverableId: 'd1', quantity: 2 }))
  })

  it('edits the channel, the deliverable\'s own languages (Kurdish added to it alone) and the brief lines', async () => {
    updateDetailsMutateAsync.mockClear()
    state.campaign = { data: { ...CAMPAIGN, status: 'approved', languages: ['en', 'ar'] }, isLoading: false, isError: false, error: null }
    state.deliverables = { data: [withTasks({ languages: ['en', 'ar'] })], isLoading: false, isError: false, error: null }
    renderAt('/campaigns/cam?piece=d1')
    // It starts with its languages, as chips.
    expect(screen.getByTestId('piece-panel-languages-chip-en')).toBeInTheDocument()
    expect(screen.getByTestId('piece-panel-languages-chip-ar')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('piece-panel-channel'), { target: { value: 'TikTok' } })
    fireEvent.change(screen.getByTestId('piece-panel-languages-input'), { target: { value: 'Kur' } })
    fireEvent.mouseDown(screen.getByTestId('piece-panel-languages-option-ku'))
    fireEvent.change(screen.getByTestId('piece-panel-brief-lines'), { target: { value: 'Arabic master' } })
    fireEvent.click(screen.getByTestId('piece-panel-save'))
    await vi.waitFor(() =>
      expect(updateDetailsMutateAsync).toHaveBeenCalledWith({
        campaignId: 'cam1', deliverableId: 'd1', channel: 'TikTok', languages: ['en', 'ar', 'ku'], notes: 'Arabic master',
      }),
    )
  })

  it('will not save a deliverable with no language, and says so (Q18)', () => {
    state.campaign = { data: { ...CAMPAIGN, status: 'approved', languages: ['en'] }, isLoading: false, isError: false, error: null }
    state.deliverables = { data: [withTasks({ languages: ['en'] })], isLoading: false, isError: false, error: null }
    renderAt('/campaigns/cam?piece=d1')
    fireEvent.click(screen.getByTestId('piece-panel-languages-remove-en'))
    expect(screen.getByTestId('piece-panel-languages-missing')).toBeInTheDocument()
    expect(screen.getByTestId('piece-panel-save')).toBeDisabled()
  })
})
