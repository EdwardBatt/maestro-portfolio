import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabaseUntyped } from '../lib/supabase'
import { previewGuard } from '../lib/preview-guard'
import { useAuth } from './auth-context'

/**
 * Dev "View as role" preview (removable). Lets the REAL signed-in person preview the
 * app as any role/team/department without logging out — for UI/UX iteration.
 * It overrides only client-side permission checks (nav, guards, scope, landing),
 * never data access: RLS still runs on the real JWT. Writes are blocked while
 * previewing (preview-guard). Gated to `dev_view:view` (ADR-0120 addendum, 1 Oct),
 * which the Power Admin holds with every grant.
 */

/** A person the real signed-in person may view as — `view_as_options`, their reach. */
export interface ViewAsPerson {
  id: string
  name: string
  role: string | null
}

export interface PreviewState {
  roleId: string | null
  teamId: string | null
  departmentId: string | null
}

interface DevPreviewValue {
  /** true only when the *real* signed-in person holds `dev_view:view` */
  canUseDevPanel: boolean
  /** the people they may view as (their role's reach), never themselves */
  viewAsPeople: ViewAsPerson[]
  preview: PreviewState
  /** a preview is currently applied */
  active: boolean
  setPreview: (p: PreviewState) => void
  clear: () => void
}

const EMPTY: PreviewState = { roleId: null, teamId: null, departmentId: null }
const DevPreviewContext = createContext<DevPreviewValue | null>(null)

export function DevPreviewProvider({ children }: { children: React.ReactNode }) {
  // The REAL claims: while viewing as a person (ADR-0120) `claims` are theirs, and the panel must stay.
  const { realSession, viewAs } = useAuth()
  const realId = realSession?.user.id ?? null

  // Whether the Dev panel exists at all, and whom it offers. The database answers for the REAL person, also while they
  // are viewing someone (the hook stamps `view_as_by`), so the panel stays.
  const options = useQuery({
    queryKey: ['dev-view-as-options', realId ?? 'none'],
    enabled: realId != null,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabaseUntyped.rpc('view_as_options')
      if (error) throw error
      return data as { allowed: boolean; people: ViewAsPerson[] }
    },
  })
  const canUseDevPanel = options.data?.allowed === true
  const viewAsPeople = useMemo(() => options.data?.people ?? [], [options.data])

  const [preview, setPreviewState] = useState<PreviewState>(EMPTY)
  const active = canUseDevPanel && preview.roleId != null
  const viewing = viewAs != null

  // Block writes at the client while a preview is applied (removable safety). Viewing as a person
  // (ADR-0120) blocks them too; the database also runs those requests read-only.
  useEffect(() => {
    previewGuard.blocked = active || viewing
    previewGuard.person = viewing
    return () => {
      previewGuard.blocked = false
      previewGuard.person = false
    }
  }, [active, viewing])

  const value = useMemo<DevPreviewValue>(
    () => ({
      canUseDevPanel,
      viewAsPeople,
      preview,
      active,
      setPreview: (p) => {
        if (canUseDevPanel) setPreviewState(p)
      },
      clear: () => setPreviewState(EMPTY),
    }),
    [canUseDevPanel, viewAsPeople, preview, active],
  )

  return <DevPreviewContext.Provider value={value}>{children}</DevPreviewContext.Provider>
}

export function useDevPreview(): DevPreviewValue {
  const ctx = useContext(DevPreviewContext)
  if (!ctx) throw new Error('useDevPreview must be used inside <DevPreviewProvider>')
  return ctx
}
