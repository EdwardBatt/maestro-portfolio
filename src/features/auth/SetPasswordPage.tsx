import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { z } from 'zod'
import { supabase } from '../../lib/supabase'
import { usePermissions } from '../../app/permissions'
import { AuthLayout, EyeIcon } from './AuthLayout'

/**
 * /set-password — code-based account setup & password reset (ADR-0012), styled
 * to design frame 15 (split-screen shell + reset card). Meridian staff are behind a
 * corporate link scanner that consumes single-use magic links, so the email
 * carries a code: the user types it, we `verifyOtp` to get a session, then set
 * the password. `flow` is 'recovery' (from sign-in) or 'invite' (?flow=invite).
 * The email + code fields are additions to the concept frame, which predates the
 * code decision. Errors are surfaced specifically.
 */
type Flow = 'recovery' | 'invite'
type ErrKey =
  | 'emailRequired'
  | 'codeRequired'
  | 'tooShort'
  | 'mismatch'
  | 'codeInvalid'
  | 'rateLimited'
  | 'samePassword'
  | 'weakPassword'
  | 'failed'

const emailSchema = z.string().trim().email()

function authCode(err: unknown): { code?: string; status?: number } {
  return (err ?? {}) as { code?: string; status?: number }
}
function mapVerifyError(err: unknown): ErrKey {
  const { code, status } = authCode(err)
  if (status === 429 || code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') return 'rateLimited'
  return 'codeInvalid'
}
function mapUpdateError(err: unknown): ErrKey {
  const { code, status } = authCode(err)
  if (code === 'same_password') return 'samePassword'
  if (code === 'weak_password' || code === 'validation_failed') return 'weakPassword'
  if (status === 429 || code === 'over_request_rate_limit') return 'rateLimited'
  return 'failed'
}

/** Lightweight local password strength (0–4) for the meter. */
function strength(pw: string): { score: number; key: string } {
  let s = 0
  if (pw.length >= 10) s++
  if (pw.length >= 14) s++
  if (/\d/.test(pw) && /[a-zA-Z]/.test(pw)) s++
  if (/[^a-zA-Z0-9]/.test(pw)) s++
  s = Math.min(4, s)
  const keys = ['weak', 'weak', 'fair', 'good', 'strong']
  return { score: s, key: `auth.strength.${keys[s]}` }
}

export function SetPasswordPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const { defaultRoute } = usePermissions()

  const nav = (location.state ?? {}) as { flow?: Flow; email?: string }
  const initialFlow: Flow = nav.flow ?? (params.get('flow') === 'invite' ? 'invite' : 'recovery')

  // Prefill the email from in-app nav (forgot-password) or the invite/reset link
  // (?email=…), so the recipient doesn't retype it — avoids a mistyped address
  // that would silently fail verifyOtp against the invited/registered address.
  const [email, setEmail] = useState(nav.email ?? params.get('email') ?? '')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false) // default HIDDEN
  const [verified, setVerified] = useState(false)
  const [error, setError] = useState<ErrKey | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // `flow` can change at runtime: a resent code is always a RECOVERY code, even
  // if the user first arrived via an invite link — so resending flips it.
  const [flow, setFlow] = useState<Flow>(initialFlow)

  /** Email a fresh recovery code (the old one is single-use and now expired). */
  async function onResend() {
    setError(null)
    setNotice(null)
    if (!emailSchema.safeParse(email).success) return setError('emailRequired')
    setBusy(true)
    const { error: rErr } = await supabase.auth.resetPasswordForEmail(email.trim())
    setBusy(false)
    if (rErr) {
      const { code: c, status } = authCode(rErr)
      return setError(
        status === 429 || c === 'over_request_rate_limit' || c === 'over_email_send_rate_limit'
          ? 'rateLimited'
          : 'failed',
      )
    }
    setFlow('recovery') // the new code verifies as recovery
    setVerified(false)
    setCode('')
    setNotice('auth.codeResent')
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    if (!verified) {
      if (!emailSchema.safeParse(email).success) return setError('emailRequired')
      if (!/^\d{6,10}$/.test(code.trim())) return setError('codeRequired') // Supabase OTP length is 6–10
    }
    if (password.length < 10) return setError('tooShort')
    if (password !== confirm) return setError('mismatch')

    setBusy(true)
    if (!verified) {
      const { error: vErr } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: flow === 'invite' ? 'invite' : 'recovery',
      })
      if (vErr) {
        setBusy(false)
        return setError(mapVerifyError(vErr))
      }
      setVerified(true)
    }
    const { error: uErr } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (uErr) return setError(mapUpdateError(uErr))
    void navigate(defaultRoute !== '/login' ? defaultRoute : '/', { replace: true })
  }

  const st = strength(password)

  return (
    <AuthLayout>
      <form className="auth-card" onSubmit={onSubmit} noValidate data-testid="set-password-form">
        <span className="auth-badge" aria-hidden="true">
          <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 018 0v3" /></svg>
        </span>
        <div className="auth-ht">
          <h1>{t('auth.resetTitle')}</h1>
          <p>{t(flow === 'invite' ? 'auth.inviteCodeIntro' : 'auth.resetSubtitle')}</p>
        </div>

        {!verified && (
          <>
            <label className="auth-field">
              <span className="auth-label">{t('auth.email')}</span>
              <span className="auth-input">
                <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="set-password-email" placeholder="you@example.test" />
              </span>
            </label>
            <label className="auth-field">
              <span className="auth-label">{t('auth.code')}</span>
              <span className="auth-input">
                <input inputMode="numeric" autoComplete="one-time-code" pattern="\d{6,10}" maxLength={10} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} data-testid="set-password-code" className="auth-code-input" />
              </span>
              <span className="field-hint">{t('auth.codeHint')}</span>
            </label>
            <div className="auth-resend">
              <span className="auth-resend-hint">{t('auth.resendHint')}</span>
              <button type="button" className="auth-resend-btn" onClick={onResend} disabled={busy} data-testid="set-password-resend">
                <span aria-hidden="true">↻</span> {t('auth.resend')}
              </button>
            </div>
          </>
        )}

        {notice && (
          <p role="status" className="notice notice-ok" data-testid="set-password-notice">{t(notice)}</p>
        )}

        {verified && (
          <p className="notice notice-ok" role="status" data-testid="set-password-verified">{t('auth.codeVerified')}</p>
        )}

        <label className="auth-field">
          <span className="auth-label">{t('auth.newPassword')}</span>
          <span className="auth-input">
            <input type={show ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="set-password-input" />
            <button type="button" className="auth-reveal" aria-pressed={show} aria-label={t(show ? 'auth.hidePassword' : 'auth.showPassword')} onClick={() => setShow((s) => !s)} data-testid="set-password-toggle">
              <EyeIcon off={!show} />
            </button>
          </span>
        </label>
        <label className="auth-field">
          <span className="auth-label">{t('auth.confirmPassword')}</span>
          <span className="auth-input">
            <input type={show ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="set-password-confirm" />
          </span>
        </label>

        {password && (
          <div className={`pw-strength pw-l${st.score}`} data-testid="pw-strength">
            <div className="pw-bars">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className={i < st.score ? 'on' : ''} />
              ))}
            </div>
            <span className="pw-label">{t(st.key)}</span>
          </div>
        )}

        {error && (
          <p role="alert" className="form-error" data-testid="set-password-error">
            {error === 'emailRequired' && t('auth.invalidEmail')}
            {error === 'codeRequired' && t('auth.codeRequired')}
            {error === 'tooShort' && t('auth.passwordTooShort')}
            {error === 'mismatch' && t('auth.passwordMismatch')}
            {error === 'codeInvalid' && t('auth.codeInvalid')}
            {error === 'rateLimited' && t('auth.rateLimited')}
            {error === 'samePassword' && t('auth.samePassword')}
            {error === 'weakPassword' && t('auth.weakPassword')}
            {error === 'failed' && t('auth.setPasswordFailed')}
          </p>
        )}

        <button type="submit" className="auth-btn" disabled={busy} data-testid="set-password-submit">
          {busy ? t('auth.saving') : t('auth.setPassword')}
        </button>
        <Link to="/login" className="auth-back centered" data-testid="set-password-back">
          <span className="auth-back-chevron" aria-hidden="true">‹</span> {t('auth.backToLogin')}
        </Link>
      </form>
    </AuthLayout>
  )
}
