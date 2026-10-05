import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { useAuth } from '../../../app/auth-context'
import { adminKeys } from './admin-api'

/**
 * Organization administration (L1.5). Direct RLS-governed writes — the
 * organization:manage grant decides who may change these, tenant scoping is
 * enforced by policy, and the audit triggers log every change. Departments
 * first; offices/clients/projects join this module as L1.5 completes.
 */

export const orgKeys = {
  all: [...adminKeys.all, 'org'] as const,
  departments: () => [...orgKeys.all, 'departments'] as const,
  teams: () => [...orgKeys.all, 'teams'] as const,
  offices: () => [...orgKeys.all, 'offices'] as const,
}

// ---- Offices (L1.5: timezone + working week; ADR-0005) ----

export interface OfficeRow {
  id: string
  name: string
  timezone: string
  /** ISO weekday numbers this office works (1=Mon..7=Sun) */
  workingDays: number[]
  memberCount: number
  resourceCount: number
}

export interface OfficeWriteArgs {
  name: string
  timezone: string
  workingDays: number[]
}

export function useOfficesAdmin() {
  return useQuery({
    queryKey: orgKeys.offices(),
    queryFn: async (): Promise<OfficeRow[]> => {
      const { data: raw, error } = await supabaseUntyped
        .from('offices')
        .select('id, name, timezone, working_days, user_profiles(count), resources(count)')
        .order('name')
      if (error) throw error
      const rows = (raw ?? []) as unknown as {
        id: string
        name: string
        timezone: string
        working_days: number[]
        user_profiles: { count: number }[]
        resources: { count: number }[]
      }[]
      return rows.map((o) => ({
        id: o.id,
        name: o.name,
        timezone: o.timezone,
        workingDays: o.working_days ?? [],
        memberCount: o.user_profiles?.[0]?.count ?? 0,
        resourceCount: o.resources?.[0]?.count ?? 0,
      }))
    },
  })
}

function useInvalidateOffices() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: orgKeys.offices() })
    void qc.invalidateQueries({ queryKey: adminKeys.offices() }) // invite/resource office dropdowns
    void qc.invalidateQueries({ queryKey: ['schedule'] }) // grid non-working-day shading depends on this
  }
}

export function useCreateOffice() {
  const { claims } = useAuth()
  const invalidate = useInvalidateOffices()
  return useMutation({
    mutationFn: async (args: OfficeWriteArgs) => {
      const { error } = await supabaseUntyped.from('offices').insert({
        tenant_id: claims.tenantId,
        name: args.name.trim(),
        timezone: args.timezone,
        working_days: args.workingDays,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useUpdateOffice() {
  const invalidate = useInvalidateOffices()
  return useMutation({
    mutationFn: async (args: { id: string } & OfficeWriteArgs) => {
      const { error } = await supabaseUntyped
        .from('offices')
        .update({ name: args.name.trim(), timezone: args.timezone, working_days: args.workingDays })
        .eq('id', args.id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useDeleteOffice() {
  const invalidate = useInvalidateOffices()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabaseUntyped.from('offices').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export interface DepartmentRow {
  id: string
  name: string
  /** people assigned via user_profiles.department_id */
  memberCount: number
  /** resources assigned via resources.department_id */
  resourceCount: number
  /** ADR-0115: does it take production work? Off keeps it and its people out of every work picker. */
  isProduction: boolean
}

export function useDepartmentsAdmin() {
  return useQuery({
    queryKey: orgKeys.departments(),
    queryFn: async (): Promise<DepartmentRow[]> => {
      const { data: raw, error } = await supabaseUntyped
        .from('departments')
        .select('id, name, is_production, user_profiles(count), resources(count)')
        .order('name')
      if (error) throw error
      const rows = (raw ?? []) as {
        id: string; name: string; is_production: boolean
        user_profiles: { count: number }[]; resources: { count: number }[]
      }[]
      return rows.map((d) => ({
        id: d.id,
        name: d.name,
        memberCount: d.user_profiles?.[0]?.count ?? 0,
        resourceCount: d.resources?.[0]?.count ?? 0,
        isProduction: d.is_production !== false,
      }))
    },
  })
}

function useInvalidateDepartments() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: orgKeys.departments() })
    void qc.invalidateQueries({ queryKey: adminKeys.departments() }) // invite/users dropdowns
    void qc.invalidateQueries({ queryKey: adminKeys.users() })
  }
}

export function useCreateDepartment() {
  const { claims } = useAuth()
  const invalidate = useInvalidateDepartments()
  return useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabaseUntyped
        .from('departments')
        .insert({ tenant_id: claims.tenantId, name: name.trim() })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

/**
 * ADR-0115 d.2: switch a department's production work on or off. The database refuses OFF while it
 * still owns live work (d.5) and names what must move; that refusal is shown as it is worded. Every
 * cached list is refreshed after, because the switch changes who the Schedule and every picker offer.
 */
export function useSetDepartmentProduction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { id: string; isProduction: boolean }) => {
      const { error } = await supabaseUntyped
        .from('departments')
        .update({ is_production: args.isProduction })
        .eq('id', args.id)
      if (error) throw error
    },
    onSuccess: () => { void qc.invalidateQueries() },
  })
}

export function useRenameDepartment() {
  const invalidate = useInvalidateDepartments()
  return useMutation({
    mutationFn: async (args: { id: string; name: string }) => {
      const { error } = await supabaseUntyped
        .from('departments')
        .update({ name: args.name.trim() })
        .eq('id', args.id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useDeleteDepartment() {
  const invalidate = useInvalidateDepartments()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabaseUntyped.from('departments').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

// ---- Teams (ADR-0009: an org sub-layer inside departments) ----

export interface TeamRow {
  id: string
  name: string
  departmentId: string
  departmentName: string
  /** people assigned via user_profiles.team_id */
  memberCount: number
}

export function useTeamsAdmin() {
  return useQuery({
    queryKey: orgKeys.teams(),
    queryFn: async (): Promise<TeamRow[]> => {
      const { data: raw, error } = await supabaseUntyped
        .from('teams')
        .select('id, name, department_id, departments(name), user_profiles(count)')
        .order('name')
      if (error) throw error
      const rows = (raw ?? []) as unknown as {
        id: string
        name: string
        department_id: string
        departments: { name: string } | { name: string }[] | null
        user_profiles: { count: number }[]
      }[]
      return rows.map((tm) => {
        const dep = Array.isArray(tm.departments) ? tm.departments[0] : tm.departments
        return {
          id: tm.id,
          name: tm.name,
          departmentId: tm.department_id,
          departmentName: dep?.name ?? '',
          memberCount: tm.user_profiles?.[0]?.count ?? 0,
        }
      })
    },
  })
}

function useInvalidateTeams() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: orgKeys.teams() })
    void qc.invalidateQueries({ queryKey: adminKeys.all }) // team dropdowns on invite/users
  }
}

export function useCreateTeam() {
  const { claims } = useAuth()
  const invalidate = useInvalidateTeams()
  return useMutation({
    mutationFn: async (args: { departmentId: string; name: string }) => {
      const { error } = await supabaseUntyped
        .from('teams')
        .insert({ tenant_id: claims.tenantId, department_id: args.departmentId, name: args.name.trim() })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useRenameTeam() {
  const invalidate = useInvalidateTeams()
  return useMutation({
    mutationFn: async (args: { id: string; name: string }) => {
      const { error } = await supabaseUntyped.from('teams').update({ name: args.name.trim() }).eq('id', args.id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useDeleteTeam() {
  const invalidate = useInvalidateTeams()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabaseUntyped.from('teams').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}
