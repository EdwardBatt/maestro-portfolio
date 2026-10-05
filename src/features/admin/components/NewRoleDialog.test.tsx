import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../../lib/i18n'
import type { RoleRow } from '../api/roles-api'

const createMutateAsync = vi.fn()

const ROLES: RoleRow[] = [
  { id: 'r-power', key: 'power_admin', name: 'Power Admin', description: null, isSystem: true, defaultRoute: '/admin', status: 'active', scope: 'tenant' },
  { id: 'r-sched', key: 'scheduler', name: 'Traffic Manager', description: null, isSystem: false, defaultRoute: '/schedule', status: 'active', scope: 'tenant' },
]

// Self-contained factory (no importOriginal — the real chain reaches lib/env, which throws in CI).
vi.mock('../api/roles-api', () => ({
  useCreateRole: () => ({ mutateAsync: createMutateAsync, isPending: false }),
}))

import { NewRoleDialog } from './NewRoleDialog'

function renderDialog() {
  return render(<NewRoleDialog roles={ROLES} onClose={vi.fn()} onCreated={vi.fn()} />)
}

/**
 * ADR-0041. This form had no reach field at all, so every role created here took the column
 * default — the whole organisation — without anyone choosing it. That is how the `cco` role came to
 * span the company. The first test is the one that matters.
 */
describe('NewRoleDialog — reach (ADR-0041)', () => {
  beforeEach(() => {
    createMutateAsync.mockReset()
    createMutateAsync.mockResolvedValue('new-role-id')
  })

  it('a new role starts at the NARROWEST reach, not the widest', async () => {
    renderDialog()
    expect(screen.getByTestId('new-role-scope')).toHaveValue('self')

    fireEvent.change(screen.getByTestId('new-role-name'), { target: { value: 'Coordinator' } })
    fireEvent.submit(screen.getByTestId('new-role-dialog'))

    await waitFor(() =>
      expect(createMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ scope: 'self' })),
    )
  })

  it('reach is sent explicitly when widened', async () => {
    renderDialog()
    fireEvent.change(screen.getByTestId('new-role-name'), { target: { value: 'Coordinator' } })
    fireEvent.change(screen.getByTestId('new-role-scope'), { target: { value: 'department' } })
    fireEvent.submit(screen.getByTestId('new-role-dialog'))

    await waitFor(() =>
      expect(createMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ scope: 'department' })),
    )
  })

  it('explains the selected reach in plain words, and updates as it changes', () => {
    renderDialog()
    expect(screen.getByTestId('new-role-scope-hint')).toHaveTextContent('only on the person’s own work')
    fireEvent.change(screen.getByTestId('new-role-scope'), { target: { value: 'tenant' } })
    expect(screen.getByTestId('new-role-scope-hint')).toHaveTextContent('anywhere in the company')
  })

  // Copying is about grants; reach is a separate decision and must not ride along with it.
  it('copying another role does not copy its reach', async () => {
    renderDialog()
    fireEvent.change(screen.getByTestId('new-role-name'), { target: { value: 'Coordinator' } })
    fireEvent.change(screen.getByTestId('new-role-copy'), { target: { value: 'r-sched' } })
    expect(screen.getByTestId('new-role-scope')).toHaveValue('self') // not the copied role's 'tenant'

    fireEvent.submit(screen.getByTestId('new-role-dialog'))
    await waitFor(() =>
      expect(createMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ copyFromRoleId: 'r-sched', scope: 'self' }),
      ),
    )
  })
})
