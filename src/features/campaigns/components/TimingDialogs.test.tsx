import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../../lib/i18n'
import { AddPhaseDialog } from './AddPhaseDialog'

/**
 * The phase dialog off the timing screen — `CB-v3-P1` (add or edit a phase, `I56.10`). The move
 * dialog `CB-v3-P7` is gone: a piece's date now chooses its phase (Edward, 24 Sep), in the piece's
 * own Edit, which `TimingStepContainer.test.tsx` holds.
 *
 * Presentational, so what is tested is the contract: the dates it FILLS IN are the ones `plan-back`
 * computes, and a phase that ends before it starts is refused on the field.
 */

describe('AddPhaseDialog (CB-v3-P1)', () => {
  function view(over: Partial<React.ComponentProps<typeof AddPhaseDialog>> = {}) {
    const props = {
      previousPhase: { name: 'Week 4', endsOn: '2026-10-16' },
      onAdd: vi.fn(),
      onCancel: vi.fn(),
      ...over,
    }
    render(<AddPhaseDialog {...props} />)
    return props
  }

  it('fills the start from the phase before it, and lets it be changed', () => {
    // Week 4 ends Fri 16 Oct, so Week 5 starts Sat 17 Oct — a CALENDAR day after. Editable,
    // because a season can have a gap between phases.
    view()
    const starts = screen.getByTestId('add-phase-starts') as HTMLInputElement
    expect(starts.value).toBe('2026-10-17')
    expect(starts.readOnly).toBe(false)
  })

  it('is a name, a start date and an end date — no event (Edward, 24 Sep)', () => {
    const p = view()
    expect(screen.queryByTestId('add-phase-event')).not.toBeInTheDocument()
    const submit = screen.getByTestId('add-phase-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByTestId('add-phase-name'), { target: { value: 'Week 5' } })
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByTestId('add-phase-date'), { target: { value: '2026-10-23' } })
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    expect(p.onAdd).toHaveBeenCalledWith({ name: 'Week 5', startsOn: '2026-10-17', endsOn: '2026-10-23' })
  })

  it('refuses a phase that ends before it starts — that is a typo, not a tight deadline', () => {
    view()
    fireEvent.change(screen.getByTestId('add-phase-name'), { target: { value: 'Week 5' } })
    fireEvent.change(screen.getByTestId('add-phase-date'), { target: { value: '2026-10-10' } })
    expect((screen.getByTestId('add-phase-submit') as HTMLButtonElement).disabled).toBe(true)
  })

  it('asks for the start of the first phase of a season', () => {
    view({ previousPhase: null })
    expect((screen.getByTestId('add-phase-starts') as HTMLInputElement).value).toBe('')
    fireEvent.change(screen.getByTestId('add-phase-name'), { target: { value: 'Pre-Launch' } })
    fireEvent.change(screen.getByTestId('add-phase-date'), { target: { value: '2026-09-18' } })
    expect((screen.getByTestId('add-phase-submit') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByTestId('add-phase-starts'), { target: { value: '2026-09-12' } })
    expect((screen.getByTestId('add-phase-submit') as HTMLButtonElement).disabled).toBe(false)
  })

  it('cancels', () => {
    const p = view()
    fireEvent.click(screen.getByTestId('add-phase-cancel'))
    expect(p.onCancel).toHaveBeenCalled()
  })
})
