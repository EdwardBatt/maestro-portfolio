import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, supabaseUntyped } from '../supabase'
import { inChunks } from '../query/in-chunks'
import type { Span } from '../capacity/types.ts'
import { scheduleWarningKey, type ScheduleOutcome } from '../bookings/schedule-outcome'
import { toAssignmentRequest, type AssignmentRequest, type AssignmentRequestRow } from './requests'
import { liveOptions } from '../query/live'
import { invalidateTaskViews } from '../query/task-views'

/**
 * ADR-0087 — reading and answering booking requests.
 *
 * One reader for the three surfaces that show a request (the grid's chip, the task's status line,
 * the inbox's actions) and one writer for each verb, so "approve" is one implementation behind
 * three doors (ADR-0080 d.10's phrase) rather than three.
 *
 * Every write goes through a SECURITY DEFINER RPC that decides authority with the primitives;
 * nothing here decides anything. The table has no client write policy at all.
 */

export const assignmentRequestKeys = {
  all: ['assignment-requests'] as const,
  window: (w: Span) => [...assignmentRequestKeys.all, 'window', w.start, w.end] as const,
  tasks: (ids: string[]) => [...assignmentRequestKeys.all, 'tasks', [...ids].sort().join(',')] as const,
}

/**
 * The embeds are hinted by FK. `requested_by` → `user_profiles` is a single-column key, so the
 * COLUMN name is a valid hint (three of this table's keys point at `user_profiles`, so PostgREST
 * must be told which). But `resource_id` and `sub_task_id` are COMPOSITE keys — the tenant fence
 * `(tenant_id, resource_id)` / `(tenant_id, sub_task_id)` (traps.md) — and PostgREST cannot resolve
 * a composite FK from a single column name (PGRST200). Those two are hinted by the CONSTRAINT NAME,
 * which is the only hint that names a multi-column key. Found 12 Sep: the query 400'd on /schedule.
 */
const SELECT =
  'id, sub_task_id, resource_id, assignee_id, requested_by, requested_at, title, starts_at, due_at, hours, ' +
  'status, decided_by, decided_at, reason, team_id, ' +
  'team:teams!sub_task_assignment_requests_team_id_fkey(name, departments(name)), ' +
  'requester:user_profiles!requested_by(display_name), ' +
  'resource:resources!fk_sub_task_assignment_requests_resource(name, departments(name), teams(name, departments(name))), ' +
  'sub_task:sub_tasks!fk_sub_task_assignment_requests_sub_task(title, deliverables(streams(campaigns(name))))'

/**
 * Pending requests whose requested days touch the grid's window (d.11) — the chip is drawn from
 * the request, not from a booking, because no booking exists (d.10). A request carrying no dates
 * cannot land on a column and is left out by the overlap filter, as it should be.
 */
export function usePendingAssignmentRequests(window: Span, opts?: { live?: boolean }) {
  return useQuery({
    // ADR-0105 d.5: the Schedule refreshes every 20 s and on returning to the tab.
    ...liveOptions(opts?.live),
    queryKey: assignmentRequestKeys.window(window),
    queryFn: async (): Promise<AssignmentRequest[]> => {
      const { data, error } = await supabaseUntyped
        .from('sub_task_assignment_requests')
        .select(SELECT)
        .eq('status', 'pending')
        .lt('starts_at', new Date(window.end).toISOString())
        .gt('due_at', new Date(window.start).toISOString())
      if (error) throw error
      return ((data ?? []) as unknown as AssignmentRequestRow[]).map(toAssignmentRequest)
    },
  })
}

/** The pending request on each of these tasks, keyed by task — for a status line per row. */
export function usePendingAssignmentRequestsForTasks(subTaskIds: string[]) {
  return useQuery({
    queryKey: assignmentRequestKeys.tasks(subTaskIds),
    enabled: subTaskIds.length > 0,
    queryFn: async (): Promise<Map<string, AssignmentRequest>> => {
      // In batches (I49.75): one address naming every task on a long list is refused as too long.
      const data = await inChunks<AssignmentRequestRow>(subTaskIds, (chunk) =>
        supabaseUntyped
          .from('sub_task_assignment_requests')
          .select(SELECT)
          .eq('status', 'pending')
          .in('sub_task_id', chunk),
      )
      const m = new Map<string, AssignmentRequest>()
      for (const r of data.map(toAssignmentRequest)) m.set(r.subTaskId, r)
      return m
    },
  })
}

/** The pending request on one task, or null. */
export function usePendingAssignmentRequest(subTaskId: string | null) {
  const q = usePendingAssignmentRequestsForTasks(subTaskId ? [subTaskId] : [])
  return { ...q, data: subTaskId ? (q.data?.get(subTaskId) ?? null) : null }
}

/** What an answer or a withdrawal changes on screen: the requests, the grid, the tasks, the inbox. */
function useInvalidateAfterRequestChange() {
  const qc = useQueryClient()
  return () => {
    invalidateTaskViews(qc)
    void qc.invalidateQueries({ queryKey: ['notifications'] })
  }
}

export interface DecideArgs {
  requestId: string
  approve: boolean
  reason?: string
}

export interface DecideResult {
  outcome: 'approved' | 'refused'
  subTaskId: string
  /** Set when approval assigned the task but `subtask-schedule` placed nothing, with the reason. */
  scheduleWarning?: string
}

/**
 * Approve or refuse (d.5, d.7, d.8). Approval assigns the task AS THE APPROVER inside the RPC;
 * then — exactly as a direct assignment does — this runs `subtask-schedule` as them so the
 * bookings materialise `confirmed`. The answer from the scheduler is read, not assumed (ADR-0061
 * d.1): an approval that booked nothing says so.
 */
export function useDecideAssignmentRequest() {
  const invalidate = useInvalidateAfterRequestChange()
  return useMutation({
    mutationFn: async (a: DecideArgs): Promise<DecideResult> => {
      const { data, error } = await supabaseUntyped.rpc('decide_assignment_request', {
        p_request: a.requestId,
        p_approve: a.approve,
        p_reason: a.reason?.trim() || null,
      })
      if (error) throw error
      const row = (Array.isArray(data) ? data[0] : data) as
        | { sub_task_id: string; reschedule_needed: boolean; outcome: 'approved' | 'refused' }
        | null
      if (!row) throw new Error('decide_assignment_request returned nothing')
      let scheduleWarning: string | undefined
      if (row.outcome === 'approved' && row.reschedule_needed) {
        const { data: sched, error: schedErr } = await supabase.functions.invoke('subtask-schedule', {
          body: { subTaskId: row.sub_task_id },
        })
        if (schedErr) throw schedErr
        scheduleWarning = scheduleWarningKey(sched as ScheduleOutcome) ?? undefined
      }
      return { outcome: row.outcome, subTaskId: row.sub_task_id, scheduleWarning }
    },
    onSettled: invalidate,
  })
}

/** The requester takes it back (d.9). */
export function useWithdrawAssignmentRequest() {
  const invalidate = useInvalidateAfterRequestChange()
  return useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabaseUntyped.rpc('withdraw_assignment_request', { p_request: requestId })
      if (error) throw error
    },
    onSettled: invalidate,
  })
}
