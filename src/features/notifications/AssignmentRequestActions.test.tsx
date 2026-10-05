import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../lib/i18n'
import type { AssignmentRequest } from '../../lib/assignment-requests/requests'

/**
 * ADR-0087 d.11, ADR-0139 — the bell's answer to an ask opens the Schedule's answer window (Book / Offer
 * another day / Say no), the same door My work's card uses; one-click Approve / Refuse is gone, because an
 * ask can name nobody and a no needs its reason. Once the ask is no longer pending the line says so.
 */

const state = vi.hoisted(() => ({
  request: null as AssignmentRequest | null,
  navigate: vi.fn(),
}))

vi.mock('../../lib/assignment-requests/api', () => ({
  usePendingAssignmentRequest: () => ({ data: state.request, isLoading: false }),
}))
vi.mock('react-router', () => ({ useNavigate: () => state.navigate }))

import { AssignmentRequestActions } from './AssignmentRequestActions'

const pending: AssignmentRequest = {
  id: 'q1', subTaskId: 'st9', resourceId: 'r1', resourceName: 'Sam', assigneeId: 'u1',
  requestedBy: 'u-creative-lead', requesterName: 'Creative Lead', requestedAt: '2026-09-01T00:00:00Z',
  title: 'Studio day', startsAt: null, dueAt: null, hours: null,
  status: 'pending', decidedBy: null, decidedAt: null, reason: null,
  departmentName: 'Production', taskTitle: 'Studio day', campaignName: null,
}

beforeEach(() => {
  state.request = pending
  state.navigate.mockReset()
})

describe('AssignmentRequestActions', () => {
  it('names who asked and offers one Answer — no one-click Approve or Refuse', () => {
    render(<AssignmentRequestActions subTaskId="st9" />)
    expect(screen.getByTestId('notif-request-actions-st9').textContent).toContain('Creative Lead')
    expect(screen.getByTestId('notif-request-answer-st9')).toBeInTheDocument()
    expect(screen.queryByTestId('notif-request-approve-st9')).toBeNull()
    expect(screen.queryByTestId('notif-request-refuse-st9')).toBeNull()
  })

  it('opens the Schedule answer window for this ask and closes the bell', () => {
    const onOpen = vi.fn()
    render(<AssignmentRequestActions subTaskId="st9" onOpen={onOpen} />)
    fireEvent.click(screen.getByTestId('notif-request-answer-st9'))
    expect(onOpen).toHaveBeenCalled()
    expect(state.navigate).toHaveBeenCalledWith('/schedule?ask=q1')
  })

  it('says the request is closed when nothing is pending any more — the other lead may have answered first', () => {
    state.request = null
    render(<AssignmentRequestActions subTaskId="st9" />)
    expect(screen.getByTestId('notif-request-closed-st9')).toBeInTheDocument()
    expect(screen.queryByTestId('notif-request-answer-st9')).toBeNull()
  })
})
