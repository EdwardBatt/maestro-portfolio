import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import '../../lib/i18n'
import type { DepartmentRow } from './api/org-api'

const createMutate = vi.fn()
const renameMutate = vi.fn()
const deleteMutate = vi.fn()

const DEPTS: DepartmentRow[] = [
  { id: 'd1', name: 'Creative', memberCount: 3, resourceCount: 3, isProduction: true },
  { id: 'd2', name: 'Influencers', memberCount: 0, resourceCount: 0, isProduction: true },
]

// Fully self-contained factory (no importOriginal — the real module's import
// chain reaches lib/env, which throws in CI where no VITE_* env exists).
vi.mock('./api/org-api', () => ({
  useDepartmentsAdmin: () => ({ data: DEPTS, isLoading: false, isError: false }),
  useCreateDepartment: () => ({ mutate: createMutate, isPending: false }),
  useRenameDepartment: () => ({ mutate: renameMutate, isPending: false }),
  useDeleteDepartment: () => ({ mutate: deleteMutate, isPending: false }),
  useSetDepartmentProduction: () => ({ mutate: vi.fn(), isPending: false }),
  useTeamsAdmin: () => ({ data: [], isLoading: false, isError: false }),
  useCreateTeam: () => ({ mutate: vi.fn(), isPending: false }),
  useRenameTeam: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteTeam: () => ({ mutate: vi.fn(), isPending: false }),
  useOfficesAdmin: () => ({ data: [], isLoading: false, isError: false }),
  useCreateOffice: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateOffice: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteOffice: () => ({ mutate: vi.fn(), isPending: false }),
  // clients/brands moved to the Client Registration surface (ADR-0021)
}))

// One stable object, as react-query would hand back — a fresh one per render would re-sync the
// draft forever. `vi.hoisted` because the mock factory is hoisted above every top-level const.
const { saveSettings, SETTINGS } = vi.hoisted(() => ({
  saveSettings: vi.fn(),
  SETTINGS: { rule: { deliveryDaysBeforeGoLive: 2, commenceDaysBeforeDelivery: 4 }, reviewBufferWorkingDays: 1 },
}))
vi.mock('../../lib/settings/scheduling-settings-api', () => ({
  DEFAULT_SCHEDULING_SETTINGS: SETTINGS,
  useSchedulingSettings: () => ({ data: SETTINGS, isLoading: false, isError: false }),
  useUpdateSchedulingSettings: () => ({ mutate: saveSettings, isPending: false }),
}))

// I59.24: the escalation section has its own suite (EscalationSettingsSection.test.tsx); stubbed here.
vi.mock('./components/EscalationSettingsSection', () => ({ EscalationSettingsSection: () => null }))

import { OrganizationPage } from './OrganizationPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <OrganizationPage />
    </MemoryRouter>,
  )
}

describe('OrganizationPage — departments (L1.5)', () => {
  beforeEach(() => {
    createMutate.mockReset()
    renameMutate.mockReset()
    deleteMutate.mockReset()
  })

  it('lists departments with member and resource counts', () => {
    renderPage()
    expect(screen.getByTestId('dept-row-d1')).toHaveTextContent('Creative')
    expect(screen.getByTestId('dept-row-d1')).toHaveTextContent('3')
  })

  it('adds a department', () => {
    renderPage()
    fireEvent.change(screen.getByTestId('dept-add-name'), { target: { value: 'Accounting' } })
    fireEvent.submit(screen.getByTestId('dept-add-form'))
    expect(createMutate).toHaveBeenCalledWith('Accounting', expect.anything())
  })

  it('renames inline on Enter', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('dept-rename-d2'))
    const input = screen.getByTestId('dept-edit-d2')
    fireEvent.change(input, { target: { value: 'Influencer Marketing' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(renameMutate).toHaveBeenCalledWith(
      { id: 'd2', name: 'Influencer Marketing' },
      expect.anything(),
    )
  })

  it('delete is two-step: arm, then confirm', () => {
    renderPage()
    const btn = screen.getByTestId('dept-delete-d2')
    fireEvent.click(btn)
    expect(deleteMutate).not.toHaveBeenCalled()
    fireEvent.click(btn)
    expect(deleteMutate).toHaveBeenCalledWith('d2', expect.anything())
  })
})

// I41.10 — the scheduling numbers are settings, edited here (ADR-0075 d.5).
describe('OrganizationPage — scheduling rules (I41.10)', () => {
  it('shows the three numbers and saves the edited rule', () => {
    render(
      <MemoryRouter>
        <OrganizationPage />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('scheduling-delivery-days')).toHaveValue(2)
    expect(screen.getByTestId('scheduling-commence-days')).toHaveValue(4)
    expect(screen.getByTestId('scheduling-review-buffer')).toHaveValue(1)
    // Nothing to save until something changed.
    expect(screen.getByTestId('scheduling-settings-save')).toBeDisabled()
    fireEvent.change(screen.getByTestId('scheduling-delivery-days'), { target: { value: '3' } })
    fireEvent.submit(screen.getByTestId('scheduling-settings-form'))
    expect(saveSettings).toHaveBeenCalledWith(
      { rule: { deliveryDaysBeforeGoLive: 3, commenceDaysBeforeDelivery: 4 }, reviewBufferWorkingDays: 1 },
      expect.anything(),
    )
  })
})
