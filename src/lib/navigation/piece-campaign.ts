import { useQuery } from '@tanstack/react-query'
import { supabaseUntyped } from '../supabase'
import { pieceHref } from './piece-link'

/**
 * **The campaign a deliverable belongs to**, looked up from the deliverable alone (I59.45, I68.13).
 *
 * A link that names only the deliverable — the bell's `/campaigns/piece/<id>`, an old `/deliverables?open=<id>` with
 * no `&campaign=` — has to find the campaign before it can open the piece's panel there (ADR-0132 d.8). Ad-hoc work
 * has no campaign: `null`.
 */
export async function fetchPieceCampaign(deliverableId: string): Promise<string | null> {
  const { data, error } = await supabaseUntyped
    .from('deliverables')
    .select('streams(campaign_id)')
    .eq('id', deliverableId)
    .maybeSingle()
  if (error) throw error
  const s = (data as { streams?: { campaign_id?: string | null } | { campaign_id?: string | null }[] | null } | null)?.streams
  return (Array.isArray(s) ? s[0] : s)?.campaign_id ?? null
}

export function usePieceCampaign(deliverableId: string | null | undefined) {
  return useQuery({
    queryKey: ['piece-campaign', deliverableId],
    enabled: Boolean(deliverableId),
    queryFn: () => fetchPieceCampaign(deliverableId!),
  })
}

/** The piece a task belongs to — for a `?task=` link that names no deliverable (I74). */
export function useTaskPiece(taskId: string | null | undefined) {
  return useQuery({
    queryKey: ['task-piece', taskId],
    enabled: Boolean(taskId),
    queryFn: async () => {
      const { data, error } = await supabaseUntyped.from('sub_tasks').select('deliverable_id').eq('id', taskId!).maybeSingle()
      if (error) throw error
      return ((data as { deliverable_id: string | null } | null)?.deliverable_id ?? null)
    },
  })
}

export type OpenLinkTarget =
  | { kind: 'wait' }
  | { kind: 'forward'; href: string }
  | { kind: 'adhoc' }
  | { kind: 'none' }

/**
 * Where an old Deliverables link (`?open=<deliverable>`, `&task=<task>`) goes now (ADR-0132 d.8, I68.13): a campaign's
 * deliverable forwards to its piece's panel on the campaign page; ad-hoc work — no campaign — keeps this page's
 * window, on the Ad-hoc tab. `campaignId` is the row's own when the list already holds it, else the looked-up one
 * (`undefined` while the look-up runs).
 */
export function openLinkTarget(openId: string | null, taskId: string | null, campaignId: string | null | undefined): OpenLinkTarget {
  if (!openId) return { kind: 'none' }
  if (campaignId === undefined) return { kind: 'wait' }
  return campaignId ? { kind: 'forward', href: pieceHref(campaignId, openId, taskId) } : { kind: 'adhoc' }
}
