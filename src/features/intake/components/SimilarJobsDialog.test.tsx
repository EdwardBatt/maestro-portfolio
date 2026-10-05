import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../../lib/i18n'
import { SimilarJobsDialog } from './SimilarJobsDialog'
import type { SimilarJob } from '../api/intake-api'

const job = (o: Partial<SimilarJob> & { campaignId: string }): SimilarJob => ({
  name: 'Ramadan teaser post',
  score: 0.92,
  kind: 'single_job',
  departmentNames: ['Creative'],
  deliverableCount: 1,
  raisedBy: 'Lina',
  raisedAt: '2026-09-04T09:00:00Z',
  status: 'approved',
  ...o,
})

const common = { clientName: 'Zeta', askedBy: 'Ahmed', busy: false, onAttach: vi.fn(), onKeepSeparate: vi.fn(), onCancel: vi.fn() }

/**
 * SJ-v3-S1 (ADR-0086 d.2–d.6): a question, not a refusal. CHECK THIS FIRST; the client named; the
 * best match in amber with its score; what attaching keeps; both choices there.
 */
describe('SimilarJobsDialog', () => {
  it('names the client, the best match and its score, and lists the rest with who raised them', () => {
    render(
      <SimilarJobsDialog
        {...common}
        jobs={[job({ campaignId: 'a' }), job({ campaignId: 'b', name: 'Ramadan KV', score: 0.41, kind: 'campaign', deliverableCount: 4, raisedBy: null, raisedAt: null, status: 'completed' })]}
      />,
    )
    expect(screen.getByTestId('sj-similar-dialog')).toHaveTextContent('Check this first')
    expect(screen.getByTestId('sj-similar-dialog')).toHaveTextContent('Zeta already has a job that looks like this')
    expect(screen.getByTestId('sj-similar-dialog')).toHaveTextContent(/“Ramadan teaser post” was raised .* by Lina, and it is still with Creative/)
    expect(screen.getByTestId('sj-similar-score-a')).toHaveTextContent('92% match')
    expect(screen.getByTestId('sj-similar-score-b')).toHaveTextContent('41% match')
    expect(screen.getByTestId('sj-similar-a')).toHaveClass('is-top')
    expect(screen.getByTestId('sj-similar-a')).toHaveTextContent('In progress')
    expect(screen.getByTestId('sj-similar-b')).toHaveTextContent('Delivered')
    expect(screen.getByTestId('sj-similar-b')).not.toHaveClass('is-top')
  })

  it('says what attaching keeps — one brief, one clock, one conversation with whoever asked', () => {
    render(<SimilarJobsDialog {...common} jobs={[job({ campaignId: 'a' })]} />)
    expect(screen.getByTestId('sj-similar-why')).toHaveTextContent('one brief, one clock and one conversation with Ahmed')
  })

  it('offers both choices and never a refusal', () => {
    const onAttach = vi.fn()
    const onKeepSeparate = vi.fn()
    render(<SimilarJobsDialog {...common} jobs={[job({ campaignId: 'a' })]} onAttach={onAttach} onKeepSeparate={onKeepSeparate} />)
    expect(screen.getByTestId('sj-similar-attach')).toHaveTextContent('Add it to that job')
    fireEvent.click(screen.getByTestId('sj-similar-attach'))
    expect(onAttach).toHaveBeenCalledWith('a')
    fireEvent.click(screen.getByTestId('sj-similar-separate'))
    expect(onKeepSeparate).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape unless a choice is in flight', () => {
    const onCancel = vi.fn()
    const { rerender } = render(<SimilarJobsDialog {...common} jobs={[job({ campaignId: 'a' })]} busy onCancel={onCancel} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
    rerender(<SimilarJobsDialog {...common} jobs={[job({ campaignId: 'a' })]} busy={false} onCancel={onCancel} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
