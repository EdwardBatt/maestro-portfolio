import { useQuery } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { deliverableKeys, useTaskListRules } from './deliverables-api'
import type { ClientRule } from '../../../lib/brief/rules'

/**
 * ADR-0112 d.1 (I59.29, Q26b): the rules a piece follows, for the review screen — the same read the
 * task-list approval uses (`useTaskListRules`: the job's brief for the piece's department), reached
 * from the deliverable alone, because a review screen holds a deliverable id and nothing else.
 */
export function useDeliverableRuleScope(deliverableId: string | null) {
  return useQuery({
    queryKey: [...deliverableKeys.all, 'rule-scope', deliverableId ?? 'none'] as const,
    enabled: Boolean(deliverableId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<{ campaignId: string | null; departmentId: string | null }> => {
      const { data, error } = await supabaseUntyped
        .from('deliverables')
        .select('department_id, streams(campaign_id)')
        .eq('id', deliverableId!)
        .maybeSingle()
      if (error) throw error
      const row = data as {
        department_id: string | null
        streams: { campaign_id: string | null } | { campaign_id: string | null }[] | null
      } | null
      const s = Array.isArray(row?.streams) ? row?.streams[0] : row?.streams
      return { campaignId: s?.campaign_id ?? null, departmentId: row?.department_id ?? null }
    },
  })
}

/** The piece's rules — empty while loading, when it has none, or when the read fails. */
export function useDeliverableRules(deliverableId: string | null): { rules: ClientRule[]; isLoading: boolean } {
  const scope = useDeliverableRuleScope(deliverableId)
  const rules = useTaskListRules(scope.data?.campaignId ?? null, deliverableId)
  return { rules: rules.data ?? [], isLoading: scope.isLoading || rules.isLoading }
}
