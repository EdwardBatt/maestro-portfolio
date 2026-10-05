import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../../lib/i18n'
import { planCampaign, type PlanPhase, type PlanPiece } from '../../../lib/timing/plan-back'
import { TimingStep } from './TimingStep'

/**
 * `I56.11` — the timing table, on the frame's own data (`CB-v3-04`, LUMA Season 2, Week 2), with
 * the Edit on every phase and every piece Edward asked for (24 Sep).
 *
 * The arithmetic has its own suite; what is worth holding HERE is that the screen shows what was
 * planned, that every row offers the ONE action (Edit) and every phase its pencil, that a row
 * short of its run-up is visibly amber, and that the strip is one violet family — never a status.
 */
const PHASES: PlanPhase[] = [
  { id: 'w1', name: 'Week 1', eventName: null, endsOn: '2026-09-25', startsOn: '2026-09-18' },
  { id: 'w2', name: 'Week 2', eventName: null, endsOn: '2026-10-02', startsOn: '2026-09-26' },
  { id: 'w3', name: 'Week 3', eventName: null, endsOn: '2026-10-09', startsOn: '2026-10-03' },
]

const PIECES: PlanPiece[] = [
  { id: 'da', code: 'DA-017', name: 'Group mechanic explainer', departmentName: 'Creative', phaseId: 'w2', needsWorkingDays: 4 },
  { id: 'mc', code: 'MC-003', name: 'Mini TVC 20s', departmentName: 'Content', phaseId: 'w2', needsWorkingDays: 9 },
  { id: 'nc', code: '', name: 'Uncoded caption', departmentName: 'Content', phaseId: 'w2', needsWorkingDays: 2, givenToClient: true },
  { id: 'w1a', code: 'DA-009', name: 'Teaser', departmentName: 'Creative', phaseId: 'w1', needsWorkingDays: 2 },
]

function view(over: Partial<React.ComponentProps<typeof TimingStep>> = {}, today = '2026-09-14') {
  const plan = planCampaign(PHASES, PIECES, { today })
  const props = {
    plan,
    selectedPhaseId: 'w2',
    onSelectPhase: vi.fn(),
    onEditPhase: vi.fn(),
    onAddPhase: vi.fn(),
    onEditPiece: vi.fn(),
    ...over,
  }
  render(<TimingStep {...props} />)
  return props
}

// I66.8: a date shows its year only when it is not this year, so pin "today" (the date only).
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-29T09:00:00Z'))
})
afterEach(() => { vi.useRealTimers() })

describe('TimingStep (CB-v3-04)', () => {
  it('shows the open phase planned back from its end, with the dates the plan gave', () => {
    view()
    const row = screen.getByTestId('timing-row-da')
    expect(row).toHaveTextContent('DA-017')
    expect(screen.getByTestId('timing-starts-da')).toHaveTextContent('Sun, 27 Sep') // four working days back, inclusive
    expect(screen.getByTestId('timing-due-da')).toHaveTextContent('Wed, 30 Sep') // two working days before Fri, 2 Oct
    expect(screen.getByTestId('timing-needs-da')).toHaveTextContent('4 days')
    // The nine-day piece starts in the phase BEFORE its own; the screen shows it, not an error.
    expect(screen.getByTestId('timing-starts-mc')).toHaveTextContent('Sun, 20 Sep')
  })

  it('shows only the open phase, and the strip picks another', () => {
    const p = view()
    expect(screen.queryByTestId('timing-row-w1a')).toBeNull()
    fireEvent.click(screen.getByTestId('timing-phase-w1'))
    expect(p.onSelectPhase).toHaveBeenCalledWith('w1')
  })

  it('offers Edit on every row and a pencil on every phase — the frame had neither (Edward, 24 Sep)', () => {
    const p = view()
    fireEvent.click(screen.getByTestId('timing-edit-da'))
    expect(p.onEditPiece).toHaveBeenCalledWith('da')
    fireEvent.click(screen.getByTestId('timing-phase-edit-w3'))
    expect(p.onEditPhase).toHaveBeenCalledWith('w3')
    fireEvent.click(screen.getByTestId('timing-add-phase'))
    expect(p.onAddPhase).toHaveBeenCalled()
    // Moving is what a date does now; there is no separate Move or Given-to-client button.
    expect(screen.queryByText('MOVE')).toBeNull()
  })

  it('hides the pencils and the add tile where the caller may not change phases', () => {
    view({ onEditPhase: null, onAddPhase: null })
    expect(screen.queryByTestId('timing-phase-edit-w1')).toBeNull()
    expect(screen.queryByTestId('timing-add-phase')).toBeNull()
  })

  it('names the end day under each phase, not an event', () => {
    view()
    expect(screen.getByTestId('timing-phase-w2').closest('.timing-phase-block')).toHaveTextContent('Fri, 2 Oct')
    expect(screen.queryByText(/Draw Night/)).toBeNull()
  })

  it('draws the strip in one violet family, the open phase solid — never a status colour', () => {
    view()
    const block = (id: string) => screen.getByTestId(`timing-phase-${id}`).closest('.timing-phase-block') as HTMLElement
    const shade = (id: string) => parseInt(block(id).style.getPropertyValue('--phase-shade'), 10)
    // A step lighter per phase, in season order.
    expect(shade('w1')).toBeGreaterThan(shade('w2'))
    expect(shade('w2')).toBeGreaterThan(shade('w3'))
    expect(block('w2')).toHaveAttribute('data-open')
    expect(block('w1').getAttribute('style')).not.toMatch(/status|amber|green/)
  })

  it('shows a piece with no code yet without a stray separator, and its given-to-client mark', () => {
    view()
    expect(screen.getByTestId('timing-row-nc')).toHaveTextContent(/^Uncoded caption/)
    expect(screen.getByTestId('timing-given-tag-nc')).toHaveTextContent('GIVEN TO CLIENT')
  })

  it('carries the department load line the caller gave, and invents none where it gave none', () => {
    view({ capacity: { da: <span className="is-ok">Creative at 31% — fine</span> } })
    expect(screen.getByTestId('timing-capacity-da')).toHaveTextContent('Creative at 31% — fine')
    expect(screen.getByTestId('timing-capacity-mc')).toHaveTextContent('')
  })

  it('makes a row short of its run-up amber and says by how much', () => {
    // Today is Wed 30 Sept: the four-day piece due that day has one working day left.
    view({}, '2026-09-30')
    expect(screen.getByTestId('timing-row-da')).toHaveAttribute('data-fit', 'reduced_scope')
    expect(screen.getByTestId('timing-short-da')).toHaveTextContent('1 working day left — it needs 4')
  })
})
