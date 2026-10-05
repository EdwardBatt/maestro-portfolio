import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, supabaseUntyped } from '../../../lib/supabase'
import { inChunks } from '../../../lib/query/in-chunks'
import { invalidateTaskViews } from '../../../lib/query/task-views'
import { scheduleWarningKey, type ScheduleOutcome } from '../../../lib/bookings/schedule-outcome'
import { fetchTaskReviewers } from '../../../lib/reviewers/task-reviewers-api'
import { reviewerPayload, type ReviewerAppointment, type TaskReviewer } from '../../../lib/reviewers/task-reviewers'
import { toReviewMode, type ReviewMode } from '../../../lib/review/review-mode'
import { endOfWorkingDay } from '../../../lib/time/iraq'
import { isSuggestedTask, planTaskSave, type TaskDraft } from '../lib/task-edit'
import { deliverableKeys, type SubTaskStatus } from './deliverables-api'
import { requirementKeys, type TaskDependency } from './requirements-api'

/**
 * The one task editor's reads and writes (ADR-0140, I74.7–I74.12). Reads the piece's tasks with every field the
 * editor shows; writes through the existing RPCs only (`update_task_assignment`, `save_sub_task`, `unassign_task`,
 * `remove_sub_task`, `request_task_booking`) — nothing here adds a rule. Keys sit under `deliverables`, so every
 * task write's `invalidateTaskViews` refreshes them.
 */
export const taskEditorKeys = {
  piece: (deliverableId: string) => [...deliverableKeys.all, 'task-editor', deliverableId] as const,
}

/** One task of a piece, as the editor and the piece's task list show it. */
export interface EditableTask {
  id: string
  deliverableId: string
  title: string
  notes: string
  hours: number | null
  status: SubTaskStatus
  assigneeId: string | null
  assigneeName: string | null
  startsAt: string | null
  dueAt: string | null
  reviewMode: ReviewMode
  reviewers: TaskReviewer[]
  /** ADR-0140 d.3: in progress, in review, or any time logged — its days and person move only when asked. */
  started: boolean
  /** part of Maestro's suggestion ("Suggested" until approved) — a workflow step or the generated translation task —
   *  not one somebody added (CP-03; `isSuggestedTask`) */
  fromWorkflow: boolean
  departmentId: string | null
  teamId: string | null
}

/** The piece around the tasks — what gates Who (approval) and what the editor names. */
export interface EditablePiece {
  id: string
  name: string
  code: string | null
  dueAt: string | null
  tasksApprovedAt: string | null
  ownerUserId: string | null
  /** may this caller approve the task list — the server's own answer (`can_approve_tasks`, I74.51) */
  canApproveTasks: boolean
  campaignId: string | null
  campaignName: string | null
}

export interface PieceTaskList { piece: EditablePiece; tasks: EditableTask[] }

interface Raw {
  id: string
  deliverable_id: string
  title: string
  description: string | null
  sla_hours: number | string | null
  status: SubTaskStatus
  assignee_id: string | null
  starts_at: string | null
  due_at: string | null
  review_mode: string | null
  sort_order: number | null
  unit_index: number | null
  created_at: string
  workflow_step_id: string | null
  department_id: string | null
  team_id: string | null
}

/**
 * `fresh`: read again every time the reader opens, whatever is in memory — the Schedule pop-up edits a task the
 * booking window may have just booked, and a 30-second-old read showed it unbooked (test script step 14).
 */
export function usePieceTaskList(deliverableId: string | null, opts?: { fresh?: boolean }) {
  return useQuery({
    queryKey: taskEditorKeys.piece(deliverableId ?? 'none'),
    enabled: Boolean(deliverableId),
    ...(opts?.fresh ? { staleTime: 0, refetchOnMount: 'always' as const } : {}),
    queryFn: async (): Promise<PieceTaskList | null> => {
      const { data: d, error: dErr } = await supabaseUntyped
        .from('deliverables')
        .select('id, name, code, due_at, tasks_approved_at, owner_user_id, stream_id, can_approve_tasks')
        .eq('id', deliverableId!)
        .maybeSingle()
      if (dErr) throw dErr
      if (!d) return null
      const dr = d as { id: string; name: string; code: string | null; due_at: string | null; tasks_approved_at: string | null; owner_user_id: string | null; stream_id: string | null; can_approve_tasks: boolean | null }
      let campaignId: string | null = null
      let campaignName: string | null = null
      if (dr.stream_id) {
        const { data: s } = await supabaseUntyped.from('streams').select('campaign_id, campaigns(name)').eq('id', dr.stream_id).maybeSingle()
        const sr = s as { campaign_id: string; campaigns: { name: string } | { name: string }[] | null } | null
        campaignId = sr?.campaign_id ?? null
        const c = Array.isArray(sr?.campaigns) ? sr?.campaigns[0] : sr?.campaigns
        campaignName = c?.name ?? null
      }
      const { data, error } = await supabaseUntyped
        .from('sub_tasks')
        .select('id, deliverable_id, title, description, sla_hours, status, assignee_id, starts_at, due_at, review_mode, sort_order, unit_index, created_at, workflow_step_id, department_id, team_id')
        .eq('deliverable_id', deliverableId!)
        .neq('status', 'cancelled')
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('unit_index', { ascending: true, nullsFirst: true })
        .order('created_at', { ascending: true })
      if (error) throw error
      const rows = (data ?? []) as Raw[]
      const ids = rows.map((r) => r.id)
      const people = [...new Set(rows.map((r) => r.assignee_id).filter((x): x is string => !!x))]
      const [names, logged, reviewers] = await Promise.all([
        people.length
          ? supabaseUntyped.from('user_profiles').select('id, display_name').in('id', people)
              .then(({ data: p }) => new Map(((p ?? []) as { id: string; display_name: string }[]).map((x) => [x.id, x.display_name])))
          : Promise.resolve(new Map<string, string>()),
        ids.length
          ? inChunks<{ sub_task_id: string }>(ids, (chunk) => supabaseUntyped.from('task_time_entries').select('sub_task_id').in('sub_task_id', chunk))
              .then((r) => new Set(r.map((x) => x.sub_task_id)))
              // A reader who may not see time entries still sees the status; the server's own check is the gate.
              .catch(() => new Set<string>())
          : Promise.resolve(new Set<string>()),
        ids.length ? fetchTaskReviewers(ids) : Promise.resolve(new Map<string, TaskReviewer[]>()),
      ])
      return {
        piece: {
          id: dr.id,
          name: dr.name,
          code: dr.code,
          dueAt: dr.due_at,
          tasksApprovedAt: dr.tasks_approved_at,
          ownerUserId: dr.owner_user_id,
          canApproveTasks: dr.can_approve_tasks === true,
          campaignId,
          campaignName,
        },
        tasks: rows.map((r) => ({
          id: r.id,
          deliverableId: r.deliverable_id,
          title: r.title,
          notes: r.description ?? '',
          hours: r.sla_hours == null ? null : Number(r.sla_hours),
          status: r.status,
          assigneeId: r.assignee_id,
          assigneeName: r.assignee_id ? (names.get(r.assignee_id) ?? null) : null,
          startsAt: r.starts_at,
          dueAt: r.due_at,
          reviewMode: toReviewMode(r.review_mode),
          reviewers: reviewers.get(r.id) ?? [],
          started: r.status === 'in_progress' || r.status === 'review' || logged.has(r.id),
          fromWorkflow: isSuggestedTask({ workflowStepId: r.workflow_step_id, title: r.title }),
          departmentId: r.department_id,
          teamId: r.team_id,
        })),
      }
    },
  })
}

async function schedule(subTaskId: string): Promise<string | undefined> {
  const { data, error } = await supabase.functions.invoke('subtask-schedule', { body: { subTaskId } })
  if (error) throw error
  return scheduleWarningKey(data as ScheduleOutcome) ?? undefined
}

export interface SaveTaskArgs {
  subTaskId: string
  deliverableId: string
  before: TaskDraft
  draft: TaskDraft
  /** what `update_task_assignment` is sent for the person and days — the booking window's own arithmetic */
  span: { startsAt: string; dueAt: string } | null
  /** ADR-0140 d.3: the "move it anyway" answer */
  confirmStarted: boolean
  /** the piece's waits-for edges, so a removed one is deleted by its id */
  edges: readonly TaskDependency[]
  tenantId: string | null
}

export interface SaveTaskResult {
  /** `requested`: the person or the days went to their team lead as an ask (ADR-0139, ADR-0140 d.2) */
  outcome: 'saved' | 'requested'
  scheduleWarning?: string
}

/**
 * Save one task's edit, in the order the plan says (unassign → assign → the rest → waits-for). A refusal stops the
 * save where it is and is thrown as the server worded it (the editor reads `task_started`, `not_assigned`,
 * `unassign_task` and answers in place).
 */
export async function saveTask(a: SaveTaskArgs): Promise<SaveTaskResult> {
  const plan = planTaskSave(a.before, a.draft)
  let outcome: SaveTaskResult['outcome'] = 'saved'
  let scheduleWarning: string | undefined
  if (plan.unassign) {
    const { error } = await supabaseUntyped.rpc('unassign_task', { p_sub_task: a.subTaskId, p_confirm_started: a.confirmStarted })
    if (error) throw error
  }
  if (plan.assign && a.draft.assigneeId) {
    const reviewersChanged = JSON.stringify(a.draft.reviewers) !== JSON.stringify(a.before.reviewers)
    const { data, error } = await supabaseUntyped.rpc('update_task_assignment', {
      p_sub_task: a.subTaskId,
      p_title: a.draft.title.trim(),
      p_assignee: a.draft.assigneeId,
      p_reviewers: reviewersChanged ? reviewerPayload(a.draft.reviewers) : null,
      p_starts_at: a.span?.startsAt ?? null,
      p_due_at: a.span?.dueAt ?? null,
      p_hours: a.draft.hours != null && a.draft.hours !== a.before.hours ? a.draft.hours : null,
      p_review_mode: a.draft.reviewMode !== a.before.reviewMode ? a.draft.reviewMode : null,
      p_confirm_started: a.confirmStarted,
    })
    if (error) throw error
    const row = (Array.isArray(data) ? data[0] : data) as { outcome?: string; reschedule_needed?: boolean } | null
    if (row?.outcome === 'requested') outcome = 'requested'
    // ADR-0061 d.1: what the scheduler placed is read, not assumed.
    if (row?.reschedule_needed) scheduleWarning = await schedule(a.subTaskId)
  }
  const p = plan.plain
  if (p.title || p.notes || p.hours || p.days || p.reviewers || p.reviewMode) {
    const { error } = await supabaseUntyped.rpc('save_sub_task', {
      p_sub_task: a.subTaskId,
      p_deliverable: a.deliverableId,
      p_title: a.draft.title.trim(),
      p_reviewers: p.reviewers ? reviewerPayload(a.draft.reviewers) : null,
      // '' clears the notes (save_sub_task coalesces null only).
      p_description: p.notes ? a.draft.notes.trim() : null,
      p_sla_hours: p.hours ? a.draft.hours : null,
      // An unheld task's days are its plan: from the start of the first day, due at 18:00 Iraq on the last (ADR-0076 d.3).
      p_starts_at: p.days && a.draft.from ? `${a.draft.from}T06:00:00.000Z` : null,
      p_due_at: p.days && a.draft.to ? endOfWorkingDay(a.draft.to).toISOString() : null,
      p_review_mode: p.reviewMode ? a.draft.reviewMode : null,
    })
    if (error) throw error
    if (plan.rematerialise) scheduleWarning = (await schedule(a.subTaskId)) ?? scheduleWarning
  }
  for (const w of plan.removeDeps) {
    const edge = a.edges.find((e) => e.subTaskId === a.subTaskId && e.prerequisiteId === w)
    if (!edge) continue
    const { error } = await supabaseUntyped.from('sub_task_dependencies').delete().eq('id', edge.id)
    if (error) throw error
  }
  for (const w of plan.addDeps) {
    const { error } = await supabaseUntyped.from('sub_task_dependencies').insert({
      tenant_id: a.tenantId,
      sub_task_id: a.subTaskId,
      depends_on_sub_task_id: w,
    })
    if (error) throw error
  }
  return { outcome, scheduleWarning }
}

function useInvalidate() {
  const qc = useQueryClient()
  return () => {
    invalidateTaskViews(qc)
    void qc.invalidateQueries({ queryKey: requirementKeys.all })
  }
}

export function useSaveTask() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: saveTask, onSettled: invalidate })
}

/** ADR-0140 d.5: cancel a booking — the person comes off, the task goes back to To book; they and their lead are told. */
export function useUnassignTask() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (a: { subTaskId: string; confirmStarted: boolean }) => {
      const { data, error } = await supabaseUntyped.rpc('unassign_task', { p_sub_task: a.subTaskId, p_confirm_started: a.confirmStarted })
      if (error) throw error
      return data as { bookings_freed?: number; told?: number } | null
    },
    onSettled: invalidate,
  })
}

/** ADR-0139 d.2: ask another team for a task — the team, optionally a person, a note and a needed-by day. */
export interface AskTeamArgs {
  subTaskId: string
  teamId: string
  assigneeId: string | null
  hours: number | null
  neededBy: string | null
  note: string
  startsAt?: string | null
  dueAt?: string | null
  /** who checks it — carried by the ask, written onto the task by the booking (I74.53); null keeps the task's own */
  reviewers?: ReviewerAppointment[] | null
  reviewMode?: ReviewMode | null
}

export function useAskAnotherTeam() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (a: AskTeamArgs) => {
      const { data, error } = await supabaseUntyped.rpc('request_task_booking', {
        p_sub_task: a.subTaskId,
        p_team: a.teamId,
        p_assignee: a.assigneeId,
        p_hours: a.hours,
        p_needed_by: a.neededBy,
        p_starts_at: a.startsAt ?? null,
        p_due_at: a.dueAt ?? null,
        p_note: a.note.trim() || null,
        p_reviewers: a.reviewers && a.reviewers.length > 0 ? reviewerPayload(a.reviewers) : null,
        p_review_mode: a.reviewMode ?? null,
      })
      if (error) throw error
      return data as string
    },
    onSettled: invalidate,
  })
}
