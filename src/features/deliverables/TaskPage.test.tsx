import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import '../../lib/i18n'
import type { AssignedWorkItem } from './api/deliverables-api'

/**
 * The task page (ADR-0105 d.3, I59.11, Figma M2 / M4). Every function the four My Work pop-ups had
 * is proven here — the assertions of MyWorkPanel.test.tsx's Submit / Review-feedback / Deliverable /
 * Ask-for-more-time cases moved over one by one — plus the page's states: to do, in progress, in
 * review, changes requested, manual, digital, someone else's.
 *
 * The api modules reach lib/env (throws in CI) so they are mocked; ReviewPanel is stubbed (its own
 * suite covers it) and TaskReviewThread is real over mocked comments, as the old dialog tests had it.
 */

const state = vi.hoisted(() => ({
  task: null as AssignedWorkItem | null,
  loading: false,
  submitMutate: vi.fn(),
  startMutate: vi.fn(),
  transitionMutate: vi.fn(),
  uploadMutate: vi.fn(),
  versions: [] as { id: string; round: number; version: number; uploadedByName?: string; createdAt: string; contentType?: string }[],
  taskComments: [] as { id: string; round: number; authorId: string | null; body: string; resolved: boolean; authorName: string | null; createdAt: string; linkUrl: string | null }[],
  pins: [] as { id: string; round: number; body: string; authorName: string | null; authorId?: string | null; mediaRecordId?: string | null; posX?: number | null; posY?: number | null; resolved: boolean; parentId?: string | null; doneAt?: string | null; doneById?: string | null; doneByName?: string | null }[],
  extensions: new Map<string, unknown>(),
  rules: [] as { kind: 'do' | 'dont'; text: string }[],
  brief: null as { key: string; en: string; ar: string; value: string }[] | null,
  receipt: null as { subject: string | null; receivedAt: string | null; recordedBy: string | null } | null,
  timer: null as { startedAt: string | null; submittedAt: string | null; minutes: number | null } | null,
  timerAsked: null as { subTaskId: string | null; round: number } | null,
  refs: [] as { id: string; name: string }[],
  inputs: [] as { id: string; subTaskId?: string | null; kind?: string | null; description: string; awaitedFrom: string | null; requestedAt: string; satisfiedAt: string | null }[],
  timing: null as { startedAt: string | null; elapsedMinutes: number | null; thresholdMinutes: number; isUntimed: boolean; allocatedHours: number | null; blockedMinutesSoFar: number } | null,
  questions: [] as { id: string; authorId: string; authorName: string | null; recipients: { id: string; name: string | null }[]; body: string; createdAt: string; replies: { id: string; authorId: string; authorName: string | null; body: string; createdAt: string }[] }[],
  clearMutate: vi.fn(),
  seenMutate: vi.fn(),
  pinDoneMutate: vi.fn(),
  receiptUrl: null as string | null,
  perms: new Set<string>(['media:manage']),
  pieceFolder: null as { folderId: string; clientId: string; path: string } | null,
  startUploads: vi.fn(),
}))

// The task-list row an owner or lead edits here is the Deliverables table's own — tested there.
// ADR-0140 d.1: the manager's editor is the one task editor (its own suite: TaskEditor.test.tsx).
vi.mock('./components/TaskEditor', () => ({ TaskEditorInline: (p: { taskId: string }) => <div data-testid="task-page-manage-row" data-task={p.taskId} /> }))
// The row's status changes, cancel/reinstate and Required input beside it (own suite: TaskRowControls.test.tsx).
vi.mock('./components/TaskRowControls', () => ({ TaskRowControls: (p: { taskId: string }) => <div data-testid="task-page-row-controls" data-task={p.taskId} /> }))
vi.mock('./api/deliverables-api', () => ({
  useAssignedTask: () => ({ data: state.task, isLoading: state.loading, isError: false }),
  useMarkTaskSeen: () => ({ mutate: state.seenMutate, isPending: false }),
  useStartSubTask: () => ({ mutate: state.startMutate, isPending: false, error: null }),
  useSubmitSubTask: () => ({ mutate: state.submitMutate, isPending: false, isError: false, error: null, reset: vi.fn() }),
  useTransitionDeliverable: () => ({ mutate: state.transitionMutate, isPending: false }),
  useTaskListRules: () => ({ data: state.rules }),
}))
vi.mock('./api/review-api', () => ({
  useDeliverableVersions: (deliverableId: string | null) => ({ data: deliverableId ? state.versions : [], isLoading: false }),
  useTaskComments: (subTaskId: string | null) => ({ data: subTaskId ? state.taskComments : [], isLoading: false, isError: false }),
  useAddTaskComment: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useResolveTaskComment: () => ({ mutate: vi.fn(), isPending: false }),
  useUploadVersion: () => ({ mutate: state.uploadMutate, isPending: false }),
  useVersionComments: (id: string | null) => ({ data: id ? state.pins : [] }),
  // Figma M4: the previous version is drawn large by the page itself (no ReviewPanel).
  useVersionViewUrl: (id: string | null) => ({ data: id ? { viewUrl: 'https://b2.example/v1', downloadUrl: 'https://b2.example/v1?dl' } : undefined, isLoading: false, isError: false }),
  // I59.29: the manual thread's pin controls (real PinThread over mocked writes).
  useSetPinDone: () => ({ mutate: state.pinDoneMutate, isPending: false }),
  useReplyToPin: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('./api/extensions-api', () => ({
  useLatestExtensionByTask: () => ({ data: state.extensions }),
  useRequestExtension: () => ({ mutate: vi.fn(), isPending: false }),
  useWithdrawExtension: () => ({ mutate: vi.fn(), isPending: false }),
  useDecideExtension: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
  isRefused: () => false,
}))
vi.mock('./api/requirements-api', () => ({
  useTaskDependencies: () => ({ data: [] }),
  usePendingInputs: () => ({ data: state.inputs }),
  useAddDependency: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveDependency: () => ({ mutate: vi.fn(), isPending: false }),
  isCyclicDependency: () => false,
}))
vi.mock('./api/task-page-api', () => ({
  useTaskBrief: () => ({ data: state.brief, isLoading: false }),
  useTaskReceipt: () => ({ data: state.receipt }),
  useTaskTimer: (subTaskId: string | null, round: number) => {
    state.timerAsked = { subTaskId, round }
    return { data: state.timer }
  },
  useAssetUrl: (id: string | null) => ({ data: id ? state.receiptUrl : null, isError: false }),
  useCampaignReferencesFolderId: () => ({ data: state.refs.length ? 'f-refs' : null }),
  useReferenceFiles: () => ({ data: state.refs }),
  fetchReferenceDownloadUrl: vi.fn(async () => 'https://example.invalid/file'),
}))
vi.mock('./api/requests-api', () => ({
  useClearInput: () => ({ mutate: state.clearMutate, isPending: false, variables: undefined }),
  usePieceQuestions: () => ({ data: state.questions }),
  usePiecePeople: () => ({ data: { people: [], ownerId: 'owner1', ownerName: 'Fadia', accountManagerId: 'am1', accountManagerName: 'Inas' } }),
  useRoundTiming: () => ({ data: state.timing }),
  useTaskInputs: () => ({ data: state.inputs.map((i) => ({ subTaskId: null, kind: null, ...i })) }),
  useEveryone: () => ({ data: [] }),
  useAskQuestion: () => ({ mutate: vi.fn(), isPending: false }),
  useRaiseBlock: () => ({ mutate: vi.fn(), isPending: false }),
  useReplyToQuestion: () => ({ mutate: vi.fn(), isPending: false }),
  BLOCK_KINDS: ['copy', 'client', 'file', 'decision', 'other'],
}))
// I74.17: the more-time ask reads the server on its own (its own component).
vi.mock('./components/AskMoreTime', () => ({ AskMoreTime: () => <span data-testid="task-more-time-stub" /> }))
vi.mock('./ReviewPanel', () => ({
  ReviewPanel: ({ deliverableId, isReadOnly, pinActions, showRules }: { deliverableId: string; isReadOnly?: boolean; pinActions?: boolean; showRules?: boolean }) => (
    <div
      data-testid={`review-panel-stub-${deliverableId}`}
      data-readonly={isReadOnly ? 'true' : 'false'}
      data-pin-actions={pinActions ? 'true' : 'false'}
      data-show-rules={showRules ? 'true' : 'false'}
    />
  ),
}))
vi.mock('./TaskResources', () => ({
  TaskResources: ({ subTaskId, canManage }: { subTaskId: string; canManage: boolean }) => (
    <div data-testid={`task-resources-stub-${subTaskId}`} data-manage={String(canManage)} />
  ),
}))
// ADR-0134 d.24: the piece's Library folder for its working files, and the one upload engine.
vi.mock('./api/working-files-api', () => ({ usePieceLibraryFolder: () => ({ isLoading: false, data: state.pieceFolder }) }))
vi.mock('../../lib/assets/uploads', () => ({ startUploads: (a: unknown) => state.startUploads(a) }))
vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }))
vi.mock('../../app/permissions', () => ({ usePermissions: () => ({ can: (k: string) => state.perms.has(k) }) }))
vi.mock('../../lib/deadlines/use-extension-context', () => ({
  useExtensionContext: () => ({ reviewBufferWorkingDays: 1, workingDays: [7, 1, 2, 3, 4], closures: [] }),
}))

import { TaskPage } from './TaskPage'

const base: AssignedWorkItem = {
  subTaskId: 'st1',
  title: 'Post 2 · Design',
  status: 'in_progress',
  priority: 'high',
  slaHours: 8,
  startsAt: null,
  dueAt: '2026-09-24T15:00:00Z',
  committedDueAt: null,
  scheduleOverridden: false,
  deliverableId: 'del0',
  deliverableName: 'Post 2',
  deliverableState: 'in_progress',
  deliverableDueAt: null,
  revisionRound: 0,
  campaignId: 'cam1',
  campaignName: 'LUMA Season 2',
  goLiveAt: null,
  discipline: 'Creative',
  isAdhoc: false,
  assignerName: 'Fadia',
  reviewers: [{ userId: 'inas', name: 'Inas', isMandatory: true, approvedAt: null, respondedAt: null, response: null, isActive: true }],
  reviewMode: 'digital',
  assignedAt: '2026-09-20T08:00:00Z',
  departmentId: 'dep1',
  revisionLimit: 2,
  allocatedHours: 32,
  assigneeId: 'me',
  clientId: 'cli1',
}

const renderPage = (id = 'st1') =>
  render(
    <MemoryRouter initialEntries={[`/my-work/task/${id}`]}>
      <Routes>
        <Route path="/my-work/task/:taskId" element={<TaskPage />} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  state.task = { ...base }
  state.loading = false
  state.submitMutate = vi.fn()
  state.startMutate = vi.fn()
  state.transitionMutate = vi.fn()
  state.uploadMutate = vi.fn()
  state.versions = []
  state.taskComments = []
  state.pins = []
  state.extensions = new Map()
  state.rules = []
  state.brief = null
  state.receipt = null
  state.timer = null
  state.refs = []
  state.inputs = []
  state.timing = null
  state.questions = []
  state.clearMutate = vi.fn()
  state.receiptUrl = null
  state.perms = new Set(['media:manage'])
  state.pieceFolder = null
  state.startUploads = vi.fn()
})

describe('the task page — the header and the parts (M2)', () => {
  it('says so while loading, and when the task is not there', () => {
    state.loading = true
    const { unmount } = renderPage()
    expect(screen.getByTestId('task-page-loading')).toBeInTheDocument()
    unmount()
    state.loading = false
    state.task = null
    renderPage()
    expect(screen.getByTestId('task-page-missing')).toBeInTheDocument()
    // ADR-0132 d.7: Back names where the person came from; with nowhere before, My Work.
    expect(screen.getByTestId('task-page-back')).toHaveTextContent('Back to My Work')
  })

  it('names the task, its status, due date, who gave it and when, the reviewers, the hours and the timer', () => {
    state.timer = { startedAt: '2026-09-24T06:12:00Z', submittedAt: '2026-09-24T09:32:00Z', minutes: 200 }
    renderPage()
    expect(screen.getByTestId('task-page-title')).toHaveTextContent('Post 2 · Design')
    expect(screen.getByTestId('my-work-priority-st1')).toHaveAttribute('data-priority', 'high')
    expect(screen.getByTestId('task-page-status')).toHaveAttribute('data-status', 'in_progress')
    expect(screen.getByTestId('task-page-due')).toHaveTextContent(/Due/)
    expect(screen.getByTestId('task-page-people')).toHaveTextContent('Fadia gave it to you on')
    expect(screen.getByTestId('task-page-people')).toHaveTextContent('Reviewed by Inas')
    expect(screen.getByTestId('task-page-hours')).toHaveTextContent('32h allocated')
    expect(screen.getByTestId('task-page-timer')).toHaveTextContent('3h 20m timed')
    expect(screen.getByTestId('task-page-context')).toHaveTextContent('Post 2 · LUMA Season 2 · Creative · v1')
  })

  it("reads the time entry of the task's own round — revision_number, 0 on the first — not the v1 it shows", () => {
    renderPage()
    expect(state.timerAsked).toEqual({ subTaskId: 'st1', round: base.revisionRound })
    expect(base.revisionRound).toBe(0)
  })

  it('names the commitment beside the plan when they disagree (ADR-0088 d.1)', () => {
    state.task = { ...base, committedDueAt: '2026-09-22T15:00:00Z' }
    renderPage()
    expect(screen.getByTestId('my-work-committed-st1')).toBeInTheDocument()
  })

  it('shows the brief read only, how the request came in, and hides the receipt when there is none', () => {
    state.brief = [
      { key: 'task', en: 'The task', ar: 'المهمة', value: 'Three carousel frames' },
      { key: 'copy', en: 'Copy', ar: 'النص', value: '' },
      // Not a template field: the read hands it back under its key (piece-reads.ts).
      { key: 'whatCouldStopThis', en: 'whatCouldStopThis', ar: '', value: 'the client logo' },
    ]
    const { unmount } = renderPage()
    expect(screen.getByTestId('task-page-brief')).toHaveTextContent('What could stop this')
    expect(screen.getByTestId('task-page-brief')).not.toHaveTextContent('whatCouldStopThis')
    expect(screen.getByTestId('task-page-brief-task')).toHaveTextContent('Three carousel frames')
    expect(screen.getByTestId('task-page-brief-copy')).toHaveTextContent('Not written yet')
    expect(screen.queryByTestId('task-page-receipt')).not.toBeInTheDocument()
    unmount()
    state.brief = null
    state.receipt = { subject: 'Fw: LUMA S2', receivedAt: '2026-09-06T11:22:00Z', recordedBy: 'Inas' }
    renderPage()
    expect(screen.getByTestId('task-page-brief-none')).toBeInTheDocument()
    expect(screen.getByTestId('task-page-receipt')).toHaveTextContent('Fw: LUMA S2')
    expect(screen.getByTestId('task-page-receipt')).toHaveTextContent('recorded by Inas')
  })

  it('shows where it is — the current step marked, not clickable', () => {
    renderPage()
    expect(screen.getByTestId('task-page-step-in_progress')).toHaveAttribute('data-current', 'true')
    expect(screen.getByTestId('task-page-step-todo')).not.toHaveAttribute('data-current')
    expect(within(screen.getByTestId('task-page-steps')).queryAllByRole('button')).toHaveLength(0)
  })

  it('lists the rules as plain lines, no ticks, and hides the card when there are none', () => {
    const { unmount } = renderPage()
    expect(screen.queryByTestId('task-page-rules')).not.toBeInTheDocument()
    unmount()
    state.rules = [{ kind: 'do', text: 'Arabic is the master' }, { kind: 'dont', text: 'No قرعة' }]
    renderPage()
    expect(screen.getByTestId('task-page-rule-0')).toHaveTextContent('Do Arabic is the master')
    expect(screen.getByTestId('task-page-rule-1')).toHaveTextContent('Don’t No قرعة')
    expect(within(screen.getByTestId('task-page-rules')).queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('shows what it waits on, read only, and what is attached with Download and Download all', () => {
    state.inputs = [{ id: 'i1', description: 'Arabic copy', awaitedFrom: 'Abeer', requestedAt: '2026-09-23T08:00:00Z', satisfiedAt: null }]
    state.refs = [{ id: 'a1', name: 'KV.pdf' }, { id: 'a2', name: 'Chime icons.zip' }]
    renderPage()
    expect(screen.getByTestId('task-page-input-i1')).toHaveTextContent('Arabic copy')
    expect(screen.getByTestId('task-page-input-i1')).toHaveTextContent('Abeer')
    // An input on the whole deliverable is cleared by whoever manages tasks — not by the maker here.
    expect(screen.queryByTestId('task-page-input-clear-i1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('requirement-add-st1')).not.toBeInTheDocument()
    expect(screen.getByTestId('task-resources-stub-st1')).toHaveAttribute('data-manage', 'false')
    expect(screen.getByTestId('task-page-ref-download-a1')).toBeInTheDocument()
    expect(screen.getByTestId('task-page-ref-download-all')).toBeInTheDocument()
  })

  it('offers the Deliverables page to whoever manages project tasks, as the row\'s link did', () => {
    const { unmount } = renderPage()
    expect(screen.queryByTestId('task-page-deliverable-link')).not.toBeInTheDocument()
    unmount()
    state.perms = new Set(['media:manage', 'project_tasks:manage'])
    renderPage()
    expect(screen.getByTestId('task-page-deliverable-link')).toHaveAttribute('href', '/campaigns/cam1?piece=del0&task=st1')
    // Edward, 27 Sep: and the task's own row, to edit it here.
    expect(screen.getByTestId('task-page-manage')).toContainElement(screen.getByTestId('task-page-manage-row'))
    // …and, beside the editor, the row's status changes, cancel/reinstate and Required input.
    expect(screen.getByTestId('task-page-manage')).toContainElement(screen.getByTestId('task-page-row-controls'))
  })
})

describe('the task page — to do and in progress', () => {
  it('offers Start while To do, and no Send', () => {
    state.task = { ...base, status: 'todo' }
    renderPage()
    fireEvent.click(screen.getByTestId('my-work-start-st1'))
    expect(state.startMutate).toHaveBeenCalledWith('st1')
    expect(screen.queryByTestId('my-work-submit-st1')).not.toBeInTheDocument()
    expect(screen.getByTestId('task-page-step-todo')).toHaveAttribute('data-current', 'true')
  })

  it('uploads and sends in one place — the ReviewPanel under Your file, then Send for review (ADR-0035)', () => {
    state.versions = [{ id: 'v1', round: 1, version: 1, createdAt: '2026-09-24T08:00:00Z' }]
    renderPage()
    expect(within(screen.getByTestId('task-page-file')).getByTestId('review-panel-stub-del0')).toHaveAttribute('data-readonly', 'false')
    const send = screen.getByTestId('my-work-submit-st1')
    expect(send).not.toBeDisabled()
    fireEvent.click(send)
    expect(state.submitMutate).toHaveBeenCalledWith({ subTaskId: 'st1', acceptUntimed: false }, expect.anything())
  })

  it('refuses to send a deliverable-backed task with nothing attached, and says why', () => {
    renderPage()
    expect(screen.getByTestId('my-work-submit-needs-file-st1')).toBeInTheDocument()
    const send = screen.getByTestId('my-work-submit-st1')
    expect(send).toBeDisabled()
    fireEvent.click(send)
    expect(state.submitMutate).not.toHaveBeenCalled()
  })

  it('requires THIS round’s own version — round 1’s file cannot be resent for round 2', () => {
    state.task = { ...base, revisionRound: 1 }
    state.versions = [{ id: 'v1', round: 1, version: 1, createdAt: '2026-09-22T08:00:00Z' }]
    renderPage()
    expect(screen.getByTestId('my-work-submit-st1')).toBeDisabled()
  })

  it('advances an ad-hoc deliverable to in review once sent — a campaign one stays with its owner', () => {
    state.versions = [{ id: 'v1', round: 1, version: 1, createdAt: '2026-09-24T08:00:00Z' }]
    state.submitMutate = vi.fn((_a: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.())
    state.task = { ...base, campaignId: null, campaignName: null }
    const { unmount } = renderPage()
    fireEvent.click(screen.getByTestId('my-work-submit-st1'))
    expect(state.transitionMutate).toHaveBeenCalledWith({ deliverableId: 'del0', to: 'in_review', expectedState: 'in_progress' })
    unmount()
    state.transitionMutate = vi.fn()
    state.task = { ...base }
    renderPage()
    fireEvent.click(screen.getByTestId('my-work-submit-st1'))
    expect(state.transitionMutate).not.toHaveBeenCalled()
  })

  it('sends a standalone task (no deliverable) directly — nothing to attach (ADR-0034/0035)', () => {
    state.task = { ...base, deliverableId: null, deliverableName: null, deliverableState: null, campaignId: null, campaignName: null, isAdhoc: true }
    renderPage()
    expect(screen.getByTestId('task-page-no-file')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('my-work-submit-st1'))
    expect(state.submitMutate).toHaveBeenCalledWith({ subTaskId: 'st1', acceptUntimed: false }, expect.anything())
  })

  /** ADR-0141 d.5 (I74.16): the per-task extension is retired — a live task offers no new extension request. */
  it('offers no "ask for an extension" on a live task — the extension is retired into the change form', () => {
    state.task = { ...base, status: 'todo', committedDueAt: base.dueAt }
    renderPage()
    expect(screen.queryByTestId('my-work-extension-st1-ask')).toBeNull()
  })

  it('shows the pending line once asked, with Withdraw and no second ask', () => {
    state.extensions = new Map([[
      'st1',
      { eventType: 'extension_requested', isPending: true, toAt: '2026-09-28T15:00:00Z', approverName: 'Nadia',
        actorId: 'me', actorName: 'Me', requestId: 'r1', reason: 'More work', viewerCanRequest: true, viewerCanDecide: false },
    ]])
    renderPage()
    const line = screen.getByTestId('my-work-extension-st1-line')
    expect(line).toHaveAttribute('data-state', 'pending')
    expect(line.textContent).toContain('Nadia')
    expect(screen.queryByTestId('my-work-extension-st1-ask')).toBeNull()
    expect(screen.getByTestId('my-work-extension-st1-withdraw')).toBeInTheDocument()
  })
})

describe('the task page — in review and approved', () => {
  it('in review: no Start or Send, and names who it waits on', () => {
    state.task = { ...base, status: 'review' }
    renderPage()
    expect(screen.getByTestId('task-page-step-review')).toHaveAttribute('data-current', 'true')
    expect(screen.queryByTestId('my-work-start-st1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('my-work-submit-st1')).not.toBeInTheDocument()
    expect(screen.getByTestId('my-work-waiting-on-st1')).toHaveTextContent('Inas')
  })

  it('approved: the last step, and no ask for more time', () => {
    state.task = { ...base, status: 'done' }
    renderPage()
    expect(screen.getByTestId('task-page-step-done')).toHaveAttribute('data-current', 'true')
    expect(screen.queryByTestId('my-work-extension-st1')).not.toBeInTheDocument()
  })
})

// ================= ADR-0059: the manual path, moved from the Submit dialog =================
describe('the task page — manual work', () => {
  const manual = { ...base, reviewMode: 'manual' as const }

  it('offers a note instead of an upload, and no version rail', () => {
    state.task = manual
    renderPage()
    expect(screen.getByTestId('task-review-thread-st1')).toBeInTheDocument()
    expect(screen.queryByTestId('review-panel-stub-del0')).toBeNull()
    // No "attach a file" line: there is no file coming.
    expect(screen.queryByTestId('my-work-submit-needs-file-st1')).toBeNull()
    expect(screen.getByTestId('my-work-review-mode-st1')).toBeInTheDocument()
  })

  it('cannot be sent with nothing written', () => {
    state.task = manual
    renderPage()
    const send = screen.getByTestId('my-work-submit-st1')
    expect(send).toBeDisabled()
    fireEvent.click(send)
    expect(state.submitMutate).not.toHaveBeenCalled()
  })

  it('sends once the assignee has written their own note for THIS round', () => {
    state.task = manual
    state.taskComments = [{ id: 'c1', round: 1, authorId: 'me', body: 'Shot 40 frames', resolved: false, authorName: 'Me', createdAt: '2026-09-24T08:00:00Z', linkUrl: null }]
    renderPage()
    const send = screen.getByTestId('my-work-submit-st1')
    expect(send).not.toBeDisabled()
    fireEvent.click(send)
    expect(state.submitMutate).toHaveBeenCalled()
  })

  it('round 1’s note does not send round 2, and somebody else’s note never does', () => {
    state.task = { ...manual, revisionRound: 1 }
    state.taskComments = [{ id: 'c1', round: 1, authorId: 'me', body: 'x', resolved: false, authorName: 'Me', createdAt: '2026-09-22T08:00:00Z', linkUrl: null }]
    const { unmount } = renderPage()
    expect(screen.getByTestId('my-work-submit-st1')).toBeDisabled()
    unmount()
    state.taskComments = [{ id: 'c2', round: 2, authorId: 'someone-else', body: 'y', resolved: false, authorName: 'Inas', createdAt: '2026-09-23T08:00:00Z', linkUrl: null }]
    renderPage()
    expect(screen.getByTestId('my-work-submit-st1')).toBeDisabled()
  })

  it('I59.29: the maker answers the reviewer’s note on a manual task — Mark done and Reply', () => {
    state.task = { ...manual, status: 'todo', revisionRound: 1 }
    state.pinDoneMutate = vi.fn()
    state.taskComments = [{ id: 'n1', round: 1, authorId: 'inas', body: 'Reshoot the wide', resolved: false, authorName: 'Inas', createdAt: '2026-09-23T08:00:00Z', linkUrl: null }]
    renderPage()
    expect(screen.getByTestId('pin-reply-open-n1')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('pin-mark-done-n1'))
    expect(state.pinDoneMutate).toHaveBeenCalledWith({ id: 'n1', done: true }, expect.anything())
  })
})

describe('the task page — changes came back (M4)', () => {
  const sentBack = { ...base, status: 'todo' as const, revisionRound: 1 }

  it('shows the previous version large with its numbered pins, the pins as a To fix list, and the round of the limit', () => {
    state.task = sentBack
    state.versions = [{ id: 'v1', round: 1, version: 1, createdAt: '2026-09-22T08:00:00Z', contentType: 'image/png' }]
    state.pins = [
      { id: 'p1', round: 1, body: 'Logo bottom right', authorName: 'Inas', authorId: 'inas', mediaRecordId: 'v1', posX: 0.8, posY: 0.9, resolved: false },
      { id: 'p2', round: 1, body: 'Numbers in brackets', authorName: 'Hasan', authorId: 'hasan', mediaRecordId: 'v1', resolved: true },
    ]
    renderPage()
    expect(screen.getByTestId('task-page-status')).toHaveAttribute('data-status', 'changes')
    expect(screen.getByTestId('task-page-changes-line')).toHaveTextContent('Round 1 of 2')
    expect(screen.getByTestId('task-page-changes-line')).toHaveTextContent('pinned by Inas, Hasan')
    // Figma M4: the previous file itself, large, pin 1 on it — not the review panel squeezed in.
    const prev = screen.getByTestId('task-page-prev-version')
    expect(within(prev).getByTestId('review-img')).toHaveAttribute('src', 'https://b2.example/v1')
    expect(within(prev).getByTestId('task-page-prev-pin-p1')).toHaveTextContent('1')
    expect(within(prev).queryByTestId('task-page-prev-pin-p2')).not.toBeInTheDocument() // no position, no marker
    expect(screen.queryByTestId('review-panel-stub-del0')).not.toBeInTheDocument()
    expect(screen.getByTestId('task-page-pin-p1')).toHaveTextContent('Logo bottom right')
    expect(screen.getByTestId('task-page-pin-p1')).toHaveTextContent('Inas')
    expect(screen.getByTestId('task-page-pin-p2')).toHaveClass('is-resolved')
    // I59.29: the maker answers each pin in the To fix list — Mark done · Reply per pin.
    const toFix = screen.getByTestId('task-page-to-fix')
    expect(within(toFix).getByTestId('pin-mark-done-p1')).toBeInTheDocument()
    expect(within(toFix).getByTestId('pin-reply-open-p1')).toBeInTheDocument()
    fireEvent.click(within(toFix).getByTestId('pin-mark-done-p1'))
    expect(state.pinDoneMutate).toHaveBeenCalledWith({ id: 'p1', done: true }, expect.anything())
    // Start first — the clock starts again.
    expect(screen.getByTestId('my-work-start-st1')).toBeInTheDocument()
    expect(screen.queryByTestId('task-page-file')).not.toBeInTheDocument()
  })

  it('Reply to a pin at the foot opens the reply on the first pin that is still open', () => {
    state.task = sentBack
    state.versions = [{ id: 'v1', round: 1, version: 1, createdAt: '2026-09-22T08:00:00Z', contentType: 'image/png' }]
    state.pins = [
      { id: 'p1', round: 1, body: 'Logo bottom right', authorName: 'Inas', authorId: 'inas', mediaRecordId: 'v1', resolved: false, doneAt: '2026-09-23T08:00:00Z', doneById: 'me', doneByName: 'Lujain' },
      { id: 'p2', round: 1, body: 'Numbers in brackets', authorName: 'Inas', authorId: 'inas', mediaRecordId: 'v1', resolved: false },
    ]
    renderPage()
    fireEvent.click(screen.getByTestId('task-page-reply-to-pin'))
    expect(screen.getByTestId('pin-reply-form-p2')).toBeInTheDocument()
    expect(screen.queryByTestId('pin-reply-form-p1')).not.toBeInTheDocument()
  })

  it('To fix says which pins are done, and shows the replies under their pin, never as pins (I59.29)', () => {
    state.task = sentBack
    state.versions = [{ id: 'v1', round: 1, version: 1, createdAt: '2026-09-22T08:00:00Z' }]
    state.pins = [
      { id: 'p1', round: 1, body: 'Logo bottom right', authorName: 'Inas', authorId: 'inas', mediaRecordId: 'v1', resolved: false, doneAt: '2026-09-23T08:00:00Z', doneByName: 'Lujain', doneById: 'me' },
      { id: 'p2', round: 1, body: 'Numbers in brackets', authorName: 'Inas', authorId: 'inas', mediaRecordId: 'v1', resolved: false },
      { id: 'r1', round: 1, body: 'Moved it', authorName: 'Lujain', authorId: 'me', mediaRecordId: 'v1', resolved: false, parentId: 'p1' },
    ]
    renderPage()
    expect(screen.getByTestId('task-page-pin-p1')).toHaveAttribute('data-done', 'true')
    expect(screen.getByTestId('task-page-pin-done-p1')).toHaveTextContent('Lujain')
    expect(screen.getByTestId('pin-undo-p1')).toBeInTheDocument() // the maker's own done
    expect(screen.getByTestId('task-page-pin-p2')).not.toHaveAttribute('data-done')
    expect(screen.queryByTestId('task-page-pin-done-p2')).not.toBeInTheDocument()
    expect(screen.queryByTestId('task-page-pin-r1')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('pin-replies-p1')).getByTestId('pin-reply-r1')).toHaveTextContent('Moved it')
  })

  it('somebody else reads the previous round — no pin controls offered', () => {
    state.task = { ...sentBack, assigneeId: 'zubaida' }
    state.versions = [{ id: 'v1', round: 1, version: 1, createdAt: '2026-09-22T08:00:00Z' }]
    state.pins = [{ id: 'p1', round: 1, body: 'Logo bottom right', authorName: 'Inas', authorId: 'inas', mediaRecordId: 'v1', resolved: false }]
    renderPage()
    expect(screen.getByTestId('task-page-pin-p1')).toBeInTheDocument()
    expect(screen.queryByTestId('pin-mark-done-p1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pin-reply-open-p1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('task-page-reply-to-pin')).not.toBeInTheDocument()
  })

  it('uploads V2 into this round, then offers Send V2 back', () => {
    state.task = { ...sentBack, status: 'in_progress' }
    state.versions = [{ id: 'v1', round: 1, version: 1, createdAt: '2026-09-22T08:00:00Z' }]
    const { unmount } = renderPage()
    expect(screen.getByTestId('my-work-submit-st1')).toBeDisabled()
    expect(screen.getByTestId('my-work-submit-st1')).toHaveTextContent('Send V2 back')
    const file = new File(['x'], 'post2-v2.png', { type: 'image/png' })
    fireEvent.change(screen.getByTestId('task-page-upload-next-file'), { target: { files: [file] } })
    expect(state.uploadMutate).toHaveBeenCalledWith(file, expect.anything())
    unmount()

    state.versions = [
      { id: 'v2', round: 2, version: 2, createdAt: '2026-09-24T08:00:00Z' },
      { id: 'v1', round: 1, version: 1, createdAt: '2026-09-22T08:00:00Z' },
    ]
    renderPage()
    expect(screen.getByTestId('task-page-next-attached')).toHaveTextContent('V2 attached')
    expect(screen.queryByTestId('task-page-upload-next')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('my-work-submit-st1'))
    expect(state.submitMutate).toHaveBeenCalled()
  })

  it('offers no upload to someone who may not upload media', () => {
    state.perms = new Set()
    state.task = { ...sentBack, status: 'in_progress' }
    renderPage()
    expect(screen.queryByTestId('task-page-upload-next')).not.toBeInTheDocument()
  })

  it('folds the earlier rounds', () => {
    state.task = { ...sentBack, status: 'in_progress' }
    state.versions = [{ id: 'v1', round: 1, version: 1, uploadedByName: 'Zubaida', createdAt: '2026-09-22T08:00:00Z' }]
    renderPage()
    const rounds = screen.getByTestId('task-page-rounds')
    expect(rounds.tagName).toBe('DETAILS')
    expect(screen.getByTestId('task-page-round-1')).toHaveTextContent('Zubaida')
  })
})

describe('the task page — someone else\'s task', () => {
  it('reads it: no Start, no Send, no upload, the file read only', () => {
    state.task = { ...base, assigneeId: 'zubaida' }
    state.versions = [{ id: 'v1', round: 1, version: 1, createdAt: '2026-09-24T08:00:00Z' }]
    renderPage()
    expect(screen.getByTestId('task-page-not-yours')).toBeInTheDocument()
    expect(screen.queryByTestId('my-work-submit-st1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('my-work-start-st1')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('task-page-file')).getByTestId('review-panel-stub-del0')).toHaveAttribute('data-readonly', 'true')
    expect(screen.queryByTestId('my-work-extension-st1-ask')).not.toBeInTheDocument()
  })
})

/**
 * I59 Track 6 — the slots the database tracks opened: the untimed warning before Send (ADR-0106),
 * the blocked time off the timer (ADR-0107 d.3), Ask someone and I'm blocked at the foot, the
 * Questions with Reply, Waiting on live with Clear, the receipt's screenshot, and "seen" on open.
 */
describe('the task page — the untimed round (ADR-0106 d.2)', () => {
  it('warns before sending a round started under the threshold, naming the allocation — Send anyway sends it untimed', () => {
    state.versions = [{ id: 'v1', round: 1, version: 1, createdAt: '2026-09-24T08:00:00Z' }]
    state.timing = { startedAt: new Date(Date.now() - 3 * 60_000).toISOString(), elapsedMinutes: 3, thresholdMinutes: 15, isUntimed: true, allocatedHours: 32, blockedMinutesSoFar: 0 }
    renderPage()
    fireEvent.click(screen.getByTestId('my-work-submit-st1'))
    expect(state.submitMutate).not.toHaveBeenCalled()
    expect(screen.getByTestId('untimed-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('untimed-text')).toHaveTextContent('32h')
    expect(screen.getByTestId('untimed-told')).toHaveTextContent('Inas')
    fireEvent.click(screen.getByTestId('untimed-send'))
    expect(state.submitMutate).toHaveBeenCalledWith({ subTaskId: 'st1', acceptUntimed: true }, expect.anything())
  })

  it('Cancel sends nothing and closes the warning', () => {
    state.versions = [{ id: 'v1', round: 1, version: 1, createdAt: '2026-09-24T08:00:00Z' }]
    state.timing = { startedAt: null, elapsedMinutes: null, thresholdMinutes: 15, isUntimed: true, allocatedHours: 8, blockedMinutesSoFar: 0 }
    renderPage()
    fireEvent.click(screen.getByTestId('my-work-submit-st1'))
    fireEvent.click(screen.getByTestId('untimed-cancel'))
    expect(screen.queryByTestId('untimed-dialog')).not.toBeInTheDocument()
    expect(state.submitMutate).not.toHaveBeenCalled()
  })

  it('sends a round timed past the threshold at once, with no warning', () => {
    state.versions = [{ id: 'v1', round: 1, version: 1, createdAt: '2026-09-24T08:00:00Z' }]
    state.timing = { startedAt: new Date(Date.now() - 60 * 60_000).toISOString(), elapsedMinutes: 60, thresholdMinutes: 15, isUntimed: false, allocatedHours: 32, blockedMinutesSoFar: 0 }
    renderPage()
    fireEvent.click(screen.getByTestId('my-work-submit-st1'))
    expect(screen.queryByTestId('untimed-dialog')).not.toBeInTheDocument()
    expect(state.submitMutate).toHaveBeenCalledWith({ subTaskId: 'st1', acceptUntimed: false }, expect.anything())
  })

  it("opens the same warning when the server refuses an untimed round (its DETAIL is the hours)", () => {
    state.versions = [{ id: 'v1', round: 1, version: 1, createdAt: '2026-09-24T08:00:00Z' }]
    state.submitMutate = vi.fn((_a: unknown, opts?: { onError?: (e: unknown) => void }) =>
      opts?.onError?.({ code: '22023', hint: 'untimed', details: '12', message: 'this round was not timed' }))
    renderPage()
    fireEvent.click(screen.getByTestId('my-work-submit-st1'))
    expect(screen.getByTestId('untimed-text')).toHaveTextContent('12h')
  })
})

describe('the task page — the timer and what it waits on (ADR-0107)', () => {
  it('shows the time so far less the blocked time, and the blocked time as not counted', () => {
    state.timer = { startedAt: '2026-09-24T06:12:00Z', submittedAt: null, minutes: null }
    state.timing = { startedAt: '2026-09-24T06:12:00Z', elapsedMinutes: 440, thresholdMinutes: 15, isUntimed: false, allocatedHours: 32, blockedMinutesSoFar: 240 }
    renderPage()
    expect(screen.getByTestId('task-page-timer')).toHaveTextContent('3h 20m timed')
    expect(screen.getByTestId('task-page-blocked-time')).toHaveTextContent('4h blocked, not counted against you')
  })

  it("lists the task's own block with Clear for its maker, and clears it", () => {
    state.inputs = [{ id: 'i2', subTaskId: 'st1', kind: 'copy', description: 'Arabic headline', awaitedFrom: 'Abeer', requestedAt: '2026-09-24T08:00:00Z', satisfiedAt: null }]
    renderPage()
    expect(screen.getByTestId('task-page-input-i2')).toHaveAttribute('data-own', 'task')
    expect(screen.getByTestId('task-page-input-i2')).toHaveTextContent('Copy')
    fireEvent.click(screen.getByTestId('task-page-input-clear-i2'))
    expect(state.clearMutate).toHaveBeenCalledWith('i2', expect.anything())
  })

  it("offers no Clear on somebody else's task to a reader who neither owns nor manages it", () => {
    state.task = { ...base, assigneeId: 'zubaida' }
    state.inputs = [{ id: 'i2', subTaskId: 'st1', kind: 'copy', description: 'Arabic headline', awaitedFrom: 'Abeer', requestedAt: '2026-09-24T08:00:00Z', satisfiedAt: null }]
    renderPage()
    expect(screen.queryByTestId('task-page-input-clear-i2')).not.toBeInTheDocument()
  })
})

describe('the task page — Ask someone, I\'m blocked, Questions (ADR-0113, ADR-0107)', () => {
  it('opens I\'m blocked with the five kinds, all three fields required, naming the owner and the AM as told', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('task-page-blocked-open'))
    expect(screen.getByTestId('block-dialog')).toBeInTheDocument()
    for (const k of ['copy', 'client', 'file', 'decision', 'other']) expect(screen.getByTestId(`block-kind-${k}`)).toBeInTheDocument()
    expect(screen.getByTestId('block-send')).toBeDisabled()
    expect(screen.getByTestId('block-told')).toHaveTextContent('Fadia')
    expect(screen.getByTestId('block-told')).toHaveTextContent('Inas')
    fireEvent.click(screen.getByTestId('block-cancel'))
    expect(screen.queryByTestId('block-dialog')).not.toBeInTheDocument()
  })

  it('opens Ask someone', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('task-page-ask'))
    expect(screen.getByTestId('ask-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('ask-send')).toBeDisabled()
  })

  it("offers neither to somebody reading another person's task", () => {
    state.task = { ...base, assigneeId: 'zubaida' }
    renderPage()
    expect(screen.queryByTestId('task-page-ask')).not.toBeInTheDocument()
    expect(screen.queryByTestId('task-page-blocked-open')).not.toBeInTheDocument()
  })

  it('lists the questions on the piece with their replies, and Reply only on one asked of me and unanswered', () => {
    state.questions = [
      { id: 'q2', authorId: 'fadia', authorName: 'Fadia', recipients: [{ id: 'me', name: 'Zubaida' }], body: 'English cut Thursday too?', createdAt: '2026-09-24T10:00:00Z', replies: [] },
      { id: 'q1', authorId: 'me', authorName: 'Zubaida', recipients: [{ id: 'abeer', name: 'Abeer' }], body: 'Is the headline final?', createdAt: '2026-09-23T10:00:00Z', replies: [{ id: 'r1', authorId: 'abeer', authorName: 'Abeer', body: 'Yes', createdAt: '2026-09-23T11:00:00Z' }] },
    ]
    renderPage()
    expect(screen.getByTestId('task-page-question-q1')).toHaveTextContent('Is the headline final?')
    expect(screen.getByTestId('task-page-reply-r1')).toHaveTextContent('Yes')
    expect(screen.queryByTestId('task-page-question-reply-q1')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('task-page-question-reply-q2'))
    expect(screen.getByTestId('reply-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('reply-told')).toHaveTextContent('Fadia')
  })

  it('hides Questions when there are none', () => {
    renderPage()
    expect(screen.queryByTestId('task-page-questions')).not.toBeInTheDocument()
  })
})

describe('the task page — the receipt and seen', () => {
  it("shows the receipt's screenshot when one was filed", () => {
    state.receipt = { subject: 'WhatsApp', receivedAt: '2026-09-06T11:22:00Z', recordedBy: 'Inas', assetId: 'as1' } as never
    state.receiptUrl = 'https://example.invalid/shot.png'
    renderPage()
    expect(screen.getByTestId('task-page-receipt-shot')).toHaveAttribute('src', 'https://example.invalid/shot.png')
  })

  it('counts the task as seen on the server when its maker opens it (it leaves New on you), once', () => {
    state.seenMutate = vi.fn()
    const { rerender } = renderPage()
    expect(state.seenMutate).toHaveBeenCalledTimes(1)
    expect(state.seenMutate).toHaveBeenCalledWith('st1')
    rerender(<MemoryRouter initialEntries={['/my-work/task/st1']}><Routes><Route path="/my-work/task/:taskId" element={<TaskPage />} /></Routes></MemoryRouter>)
    expect(state.seenMutate).toHaveBeenCalledTimes(1)
  })

  it('does not ask again once the server says it was seen', () => {
    state.seenMutate = vi.fn()
    state.task = { ...base, seenAt: '2026-09-25T08:00:00Z' }
    renderPage()
    expect(state.seenMutate).not.toHaveBeenCalled()
  })

  it("does not mark somebody else's task seen", () => {
    state.seenMutate = vi.fn()
    state.task = { ...base, assigneeId: 'zubaida' }
    renderPage()
    expect(state.seenMutate).not.toHaveBeenCalled()
  })
})

describe('working files beside Send (ADR-0134 d.24)', () => {
  it('offers Add working files; the picked files go to the piece folder marked SOURCE', () => {
    state.pieceFolder = { folderId: 'pf1', clientId: 'cli1', path: 'Kite / LUMA S2 / Deliverables / Post 2' }
    renderPage()
    expect(screen.getByTestId('task-page-working-files-st1-add')).toHaveTextContent('Add working files')
    const file = new File(['x'], 'post2.psd')
    fireEvent.change(screen.getByTestId('task-page-working-files-st1-input'), { target: { files: [file] } })
    expect(state.startUploads).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'pf1', clientId: 'cli1', isSource: true, files: [file] }))
  })

  it('says in one line when the piece has no folder yet, and Send stays as it was', () => {
    state.versions = [{ id: 'v1', round: 1, version: 1, createdAt: '2026-09-21T08:00:00Z' }]
    renderPage()
    expect(screen.getByTestId('task-page-working-files-st1-none')).toBeInTheDocument()
    expect(screen.queryByTestId('task-page-working-files-st1-add')).toBeNull()
    expect(screen.getByTestId('my-work-submit-st1')).toBeEnabled()
  })

  it("is not offered on somebody else's task", () => {
    state.pieceFolder = { folderId: 'pf1', clientId: 'cli1', path: 'x' }
    state.task = { ...base, assigneeId: 'zubaida' }
    renderPage()
    expect(screen.queryByTestId('task-page-working-files-st1')).toBeNull()
  })
})
