import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import '../../lib/i18n'

// ADR-0012: code-based invite/reset. Verify the emailed 6-digit code, then set
// the password. Errors are surfaced specifically. These tests cover the client
// gates, the verify→update sequence, error mapping, and the password toggle.

const verifyOtp = vi.fn()
const updateUser = vi.fn()
const resetPasswordForEmail = vi.fn()
const navigateSpy = vi.fn()

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      verifyOtp: (...a: unknown[]) => verifyOtp(...a),
      updateUser: (...a: unknown[]) => updateUser(...a),
      resetPasswordForEmail: (...a: unknown[]) => resetPasswordForEmail(...a),
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: () => Promise.resolve(),
    },
  },
}))

vi.mock('../../app/permissions', () => ({
  usePermissions: () => ({ can: () => true, defaultRoute: '/my-work', roleName: 'x', ready: true }),
}))

vi.mock('react-router', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, useNavigate: () => navigateSpy }
})

import { AuthProvider } from '../../app/auth-context'
import { SetPasswordPage } from './SetPasswordPage'
import { LoginPage } from './LoginPage'

function renderSet() {
  return render(
    <MemoryRouter>
      <SetPasswordPage />
    </MemoryRouter>,
  )
}

function fillAll(pw: string, confirm: string) {
  fireEvent.change(screen.getByTestId('set-password-email'), { target: { value: 'a@b.co' } })
  fireEvent.change(screen.getByTestId('set-password-code'), { target: { value: '123456' } })
  fireEvent.change(screen.getByTestId('set-password-input'), { target: { value: pw } })
  fireEvent.change(screen.getByTestId('set-password-confirm'), { target: { value: confirm } })
}

describe('SetPasswordPage — code + password (ADR-0012)', () => {
  beforeEach(() => {
    verifyOtp.mockReset()
    updateUser.mockReset()
    resetPasswordForEmail.mockReset()
    navigateSpy.mockReset()
  })

  it('rejects a short password before any API call', async () => {
    renderSet()
    fillAll('short', 'short')
    fireEvent.submit(screen.getByTestId('set-password-form'))
    await waitFor(() => expect(screen.getByTestId('set-password-error')).toBeInTheDocument())
    expect(verifyOtp).not.toHaveBeenCalled()
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('requires a 6-digit code', async () => {
    renderSet()
    fireEvent.change(screen.getByTestId('set-password-email'), { target: { value: 'a@b.co' } })
    fireEvent.change(screen.getByTestId('set-password-input'), { target: { value: 'long-enough-pass' } })
    fireEvent.change(screen.getByTestId('set-password-confirm'), { target: { value: 'long-enough-pass' } })
    fireEvent.submit(screen.getByTestId('set-password-form'))
    await waitFor(() => expect(screen.getByTestId('set-password-error')).toBeInTheDocument())
    expect(verifyOtp).not.toHaveBeenCalled()
  })

  it('verifies the code, then sets the password (happy path)', async () => {
    verifyOtp.mockResolvedValue({ error: null })
    updateUser.mockResolvedValue({ error: null })
    renderSet()
    fillAll('long-enough-pass', 'long-enough-pass')
    fireEvent.submit(screen.getByTestId('set-password-form'))
    await waitFor(() =>
      expect(verifyOtp).toHaveBeenCalledWith({ email: 'a@b.co', token: '123456', type: 'recovery' }),
    )
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: 'long-enough-pass' }))
    expect(navigateSpy).toHaveBeenCalled()
  })

  it('shows a code-specific error when the code is invalid/expired', async () => {
    verifyOtp.mockResolvedValue({ error: { code: 'otp_expired', status: 403 } })
    renderSet()
    fillAll('long-enough-pass', 'long-enough-pass')
    fireEvent.submit(screen.getByTestId('set-password-form'))
    await waitFor(() => expect(screen.getByTestId('set-password-error')).toHaveTextContent(/code/i))
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('surfaces "same password" and does NOT re-verify the spent code on retry', async () => {
    verifyOtp.mockResolvedValue({ error: null })
    updateUser
      .mockResolvedValueOnce({ error: { code: 'same_password', status: 422 } })
      .mockResolvedValueOnce({ error: null })
    renderSet()
    fillAll('long-enough-pass', 'long-enough-pass')
    fireEvent.submit(screen.getByTestId('set-password-form'))
    await waitFor(() => expect(screen.getByTestId('set-password-error')).toBeInTheDocument())
    // fix the password and resubmit — the code is single-use, so verifyOtp must not run again
    fireEvent.change(screen.getByTestId('set-password-input'), { target: { value: 'brand-new-pass-9' } })
    fireEvent.change(screen.getByTestId('set-password-confirm'), { target: { value: 'brand-new-pass-9' } })
    fireEvent.submit(screen.getByTestId('set-password-form'))
    await waitFor(() => expect(navigateSpy).toHaveBeenCalled())
    expect(verifyOtp).toHaveBeenCalledTimes(1)
    expect(updateUser).toHaveBeenCalledTimes(2)
  })

  it('toggles password visibility (default hidden)', () => {
    renderSet()
    const input = screen.getByTestId('set-password-input') as HTMLInputElement
    expect(input.type).toBe('password')
    fireEvent.click(screen.getByTestId('set-password-toggle'))
    expect(input.type).toBe('text')
  })

  it('resends a fresh code and notifies the user', async () => {
    resetPasswordForEmail.mockResolvedValue({ error: null })
    renderSet()
    fireEvent.change(screen.getByTestId('set-password-email'), { target: { value: 'a@b.co' } })
    fireEvent.click(screen.getByTestId('set-password-resend'))
    await waitFor(() => expect(resetPasswordForEmail).toHaveBeenCalledWith('a@b.co'))
    await waitFor(() => expect(screen.getByTestId('set-password-notice')).toBeInTheDocument())
  })

  it('resend requires an email first (no send, shows error)', async () => {
    renderSet()
    fireEvent.click(screen.getByTestId('set-password-resend'))
    await waitFor(() => expect(screen.getByTestId('set-password-error')).toBeInTheDocument())
    expect(resetPasswordForEmail).not.toHaveBeenCalled()
  })

  it('prefills the email from the invite link (?email=)', () => {
    render(
      <MemoryRouter initialEntries={['/set-password?flow=invite&email=invited@example.test']}>
        <SetPasswordPage />
      </MemoryRouter>,
    )
    expect((screen.getByTestId('set-password-email') as HTMLInputElement).value).toBe('invited@example.test')
  })
})

describe('LoginPage forgot-password → code handoff (ADR-0012)', () => {
  beforeEach(() => {
    resetPasswordForEmail.mockReset()
    navigateSpy.mockReset()
  })

  it('emails a reset code (no redirect link) and routes to the code screen', async () => {
    resetPasswordForEmail.mockResolvedValue({ error: null })
    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByTestId('forgot-toggle'))
    expect(screen.queryByTestId('login-password')).not.toBeInTheDocument()
    fireEvent.change(screen.getByTestId('login-email'), { target: { value: 'a@b.co' } })
    fireEvent.submit(screen.getByTestId('login-form'))
    await waitFor(() => expect(resetPasswordForEmail).toHaveBeenCalledWith('a@b.co'))
    expect(navigateSpy).toHaveBeenCalledWith('/set-password', {
      state: { flow: 'recovery', email: 'a@b.co' },
    })
  })
})
