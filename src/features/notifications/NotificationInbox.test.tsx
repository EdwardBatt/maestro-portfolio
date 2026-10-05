import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import '../../lib/i18n'
import type { AppNotification } from './api/notifications-api'

/**
 * NotificationInbox (ADR-0026, I5). notifications-api reaches lib/env + realtime in CI → mocked;
 * the live channel hook is a no-op. Covers: badge count (incl. 9+ cap), closed-by-default panel,
 * list render + deep-link href, click marks unread read, empty state, and mark-all.
 */

const state = vi.hoisted(() => ({
  list: [] as AppNotification[],
  count: 0,
  markRead: vi.fn(),
  markAll: vi.fn(),
}))

// ADR-0087 d.11: the Approve / Refuse row under a booking-request item has its own suite; here it
// is stubbed so the inbox renders without reaching lib/supabase → lib/env.
vi.mock('./AssignmentRequestActions', () => ({
  AssignmentRequestActions: ({ subTaskId }: { subTaskId: string }) => <div data-testid={`stub-request-actions-${subTaskId}`} />,
}))

vi.mock('./api/notifications-api', () => ({
  useNotifications: () => ({ data: state.list }),
  useUnreadCount: () => ({ data: state.count }),
  useMarkRead: () => ({ mutate: state.markRead }),
  useMarkAllRead: () => ({ mutate: state.markAll }),
  useNotificationsChannel: () => {},
}))

import { NotificationInbox } from './NotificationInbox'

const notif = (o: Partial<AppNotification> & { id: string }): AppNotification => ({
  seq: 1, type: 'assigned', label: 'Hero KV', entityType: 'deliverable', entityId: 'd1',
  readAt: null, createdAt: '2026-08-18T10:00:00Z', ...o,
})

const render_ = () => render(<NotificationInbox />, { wrapper: MemoryRouter })

describe('NotificationInbox (ADR-0026, I5)', () => {
  beforeEach(() => {
    state.list = []
    state.count = 0
    state.markRead = vi.fn()
    state.markAll = vi.fn()
  })

  it('hides the badge with no unread and keeps the panel closed', () => {
    render_()
    expect(screen.queryByTestId('notif-badge')).not.toBeInTheDocument()
    expect(screen.queryByTestId('notif-panel')).not.toBeInTheDocument()
  })

  it('shows the unread count, capped at 9+', () => {
    state.count = 12
    render_()
    expect(screen.getByTestId('notif-badge')).toHaveTextContent('9+')
  })

  it('opens the panel and renders items with an entity deep-link', () => {
    state.count = 1
    state.list = [notif({ id: 'n1', type: 'signed_off', label: 'Hero KV', entityType: 'deliverable', entityId: 'd1' })]
    render_()
    fireEvent.click(screen.getByTestId('notif-bell'))
    const item = screen.getByTestId('notif-n1')
    expect(item).toHaveTextContent('Hero KV')
    expect(item).toHaveClass('is-unread')
    // I59.45: a deliverable's door is its campaign page; the bell looks the campaign up there.
    expect(item).toHaveAttribute('href', '/campaigns/piece/d1')
  })

  it('stamps each item with when it arrived, localized — not a raw UTC ISO slice', () => {
    state.count = 1
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-29T09:00:00Z')) // I66.8: a 2026 date shows no year
    state.list = [notif({ id: 'n1', createdAt: '2026-08-18T22:30:00Z' })]
    render_()
    fireEvent.click(screen.getByTestId('notif-bell'))
    const stamp = screen.getByTestId('notif-time-n1')
    expect(stamp).toHaveAttribute('datetime', '2026-08-18T22:30:00Z')
    // The old render printed the UTC calendar day and no time at all, so late-evening notices showed
    // tomorrow's date to anyone west of UTC and today's to anyone east of it.
    expect(stamp).not.toHaveTextContent('2026-08-18')
    // I66.8: in Iraq time, as every time reads — 22:30 UTC is 01:30 the next morning in Baghdad.
    expect(stamp).toHaveTextContent('Wed, 19 Aug, 01:30')
    vi.useRealTimers()
  })

  it('routes the assignee’s task notifications to the task’s own page (ADR-0105 d.3, I59.11)', () => {
    state.list = [
      notif({ id: 'n2', type: 'assigned', entityType: 'sub_task', entityId: 's1' }),
      notif({ id: 'n2b', type: 'changes_requested', entityType: 'sub_task', entityId: 's1' }),
      notif({ id: 'n2c', type: 'signed_off', entityType: 'sub_task', entityId: 's1' }),
      notif({ id: 'n2d', type: 'extension_refused', entityType: 'sub_task', entityId: 's1' }),
      notif({ id: 'n2e', type: 'dependency_ready', entityType: 'sub_task', entityId: 's1' }),
      // Sent to the OWNER because the task has nobody: still the task in its deliverable.
      notif({ id: 'n2f', type: 'dependency_ready', entityType: 'sub_task', entityId: 's1', detail: { unassigned: true } }),
      // Taken away: no longer theirs to open — My Work, as before.
      notif({ id: 'n2g', type: 'task_reassigned_away', entityType: 'sub_task', entityId: 's1' }),
    ]
    render_()
    fireEvent.click(screen.getByTestId('notif-bell'))
    for (const id of ['n2', 'n2b', 'n2c', 'n2d', 'n2e']) expect(screen.getByTestId(`notif-${id}`)).toHaveAttribute('href', '/my-work/task/s1')
    // I59.45: nobody has it, so the owner ASSIGNS it — on the Schedule, as the email says.
    expect(screen.getByTestId('notif-n2f')).toHaveAttribute('href', '/schedule')
    expect(screen.getByTestId('notif-n2g')).toHaveAttribute('href', '/my-work')
  })

  it('routes a review request to its review card on My Work (I52 Action 4, I59.45)', () => {
    state.list = [notif({ id: 'n3', type: 'review_requested', label: 'Hero KV', entityType: 'sub_task', entityId: 's3' })]
    render_()
    fireEvent.click(screen.getByTestId('notif-bell'))
    // I59.45: the review CARD in Needs you, named by task and kind.
    expect(screen.getByTestId('notif-n3')).toHaveAttribute('href', '/my-work?task=s3&kind=review')
  })

  it('marks an unread item read on click', () => {
    state.count = 1
    state.list = [notif({ id: 'n3', readAt: null })]
    render_()
    fireEvent.click(screen.getByTestId('notif-bell'))
    fireEvent.click(screen.getByTestId('notif-n3'))
    expect(state.markRead).toHaveBeenCalledWith('n3')
  })

  it('does not re-mark an already-read item', () => {
    state.list = [notif({ id: 'n4', readAt: '2026-08-18T09:00:00Z' })]
    render_()
    fireEvent.click(screen.getByTestId('notif-bell'))
    fireEvent.click(screen.getByTestId('notif-n4'))
    expect(state.markRead).not.toHaveBeenCalled()
  })

  it('shows the empty state when there is nothing', () => {
    render_()
    fireEvent.click(screen.getByTestId('notif-bell'))
    expect(screen.getByTestId('notif-empty')).toBeInTheDocument()
  })

  it('marks all read', () => {
    state.count = 3
    state.list = [notif({ id: 'n5' }), notif({ id: 'n6' })]
    render_()
    fireEvent.click(screen.getByTestId('notif-bell'))
    fireEvent.click(screen.getByTestId('notif-mark-all'))
    expect(state.markAll).toHaveBeenCalled()
  })

  // ADR-0042: being REQUIRED on a task is not being assigned it, so My Work (which lists work
  // assigned to you) would be a dead end. The booking is on the schedule; that is where it goes.
  it('sends a required-resource notice to the schedule, not My Work', () => {
    state.list = [notif({ id: 'n9', type: 'resource_required', label: 'Shoot day', entityType: 'sub_task', entityId: 's9' })]
    render_()
    fireEvent.click(screen.getByTestId('notif-bell'))
    expect(screen.getByTestId('notif-n9')).toHaveAttribute('href', '/schedule')
  })

  // I51.7: the account manager answers an extension on the task's row, inside its deliverable —
  // their My Work does not list somebody else's task, and until 16 Sep the link sent them there,
  // where they were refused and bounced to an empty schedule. The assignee's ANSWER stays on My Work.
  it('sends an extension request to its Needs you card, and the answer to the task page', () => {
    state.list = [
      notif({ id: 'n10', type: 'extension_requested', label: 'Retouch', entityType: 'sub_task', entityId: 's10' }),
      notif({ id: 'n11', type: 'extension_approved', label: 'Retouch', entityType: 'sub_task', entityId: 's10' }),
      notif({ id: 'n12', type: 'resource_clash', label: 'Studio A', entityType: 'sub_task', entityId: 's12' }),
      // I52.7 (option A): a reinstated task is assigned on the Schedule — the deliverables page cannot.
      notif({ id: 'n13', type: 'task_reinstated', label: 'Retouch', entityType: 'sub_task', entityId: 's13' }),
      // ADR-0109 d.2: the owner's forward is the account manager's copy of the ask — the same row.
      notif({ id: 'n14', type: 'extension_forwarded', label: 'Retouch', entityType: 'sub_task', entityId: 's14' }),
    ]
    render_()
    fireEvent.click(screen.getByTestId('notif-bell'))
    // I59.45: answered on its Needs you card (no `stage` here, so the account manager's step).
    expect(screen.getByTestId('notif-n10')).toHaveAttribute('href', '/my-work?task=s10&kind=extension_am')
    // The answer goes to the assignee's task page (I59.11), where the ask was made.
    expect(screen.getByTestId('notif-n11')).toHaveAttribute('href', '/my-work/task/s10')
    // I59.45: a clash is moved on the Schedule — the email always said so; the bell now agrees.
    expect(screen.getByTestId('notif-n12')).toHaveAttribute('href', '/schedule')
    expect(screen.getByTestId('notif-n13')).toHaveAttribute('href', '/schedule')
    expect(screen.getByTestId('notif-n14')).toHaveAttribute('href', '/my-work?task=s14&kind=extension_am')
  })
})
