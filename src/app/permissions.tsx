import { createContext, useContext, useMemo } from 'react'
import { landingRoute } from './landing'
import { useQuery } from '@tanstack/react-query'
import { supabaseUntyped as supabase } from '../lib/supabase'
import { useAuth } from './auth-context'
import { useDevPreview } from './dev-preview'

/**
 * ADR-0008: the frontend's view of the grants matrix. One fetch per session
 * (role row + grant list, both RLS-scoped to the caller's tenant); everything
 * nav/guard/screen-shaped asks `can('resource:action')`. Fail-closed: until
 * grants load — or if the user has no role claim — every check is false.
 * No localStorage (claims-adjacent data stays out of storage).
 */

/** ADR-0009: the caller role's write scope — also used to default the reach of
 *  scope-parameterized read surfaces (ADR-0018). */
export type RoleScope = 'tenant' | 'all_accounts' | 'department' | 'team' | 'account' | 'self'

export interface PermissionsState {
  /** grant check, e.g. can('schedule:view') */
  can: (key: string) => boolean
  /** the caller's role landing route (roles.default_route) */
  defaultRoute: string
  /** display name of the caller's role */
  roleName: string | null
  /** the caller role's write scope (ADR-0009); null until loaded */
  scope: RoleScope | null
  /** stable role slug (roles.key); null until loaded */
  roleKey: string | null
  /** effective org placement (ADR-0010/0014) — the real user's, or the previewed
   *  role's when a Dev preview is active. Drives scope-parameterized surfaces. */
  departmentId: string | null
  teamId: string | null
  /** ADR-0036: the caller's additive write-scope targets (own user_scope_grants), for client scope
   *  mirrors like the schedule canBook gate. Empty until loaded. */
  scopeGrantDepartmentIds: Set<string>
  scopeGrantTeamIds: Set<string>
  /** true once auth AND (when signed in) the grant fetch have settled */
  ready: boolean
  /** The grant fetch FAILED. `can()` is false in this state, which is right for enforcement and
   *  indistinguishable from "you hold nothing" on screen — a surface that gates on permissions
   *  must say the load failed rather than let a network error read as a refusal. */
  failed: boolean
}

const EMPTY_SET: Set<string> = new Set()

const PermissionsContext = createContext<PermissionsState | null>(null)

export const permissionKeys = {
  all: ['permissions'] as const,
  role: (roleId: string, userId: string) => [...permissionKeys.all, roleId, userId] as const,
}

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const { claims, ready: authReady, session } = useAuth()
  const { active, preview } = useDevPreview()

  // Dev "view as role" (removable): when a preview is active, the effective
  // identity is the previewed role + team/department; otherwise the real claims.
  const effectiveRoleId = active ? preview.roleId : claims.roleId
  const effectiveDepartmentId = active ? preview.departmentId : claims.departmentId
  const effectiveTeamId = active ? preview.teamId : claims.teamId

  // ADR-0036: the per-user overlay keys on the REAL signed-in identity, never the previewed
  // role — personal grants belong to the person, not the role. Intentional asymmetry: scope
  // (departmentId/teamId below) stays preview-aware for nav-scope simulation, while the
  // permission overlay tracks the real user; don't "fix" this to use one identity for both.
  const realUserId = session?.user.id ?? null

  const query = useQuery({
    queryKey: permissionKeys.role(effectiveRoleId ?? 'none', realUserId ?? 'none'),
    enabled: effectiveRoleId != null && realUserId != null,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      // ADR-0037 (L6.11): the grant tables are private now — only holders of admin.roles:view /
      // user_grants:view may read them. The caller's OWN effective permissions come from
      // public.my_permissions(), which applies (role ∪ allow) − deny in the database, so this file
      // no longer keeps its own copy of that formula.
      //
      // The Dev "view as role" preview (ADR-0019) is the exception: it asks what a DIFFERENT role
      // can do, which is not a self-scoped question. It is Power-Admin-only (dev-preview.tsx checks
      // the real role key), and a Power Admin holds admin.roles:view — so that path reads
      // role_grants directly, as before. Everyone else never touches the table.
      const [roleRes, grantsRes, scopeGrantsRes] = await Promise.all([
        supabase.from('roles').select('name, default_route, scope, key').eq('id', effectiveRoleId!).single(),
        active
          ? supabase.from('role_grants').select('resource, action').eq('role_id', effectiveRoleId!)
          : supabase.rpc('my_permissions'),
        supabase.rpc('my_scope_grants'),
      ])
      if (roleRes.error) throw roleRes.error
      if (grantsRes.error) throw grantsRes.error
      if (scopeGrantsRes.error) throw scopeGrantsRes.error
      const role = roleRes.data as { name: string; default_route: string | null; scope: RoleScope | null; key: string | null }
      const grants = (grantsRes.data ?? []) as { resource: string; action: string }[]
      const scopeGrants = (scopeGrantsRes.data ?? []) as { department_id: string | null; team_id: string | null }[]
      const granted = new Set(grants.map((g) => `${g.resource}:${g.action}`))
      return {
        roleName: role.name,
        // I66.7: the role's landing, or the Dashboard for anyone who cannot open My Work.
        defaultRoute: landingRoute(role.default_route, granted),
        scope: role.scope,
        roleKey: role.key,
        grants: granted,
        scopeGrantDepartmentIds: new Set(scopeGrants.map((s) => s.department_id).filter((x): x is string => x != null)),
        scopeGrantTeamIds: new Set(scopeGrants.map((s) => s.team_id).filter((x): x is string => x != null)),
      }
    },
  })

  const value = useMemo<PermissionsState>(() => {
    const grants = query.data?.grants
    return {
      can: (key: string) => grants?.has(key) ?? false,
      defaultRoute: query.data?.defaultRoute ?? '/login',
      roleName: query.data?.roleName ?? null,
      scope: query.data?.scope ?? null,
      roleKey: query.data?.roleKey ?? null,
      departmentId: effectiveDepartmentId,
      teamId: effectiveTeamId,
      scopeGrantDepartmentIds: query.data?.scopeGrantDepartmentIds ?? EMPTY_SET,
      scopeGrantTeamIds: query.data?.scopeGrantTeamIds ?? EMPTY_SET,
      ready: authReady && (effectiveRoleId == null || query.isSuccess || query.isError),
      failed: query.isError,
    }
  }, [authReady, effectiveRoleId, effectiveDepartmentId, effectiveTeamId, query.data, query.isSuccess, query.isError])

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>
}

export function usePermissions(): PermissionsState {
  const ctx = useContext(PermissionsContext)
  if (!ctx) throw new Error('usePermissions must be used inside <PermissionsProvider>')
  return ctx
}
