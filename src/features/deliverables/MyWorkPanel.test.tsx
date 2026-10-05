import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatIraqDateTime, iraqDay } from '../../lib/time/iraq'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import '../../lib/i18n'
import type { AssignedWorkItem } from './api/deliverables-api'

/**
 * My Work's lists and the task card (ADR-0024, I2.2 → ADR-0105 d.1, I59.10). The api modules reach
 * lib/env (throws in CI) so they are mocked; the bucketing stays real (pure), so the test proves
 * items land in the right list, the card keeps every fact the row showed, Start stays on it, and
 * Open goes to the task page. What the row's pop-ups did (Deliverable, Submit, Review feedback, Ask
 * for more time) is proven on the task page now — `TaskPage.test.tsx`, moved there assertion by
 * assertion.
 */

const state = vi.hoisted(() => ({
  items: [] as AssignedWorkItem[],
  isLoading: false,
  isError: false,
  startMutate: vi.fn(),
  // ADR-0088: the latest extension event per task, keyed by task id. Empty = nothing asked.
  extensions: new Map<string, unknown>(),
  rules: [] as { kind: 'do' | 'dont'; text: string }[],
  brief: null as { key: string; en: string; ar: string; value: string }[] | null,
  folder: null as { id: string } | null,
  refsFolder: null as string | null,
  refs: [] as { id: string; name: string }[],
  canAssets: true,
}))

vi.mock('./api/deliverables-api', () => ({
  useMyAssignedWork: () => ({ data: state.items, isLoading: state.isLoading, isError: state.isError }),
  useStartSubTask: () => ({ mutate: state.startMutate, isPending: false, error: null }),
  useTaskListRules: () => ({ data: state.rules }),
}))
vi.mock('./api/task-page-api', () => ({
  useTaskBrief: () => ({ data: state.brief }),
  useCampaignReferencesFolderId: () => ({ data: state.refsFolder }),
  useReferenceFiles: () => ({ data: state.refs }),
}))
vi.mock('../../lib/assets/folders', () => ({
  useCampaignFolderRoot: () => ({ data: state.folder }),
}))
vi.mock('../../app/permissions', () => ({
  usePermissions: () => ({ can: (k: string) => (k === 'assets:view' ? state.canAssets : false) }),
}))

// ADR-0088: the card's extension line reads the extension view; the control has its own suite.
vi.mock('./api/extensions-api', () => ({
  useLatestExtensionByTask: () => ({ data: state.extensions }),
  useRequestExtension: () => ({ mutate: vi.fn(), isPending: false }),
  useWithdrawExtension: () => ({ mutate: vi.fn(), isPending: false }),
  useDecideExtension: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
  isRefused: () => false,
}))

vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'me' } } }),
}))

vi.mock('../../lib/deadlines/use-extension-context', () => ({
  useExtensionContext: () => ({ reviewBufferWorkingDays: 1, workingDays: [7, 1, 2, 3, 4], closures: [] }),
}))

import { MyWorkLists } from './MyWorkPanel'

const base: AssignedWorkItem = {
  subTaskId: 'st0',
  title: 'Task',
  status: 'in_progress',
  priority: null,
  slaHours: 4,
  startsAt: null,
  dueAt: new Date(new Date().setHours(12, 0, 0, 0)).toISOString(), // midday today, local
  committedDueAt: null,
  scheduleOverridden: false,
  deliverableId: 'del0',
  deliverableName: 'Hero KV',
  deliverableState: 'in_progress',
  deliverableDueAt: null,
  revisionRound: 0,
  campaignId: 'cam1',
  campaignName: 'Spring Launch',
  goLiveAt: null,
  discipline: 'Art Direction',
  isAdhoc: false,
  assignerName: 'Nadia Assigner',
  reviewers: [{ userId: 'u-omar', name: 'Omar Reviewer', isMandatory: false, approvedAt: null, respondedAt: null, response: null, isActive: true }],
  reviewMode: 'digital',
  departmentId: 'dep1',
  clientId: 'cli1',
}

const renderLists = () => render(<MemoryRouter><MyWorkLists /></MemoryRouter>)
const daysFromNow = (n: number) => new Date(new Date().setHours(12, 0, 0, 0) + n * 86_400_000).toISOString()
/** The list a card sits in. */
const listOfCard = (id: string) => screen.getByTestId(`my-work-item-${id}`).closest('[data-testid$="-tasks-panel"]')?.getAttribute('data-testid')

beforeEach(() => {
  state.items = []
  state.isLoading = false
  state.isError = false
  state.startMutate = vi.fn()
  state.extensions = new Map()
  state.rules = []
  state.brief = null
  state.folder = null
  state.refsFolder = null
  state.refs = []
  state.canAssets = true
})

describe('My Work — the lists (I59.10)', () => {
  it('shows Today only when something is due today (plan View 2, I59 Track 6)', () => {
    renderLists()
    expect(screen.queryByTestId('today-tasks-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('today-tasks-empty')).not.toBeInTheDocument()
  })

  it('says so when the work could not be loaded', () => {
    state.isError = true
    renderLists()
    expect(screen.getByTestId('my-work-load-error')).toBeInTheDocument()
  })

  /**
   * A task is booked across a span; it belongs in Today from its first day, and the card says so:
   * a lone due date four days out otherwise reads as a mistake.
   */
  it('puts a task whose span has begun in Today, and shows the span on the card', () => {
    state.items = [{ ...base, subTaskId: 'spanning', startsAt: daysFromNow(-1), dueAt: daysFromNow(3) }]
    renderLists()
    const today = screen.getByTestId('today-tasks-panel')
    expect(within(today).getByTestId('my-work-item-spanning')).toBeInTheDocument()
    // ADR-0076: both ends are IRAQ days and the label names the clock.
    expect(
      within(today).getByText(`Due ${iraqDay(daysFromNow(-1))} – ${formatIraqDateTime(daysFromNow(3))} (Iraq time)`),
    ).toBeInTheDocument()
  })

  it('leaves a single-day task reading as one due date, and out of Today until it starts', () => {
    state.items = [{ ...base, subTaskId: 'later', startsAt: daysFromNow(4), dueAt: daysFromNow(4) }]
    renderLists()
    expect(screen.queryByTestId('today-tasks-panel')).toBeNull()
    expect(['week-tasks-panel', 'later-tasks-panel']).toContain(listOfCard('later'))
    expect(screen.getByText(`Due ${formatIraqDateTime(daysFromNow(4))} (Iraq time)`)).toBeInTheDocument()
  })

  it('splits today (incl. OVERDUE), later, waiting on someone else, and finished work into Completed', () => {
    state.items = [
      { ...base, subTaskId: 'due-today' },
      { ...base, subTaskId: 'overdue', dueAt: daysFromNow(-3) },
      { ...base, subTaskId: 'far', dueAt: daysFromNow(12) },
      { ...base, subTaskId: 'undated', dueAt: null },
      { ...base, subTaskId: 'in-review', status: 'review', dueAt: daysFromNow(-1) },
      { ...base, subTaskId: 'finished', status: 'done' },
      { ...base, subTaskId: 'signed-off', deliverableState: 'approved' },
    ]
    renderLists()
    // overdue belongs at the top of the day, not buried under work that is not yet urgent
    expect(listOfCard('due-today')).toBe('today-tasks-panel')
    expect(listOfCard('overdue')).toBe('today-tasks-panel')
    expect(listOfCard('far')).toBe('later-tasks-panel')
    expect(listOfCard('undated')).toBe('later-tasks-panel')
    // with somebody else, whatever its date — "With Omar"
    expect(listOfCard('in-review')).toBe('waiting-tasks-panel')
    expect(within(screen.getByTestId('waiting-tasks-panel')).getByTestId('my-work-waiting-on-in-review')).toHaveTextContent('Omar')
    expect(listOfCard('finished')).toBe('completed-tasks-panel')
    expect(listOfCard('signed-off')).toBe('completed-tasks-panel')
    // finished work is never counted as outstanding in a working list
    expect(within(screen.getByTestId('today-tasks-panel')).queryByTestId('my-work-item-finished')).not.toBeInTheDocument()
  })

  it('puts the rest of this week in This week, and next week in Later', () => {
    // A Tuesday, so the week (to Saturday) has days left in it whatever day the suite runs on.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 22, 12))
    try {
      state.items = [
        { ...base, subTaskId: 'thursday', dueAt: daysFromNow(2) },
        { ...base, subTaskId: 'next-monday', dueAt: daysFromNow(6) },
      ]
      renderLists()
      expect(listOfCard('thursday')).toBe('week-tasks-panel')
      expect(listOfCard('next-monday')).toBe('later-tasks-panel')
    } finally {
      vi.useRealTimers()
    }
  })

  it('folds Completed shut, "Completed (N)", and hides it when nothing is finished', () => {
    state.items = [{ ...base, subTaskId: 'finished', status: 'done' }, { ...base, subTaskId: 'open' }]
    const { unmount } = renderLists()
    const done = screen.getByTestId('completed-tasks-panel')
    expect(done.tagName).toBe('DETAILS')
    expect(done).not.toHaveAttribute('open')
    expect(screen.getByTestId('completed-tasks-toggle')).toHaveTextContent('Completed (1)')
    fireEvent.click(screen.getByTestId('completed-tasks-toggle'))
    unmount()
    state.items = [{ ...base, subTaskId: 'open' }]
    renderLists()
    expect(screen.getByTestId('today-tasks-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('completed-tasks-panel')).not.toBeInTheDocument()
  })
})

describe('My Work — the task card (I59.10)', () => {
  it('opens the task page from Open', () => {
    state.items = [{ ...base, subTaskId: 'st1' }]
    renderLists()
    expect(screen.getByTestId('my-work-open-st1')).toHaveAttribute('href', '/my-work/task/st1')
  })

  it('keeps Start on the card for a todo task, and only for one', () => {
    state.items = [
      { ...base, subTaskId: 'sa', status: 'todo' },
      { ...base, subTaskId: 'sb', status: 'in_progress' },
    ]
    renderLists()
    fireEvent.click(screen.getByTestId('my-work-start-sa'))
    expect(state.startMutate).toHaveBeenCalledWith('sa')
    expect(screen.queryByTestId('my-work-start-sb')).not.toBeInTheDocument()
    // The four pop-ups have left the card (ADR-0105 d.3).
    expect(screen.queryByTestId('my-work-submit-sb')).not.toBeInTheDocument()
    expect(screen.queryByTestId('my-work-review-sb')).not.toBeInTheDocument()
    expect(screen.queryByTestId('my-work-extension-sb-ask')).not.toBeInTheDocument()
  })

  it('shows a standalone ad-hoc task (no deliverable), still actionable and still opening its page', () => {
    state.items = [{
      ...base, subTaskId: 'adh1', title: 'Fix the banner', status: 'todo',
      deliverableId: null, deliverableName: null, deliverableState: null, campaignId: null, campaignName: null, isAdhoc: true,
    }]
    renderLists()
    expect(screen.getByTestId('my-work-item-adh1')).toHaveTextContent('Fix the banner')
    expect(screen.getByTestId('my-work-item-adh1')).toHaveTextContent('Ad-hoc task')
    expect(screen.getByTestId('my-work-start-adh1')).toBeInTheDocument()
    expect(screen.getByTestId('my-work-open-adh1')).toHaveAttribute('href', '/my-work/task/adh1')
  })

  it('names who gave it and who reviews it, and the deliverable · campaign · discipline · version', () => {
    state.items = [{ ...base, subTaskId: 'p1', revisionRound: 1 }]
    renderLists()
    expect(screen.getByTestId('my-work-people-p1')).toHaveTextContent('Assigned by Nadia Assigner')
    expect(screen.getByTestId('my-work-people-p1')).toHaveTextContent('Reviewed by Omar Reviewer')
    expect(screen.getByTestId('my-work-item-p1')).toHaveTextContent('Hero KV · Spring Launch · Art Direction · v2')
  })

  it('marks a manual task on the card, and leaves a digital one unmarked', () => {
    state.items = [
      { ...base, subTaskId: 'shoot', reviewMode: 'manual' },
      { ...base, subTaskId: 'edit', reviewMode: 'digital' },
    ]
    renderLists()
    expect(screen.getByTestId('my-work-review-mode-shoot')).toBeInTheDocument()
    expect(screen.queryByTestId('my-work-review-mode-edit')).toBeNull()
  })

  /** I73.1 (Edward, 2 Oct, A): a campaign task sent for review reads "In review", not its piece's "In progress". */
  it('shows a campaign task\'s own status, not its piece\'s — In review while the piece is still in progress', () => {
    state.items = [
      { ...base, subTaskId: 'rev', status: 'review', deliverableState: 'in_progress' },
      { ...base, subTaskId: 'wip', status: 'in_progress', deliverableState: 'in_review' },
      { ...base, subTaskId: 'appr', status: 'done', deliverableState: 'approved' },
    ]
    renderLists()
    expect(screen.getByTestId('my-work-status-rev')).toHaveTextContent(/In review/i)
    expect(screen.getByTestId('my-work-status-wip')).toHaveTextContent(/In progress/i)
    expect(screen.queryByTestId('my-work-status-appr')).toBeNull()
  })

  it('shows a Changes requested badge on a sent-back task (revision ≥ 1), with Start for the fresh round', () => {
    state.items = [{ ...base, subTaskId: 'cr', status: 'todo', campaignId: null, campaignName: null, revisionRound: 1 }]
    renderLists()
    expect(screen.getByTestId('my-work-item-cr')).toHaveTextContent(/Changes requested/i)
    expect(screen.getByTestId('my-work-start-cr')).toBeInTheDocument()
  })

  /** ADR-0088 d.10 / d.1: the pending line and the answer stay on the card; the commitment beside the plan. */
  it('keeps the extension\'s pending line and the committed date on the card, without the ask', () => {
    state.items = [
      { ...base, subTaskId: 'ext1', status: 'todo', dueAt: daysFromNow(4), committedDueAt: daysFromNow(2) },
      { ...base, subTaskId: 'ext2', status: 'todo', dueAt: daysFromNow(4) },
    ]
    state.extensions = new Map([[
      'ext2',
      { eventType: 'extension_requested', isPending: true, toAt: daysFromNow(6), approverName: 'Nadia',
        actorId: 'me', actorName: 'Me', requestId: 'r1', reason: 'More work', viewerCanRequest: true, viewerCanDecide: false },
    ]])
    renderLists()
    expect(screen.getByTestId('my-work-committed-ext1')).toBeInTheDocument()
    expect(screen.queryByTestId('my-work-extension-ext1-ask')).toBeNull()
    const line = screen.getByTestId('my-work-extension-ext2-line')
    expect(line).toHaveAttribute('data-state', 'pending')
    expect(line.textContent).toContain('Nadia')
    // Withdraw is on the task page, with the ask.
    expect(screen.queryByTestId('my-work-extension-ext2-withdraw')).toBeNull()
  })

  it('shows only the chips that exist: the brief, N rules, the Library folder, the reference set', () => {
    state.items = [{ ...base, subTaskId: 'c1' }]
    const { unmount } = renderLists()
    expect(screen.queryByTestId('my-work-chips-c1')).not.toBeInTheDocument()
    unmount()

    state.brief = [{ key: 'task', en: 'The task', ar: '', value: 'Draw the opener' }]
    state.rules = [{ kind: 'do', text: 'Arabic leads' }, { kind: 'dont', text: 'Never قرعة' }]
    state.folder = { id: 'f-camp' }
    state.refsFolder = 'f-refs'
    state.refs = [{ id: 'a1', name: 'KV.pdf' }]
    renderLists()
    expect(screen.getByTestId('my-work-chip-brief-c1')).toHaveAttribute('href', '/my-work/task/c1#task-brief')
    expect(screen.getByTestId('my-work-chip-rules-c1')).toHaveTextContent('2 rules')
    expect(screen.getByTestId('my-work-chip-rules-c1')).toHaveAttribute('href', '/my-work/task/c1#task-rules')
    expect(screen.getByTestId('my-work-chip-folder-c1')).toHaveAttribute('href', '/library?client=cli1&folder=f-camp')
    expect(screen.getByTestId('my-work-chip-references-c1')).toHaveAttribute('href', '/library?client=cli1&folder=f-refs')
  })

  it('sends someone who cannot browse the Library to the task page\'s attachments instead, and offers no folder', () => {
    state.canAssets = false
    state.folder = { id: 'f-camp' }
    state.refsFolder = 'f-refs'
    state.refs = [{ id: 'a1', name: 'KV.pdf' }]
    state.items = [{ ...base, subTaskId: 'c2' }]
    renderLists()
    expect(screen.queryByTestId('my-work-chip-folder-c2')).not.toBeInTheDocument()
    expect(screen.getByTestId('my-work-chip-references-c2')).toHaveAttribute('href', '/my-work/task/c2#task-attached')
  })

  it('offers no brief chip for a brief with nothing written', () => {
    state.brief = [{ key: 'task', en: 'The task', ar: '', value: '  ' }]
    state.items = [{ ...base, subTaskId: 'c3' }]
    renderLists()
    expect(screen.queryByTestId('my-work-chip-brief-c3')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------------
// I54.15 — priority on the card, as a symbol, and the list ordered by it (Edward, 23 Sep).
describe('My Work — priority (I54.15)', () => {
  it('marks a high-priority task on its card, and names it for a reader who cannot see colour', () => {
    state.items = [{ ...base, subTaskId: 'st-high', dueAt: daysFromNow(0), priority: 'high' }]
    renderLists()
    const mark = screen.getByTestId('my-work-priority-st-high')
    expect(mark).toHaveAttribute('data-priority', 'high')
    expect(mark).toHaveTextContent('High')
    expect(mark).toHaveAttribute('title', 'High')
  })

  it('says Normal, not Low', () => {
    state.items = [{ ...base, subTaskId: 'st-low', dueAt: daysFromNow(0), priority: 'low' }]
    renderLists()
    const mark = screen.getByTestId('my-work-priority-st-low')
    expect(mark).toHaveTextContent('Normal')
    expect(mark).toHaveAttribute('data-priority', 'low')
  })

  it('leaves a task with no priority unmarked', () => {
    state.items = [{ ...base, subTaskId: 'st-none', dueAt: daysFromNow(0), priority: null }]
    renderLists()
    expect(screen.queryByTestId('my-work-priority-st-none')).not.toBeInTheDocument()
  })

  it('puts the higher priority first when two tasks are due the same day', () => {
    state.items = [
      { ...base, subTaskId: 'st-normal', title: 'Normal one', dueAt: daysFromNow(0), priority: 'low' },
      { ...base, subTaskId: 'st-high', title: 'High one', dueAt: daysFromNow(0), priority: 'high' },
    ]
    renderLists()
    const rows = screen.getAllByTestId(/^my-work-item-/)
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual(['my-work-item-st-high', 'my-work-item-st-normal'])
  })

  it('still leads with the deadline — a normal task due sooner outranks a high one due later', () => {
    // Both in Later, so the order inside one list is what is asserted.
    state.items = [
      { ...base, subTaskId: 'st-high-later', dueAt: daysFromNow(14), priority: 'high' },
      { ...base, subTaskId: 'st-normal-sooner', dueAt: daysFromNow(10), priority: 'low' },
    ]
    renderLists()
    const rows = within(screen.getByTestId('later-tasks-panel')).getAllByTestId(/^my-work-item-/)
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual(['my-work-item-st-normal-sooner', 'my-work-item-st-high-later'])
  })
})
