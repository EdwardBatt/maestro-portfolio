import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../../lib/i18n'
import type { TaskReviewer } from '../../../lib/reviewers/task-reviewers'

/**
 * ReviewActions (ADR-0089 d.5–d.7). One implementation behind two doors — the reviewer inbox and
 * the ad-hoc panel — so this is where the verbs are pinned once: an optional reviewer gets Done,
 * a required reviewer gets Approve, and the completing approval is withheld, by name, while an
 * optional reviewer is silent. No "approve anyway" exists.
 *
 * The api reaches lib/env (throws in CI) so it is mocked; auth is stubbed to a fixed signed-in id.
 */

const state = vi.hoisted(() => ({
  approve: vi.fn(),
  respond: vi.fn(),
  requestChanges: vi.fn(),
  kind: 'no_comment' as 'no_comment' | 'feedback',
}))

vi.mock('../api/deliverables-api', () => ({
  useApproveSubTask: () => ({ mutate: state.approve, isPending: false }),
  useRespondSubTask: () => ({ mutate: state.respond, isPending: false }),
  useRequestChangesSubTask: () => ({ mutate: state.requestChanges, isPending: false }),
  useMyResponseKind: () => ({ data: state.kind, isLoading: false, isError: false }),
}))

vi.mock('../../../app/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'me' } } }),
}))

import { ReviewActions } from './ReviewActions'

const r = (over: Partial<TaskReviewer> & { userId: string }): TaskReviewer => ({
  name: over.userId,
  isMandatory: false,
  approvedAt: null,
  respondedAt: null,
  response: null,
  isActive: true,
  ...over,
})

describe('ReviewActions (ADR-0089)', () => {
  beforeEach(() => {
    state.approve = vi.fn()
    state.respond = vi.fn()
    state.requestChanges = vi.fn()
    state.kind = 'no_comment'
  })

  it('gives an optional reviewer Done, and Done calls respond — never approve (d.5)', () => {
    render(<ReviewActions subTaskId="t1" reviewers={[r({ userId: 'me' }), r({ userId: 'req', isMandatory: true })]} />)
    expect(screen.queryByTestId('review-actions-approve-t1')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('review-actions-respond-t1'))
    expect(state.respond).toHaveBeenCalledWith('t1', expect.anything())
    expect(state.approve).not.toHaveBeenCalled()
  })

  it('labels Done by what the server would record', () => {
    state.kind = 'feedback'
    render(<ReviewActions subTaskId="t1" reviewers={[r({ userId: 'me' }), r({ userId: 'req', isMandatory: true })]} />)
    expect(screen.getByTestId('review-actions-respond-t1')).toHaveTextContent('Done — feedback left')
  })

  it('gives a required reviewer Approve, and Approve calls approve', () => {
    render(<ReviewActions subTaskId="t1" reviewers={[r({ userId: 'me', isMandatory: true })]} />)
    expect(screen.queryByTestId('review-actions-respond-t1')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('review-actions-approve-t1'))
    expect(state.approve).toHaveBeenCalledWith('t1', expect.anything())
  })

  it('treats a lone unmarked reviewer as the required one (d.2)', () => {
    render(<ReviewActions subTaskId="t1" reviewers={[r({ userId: 'me' })]} />)
    expect(screen.getByTestId('review-actions-approve-t1')).toBeInTheDocument()
  })

  it('withholds the completing approval while an optional reviewer is silent, naming them, with no way round (d.7)', () => {
    render(
      <ReviewActions
        subTaskId="t1"
        reviewers={[r({ userId: 'me', isMandatory: true }), r({ userId: 'zara', name: 'Zara' })]}
      />,
    )
    expect(screen.getByTestId('review-actions-approve-t1')).toBeDisabled()
    expect(screen.getByTestId('review-actions-waiting-for-answers-t1')).toHaveTextContent('Zara')
    expect(screen.queryByText(/anyway/i)).not.toBeInTheDocument()
    // ADR-0089 addendum d.14: the send-back waits for the same answers — one consolidated round.
    expect(screen.getByTestId('review-actions-request-changes-t1')).toBeDisabled()
    fireEvent.click(screen.getByTestId('review-actions-request-changes-t1'))
    expect(state.requestChanges).not.toHaveBeenCalled()
  })

  it('does not withhold a required approval that completes nothing — but still withholds the send-back (d.6, d.14)', () => {
    render(
      <ReviewActions
        subTaskId="t1"
        reviewers={[r({ userId: 'me', isMandatory: true }), r({ userId: 'other', isMandatory: true }), r({ userId: 'zara', name: 'Zara' })]}
      />,
    )
    const approve = screen.getByTestId('review-actions-approve-t1')
    expect(approve).not.toBeDisabled()
    expect(approve).toHaveTextContent('Record my approval')
    expect(screen.getByTestId('review-actions-request-changes-t1')).toBeDisabled()
    expect(screen.getByTestId('review-actions-waiting-for-answers-t1')).toHaveTextContent('Zara')
  })

  it('lets an optional reviewer send back once every OTHER optional reviewer has answered (d.14)', () => {
    render(
      <ReviewActions
        subTaskId="t1"
        reviewers={[r({ userId: 'req', isMandatory: true }), r({ userId: 'me' }), r({ userId: 'zara', name: 'Zara', respondedAt: '2026-09-15T09:00:00Z' })]}
      />,
    )
    expect(screen.getByTestId('review-actions-request-changes-t1')).not.toBeDisabled()
    fireEvent.click(screen.getByTestId('review-actions-request-changes-t1'))
    expect(state.requestChanges).toHaveBeenCalledWith('t1', expect.anything())
  })

  it('turns the database\'s 55089 into the same message when a race gets past the screen', async () => {
    state.approve = vi.fn((_id: string, opts: { onError: (e: unknown) => void }) =>
      opts.onError({ code: '55089', message: 'not every reviewer has answered yet: Zara' }))
    render(<ReviewActions subTaskId="t1" reviewers={[r({ userId: 'me', isMandatory: true })]} />)
    fireEvent.click(screen.getByTestId('review-actions-approve-t1'))
    expect(await screen.findByTestId('review-actions-error-t1')).toHaveTextContent('Zara')
  })

  it('calls onSettled when an action succeeds, so a modal can close', () => {
    const onSettled = vi.fn()
    state.respond = vi.fn((_id: string, opts: { onSuccess: () => void }) => opts.onSuccess())
    render(
      <ReviewActions
        subTaskId="t1"
        reviewers={[r({ userId: 'me' }), r({ userId: 'req', isMandatory: true })]}
        onSettled={onSettled}
      />,
    )
    fireEvent.click(screen.getByTestId('review-actions-respond-t1'))
    expect(onSettled).toHaveBeenCalled()
  })
})
