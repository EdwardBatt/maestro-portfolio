import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import '../../../lib/i18n'

const state = vi.hoisted(() => ({ rules: [] as { kind: 'do' | 'dont'; text: string }[] }))
vi.mock('../api/review-rules-api', () => ({
  useDeliverableRules: () => ({ rules: state.rules, isLoading: false }),
}))

import { ReviewRules } from './ReviewRules'

describe('ReviewRules — the rules beside the file (ADR-0112 d.1)', () => {
  it('lists each rule as a plain line — a Do / Don’t mark and its words, no tick box', () => {
    state.rules = [
      { kind: 'do', text: 'Logo top right' },
      { kind: 'dont', text: 'No red on the pack' },
    ]
    render(<ReviewRules deliverableId="d1" />)
    const box = screen.getByTestId('review-rules')
    expect(box).toHaveTextContent('Rules this deliverable follows')
    expect(screen.getByTestId('review-rules-0')).toHaveTextContent('Logo top right')
    expect(screen.getByTestId('review-rules-1')).toHaveTextContent('No red on the pack')
    expect(within(box).queryAllByRole('checkbox')).toHaveLength(0)
    expect(within(box).queryAllByRole('button')).toHaveLength(0)
  })

  it('shows nothing when the piece carries no rules', () => {
    state.rules = []
    render(<ReviewRules deliverableId="d1" />)
    expect(screen.queryByTestId('review-rules')).toBeNull()
  })
})
