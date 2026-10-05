import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { inChunks } from '../../../lib/query/in-chunks'
import { deliverableKeys } from './deliverables-api'

/**
 * Deadline extensions (ADR-0088): asking for a task's committed deadline to move, and answering.
 *
 * Everything here reads ONE view, `sub_task_extension_events`, and calls THREE RPCs. There is no
 * request table: a request is an `sla_events` row and "pending" is derived from the log (d.5). The
 * two viewer flags the view carries — `viewer_can_request`, `viewer_can_decide` — are the only
 * authorization a surface reads (ADR-0037); the RPC decides again, and a refusal comes back as a
 * sentence.
 *
 * Attribution and reason are the request's own words, not derived (d.4). The date is a DAY; the
 * server lands it at 18:00 Iraq (ADR-0076).
 */

export const extensionKeys = {
  all: ['deadline-extensions'] as const,
  /** Every extension event on a set of tasks — the row line reads the latest per task. */
  forTasks: (taskIds: readonly string[]) => [...extensionKeys.all, 'for-tasks', [...taskIds].sort().join(',')] as const,
  /** The pending requests the viewer can answer (dashboard). */
  answerable: () => [...extensionKeys.all, 'answerable'] as const,
  /** Pending requests under one campaign (campaign page). */
  forCampaign: (campaignId: string) => [...extensionKeys.all, 'for-campaign', campaignId] as const,
}

export type ExtensionAttribution = 'assignee' | 'client' | 'dependency'
export type ExtensionEventType =
  | 'extension_requested' | 'extension_withdrawn' | 'extension_approved' | 'extension_refused'

export interface ExtensionEvent {
  eventId: string
  eventType: ExtensionEventType
  /** The request this event belongs to — its own id for a request, the request's for a decision. */
  requestId: string
  subTaskId: string
  deliverableId: string
  actorId: string | null
  actorName: string | null
  createdAt: string
  /** The commitment before the request. */
  fromAt: string | null
  /** The deadline asked for — 18:00 Iraq on its day. */
  toAt: string | null
  reason: string | null
  note: string | null
  attributedTo: ExtensionAttribution | null
  isPending: boolean
  taskTitle: string
  taskStatus: string
  assigneeId: string | null
  assigneeName: string | null
  planDueAt: string | null
  committedDueAt: string | null
  departmentId: string | null
  deliverableName: string
  deliverableDueAt: string | null
  campaignId: string | null
  campaignName: string | null
  goLiveAt: string | null
  approverId: string | null
  approverName: string | null
  viewerCanDecide: boolean
  viewerCanRequest: boolean
}

interface RawRow {
  event_id: string
  event_type: ExtensionEventType
  request_id: string
  sub_task_id: string
  deliverable_id: string
  actor_id: string | null
  actor_name: string | null
  created_at: string
  from_at: string | null
  to_at: string | null
  reason: string | null
  note: string | null
  attributed_to: ExtensionAttribution | null
  is_pending: boolean
  task_title: string
  task_status: string
  assignee_id: string | null
  assignee_name: string | null
  plan_due_at: string | null
  committed_due_at: string | null
  department_id: string | null
  deliverable_name: string
  deliverable_due_at: string | null
  campaign_id: string | null
  campaign_name: string | null
  go_live_at: string | null
  approver_id: string | null
  approver_name: string | null
  viewer_can_decide: boolean
  viewer_can_request: boolean
}

const COLUMNS =
  'event_id, event_type, request_id, sub_task_id, deliverable_id, actor_id, actor_name, created_at, ' +
  'from_at, to_at, reason, note, attributed_to, is_pending, task_title, task_status, assignee_id, ' +
  'assignee_name, plan_due_at, committed_due_at, department_id, deliverable_name, deliverable_due_at, ' +
  'campaign_id, campaign_name, go_live_at, approver_id, approver_name, viewer_can_decide, viewer_can_request'

function toEvent(r: RawRow): ExtensionEvent {
  return {
    eventId: r.event_id,
    eventType: r.event_type,
    requestId: r.request_id,
    subTaskId: r.sub_task_id,
    deliverableId: r.deliverable_id,
    actorId: r.actor_id,
    actorName: r.actor_name,
    createdAt: r.created_at,
    fromAt: r.from_at,
    toAt: r.to_at,
    reason: r.reason,
    note: r.note,
    attributedTo: r.attributed_to,
    isPending: r.is_pending,
    taskTitle: r.task_title,
    taskStatus: r.task_status,
    assigneeId: r.assignee_id,
    assigneeName: r.assignee_name,
    planDueAt: r.plan_due_at,
    committedDueAt: r.committed_due_at,
    departmentId: r.department_id,
    deliverableName: r.deliverable_name,
    deliverableDueAt: r.deliverable_due_at,
    campaignId: r.campaign_id,
    campaignName: r.campaign_name,
    goLiveAt: r.go_live_at,
    approverId: r.approver_id,
    approverName: r.approver_name,
    viewerCanDecide: r.viewer_can_decide,
    viewerCanRequest: r.viewer_can_request,
  }
}

/**
 * The latest extension event per task, for a set of tasks. One read for a whole list — My Work and
 * a deliverable's task table both need "what is the state of the ask on this row", and one request
 * per row is the cost the reviewer line already refused to pay.
 */
export function useLatestExtensionByTask(taskIds: readonly string[]) {
  return useQuery({
    queryKey: extensionKeys.forTasks(taskIds),
    enabled: taskIds.length > 0,
    queryFn: async (): Promise<Map<string, ExtensionEvent>> => {
      // In batches (I49.75): a task's events all sit in one batch, so the newest-first order the
      // loop below relies on holds within each task.
      const data = await inChunks<RawRow>(taskIds, (chunk) =>
        supabaseUntyped
          .from('sub_task_extension_events')
          .select(COLUMNS)
          .in('sub_task_id', chunk)
          .order('created_at', { ascending: false }),
      )
      const latest = new Map<string, ExtensionEvent>()
      for (const r of data) {
        // Ordered newest first, so the first row seen for a task is its latest event — with one
        // tie to break (review, 11 Sep): a supersession writes the old request's withdrawal and the
        // new request in ONE transaction, so both carry the same created_at, and Postgres returns
        // them in either order. On a tie the request outranks the withdrawal — it is the newer
        // fact — or the row would read "withdrawn" while a request is pending.
        const seen = latest.get(r.sub_task_id)
        if (!seen) latest.set(r.sub_task_id, toEvent(r))
        else if (
          seen.eventType === 'extension_withdrawn' &&
          r.event_type === 'extension_requested' &&
          seen.createdAt === r.created_at
        )
          latest.set(r.sub_task_id, toEvent(r))
      }
      return latest
    },
  })
}

/** The pending requests THIS viewer can answer (d.10 — the dashboard panel). */
export function useAnswerableExtensionRequests() {
  return useQuery({
    queryKey: extensionKeys.answerable(),
    queryFn: async (): Promise<ExtensionEvent[]> => {
      const { data, error } = await supabaseUntyped
        .from('sub_task_extension_requests')
        .select(COLUMNS)
        .eq('viewer_can_decide', true)
        .order('created_at', { ascending: true })
      if (error) throw error
      return ((data ?? []) as unknown as RawRow[]).map(toEvent)
    },
  })
}

/** Pending requests under one campaign (d.10 — the campaign page, against each deliverable). */
export function useCampaignExtensionRequests(campaignId: string | null) {
  return useQuery({
    queryKey: extensionKeys.forCampaign(campaignId ?? 'none'),
    enabled: !!campaignId,
    queryFn: async (): Promise<ExtensionEvent[]> => {
      const { data, error } = await supabaseUntyped
        .from('sub_task_extension_requests')
        .select(COLUMNS)
        .eq('campaign_id', campaignId!)
        .order('created_at', { ascending: true })
      if (error) throw error
      return ((data ?? []) as unknown as RawRow[]).map(toEvent)
    },
  })
}

function useInvalidateExtensions() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: extensionKeys.all })
    // The approval moved committed_due_at, which every task read carries.
    void qc.invalidateQueries({ queryKey: deliverableKeys.all })
    void qc.invalidateQueries({ queryKey: ['schedule'] })
  }
}

export interface RequestExtensionArgs {
  subTaskId: string
  /** `YYYY-MM-DD` — the server lands it at 18:00 Iraq. */
  toDay: string
  reason: string
  attributedTo: ExtensionAttribution
}

export function useRequestExtension() {
  const invalidate = useInvalidateExtensions()
  return useMutation({
    mutationFn: async (a: RequestExtensionArgs): Promise<string> => {
      const { data, error } = await supabaseUntyped.rpc('sub_task_extension_request', {
        p_sub_task: a.subTaskId,
        p_to_day: a.toDay,
        p_reason: a.reason,
        p_attributed_to: a.attributedTo,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: invalidate,
  })
}

export function useDecideExtension() {
  const invalidate = useInvalidateExtensions()
  return useMutation({
    mutationFn: async (a: { requestId: string; approve: boolean; note?: string | null }): Promise<string> => {
      const { data, error } = await supabaseUntyped.rpc('sub_task_extension_decide', {
        p_request: a.requestId,
        p_approve: a.approve,
        p_note: a.note ?? null,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: invalidate,
  })
}

export function useWithdrawExtension() {
  const invalidate = useInvalidateExtensions()
  return useMutation({
    mutationFn: async (requestId: string): Promise<void> => {
      const { error } = await supabaseUntyped.rpc('sub_task_extension_withdraw', { p_request: requestId })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

/**
 * d.7a — the promise moves only on the client's agreement, evidenced. The asset is filed first
 * (through the ordinary path into the campaign's References, as the brief receipt is), then named
 * here; the server refuses without it.
 */
export function useChangeDeliverableDueAt() {
  const invalidate = useInvalidateExtensions()
  return useMutation({
    mutationFn: async (a: { deliverableId: string; dueDay: string; evidenceAssetId: string | null; note?: string | null }): Promise<void> => {
      const { error } = await supabaseUntyped.rpc('deliverable_due_at_change', {
        p_deliverable: a.deliverableId,
        p_due_day: a.dueDay,
        p_evidence_asset: a.evidenceAssetId,
        p_note: a.note ?? null,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

/** The server said no on authority grounds (42501) — shown as a sentence, never as a stack. */
export const isRefused = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === '42501'

// ---- I41.8 — the due-date warning's hours, and the override record -----------------------------

/**
 * Hours of work still open on a deliverable — what the due-date warning weighs against the days
 * left (ADR-0075 d.9: "how many hours of work remain across the deliverable's tasks"). Open means
 * not done and not cancelled; a task with no estimate counts nothing, which is honest rather than
 * optimistic — the warning says the hours it knows about.
 */
export function useOutstandingHours(deliverableId: string | null) {
  return useQuery({
    queryKey: ['deliverables', 'outstanding-hours', deliverableId ?? 'none'],
    enabled: !!deliverableId,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabaseUntyped
        .from('sub_tasks')
        .select('sla_hours, status')
        .eq('deliverable_id', deliverableId!)
        .not('status', 'in', '("done","cancelled")')
      if (error) throw error
      const rows = (data ?? []) as { sla_hours: number | string | null }[]
      return rows.reduce((sum, r) => sum + (r.sla_hours == null ? 0 : Number(r.sla_hours)), 0)
    },
  })
}

/** The record of proceeding past a tight/impossible warning (ADR-0075 d.9). */
export function useRecordDueDateOverride() {
  return useMutation({
    mutationFn: async (a: {
      deliverableId: string
      dueDay: string
      severity: 'tight' | 'impossible' | 'after_go_live' // ADR-0093 added the third
      goLiveDay: string
      workingDaysLeft: number
      requiredDays: number
      outstandingHours?: number | null
      capacityHours?: number | null
    }): Promise<void> => {
      const { error } = await supabaseUntyped.rpc('record_due_date_override', {
        p_deliverable: a.deliverableId,
        p_due_day: a.dueDay,
        p_severity: a.severity,
        p_go_live_day: a.goLiveDay,
        p_days_left: a.workingDaysLeft,
        p_required_days: a.requiredDays,
        p_outstanding_hours: a.outstandingHours ?? null,
        p_capacity_hours: a.capacityHours ?? null,
      })
      if (error) throw error
    },
  })
}
