import { Navigate, Outlet, useLocation } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from './auth-context'
import { permissionKeys, usePermissions } from './permissions'
import { Button } from '../components/Button'

/** Blocks anonymous users. Renders nothing until the session is known. */
export function RequireAuth() {
  const { session, ready } = useAuth()
  const location = useLocation()
  if (!ready) return null
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

/**
 * The grant fetch FAILED — say so, and offer a retry.
 *
 * The alternative is what used to happen: with no grants loaded, `can()` is false
 * for everything and `defaultRoute` falls back to '/login', so both guards below
 * redirected a perfectly signed-in user to the login form. A network blip read as
 * a logout. This state is rare, but it must be legible when it happens.
 */
export function PermissionsUnavailable() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  return (
    <section className="empty-state" data-testid="permissions-unavailable">
      <h2>{t('errors.permissionsUnavailable')}</h2>
      <p className="muted">{t('errors.permissionsUnavailableHint')}</p>
      <Button
        variant="primary"
        onClick={() => void queryClient.invalidateQueries({ queryKey: permissionKeys.all })}
        data-testid="permissions-retry"
      >
        {t('errors.retry')}
      </Button>
    </section>
  )
}

/**
 * Grant gate (ADR-0008): a user whose role holds none of `perms` never sees
 * this surface — they are redirected to their role's landing route, not shown
 * a stripped variant (§2.3: absence, not hiding). RLS remains the real
 * enforcement; this only shapes navigation.
 */
export function RequirePermission({ perms }: { perms: string[] }) {
  const { can, defaultRoute, ready, failed } = usePermissions()
  if (!ready) return null
  // "I could not read your grants" is not "you hold nothing" — never route on it.
  if (failed) return <PermissionsUnavailable />
  if (!perms.some(can)) return <Navigate to={defaultRoute} replace />
  return <Outlet />
}
