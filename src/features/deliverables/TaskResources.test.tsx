import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../lib/i18n'
import type { RequirementReport, TaskResourceRow } from './api/task-resources-api'

/**
 * TaskResources (ADR-0042 d.7) — the one editor behind both surfaces.
 *
 * The api module reaches lib/env (which throws in CI), so it is mocked. What is worth testing here
 * is the behaviour that carries the ADR: a clash must be SAID OUT LOUD rather than swallowed, an
 * already-required resource must not be offerable twice, and a viewer who cannot manage the task
 * must not be shown controls the server would refuse.
 */

const state = vi.hoisted(() => ({
  rows: [] as TaskResourceRow[],
  addMutate: vi.fn(),
  removeMutate: vi.fn(),
  resources: [
    { id: 'r-cam', name: 'RED Camera', kind: 'equipment' as const },
    { id: 'r-suite', name: 'Edit Suite 1', kind: 'room' as const },
  ],
}))

vi.mock('./api/task-resources-api', () => ({
  useTaskResources: () => ({ data: state.rows, isLoading: false, isError: false }),
  useBookableResources: () => ({ data: state.resources, isLoading: false }),
  useAddTaskResource: () => ({ mutate: state.addMutate, isPending: false }),
  useRemoveTaskResource: () => ({ mutate: state.removeMutate, isPending: false }),
}))

vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({ claims: { tenantId: 't1' }, session: null, ready: true }),
}))

const { TaskResources, StagedTaskResources } = await import('./TaskResources')

const clean: RequirementReport = { placed: 2, contested: [], overCapacity: [], unplaced: [] }

beforeEach(() => {
  state.rows = []
  state.addMutate.mockReset()
  state.removeMutate.mockReset()
})

describe('TaskResources — what a task needs', () => {
  it('says so plainly when a task needs nothing', () => {
    render(<TaskResources subTaskId="st1" canManage />)
    expect(screen.getByText(/no resources required/i)).toBeTruthy()
  })

  it('lists a requirement in HOURS, not days', () => {
    state.rows = [
      { id: 'q1', resourceId: 'r-cam', resourceName: 'RED Camera', resourceKind: 'equipment', hours: 3, startsOn: null, notes: null },
    ]
    render(<TaskResources subTaskId="st1" canManage />)
    expect(screen.getByTestId('task-resource-q1').textContent).toContain('3h')
    // A null starts_on is not blank — it means "the task's first day", and the row should say so.
    expect(screen.getByTestId('task-resource-q1').textContent).toMatch(/first day/i)
  })

  // ADR-0042 d.1: every resource has its own id, so two cameras means two camera rows — but the
  // SAME camera twice is a unique-constraint violation waiting to happen.
  it('does not offer a resource the task already requires', () => {
    state.rows = [
      { id: 'q1', resourceId: 'r-cam', resourceName: 'RED Camera', resourceKind: 'equipment', hours: 3, startsOn: null, notes: null },
    ]
    render(<TaskResources subTaskId="st1" canManage />)
    const options = Array.from(screen.getByTestId('task-resource-picker').querySelectorAll('option'))
    expect(options.some((o) => o.textContent?.includes('RED Camera'))).toBe(false)
    expect(options.some((o) => o.textContent?.includes('Edit Suite 1'))).toBe(true)
  })

  it('will not submit without both a resource and hours', () => {
    render(<TaskResources subTaskId="st1" canManage />)
    const submit = screen.getByTestId('task-resource-add-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    fireEvent.change(screen.getByTestId('task-resource-picker'), { target: { value: 'r-cam' } })
    expect((screen.getByTestId('task-resource-add-submit') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByTestId('task-resource-hours'), { target: { value: '3' } })
    expect((screen.getByTestId('task-resource-add-submit') as HTMLButtonElement).disabled).toBe(false)
  })

  it('sends hours as a number and an empty date as null', () => {
    render(<TaskResources subTaskId="st1" canManage />)
    fireEvent.change(screen.getByTestId('task-resource-picker'), { target: { value: 'r-cam' } })
    fireEvent.change(screen.getByTestId('task-resource-hours'), { target: { value: '3.5' } })
    fireEvent.click(screen.getByTestId('task-resource-add-submit'))

    expect(state.addMutate).toHaveBeenCalledTimes(1)
    expect(state.addMutate.mock.calls[0][0]).toEqual({ resourceId: 'r-cam', hours: 3.5, startsOn: null })
  })

  // The whole point of d.6. A contested camera that reported nothing would look booked.
  it('says out loud when a resource could only be held tentatively', () => {
    state.addMutate.mockImplementation((_args, opts) =>
      opts.onSuccess({ report: { placed: 1, contested: ['RED Camera'], overCapacity: [], unplaced: [] } }),
    )
    render(<TaskResources subTaskId="st1" canManage />)
    fireEvent.change(screen.getByTestId('task-resource-picker'), { target: { value: 'r-cam' } })
    fireEvent.change(screen.getByTestId('task-resource-hours'), { target: { value: '3' } })
    fireEvent.click(screen.getByTestId('task-resource-add-submit'))

    expect(screen.getByTestId('requirement-outcome').textContent).toMatch(/already taken/i)
  })

  it('reports a requirement it could not place at all', () => {
    state.addMutate.mockImplementation((_args, opts) =>
      opts.onSuccess({ report: { placed: 0, contested: [], overCapacity: [], unplaced: [{ resource: 'RED Camera', reason: 'out_of_your_booking_scope' }] } }),
    )
    render(<TaskResources subTaskId="st1" canManage />)
    fireEvent.change(screen.getByTestId('task-resource-picker'), { target: { value: 'r-cam' } })
    fireEvent.change(screen.getByTestId('task-resource-hours'), { target: { value: '3' } })
    fireEvent.click(screen.getByTestId('task-resource-add-submit'))

    expect(screen.getByTestId('requirement-outcome').textContent).toMatch(/could not be booked/i)
  })

  it('confirms a clean booking rather than going silent', () => {
    state.addMutate.mockImplementation((_args, opts) => opts.onSuccess({ report: clean }))
    render(<TaskResources subTaskId="st1" canManage />)
    fireEvent.change(screen.getByTestId('task-resource-picker'), { target: { value: 'r-cam' } })
    fireEvent.change(screen.getByTestId('task-resource-hours'), { target: { value: '16' } })
    fireEvent.click(screen.getByTestId('task-resource-add-submit'))

    expect(screen.getByTestId('requirement-outcome').textContent).toMatch(/booked/i)
  })

  // §2.3 absence, not hiding: a viewer who cannot manage the task sees what it needs, and no
  // controls the server was always going to refuse.
  it('shows a read-only view to someone who cannot manage the task', () => {
    state.rows = [
      { id: 'q1', resourceId: 'r-cam', resourceName: 'RED Camera', resourceKind: 'equipment', hours: 3, startsOn: null, notes: null },
    ]
    render(<TaskResources subTaskId="st1" canManage={false} />)
    expect(screen.getByTestId('task-resource-q1')).toBeTruthy()
    expect(screen.queryByTestId('task-resource-add-st1')).toBeNull()
    expect(screen.queryByTestId('task-resource-remove-q1')).toBeNull()
  })

  // The "+" dialog: the task does not exist yet, so a requirement has no sub_task_id to key on.
  // Rows are staged in the caller's state and written once the task is real.
  describe('staged, for a task that does not exist yet', () => {
    it('hands new rows to the caller instead of writing them', () => {
      const onChange = vi.fn()
      render(<StagedTaskResources rows={[]} onChange={onChange} />)
      fireEvent.change(screen.getByTestId('task-resource-picker'), { target: { value: 'r-cam' } })
      fireEvent.change(screen.getByTestId('task-resource-hours'), { target: { value: '4' } })
      fireEvent.click(screen.getByTestId('task-resource-add-submit'))

      expect(state.addMutate).not.toHaveBeenCalled() // nothing is written yet — there is no task
      expect(onChange).toHaveBeenCalledWith([{ resourceId: 'r-cam', hours: 4, startsOn: null }])
    })

    it('shows a staged row by name, resolved from the picker list', () => {
      render(<StagedTaskResources rows={[{ resourceId: 'r-cam', hours: 4, startsOn: null }]} onChange={vi.fn()} />)
      expect(screen.getByTestId('task-resource-r-cam').textContent).toContain('RED Camera')
      expect(screen.getByTestId('task-resource-r-cam').textContent).toContain('4h')
    })

    it('removes a staged row without touching the server', () => {
      const onChange = vi.fn()
      render(<StagedTaskResources rows={[{ resourceId: 'r-cam', hours: 4, startsOn: null }]} onChange={onChange} />)
      fireEvent.click(screen.getByTestId('task-resource-remove-r-cam'))
      expect(state.removeMutate).not.toHaveBeenCalled()
      expect(onChange).toHaveBeenCalledWith([])
    })

    // The editor sits inside the booking <form>; a nested form would submit the outer one and
    // create the task the moment you added a camera.
    it('adds via a button, not a nested form', () => {
      const { container } = render(<StagedTaskResources rows={[]} onChange={vi.fn()} />)
      expect(container.querySelector('form')).toBeNull()
    })
  })
})
