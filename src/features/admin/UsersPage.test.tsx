import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import '../../lib/i18n'
import type { AdminUser } from './api/admin-api'

const mutate = vi.fn()
const resetMutate = vi.fn()

const R = {
  power: 'aaaa1111-0000-0000-0000-000000000001',
  scheduler: 'aaaa1111-0000-0000-0000-000000000002',
  member: 'aaaa1111-0000-0000-0000-000000000003',
  portal: 'aaaa1111-0000-0000-0000-000000000004',
}

const USERS: AdminUser[] = [
  { id: 'self-id', displayName: 'Edward', email: 'edward@example.test', roleId: R.power, roleName: 'Power Admin', roleKey: 'power_admin', locale: 'en', isActive: true, officeId: null, officeName: null, departmentId: null, departmentName: null, teamId: null, teamName: null, jobTitle: 'IT Manager' },
  { id: 'u2', displayName: 'Sarah Haddad', email: 'sarah@example.test', roleId: R.member, roleName: 'Team Member', roleKey: 'team_member', locale: 'en', isActive: true, officeId: 'o1', officeName: 'Baghdad', departmentId: 'd1', departmentName: 'Creative', teamId: null, teamName: null, jobTitle: 'Designer' },
  { id: 'u3', displayName: 'Former Staffer', email: 'gone@example.test', roleId: R.member, roleName: 'Team Member', roleKey: 'team_member', locale: 'en', isActive: false, officeId: null, officeName: null, departmentId: null, departmentName: null, teamId: null, teamName: null, jobTitle: null },
  // team tm1 belongs to Creative (d1) but this user's department is d2 → mismatch
  { id: 'u4', displayName: 'Misfit Mona', email: 'mona@example.test', roleId: R.member, roleName: 'Team Member', roleKey: 'team_member', locale: 'en', isActive: true, officeId: null, officeName: null, departmentId: 'd2', departmentName: 'Performance', teamId: 'tm1', teamName: 'Art & Video', jobTitle: null },
  // a client_portal account: L6.4b must NOT offer the permissions editor on external identities
  { id: 'u5', displayName: 'Portal Guest', email: 'guest@client.test', roleId: R.portal, roleName: 'Client Portal', roleKey: 'client_portal', locale: 'en', isActive: true, officeId: null, officeName: null, departmentId: null, departmentName: null, teamId: null, teamName: null, jobTitle: null },
]

// Fully self-contained factory — no importOriginal: evaluating the real
// module would pull in lib/supabase → lib/env, whose zod parse fails in CI
// where no VITE_* env exists. Every hook the page + dialog use is stubbed.
vi.mock('./api/admin-api', () => {
  return {
    useUsers: () => ({ data: USERS, isLoading: false, isError: false }),
    useAssignableRoles: () => ({
      data: [
        { id: R.power, key: 'power_admin', name: 'Power Admin', isSystem: true },
        { id: R.scheduler, key: 'scheduler', name: 'Scheduler', isSystem: false },
        { id: R.member, key: 'team_member', name: 'Team Member', isSystem: false },
      ],
    }),
    useOffices: () => ({ data: [{ id: 'o1', name: 'Baghdad' }] }),
    useDepartments: () => ({ data: [{ id: 'd1', name: 'Creative' }] }),
    useTeams: () => ({ data: [{ id: 'tm1', name: 'Art & Video', departmentId: 'd1', departmentName: 'Creative' }] }),
    useUnlinkedHumanResources: () => ({ data: [] }),
    useUserStatus: () => ({
      data: {
        u2: { lastSignInAt: '2026-08-14T09:00:00Z', activated: true },
        u4: { lastSignInAt: null, activated: false },
      },
      isLoading: false,
      isError: false,
    }),
    useInviteUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useUpdateUser: () => ({ mutate, isPending: false }),
    useSendPasswordReset: () => ({ mutate: resetMutate, isPending: false }),
  }
})

// ADR-0133: one person is Leaving — access gone, 3 items still to hand over.
const leaving = vi.hoisted(() => ({ list: [] as { id: string; name: string; itemsRemaining: number }[] }))
vi.mock('./api/handover-api', () => ({ handoverKeys: { all: ['handover'] }, useLeavingPeople: () => ({ data: leaving.list }) }))
vi.mock('@tanstack/react-query', async (orig) => ({ ...(await orig<object>()), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }))

vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({
    session: { user: { id: 'self-id' } },
    claims: { tenantId: 't1', roleId: 'aaaa1111-0000-0000-0000-000000000001' },
    ready: true,
    signOut: vi.fn(),
  }),
}))

// L6.4b: the page now shows a permissions-editor action + renders UserPermissionsDialog.
// Mock permissions (grant user_grants:manage so the action shows) and the dialog's API
// modules (they import lib/supabase → lib/env, which throws in CI without VITE_* env).
vi.mock('../../app/permissions', () => ({
  usePermissions: () => ({ can: (k: string) => k === 'user_grants:manage' }),
}))
vi.mock('./api/roles-api', () => ({
  usePermissionCatalog: () => ({ data: [], isLoading: false }),
  useRoleGrants: () => ({ data: new Set(), isLoading: false }),
}))
vi.mock('./api/user-grants-api', () => ({
  useUserGrants: () => ({ data: new Map(), isLoading: false }),
  useUserScopeGrants: () => ({ data: [] }),
  useSetUserGrant: () => ({ mutate: vi.fn(), isPending: false }),
  useAddScopeGrant: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveScopeGrant: () => ({ mutate: vi.fn(), isPending: false }),
}))

import { UsersPage } from './UsersPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <UsersPage />
    </MemoryRouter>,
  )
}

describe('UsersPage (L1.1)', () => {
  beforeEach(() => {
    mutate.mockReset()
    resetMutate.mockReset()
  })

  it('lists users with email, role, and status', () => {
    renderPage()
    expect(screen.getByText('sarah@example.test')).toBeInTheDocument()
    expect(screen.getByTestId('user-row-u3')).toHaveClass('row-inactive')
    // self row cannot change its own role or deactivate itself (server guard mirrored)
    expect(screen.getByTestId('role-self-id')).toBeDisabled()
    expect(screen.getByTestId('toggle-active-self-id')).toBeDisabled()
  })

  it('shows the permissions-editor action for others, but not for yourself or portal users (L6.4b)', () => {
    renderPage()
    expect(screen.getByTestId('perms-u2')).toBeInTheDocument()
    expect(screen.queryByTestId('perms-self-id')).not.toBeInTheDocument()
    expect(screen.queryByTestId('perms-u5')).not.toBeInTheDocument() // client_portal fenced
  })

  it('groups the roster by department and team, unassigned last', () => {
    renderPage()
    expect(screen.getByTestId('user-group-d1|')).toHaveTextContent('Creative') // u2, no team
    expect(screen.getByTestId('user-group-d2|tm1')).toHaveTextContent('Art & Video') // u4
    expect(screen.getByTestId('user-group-|')).toHaveTextContent('Unassigned') // self/u3/u5
  })

  it('filters the roster by search and reports the shown count', () => {
    renderPage()
    fireEvent.change(screen.getByTestId('users-filter-search'), { target: { value: 'sarah' } })
    expect(screen.getByTestId('user-row-u2')).toBeInTheDocument()
    expect(screen.queryByTestId('user-row-u3')).not.toBeInTheDocument()
    expect(screen.getByTestId('users-showing-count')).toBeInTheDocument()
  })

  it('clears every filter, including the search box', () => {
    renderPage()
    fireEvent.change(screen.getByTestId('users-filter-search'), { target: { value: 'sarah' } })
    fireEvent.change(screen.getByTestId('users-filter-department'), { target: { value: 'd1' } })
    expect(screen.queryByTestId('user-row-u3')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('users-filter-clear'))
    expect(screen.getByTestId('user-row-u3')).toBeInTheDocument()
    expect(screen.getByTestId('users-filter-search')).toHaveValue('')
  })

  it('selecting a department clears a previously-set team filter atomically', () => {
    renderPage()
    fireEvent.change(screen.getByTestId('users-filter-team'), { target: { value: 'tm1' } })
    expect(screen.getByTestId('user-row-u4')).toBeInTheDocument()
    expect(screen.queryByTestId('user-row-u2')).not.toBeInTheDocument()
    fireEvent.change(screen.getByTestId('users-filter-department'), { target: { value: 'd1' } })
    expect(screen.getByTestId('users-filter-team')).toHaveValue('') // team cleared in the same update
    expect(screen.getByTestId('user-row-u2')).toBeInTheDocument()
  })

  it('flags a team that belongs to a different department than the user (ADR-0014)', () => {
    renderPage()
    // u4: department d2 (Performance) but team tm1 (Creative) → mismatch flagged.
    expect(screen.getByTestId('team-mismatch-u4')).toBeInTheDocument()
    // u2 has no team → no mismatch flag.
    expect(screen.queryByTestId('team-mismatch-u2')).not.toBeInTheDocument()
  })

  it('shows signup/activation status per user (activated vs pending)', () => {
    renderPage()
    expect(screen.getByTestId('signup-u2')).toHaveTextContent('Activated')
    expect(screen.getByTestId('signup-u4')).toHaveTextContent('Pending')
  })

  it('status is tri-state: active / pending-signup / deactivated', () => {
    renderPage()
    // u2 active + signed in → Active; u4 active but not signed in → Pending; u3 deactivated.
    expect(screen.getByTestId('status-u2')).toHaveTextContent('Active')
    expect(screen.getByTestId('status-u4')).toHaveTextContent('Pending')
    expect(screen.getByTestId('status-u3')).toHaveTextContent('Deactivated')
  })

  it('header totals count invited (all) and pending (invited, not yet signed up)', () => {
    renderPage()
    expect(screen.getByTestId('users-invited-count')).toHaveTextContent('5')
    expect(screen.getByTestId('users-pending-count')).toHaveTextContent('1') // only u4
  })

  it('changes a role through update-user (role rows, not names)', () => {
    renderPage()
    fireEvent.change(screen.getByTestId('role-u2'), { target: { value: R.scheduler } })
    expect(mutate).toHaveBeenCalledWith(
      { userId: 'u2', roleId: R.scheduler },
      expect.anything(),
    )
  })

  it('deactivation is two-step: arm, then confirm', () => {
    renderPage()
    const btn = screen.getByTestId('toggle-active-u2')
    fireEvent.click(btn)
    expect(mutate).not.toHaveBeenCalled() // armed only
    fireEvent.click(btn)
    expect(mutate).toHaveBeenCalledWith(
      { userId: 'u2', active: false },
      expect.anything(),
    )
  })

  /** ADR-0133 (I70.2, I70.8): arming says what will happen; a Leaving person shows their count and the list. */
  it('the confirm says they lose access and their lead gets the list', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('toggle-active-u2'))
    expect(screen.getByTestId('deactivate-note-u2')).toHaveTextContent(/lose access now/i)
  })

  it('a Leaving person reads "Leaving — N to hand over", links to the list, and is reactivated at once', () => {
    leaving.list = [{ id: 'u2', name: 'Sarah Haddad', itemsRemaining: 3 }]
    renderPage()
    expect(screen.getByTestId('status-u2')).toHaveTextContent('Leaving — 3 to hand over')
    expect(screen.getByTestId('handover-link-u2')).toHaveAttribute('href', '/people/handover/u2')
    fireEvent.click(screen.getByTestId('toggle-active-u2'))
    expect(mutate).toHaveBeenCalledWith({ userId: 'u2', active: true }, expect.anything())
    leaving.list = []
  })

  it('reactivation fires immediately (no arm step needed)', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('toggle-active-u3'))
    expect(mutate).toHaveBeenCalledWith(
      { userId: 'u3', active: true },
      expect.anything(),
    )
  })

  it('sends a password reset for a row', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('reset-u2'))
    expect(resetMutate).toHaveBeenCalledWith('sarah@example.test', expect.anything())
  })
})
