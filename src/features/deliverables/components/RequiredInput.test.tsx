// ADR-0069 (I36.4) — one column, both kinds, and never a gate.
//
// The assertions that matter are about what this does NOT do. It shows what a task is waiting for
// and it disables nothing: ADR-0030 §1b removed `blocked` because a blocked flag becomes the reason
// work did not happen, and Edward reaffirmed that on 3 Sep. So there is no disabled state to test
// for — there is the absence of one, and the presence of a clear statement instead.
//
// The other half is the picker: it must read the LIVE task list. A picker fed from workflow steps
// would offer steps that no longer exist on a deliverable somebody has edited, which is every real
// deliverable.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../../lib/i18n'

const addMutate = vi.hoisted(() => vi.fn())
const removeMutate = vi.hoisted(() => vi.fn())
vi.mock('../api/requirements-api', () => ({
  useAddDependency: () => ({ mutate: addMutate, isPending: false }),
  useRemoveDependency: () => ({ mutate: removeMutate, isPending: false }),
  isCyclicDependency: (e: unknown) => (e as { code?: string } | null)?.code === '22023',
}))

import { RequiredInput } from './RequiredInput'
import type { RequirementCandidate, TaskDependency } from '../api/requirements-api'

const dep = (over: Partial<TaskDependency> = {}): TaskDependency => ({
  id: 'dep1',
  subTaskId: 'task-b',
  prerequisiteId: 'task-a',
  prerequisiteTitle: 'Storyboard',
  prerequisiteStatus: 'review',
  prerequisiteDeliverable: 'Key Visual',
  met: false,
  ...over,
})

const CANDIDATES: RequirementCandidate[] = [
  { id: 'task-a', title: 'Storyboard', deliverableName: 'Key Visual', sameDeliverable: false },
  { id: 'task-c', title: 'Script', deliverableName: 'B2B Animation', sameDeliverable: true },
  { id: 'task-b', title: 'Animation', deliverableName: 'B2B Animation', sameDeliverable: true },
]

function renderCell(props: Partial<Parameters<typeof RequiredInput>[0]> = {}) {
  return render(
    <RequiredInput
      subTaskId="task-b"
      deliverableId="d1"
      dependencies={[]}
      candidates={CANDIDATES}
      externalInputs={[]}
      canManage
      {...props}
    />,
  )
}

describe('RequiredInput (ADR-0069)', () => {
  beforeEach(() => {
    addMutate.mockReset()
    removeMutate.mockReset()
  })

  it('says plainly when a task is waiting on nothing', () => {
    renderCell()
    expect(screen.getByTestId('required-input-none-task-b')).toBeInTheDocument()
  })

  it('shows an unmet requirement, and names whose work it is', () => {
    renderCell({ dependencies: [dep()] })
    const row = screen.getByTestId('requirement-dep1')
    expect(row).toHaveTextContent('Storyboard')
    // The cross-deliverable case is the one worth surfacing rather than hiding.
    expect(row).toHaveTextContent('Key Visual')
  })

  it('a prerequisite in REVIEW is still shown as waiting (d.2)', () => {
    // Submitted is not approved. This is the whole amendment to ADR-0030 §1b.
    renderCell({ dependencies: [dep({ prerequisiteStatus: 'review', met: false })] })
    expect(screen.getByTestId('requirement-dep1').querySelector('.requirement-waiting')).not.toBeNull()
  })

  it('an approved prerequisite reads as met', () => {
    renderCell({ dependencies: [dep({ prerequisiteStatus: 'done', met: true })] })
    expect(screen.getByTestId('requirement-dep1').querySelector('.requirement-met')).not.toBeNull()
  })

  it('shows the deliverable\'s external inputs in the SAME column (d.6)', () => {
    renderCell({ externalInputs: ['Acme logo pack'] })
    const row = screen.getByTestId('requirement-external-task-b')
    expect(row).toHaveTextContent('Acme logo pack')
    expect(row).toHaveTextContent('from outside')
  })

  it('offers the live task list, never the task itself, never a duplicate', () => {
    renderCell({ dependencies: [dep()] })
    fireEvent.click(screen.getByTestId('requirement-add-task-b'))
    const options = Array.from(
      screen.getByTestId('requirement-picker-task-b').querySelectorAll('option'),
    ).map((o) => (o as HTMLOptionElement).value)

    expect(options).toContain('task-c')
    // Already a requirement, so offering it again would only hit the unique constraint.
    expect(options).not.toContain('task-a')
    // A task cannot wait on itself.
    expect(options).not.toContain('task-b')
  })

  it('groups this deliverable\'s own tasks under their own heading', () => {
    // The regression Edward found on the 60-second hero film: the picker offered every OTHER
    // deliverable's tasks and none of its own. Grouping makes an empty own-group visible instead
    // of leaving the reader to infer it from which options lack a prefix.
    renderCell()
    fireEvent.click(screen.getByTestId('requirement-add-task-b'))
    const own = screen.getByTestId('requirement-group-own-task-b')
    expect(own).toHaveAttribute('label', 'This deliverable')
    expect(own).toHaveTextContent('Script')

    // And the other deliverable gets a group named after it.
    const groups = Array.from(
      screen.getByTestId('requirement-picker-task-b').querySelectorAll('optgroup'),
    ).map((g) => g.getAttribute('label'))
    expect(groups).toContain('Key Visual')
  })

  it('adds the picked requirement', () => {
    renderCell()
    fireEvent.click(screen.getByTestId('requirement-add-task-b'))
    fireEvent.change(screen.getByTestId('requirement-picker-task-b'), { target: { value: 'task-c' } })
    expect(addMutate).toHaveBeenCalledWith(
      { subTaskId: 'task-b', prerequisiteId: 'task-c' },
      expect.anything(),
    )
  })

  it('explains a circular pick as a sentence, not a trigger name', () => {
    addMutate.mockImplementation((_a, opts) =>
      opts?.onError?.(Object.assign(new Error('cycle'), { code: '22023' })),
    )
    renderCell()
    fireEvent.click(screen.getByTestId('requirement-add-task-b'))
    fireEvent.change(screen.getByTestId('requirement-picker-task-b'), { target: { value: 'task-c' } })
    expect(screen.getByTestId('requirement-error-task-b')).toHaveTextContent('wait on each other')
  })

  it('is read-only without the grant, and still readable', () => {
    renderCell({ dependencies: [dep()], canManage: false })
    expect(screen.getByTestId('requirement-dep1')).toHaveTextContent('Storyboard')
    expect(screen.queryByTestId('requirement-add-task-b')).not.toBeInTheDocument()
    expect(screen.queryByTestId('requirement-remove-dep1')).not.toBeInTheDocument()
  })

  it('removes a requirement', () => {
    renderCell({ dependencies: [dep()] })
    fireEvent.click(screen.getByTestId('requirement-remove-dep1'))
    expect(removeMutate).toHaveBeenCalledWith('dep1')
  })

  it('renders no control that could stop the work — dependencies are SOFT (d.3)', () => {
    const { container } = renderCell({
      dependencies: [dep()],
      externalInputs: ['Acme logo pack'],
    })
    // Nothing here disables anything: the only disabled control would be one this cell owns, and
    // it owns none. ADR-0030 removed `blocked` because a blocked flag becomes the excuse.
    expect(container.querySelectorAll('button[disabled]')).toHaveLength(0)
  })
})
