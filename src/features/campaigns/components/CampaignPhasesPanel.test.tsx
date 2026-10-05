import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import i18n from '../../../lib/i18n'
import { CampaignPhasesPanel, type CampaignPhaseRow } from './CampaignPhasesPanel'

/**
 * `I56.10` — Figma `CB-v3-01`, right panel, and ADR-0096.
 *
 * The English strings are registered here because the panel lands ahead of them; what is asserted
 * is the behaviour, not the wording. Since ADR-0116 (27 Sep) there is no switch: a campaign uses
 * phases when it has one, and the card always offers + Add a phase.
 */
i18n.addResourceBundle(
  'en',
  'translation',
  {
    phasesPanel: {
      title: 'The phases',
      toggleLabel: 'Run this campaign in phases',
      explain:
        'Maestro plans each phase backwards from its own end date — not from a single go-live.',
      offBody: 'This campaign does not run in phases. Everything is planned back from one go-live date.',
      add: '+ Add a phase',
    },
  },
  true,
  true,
)

const PHASES: CampaignPhaseRow[] = [
  { id: 'p1', name: 'Pre-Launch', dates: '12 – 18 Sep' },
  { id: 'p2', name: 'Week 1', dates: '18 – 25 Sep', isCurrent: true },
  { id: 'p3', name: 'Post-Season', dates: '17 Oct +' },
]

function view(over: Partial<React.ComponentProps<typeof CampaignPhasesPanel>> = {}) {
  const props: React.ComponentProps<typeof CampaignPhasesPanel> = {
    phases: PHASES,
    note: 'LUMA runs on Friday draw nights, so every week ends on one.',
    onAddPhase: vi.fn(),
    onEditPhase: vi.fn(),
    ...over,
  }
  render(<CampaignPhasesPanel {...props} />)
  return props
}

describe('CampaignPhasesPanel (I56.10, ADR-0096)', () => {
  it('has no switch — with no phases it shows the line and + Add a phase, as CB-v3-01 does (ADR-0116)', () => {
    const props = view({ phases: [] })
    expect(screen.queryByTestId('phases-toggle')).not.toBeInTheDocument()
    expect(screen.queryByTestId('phases-off')).not.toBeInTheDocument()
    expect(screen.getByTestId('phases-explain')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('phases-add'))
    expect(props.onAddPhase).toHaveBeenCalled()
  })

  it('shows a phase as its dates, with no event chip (Edward, 24 Sep)', () => {
    view()
    expect(screen.getByTestId('phases-row-p1')).toHaveTextContent('12 – 18 Sep')
    expect(screen.queryByTestId('phases-event-p1')).not.toBeInTheDocument()
  })

  it('marks the phase the campaign is in now', () => {
    view()
    expect(screen.getByTestId('phases-row-p2').className).toContain('is-current')
    expect(screen.getByTestId('phases-row-p1').className).not.toContain('is-current')
  })

  it('carries the campaign’s own rhythm in front of the general explanation', () => {
    view()
    expect(screen.getByTestId('phases-explain')).toHaveTextContent('LUMA runs on Friday draw nights')
    expect(screen.getByTestId('phases-explain')).toHaveTextContent('backwards from its own end date')
  })

  it('still explains itself on a campaign with no story of its own', () => {
    view({ note: null })
    expect(screen.getByTestId('phases-explain')).toHaveTextContent('backwards from its own end date')
  })

  it('hands a phase back by id to add and to edit', () => {
    const props = view()
    fireEvent.click(screen.getByTestId('phases-edit-p3'))
    expect(props.onEditPhase).toHaveBeenCalledWith('p3')
    fireEvent.click(screen.getByTestId('phases-add'))
    expect(props.onAddPhase).toHaveBeenCalledTimes(1)
  })
})
