import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import '../../lib/i18n'

const signInWithPassword = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: (...args: unknown[]) => signInWithPassword(...args),
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: () => Promise.resolve(),
    },
  },
}))

vi.mock('../../app/permissions', () => ({
  usePermissions: () => ({ can: () => true, defaultRoute: '/my-work', roleName: 'Team Member', ready: true }),
}))

import { AuthProvider } from '../../app/auth-context'
import { LoginPage } from './LoginPage'

function renderLogin() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('LoginPage (M2.1)', () => {
  beforeEach(() => signInWithPassword.mockReset())

  it('validates email before calling the API', async () => {
    renderLogin()
    fireEvent.change(screen.getByTestId('login-email'), { target: { value: 'not-an-email' } })
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'x' } })
    fireEvent.submit(screen.getByTestId('login-form'))
    await waitFor(() => expect(screen.getByTestId('login-error')).toBeInTheDocument())
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('submits valid credentials and surfaces auth failure', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'bad' } })
    renderLogin()
    fireEvent.change(screen.getByTestId('login-email'), { target: { value: 'a@b.co' } })
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'secret' } })
    fireEvent.submit(screen.getByTestId('login-form'))
    await waitFor(() => expect(screen.getByTestId('login-error')).toBeInTheDocument())
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.co', password: 'secret' })
  })
})
