import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../../lib/i18n'

const saveMutate = vi.hoisted(() => vi.fn())
const moveMutate = vi.hoisted(() => vi.fn())
const removeMutate = vi.hoisted(() => vi.fn())
vi.mock('../api/workstreams-api', () => ({
  useSaveWorkstream: () => ({ mutate: saveMutate, isPending: false }),
  useMoveDeliverableToWorkstream: () => ({ mutate: moveMutate, isPending: false }),
  useRemoveWorkstream: () => ({ mutate: removeMutate, isPending: false }),
}))

import { WorkstreamsPanel, type GroupedDeliverable } from './WorkstreamsPanel'
import type { Workstream } from '../api/workstreams-api'

/**
 * ADR-0099 / `I56.3`.
 *
 * The assertions here are the decisions, not the markup. In particular the three that are easy to
 * lose and expensive to lose:
 *
 *  - **grouping is optional** (d.1), so a campaign with none is ordinary and must not be nagged;
 *  - **taking work out of a group is a real destination** (d.4), not an absence;
 *  - **removing a group that still holds work is refused with the count** (d.8) — and refused
 *    before the server has to, because the panel already knows the number.
 */
const group = (over: Partial<Workstream> & { id: string }): Workstream => ({
  name: over.id,
  departmentId: 'dep-creative',
  departmentName: 'Creative',
  ownerUserId: 'u1',
  ownerName: 'Dev Dept Lead',
  deliverableCount: 0,
  ...over,
})

const item = (over: Partial<GroupedDeliverable> & { id: string }): GroupedDeliverable => ({
  name: over.id,
  workstreamId: null,
  ownerName: 'Dev Maker',
  ...over,
})

const DEPARTMENTS = [
  { id: 'dep-creative', name: 'Creative' },
  { id: 'dep-content', name: 'Content' },
]

function panel(props: Partial<Parameters<typeof WorkstreamsPanel>[0]> = {}) {
  return render(
    <WorkstreamsPanel
      campaignId="cam1"
      workstreams={[]}
      deliverables={[]}
      departments={DEPARTMENTS}
      people={[{ id: 'u1', name: 'Dev Dept Lead' }]}
      canManage
      testId="ws"
      {...props}
    />,
  )
}

describe('WorkstreamsPanel (ADR-0099, I56.3)', () => {
  beforeEach(() => {
    saveMutate.mockReset()
    moveMutate.mockReset()
    removeMutate.mockReset()
  })

  it('says a campaign is not grouped without making it sound like a problem', () => {
    // d.1: ungrouped is a normal, permanent state. No empty-state call to action.
    panel()
    expect(screen.getByTestId('ws-none')).toHaveTextContent(/does not have to be/i)
  })

  it('makes a group with a name, a department and an owner', () => {
    panel()
    fireEvent.click(screen.getByTestId('ws-add'))
    fireEvent.change(screen.getByTestId('ws-name'), { target: { value: 'Always-on' } })
    fireEvent.change(screen.getByTestId('ws-department'), { target: { value: 'dep-content' } })
    fireEvent.click(screen.getByTestId('ws-save'))
    expect(saveMutate.mock.calls[0][0]).toMatchObject({
      campaignId: 'cam1',
      name: 'Always-on',
      departmentId: 'dep-content',
      workstreamId: null,
    })
  })

  it('will not save a group with no name or no department', () => {
    // d.3: a group without a department cannot be reached, assigned or briefed, so it is not a
    // legal state — and the button says so by being unpressable rather than by failing.
    panel({ departments: [] })
    fireEvent.click(screen.getByTestId('ws-add'))
    expect(screen.getByTestId('ws-save')).toBeDisabled()
    fireEvent.change(screen.getByTestId('ws-name'), { target: { value: 'Always-on' } })
    expect(screen.getByTestId('ws-save')).toBeDisabled()
  })

  it('warns, before saving, that changing a group’s department moves the work in it', () => {
    panel({ workstreams: [group({ id: 'w1', name: 'Design', deliverableCount: 4 })] })
    fireEvent.click(screen.getByTestId('ws-edit-w1'))
    expect(screen.queryByTestId('ws-moves-work')).not.toBeInTheDocument()
    fireEvent.change(screen.getByTestId('ws-department'), { target: { value: 'dep-content' } })
    expect(screen.getByTestId('ws-moves-work')).toHaveTextContent('4')
  })

  it('moves a deliverable to another group', () => {
    panel({
      workstreams: [group({ id: 'w1' }), group({ id: 'w2' })],
      deliverables: [item({ id: 'd1', workstreamId: 'w1' })],
    })
    fireEvent.change(screen.getByTestId('ws-move-d1'), { target: { value: 'w2' } })
    expect(moveMutate.mock.calls[0][0]).toEqual({ deliverableId: 'd1', workstreamId: 'w2' })
  })

  it('takes a deliverable out of every group — a real destination, not an absence', () => {
    // d.4. The null here is the point: it must reach the server as "no group", not be swallowed.
    panel({
      workstreams: [group({ id: 'w1' })],
      deliverables: [item({ id: 'd1', workstreamId: 'w1' })],
    })
    fireEvent.change(screen.getByTestId('ws-move-d1'), { target: { value: '' } })
    expect(moveMutate.mock.calls[0][0]).toEqual({ deliverableId: 'd1', workstreamId: null })
  })

  it('lists ungrouped work as work, and only when there is some', () => {
    const { rerender } = panel({
      workstreams: [group({ id: 'w1' })],
      deliverables: [item({ id: 'd1', workstreamId: 'w1' })],
    })
    expect(screen.queryByTestId('ws-ungrouped')).not.toBeInTheDocument()
    rerender(
      <WorkstreamsPanel
        campaignId="cam1"
        workstreams={[group({ id: 'w1' })]}
        deliverables={[item({ id: 'd1', workstreamId: 'w1' }), item({ id: 'd2' })]}
        departments={DEPARTMENTS}
        people={[]}
        canManage
        testId="ws"
      />,
    )
    expect(screen.getByTestId('ws-ungrouped')).toBeInTheDocument()
  })

  it('refuses to remove a group that still holds work, and says how much', () => {
    // d.8, said before the server has to say it: the panel already knows the count.
    const onError = vi.fn()
    panel({ workstreams: [group({ id: 'w1', name: 'Design', deliverableCount: 6 })], onError })
    fireEvent.click(screen.getByTestId('ws-remove-w1'))
    expect(removeMutate).not.toHaveBeenCalled()
    expect(onError.mock.calls[0][0]).toContain('6')
    expect(screen.queryByTestId('ws-confirm-remove')).not.toBeInTheDocument()
  })

  it('removes an empty group, once confirmed', () => {
    panel({ workstreams: [group({ id: 'w1', deliverableCount: 0 })] })
    fireEvent.click(screen.getByTestId('ws-remove-w1'))
    fireEvent.click(screen.getByTestId('ws-confirm-remove-confirm'))
    expect(removeMutate.mock.calls[0][0]).toBe('w1')
  })

  it('offers nothing to change to somebody who may not manage the campaign', () => {
    panel({
      workstreams: [group({ id: 'w1' })],
      deliverables: [item({ id: 'd1', workstreamId: 'w1' })],
      canManage: false,
    })
    expect(screen.queryByTestId('ws-add')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ws-edit-w1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ws-remove-w1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ws-move-d1')).not.toBeInTheDocument()
    // But they still READ the grouping: it is how the campaign's work is laid out.
    expect(screen.getByTestId('ws-group-name-w1')).toBeInTheDocument()
  })
})
