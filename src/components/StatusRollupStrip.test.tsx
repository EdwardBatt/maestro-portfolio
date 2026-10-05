import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../lib/i18n'
import { StatusRollupStrip } from './StatusRollupStrip'
import type { StatusRollup, TaskCoverage } from '../lib/campaigns/status'

const rollup: StatusRollup = { total: 2, done: 0, blocked: 0, overdue: 0, byState: {} } as unknown as StatusRollup

const coverage = (o: Partial<TaskCoverage>): TaskCoverage => ({
  total: 9, assigned: 0, unassigned: 9, done: 0, held: 0, heldOwners: [], ...o,
})

/**
 * ADR-0090 d.3b: of the unassigned, the part nobody should assign yet is its own line, naming the
 * owner whose approval is owed — in both the gauge and the compact form.
 */
describe('StatusRollupStrip — held work', () => {
  it('says nothing about held work when there is none', () => {
    render(<StatusRollupStrip rollup={rollup} coverage={coverage({})} approved testId="strip" />)
    expect(screen.queryByTestId('strip-held')).toBeNull()
  })

  it('names the held tasks and their owners', () => {
    render(<StatusRollupStrip rollup={rollup} coverage={coverage({ held: 3, heldOwners: ['Fadia'] })} approved testId="strip" />)
    expect(screen.getByTestId('strip-held')).toHaveTextContent("3 task(s) awaiting an owner's review — Fadia")
  })

  it('does the same in the compact form', () => {
    render(<StatusRollupStrip rollup={rollup} coverage={coverage({ held: 2, heldOwners: [] })} approved compact testId="strip" />)
    expect(screen.getByTestId('strip-held')).toHaveTextContent('2 task(s)')
    expect(screen.getByTestId('strip-held')).toHaveTextContent('no owner')
  })
})
