import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { useAuth } from '../../../app/auth-context'
import { adminKeys } from './admin-api'
import { permissionKeys } from '../../../app/permissions'

/**
 * Per-user RBAC overlay administration (L6.4b, ADR-0036). Direct PostgREST
 * writes governed by RLS: the `user_grants:manage` grant + the fences in
 * `app.can_admin_user_grants` (no self-grant, in-tenant, client_portal barred)
 * decide who may write, and the universal audit triggers log every change.
 * Grant tables are add/remove only (no UPDATE policy), so changing an effect is
 * delete-then-insert.
 */

export const userGrantsKeys = {
  all: [...adminKeys.all, 'user-grants'] as const,
  grants: (userId: string) => [...userGrantsKeys.all, 'grants', userId] as const,
  scope: (userId: string) => [...userGrantsKeys.all, 'scope', userId] as const,
}

export type GrantEffect = 'allow' | 'deny'

/** (resource:action) → effect, for one user's permission overlay. */
export function useUserGrants(userId: string | null) {
  return useQuery({
    queryKey: userGrantsKeys.grants(userId ?? 'none'),
    enabled: userId != null,
    queryFn: async (): Promise<Map<string, GrantEffect>> => {
      const { data, error } = await supabaseUntyped
        .from('user_grants')
        .select('resource, action, effect')
        .eq('user_id', userId!)
      if (error) throw error
      const rows = (data ?? []) as { resource: string; action: string; effect: GrantEffect }[]
      return new Map(rows.map((g) => [`${g.resource}:${g.action}`, g.effect]))
    },
  })
}

export interface ScopeGrantRow {
  id: string
  departmentId: string | null
  teamId: string | null
}

/** The user's additive write-scope targets (one department or team per row). */
export function useUserScopeGrants(userId: string | null) {
  return useQuery({
    queryKey: userGrantsKeys.scope(userId ?? 'none'),
    enabled: userId != null,
    queryFn: async (): Promise<ScopeGrantRow[]> => {
      const { data, error } = await supabaseUntyped
        .from('user_scope_grants')
        .select('id, department_id, team_id')
        .eq('user_id', userId!)
      if (error) throw error
      const rows = (data ?? []) as { id: string; department_id: string | null; team_id: string | null }[]
      return rows.map((r) => ({ id: r.id, departmentId: r.department_id, teamId: r.team_id }))
    },
  })
}

function useInvalidateUserGrants() {
  const qc = useQueryClient()
  return (userId: string) => {
    void qc.invalidateQueries({ queryKey: userGrantsKeys.grants(userId) })
    void qc.invalidateQueries({ queryKey: userGrantsKeys.scope(userId) })
    // refresh the live permission snapshot (the edited user's, on their next fetch;
    // and the admin's own if they somehow edited themselves — blocked server-side).
    void qc.invalidateQueries({ queryKey: permissionKeys.all })
  }
}

export interface SetUserGrantArgs {
  userId: string
  resource: string
  action: string
  /** 'none' clears the override (delete); allow/deny replaces it. */
  effect: GrantEffect | 'none'
}

export function useSetUserGrant() {
  const { claims } = useAuth()
  const invalidate = useInvalidateUserGrants()
  return useMutation({
    mutationFn: async (args: SetUserGrantArgs) => {
      // Add/remove only (no UPDATE policy): clear any existing effect for this
      // triple, then insert the new one. Deny on an RBAC-admin grant is fenced
      // by the DB (chk_user_grants_no_deny_admin) — the UI disables it too.
      const { error: delErr } = await supabaseUntyped
        .from('user_grants')
        .delete()
        .eq('user_id', args.userId)
        .eq('resource', args.resource)
        .eq('action', args.action)
      if (delErr) throw delErr
      if (args.effect !== 'none') {
        const { error } = await supabaseUntyped.from('user_grants').insert({
          tenant_id: claims.tenantId,
          user_id: args.userId,
          resource: args.resource,
          action: args.action,
          effect: args.effect,
        })
        if (error) throw error
      }
    },
    // onSettled (not onSuccess): a denied insert still cleared the old row, so refetch either way.
    onSettled: (_d, _e, args) => invalidate(args.userId),
  })
}

export interface AddScopeGrantArgs {
  userId: string
  departmentId?: string | null
  teamId?: string | null
}

export function useAddScopeGrant() {
  const { claims } = useAuth()
  const invalidate = useInvalidateUserGrants()
  return useMutation({
    mutationFn: async (args: AddScopeGrantArgs) => {
      const { error } = await supabaseUntyped.from('user_scope_grants').insert({
        tenant_id: claims.tenantId,
        user_id: args.userId,
        department_id: args.departmentId ?? null,
        team_id: args.teamId ?? null,
      })
      if (error) throw error
    },
    onSettled: (_d, _e, args) => invalidate(args.userId),
  })
}

export function useRemoveScopeGrant() {
  const invalidate = useInvalidateUserGrants()
  return useMutation({
    mutationFn: async (args: { userId: string; id: string }) => {
      const { error } = await supabaseUntyped.from('user_scope_grants').delete().eq('id', args.id)
      if (error) throw error
    },
    onSettled: (_d, _e, args) => invalidate(args.userId),
  })
}
