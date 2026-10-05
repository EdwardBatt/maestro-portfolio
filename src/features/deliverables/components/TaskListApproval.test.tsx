import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../../lib/i18n'

// The api module reaches lib/supabase → lib/env, which throws where no VITE_* exists (traps.md).
const state = vi.hoisted(() => ({
  rules: [] as { kind: 'do' | 'dont'; text: string }[],
  approve: vi.fn(),
  reminder: null as string | null,
}))
vi.mock('../api/deliverables-api', () => ({
  useApproveDeliverableTasks: () => ({ mutate: state.approve, isPending: false }),
  useTaskListReminder: () => ({ data: state.reminder }),
  useTaskListRules: () => ({ data: state.rules ?? [] }),
}))

import { TaskListApproval } from './TaskListApproval'

const base = {
  deliverableId: 'd1',
  campaignId: 'cmp1',
  departmentId: 'dep1',
  ownerName: 'Fadia',
  approverName: null,
  onError: vi.fn(),
}

/**
 * ADR-0090 d.7: one added action where the list lives. The button, the stamp, the held label, and
 * the SJ-03 reminder — each in its own state, none of them decided here (d.4 is the RPC's).
 */
describe('TaskListApproval', () => {
  beforeEach(() => {
    state.approve = vi.fn()
    state.reminder = null
  })

  it('offers Approve task list to somebody who may, and the press names the deliverable', () => {
    render(<TaskListApproval {...base} tasksApprovedAt={null} canApprove />)
    fireEvent.click(screen.getByTestId('task-list-approve'))
    expect(state.approve).toHaveBeenCalledWith('d1', expect.anything())
  })

  it('names the owner for somebody who may not', () => {
    render(<TaskListApproval {...base} tasksApprovedAt={null} canApprove={false} />)
    expect(screen.queryByTestId('task-list-approve')).toBeNull()
    expect(screen.getByTestId('task-list-held')).toHaveTextContent("awaiting the owner's review — Fadia")
  })

  it('says there is no owner yet when there is none', () => {
    render(<TaskListApproval {...base} ownerName={null} tasksApprovedAt={null} canApprove={false} />)
    expect(screen.getByTestId('task-list-held')).toHaveTextContent(/no owner yet/i)
  })

  it('shows the stamp once approved, with the approver where known', () => {
    render(<TaskListApproval {...base} tasksApprovedAt="2026-09-11T09:00:00Z" approverName="Fadia" canApprove />)
    expect(screen.getByTestId('task-list-approved')).toHaveTextContent(/approved by Fadia/i)
    expect(screen.queryByTestId('task-list-approve')).toBeNull()
  })

  // ADR-0084 d.8 / ADR-0090 d.7: the reminder is a prompt for the owner, gone once the list is approved.
  it('shows the SJ-03 reminder until approved, and only the person who may approve can dismiss it', () => {
    state.reminder = 'waiting on the client logo'
    const { rerender } = render(<TaskListApproval {...base} tasksApprovedAt={null} canApprove={false} />)
    expect(screen.getByTestId('task-list-risk')).toHaveTextContent('waiting on the client logo')
    expect(screen.queryByTestId('task-list-risk-dismiss')).toBeNull()
    rerender(<TaskListApproval {...base} tasksApprovedAt="2026-09-11T09:00:00Z" canApprove />)
    expect(screen.queryByTestId('task-list-risk')).toBeNull()
  })

  it('reports a refused approval rather than swallowing it', () => {
    state.approve = vi.fn((_id: string, opts?: { onError?: () => void }) => opts?.onError?.())
    const onError = vi.fn()
    render(<TaskListApproval {...base} onError={onError} tasksApprovedAt={null} canApprove />)
    fireEvent.click(screen.getByTestId('task-list-approve'))
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/could not be approved/i))
  })
})

describe('TaskListApproval — the rules the job carries (SJ-v3, 22 Sep)', () => {
  it('shows the snapshotted dos and don’ts, locked, beside the list', () => {
    state.rules = [{ kind: 'do', text: 'Arabic leads.' }, { kind: 'dont', text: 'Never “lottery”.' }]
    render(<TaskListApproval deliverableId="d1" campaignId="c1" departmentId="dep1" ownerName="Fadia" tasksApprovedAt={null} approverName={null} canApprove={false} onError={() => {}} />)
    expect(screen.getByTestId('task-list-rules')).toHaveTextContent('Rules it carries')
    expect(screen.getByTestId('task-list-rules')).toHaveTextContent('Arabic leads.')
    expect(screen.getByTestId('task-list-rules')).toHaveTextContent('Never “lottery”.')
    state.rules = []
  })
})
