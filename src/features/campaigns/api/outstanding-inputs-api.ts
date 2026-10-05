import { useQuery } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { inChunks } from '../../../lib/query/in-chunks'
import { deliverableKeys } from '../../deliverables/api/deliverables-api'

/**
 * How many external inputs each of a campaign's pieces is still waiting for — what puts a piece in
 * the Board's WAITING column and labels its Timeline bar "waiting" (CG-05 / CG-06, I57.8 / I57.9).
 * "Blocked" does not exist (3 Sep): a piece waits on an outstanding input
 * (`deliverable_pending_inputs`, `satisfied_at is null`), and that is the only thing it waits on.
 *
 * FLAT reads, as `campaign-pulse-api.ts` does it: the campaign's streams, their live pieces, then
 * the inputs — the per-id reads go through `inChunks` so a large campaign cannot send a 414-long
 * address (I49.75). The key sits under the campaign's deliverables key, so whatever refreshes the
 * pieces refreshes this with them.
 *
 * Returns Map<deliverableId, count>; a piece waiting on nothing is absent.
 */
export function useOutstandingInputs(campaignId: string | null) {
  return useQuery({
    queryKey: [...deliverableKeys.byCampaign(campaignId ?? 'none'), 'outstanding-inputs'] as const,
    enabled: !!campaignId,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<Map<string, number>> => {
      const { data: streams, error } = await supabaseUntyped.from('streams').select('id').eq('campaign_id', campaignId!)
      if (error) throw error
      const streamIds = ((streams ?? []) as { id: string }[]).map((s) => s.id)
      const pieces = await inChunks<{ id: string }>(streamIds, (chunk) =>
        supabaseUntyped.from('deliverables').select('id').neq('state', 'archived').in('stream_id', chunk))
      const inputs = await inChunks<{ deliverable_id: string }>(pieces.map((p) => p.id), (chunk) =>
        supabaseUntyped.from('deliverable_pending_inputs').select('deliverable_id').is('satisfied_at', null).in('deliverable_id', chunk))
      const out = new Map<string, number>()
      for (const i of inputs) out.set(i.deliverable_id, (out.get(i.deliverable_id) ?? 0) + 1)
      return out
    },
  })
}
