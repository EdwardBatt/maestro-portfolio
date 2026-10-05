import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, supabaseUntyped } from '../../../lib/supabase'
import { invalidateTaskViews } from '../../../lib/query/task-views'
import { adminKeys } from './admin-api'

/**
 * A leaving person's hand-over (ADR-0133, I70).
 *
 * Deactivating someone starts the **Leaving** stage (`update-user` → `start_deactivation`): they lose access at once,
 * and everything they hold that someone must take on is listed for their department lead — for Client Services the
 * Account Director; where there is none, or they ARE the lead, the Traffic Manager and the Power Admins. Each item is
 * handed to a named person through the same write its own page makes (`hand_over_item`); the last one completes the
 * deactivation (they become **Deactivated**, off the Schedule).
 *
 * - `useHandoverItems(userId)` — the list: clients, campaigns and jobs, deliverables, workstreams, open tasks, reviews.
 * - `useHandOverItem()` — one item to a named person. A task moved to someone else is re-booked for them through
 *   `subtask-schedule`, exactly as the Schedule's own reassignment does.
 * - `useLeavingPeople()` — who is leaving, since when, how much is left (the Users page and the page's header).
 */

export type HandoverKind = 'client' | 'campaign' | 'deliverable' | 'workstream' | 'task' | 'review'

/** The order the list is shown in (ADR-0133 d.3). */
export const HANDOVER_KINDS: readonly HandoverKind[] = ['client', 'campaign', 'deliverable', 'workstream', 'task', 'review']

export interface HandoverItem {
  kind: HandoverKind
  /** the client, campaign, deliverable, workstream, task — or, for a review, the reviewer appointment */
  itemId: string
  label: string
  /** where it sits: the client of a campaign, the campaign of a deliverable, the deliverable of a task */
  context: string | null
  detail: Record<string, unknown>
}

export interface LeavingPerson {
  /** the leaving person's user id */
  id: string
  name: string
  department: string | null
  leavingSince: string
  startedByName: string | null
  itemsRemaining: number
  /** remaining items by kind, e.g. { task: 12, review: 4 } */
  items: Partial<Record<HandoverKind, number>>
}

export interface HandOverResult {
  kind: HandoverKind
  itemId: string
  to: string
  /** 'handed_over' | 'assigned' — or 'requested' when the new person is outside your reach (a request went to their lead) */
  outcome: string
  rescheduleNeeded: boolean
  /** the list is now empty and the deactivation completed */
  completed: boolean
}

type ItemRaw = { kind: HandoverKind; item_id: string; label: string; context: string | null; detail: Record<string, unknown> | null }
type LeavingRaw = {
  user_id: string; name: string; department: string | null; leaving_since: string; started_by_name: string | null
  items_remaining: number; items: Record<string, number> | null
}
type ResultRaw = { kind: HandoverKind; item_id: string; to: string; outcome: string; reschedule_needed: boolean; completed: boolean }

export const handoverKeys = {
  all: ['handover'] as const,
  items: (userId: string) => [...handoverKeys.all, 'items', userId] as const,
  leaving: () => [...handoverKeys.all, 'leaving'] as const,
}

export const toItem = (r: ItemRaw): HandoverItem => ({
  kind: r.kind, itemId: r.item_id, label: r.label, context: r.context ?? null, detail: r.detail ?? {},
})

export const toLeaving = (r: LeavingRaw): LeavingPerson => ({
  id: r.user_id,
  name: r.name,
  department: r.department ?? null,
  leavingSince: r.leaving_since,
  startedByName: r.started_by_name ?? null,
  itemsRemaining: Number(r.items_remaining ?? 0),
  items: (r.items ?? {}) as Partial<Record<HandoverKind, number>>,
})

export const toResult = (r: ResultRaw): HandOverResult => ({
  kind: r.kind, itemId: r.item_id, to: r.to, outcome: r.outcome,
  rescheduleNeeded: Boolean(r.reschedule_needed), completed: Boolean(r.completed),
})

/** The items grouped in the list's order, each group only when it has something (d.3: "only the groups that apply"). */
export function groupHandoverItems(items: readonly HandoverItem[]): { kind: HandoverKind; items: HandoverItem[] }[] {
  return HANDOVER_KINDS
    .map((kind) => ({ kind, items: items.filter((i) => i.kind === kind) }))
    .filter((g) => g.items.length > 0)
}

export function useHandoverItems(userId: string | null) {
  return useQuery({
    queryKey: handoverKeys.items(userId ?? 'none'),
    enabled: Boolean(userId),
    queryFn: async (): Promise<HandoverItem[]> => {
      const { data, error } = await supabaseUntyped.rpc('handover_items', { p_user: userId })
      if (error) throw error
      return ((data ?? []) as ItemRaw[]).map(toItem)
    },
  })
}

export function useLeavingPeople() {
  return useQuery({
    queryKey: handoverKeys.leaving(),
    queryFn: async (): Promise<LeavingPerson[]> => {
      const { data, error } = await supabaseUntyped.rpc('leaving_people')
      if (error) throw error
      return ((data ?? []) as LeavingRaw[]).map(toLeaving)
    },
  })
}

export function useHandOverItem() {
  const qc = useQueryClient()
  return useMutation({
    // `reviewers`: a task with none takes them here, the payload the Schedule's assignment dialog sends
    // (`reviewerPayload`, ADR-0043) — the database refuses an assigned task with no reviewer.
    mutationFn: async (args: { kind: HandoverKind; itemId: string; toUserId: string; reviewers?: { user_id: string; is_mandatory: boolean }[] }): Promise<HandOverResult> => {
      const { data, error } = await supabaseUntyped.rpc('hand_over_item', {
        p_kind: args.kind,
        p_item: args.itemId,
        p_to: args.toUserId,
        ...(args.reviewers ? { p_reviewers: args.reviewers } : {}),
      })
      if (error) throw error
      const result = toResult(data as ResultRaw)
      // The task moved to someone else: re-book its days for them, as the Schedule's reassignment does.
      if (result.kind === 'task' && result.rescheduleNeeded) {
        const { error: schedErr } = await supabase.functions.invoke('subtask-schedule', { body: { subTaskId: result.itemId } })
        if (schedErr) throw schedErr
      }
      return result
    },
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: handoverKeys.all })
      void qc.invalidateQueries({ queryKey: ['pending-approvals'] })
      if (result.kind === 'task' || result.kind === 'review' || result.kind === 'deliverable') invalidateTaskViews(qc)
      if (result.kind === 'client' || result.kind === 'campaign' || result.kind === 'workstream') {
        void qc.invalidateQueries({ queryKey: ['clients'] })
        void qc.invalidateQueries({ queryKey: ['campaigns'] })
        void qc.invalidateQueries({ queryKey: ['campaign-detail'] })
      }
      if (result.completed) void qc.invalidateQueries({ queryKey: adminKeys.all })
    },
  })
}
