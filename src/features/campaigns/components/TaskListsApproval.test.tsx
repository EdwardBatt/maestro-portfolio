import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../../lib/i18n'

const approveMutate = vi.hoisted(() => vi.fn())
vi.mock('../../deliverables/api/deliverables-api', () => ({
  useApproveDeliverableTasks: () => ({ mutate: approveMutate, isPending: false }),
}))

// ADR-0140 (I74.12): the owner edits the list with the piece's own task list (its own suite: PieceTasks.test.tsx).
vi.mock('./PieceTasks', () => ({ PieceTasks: (p: { deliverableId: string; testId?: string }) => <div data-testid={p.testId} data-embedded /> }))

import { TaskListsApproval, type ApprovableDeliverable } from './TaskListsApproval'

/**
 * ADR-0100 d.2/d.9 — the second gate, on the department's tab.
 *
 * What is worth holding here is not that the buttons exist. It is the two things this panel
 * replaced a simpler one to do:
 *
 *  - **Partial acceptance is a real state.** The old control released a whole department in one
 *    press; this one can leave some work held, and the screen has to say which and whose.
 *  - **A tick the server would refuse is never offered.** `canApprove` is the caller's reading of
 *    ADR-0090 d.4, and offering somebody a button that fails is the dead end this codebase keeps
 *    writing down.
 */
const row = (over: Partial<ApprovableDeliverable> & { id: string }): ApprovableDeliverable => ({
  name: over.id,
  tasksApprovedAt: null,
  ownerName: 'Dev Dept Lead',
  taskCount: 3,
  canApprove: true,
  isMine: true,
  ...over,
})

describe('TaskListsApproval (ADR-0100 d.2/d.9)', () => {
  beforeEach(() => approveMutate.mockReset())

  it('accepts one task list on its own row', () => {
    render(<TaskListsApproval deliverables={[row({ id: 'd1' })]} testId="tl" />)
    fireEvent.click(screen.getByTestId('tl-approve-d1'))
    expect(approveMutate).toHaveBeenCalledTimes(1)
    expect(approveMutate.mock.calls[0][0]).toBe('d1')
  })

  it('accepts all of the ones this person can answer, and none of the others', () => {
    // Edward, 23 Sep: one or two people per department review everything on one page and
    // "approve all or selected ones". All means all of THEIRS.
    render(
      <TaskListsApproval
        deliverables={[
          row({ id: 'mine-1' }),
          row({ id: 'someone-elses', canApprove: false, ownerName: 'Dev Content Lead' }),
          row({ id: 'mine-2' }),
        ]}
        testId="tl"
      />,
    )
    fireEvent.click(screen.getByTestId('tl-approve-all'))
    expect(approveMutate.mock.calls.map((c) => c[0]).sort()).toEqual(['mine-1', 'mine-2'])
  })

  it('"Approve all mine" leaves a colleague list she may approve but does not own; a tick takes it (Edward, 5 Oct, A)', () => {
    render(
      <TaskListsApproval
        deliverables={[
          row({ id: 'mine-1' }),
          row({ id: 'colleagues', isMine: false, canApprove: true, ownerName: 'Dev Dept Lead' }),
        ]}
        testId="tl"
      />,
    )
    expect(screen.getByTestId('tl-approve-all')).toHaveTextContent('1')
    fireEvent.click(screen.getByTestId('tl-approve-all'))
    expect(approveMutate.mock.calls.map((c) => c[0])).toEqual(['mine-1'])
    approveMutate.mockClear()
    fireEvent.click(screen.getByTestId('tl-pick-colleagues'))
    fireEvent.click(screen.getByTestId('tl-approve-picked'))
    expect(approveMutate.mock.calls.map((c) => c[0])).toEqual(['colleagues'])
  })

  it('accepts only what was ticked', () => {
    render(
      <TaskListsApproval deliverables={[row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })]} testId="tl" />,
    )
    fireEvent.click(screen.getByTestId('tl-pick-b'))
    fireEvent.click(screen.getByTestId('tl-approve-picked'))
    expect(approveMutate.mock.calls.map((c) => c[0])).toEqual(['b'])
  })

  it('offers nothing to somebody who cannot answer, and names who can', () => {
    render(
      <TaskListsApproval
        deliverables={[row({ id: 'd1', canApprove: false, ownerName: 'Dev Content Lead' })]}
        testId="tl"
      />,
    )
    expect(screen.queryByTestId('tl-approve-d1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('tl-approve-all')).not.toBeInTheDocument()
    expect(screen.getByTestId('tl-not-yours-d1')).toHaveTextContent('Dev Content Lead')
  })

  it('says a partly-accepted department is partly accepted', () => {
    // The state that did not exist before: some work assignable, some not. "Why can nobody be
    // booked onto this one?" has to be answerable without opening anything.
    render(
      <TaskListsApproval
        deliverables={[row({ id: 'done', tasksApprovedAt: '2026-09-23T15:00:00Z' }), row({ id: 'held' })]}
        testId="tl"
      />,
    )
    expect(screen.getByTestId('tl-waiting')).toHaveTextContent('1')
    expect(screen.getByTestId('tl-accepted-done')).toBeInTheDocument()
    expect(screen.getByTestId('tl-approve-held')).toBeInTheDocument()
    expect(screen.queryByTestId('tl-approve-done')).not.toBeInTheDocument()
  })

  it('says so when everything has been accepted', () => {
    render(
      <TaskListsApproval
        deliverables={[row({ id: 'd1', tasksApprovedAt: '2026-09-23T15:00:00Z' })]}
        testId="tl"
      />,
    )
    expect(screen.getByTestId('tl-all-done')).toBeInTheDocument()
    expect(screen.queryByTestId('tl-approve-all')).not.toBeInTheDocument()
  })

  it('does not offer to accept a list with no tasks in it', () => {
    // Nothing to read means nothing to accept. A button here would be pressed and wondered about.
    render(<TaskListsApproval deliverables={[row({ id: 'd1', taskCount: 0 })]} testId="tl" />)
    expect(screen.getByTestId('tl-empty-d1')).toBeInTheDocument()
    expect(screen.queryByTestId('tl-approve-d1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('tl-approve-all')).not.toBeInTheDocument()
  })

  it('renders nothing at all for a department with no work', () => {
    const { container } = render(<TaskListsApproval deliverables={[]} testId="tl" />)
    expect(container).toBeEmptyDOMElement()
  })

  // Edward, 24 Sep: "needs to follow the same style as the UI we are implementing" — the work
  // step's groups, and the list itself one press away, since that is what is being agreed to.
  it('groups the rows by workstream, as The work does, with the loose ones last', () => {
    render(
      <TaskListsApproval
        deliverables={[
          row({ id: 'a', code: 'DA-001', name: 'Key visual', workstreamId: 'w1' }),
          row({ id: 'b', name: 'Loose caption', workstreamId: null }),
        ]}
        groups={[{ id: 'w1', name: 'Design & Animation', departmentName: 'Creative' }, { id: 'w2', name: 'Empty', departmentName: 'Content' }]}
        testId="tl"
      />,
    )
    expect(screen.getByTestId('tl-group-w1')).toHaveTextContent('Design & Animation')
    expect(screen.getByTestId('tl-group-w1')).toHaveTextContent('DA-001 · Key visual')
    // A group with nothing of this department's in it is not drawn.
    expect(screen.queryByTestId('tl-group-w2')).not.toBeInTheDocument()
    expect(screen.getByTestId('tl-group-__ungrouped__')).toHaveTextContent('Not in a workstream')
  })

  it('draws one list with no group headers when the campaign has no workstreams', () => {
    render(<TaskListsApproval deliverables={[row({ id: 'a' })]} testId="tl" />)
    expect(screen.getByTestId('tl-group-__all__')).not.toHaveTextContent('Not in a workstream')
  })

  it('opens the task list itself, in its order, with each task’s hours', () => {
    render(
      <TaskListsApproval
        deliverables={[row({ id: 'a', taskCount: 2, tasks: [{ id: 't1', title: 'Write copy', hours: 3 }, { id: 't2', title: 'Design', hours: null }] })]}
        testId="tl"
      />,
    )
    expect(screen.queryByTestId('tl-tasks-a')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('tl-toggle-a'))
    const list = screen.getByTestId('tl-tasks-a')
    expect(list).toHaveTextContent('Write copy')
    expect(list).toHaveTextContent('3 h')
    expect(list.querySelectorAll('li')).toHaveLength(2)
    expect(screen.getByTestId('tl-toggle-a')).toHaveAttribute('aria-expanded', 'true')
  })

  it('offers no tick on a row this person cannot approve', () => {
    render(<TaskListsApproval deliverables={[row({ id: 'x', canApprove: false })]} testId="tl" />)
    expect(screen.queryByTestId('tl-pick-x')).not.toBeInTheDocument()
  })
})
