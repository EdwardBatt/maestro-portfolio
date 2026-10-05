import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../../lib/i18n'
import type { ExtensionEvent } from '../api/extensions-api'

/**
 * The state of the ask on one task (ADR-0088 d.8, d.10) — one line, and the acts on it. What is
 * asserted is WHO gets which control: the buttons are read off the view's flags, and a button that
 * appears for the wrong person is a refusal the server has to make instead of one the screen
 * avoids. The api module reaches lib/env (throws in CI), so it is mocked; the RPC arguments are
 * what the mocks capture.
 */
const state = vi.hoisted(() => ({
  request: vi.fn(),
  decide: vi.fn(),
  withdraw: vi.fn(),
}))

vi.mock('../api/extensions-api', () => ({
  useRequestExtension: () => ({ mutate: state.request, isPending: false }),
  useDecideExtension: () => ({ mutate: state.decide, isPending: false, variables: undefined }),
  useWithdrawExtension: () => ({ mutate: state.withdraw, isPending: false }),
  isRefused: (e: unknown) => (e as { code?: string } | null)?.code === '42501',
}))

// I41.10/I41.11: the extension arithmetic reads the tenant's buffer and calendar; the defaults here.
vi.mock('../../../lib/deadlines/use-extension-context', () => ({
  useExtensionContext: () => ({ reviewBufferWorkingDays: 1, workingDays: [7, 1, 2, 3, 4], closures: [] }),
}))

import { ExtensionControl } from './ExtensionControl'

const pending: ExtensionEvent = {
  eventId: 'e1',
  eventType: 'extension_requested',
  requestId: 'e1',
  subTaskId: 'st1',
  deliverableId: 'd1',
  actorId: 'maker',
  actorName: 'Sara',
  createdAt: '2026-09-11T08:00:00Z',
  fromAt: '2026-09-16T15:00:00Z',
  toAt: '2026-09-21T15:00:00Z',
  reason: 'More work than planned',
  note: null,
  attributedTo: 'assignee',
  isPending: true,
  taskTitle: 'Design',
  taskStatus: 'in_progress',
  assigneeId: 'maker',
  assigneeName: 'Sara',
  planDueAt: '2026-09-21T15:00:00Z',
  committedDueAt: '2026-09-16T15:00:00Z',
  departmentId: null,
  deliverableName: 'KV',
  deliverableDueAt: '2026-09-24T15:00:00Z',
  campaignId: 'c1',
  campaignName: 'Ramadan',
  goLiveAt: '2026-09-28T15:00:00Z',
  approverId: 'am',
  approverName: 'Nadia',
  viewerCanDecide: false,
  viewerCanRequest: true,
}

const base = {
  subTaskId: 'st1',
  taskTitle: 'Design',
  committedDueAt: '2026-09-16T15:00:00Z',
  deliverableDueAt: '2026-09-24T15:00:00Z',
  goLiveAt: '2026-09-28T15:00:00Z',
  testId: 'x',
}

describe('ExtensionControl (ADR-0088)', () => {
  beforeEach(() => {
    state.request.mockClear()
    state.decide.mockClear()
    state.withdraw.mockClear()
  })

  it('ADR-0141 d.5: offers no new ask — the per-task extension is retired into the change form', () => {
    render(<ExtensionControl {...base} latest={undefined} canRequest viewerId="maker" />)
    expect(screen.queryByTestId('x-ask')).toBeNull()
    expect(screen.queryByTestId('x-line')).toBeNull()
  })

  it('shows the pending line with the date, the approver and the reason, and withdraws for the requester', () => {
    render(<ExtensionControl {...base} latest={pending} canRequest viewerId="maker" />)
    const line = screen.getByTestId('x-line')
    expect(line).toHaveAttribute('data-state', 'pending')
    expect(line).toHaveTextContent('Nadia')
    expect(line).toHaveTextContent('More work than planned')
    expect(screen.queryByTestId('x-ask')).toBeNull()
    fireEvent.click(screen.getByTestId('x-withdraw'))
    expect(state.withdraw).toHaveBeenCalledWith('e1', expect.anything())
  })

  it('names the requester on the line for anybody else, and offers no withdraw to a bystander', () => {
    render(
      <ExtensionControl {...base} latest={{ ...pending, viewerCanRequest: false }} canRequest={false} viewerId="other" />,
    )
    expect(screen.getByTestId('x-line')).toHaveTextContent('Sara')
    expect(screen.queryByTestId('x-withdraw')).toBeNull()
    expect(screen.queryByTestId('x-decide')).toBeNull()
  })

  it('offers Approve / Refuse with the arithmetic only where the viewer may answer, and sends the note', () => {
    render(
      <ExtensionControl {...base} latest={{ ...pending, viewerCanDecide: true }} canRequest={false} viewerId="am" showDecision />,
    )
    // 21 Sep → due 24 Sep: Mon 21 → Thu 24 leaves Tue, Wed, Thu = 3 working days, buffer 1 → fine.
    expect(screen.getByTestId('x-decide-arithmetic')).toHaveAttribute('data-severity', 'fine')
    fireEvent.change(screen.getByTestId('x-decide-note'), { target: { value: 'Agreed with client' } })
    fireEvent.click(screen.getByTestId('x-decide-approve'))
    expect(state.decide).toHaveBeenCalledWith({ requestId: 'e1', approve: true, note: 'Agreed with client' }, expect.anything())
    fireEvent.click(screen.getByTestId('x-decide-refuse'))
    expect(state.decide).toHaveBeenLastCalledWith(expect.objectContaining({ approve: false }), expect.anything())
  })

  it('does not show the decision where showDecision is off, even for somebody who may answer', () => {
    render(<ExtensionControl {...base} latest={{ ...pending, viewerCanDecide: true }} canRequest={false} viewerId="am" />)
    expect(screen.queryByTestId('x-decide')).toBeNull()
  })

  it('reads the answer once given, and offers no new ask (ADR-0141 d.5)', () => {
    render(
      <ExtensionControl
        {...base}
        latest={{ ...pending, eventType: 'extension_refused', isPending: false, actorName: 'Nadia' }}
        canRequest
        viewerId="maker"
      />,
    )
    expect(screen.getByTestId('x-line')).toHaveAttribute('data-state', 'extension_refused')
    expect(screen.getByTestId('x-line')).toHaveTextContent('Nadia')
    expect(screen.queryByTestId('x-ask')).toBeNull()
  })
})
