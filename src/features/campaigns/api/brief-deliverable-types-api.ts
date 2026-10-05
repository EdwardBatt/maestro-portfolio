import { useQuery } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { allRows } from '../../../lib/query/all-pages'

/**
 * Which deliverable types each brief type orders (ADR-0071 d.1).
 *
 * **The gap this fills.** Nothing has ever linked a brief to the work it can produce, so the wizard
 * offered all 269 types on every brief sorted by category — Bottle and Billboard beside Reel on a
 * social brief. Asked on 5 Sep how a campaign type matched the content it produces, the honest
 * answer was that nothing said so.
 *
 * **It SORTS, it does not restrict** (d.1). Every type stays selectable; the ones the brief actually
 * orders are simply first. A hard limit would turn every gap in a 269-row judgement about an agency
 * into somebody unable to do their job at five o'clock — and it means this mapping can be wrong in
 * production without blocking anyone.
 *
 * The list is small (317 rows), tenant-scoped by RLS and effectively static, so it is fetched once
 * and kept: it is configuration, not data that moves while somebody fills in a form.
 */

export const briefDeliverableTypeKeys = {
  all: ['brief-deliverable-types'] as const,
}

/** brief_type -> the set of deliverable_type ids that brief orders. */
export type BriefTypeMap = Map<string, Set<string>>

export function useBriefDeliverableTypes() {
  return useQuery({
    queryKey: briefDeliverableTypeKeys.all,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<BriefTypeMap> => {
      // Every page (I59.35): one row per brief type per deliverable type — 317 locally, and the
      // catalogue's size times the brief types at most.
      const data = await allRows<{ brief_type: string; deliverable_type_id: string }>((a, b) =>
        supabaseUntyped
          .from('brief_deliverable_types')
          .select('brief_type, deliverable_type_id')
          .order('brief_type')
          .order('deliverable_type_id')
          .range(a, b))
      const out: BriefTypeMap = new Map()
      for (const r of data) {
        let set = out.get(r.brief_type)
        if (!set) {
          set = new Set<string>()
          out.set(r.brief_type, set)
        }
        set.add(r.deliverable_type_id)
      }
      return out
    },
  })
}
