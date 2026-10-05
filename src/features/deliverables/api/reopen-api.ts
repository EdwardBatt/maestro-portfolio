import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, supabaseUntyped } from '../../../lib/supabase'
import { endOfWorkingDay } from '../../../lib/time/iraq'
import { scheduleWarningKey, type ScheduleOutcome } from '../../../lib/bookings/schedule-outcome'
import { reviewerPayload, type ReviewerAppointment } from '../../../lib/reviewers/task-reviewers'

/**
 * Re-opening finished work (ADR-0103). The database decides who may (`app.may_reopen`: the
 * `project_tasks:manage` grant and reach over the campaign's account manager or the owner's
 * department) and refuses anyone else in words; the screen only chooses which buttons to offer.
 *
 * One door for a task and a deliverable — `reopen_deliverable(tasks[])`; a task's own Re-open is
 * that door with one task (`reopen_task`). Both need a reason and a new due date, and both re-open
 * a closed campaign with the work, saying so (d.4).
 */

export const reopenKeys = {
  finished: (deliverableId: string) => ['reopen', 'finished-tasks', deliverableId] as const,
  reopenable: (campaignId: string) => ['reopen', 'reopenable', campaignId] as const,
}

export interface FinishedTask {
  id: string
  title: string
  /** ADR-0142 d.2: the maker — a re-open goes back to her. */
  assigneeId: string | null
  assigneeName: string | null
  approvedAt: string | null
  /** The task's hours, for the round's hours placeholder. */
  hours: number | null
  /** I74 fix-up: whether anyone reviews it — a task with nobody is given reviewers in the dialog before it re-opens. */
  hasReviewer: boolean
}

/** The approved tasks of one deliverable — what its Re-open offers to tick. Called-off ones never. */
export function useFinishedTasks(deliverableId: string | null) {
  return useQuery({
    queryKey: reopenKeys.finished(deliverableId ?? ''),
    enabled: Boolean(deliverableId),
    queryFn: async (): Promise<FinishedTask[]> => {
      const { data, error } = await supabaseUntyped
        .from('sub_tasks')
        .select('id, title, approved_at, sort_order, unit_index, sla_hours, assignee_id, assignee:user_profiles!sub_tasks_assignee_id_fkey(display_name), sub_task_reviewers(user_id)')
        .eq('deliverable_id', deliverableId)
        .eq('status', 'done')
        .order('sort_order', { ascending: true })
        .order('unit_index', { ascending: true })
      if (error) throw error
      return ((data ?? []) as { id: string; title: string; approved_at: string | null; sla_hours: number | string | null; assignee_id: string | null; assignee: { display_name?: string } | { display_name?: string }[] | null; sub_task_reviewers?: { user_id: string }[] | null }[])
        .map((r) => ({
          id: r.id,
          title: r.title,
          approvedAt: r.approved_at,
          assigneeId: r.assignee_id,
          assigneeName: (Array.isArray(r.assignee) ? r.assignee[0] : r.assignee)?.display_name ?? null,
          hours: r.sla_hours == null || r.sla_hours === '' ? null : Number(r.sla_hours),
          hasReviewer: (r.sub_task_reviewers ?? []).length > 0,
        }))
    },
  })
}

/** Which of a campaign's deliverables I may re-open — the mirror of `app.may_reopen`, one call a page. */
export function useReopenableDeliverables(campaignId: string | null) {
  return useQuery({
    queryKey: reopenKeys.reopenable(campaignId ?? ''),
    enabled: Boolean(campaignId),
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabaseUntyped.rpc('reopenable_deliverables', { p_campaign: campaignId })
      if (error) throw error
      return new Set(((data ?? []) as (string | { reopenable_deliverables?: string })[])
        .map((r) => (typeof r === 'string' ? r : r.reopenable_deliverables ?? ''))
        .filter(Boolean))
    },
  })
}

export type ReopenKind = 'client_amendment' | 'own_fix'

export interface ReopenArgs {
  deliverableId: string
  taskIds: string[]
  reason: string
  /** The new due DAY, YYYY-MM-DD — due at the close of that working day, Iraq time (ADR-0076). */
  dueDay: string
  /** ADR-0142 d.1: a client amendment (counted) or our own fix. Omitted: own fix, as before. */
  kind?: ReopenKind
  /** ADR-0142: the round's hours, optional. */
  hours?: number | null
  /**
   * ADR-0142 d.2: the re-open goes back to the maker; the lead may give ONE task to someone else in the same step —
   * the ordinary assignment (`update_task_assignment`), which turns an out-of-reach person into a request.
   */
  reassign?: { subTaskId: string; assigneeId: string } | null
  /**
   * I74 fix-up (Edward, 3 Oct): reviewers for each ticked task that has none, chosen with the ReviewerPicker (the first
   * required, the rest optional) — saved by the re-open before the task goes back to work. Ignored for a task that has.
   */
  reviewers?: Record<string, ReviewerAppointment[]>
}

export interface ReopenResult {
  reopened: number
  campaignReopened: boolean
  /** Tasks placed on their maker's week by `subtask-schedule` (ADR-0142 d.2). */
  placed: number
  /** A schedule warning key or message, when a round could not be placed. */
  scheduleWarning: string | null
  /** The hand-over to someone else, when one was asked: given, or asked of their lead. */
  reassigned: 'assigned' | 'requested' | null
}

async function place(subTaskId: string): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('subtask-schedule', { body: { subTaskId } })
  if (error) return (error as Error).message
  return scheduleWarningKey(data as ScheduleOutcome)
}

export function useReopenDeliverable() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: ReopenArgs): Promise<ReopenResult> => {
      const dueAt = endOfWorkingDay(a.dueDay).toISOString()
      const { data, error } = await supabaseUntyped.rpc('reopen_deliverable', {
        p_deliverable: a.deliverableId,
        p_tasks: a.taskIds,
        p_reason: a.reason.trim(),
        p_due_at: dueAt,
        p_kind: a.kind ?? 'own_fix',
        p_hours: a.hours ?? null,
        p_reviewers: a.reviewers && Object.keys(a.reviewers).length > 0
          ? Object.fromEntries(Object.entries(a.reviewers).map(([id, list]) => [id, reviewerPayload(list)]))
          : null,
      })
      if (error) throw error
      const r = (data ?? {}) as { reopened?: number; campaign_reopened?: boolean; reschedule?: string[] | null }
      // ADR-0142 d.2: the Edge Function is the only placer — each re-opened task with a maker goes on her week.
      // The one the lead gives to someone else is placed by the assignment instead.
      const reassignId = a.reassign?.subTaskId ?? null
      let placed = 0
      let warning: string | null = null
      for (const id of r.reschedule ?? []) {
        if (id === reassignId) continue
        const w = await place(id)
        if (w) warning = warning ?? w
        else placed += 1
      }
      let reassigned: ReopenResult['reassigned'] = null
      if (a.reassign) {
        const { data: task, error: readErr } = await supabaseUntyped
          .from('sub_tasks').select('title, starts_at, due_at, sla_hours').eq('id', a.reassign.subTaskId).single()
        if (readErr) throw readErr
        const tk = task as { title: string; starts_at: string | null; due_at: string | null; sla_hours: number | string | null }
        const { data: row, error: assignErr } = await supabaseUntyped.rpc('update_task_assignment', {
          p_sub_task: a.reassign.subTaskId,
          p_title: tk.title,
          p_assignee: a.reassign.assigneeId,
          p_reviewers: null,
          p_starts_at: tk.starts_at ?? new Date().toISOString(),
          p_due_at: tk.due_at ?? dueAt,
          p_hours: tk.sla_hours == null ? null : Number(tk.sla_hours),
          p_review_mode: null,
          // The lead chose someone else in the Re-open dialog itself; a re-opened task counts as started,
          // so without this the server asks "move it anyway?" with nobody to answer (I74 browser test).
          p_confirm_started: true,
        })
        if (assignErr) throw assignErr
        const out = (Array.isArray(row) ? row[0] : row) as { outcome?: string; reschedule_needed?: boolean } | null
        reassigned = out?.outcome === 'requested' ? 'requested' : 'assigned'
        if (reassigned === 'assigned' && out?.reschedule_needed) {
          const w = await place(a.reassign.subTaskId)
          if (w) warning = warning ?? w
          else placed += 1
        }
      }
      return {
        reopened: r.reopened ?? a.taskIds.length,
        campaignReopened: r.campaign_reopened === true,
        placed,
        scheduleWarning: warning,
        reassigned,
      }
    },
    // Everything that shows finished work reads the live state — so all of it is out of date.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['reopen'] })
      void qc.invalidateQueries({ queryKey: ['deliverables'] })
      void qc.invalidateQueries({ queryKey: ['campaign-detail'] })
      void qc.invalidateQueries({ queryKey: ['campaigns'] })
      void qc.invalidateQueries({ queryKey: ['schedule'] })
      void qc.invalidateQueries({ queryKey: ['notifications'] })
      void qc.invalidateQueries({ queryKey: ['amendments'] })
    },
  })
}
