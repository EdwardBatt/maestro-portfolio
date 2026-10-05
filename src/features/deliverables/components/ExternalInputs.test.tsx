// ADR-0069 (I36.5) — what the deliverable is waiting on from outside.
//
// `deliverable_pending_inputs` has existed since August with no way to register one, clear one, or
// see one. Two properties matter here:
//
//   * `description` is MANDATORY, and that is the point rather than a validation detail: ADR-0030
//     refused a vague "blocked" and required a specific item, because a blocker nobody can name is
//     a blocker nobody can chase.
//   * Clearing one is an explicit act, stamped (d.9) — which is the only reason *how long were we
//     waiting* is answerable at all, so the elapsed time is shown while it is outstanding.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../../lib/i18n'

const addMutate = vi.hoisted(() => vi.fn())
const markArrivedMutate = vi.hoisted(() => vi.fn())
vi.mock('../api/requirements-api', () => ({
  useAddPendingInput: () => ({ mutate: addMutate, isPending: false }),
  useMarkInputArrived: () => ({ mutate: markArrivedMutate, isPending: false }),
}))

import { ExternalInputs } from './ExternalInputs'
import type { PendingInput } from '../api/requirements-api'

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

const input = (over: Partial<PendingInput> = {}): PendingInput => ({
  id: 'in1',
  description: 'Acme logo pack',
  awaitedFrom: 'Acme brand team',
  requestedAt: daysAgo(3),
  satisfiedAt: null,
  ...over,
})

function renderPanel(inputs: PendingInput[] = [], canManage = true) {
  return render(<ExternalInputs deliverableId="d1" inputs={inputs} canManage={canManage} />)
}

describe('ExternalInputs (ADR-0069 d.7–d.9)', () => {
  beforeEach(() => {
    addMutate.mockReset()
    markArrivedMutate.mockReset()
  })

  it('says when nothing is outstanding', () => {
    renderPanel()
    expect(screen.getByTestId('external-inputs-none')).toBeInTheDocument()
  })

  it('names the item and who it is expected from', () => {
    renderPanel([input()])
    const row = screen.getByTestId('external-input-in1')
    expect(row).toHaveTextContent('Acme logo pack')
    expect(row).toHaveTextContent('Acme brand team')
  })

  it('shows how long it has been outstanding — the number d.9 exists for', () => {
    renderPanel([input()])
    expect(screen.getByTestId('external-input-days-in1')).toHaveTextContent('3')
  })

  it('stops counting once it has arrived', () => {
    renderPanel([input({ satisfiedAt: new Date().toISOString() })])
    expect(screen.queryByTestId('external-input-days-in1')).not.toBeInTheDocument()
  })

  it('refuses to register an unnamed item — a blocker nobody can name cannot be chased', () => {
    renderPanel()
    fireEvent.click(screen.getByTestId('external-input-add'))
    expect(screen.getByTestId('external-input-save')).toBeDisabled()
    fireEvent.change(screen.getByTestId('external-input-description'), { target: { value: '  ' } })
    expect(screen.getByTestId('external-input-save')).toBeDisabled()
  })

  it('registers a named item, with who it is from', () => {
    renderPanel()
    fireEvent.click(screen.getByTestId('external-input-add'))
    fireEvent.change(screen.getByTestId('external-input-description'), {
      target: { value: 'Acme logo pack' },
    })
    fireEvent.change(screen.getByTestId('external-input-awaited-from'), {
      target: { value: "the client's agency" },
    })
    fireEvent.submit(screen.getByTestId('external-input-form'))
    expect(addMutate).toHaveBeenCalledWith(
      { description: 'Acme logo pack', awaitedFrom: "the client's agency" },
      expect.anything(),
    )
  })

  it('marks one as arrived — once: a cleared input offers no way back (I59, the database refuses it)', () => {
    const { rerender } = renderPanel([input()])
    fireEvent.click(screen.getByTestId('external-input-arrived-in1'))
    expect(markArrivedMutate).toHaveBeenCalledWith('in1')

    rerender(
      <ExternalInputs
        deliverableId="d1"
        inputs={[input({ satisfiedAt: new Date().toISOString() })]}
        canManage
      />,
    )
    expect(screen.getByTestId('external-input-in1')).toHaveTextContent('Acme logo pack')
    expect(screen.queryByTestId('external-input-arrived-in1')).not.toBeInTheDocument()
  })

  it('lists outstanding items before cleared ones', () => {
    renderPanel([
      input({ id: 'done1', description: 'Signed contract', satisfiedAt: new Date().toISOString() }),
      input({ id: 'open1', description: 'Acme logo pack' }),
    ])
    const rows = screen.getByTestId('external-inputs-list').querySelectorAll('li')
    expect(rows[0]).toHaveTextContent('Acme logo pack')
    expect(rows[1]).toHaveTextContent('Signed contract')
  })

  it('is read-only without the grant, and still readable', () => {
    renderPanel([input()], false)
    expect(screen.getByTestId('external-input-in1')).toHaveTextContent('Acme logo pack')
    expect(screen.queryByTestId('external-input-add')).not.toBeInTheDocument()
    expect(screen.queryByTestId('external-input-arrived-in1')).not.toBeInTheDocument()
  })
})
