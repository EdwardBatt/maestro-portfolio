import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from './auth-context'
import { useCurrentUser } from './useCurrentUser'
import { roleName } from '../lib/roles/role-text'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Header identity: avatar + name + role, with a dropdown (sign out). */
export function UserMenu() {
  const { t } = useTranslation()
  const { signOut } = useAuth()
  const { data } = useCurrentUser()
  const [open, setOpen] = useState(false)
  const name = data?.displayName ?? ''
  // A built-in role's name is product copy and follows the interface language (lib/role-text).
  const role = data ? roleName(t, { key: data.roleKey, name: data.roleName }) : ''

  return (
    <div className="user-menu" data-testid="user-menu">
      <button
        type="button"
        className="user-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={name || 'account'}
        onClick={() => setOpen((v) => !v)}
        data-testid="user-menu-toggle"
      >
        <span className="user-avatar" aria-hidden="true">{initials(name)}</span>
        <span className="user-meta">
          <span className="user-name">{name}</span>
          {role ? <span className="user-role">{role}</span> : null}
        </span>
      </button>
      {open ? (
        <>
          <div className="user-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="user-dropdown" role="menu">
            {data?.email ? <div className="user-dropdown-email">{data.email}</div> : null}
            <button type="button" role="menuitem" data-testid="sign-out" onClick={() => void signOut()}>
              {t('auth.signOut')}
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}
