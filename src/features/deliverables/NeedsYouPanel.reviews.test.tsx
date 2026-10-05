import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import '../../lib/i18n'
import type { AwaitingReviewItem } from './api/deliverables-api'

/**
 * The Review cards of "Needs you" (I59.10, D2) — moved here from AwaitingReviewPanel.test.tsx when
 * that panel folded into Needs you; every assertion is kept. (ADR-0035, I11.3) The reviewer inbox:
 * appears only when something names me as reviewer and sits in review, opens the review inline, and
 * gates Approve on the deliverable being in_review. The api reaches lib/env (throws in CI) so it's mocked; ReviewPanel is stubbed (its own
 * suite covers it) so this proves the inbox/gating logic.
 */

const state = vi.hoisted(() => ({
  items: [] as AwaitingReviewItem[],
  approveMutate: vi.fn(),
  requestChangesMutate: vi.fn(),
  respondMutate: vi.fn(),
  responseKind: 'no_comment' as 'no_comment' | 'feedback',
}))

vi.mock('./api/deliverables-api', () => ({
  useAwaitingMyReview: () => ({ data: state.items, isLoading: false }),
  // Needs you's other sources, empty here: this file is about the review cards.
  useMyAssignedWork: () => ({ data: [], isLoading: false }),
  useMarkTaskSeen: () => ({ mutate: vi.fn(), isPending: false }),
  useApproveSubTask: () => ({ mutate: state.approveMutate, isPending: false }),
  useRequestChangesSubTask: () => ({ mutate: state.requestChangesMutate, isPending: false }),
  // ADR-0089 d.5: the optional reviewer's answer, and the label the server would give it.
  useRespondSubTask: () => ({ mutate: state.respondMutate, isPending: false }),
  useMyResponseKind: () => ({ data: state.responseKind, isLoading: false, isError: false }),
}))

vi.mock('./api/pending-approvals-api', () => ({
  usePendingApprovals: () => ({ data: [], isLoading: false, isError: false }),
  pendingApprovalLink: () => null,
}))
vi.mock('./api/needs-you-api', () => ({
  useUnassignedPiecesIOwn: () => ({ data: [], isLoading: false, isError: false }),
}))
vi.mock('./api/needs-you-sources-api', () => {
  const none = { data: undefined, isError: false, error: null }
  return {
    useNeedsYouSources: () => ({
      rules: none, sentAt: none, cameBack: none, blocks: none, extensions: none, changes: none,
      messages: none, overload: none, escalations: none, client: none, scope: none, changeAsks: none,
    }),
  }
})
vi.mock('./api/requests-api', () => ({
  useCloseChangeRequest: () => ({ mutate: vi.fn(), isPending: false }),
  useAnswerTooMuch: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('../notifications/AssignmentRequestActions', () => ({ AssignmentRequestActions: () => null }))

vi.mock('./ReviewPanel', () => ({
  ReviewPanel: ({ deliverableId }: { deliverableId: string }) => (
    <div data-testid={`review-panel-stub-${deliverableId}`} />
  ),
}))

// ADR-0059: the manual arm of the review surface. Stubbed for the same reason ReviewPanel is —
// it imports `api/review-api`, which imports `lib/supabase`, which parses VITE_* with Zod and
// THROWS when they are absent. They are absent in CI, so an unmocked import here does not fail an
// assertion, it stops the whole file loading. What this suite asserts is the panel's own branching,
// which the stub reports faithfully.
vi.mock('./TaskReviewThread', () => ({
  TaskReviewThread: ({ subTaskId }: { subTaskId: string }) => (
    <div data-testid={`task-review-thread-stub-${subTaskId}`} />
  ),
}))

vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'reviewer' } } }),
}))

import { NeedsYouPanel } from './NeedsYouPanel'

const renderPanel = () => render(<MemoryRouter><NeedsYouPanel /></MemoryRouter>)

const base: AwaitingReviewItem = {
  subTaskId: 'st1',
  title: 'Fix the banner',
  dueAt: null,
  assigneeName: 'Sam',
  reviewMode: 'digital',
  deliverableId: 'del1',
  deliverableName: 'Fix the banner',
  deliverableState: 'in_review',
  mineIsMandatory: false,
  reviewers: [{ userId: 'reviewer', name: 'Me', isMandatory: false, approvedAt: null, respondedAt: null, response: null, isActive: true }],
}

describe('Needs you — review cards (ADR-0035, I11.3; I59.10)', () => {
  beforeEach(() => {
    state.items = []
    state.approveMutate = vi.fn()
    state.requestChangesMutate = vi.fn()
    state.respondMutate = vi.fn()
    state.responseKind = 'no_comment'
  })

  it('renders nothing when nothing is awaiting my review', () => {
    renderPanel()
    expect(screen.queryByTestId('needs-you-panel')).not.toBeInTheDocument()
  })

  it('files a review by its clock: due today or overdue is "today or it slips", later is "this week", none is "quietly"', () => {
    const at = (days: number) => new Date(new Date().setHours(12, 0, 0, 0) + days * 86_400_000).toISOString()
    state.items = [
      { ...base, subTaskId: 'late', dueAt: at(-1) },
      { ...base, subTaskId: 'soon', dueAt: at(3) },
      { ...base, subTaskId: 'open', dueAt: null },
    ]
    renderPanel()
    expect(screen.getByTestId('awaiting-review-item-late')).toHaveAttribute('data-group', 'today')
    expect(screen.getByTestId('awaiting-review-item-soon')).toHaveAttribute('data-group', 'week')
    expect(screen.getByTestId('awaiting-review-item-open')).toHaveAttribute('data-group', 'quiet')
    expect(screen.getByTestId('awaiting-review-item-late')).toHaveTextContent('Review')
  })

  it('keeps what the review card showed: the task and project, the maker, manual, due', () => {
    state.items = [{ ...base, campaignName: 'Spring Launch', reviewMode: 'manual', dueAt: null }]
    renderPanel()
    expect(screen.getByTestId('awaiting-review-context-st1')).toHaveTextContent('Fix the banner · Spring Launch')
    expect(screen.getByTestId('awaiting-review-item-st1')).toHaveTextContent('from Sam')
    expect(screen.getByTestId('awaiting-review-mode-st1')).toBeInTheDocument()
    expect(screen.getByTestId('needs-you-due-st1')).toHaveTextContent('No due date')
  })

  it('approves THE TASK, not its parent deliverable (ADR-0038)', () => {
    state.items = [base]
    renderPanel()
    expect(screen.getByTestId('awaiting-review-item-st1')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('awaiting-review-open-st1'))
    expect(screen.getByTestId('awaiting-review-modal-st1')).toBeInTheDocument()
    expect(screen.getByTestId('review-panel-stub-del1')).toBeInTheDocument()
    const approve = screen.getByTestId('awaiting-review-approve-st1')
    expect(approve).not.toBeDisabled()
    fireEvent.click(approve)
    // The old action transitioned the whole deliverable and never touched the submitted task,
    // which is why nothing was ever `done` and "who finished this?" had no answer.
    expect(state.approveMutate).toHaveBeenCalledWith('st1', expect.anything())
  })

  it('approves regardless of the parent deliverable state — campaign work is reviewable too', () => {
    // A campaign deliverable is never advanced to in_review by a maker submitting, so requiring it
    // meant campaign tasks arrived here (when they arrived at all) permanently un-approvable.
    state.items = [{ ...base, deliverableState: 'in_progress' }]
    renderPanel()
    fireEvent.click(screen.getByTestId('awaiting-review-open-st1'))
    const approve = screen.getByTestId('awaiting-review-approve-st1')
    expect(approve).not.toBeDisabled()
    expect(screen.queryByTestId('awaiting-review-notready-st1')).not.toBeInTheDocument()
    fireEvent.click(approve)
    expect(state.approveMutate).toHaveBeenCalledWith('st1', expect.anything())
  })

  it('shows a standalone task (no deliverable) with no version chain (ADR-0034)', () => {
    state.items = [{ ...base, deliverableId: null, deliverableName: null, deliverableState: null }]
    renderPanel()
    fireEvent.click(screen.getByTestId('awaiting-review-open-st1'))
    expect(screen.queryByTestId('review-panel-stub-del1')).not.toBeInTheDocument()
    expect(screen.getByTestId('awaiting-review-approve-st1')).not.toBeDisabled()
  })

  it('lets the reviewer request changes on the sub-task', () => {
    state.items = [base]
    renderPanel()
    fireEvent.click(screen.getByTestId('awaiting-review-open-st1'))
    fireEvent.click(screen.getByTestId('awaiting-review-request-changes-st1'))
    expect(state.requestChangesMutate).toHaveBeenCalledWith('st1', expect.anything())
  })

  // ---------------------------------------------------------------- ADR-0043 ----

  it('names the colleagues still outstanding, marking the mandatory ones (d.8)', () => {
    state.items = [{
      ...base,
      reviewers: [
        { userId: 'reviewer', name: 'Me', isMandatory: false, approvedAt: null, respondedAt: null, response: null, isActive: true },
        { userId: 'legal', name: 'Layla', isMandatory: true, approvedAt: null, respondedAt: null, response: null, isActive: true },
        { userId: 'gone', name: 'Amir', isMandatory: false, approvedAt: null, respondedAt: '2026-08-27T09:00:00Z', response: 'no_comment', isActive: true },
      ],
    }]
    renderPanel()
    const waiting = screen.getByTestId('awaiting-review-waiting-on-st1')
    expect(waiting).toHaveTextContent('Layla')
    expect(screen.getByTestId('awaiting-review-waiting-on-st1-required-legal')).toBeInTheDocument()
    // Amir has already answered — a reviewer who is told the task waits on him would chase the
    // wrong person, which is exactly the ambiguity this decision closes.
    expect(screen.queryByTestId('awaiting-review-waiting-on-st1-gone')).not.toBeInTheDocument()
  })

  it('says my approval is required when MY appointment is the mandatory one', () => {
    state.items = [{ ...base, mineIsMandatory: true }]
    renderPanel()
    expect(screen.getByTestId('awaiting-review-mine-mandatory-st1')).toBeInTheDocument()
  })

  it('does not promise sign-off when a mandatory colleague has not looked at it yet (d.5)', () => {
    state.items = [{
      ...base,
      mineIsMandatory: true,
      reviewers: [
        { userId: 'reviewer', name: 'Me', isMandatory: true, approvedAt: null, respondedAt: null, response: null, isActive: true },
        { userId: 'legal', name: 'Layla', isMandatory: true, approvedAt: null, respondedAt: null, response: null, isActive: true },
      ],
    }]
    renderPanel()
    fireEvent.click(screen.getByTestId('awaiting-review-open-st1'))
    // A first required approval records a real part of the record — it does not complete the task.
    expect(screen.getByTestId('awaiting-review-approve-st1')).toHaveTextContent('Record my approval')
  })

  it('does promise sign-off when mine is the last verdict owed', () => {
    state.items = [{
      ...base,
      mineIsMandatory: true,
      reviewers: [
        { userId: 'reviewer', name: 'Me', isMandatory: true, approvedAt: null, respondedAt: null, response: null, isActive: true },
        { userId: 'legal', name: 'Layla', isMandatory: true, approvedAt: '2026-08-27T09:00:00Z', respondedAt: null, response: null, isActive: true },
      ],
    }]
    renderPanel()
    fireEvent.click(screen.getByTestId('awaiting-review-open-st1'))
    expect(screen.getByTestId('awaiting-review-approve-st1')).toHaveTextContent('Approve & sign off')
  })
})

// ---------------------------------------------------------------- ADR-0089 ----
// An optional reviewer ANSWERS; a required reviewer APPROVES — and the completing approval waits
// for every answer, with no "approve anyway".
describe('Needs you — review cards, two verbs (ADR-0089)', () => {
  beforeEach(() => {
    state.items = []
    state.approveMutate = vi.fn()
    state.requestChangesMutate = vi.fn()
    state.respondMutate = vi.fn()
    state.responseKind = 'no_comment'
  })

  const optionalMe = {
    ...base,
    reviewers: [
      { userId: 'reviewer', name: 'Me', isMandatory: false, approvedAt: null, respondedAt: null, response: null, isActive: true },
      { userId: 'legal', name: 'Layla', isMandatory: true, approvedAt: null, respondedAt: null, response: null, isActive: true },
    ],
  }

  it('offers an OPTIONAL reviewer Done, not Approve (d.5)', () => {
    state.items = [optionalMe]
    renderPanel()
    fireEvent.click(screen.getByTestId('awaiting-review-open-st1'))
    expect(screen.queryByTestId('awaiting-review-approve-st1')).not.toBeInTheDocument()
    const done = screen.getByTestId('awaiting-review-respond-st1')
    expect(done).toHaveTextContent('Done — no comment')
    fireEvent.click(done)
    expect(state.respondMutate).toHaveBeenCalledWith('st1', expect.anything())
    expect(state.approveMutate).not.toHaveBeenCalled()
  })

  it('labels Done by what the server would record — feedback left, when they have commented', () => {
    state.items = [optionalMe]
    state.responseKind = 'feedback'
    renderPanel()
    fireEvent.click(screen.getByTestId('awaiting-review-open-st1'))
    expect(screen.getByTestId('awaiting-review-respond-st1')).toHaveTextContent('Done — feedback left')
  })

  it('withholds Approve from the required reviewer while an optional one has not answered, naming them (d.7)', () => {
    state.items = [{
      ...base,
      mineIsMandatory: true,
      reviewers: [
        { userId: 'reviewer', name: 'Me', isMandatory: true, approvedAt: null, respondedAt: null, response: null, isActive: true },
        { userId: 'silent', name: 'Zara', isMandatory: false, approvedAt: null, respondedAt: null, response: null, isActive: true },
        { userId: 'answered', name: 'Omar', isMandatory: false, approvedAt: null, respondedAt: '2026-09-11T09:00:00Z', response: 'feedback', isActive: true },
      ],
    }]
    renderPanel()
    fireEvent.click(screen.getByTestId('awaiting-review-open-st1'))
    expect(screen.getByTestId('awaiting-review-approve-st1')).toBeDisabled()
    const why = screen.getByTestId('awaiting-review-waiting-for-answers-st1')
    expect(why).toHaveTextContent('Zara')
    expect(why).not.toHaveTextContent('Omar')
    // There is no second button that skips the wait.
    expect(screen.queryByText(/approve anyway/i)).not.toBeInTheDocument()
    // ADR-0089 addendum d.14: the send-back waits for the same answers — one consolidated round.
    expect(screen.getByTestId('awaiting-review-request-changes-st1')).toBeDisabled()
  })

  it('does not withhold a required approval that completes nothing — another required one is still owed', () => {
    state.items = [{
      ...base,
      mineIsMandatory: true,
      reviewers: [
        { userId: 'reviewer', name: 'Me', isMandatory: true, approvedAt: null, respondedAt: null, response: null, isActive: true },
        { userId: 'legal', name: 'Layla', isMandatory: true, approvedAt: null, respondedAt: null, response: null, isActive: true },
        { userId: 'silent', name: 'Zara', isMandatory: false, approvedAt: null, respondedAt: null, response: null, isActive: true },
      ],
    }]
    renderPanel()
    fireEvent.click(screen.getByTestId('awaiting-review-open-st1'))
    expect(screen.getByTestId('awaiting-review-approve-st1')).not.toBeDisabled()
    expect(screen.getByTestId('awaiting-review-approve-st1')).toHaveTextContent('Record my approval')
    // The send-back still waits for Zara (addendum d.14), and the line says so.
    expect(screen.getByTestId('awaiting-review-request-changes-st1')).toBeDisabled()
    expect(screen.getByTestId('awaiting-review-waiting-for-answers-st1')).toHaveTextContent('Zara')
  })

  it('offers Approve & sign off once every optional reviewer has answered', () => {
    state.items = [{
      ...base,
      mineIsMandatory: true,
      reviewers: [
        { userId: 'reviewer', name: 'Me', isMandatory: true, approvedAt: null, respondedAt: null, response: null, isActive: true },
        { userId: 'answered', name: 'Omar', isMandatory: false, approvedAt: null, respondedAt: '2026-09-11T09:00:00Z', response: 'no_comment', isActive: true },
      ],
    }]
    renderPanel()
    fireEvent.click(screen.getByTestId('awaiting-review-open-st1'))
    const approve = screen.getByTestId('awaiting-review-approve-st1')
    expect(approve).not.toBeDisabled()
    expect(approve).toHaveTextContent('Approve & sign off')
  })

  it('names everyone on the modal with their standing (d.12)', () => {
    state.items = [{
      ...base,
      mineIsMandatory: true,
      reviewers: [
        { userId: 'reviewer', name: 'Me', isMandatory: true, approvedAt: null, respondedAt: null, response: null, isActive: true },
        { userId: 'silent', name: 'Zara', isMandatory: false, approvedAt: null, respondedAt: null, response: null, isActive: true },
        { userId: 'answered', name: 'Omar', isMandatory: false, approvedAt: null, respondedAt: '2026-09-11T09:00:00Z', response: 'feedback', isActive: true },
      ],
    }]
    renderPanel()
    fireEvent.click(screen.getByTestId('awaiting-review-open-st1'))
    expect(screen.getByTestId('awaiting-review-modal-reviewer-st1-unanswered-silent')).toHaveTextContent('(no answer yet)')
    expect(screen.getByTestId('awaiting-review-modal-reviewer-st1-answered-answered')).toHaveTextContent('(feedback left)')
    expect(screen.getByTestId('awaiting-review-modal-reviewer-st1-required-reviewer')).toBeInTheDocument()
  })

  it('turns the database\'s own refusal (55089) into the same message, should a race get past the screen', async () => {
    state.items = [{
      ...base,
      mineIsMandatory: true,
      reviewers: [{ userId: 'reviewer', name: 'Me', isMandatory: true, approvedAt: null, respondedAt: null, response: null, isActive: true }],
    }]
    state.approveMutate = vi.fn((_id: string, opts: { onError: (e: unknown) => void }) =>
      opts.onError({ code: '55089', message: 'this approval would complete the task, and not every reviewer has answered yet: Zara' }))
    renderPanel()
    fireEvent.click(screen.getByTestId('awaiting-review-open-st1'))
    fireEvent.click(screen.getByTestId('awaiting-review-approve-st1'))
    expect(await screen.findByTestId('awaiting-review-error-st1')).toHaveTextContent('Zara')
  })
})
