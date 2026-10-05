import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import '../lib/i18n'
import { BackButton } from './BackButton'
import { recordVisit, resetOrigin } from '../lib/navigation/origin'

function Where() {
  const l = useLocation()
  return <p data-testid="where">{`${l.pathname}${l.search}`}</p>
}

const renderAt = (entry: string | { pathname: string; state: unknown }) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/campaigns/:id" element={<BackButton fallback={{ path: '/campaigns', labelKey: 'back.campaignsBare' }} />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )

/** ADR-0132 d.7 (I68.9). */
describe('BackButton', () => {
  beforeEach(() => resetOrigin())

  it('names the page a person came from and returns to it as it was left', () => {
    recordVisit('/team?tab=timeline&on=2026-09-27')
    renderAt('/campaigns/c1?piece=d1')
    const back = screen.getByTestId('back-button')
    expect(back).toHaveTextContent('Back to Team')
    fireEvent.click(back)
    expect(screen.getByTestId('where')).toHaveTextContent('/team?tab=timeline&on=2026-09-27')
  })

  it('with nowhere before, uses the page\'s fallback', () => {
    renderAt('/campaigns/c1')
    expect(screen.getByTestId('back-button')).toHaveTextContent('Campaigns')
    fireEvent.click(screen.getByTestId('back-button'))
    expect(screen.getByTestId('where')).toHaveTextContent('/campaigns')
  })
})
