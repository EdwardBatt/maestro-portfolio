import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../../lib/i18n'
import type { AttendanceDay, AttendanceDeviation, AttendanceProfile } from './api/attendance-api'

/**
 * AttendanceWidget (ADR-0031, I9). The api module reaches lib/env (throws in CI) so it's mocked;
 * the test proves the widget offers Start before check-in, End once checked in, and a neutral
 * "day off" (no actions) when the day is suppressed.
 */

const state = vi.hoisted(() => ({
  day: null as AttendanceDay | null,
  profile: { expectedCheckIn: '09:00:00', expectedMinutes: 480, graceMinutes: 15, workdays: [1, 2, 3, 4, 5] } as AttendanceProfile | null,
  dev: { late: false, short: false, missing: false, noCheckout: false, suppressed: false } as AttendanceDeviation | null,
  start: vi.fn(),
  end: vi.fn(),
}))

vi.mock('./api/attendance-api', () => ({
  useAttendanceHeartbeat: () => {},
  useMyAttendanceToday: () => ({ data: state.day }),
  useAttendanceProfile: () => ({ data: state.profile }),
  useMyDeviation: () => ({ data: state.dev }),
  useStartDay: () => ({ mutate: state.start, isPending: false }),
  useEndDay: () => ({ mutate: state.end, isPending: false }),
}))

import { AttendanceWidget } from './AttendanceWidget'

function day(partial: Partial<AttendanceDay>): AttendanceDay {
  return {
    id: 'a', workDate: '2026-08-19', checkedInAt: null, checkedOutAt: null,
    checkInSource: null, checkOutSource: null, workedMinutes: null, ...partial,
  }
}

describe('AttendanceWidget (ADR-0031, I9)', () => {
  beforeEach(() => {
    state.day = null
    state.dev = { late: false, short: false, missing: false, noCheckout: false, suppressed: false }
    state.start = vi.fn()
    state.end = vi.fn()
  })

  it('offers Start day before check-in', () => {
    render(<AttendanceWidget userId="me" />)
    expect(screen.getByTestId('attendance-start')).toBeInTheDocument()
    expect(screen.queryByTestId('attendance-end')).not.toBeInTheDocument()
  })

  it('offers End day once checked in', () => {
    state.day = day({ checkedInAt: '2026-08-19T09:05:00Z', checkInSource: 'auto' })
    render(<AttendanceWidget userId="me" />)
    expect(screen.getByTestId('attendance-end')).toBeInTheDocument()
    expect(screen.queryByTestId('attendance-start')).not.toBeInTheDocument()
  })

  it('shows a day off with no actions when suppressed', () => {
    state.dev = { late: false, short: false, missing: false, noCheckout: false, suppressed: true }
    render(<AttendanceWidget userId="me" />)
    expect(screen.getByTestId('attendance-status')).toHaveTextContent(/day off/i)
    expect(screen.queryByTestId('attendance-start')).not.toBeInTheDocument()
    expect(screen.queryByTestId('attendance-end')).not.toBeInTheDocument()
  })
})
