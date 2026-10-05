import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { useAuth } from '../../../app/auth-context'
import { adminKeys } from './admin-api'

/**
 * Resource administration (L1.4, ADR-0011). Direct RLS-governed writes — the
 * resources:manage grant decides who may change these, tenant scoping is
 * enforced by policy, and the universal audit trigger logs every change.
 * Uses the untyped client because nickname/team_id lag the generated types
 * until `gen types` re-runs after `db push` (same pattern as org-api/teams).
 *
 * NOTE on rates: cost_rate/charge_rate are still tenant-readable at the row
 * level (column-level protection is L1.6). The screen only *shows/edits* them
 * behind resources:manage as an interim UI guard; L1.6 hardens the DB side.
 */

export type ResourceKind = 'human' | 'equipment' | 'room'
export type CapacityModel = 'exclusive' | 'pooled' | 'load_based'

export interface AdminResource {
  id: string
  kind: ResourceKind
  name: string
  nickname: string | null
  capacityModel: CapacityModel
  poolSize: number | null
  loadCeilingPct: number | null
  warnAtPct: number | null
  costRate: number | null
  chargeRate: number | null
  currency: string
  requiresApproval: boolean
  isActive: boolean
  departmentId: string | null
  departmentName: string | null
  teamId: string | null
  teamName: string | null
  officeId: string | null
  officeName: string | null
  userId: string | null
  userName: string | null
}

interface ResourceRow {
  id: string
  kind: ResourceKind
  name: string
  nickname: string | null
  capacity_model: CapacityModel
  pool_size: number | null
  load_ceiling_pct: number | string | null
  warn_at_pct: number | string | null
  cost_rate: number | string | null
  charge_rate: number | string | null
  currency: string
  requires_approval: boolean
  is_active: boolean
  department_id: string | null
  team_id: string | null
  office_id: string | null
  user_id: string | null
  departments: { name: string } | null
  teams: { name: string } | null
  offices: { name: string } | null
  user_profiles: { display_name: string } | null
}

const num = (v: number | string | null): number | null => (v == null ? null : Number(v))

export function useResourcesAdmin() {
  return useQuery({
    queryKey: adminKeys.resources(),
    queryFn: async (): Promise<AdminResource[]> => {
      const { data: raw, error } = await supabaseUntyped
        .from('resources')
        .select(
          'id, kind, name, nickname, capacity_model, pool_size, load_ceiling_pct, warn_at_pct, ' +
            'cost_rate, charge_rate, currency, requires_approval, is_active, ' +
            'department_id, team_id, office_id, user_id, ' +
            'departments(name), teams(name), offices(name), user_profiles(display_name)',
        )
        .order('name')
      if (error) throw error
      const rows = (raw ?? []) as unknown as ResourceRow[]
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        name: r.name,
        nickname: r.nickname,
        capacityModel: r.capacity_model,
        poolSize: r.pool_size,
        loadCeilingPct: num(r.load_ceiling_pct),
        warnAtPct: num(r.warn_at_pct),
        costRate: num(r.cost_rate),
        chargeRate: num(r.charge_rate),
        currency: r.currency,
        requiresApproval: r.requires_approval,
        isActive: r.is_active,
        departmentId: r.department_id,
        departmentName: r.departments?.name ?? null,
        teamId: r.team_id,
        teamName: r.teams?.name ?? null,
        officeId: r.office_id,
        officeName: r.offices?.name ?? null,
        userId: r.user_id,
        userName: r.user_profiles?.display_name ?? null,
      }))
    },
  })
}

/** Active logins not yet linked to any resource — offered when linking a user. */
export function useLinkableUsers() {
  return useQuery({
    queryKey: [...adminKeys.resources(), 'linkable-users'] as const,
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const [usersRes, resRes] = await Promise.all([
        supabaseUntyped.from('user_profiles').select('id, display_name').eq('is_active', true).order('display_name'),
        supabaseUntyped.from('resources').select('user_id').not('user_id', 'is', null),
      ])
      if (usersRes.error) throw usersRes.error
      if (resRes.error) throw resRes.error
      const linked = new Set(((resRes.data ?? []) as { user_id: string }[]).map((r) => r.user_id))
      const users = (usersRes.data ?? []) as { id: string; display_name: string }[]
      return users.filter((u) => !linked.has(u.id)).map((u) => ({ id: u.id, name: u.display_name }))
    },
  })
}

export interface ResourceWriteArgs {
  kind: ResourceKind
  name: string
  nickname: string | null
  capacityModel: CapacityModel
  poolSize: number | null
  loadCeilingPct: number | null
  warnAtPct: number | null
  costRate: number | null
  chargeRate: number | null
  currency: string
  requiresApproval: boolean
  departmentId: string | null
  teamId: string | null
  officeId: string | null
}

/** Shape a write payload → DB columns; blank nickname becomes NULL (matches the
 * chk_resources_nickname_nonblank + unique-index contract). */
function toRow(a: ResourceWriteArgs) {
  const nickname = (a.nickname ?? '').trim()
  return {
    kind: a.kind,
    name: a.name.trim(),
    nickname: nickname || null,
    capacity_model: a.capacityModel,
    pool_size: a.capacityModel === 'pooled' ? a.poolSize : null,
    load_ceiling_pct: a.capacityModel === 'load_based' ? a.loadCeilingPct : null,
    warn_at_pct: a.capacityModel === 'load_based' ? a.warnAtPct : null,
    cost_rate: a.costRate,
    charge_rate: a.chargeRate,
    currency: a.currency,
    requires_approval: a.requiresApproval,
    department_id: a.departmentId,
    team_id: a.teamId,
    office_id: a.officeId,
  }
}

function useInvalidateResources() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: adminKeys.resources() })
    void qc.invalidateQueries({ queryKey: ['schedule'] }) // grid rows
  }
}

export function useCreateResource() {
  const { claims } = useAuth()
  const invalidate = useInvalidateResources()
  return useMutation({
    mutationFn: async (args: ResourceWriteArgs) => {
      const { error } = await supabaseUntyped.from('resources').insert({ tenant_id: claims.tenantId, ...toRow(args) })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useUpdateResource() {
  const invalidate = useInvalidateResources()
  return useMutation({
    mutationFn: async (args: { id: string } & ResourceWriteArgs) => {
      const { id, ...rest } = args
      const { error } = await supabaseUntyped.from('resources').update(toRow(rest)).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useSetResourceActive() {
  const invalidate = useInvalidateResources()
  return useMutation({
    mutationFn: async (args: { id: string; isActive: boolean }) => {
      const { error } = await supabaseUntyped.from('resources').update({ is_active: args.isActive }).eq('id', args.id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

/** Link a login to a resource, or unlink (userId = null). */
export function useSetResourceUser() {
  const invalidate = useInvalidateResources()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { id: string; userId: string | null }) => {
      const { error } = await supabaseUntyped.from('resources').update({ user_id: args.userId }).eq('id', args.id)
      if (error) throw error
    },
    onSuccess: () => {
      invalidate()
      void qc.invalidateQueries({ queryKey: [...adminKeys.resources(), 'linkable-users'] })
      void qc.invalidateQueries({ queryKey: adminKeys.unlinkedResources() })
    },
  })
}
