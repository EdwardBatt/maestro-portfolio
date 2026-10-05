import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../../lib/i18n'
import { ReopenDialog } from './ReopenDialog'

/**
 * ADR-0103 d.2/d.3, ADR-0142 — the re-open dialog's contract. The database decides who may and refuses the
 * rest; what the dialog must never do is send a re-open with no task, no kind, no reason or no new date.
 */
const mutate = vi.fn()
vi.mock('../api/reopen-api', () => ({
  useFinishedTasks: () => ({
    isLoading: false,
    data: [
      { id: 't1', title: 'Create Artwork 1', assigneeId: 'maker', assigneeName: 'Dev Maker', approvedAt: '2026-09-20T12:00:00Z', hours: 4, hasReviewer: true },
      { id: 't2', title: 'Resize', assigneeId: 'maker', assigneeName: 'Dev Maker', approvedAt: '2026-09-21T12:00:00Z', hours: 1, hasReviewer: true },
      { id: 't3', title: 'Brunos post 7', assigneeId: 'maker', assigneeName: 'Dev Maker', approvedAt: '2026-09-22T12:00:00Z', hours: 2, hasReviewer: false },
    ],
  }),
  useReopenDeliverable: () => ({ mutate, isPending: false }),
}))
vi.mock('../api/deliverables-api', () => ({
  useAssignableUsers: () => ({
    data: [
      { id: 'maker', name: 'Dev Maker', departmentId: null, teamId: null },
      { id: 'other', name: 'Other Person', departmentId: null, teamId: null },
    ],
  }),
  useReviewers: () => ({ data: [{ id: 'maker', name: 'Dev Maker' }, { id: 'lead', name: 'Dev Lead' }, { id: 'tl', name: 'Dev Team Lead' }] }),
}))

function view(over: Partial<React.ComponentProps<typeof ReopenDialog>> = {}) {
  const props = {
    deliverableId: 'd1',
    deliverableName: 'Digital Banner',
    onDone: vi.fn(),
    onFailed: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
  render(<ReopenDialog {...props} />)
  return props
}
const later = () => {
  const d = new Date(Date.now() + 5 * 86_400_000)
  return d.toISOString().slice(0, 10)
}

describe('ReopenDialog (ADR-0103)', () => {
  beforeEach(() => mutate.mockReset())

  it('offers the approved tasks, none ticked, and will not send until a task, a reason and a date are given', () => {
    view()
    const submit = screen.getByTestId('reopen-dialog-submit') as HTMLButtonElement
    expect((screen.getByTestId('reopen-dialog-task-t1') as HTMLInputElement).checked).toBe(false)
    expect(submit.disabled).toBe(true)

    fireEvent.click(screen.getByTestId('reopen-dialog-task-t1'))
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByTestId('reopen-dialog-reason'), { target: { value: 'The client changed the headline.' } })
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByTestId('reopen-dialog-due'), { target: { value: later() } })
    // ADR-0142 d.1: why — a client amendment or our own fix — is asked, never assumed.
    expect(submit.disabled).toBe(true)
    fireEvent.click(screen.getByTestId('reopen-dialog-kind-client_amendment'))
    expect(submit.disabled).toBe(false)

    fireEvent.click(submit)
    expect(mutate).toHaveBeenCalledWith(
      { deliverableId: 'd1', taskIds: ['t1'], reason: 'The client changed the headline.', dueDay: later(), kind: 'client_amendment' },
      expect.anything(),
    )
  })

  it('ADR-0142 d.2: one task goes back to its maker unless the lead gives it to someone else; the hours ride along', () => {
    view({ taskId: 't1' })
    fireEvent.click(screen.getByTestId('reopen-dialog-kind-own_fix'))
    fireEvent.change(screen.getByTestId('reopen-dialog-reason'), { target: { value: 'Typo' } })
    fireEvent.change(screen.getByTestId('reopen-dialog-due'), { target: { value: later() } })
    fireEvent.change(screen.getByTestId('reopen-dialog-hours'), { target: { value: '2' } })
    fireEvent.click(screen.getByTestId('reopen-dialog-submit'))
    expect(mutate).toHaveBeenLastCalledWith(
      { deliverableId: 'd1', taskIds: ['t1'], reason: 'Typo', dueDay: later(), kind: 'own_fix', hours: 2 },
      expect.anything(),
    )
  })

  it('with several tasks ticked, each goes back to its own maker — no single Who is offered', () => {
    view({ taskId: 't1' })
    expect(screen.getByTestId('reopen-dialog-who')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('reopen-dialog-task-t2'))
    expect(screen.queryByTestId('reopen-dialog-who')).toBeNull()
    expect(screen.getByTestId('reopen-dialog-makers')).toBeInTheDocument()
  })

  it('an hours of nothing is refused on the field', () => {
    view({ taskId: 't1' })
    fireEvent.click(screen.getByTestId('reopen-dialog-kind-own_fix'))
    fireEvent.change(screen.getByTestId('reopen-dialog-reason'), { target: { value: 'Typo' } })
    fireEvent.change(screen.getByTestId('reopen-dialog-due'), { target: { value: later() } })
    fireEvent.change(screen.getByTestId('reopen-dialog-hours'), { target: { value: '0' } })
    expect((screen.getByTestId('reopen-dialog-submit') as HTMLButtonElement).disabled).toBe(true)
  })

  it('from a task\'s own row, that task arrives ticked', () => {
    view({ taskId: 't2' })
    expect((screen.getByTestId('reopen-dialog-task-t2') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByTestId('reopen-dialog-task-t1') as HTMLInputElement).checked).toBe(false)
  })

  it('a reason of spaces is no reason', () => {
    view({ taskId: 't1' })
    fireEvent.change(screen.getByTestId('reopen-dialog-reason'), { target: { value: '   ' } })
    fireEvent.change(screen.getByTestId('reopen-dialog-due'), { target: { value: later() } })
    expect((screen.getByTestId('reopen-dialog-submit') as HTMLButtonElement).disabled).toBe(true)
  })

  it('a day in the past is refused on the field', () => {
    view({ taskId: 't1' })
    fireEvent.change(screen.getByTestId('reopen-dialog-reason'), { target: { value: 'change' } })
    fireEvent.change(screen.getByTestId('reopen-dialog-due'), { target: { value: '2020-01-01' } })
    expect((screen.getByTestId('reopen-dialog-submit') as HTMLButtonElement).disabled).toBe(true)
  })

  it('a task nobody reviews asks for its reviewers — the first required, the maker never offered — and sends them', () => {
    view({ taskId: 't3' })
    fireEvent.click(screen.getByTestId('reopen-dialog-kind-client_amendment'))
    fireEvent.change(screen.getByTestId('reopen-dialog-reason'), { target: { value: 'New logo' } })
    fireEvent.change(screen.getByTestId('reopen-dialog-due'), { target: { value: later() } })
    const submit = screen.getByTestId('reopen-dialog-submit') as HTMLButtonElement
    expect(screen.getByTestId('reopen-dialog-reviewers-t3')).toBeInTheDocument()
    expect(submit.disabled).toBe(true)
    const add = screen.getByTestId('reopen-dialog-reviewers-t3-add') as HTMLSelectElement
    expect([...add.options].map((o) => o.value)).not.toContain('maker')
    fireEvent.change(add, { target: { value: 'lead' } })
    fireEvent.change(add, { target: { value: 'tl' } })
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    expect(mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        taskIds: ['t3'],
        reviewers: { t3: [{ userId: 'lead', isMandatory: true }, { userId: 'tl', isMandatory: false }] },
      }),
      expect.anything(),
    )
  })

  it('a task that has reviewers keeps them — no picker, nothing sent', () => {
    view({ taskId: 't1' })
    expect(screen.queryByTestId('reopen-dialog-reviewers-t1')).toBeNull()
  })
})
