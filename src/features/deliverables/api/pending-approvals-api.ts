import { useQuery } from '@tanstack/react-query'
import { pieceHref } from '../../../lib/navigation/piece-link'
import { supabaseUntyped } from '../../../lib/supabase'
import { allRows } from '../../../lib/query/all-pages'
import { handoverHref } from '../../../lib/navigation/handover-link'

/**
 * I53.16 — "Waiting for you": every approval the signed-in person can give, in one list.
 *
 * One read, `my_pending_approvals()`: what the person OWES, as the approver the system names —
 * never what a failsafe merely could approve (ADR-0070 d.6). The authority is the database's
 * (ADR-0037); the client shows what arrives and decides nothing. Task reviews are not here:
 * Awaiting my review already lists them, with their own actions.
 */
export type PendingApprovalKind =
  | 'department_brief'
  /** I53.22: my department's brief on an approved campaign is not WRITTEN yet — the row opens the
   *  department's tab, where Generate is. `id` and `campaignId` are the campaign; `targetId` the department. */
  | 'department_brief_unwritten'
  | 'task_list'
  /** I66.3: a deliverable with no live task — the owner defines the tasks; nothing to approve yet. */
  | 'task_list_undefined'
  /** I66.11: every task on the piece was cancelled — its owner adds a task or closes it. */
  | 'tasks_all_cancelled'
  | 'booking_request'
  | 'extension_request'
  | 'campaign'
  /** ADR-0133 (I70.3): a leaving person's work waits to be handed over. `id` and `targetId` are the person; `title` their name. */
  | 'handover'

export interface PendingApproval {
  kind: PendingApprovalKind
  id: string
  title: string
  campaignId: string | null
  campaignName: string | null
  department: string | null
  since: string | null
  /** What the row is about: the department (brief), the deliverable (task list), the task
   *  (booking or extension request), the campaign. */
  targetId: string
  deliverableId: string | null
  /** ADR-0133: for a `handover` row, how many items the leaving person still holds. */
  itemsLeft?: number | null
}

export const pendingApprovalKeys = {
  all: ['pending-approvals'] as const,
}

export function usePendingApprovals(enabled = true) {
  return useQuery({
    queryKey: pendingApprovalKeys.all,
    enabled,
    // The same clock as the campaign page and My Work: a colleague's request appears without a
    // refresh, and an answered one leaves.
    refetchInterval: 20_000,
    queryFn: async (): Promise<PendingApproval[]> => {
      // Every page (I59.35): a set-returning RPC is cut at the server's 1,000 rows like any list, and
      // one owner already had 533 task lists waiting locally on 25 Sep. The function's own order
      // (oldest first) leads; kind, id and target break its ties so the pages neither overlap nor skip.
      const data = await allRows<Record<string, unknown>>((a, b) =>
        supabaseUntyped
          .rpc('my_pending_approvals')
          .order('since', { ascending: true, nullsFirst: false })
          .order('kind')
          .order('id')
          .order('target_id')
          .range(a, b))
      // ADR-0133: a hand-over row says how much is left — one read of who is leaving, only when a row needs it.
      const left = new Map<string, number>()
      if (data.some((r) => r.kind === 'handover')) {
        const { data: people } = await supabaseUntyped.rpc('leaving_people')
        for (const p of (people ?? []) as { user_id: string; items_remaining: number }[]) left.set(p.user_id, Number(p.items_remaining ?? 0))
      }
      return data.map((r) => ({
        kind: r.kind as PendingApprovalKind,
        id: r.id as string,
        title: (r.title as string | null) ?? '',
        campaignId: (r.campaign_id as string | null) ?? null,
        campaignName: (r.campaign_name as string | null) ?? null,
        department: (r.department as string | null) ?? null,
        since: (r.since as string | null) ?? null,
        targetId: r.target_id as string,
        deliverableId: (r.deliverable_id as string | null) ?? null,
        itemsLeft: r.kind === 'handover' ? left.get(r.target_id as string) ?? null : null,
      }))
    },
  })
}

/** Where each kind of approval is answered. The booking request is answered in place. */
export function pendingApprovalLink(a: PendingApproval): string | null {
  switch (a.kind) {
    case 'department_brief':
    case 'department_brief_unwritten':
      // On the department's own tab — where the brief is read, approved, or written (I53.22).
      return a.campaignId ? `/campaigns/${a.campaignId}?tab=${a.targetId}` : null
    case 'campaign':
      return a.campaignId ? `/campaigns/${a.campaignId}` : null
    case 'task_list':
    case 'task_list_undefined':
    case 'tasks_all_cancelled':
      return pieceHref(a.campaignId, a.targetId)   // ADR-0132 d.8: the piece's panel, where the list is approved
    case 'booking_request':
    case 'extension_request':
      return a.deliverableId ? pieceHref(a.campaignId, a.deliverableId, a.targetId) : null
    case 'handover':
      return handoverHref(a.targetId)
  }
}
