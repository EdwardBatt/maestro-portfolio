import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { useAuth } from '../../../app/auth-context'

/**
 * SLA profiles API (ADR-0029, I7.3). Reusable turnaround expectations per work type. Reads are
 * tenant-wide; writes go through the RLS-governed sla_profiles table (sla_profiles:manage — leads +
 * Power Admin). The one-default-per-work-type rule is enforced by a partial-unique index (23505).
 */

export const slaKeys = {
  all: ['sla-profiles'] as const,
  list: () => [...slaKeys.all, 'list'] as const,
}

/**
 * I21 (ADR-0056 d.5/d.14): `work_type_id` is gone and the profile carries NO axis.
 *
 * ADR-0053 d.4 adds `department_id` and `deliverable_type_id` in its place, but that is `I20.3` and
 * it is ⚠️-gated on ADR-0032, which is not agreed. So a profile is a name, a turnaround and a
 * default flag until the gate lifts — and `app.effective_sla` resolves through the leaf, the job
 * and the tenant default only. Nothing regresses: the pilot's single profile carries no axis today.
 */
export interface SlaProfile {
  id: string
  name: string
  turnaroundHours: number | null
  isDefault: boolean
}

interface SlaProfileRaw {
  id: string
  name: string
  turnaround_hours: number | null
  is_default: boolean
}

export function useSlaProfiles() {
  return useQuery({
    queryKey: slaKeys.list(),
    queryFn: async (): Promise<SlaProfile[]> => {
      const { data, error } = await supabaseUntyped
        .from('sla_profiles')
        .select('id, name, turnaround_hours, is_default')
        .order('name')
      if (error) throw error
      return ((data ?? []) as unknown as SlaProfileRaw[]).map((r) => ({
        id: r.id,
        name: r.name,
        turnaroundHours: r.turnaround_hours,
        isDefault: r.is_default,
      }))
    },
  })
}

export interface SlaProfileInput {
  id?: string
  name: string
  turnaroundHours: number | null
  isDefault: boolean
}

export function useSaveSlaProfile() {
  const { claims } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: SlaProfileInput) => {
      const fields = {
        name: input.name.trim(),
        turnaround_hours: input.turnaroundHours,
        is_default: input.isDefault,
      }
      if (input.id) {
        const { error } = await supabaseUntyped.from('sla_profiles').update(fields).eq('id', input.id)
        if (error) throw error
      } else {
        const { error } = await supabaseUntyped.from('sla_profiles').insert({ tenant_id: claims.tenantId, ...fields })
        if (error) throw error
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: slaKeys.all }),
  })
}
