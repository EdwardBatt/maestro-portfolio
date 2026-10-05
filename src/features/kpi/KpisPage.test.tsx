import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../../lib/i18n'
import type { KpiDefinition, MyKpi, ScorecardRow, UserOption } from './api/kpi-api'

/**
 * KpisPage (ADR-0029, I7.4) with the confirmed visibility rules. api + permissions + auth are mocked
 * (they reach lib/env in CI). Proves: everyone sees their personal scorecard; oversight (individual
 * drill-down + rollup) shows for kpi:manage OR health:view; definition/manual-target management stays
 * kpi:manage only (execs are read-only oversight).
 */
const state = vi.hoisted(() => ({
  mine: [] as MyKpi[],
  defs: [] as KpiDefinition[],
  users: [] as UserOption[],
  scorecards: [] as ScorecardRow[],
  grants: new Set<string>(),
  saveDef: vi.fn(),
  saveTarget: vi.fn(),
}))

vi.mock('./api/kpi-api', () => ({
  useMyKpis: () => ({ data: state.mine, isLoading: false }),
  useKpiDefinitions: () => ({ data: state.defs }),
  useTenantUsers: () => ({ data: state.users }),
  useKpiScorecards: () => ({ data: state.scorecards, isLoading: false }),
  useKpiRollup: () => ({ data: [] }),
  useSaveKpiDefinition: () => ({ mutate: state.saveDef, isPending: false }),
  useSaveKpiTarget: () => ({ mutate: state.saveTarget, isPending: false }),
}))
vi.mock('../../app/permissions', () => ({
  usePermissions: () => ({ can: (k: string) => state.grants.has(k) }),
}))
vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }))

import { KpisPage } from './KpisPage'

const K: MyKpi = { id: 'k1', name: 'On-time', unit: '%', higherIsBetter: true, periodStart: '2026-08-01', periodEnd: '2026-08-31', target: 90, actual: 80 }
const SC: ScorecardRow = { id: 's1', userId: 'u9', name: 'On-time', unit: '%', higherIsBetter: true, periodStart: '2026-08-01', periodEnd: '2026-08-31', target: 90, actual: 70 }

describe('KpisPage (ADR-0029, I7.4)', () => {
  beforeEach(() => {
    state.mine = []
    state.defs = []
    state.users = []
    state.scorecards = []
    state.grants = new Set<string>()
  })

  it('shows my scorecard rows', () => {
    state.mine = [K]
    render(<KpisPage />)
    expect(screen.getByTestId('kpi-my-row-k1')).toHaveTextContent('On-time')
  })

  it('hides oversight and management from a plain member (no grants)', () => {
    render(<KpisPage />)
    expect(screen.queryByTestId('kpi-oversight')).not.toBeInTheDocument()
    expect(screen.queryByTestId('kpi-manage')).not.toBeInTheDocument()
  })

  it('shows oversight (drill-down + rollup) but NOT management to health:view execs', () => {
    state.grants = new Set(['health:view'])
    state.users = [{ id: 'u9', name: 'Sara' }]
    state.scorecards = [SC]
    render(<KpisPage />)
    expect(screen.getByTestId('kpi-oversight')).toBeInTheDocument()
    expect(screen.getByTestId('kpi-individual-row-s1')).toHaveTextContent('Sara')
    expect(screen.getByTestId('kpi-rollup-load')).toBeInTheDocument()
    // execs are read-only oversight — no definition/target forms
    expect(screen.queryByTestId('kpi-manage')).not.toBeInTheDocument()
  })

  it('shows both oversight and management to kpi:manage holders', () => {
    state.grants = new Set(['kpi:manage'])
    render(<KpisPage />)
    expect(screen.getByTestId('kpi-oversight')).toBeInTheDocument()
    expect(screen.getByTestId('kpi-manage')).toBeInTheDocument()
    expect(screen.getByTestId('kpi-def-form')).toBeInTheDocument()
    expect(screen.getByTestId('kpi-target-form')).toBeInTheDocument()
  })
})
