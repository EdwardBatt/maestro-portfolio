import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../../lib/i18n'
import { TaskRowControls } from './TaskRowControls'

/**
 * I74 fix-up: the task page's manager area keeps the row's status changes, cancel/reinstate and the
 * Required input cell beside the one task editor — the same controls and test ids the row had.
 */
const state = vi.hoisted(() => ({ status: 'in_progress' as string }))
const cancel = vi.fn()
const requestChanges = vi.fn()
const impact = vi.fn(async () => ({ bookings: 2, isPlan: false, isAdhoc: false }))

vi.mock('../api/deliverables-api', () => ({
  useDeliverable: () => ({
    data: {
      id: 'd1', name: 'Digital Banner',
      subTasks: [{ id: 't1', title: 'Create Artwork', status: state.status, assigneeName: 'Dev Maker', dueAt: null, reviewers: [] }],
    },
  }),
  useAssignableUsers: () => ({ data: [] }),
  useReviewers: () => ({ data: [] }),
  useCancelSubTask: () => ({ mutate: cancel, isPending: false }),
  useRemoveSubTask: () => ({ mutate: vi.fn(), isPending: false }),
  useRequestChangesSubTask: () => ({ mutate: requestChanges, isPending: false }),
  fetchCancelImpact: () => impact(),
}))
vi.mock('../api/requirements-api', () => ({
  useTaskDependencies: () => ({ data: [] }),
  useRequirementCandidates: () => ({ data: [] }),
  usePendingInputs: () => ({ data: [{ description: 'Logo from the client', satisfiedAt: null }] }),
}))
vi.mock('./RequiredInput', () => ({
  RequiredInput: (p: { subTaskId: string; canManage: boolean; externalInputs: string[] }) => (
    <div data-testid={`required-input-${p.subTaskId}`} data-manage={String(p.canManage)} data-inputs={p.externalInputs.join('|')} />
  ),
}))
vi.mock('./ReinstateDialog', () => ({ ReinstateDialog: () => <div data-testid="reinstate-dialog" /> }))
vi.mock('./ReopenDialog', () => ({ ReopenDialog: () => <div data-testid="reopen-dialog" /> }))

const view = (canReview = false) => render(<TaskRowControls deliverableId="d1" taskId="t1" canReview={canReview} onBanner={vi.fn()} />)

describe('the task row controls beside the editor', () => {
  beforeEach(() => {
    state.status = 'in_progress'
    cancel.mockReset()
    requestChanges.mockReset()
  })

  it('shows the status and the Required input a manager can add to, outside inputs included', () => {
    view()
    expect(screen.getByTestId('subtask-status-t1')).toBeInTheDocument()
    expect(screen.getByTestId('required-input-t1')).toHaveAttribute('data-manage', 'true')
    expect(screen.getByTestId('required-input-t1')).toHaveAttribute('data-inputs', 'Logo from the client')
  })

  it('cancels only after the dialog says what it costs', async () => {
    view()
    fireEvent.click(screen.getByTestId('subtask-cancel-t1'))
    await waitFor(() => expect(screen.getByTestId('subtask-cancel-confirm-dialog')).toBeInTheDocument())
    expect(cancel).not.toHaveBeenCalled()
  })

  it('offers Reinstate, not Cancel, on a cancelled task', () => {
    state.status = 'cancelled'
    view()
    expect(screen.queryByTestId('subtask-cancel-t1')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('subtask-reinstate-t1'))
    expect(screen.getByTestId('reinstate-dialog')).toBeInTheDocument()
  })

  it('re-opens a finished task through the re-open dialog', () => {
    state.status = 'done'
    view()
    fireEvent.click(screen.getByTestId('subtask-reopen-t1'))
    expect(screen.getByTestId('reopen-dialog')).toBeInTheDocument()
  })

  it('asks for changes on a task in review only for a reviewer', () => {
    state.status = 'review'
    const { unmount } = view(false)
    expect(screen.queryByTestId('subtask-request-changes-t1')).not.toBeInTheDocument()
    unmount()
    view(true)
    fireEvent.click(screen.getByTestId('subtask-request-changes-t1'))
    expect(requestChanges).toHaveBeenCalledWith('t1', expect.anything())
  })
})
