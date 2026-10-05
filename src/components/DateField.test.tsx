import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import '../lib/i18n'
import { DateField } from './DateField'

/** I66.8 — every date box: the day in words beside it, and a mistyped date said and never passed on. */
function Harness({ onDay, start = '' }: { onDay: (d: string) => void; start?: string }) {
  const [v, setV] = useState(start)
  return <DateField value={v} onChange={(d) => { setV(d); onDay(d) }} data-testid="due" />
}

describe('DateField', () => {
  // "Today" is fixed, so a 2027 date keeps its year whenever this runs.
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-29T09:00:00Z')) })
  afterEach(() => { vi.useRealTimers() })

  it('passes a real day on and says it in words beside the box', () => {
    const onDay = vi.fn()
    render(<Harness onDay={onDay} />)
    fireEvent.change(screen.getByTestId('due'), { target: { value: '2027-10-09' } })
    expect(onDay).toHaveBeenLastCalledWith('2027-10-09')
    expect(screen.getByTestId('due-day')).toHaveTextContent('Sat, 9 Oct 2027')
    expect(screen.queryByTestId('due-wrong')).toBeNull()
  })

  it('catches a five-digit year: nothing is passed on, the person is told, and what they typed stays', () => {
    const onDay = vi.fn()
    render(<Harness onDay={onDay} start="2027-10-09" />)
    const box = screen.getByTestId('due') as HTMLInputElement
    fireEvent.change(box, { target: { value: '20266-10-09' } })
    expect(onDay).toHaveBeenLastCalledWith('')
    expect(screen.getByTestId('due-wrong')).toHaveTextContent("That isn't a date — pick it from the calendar.")
    expect(box).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByTestId('due-day')).toBeNull()
  })

  it('takes a value set from outside', () => {
    const { rerender } = render(<DateField value="" onChange={() => {}} data-testid="due" />)
    rerender(<DateField value="2027-01-05" onChange={() => {}} data-testid="due" />)
    expect(screen.getByTestId('due')).toHaveValue('2027-01-05')
    expect(screen.getByTestId('due-day')).toHaveTextContent('Tue, 5 Jan 2027')
  })
})
