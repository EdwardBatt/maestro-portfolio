import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../../lib/i18n'
import type { CatalogEntry } from '../api/roles-api'
import type { AdminUser } from '../api/admin-api'
import type { GrantEffect } from '../api/user-grants-api'

const setGrantMutate = vi.fn()
const addScopeMutate = vi.fn()
const removeScopeMutate = vi.fn()

const CATALOG: CatalogEntry[] = [
  { resource: 'schedule', action: 'view', description: 'Master booking grid' },
  { resource: 'bookings', action: 'create', description: 'Create bookings' },
  { resource: 'bookings', action: 'approve', description: 'Approve bookings' },
  { resource: 'user_grants', action: 'manage', description: 'Manage per-user grants' },
]

// Self-contained factories (no importOriginal — the real chain reaches lib/env, which throws in CI).
vi.mock('../api/roles-api', () => ({
  usePermissionCatalog: () => ({ data: CATALOG, isLoading: false }),
  // the role grants schedule:view + bookings:create
  useRoleGrants: () => ({ data: new Set(['schedule:view', 'bookings:create']), isLoading: false }),
}))

vi.mock('../api/admin-api', () => ({
  useDepartments: () => ({ data: [{ id: 'd1', name: 'Creative' }] }),
  useTeams: () => ({ data: [{ id: 't1', name: 'Art', departmentId: 'd1', departmentName: 'Creative' }] }),
}))

vi.mock('../api/user-grants-api', () => ({
  // deny bookings:create (should lose to nothing → effective No), allow bookings:approve
  useUserGrants: () => ({
    data: new Map<string, GrantEffect>([
      ['bookings:create', 'deny'],
      ['bookings:approve', 'allow'],
    ]),
    isLoading: false,
  }),
  useUserScopeGrants: () => ({ data: [] }),
  useSetUserGrant: () => ({ mutate: setGrantMutate, isPending: false }),
  useAddScopeGrant: () => ({ mutate: addScopeMutate, isPending: false }),
  useRemoveScopeGrant: () => ({ mutate: removeScopeMutate, isPending: false }),
}))

import { UserPermissionsDialog } from './UserPermissionsDialog'

const USER: AdminUser = {
  id: 'u1',
  displayName: 'Rana',
  email: 'rana@example.test',
  roleId: 'r-tm',
  roleName: 'Team Member',
  roleKey: 'team_member',
  locale: 'en',
  isActive: true,
  officeId: null,
  officeName: null,
  departmentId: null,
  departmentName: null,
  teamId: null,
  teamName: null,
  jobTitle: null,
}

function renderDialog() {
  return render(<UserPermissionsDialog user={USER} onClose={vi.fn()} />)
}

describe('UserPermissionsDialog (L6.4b, ADR-0036)', () => {
  beforeEach(() => {
    setGrantMutate.mockReset()
    addScopeMutate.mockReset()
    removeScopeMutate.mockReset()
  })

  it('computes effective permissions with deny-precedence', () => {
    renderDialog()
    // role grant, no override → effective
    expect(screen.getByTestId('effective-schedule-view')).toHaveTextContent('Yes')
    // role grant BUT user deny → not effective (deny wins)
    expect(screen.getByTestId('effective-bookings-create')).toHaveTextContent('No')
    // no role grant BUT user allow → effective
    expect(screen.getByTestId('effective-bookings-approve')).toHaveTextContent('Yes')
    // neither → not effective
    expect(screen.getByTestId('effective-user_grants-manage')).toHaveTextContent('No')
  })

  it('changing an override fires setGrant with the chosen effect', () => {
    renderDialog()
    fireEvent.change(screen.getByTestId('override-schedule-view'), { target: { value: 'deny' } })
    expect(setGrantMutate).toHaveBeenCalledWith(
      { userId: 'u1', resource: 'schedule', action: 'view', effect: 'deny' },
      expect.anything(),
    )
  })

  it('disables Deny for the un-deniable RBAC-admin grants', () => {
    renderDialog()
    const select = screen.getByTestId('override-user_grants-manage') as HTMLSelectElement
    const denyOption = Array.from(select.options).find((o) => o.value === 'deny')
    expect(denyOption?.disabled).toBe(true)
  })

  it('adds a scope target', () => {
    renderDialog()
    fireEvent.change(screen.getByTestId('scope-pick'), { target: { value: 'dept:d1' } })
    fireEvent.click(screen.getByTestId('scope-add'))
    expect(addScopeMutate).toHaveBeenCalledWith(
      { userId: 'u1', departmentId: 'd1', teamId: null },
      expect.anything(),
    )
  })
})
