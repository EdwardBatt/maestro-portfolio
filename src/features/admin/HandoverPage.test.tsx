import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../../lib/i18n'

const state = vi.hoisted(() => ({
  items: [] as unknown[],
  leaving: [] as unknown[],
  mutate: vi.fn(),
}))

vi.mock('./api/handover-api', () => ({
  useHandoverItems: () => ({ data: state.items, isLoading: false, isError: false }),
  useLeavingPeople: () => ({ data: state.leaving }),
  useHandOverItem: () => ({ mutate: state.mutate, isPending: false, isError: false }),
}))
vi.mock('../clients/api/clients-api', () => ({
  useAccountManagers: () => ({ data: [{ id: 'am2', name: 'Dina Khaled' }, { id: 'leaver', name: 'Mira Adel Mansour' }] }),
}))
vi.mock('../deliverables/api/deliverables-api', () => ({
  useDeliverableOwnerCandidates: () => ({ data: [
    { id: 'l1', name: 'Ismail Nasser Abdelrahman', departmentId: 'creative' },
    { id: 'l2', name: 'Mohammed Sadek', departmentId: 'performance' },
  ] }),
  useAssignableUsers: () => ({ data: [{ id: 'd1', name: 'A Designer', departmentId: 'creative' }] }),
  useReviewers: () => ({ data: [{ id: 'r1', name: 'A Reviewer' }] }),
}))
vi.mock('../campaigns/api/workstreams-api', () => ({ useWorkstreamOwnerCandidates: () => ({ data: [] }) }))
vi.mock('../../lib/users/user-names', () => ({ fetchUserNames: async () => new Map([['leaver', 'Mira Adel Mansour']]) }))

import { HandoverPage } from './HandoverPage'

const renderAt = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/people/handover/leaver']}>
        <Routes><Route path="/people/handover/:userId" element={<HandoverPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )

/** ADR-0133 (I70.4): everything a leaving person holds, grouped, each handed to a named person. */
describe('the hand-over page', () => {
  beforeEach(() => {
    state.mutate.mockReset()
    state.leaving = [{ id: 'leaver', name: 'Mira Adel Mansour', leavingSince: '2026-09-30T08:00:00Z', itemsRemaining: 2 }]
    state.items = [
      { kind: 'client', itemId: 'c1', label: 'Kite', context: 'Iraq' },
      { kind: 'deliverable', itemId: 'd9', label: 'Campus OOH', context: 'LUMA Season 2', detail: { department_id: 'creative' } },
    ]
  })

  it('names the person, counts the items and shows only the groups that apply', () => {
    renderAt()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent("Hand over Mira Adel Mansour's work")
    expect(screen.getByTestId('handover-count')).toHaveTextContent('2')
    expect(screen.getByTestId('handover-group-client')).toBeInTheDocument()
    expect(screen.getByTestId('handover-group-deliverable')).toBeInTheDocument()
    expect(screen.queryByTestId('handover-group-task')).toBeNull()
  })

  it('offers each item by its own rule, never the leaving person, and hands it over', () => {
    renderAt()
    // A client goes to an account manager — not the one leaving.
    fireEvent.change(screen.getByTestId('handover-pick-client-c1'), { target: { value: 'a' } })
    expect(screen.getByTestId('handover-pick-client-c1-option-am2')).toBeInTheDocument()
    expect(screen.queryByTestId('handover-pick-client-c1-option-leaver')).toBeNull()
    // A deliverable goes to its department's leads (ADR-0128) — Creative's, not Performance's.
    fireEvent.change(screen.getByTestId('handover-pick-deliverable-d9'), { target: { value: 'm' } })
    expect(screen.getByTestId('handover-pick-deliverable-d9-option-l1')).toBeInTheDocument()
    expect(screen.queryByTestId('handover-pick-deliverable-d9-option-l2')).toBeNull()
    // Nothing is handed over until someone is chosen; then the item goes to them.
    expect(screen.getByTestId('handover-go-client-c1')).toBeDisabled()
    fireEvent.mouseDown(screen.getByTestId('handover-pick-client-c1-option-am2'))   // the picker chooses on mouse-down
    fireEvent.click(screen.getByTestId('handover-go-client-c1'))
    expect(state.mutate).toHaveBeenCalledWith({ kind: 'client', itemId: 'c1', toUserId: 'am2' }, expect.anything())
  })

  /** I70 follow-up: a task with no reviewer is asked for one, as the Schedule's assignment dialog asks. */
  it('asks a task with no reviewer for one, and sends it with the hand-over', () => {
    state.items = [{ kind: 'task', itemId: 't7', label: 'Motion', context: 'Card reveal film', detail: { needs_reviewer: true, department_id: 'creative' } }]
    renderAt()
    expect(screen.getByTestId('handover-needs-reviewer-t7')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('handover-pick-task-t7'), { target: { value: 'a' } })
    fireEvent.mouseDown(screen.getByTestId('handover-pick-task-t7-option-d1'))
    expect(screen.getByTestId('handover-go-task-t7')).toBeDisabled()   // a person, but no reviewer yet
    fireEvent.change(screen.getByTestId('handover-reviewer-t7-add'), { target: { value: 'r1' } })
    fireEvent.click(screen.getByTestId('handover-go-task-t7'))
    expect(state.mutate).toHaveBeenCalledWith(
      { kind: 'task', itemId: 't7', toUserId: 'd1', reviewers: [{ user_id: 'r1', is_mandatory: true }] }, expect.anything())
  })

  it('says the deactivation is complete when nothing is left', () => {
    state.items = []
    renderAt()
    expect(screen.getByTestId('handover-complete')).toHaveTextContent('complete')
  })
})
