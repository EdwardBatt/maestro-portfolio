import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import '../../../lib/i18n'
import { ResponseClock } from './ResponseClock'

/**
 * The response clock (ADR-0082 d.10, ADR-0085 d.5): from the CONFIRMED arrival, never from when the
 * form was opened. Presentation over `elapsedSince`; what is asserted here is what it says.
 */
describe('ResponseClock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-11T12:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('says the clock has not started while nothing is confirmed', () => {
    render(<ResponseClock startIso={null} />)
    expect(screen.getByTestId('response-clock')).toHaveTextContent(/has not started/i)
  })

  it('shows the elapsed time and when it started', () => {
    render(<ResponseClock startIso="2026-09-10T09:30:00Z" />)
    expect(screen.getByTestId('response-clock-elapsed')).toHaveTextContent('1d 2h 30m')
    expect(screen.getByTestId('response-clock')).toHaveTextContent(/running since/i)
  })

  it('leaves out the days and hours while there are none', () => {
    render(<ResponseClock startIso="2026-09-11T11:48:00Z" />)
    expect(screen.getByTestId('response-clock-elapsed')).toHaveTextContent('12m')
  })

  // Amber is data (§6.3): a day-old request is a different fact from a fresh one.
  it('marks a request older than a day', () => {
    render(<ResponseClock startIso="2026-09-09T12:00:00Z" />)
    expect(screen.getByTestId('response-clock')).toHaveClass('is-old')
    render(<ResponseClock startIso="2026-09-11T11:00:00Z" testId="fresh" />)
    expect(screen.getByTestId('fresh')).not.toHaveClass('is-old')
  })

  it('keeps moving', () => {
    render(<ResponseClock startIso="2026-09-11T11:58:00Z" />)
    expect(screen.getByTestId('response-clock-elapsed')).toHaveTextContent('2m')
    act(() => { vi.advanceTimersByTime(3 * 60_000) })
    expect(screen.getByTestId('response-clock-elapsed')).toHaveTextContent('5m')
  })
})
