import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../lib/i18n'
import type { ReviewComment } from './api/review-api'

/**
 * TaskReviewThread — the manual review surface (ADR-0059 d.9) and the link a note may carry
 * (addendum d.14–d.17). review-api reaches lib/env in CI → mocked. Covers: the anchor renders only
 * when a note has a link, opens in a new tab, and shows host + path rather than the token; the
 * composer sends the link beside the note and clears both; the offline sentence is the maker's
 * only; the gate line still reads the note, not the link.
 */

const state = vi.hoisted(() => ({
  comments: [] as ReviewComment[],
  addMutate: vi.fn(),
  resolveMutate: vi.fn(),
}))

vi.mock('./api/review-api', () => ({
  useTaskComments: () => ({ data: state.comments, isLoading: false, isError: false }),
  useAddTaskComment: () => ({ mutate: state.addMutate, isPending: false, isError: false }),
  useResolveTaskComment: () => ({ mutate: state.resolveMutate, isPending: false }),
  // I59.29 (ADR-0112 d.2): mounted only when a pin control is shown.
  useSetPinDone: () => ({ mutate: vi.fn(), isPending: false }),
  useReplyToPin: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'me' } } }),
}))

import { TaskReviewThread } from './TaskReviewThread'

const mkC = (o: Partial<ReviewComment> & { id: string }): ReviewComment => ({
  mediaRecordId: null, subTaskId: 't1', round: 1, source: 'internal', body: 'Deck is up', timecodeMs: null,
  posX: null, posY: null, page: null, resolved: false, authorId: 'me', authorName: 'Me',
  createdAt: '2026-09-15T10:00:00Z', linkUrl: null, ...o,
})

beforeEach(() => {
  state.comments = []
  state.addMutate.mockReset()
  state.resolveMutate.mockReset()
})

describe('TaskReviewThread — a note may carry a link (ADR-0059 addendum)', () => {
  it('renders the link as an anchor to a new tab, showing host and path, only when a note has one', () => {
    state.comments = [
      mkC({ id: 'c1', linkUrl: 'https://www.icloud.com/keynote/0abc_deck#Q4' }),
      mkC({ id: 'c2', body: 'Proofed on paper' }),
    ]
    render(<TaskReviewThread subTaskId="t1" round={1} role="reviewer" />)
    const a = screen.getByTestId('task-comment-link-c1') as HTMLAnchorElement
    expect(a.getAttribute('href')).toBe('https://www.icloud.com/keynote/0abc_deck#Q4')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toContain('noopener')
    expect(a.textContent).toBe('www.icloud.com/keynote/0abc_deck')
    expect(screen.queryByTestId('task-comment-link-c2')).toBeNull()
  })

  it('sends the link beside the note and clears both on success', () => {
    state.addMutate.mockImplementation((_args: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.())
    render(<TaskReviewThread subTaskId="t1" round={1} role="maker" />)
    const body = screen.getByTestId('task-comment-body-t1') as HTMLTextAreaElement
    const link = screen.getByTestId('task-comment-link-input-t1') as HTMLInputElement
    fireEvent.change(body, { target: { value: 'Deck v1, 14 slides' } })
    fireEvent.change(link, { target: { value: 'https://www.icloud.com/keynote/0abc' } })
    fireEvent.click(screen.getByTestId('task-comment-submit-t1'))
    expect(state.addMutate).toHaveBeenCalledTimes(1)
    expect(state.addMutate.mock.calls[0][0]).toEqual({ body: 'Deck v1, 14 slides', linkUrl: 'https://www.icloud.com/keynote/0abc' })
    expect(body.value).toBe('')
    expect(link.value).toBe('')
  })

  // d.15: the note is what the gate reads. A link with no note sends nothing.
  it('does not send a link without a note', () => {
    render(<TaskReviewThread subTaskId="t1" round={1} role="maker" />)
    fireEvent.change(screen.getByTestId('task-comment-link-input-t1'), { target: { value: 'https://x.test/a' } })
    fireEvent.click(screen.getByTestId('task-comment-submit-t1'))
    expect(state.addMutate).not.toHaveBeenCalled()
  })

  // d.17: the sentence is for the person typing the link, not for the reviewer reading it.
  it('shows the offline sentence to the maker only', () => {
    const { unmount } = render(<TaskReviewThread subTaskId="t1" round={1} role="maker" />)
    expect(screen.getByTestId('task-review-link-note-t1')).toBeTruthy()
    unmount()
    render(<TaskReviewThread subTaskId="t1" role="reviewer" />)
    expect(screen.queryByTestId('task-review-link-note-t1')).toBeNull()
  })

  // ---- I59.29 (ADR-0112 d.2) ----
  it("a maker's reply hangs under the reviewer's note, and the gate still reads the maker's own note", () => {
    state.comments = [
      mkC({ id: 'n1', authorId: 'rev', authorName: 'Rana', body: 'The booth is off-brand', round: 1 }),
      mkC({ id: 'r1', authorId: 'me', parentId: 'n1', body: 'Rebuilt it', round: 1 }),
    ]
    render(<TaskReviewThread subTaskId="t1" role="maker" round={2} />)
    expect(screen.queryByTestId('task-comment-r1')).toBeNull()
    expect(screen.getByTestId('pin-reply-r1')).toHaveTextContent('Rebuilt it')
    // A reply is the pin's round — it never satisfies this round's note.
    expect(screen.getByTestId('task-review-gate-t1')).toHaveTextContent(/Write what you did/)
  })

  it('pinActions offers the maker Mark done and Reply on the reviewer note only', () => {
    state.comments = [mkC({ id: 'n1', authorId: 'rev' }), mkC({ id: 'n2', authorId: 'me' })]
    render(<TaskReviewThread subTaskId="t1" role="maker" pinActions />)
    expect(screen.getByTestId('pin-mark-done-n1')).toBeInTheDocument()
    expect(screen.getByTestId('pin-reply-open-n1')).toBeInTheDocument()
    expect(screen.queryByTestId('pin-mark-done-n2')).toBeNull()
  })
})
