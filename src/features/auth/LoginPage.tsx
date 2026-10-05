import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate } from 'react-router'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../app/auth-context'
import { usePermissions } from '../../app/permissions'
import { LoginInput } from './login-schema'
import { AuthLayout, EyeIcon } from './AuthLayout'

/**
 * Sign in + forgot-password (design frames 13 & 14). Split-screen shell
 * (AuthLayout) with the form card on the inline-end. Forgot-password sends a
 * CODE (ADR-0012) and hands off to /set-password. SSO is a designed-but-unbuilt
 * placeholder (disabled).
 */
export function LoginPage() {
  const { t } = useTranslation()
  const { session, ready } = useAuth()
  const { defaultRoute, ready: permsReady } = usePermissions()
  const navigate = useNavigate()
  const [error, setError] = useState<'validation-email' | 'validation-password' | 'failed' | null>(null)
  const [busy, setBusy] = useState(false)
  const [resetMode, setResetMode] = useState(false)
  const [show, setShow] = useState(false)

  if (ready && session && permsReady && defaultRoute !== '/login') {
    return <Navigate to={defaultRoute} replace />
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const form = new FormData(event.currentTarget)

    if (resetMode) {
      const email = LoginInput.shape.email.safeParse(form.get('email'))
      if (!email.success) return setError('validation-email')
      setBusy(true)
      // ADR-0012: emails a code (not a link); always proceed to the code screen.
      await supabase.auth.resetPasswordForEmail(email.data)
      setBusy(false)
      void navigate('/set-password', { state: { flow: 'recovery', email: email.data } })
      return
    }

    const parsed = LoginInput.safeParse({ email: form.get('email'), password: form.get('password') })
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0]
      return setError(field === 'password' ? 'validation-password' : 'validation-email')
    }
    setBusy(true)
    const { error: signInError } = await supabase.auth.signInWithPassword(parsed.data)
    setBusy(false)
    if (signInError) setError('failed')
  }

  return (
    <AuthLayout>
      <form className="auth-card" onSubmit={onSubmit} noValidate data-testid="login-form">
        {resetMode ? (
          <>
            <button type="button" className="auth-back" data-testid="forgot-back" onClick={() => { setResetMode(false); setError(null) }}>
              <span className="auth-back-chevron" aria-hidden="true">‹</span> {t('auth.backToLogin')}
            </button>
            <span className="auth-badge" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 018 0v3" /></svg>
            </span>
            <div className="auth-ht">
              <h1>{t('auth.forgotPassword')}</h1>
              <p>{t('auth.forgotSubtitle')}</p>
            </div>
          </>
        ) : (
          <div className="auth-ht">
            <h1>{t('auth.welcomeBack')}</h1>
            <p>{t('auth.signInSubtitle')}</p>
          </div>
        )}

        <label className="auth-field">
          <span className="auth-label">{t('auth.email')}</span>
          <span className="auth-input">
            <input name="email" type="email" autoComplete="username" data-testid="login-email" placeholder="you@example.test" />
          </span>
        </label>

        {!resetMode && (
          <label className="auth-field">
            <span className="auth-label">{t('auth.password')}</span>
            <span className="auth-input">
              <input name="password" type={show ? 'text' : 'password'} autoComplete="current-password" data-testid="login-password" />
              <button type="button" className="auth-reveal" aria-pressed={show} aria-label={t(show ? 'auth.hidePassword' : 'auth.showPassword')} onClick={() => setShow((s) => !s)}>
                <EyeIcon off={!show} />
              </button>
            </span>
          </label>
        )}

        {error && (
          <p role="alert" className="form-error" data-testid="login-error">
            {error === 'validation-email' && t('auth.invalidEmail')}
            {error === 'validation-password' && t('auth.passwordRequired')}
            {error === 'failed' && t('auth.failed')}
          </p>
        )}

        {/* "Remember me" stood here until 16 Sep and was read by nothing (I49.83): everyone stays
            signed in until they sign out, which is what a work tool should do. Edward: remove it
            rather than build a mode almost nobody would untick. */}
        {!resetMode && (
          <div className="auth-row auth-row-end">
            <button type="button" className="auth-link" data-testid="forgot-toggle" onClick={() => { setResetMode(true); setError(null) }}>
              {t('auth.forgotPassword')}
            </button>
          </div>
        )}

        <button type="submit" className="auth-btn" disabled={busy} data-testid="login-submit">
          {resetMode ? t('auth.sendReset') : busy ? t('auth.signingIn') : t('auth.signIn')}
        </button>

        <p className="auth-help">{t(resetMode ? 'auth.forgotHelp' : 'auth.signInHelp')}</p>
      </form>
    </AuthLayout>
  )
}
