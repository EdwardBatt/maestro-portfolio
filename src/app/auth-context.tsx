import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { viewAsStore } from '../lib/view-as'

export interface AuthClaims {
  tenantId: string | null
  /** the caller's role ROW id (ADR-0008) — abilities come from role_grants */
  roleId: string | null
  /** ADR-0010/0014: the caller's org placement, written into app_metadata by the
   *  provisioning functions. Used to default scope-parameterized surfaces
   *  (ADR-0018) to the viewer's own domain. Null when unset. */
  departmentId: string | null
  teamId: string | null
}

/** ADR-0120: the person a Power Admin is viewing as — `public.view_as_start`'s answer. */
export interface ViewAsPerson {
  id: string
  email: string | null
  name: string
  appMetadata: Record<string, unknown>
}

interface AuthState {
  /** The session the app runs as: the person being viewed, while viewing (ADR-0120); else the real one. */
  session: Session | null
  claims: AuthClaims
  /** Who is really signed in — never swapped. The Dev panel and its Power Admin check read these. */
  realSession: Session | null
  realClaims: AuthClaims
  /** The person being viewed as, or null. */
  viewAs: ViewAsPerson | null
  /** Called by the Dev panel after `view_as_start` has checked and recorded the view. */
  startViewAs: (person: ViewAsPerson) => void
  stopViewAs: () => void
  /** true until the initial getSession() resolves — render nothing sooner */
  ready: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

// ADR-0120: a view survives a reload in the same tab (a refresh mid-demo must not drop back to the
// admin). sessionStorage is per tab and gone when it closes; the database still checks every request.
const VIEW_AS_KEY = 'maestro.viewAs'

function readStoredViewAs(): ViewAsPerson | null {
  try {
    const raw = sessionStorage.getItem(VIEW_AS_KEY)
    return raw ? (JSON.parse(raw) as ViewAsPerson) : null
  } catch {
    return null
  }
}

function storeViewAs(person: ViewAsPerson | null) {
  viewAsStore.userId = person?.id ?? null
  try {
    if (person) sessionStorage.setItem(VIEW_AS_KEY, JSON.stringify(person))
    else sessionStorage.removeItem(VIEW_AS_KEY)
  } catch {
    // storage unavailable: the view lasts until the page is reloaded
  }
}

/** Claims come from app_metadata — set server-side at provision time, never client-writable. */
export function claimsFromSession(session: Session | null): AuthClaims {
  const meta = (session?.user.app_metadata ?? {}) as Record<string, unknown>
  const tenantId = typeof meta.tenant_id === 'string' ? meta.tenant_id : null
  const roleId = typeof meta.app_role_id === 'string' ? meta.app_role_id : null
  const departmentId = typeof meta.department_id === 'string' ? meta.department_id : null
  const teamId = typeof meta.team_id === 'string' ? meta.team_id : null
  return { tenantId, roleId, departmentId, teamId }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [viewAs, setViewAs] = useState<ViewAsPerson | null>(() => {
    const stored = readStoredViewAs()
    viewAsStore.userId = stored?.id ?? null
    return stored
  })

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'SIGNED_OUT') {
        storeViewAs(null)
        setViewAs(null)
      }
      setSession(next)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // ADR-0120: while viewing, the app's "me" is the person — every page reads `session.user.id` and
  // `claims` from here — and the database is told the same by the header (lib/view-as).
  const effective = useMemo<Session | null>(() => {
    if (!session || !viewAs) return session
    return { ...session, user: { ...session.user, id: viewAs.id, email: viewAs.email ?? undefined, app_metadata: viewAs.appMetadata } }
  }, [session, viewAs])

  const value = useMemo<AuthState>(
    () => ({
      session: effective,
      claims: claimsFromSession(effective),
      realSession: session,
      realClaims: claimsFromSession(session),
      viewAs,
      startViewAs: (person) => {
        storeViewAs(person)
        setViewAs(person)
      },
      stopViewAs: () => {
        storeViewAs(null)
        setViewAs(null)
      },
      ready,
      signOut: async () => {
        storeViewAs(null)
        setViewAs(null)
        await supabase.auth.signOut()
      },
    }),
    [effective, session, viewAs, ready],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
