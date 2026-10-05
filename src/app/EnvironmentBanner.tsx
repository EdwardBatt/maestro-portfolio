import { useTranslation } from 'react-i18next'
import { env, isLocalEnvironment } from '../lib/env'

/**
 * "You are on the local database" — the bar that stops work being done in the wrong place.
 *
 * **Why this exists** (ADR-0081). `.env.local` is not tracked by git, so there is exactly ONE copy
 * on disk and every branch shares it. Switching branches therefore does NOT switch database: check
 * out `main` to fix something live and you are still on local, which is merely confusing — but leave
 * it pointed at PRODUCTION while building on `redesign` and you are driving unreleased work against
 * real client data, creating real campaigns and emailing real people. That is the exact failure the
 * whole local environment exists to prevent, and nothing else catches it.
 *
 * **So the marker is not a warning, and it cannot be dismissed.** `UpdateBar` can be, because a new
 * deploy is news you have now heard; this is a standing fact about what the screen is connected to,
 * and it has to be true for as long as it is true. Its absence carries the other half of the
 * meaning: on a feature branch with no bar, you are on production, and you should stop.
 *
 * **It names the host rather than saying "dev".** "Local" is a claim about intent; the host is what
 * the app will actually write to, and the two are only the same until somebody points a local build
 * at a hosted URL. Presentation only (AGENTS.md §4) — `isLocalEnvironment` decides, this says so.
 */
export function EnvironmentBanner() {
  const { t } = useTranslation()
  if (!isLocalEnvironment) return null

  const host = (() => {
    try { return new URL(env.VITE_SUPABASE_URL).host } catch { return env.VITE_SUPABASE_URL }
  })()

  return (
    <div className="environment-bar" role="status" data-testid="environment-bar">
      <strong>{t('app.environment.local')}</strong>
      <span className="environment-bar-host" data-testid="environment-bar-host">{host}</span>
      <span className="environment-bar-note">{t('app.environment.note')}</span>
    </div>
  )
}
