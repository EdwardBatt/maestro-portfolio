import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../../lib/i18n'
import type { Concept } from '../api/concepts-api'

/**
 * ConceptsPanel (ADR-0065 + the 13 Sep addendum, I34.4 / I48.15). The api reaches lib/env in CI →
 * mocked.
 *
 * The assertions that matter are the ones enforcing decisions rather than rendering:
 *   d.5  — a proposal citing nothing is SHOWN and marked, never hidden.
 *   d.6  — a concept is visibly a proposal, not brief content.
 *   d.7  — no button for a reader who cannot edit the brief.
 *   d.10 — ONE concept; each item is kept or deleted; there is no edit.
 *   d.11 — "Regenerate removed" is offered only when something was removed, and says how many.
 */

/**
 * The factory lists EVERY export the component and this file use, and calls no `importActual`.
 * `importActual` loads the real module, which reaches `lib/supabase` → `lib/env`, and `lib/env`
 * throws without `VITE_*` — present in a developer's `.env`, absent in CI (docs/memory/traps.md).
 *
 * The error classes are built inside `vi.hoisted` so the component's `instanceof` and this file's
 * `throw` are the SAME class.
 */
const state = vi.hoisted(() => {
  class BriefEmptyError extends Error {
    constructor() {
      super('brief_empty')
      this.name = 'BriefEmptyError'
    }
  }
  class NothingRemovedError extends Error {
    constructor() {
      super('nothing_removed')
      this.name = 'NothingRemovedError'
    }
  }
  return {
    concept: null as Concept | null,
    isError: false,
    proposeMutate: vi.fn(),
    markMutate: vi.fn(),
    discardMutate: vi.fn(),
    BriefEmptyError,
    NothingRemovedError,
  }
})

vi.mock('../api/concepts-api', () => ({
  useConcept: () => ({ data: state.concept, isLoading: false, isError: state.isError }),
  useProposeConcepts: () => ({ mutate: state.proposeMutate, isPending: false }),
  useMarkConceptItem: () => ({ mutate: state.markMutate, isPending: false }),
  useDiscardConcept: () => ({ mutate: state.discardMutate, isPending: false }),
  openSlots: (slots: Record<string, number>) => Object.values(slots).reduce((a, b) => a + (b > 0 ? b : 0), 0),
  BriefEmptyError: state.BriefEmptyError,
  NothingRemovedError: state.NothingRemovedError,
}))

import { ConceptsPanel } from './ConceptsPanel'

const concept = (o: Partial<Concept> = {}): Concept => ({
  id: 'c1',
  createdAt: '2026-09-02T09:00:00Z',
  model: 'gpt-5.6-luna',
  requestedByName: 'Lina',
  proposals: [{ id: 's1', shape: 'strategic_thinking', text: 'own the moment', answers: ['objective'] }],
  slots: {},
  regenerations: 0,
  regeneratedAt: null,
  regeneratedByName: null,
  ...o,
})

const render_ = (canPropose = true) =>
  render(<ConceptsPanel briefId="b1" canPropose={canPropose} testId="cp" />)

describe('ConceptsPanel (ADR-0065 + addendum)', () => {
  beforeEach(() => {
    state.concept = null
    state.isError = false
    state.proposeMutate = vi.fn()
    state.markMutate = vi.fn()
    state.discardMutate = vi.fn()
  })

  it('says this is a suggestion, not the approved brief (d.6)', () => {
    render_()
    expect(screen.getByTestId('cp')).toHaveTextContent(/The brief above is the approved document/)
  })

  it('offers nothing to a reader without projects:manage (d.7)', () => {
    state.concept = concept()
    render_(false)
    expect(screen.queryByTestId('cp-propose')).toBeNull()
    expect(screen.queryByTestId('cp-concept-keep-s1')).toBeNull()
    expect(screen.queryByTestId('cp-concept-delete-s1')).toBeNull()
    expect(screen.queryByTestId('cp-discard')).toBeNull()
  })

  it('proposes on demand — never on render (d.7)', () => {
    render_()
    expect(state.proposeMutate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('cp-propose'))
    expect(state.proposeMutate).toHaveBeenCalledTimes(1)
  })

  it('explains an empty brief as a state, not a failure', () => {
    state.proposeMutate = vi.fn((_: unknown, opts: { onError: (e: Error) => void }) => opts.onError(new state.BriefEmptyError()))
    render_()
    fireEvent.click(screen.getByTestId('cp-propose'))
    expect(screen.getByTestId('cp-error')).toHaveTextContent(/nothing written in it yet/)
  })

  // Addendum d.10: one concept, each item kept or deleted, no edit anywhere.
  it('shows ONE concept with Keep and Delete per item, and no edit (d.10)', () => {
    state.concept = concept({
      proposals: [
        { id: 's1', shape: 'strategic_thinking', text: 'own the moment', answers: ['objective'] },
        { id: 'p1', shape: 'pillars', name: 'Warmth', text: 'family first', answers: ['audience'], kept: true },
      ],
    })
    render_()
    expect(screen.getByTestId('cp-concept')).toHaveTextContent(/Proposed by Lina/)
    fireEvent.click(screen.getByTestId('cp-concept-keep-s1'))
    expect(state.markMutate).toHaveBeenCalledWith({ conceptId: 'c1', itemId: 's1', action: 'keep' }, expect.anything())
    fireEvent.click(screen.getByTestId('cp-concept-delete-p1'))
    expect(state.markMutate).toHaveBeenCalledWith({ conceptId: 'c1', itemId: 'p1', action: 'delete' }, expect.anything())
    // A kept item is marked and no longer offers Keep.
    expect(screen.getByTestId('cp-concept-kept-p1')).toBeInTheDocument()
    expect(screen.queryByTestId('cp-concept-keep-p1')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  // Addendum d.11: regeneration fills only what was removed.
  it('offers "Regenerate removed" only once something was deleted, and says how many (d.11)', () => {
    state.concept = concept({ slots: {} })
    const { unmount } = render_()
    expect(screen.getByTestId('cp-propose')).toHaveTextContent('Regenerate removed (0)')
    expect(screen.getByTestId('cp-propose')).toBeDisabled()
    unmount()

    state.concept = concept({ slots: { pillars: 2, creative_direction: 1 } })
    render_()
    expect(screen.getByTestId('cp-propose')).toHaveTextContent('Regenerate removed (3)')
    expect(screen.getByTestId('cp-propose')).not.toBeDisabled()
    expect(screen.getByTestId('cp-slots')).toHaveTextContent(/3 items removed/)
    fireEvent.click(screen.getByTestId('cp-propose'))
    expect(state.proposeMutate).toHaveBeenCalledTimes(1)
  })

  it('keeps the per-press audit: how many regenerations, last by whom', () => {
    state.concept = concept({ regenerations: 2, regeneratedByName: 'Omar', regeneratedAt: '2026-09-13T10:00:00Z' })
    render_()
    expect(screen.getByTestId('cp-regenerations')).toHaveTextContent(/regenerated 2 times, last by Omar/)
  })

  it('SHOWS a proposal that cites nothing, marked (d.5)', () => {
    state.concept = concept({ proposals: [{ id: 'x', shape: 'creative_direction', text: 'go bold', answers: [] }] })
    render_()
    expect(screen.getByTestId('cp-concept-item-x')).toHaveTextContent('go bold')
    expect(screen.getByTestId('cp-concept-unsupported')).toBeInTheDocument()
  })

  it('groups by shape and never renders a content-types group (d.9)', () => {
    state.concept = concept({
      proposals: [
        { id: 'a', shape: 'pillars', name: 'Belonging', text: 'a place at the table', answers: ['audience'] },
        { id: 'b', shape: 'strategic_thinking', text: 'own the moment', answers: ['objective'] },
      ],
    })
    render_()
    expect(screen.getByTestId('cp-concept-pillars')).toHaveTextContent('Belonging')
    expect(screen.getByTestId('cp-concept-strategic_thinking')).toBeInTheDocument()
    expect(screen.getByTestId('cp')).not.toHaveTextContent(/content type/i)
  })

  it('discard is two-step: arm, then confirm', () => {
    state.concept = concept()
    render_()
    fireEvent.click(screen.getByTestId('cp-discard'))
    expect(state.discardMutate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('cp-discard'))
    expect(state.discardMutate).toHaveBeenCalledWith('c1', expect.anything())
  })

  it('surfaces a failed read instead of showing an empty state', () => {
    state.isError = true
    render_()
    expect(screen.getByTestId('cp-load-failed')).toBeInTheDocument()
    expect(screen.queryByTestId('cp-empty')).toBeNull()
  })
})
