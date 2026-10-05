import { useTranslation } from 'react-i18next'
import { EnvironmentBanner } from '../../app/EnvironmentBanner'
import { APP_VERSION } from '../../lib/version'
import { Button } from '../../components/Button'

/**
 * Split-screen auth shell (design concept E2EV1.pen, frames 13–15): a dark
 * Maestro brand panel on the inline-start, a white form side on the inline-end
 * holding a 380px card. Logical properties throughout so it mirrors under RTL;
 * the brand panel collapses on narrow screens. The version tag + "in
 * development" note sit under the form so they show even when the panel is
 * hidden. The navy logo mark rides a white chip to stay legible on the dark panel.
 */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t, i18n } = useTranslation()
  const offices = ['Baghdad', 'Dubai', 'Cairo'] as const
  return (
    <div className="auth-shell">
      {/* The environment banner belongs on the login page too (Edward, 12 Sep): a person needs to
          know which database they are signing into BEFORE they sign in, not only after. */}
      <EnvironmentBanner />
      <main className="auth-split">
      <aside className="brand-panel">
        <span className="brand-blob brand-blob-1" aria-hidden="true" />
        <span className="brand-blob brand-blob-2" aria-hidden="true" />
        <div className="brand-logo">
          <span className="brand-mark">
            <img src="/maestro-mark.png" alt="" width="30" height="23" />
          </span>
          <span className="brand-word">{t('app.name')}</span>
        </div>
        <div className="brand-mid">
          <h2 className="brand-headline">{t('auth.brand.headline')}</h2>
          <p className="brand-sub">{t('auth.brand.subtitle')}</p>
        </div>
        <div className="brand-offices">
          {offices.map((o) => (
            <span className="brand-office" key={o}>
              <span className="brand-dot-sm" aria-hidden="true" />
              {t(`auth.brand.office.${o}`)}
            </span>
          ))}
        </div>
      </aside>
      <section className="form-side">
        <Button
          variant="link" className="auth-locale"
          data-testid="locale-toggle"
          onClick={() => void i18n.changeLanguage(i18n.language === 'ar' ? 'en' : 'ar')}
        >
          {t('nav.language')}
        </Button>
        {children}
        <p className="auth-foot" data-testid="auth-version">
          {t('app.name')} v{APP_VERSION} <span className="auth-dev">{t('auth.brand.inDevelopment')}</span>
        </p>
      </section>
      </main>
    </div>
  )
}

/** Eye / eye-off toggle icon for password reveal (inline, currentColor). */
export function EyeIcon({ off }: { off: boolean }) {
  return off ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8" />
      <path d="M9.9 4.24A9.1 9.1 0 0112 4c5 0 9 5 9 8a12 12 0 01-1.7 2.9M6.6 6.6C4.3 8 3 10.4 3 12c0 0 3 5 9 5a9 9 0 004-.9" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
