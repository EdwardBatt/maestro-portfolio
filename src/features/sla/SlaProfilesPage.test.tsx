import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../lib/i18n'
import type { SlaProfile } from './api/sla-api'

/**
 * SlaProfilesPage (ADR-0029, I7.3). The api module reaches lib/env (throws in CI) so it's mocked;
 * the test proves the empty state, that profiles list, and that the form submits.
 */
const state = vi.hoisted(() => ({
  profiles: [] as SlaProfile[],
  save: vi.fn(),
}))

// I21 (ADR-0056): `useWorkTypes` is gone with the table it read. The gated ADR-0053 d.4 columns
// (I20.3) will bring department and deliverable-type pickers; until then a profile has no axis.
vi.mock('./api/sla-api', () => ({
  useSlaProfiles: () => ({ data: state.profiles, isLoading: false, isError: false }),
  useSaveSlaProfile: () => ({ mutate: state.save, isPending: false }),
}))

import { SlaProfilesPage } from './SlaProfilesPage'

const P: SlaProfile = { id: 'p1', name: 'Standard', turnaroundHours: 48, isDefault: true }

describe('SlaProfilesPage (ADR-0029, I7.3)', () => {
  beforeEach(() => {
    state.profiles = []
    state.save = vi.fn()
  })

  it('shows the empty state with no profiles', () => {
    render(<SlaProfilesPage />)
    expect(screen.getByTestId('sla-empty')).toBeInTheDocument()
    expect(screen.getByTestId('sla-form')).toBeInTheDocument()
  })

  it('lists profiles and submits a new one', () => {
    state.profiles = [P]
    render(<SlaProfilesPage />)
    expect(screen.getByTestId('sla-row-p1')).toHaveTextContent('Standard')
    fireEvent.change(screen.getByTestId('sla-name'), { target: { value: 'Rush' } })
    fireEvent.change(screen.getByTestId('sla-hours'), { target: { value: '8' } })
    fireEvent.submit(screen.getByTestId('sla-form'))
    expect(state.save).toHaveBeenCalled()
  })

  // I21 (ADR-0056 d.5). Removing the picker must not leave a screen that quietly implies every
  // profile is scoped to something. The gap is stated, not left to be deduced from its absence.
  it('offers no axis picker, and says why every profile is tenant-wide', () => {
    state.profiles = [P]
    render(<SlaProfilesPage />)
    expect(screen.queryByTestId('sla-worktype')).not.toBeInTheDocument()
    expect(screen.getByTestId('sla-no-axis')).toBeInTheDocument()
  })

  it('sends no axis with a saved profile', () => {
    render(<SlaProfilesPage />)
    fireEvent.change(screen.getByTestId('sla-name'), { target: { value: 'Rush' } })
    fireEvent.change(screen.getByTestId('sla-hours'), { target: { value: '8' } })
    fireEvent.submit(screen.getByTestId('sla-form'))
    expect(state.save).toHaveBeenCalledWith(
      { id: undefined, name: 'Rush', turnaroundHours: 8, isDefault: false },
      expect.anything(),
    )
  })
})
