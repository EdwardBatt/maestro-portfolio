import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../lib/i18n'
import type { ChatMessage } from './lib/merge-messages'

/**
 * ChatPanel (ADR-0015/0027, I4). chat-api reaches lib/env in CI → mocked; the live channel hook
 * is a no-op mock. Covers: empty state, message render + own-message styling, optimistic send,
 * failed-retry (same id → idempotent), and the unavailable state.
 */

const state = vi.hoisted(() => ({
  conversationId: 'c1' as string | null,
  convError: false,
  convLoading: false,
  messages: [] as ChatMessage[],
  sendMutate: vi.fn(),
  // I31.6 — the refusal code the panel now translates into a specific sentence.
  convErrorCode: null as string | null,
  // I31.4 — the member list and the add/remove controls.
  people: [] as { userId: string; displayName: string | null; reason: string }[],
  canManage: false,
  addable: [] as { id: string; displayName: string }[],
  addMutate: vi.fn(),
  removeMutate: vi.fn(),
  lastRemoval: null as { removed: boolean; stillEntitled: boolean } | null,
}))

vi.mock('./api/chat-api', () => ({
  useConversation: () => ({
    data: state.conversationId,
    isLoading: state.convLoading,
    isError: state.convError,
    // I31.6: the panel now reads the REFUSAL CODE, so the stub has to carry one.
    error: state.convErrorCode ? { code: state.convErrorCode } : null,
  }),
  useMessages: () => ({ data: state.messages, isLoading: false, isError: false }),
  useSendMessage: () => ({ mutate: state.sendMutate, isPending: false }),
  useMarkRead: () => ({ mutate: vi.fn() }),
  useConversationChannel: () => {},
  useConversationPeople: () => ({ data: { people: state.people, canManage: state.canManage } }),
  useAddablePeople: () => ({ data: state.addable }),
  useAddMember: () => ({ mutate: state.addMutate, isPending: false }),
  useRemoveMember: () => ({ mutate: state.removeMutate, isPending: false, data: state.lastRemoval }),
}))

vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'me' } }, claims: { tenantId: 't1' } }),
}))

import { ChatPanel } from './ChatPanel'

const msg = (o: Partial<ChatMessage> & { id: string }): ChatMessage => ({
  seq: 1, senderId: 'u2', senderName: 'Ann', body: 'hi', createdAt: '2026-08-18T10:00:00Z', status: 'sent', ...o,
})

const render_ = () => render(<ChatPanel contextType="deliverable" contextId="d1" />)

describe('ChatPanel (ADR-0015/0027, I4)', () => {
  beforeEach(() => {
    state.conversationId = 'c1'
    state.convError = false
    state.convLoading = false
    state.messages = []
    state.sendMutate = vi.fn()
  })

  it('empty thread shows the empty state and a composer', () => {
    render_()
    expect(screen.getByTestId('chat-empty')).toBeInTheDocument()
    expect(screen.getByTestId('chat-composer')).toBeInTheDocument()
  })

  it('renders messages and marks the caller’s own', () => {
    state.messages = [msg({ id: 'm1', seq: 1, senderId: 'u2', senderName: 'Ann', body: 'hello' }), msg({ id: 'm2', seq: 2, senderId: 'me', body: 'hey' })]
    render_()
    expect(screen.getByTestId('chat-msg-m1')).toHaveTextContent('hello')
    expect(screen.getByTestId('chat-msg-m2')).toHaveClass('is-me')
  })

  it('stamps each message with the time it was sent', () => {
    state.messages = [msg({ id: 'm1', createdAt: '2026-08-18T10:00:00Z' })]
    render_()
    // The rendered string follows the runner's timezone and CI's is not pinned, so assert the
    // machine-readable attribute exactly and the text against the same formatter the panel uses.
    const stamp = screen.getByTestId('chat-msg-time-m1')
    expect(stamp).toHaveAttribute('datetime', '2026-08-18T10:00:00Z')
    expect(stamp).toHaveTextContent(
      new Intl.DateTimeFormat('en-GB', { timeStyle: 'short' }).format(new Date('2026-08-18T10:00:00Z')),
    )
  })

  it('breaks the thread with a date only where the day turns over', () => {
    state.messages = [
      // A minute apart, so no real UTC offset can put these two on different local days.
      msg({ id: 'm1', seq: 1, createdAt: '2026-08-18T12:00:00Z' }),
      msg({ id: 'm2', seq: 2, createdAt: '2026-08-18T12:01:00Z' }),
      msg({ id: 'm3', seq: 3, createdAt: '2026-08-20T12:00:00Z' }),
    ]
    render_()
    // One for the first message, one where the 18th becomes the 20th. Not three, and not none:
    // the date is repeated only where it is news.
    const days = screen.getAllByTestId('chat-day')
    expect(days).toHaveLength(2)
    expect(days[0]).not.toHaveTextContent(days[1]!.textContent!)
  })

  it('sends optimistically (mutate called with a body)', () => {
    render_()
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'ready for review' } })
    fireEvent.click(screen.getByTestId('chat-send'))
    expect(state.sendMutate).toHaveBeenCalledWith(expect.objectContaining({ body: 'ready for review' }))
  })

  it('a failed message offers retry with the SAME id (idempotent)', () => {
    state.messages = [msg({ id: 'm9', seq: null, senderId: 'me', body: 'oops', status: 'failed' })]
    render_()
    fireEvent.click(screen.getByTestId('chat-retry-m9'))
    expect(state.sendMutate).toHaveBeenCalledWith({ id: 'm9', body: 'oops' })
  })

  it('shows the unavailable state when the conversation cannot open', () => {
    state.convError = true
    render_()
    expect(screen.getByTestId('chat-unavailable')).toBeInTheDocument()
  })
})
