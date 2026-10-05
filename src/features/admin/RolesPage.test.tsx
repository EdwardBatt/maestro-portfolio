import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import '../../lib/i18n'
import type { CatalogEntry, RoleRow } from './api/roles-api'

const toggleMutate = vi.fn()
const updateMutate = vi.fn()

const ROLES: RoleRow[] = [
  { id: 'r-power', key: 'power_admin', name: 'Power Admin', description: null, isSystem: true, defaultRoute: '/admin', status: 'active', scope: 'tenant' },
  { id: 'r-sched', key: 'scheduler', name: 'Scheduler', description: 'Plans bookings', isSystem: false, defaultRoute: '/schedule', status: 'active', scope: 'team' },
  // A role the TENANT created. Its words are theirs, so they stay editable — where a built-in
  // role's words are product copy that follows the interface language (lib/roles/role-text).
  { id: 'r-own', key: 'senior_planner', name: 'Senior Planner', description: 'Ours', isSystem: false, defaultRoute: '/schedule', status: 'active', scope: 'team' },
]

const CATALOG: CatalogEntry[] = [
  { resource: 'schedule', action: 'view', description: 'Master booking grid' },
  { resource: 'bookings', action: 'create', description: 'Create bookings' },
  { resource: 'bookings', action: 'approve', description: 'Approve bookings' },
]

let grantSet = new Set<string>()

// Fully self-contained factory (no importOriginal — the real module's import
// chain reaches lib/env, which throws in CI where no VITE_* env exists).
vi.mock('./api/roles-api', () => ({
  useRolesAdmin: () => ({ data: ROLES, isLoading: false, isError: false }),
  usePermissionCatalog: () => ({ data: CATALOG }),
  useRoleGrants: () => ({ data: grantSet, isLoading: false }),
  useToggleGrant: () => ({ mutate: toggleMutate, isPending: false }),
  useUpdateRole: () => ({ mutate: updateMutate, isPending: false }),
  useCreateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRoleHolderCounts: () => ({ data: new Map([['r-sched', 4]]) }),
}))

import { RolesPage } from './RolesPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <RolesPage />
    </MemoryRouter>,
  )
}

describe('RolesPage (L1.11)', () => {
  beforeEach(() => {
    toggleMutate.mockReset()
    updateMutate.mockReset()
    grantSet = new Set(['schedule:view', 'bookings:create'])
  })

  it('selects the first role and renders the grants matrix from the catalog', () => {
    renderPage()
    // first role is Power Admin (system) — read-only note shown
    expect(screen.getByTestId('role-system-note')).toBeInTheDocument()
    expect(screen.getByTestId('grant-schedule-view')).toBeDisabled()
    expect(screen.getByTestId('grant-bookings-approve')).toBeDisabled()
  })

  it('editable role: checkboxes reflect grants and toggling fires the mutation', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('role-item-scheduler'))
    const viewBox = screen.getByTestId('grant-schedule-view')
    const approveBox = screen.getByTestId('grant-bookings-approve')
    expect(viewBox).toBeChecked()
    expect(approveBox).not.toBeChecked()
    expect(approveBox).toBeEnabled()

    fireEvent.click(approveBox)
    expect(toggleMutate).toHaveBeenCalledWith(
      { roleId: 'r-sched', resource: 'bookings', action: 'approve', granted: true },
      expect.anything(),
    )
    fireEvent.click(viewBox)
    expect(toggleMutate).toHaveBeenCalledWith(
      { roleId: 'r-sched', resource: 'schedule', action: 'view', granted: false },
      expect.anything(),
    )
  })

  it('saves role details through the update mutation', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('role-item-senior_planner'))
    fireEvent.change(screen.getByTestId('role-name'), { target: { value: 'Lead Planner' } })
    fireEvent.submit(screen.getByTestId('role-detail-form'))
    expect(updateMutate).toHaveBeenCalledWith(
      { roleId: 'r-own', name: 'Lead Planner', description: 'Ours', defaultRoute: '/schedule', scope: 'team' },
      expect.anything(),
    )
  })

  // ------------------------------------------------------- built-in role words (6 Sep) ----
  // Edward, reading the Arabic screen: *"arabic is still displaying: Oversees every account —
  // campaigns, clients and briefs across all of them."* Every role's words came from the row,
  // seeded in English, so there was nowhere for the Arabic to live. The thirteen seeded roles are
  // the same in every tenant, which makes their words copy.
  it('a built-in role shows the app words, not the row values, with no field to change them', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('role-item-scheduler'))
    // The row says "Scheduler"; the app calls it Traffic Manager, in whichever language is on.
    expect(screen.getByTestId('role-name-fixed')).toHaveTextContent('Traffic Manager')
    expect(screen.getByTestId('role-description-fixed')).toHaveTextContent('Traffic management')
    expect(screen.getByTestId('role-builtin-note')).toBeInTheDocument()
    expect(screen.queryByTestId('role-name')).not.toBeInTheDocument()
    expect(screen.queryByTestId('role-description')).not.toBeInTheDocument()
  })

  // The form carries no name or description for a built-in role, so the save must send the STORED
  // values back. Reading the absent fields as '' would abort on the empty-name guard, or quietly
  // blank the description of every built-in role the moment somebody changed its landing page.
  it('saving a built-in role leaves its stored name and description untouched', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('role-item-scheduler'))
    fireEvent.change(screen.getByTestId('role-default-route'), { target: { value: '/team' } })
    fireEvent.submit(screen.getByTestId('role-detail-form'))
    expect(updateMutate).toHaveBeenCalledWith(
      { roleId: 'r-sched', name: 'Scheduler', description: 'Plans bookings', defaultRoute: '/team', scope: 'team' },
      expect.anything(),
    )
  })

  it('system roles hide archive/save actions entirely (absence, not disabling)', () => {
    renderPage()
    expect(screen.queryByTestId('role-archive')).not.toBeInTheDocument()
    expect(screen.queryByTestId('role-save')).not.toBeInTheDocument()
  })

  // ---------------------------------------------------------------- ADR-0041 ----
  // Reach used to be invisible here, which is how a role came to span the whole company
  // without anyone choosing it.
  it('shows every role reach in the list', () => {
    renderPage()
    expect(screen.getByTestId('role-reach-power_admin')).toHaveTextContent('The whole organisation')
    expect(screen.getByTestId('role-reach-scheduler')).toHaveTextContent('Their own team')
  })

  it("a system role's reach is not editable", () => {
    renderPage()
    expect(screen.getByTestId('role-scope')).toBeDisabled()
  })

  it('changing reach does NOT save until confirmed, and says how many people it affects', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('role-item-scheduler'))
    fireEvent.change(screen.getByTestId('role-scope'), { target: { value: 'tenant' } })
    fireEvent.submit(screen.getByTestId('role-detail-form'))

    expect(updateMutate).not.toHaveBeenCalled()
    expect(screen.getByTestId('role-reach-confirm')).toBeInTheDocument()
    expect(screen.getByTestId('role-reach-holders')).toHaveTextContent('4')
    // team → tenant is a widening: holders gain authority they did not have
    expect(screen.getByTestId('role-reach-widening')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('role-reach-confirm-save'))
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ roleId: 'r-sched', scope: 'tenant' }),
      expect.anything(),
    )
  })

  it('cancelling the reach confirmation abandons the whole save', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('role-item-scheduler'))
    fireEvent.change(screen.getByTestId('role-scope'), { target: { value: 'self' } })
    fireEvent.submit(screen.getByTestId('role-detail-form'))
    // narrowing: no widening warning
    expect(screen.queryByTestId('role-reach-widening')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('role-reach-cancel'))
    expect(updateMutate).not.toHaveBeenCalled()
    expect(screen.queryByTestId('role-reach-confirm')).not.toBeInTheDocument()
  })

  it('saving without touching reach never asks for confirmation', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('role-item-senior_planner'))
    fireEvent.change(screen.getByTestId('role-name'), { target: { value: 'Planner' } })
    fireEvent.submit(screen.getByTestId('role-detail-form'))
    expect(screen.queryByTestId('role-reach-confirm')).not.toBeInTheDocument()
    expect(updateMutate).toHaveBeenCalled()
  })
})
