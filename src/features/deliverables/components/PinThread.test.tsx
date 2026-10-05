import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import '../../../lib/i18n'
import type { ReviewComment } from '../api/review-api'

/** ADR-0112 d.2 (I59.29): replies, "Done by", Re-open for the reviewer, Mark done / Undo / Reply for the maker. */
const state = vi.hoisted(() => ({ setDone: vi.fn(), reply: vi.fn() }))
vi.mock('../api/review-api', () => ({
  useSetPinDone: () => ({ mutate: state.setDone, isPending: false }),
  useReplyToPin: () => ({ mutate: state.reply, isPending: false }),
}))

import { PinThread } from './PinThread'
import { threadComments } from '../lib/pin-thread'

const mk = (o: Partial<ReviewComment> & { id: string }): ReviewComment => ({
  mediaRecordId: 'm1', subTaskId: null, round: 1, source: 'internal', body: 'Logo too small', timecodeMs: null,
  posX: 0.2, posY: 0.3, page: null, resolved: false, authorId: 'reviewer', authorName: 'Rana',
  createdAt: '2026-09-25T10:00:00Z', linkUrl: null, parentId: null, doneAt: null, doneById: null, doneByName: null, ...o,
})
const scope = { mediaRecordId: 'm1' }

describe('PinThread', () => {
  beforeEach(() => {
    state.setDone.mockReset()
    state.reply.mockReset()
  })

  it('renders nothing on a plain pin for somebody with nothing to do', () => {
    const { container } = render(<PinThread pin={mk({ id: 'p1' })} replies={[]} scope={scope} canReopen={false} myId="x" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the replies under the pin and "Done by <name>"', () => {
    render(
      <PinThread
        pin={mk({ id: 'p1', doneAt: '2026-09-25T11:00:00Z', doneById: 'maker', doneByName: 'Abeer' })}
        replies={[mk({ id: 'r1', parentId: 'p1', body: 'Bigger in v3', authorId: 'maker', authorName: 'Abeer' })]}
        scope={scope}
        canReopen={false}
        myId="x"
      />,
    )
    expect(screen.getByTestId('pin-done-p1')).toHaveTextContent('Done by Abeer')
    expect(screen.getByTestId('pin-reply-r1')).toHaveTextContent('Bigger in v3')
    expect(screen.queryByTestId('pin-reopen-p1')).toBeNull()
  })

  it('the reviewer re-opens a done pin', () => {
    render(<PinThread pin={mk({ id: 'p1', doneAt: 'x', doneById: 'maker', doneByName: 'Abeer' })} replies={[]} scope={scope} canReopen myId="reviewer" />)
    fireEvent.click(screen.getByTestId('pin-reopen-p1'))
    expect(state.setDone).toHaveBeenCalledWith({ id: 'p1', done: false }, expect.anything())
  })

  it('the maker marks a pin done, and may undo only their own done', () => {
    const { rerender } = render(<PinThread pin={mk({ id: 'p1' })} replies={[]} scope={scope} canReopen={false} makerActions myId="maker" />)
    fireEvent.click(screen.getByTestId('pin-mark-done-p1'))
    expect(state.setDone).toHaveBeenCalledWith({ id: 'p1', done: true }, expect.anything())

    rerender(<PinThread pin={mk({ id: 'p1', doneAt: 'x', doneById: 'maker', doneByName: 'Abeer' })} replies={[]} scope={scope} canReopen={false} makerActions myId="maker" />)
    expect(screen.queryByTestId('pin-mark-done-p1')).toBeNull()
    fireEvent.click(screen.getByTestId('pin-undo-p1'))
    expect(state.setDone).toHaveBeenLastCalledWith({ id: 'p1', done: false }, expect.anything())

    rerender(<PinThread pin={mk({ id: 'p1', doneAt: 'x', doneById: 'someone-else', doneByName: 'Omar' })} replies={[]} scope={scope} canReopen={false} makerActions myId="maker" />)
    expect(screen.queryByTestId('pin-undo-p1')).toBeNull()
  })

  it('the maker replies; cancel closes the box without sending', () => {
    render(<PinThread pin={mk({ id: 'p1' })} replies={[]} scope={scope} canReopen={false} makerActions myId="maker" />)
    fireEvent.click(screen.getByTestId('pin-reply-open-p1'))
    expect(screen.getByTestId('pin-reply-submit-p1')).toBeDisabled()
    fireEvent.change(screen.getByTestId('pin-reply-body-p1'), { target: { value: '  Fixed in v3  ' } })
    fireEvent.click(screen.getByTestId('pin-reply-submit-p1'))
    expect(state.reply).toHaveBeenCalledWith({ pinId: 'p1', body: 'Fixed in v3' }, expect.anything())

    fireEvent.click(screen.getByTestId('pin-reply-cancel-p1'))
    expect(screen.queryByTestId('pin-reply-form-p1')).toBeNull()
    expect(screen.getByTestId('pin-reply-open-p1')).toBeInTheDocument()
  })

  it('a refusal is said in one line beside the controls', () => {
    render(<PinThread pin={mk({ id: 'p1' })} replies={[]} scope={scope} canReopen={false} makerActions myId="maker" />)
    fireEvent.click(screen.getByTestId('pin-mark-done-p1'))
    const handlers = state.setDone.mock.calls[0]![1]
    act(() => handlers.onError({ code: '42501' }))
    expect(screen.getByTestId('pin-error-p1')).toHaveTextContent(/cannot change this pin/)
    act(() => handlers.onError(new Error('network')))
    expect(screen.getByTestId('pin-error-p1')).toHaveTextContent('That did not save. Try again.')
  })
})

describe('threadComments', () => {
  it('splits pins from replies and drops a reply whose pin is not in the list', () => {
    const list = [
      mk({ id: 'p1' }),
      mk({ id: 'r1', parentId: 'p1' }),
      mk({ id: 'p2' }),
      mk({ id: 'r2', parentId: 'elsewhere' }),
      mk({ id: 'r3', parentId: 'p1' }),
    ]
    const { pins, repliesOf } = threadComments(list)
    expect(pins.map((c) => c.id)).toEqual(['p1', 'p2'])
    expect(repliesOf('p1').map((c) => c.id)).toEqual(['r1', 'r3'])
    expect(repliesOf('p2')).toEqual([])
  })
})
