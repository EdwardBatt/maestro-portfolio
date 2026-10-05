import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { inChunks } from '../../../lib/query/in-chunks'
import { bookingHours } from '../../../lib/deadlines/booked-hours'
import { deliverableKeys } from '../../deliverables/api/deliverables-api'
import {
  latestByDeliverable,
  type AskedBy,
  type ChangeRequestRow,
  type RequestedChanges,
  type WorkTask,
} from '../lib/change-request'

/**
 * Change requests on started work (ADR-0110, I59.23, Figma CG-E2) — the campaign page's reads and
 * its one write. Answering (accept / decline / push back, resolve, close) is Needs you's (Track 6),
 * not here.
 *
 *  - `useChangeRequestContext(deliverableId)` — what Edit needs to decide and to cost: whether the
 *    work has STARTED (`deliverable_is_started`, the database's rule), the request already open on
 *    the piece (one per deliverable), the tenant's hours before it escalates
 *    (`tenant_escalation_rules`, kind `change_request`, ADR-0108), and the piece's tasks with their
 *    booked and timed hours.
 *  - `useCampaignChangeRequests(ids)` — the newest request per piece, for the drawer and the card.
 *  - `useRequestDeliverableChange()` — `request_deliverable_change`.
 *
 * Flat reads through `inChunks` (no embeds: an unresolvable embed comes back empty, traps.md).
 * `supabaseUntyped` because the table and the RPCs are newer than the generated types.
 */
export const changeRequestKeys = {
  all: ['change-requests'] as const,
  context: (deliverableId: string) => ['change-requests', 'context', deliverableId] as const,
  byDeliverables: (ids: readonly string[]) => ['change-requests', 'by-deliverables', [...ids].sort().join(',')] as const,
}

interface RequestRaw {
  id: string
  deliverable_id: string
  status: ChangeRequestRow['status']
  requested_by: string
  changes: RequestedChanges | null
  asked_by: AskedBy
  decline_reason: string | null
  counter_text: string | null
  counter_date: string | null
  created_at: string
  closed_at: string | null
}
const REQUEST_COLUMNS =
  'id, deliverable_id, status, requested_by, changes, asked_by, decline_reason, counter_text, counter_date, created_at, closed_at'

async function withNames(rows: readonly RequestRaw[]): Promise<ChangeRequestRow[]> {
  const ids = [...new Set(rows.map((r) => r.requested_by))]
  const people = await inChunks<{ id: string; display_name: string | null }>(ids, (chunk) =>
    supabaseUntyped.from('user_profiles').select('id, display_name').in('id', chunk))
  const nameOf = new Map(people.map((p) => [p.id, p.display_name]))
  return rows.map((r) => ({
    id: r.id,
    deliverableId: r.deliverable_id,
    status: r.status,
    requestedBy: r.requested_by,
    requestedByName: nameOf.get(r.requested_by) ?? null,
    changes: r.changes ?? {},
    askedBy: r.asked_by,
    declineReason: r.decline_reason,
    counterText: r.counter_text,
    counterDate: r.counter_date,
    createdAt: r.created_at,
    closedAt: r.closed_at,
  }))
}

export interface ChangeRequestContext {
  started: boolean
  openRequest: ChangeRequestRow | null
  /** Hours before an unanswered request escalates; null when the tenant has no such rule. */
  escalationHours: number | null
  tasks: WorkTask[]
}

/** Bookings that still hold time — the schedule's own set (`schedule-api`). */
const LIVE_BOOKING = ['soft_hold', 'tentative', 'confirmed']

export function useChangeRequestContext(deliverableId: string | null) {
  return useQuery({
    queryKey: changeRequestKeys.context(deliverableId ?? 'none'),
    enabled: !!deliverableId,
    queryFn: async (): Promise<ChangeRequestContext> => {
      const id = deliverableId!
      const [startedRes, openRes, ruleRes, tasksRes] = await Promise.all([
        supabaseUntyped.rpc('deliverable_is_started', { p_deliverable: id }),
        supabaseUntyped.from('deliverable_change_requests').select(REQUEST_COLUMNS)
          .eq('deliverable_id', id).in('status', ['pending', 'pushed_back']).order('created_at', { ascending: false }).limit(1),
        supabaseUntyped.from('tenant_escalation_rules').select('hours').eq('kind', 'change_request').maybeSingle(),
        supabaseUntyped.from('sub_tasks').select('id, title, status').eq('deliverable_id', id).order('sort_order'),
      ])
      if (startedRes.error) throw startedRes.error
      if (openRes.error) throw openRes.error
      if (ruleRes.error) throw ruleRes.error
      if (tasksRes.error) throw tasksRes.error

      const raw = (tasksRes.data ?? []) as { id: string; title: string; status: WorkTask['status'] }[]
      const taskIds = raw.map((t) => t.id)
      const [entries, bookings] = await Promise.all([
        inChunks<{ sub_task_id: string; minutes: number | string | null; started_at: string | null; submitted_at: string | null }>(taskIds, (chunk) =>
          supabaseUntyped.from('task_time_entries').select('sub_task_id, minutes, started_at, submitted_at').in('sub_task_id', chunk)),
        inChunks<{ sub_task_id: string; starts_at: string; ends_at: string; load_pct: number | string | null }>(taskIds, (chunk) =>
          supabaseUntyped.from('bookings').select('sub_task_id, starts_at, ends_at, load_pct').in('state', LIVE_BOOKING).in('sub_task_id', chunk)),
      ])
      const now = Date.now()
      const timed = new Map<string, number>()
      for (const e of entries) {
        // A running timer has no minutes yet: it counts up to now, as the task page's clock does.
        const mins = e.minutes != null ? Number(e.minutes) : e.started_at && !e.submitted_at ? (now - Date.parse(e.started_at)) / 60_000 : 0
        timed.set(e.sub_task_id, (timed.get(e.sub_task_id) ?? 0) + Math.max(0, mins) / 60)
      }
      const booked = new Map<string, number>()
      for (const b of bookings) {
        const h = bookingHours({ start: Date.parse(b.starts_at), end: Date.parse(b.ends_at), loadPct: b.load_pct == null ? null : Number(b.load_pct) })
        booked.set(b.sub_task_id, (booked.get(b.sub_task_id) ?? 0) + h)
      }
      const r1 = (n: number) => Math.round(n * 10) / 10
      const openRows = await withNames((openRes.data ?? []) as RequestRaw[])
      return {
        started: startedRes.data === true,
        openRequest: openRows[0] ?? null,
        escalationHours: (ruleRes.data as { hours: number } | null)?.hours ?? null,
        tasks: raw.map((t) => ({ ...t, bookedHours: r1(booked.get(t.id) ?? 0), timedHours: r1(timed.get(t.id) ?? 0) })),
      }
    },
  })
}

/** The newest request on each of the pieces — Map<deliverableId, request>; none, absent. */
export function useCampaignChangeRequests(deliverableIds: readonly string[]) {
  return useQuery({
    queryKey: changeRequestKeys.byDeliverables(deliverableIds),
    enabled: deliverableIds.length > 0,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<Map<string, ChangeRequestRow>> => {
      const rows = await inChunks<RequestRaw>(deliverableIds, (chunk) =>
        supabaseUntyped.from('deliverable_change_requests').select(REQUEST_COLUMNS).in('deliverable_id', chunk))
      return latestByDeliverable(await withNames(rows))
    },
  })
}

export interface RequestChangeArgs {
  deliverableId: string
  changes: Record<string, { to: string }>
  askedBy: AskedBy
  cost: Record<string, number | string | null>
  /** The client's evidence, filed in the campaign's References first — asked for, never required (E5). */
  evidenceAssetId: string | null
}

export function useRequestDeliverableChange() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: RequestChangeArgs): Promise<string> => {
      const args: Record<string, unknown> = {
        p_deliverable: a.deliverableId,
        p_changes: a.changes,
        p_asked_by: a.askedBy,
        p_cost: a.cost,
      }
      // Named only when given, so the call resolves whether or not the database has the evidence
      // argument yet (20260926132000 adds `p_evidence_asset uuid default null`).
      if (a.evidenceAssetId) args.p_evidence_asset = a.evidenceAssetId
      const { data, error } = await supabaseUntyped.rpc('request_deliverable_change', args)
      if (error) throw error
      return data as string
    },
    onSuccess: (_id, v) => {
      void qc.invalidateQueries({ queryKey: changeRequestKeys.all })
      void qc.invalidateQueries({ queryKey: changeRequestKeys.context(v.deliverableId) })
      void qc.invalidateQueries({ queryKey: deliverableKeys.all })
    },
  })
}
