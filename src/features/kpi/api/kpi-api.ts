import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { allRows } from '../../../lib/query/all-pages'
import { useAuth } from '../../../app/auth-context'

/**
 * KPIs API (ADR-0029, I7.4). A personal scorecard (the caller's own kpi_targets — RLS-scoped),
 * definition + target management for kpi:manage holders, and team/department rollups via the
 * public.kpi_rollup wrapper. kpi_targets is read-restricted (self / lead-chain / health:view).
 */

export const kpiKeys = {
  all: ['kpis'] as const,
  mine: (userId: string | null) => [...kpiKeys.all, 'mine', userId ?? 'none'] as const,
  defs: () => [...kpiKeys.all, 'defs'] as const,
  rollup: (start: string, end: string) => [...kpiKeys.all, 'rollup', start, end] as const,
  users: () => [...kpiKeys.all, 'users'] as const,
}

export interface KpiDefinition {
  id: string
  name: string
  unit: string | null
  aggregation: 'avg' | 'sum' | 'weighted'
  higherIsBetter: boolean
}

export interface MyKpi {
  id: string
  name: string
  unit: string | null
  higherIsBetter: boolean
  periodStart: string
  periodEnd: string
  target: number | null
  actual: number | null
}

export interface RollupRow {
  kpiDefinitionId: string
  scopeKind: 'team' | 'department'
  scopeId: string
  target: number | null
  actual: number | null
}

export interface UserOption {
  id: string
  name: string
}

/** The signed-in person's KPI targets (RLS: self), newest period first. */
export function useMyKpis(userId: string | null) {
  return useQuery({
    queryKey: kpiKeys.mine(userId),
    enabled: !!userId,
    queryFn: async (): Promise<MyKpi[]> => {
      const { data, error } = await supabaseUntyped
        .from('kpi_targets')
        .select('id, period_start, period_end, target, actual, kpi_definitions(name, unit, higher_is_better)')
        .eq('user_id', userId!)
        .order('period_start', { ascending: false })
      if (error) throw error
      interface Raw {
        id: string; period_start: string; period_end: string; target: number | null; actual: number | null
        kpi_definitions: { name: string; unit: string | null; higher_is_better: boolean } | { name: string; unit: string | null; higher_is_better: boolean }[] | null
      }
      return ((data ?? []) as unknown as Raw[]).map((r) => {
        const def = Array.isArray(r.kpi_definitions) ? r.kpi_definitions[0] : r.kpi_definitions
        return {
          id: r.id, name: def?.name ?? '—', unit: def?.unit ?? null, higherIsBetter: def?.higher_is_better ?? true,
          periodStart: r.period_start, periodEnd: r.period_end, target: r.target, actual: r.actual,
        }
      })
    },
  })
}

export interface ScorecardRow {
  id: string
  userId: string
  name: string
  unit: string | null
  higherIsBetter: boolean
  periodStart: string
  periodEnd: string
  target: number | null
  actual: number | null
}

/**
 * Individual KPI targets across everyone the caller may read (drill-to-individual).
 * No user filter — RLS (`app.caller_can_read_kpi`) returns exactly the caller's slice:
 * self for a member, the team for a Team Lead, the department for a Department Lead,
 * the whole tenant for C-level / health:view. Names resolved via useTenantUsers.
 */
export function useKpiScorecards(enabled: boolean) {
  return useQuery({
    queryKey: [...kpiKeys.all, 'scorecards'] as const,
    enabled,
    queryFn: async (): Promise<ScorecardRow[]> => {
      interface Raw {
        id: string; user_id: string; period_start: string; period_end: string; target: number | null; actual: number | null
        kpi_definitions: { name: string; unit: string | null; higher_is_better: boolean } | { name: string; unit: string | null; higher_is_better: boolean }[] | null
      }
      // Every page (I59.35): every target of every person, every period — past 1,000 within a year.
      const data = await allRows<Raw>((a, b) =>
        supabaseUntyped
          .from('kpi_targets')
          .select('id, user_id, period_start, period_end, target, actual, kpi_definitions(name, unit, higher_is_better)')
          .order('period_start', { ascending: false })
          .order('id', { ascending: true })
          .range(a, b))
      return data.map((r) => {
        const def = Array.isArray(r.kpi_definitions) ? r.kpi_definitions[0] : r.kpi_definitions
        return {
          id: r.id, userId: r.user_id, name: def?.name ?? '—', unit: def?.unit ?? null,
          higherIsBetter: def?.higher_is_better ?? true,
          periodStart: r.period_start, periodEnd: r.period_end, target: r.target, actual: r.actual,
        }
      })
    },
  })
}

export function useKpiDefinitions() {
  return useQuery({
    queryKey: kpiKeys.defs(),
    queryFn: async (): Promise<KpiDefinition[]> => {
      const { data, error } = await supabaseUntyped
        .from('kpi_definitions')
        .select('id, name, unit, aggregation, higher_is_better')
        .order('name')
      if (error) throw error
      return ((data ?? []) as { id: string; name: string; unit: string | null; aggregation: KpiDefinition['aggregation']; higher_is_better: boolean }[])
        .map((r) => ({ id: r.id, name: r.name, unit: r.unit, aggregation: r.aggregation, higherIsBetter: r.higher_is_better }))
    },
  })
}

export function useTenantUsers() {
  return useQuery({
    queryKey: kpiKeys.users(),
    queryFn: async (): Promise<UserOption[]> => {
      const { data, error } = await supabaseUntyped.from('user_profiles').select('id, display_name').order('display_name')
      if (error) throw error
      return ((data ?? []) as { id: string; display_name: string }[]).map((u) => ({ id: u.id, name: u.display_name }))
    },
  })
}

export function useKpiRollup(start: string, end: string, enabled: boolean) {
  return useQuery({
    queryKey: kpiKeys.rollup(start, end),
    enabled,
    queryFn: async (): Promise<RollupRow[]> => {
      // Every page (I59.35): one row per KPI per person, team and department — a set-returning RPC
      // is cut at 1,000 rows like any list.
      const data = await allRows<{ kpi_definition_id: string; scope_kind: RollupRow['scopeKind']; scope_id: string; target: number | null; actual: number | null }>((a, b) =>
        supabaseUntyped
          .rpc('kpi_rollup', { p_start: start, p_end: end })
          .order('kpi_definition_id')
          .order('scope_kind')
          .order('scope_id')
          .range(a, b))
      return data
        .map((r) => ({ kpiDefinitionId: r.kpi_definition_id, scopeKind: r.scope_kind, scopeId: r.scope_id, target: r.target, actual: r.actual }))
    },
  })
}

export interface KpiDefinitionInput {
  name: string
  unit: string | null
  aggregation: 'avg' | 'sum' | 'weighted'
  higherIsBetter: boolean
}

export function useSaveKpiDefinition() {
  const { claims } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: KpiDefinitionInput) => {
      const { error } = await supabaseUntyped.from('kpi_definitions').insert({
        tenant_id: claims.tenantId,
        name: input.name.trim(),
        unit: input.unit || null,
        aggregation: input.aggregation,
        higher_is_better: input.higherIsBetter,
        source: 'manual',
      })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: kpiKeys.all }),
  })
}

export interface KpiTargetInput {
  kpiDefinitionId: string
  userId: string
  periodStart: string
  periodEnd: string
  target: number | null
  actual: number | null
}

export function useSaveKpiTarget() {
  const { claims } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: KpiTargetInput) => {
      const { error } = await supabaseUntyped.from('kpi_targets').upsert(
        {
          tenant_id: claims.tenantId,
          kpi_definition_id: input.kpiDefinitionId,
          user_id: input.userId,
          period_start: input.periodStart,
          period_end: input.periodEnd,
          target: input.target,
          actual: input.actual,
        },
        { onConflict: 'kpi_definition_id,user_id,period_start,period_end' },
      )
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: kpiKeys.all }),
  })
}
