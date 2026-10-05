import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../../../lib/i18n'

type Person = { departmentId: string | null; bookedHours: number; nominalHours: number }
const load = vi.hoisted(() => ({ people: [] as Person[], isLoading: false, isError: false, weekOf: null as unknown }))
vi.mock('../../team/api/team-api', async (orig) => {
  const real = await orig<typeof import('../../team/api/team-api')>()
  return {
    capacityLevel: real.capacityLevel,
    useTeamLoad: (weekOf: unknown) => {
      load.weekOf = weekOf
      return { week: { start: '', end: '', label: '' }, groups: [{ key: 'g', label: 'g', kind: 'team', people: load.people }], isLoading: load.isLoading, isError: load.isError }
    },
  }
})

import { DepartmentWeekLoad } from './DepartmentWeekLoad'

/**
 * `I56.11` Q14 — the timing step's capacity line: the DEPARTMENT's load for the week the piece is
 * due, never a person. The same reading as the single job's owner line (`capacityLevel`), so the
 * two screens cannot call the same week by different names.
 */
describe('DepartmentWeekLoad (CB-v3-04 capacity column)', () => {
  beforeEach(() => {
    load.people = []
    load.isLoading = false
    load.isError = false
  })

  const view = () => render(<DepartmentWeekLoad departmentId="dep-c" departmentName="Creative" dueOn="2026-10-07" testId="load" />)

  it('reads the week the piece is due, not this week', () => {
    view()
    expect(load.weekOf).toBe('2026-10-07')
  })

  it('adds up only the department, and calls a light week fine', () => {
    load.people = [
      { departmentId: 'dep-c', bookedHours: 10, nominalHours: 40 },
      { departmentId: 'dep-c', bookedHours: 15, nominalHours: 40 },
      { departmentId: 'dep-x', bookedHours: 40, nominalHours: 40 },
    ]
    view()
    expect(screen.getByTestId('load')).toHaveTextContent('Creative at 31% — fine')
    expect(screen.getByTestId('load')).toHaveClass('is-ok')
  })

  it('turns amber when the week is full', () => {
    load.people = [{ departmentId: 'dep-c', bookedHours: 44, nominalHours: 40 }]
    view()
    expect(screen.getByTestId('load')).toHaveClass('is-warn')
    expect(screen.getByTestId('load')).toHaveTextContent('Creative at 110%')
  })

  it('says nothing is booked rather than printing a bare 0%', () => {
    load.people = [{ departmentId: 'dep-c', bookedHours: 0, nominalHours: 40 }]
    view()
    expect(screen.getByTestId('load')).toHaveTextContent('Creative at 0% — nothing booked')
    // Amber, as the frame draws it (Edward, 24 Sep).
    expect(screen.getByTestId('load')).toHaveClass('is-warn')
  })

  it('says so when the department has nobody in it yet', () => {
    view()
    expect(screen.getByTestId('load')).toHaveTextContent('Nobody in Creative yet')
  })

  it('says the load is not available when the read fails, rather than a number', () => {
    load.isError = true
    view()
    expect(screen.getByTestId('load-failed')).toHaveTextContent('Load not available')
  })
})
