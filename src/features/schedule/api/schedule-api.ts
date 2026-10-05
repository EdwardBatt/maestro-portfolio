import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, supabaseUntyped } from '../../../lib/supabase'
import type { OfficeCalendar, Span } from '../../../lib/capacity/types.ts'
import { officeCalendarFromRow, type OfficeRowWithClosures } from '../../../lib/capacity/closures.ts'
import type { BookingState } from '../../../lib/bookings/state-machine.ts'
import { daySpan } from '../lib/day-span.ts'
import { taskSpanDays } from '../lib/drop-check.ts'
import { reviewerPayload, type ReviewerAppointment, type TaskReviewer } from '../../../lib/reviewers/task-reviewers'
import { fetchTaskReviewers } from '../../../lib/reviewers/task-reviewers-api'
import { toReviewMode, type ReviewMode } from '../../../lib/review/review-mode'
import { scheduleWarningKey, type ScheduleOutcome } from '../../../lib/bookings/schedule-outcome'
import { assignmentRequestKeys } from '../../../lib/assignment-requests/api'
import { liveOptions } from '../../../lib/query/live'
import { invalidateTaskViews } from '../../../lib/query/task-views'
import { inChunks } from '../../../lib/query/in-chunks'
import { allRows } from '../../../lib/query/all-pages'
import { workProgress, type SubTaskStatus, type WorkProgress } from '../../../lib/deliverables/work-phase'

/** Query keys — per-feature factory (AGENTS §4). */
export const scheduleKeys = {
  all: ['schedule'] as const,
  resources: () => [...scheduleKeys.all, 'resources'] as const,
  bookings: (window: Span) => [...scheduleKeys.all, 'bookings', window.start, window.end] as const,
  blackouts: (window: Span) => [...scheduleKeys.all, 'blackouts', window.start, window.end] as const,
}

export interface ScheduleResource {
  id: string
  name: string
  /** ADR-0011: unique handle shown beside the name to disambiguate collisions. */
  nickname: string | null
  kind: 'human' | 'equipment' | 'room'
  departmentId: string | null
  departmentName: string | null
  teamId: string | null
  teamName: string | null
  officeId: string | null
  /** the login this resource belongs to (ADR-0011), for the "My calendar" view */
  userId: string | null
  /** I74.24: the person's job title ("Junior designer") — the line under the name on the grid and in Who. */
  jobTitle?: string | null
  /** ADR-0139 d.1: the PERSON's department and team (user_profiles) — the scheduling reach reads these first. */
  personDepartmentId?: string | null
  personTeamId?: string | null
  /** the department the person's team (else the calendar's team) sits in */
  teamDepartmentId?: string | null
  capacityModel: 'exclusive' | 'pooled' | 'load_based'
  requiresApproval: boolean
  warnAtPct: number | null
  ceilingPct: number | null
  poolSize: number | null
  office: ({ name: string } & OfficeCalendar) | null
}

export interface ScheduleBooking extends Span {
  id: string
  resourceId: string
  state: BookingState
  loadPct: number | null
  notes: string | null
  campaignId: string | null
  /** enriched client-side from the campaigns query (see SchedulePage) */
  campaignName: string | null
  /** ADR-0096 d.12: the deliverable's phase, so the Project view can filter by it. */
  phaseId: string | null
  taskName: string | null
  /** I54.15: the deliverable's priority, so the grid says which chip is urgent without opening
   *  it. Null for a plain reservation with no deliverable behind it. */
  priority: 'high' | 'medium' | 'low' | null
  seriesId: string | null
  /** task-backed booking links (I11.7): drives the editable modal's info + save path. */
  subTaskId: string | null
  deliverableId: string | null
  bookingTitle: string | null
  /** I67.8: the booked task's own status and round, for the hover card's "Status:" line. */
  taskStatus: SubTaskStatus | null
  taskRevision: number
  /** I67.8: the deliverable's tasks by status — the hover card's "x of y – status" lines (ADR-0131). */
  pieceProgress: WorkProgress | null
}

export interface ScheduleBlackout extends Span {
  id: string
  resourceId: string
  kind: string
  /** ADR-0142 d.4: internal work's hours — counted in the day, not a whole-day block. Null otherwise. */
  hours: number | null
  /** what it is for ("Team training — motion presets") */
  reason: string | null
}

/** Local row shape — untyped client because nickname/team_id lag the generated
 * types until `gen types` re-runs after `db push` (same pattern as bookings). */
interface ScheduleResourceRow {
  id: string
  name: string
  nickname: string | null
  kind: 'human' | 'equipment' | 'room'
  capacity_model: 'exclusive' | 'pooled' | 'load_based'
  requires_approval: boolean
  warn_at_pct: number | string | null
  load_ceiling_pct: number | string | null
  pool_size: number | null
  department_id: string | null
  team_id: string | null
  office_id: string | null
  user_id: string | null
  departments: { name: string } | null
  teams: { name: string } | null
  offices: ({ name: string } & OfficeRowWithClosures) | null
}

/** `live`: refresh every 20 s and on returning to the tab (ADR-0105 d.5) — the Schedule and the team view. */
export interface LiveOption { live?: boolean }

export function useScheduleResources(opts?: LiveOption) {
  return useQuery({
    ...liveOptions(opts?.live),
    queryKey: scheduleKeys.resources(),
    queryFn: async (): Promise<ScheduleResource[]> => {
      const { data: raw, error } = await supabaseUntyped
        .from('resources')
        // The office embed carries its closures (ADR-0079 d.4) — keep it in step with `OFFICE_CALENDAR_SELECT`.
        .select('id, name, nickname, kind, capacity_model, requires_approval, warn_at_pct, load_ceiling_pct, pool_size, department_id, team_id, office_id, user_id, departments(name), teams(name), offices(name, timezone, working_days, office_closures(starts_on, ends_on))')
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      // ADR-0115 d.3: a person or resource in a department that takes no production work is not on the
      // Schedule or the Team page — so neither is that department or its teams in their filters, which are
      // built from these rows. A row's department is its own, else its team's, else its person's profile's.
      const [offDepts, teamRows, people] = await Promise.all([
        supabaseUntyped.from('departments').select('id').eq('is_production', false),
        supabaseUntyped.from('teams').select('id, department_id'),
        supabaseUntyped.from('user_profiles').select('id, department_id, team_id, job_title'),
      ])
      const off = new Set(((offDepts.data ?? []) as { id: string }[]).map((d) => d.id))
      const teamDept = new Map(((teamRows.data ?? []) as { id: string; department_id: string | null }[]).map((t) => [t.id, t.department_id]))
      const personRows = (people.data ?? []) as { id: string; department_id: string | null; team_id?: string | null; job_title?: string | null }[]
      const personDept = new Map(personRows.map((u) => [u.id, u.department_id]))
      const personTeam = new Map(personRows.map((u) => [u.id, u.team_id ?? null]))
      const personTitle = new Map(personRows.map((u) => [u.id, u.job_title ?? null]))
      const deptOf = (r: ScheduleResourceRow): string | null => {
        if (r.department_id) return r.department_id
        const viaTeam = r.team_id ? teamDept.get(r.team_id) : null
        if (viaTeam) return viaTeam
        return r.user_id ? personDept.get(r.user_id) ?? null : null
      }
      const data = ((raw ?? []) as unknown as ScheduleResourceRow[]).filter((r) => {
        const d = deptOf(r)
        return !d || !off.has(d)
      })
      return data.map((r) => ({
        id: r.id,
        name: r.name,
        nickname: r.nickname,
        kind: r.kind,
        departmentId: r.department_id,
        departmentName: r.departments?.name ?? null,
        teamId: r.team_id,
        teamName: r.teams?.name ?? null,
        officeId: r.office_id,
        userId: r.user_id,
        jobTitle: r.user_id ? (personTitle.get(r.user_id) ?? null) : null,
        personDepartmentId: r.user_id ? (personDept.get(r.user_id) ?? null) : null,
        personTeamId: r.user_id ? (personTeam.get(r.user_id) ?? null) : null,
        teamDepartmentId: (() => {
          const tm = (r.user_id ? personTeam.get(r.user_id) : null) ?? r.team_id
          return tm ? (teamDept.get(tm) ?? null) : null
        })(),
        capacityModel: r.capacity_model,
        requiresApproval: r.requires_approval,
        warnAtPct: r.warn_at_pct == null ? null : Number(r.warn_at_pct),
        ceilingPct: r.load_ceiling_pct == null ? null : Number(r.load_ceiling_pct),
        poolSize: r.pool_size,
        // ADR-0079 d.4: the closures ride on the office row, so every reader of this shape — the
        // grid's shading, both dialogs' previews, the drop warning — sees them without asking.
        office: r.offices ? { name: r.offices.name, ...officeCalendarFromRow(r.offices) } : null,
      }))
    },
  })
}

/** Local row shape for the bookings select. The generated types lag one
 * migration behind until `gen types` re-runs after `db push` (M5.7) —
 * this stays accurate either way. */
interface BookingRow {
  id: string
  resource_id: string
  state: BookingState
  starts_at: string
  ends_at: string
  load_pct: number | string | null
  notes: string | null
  series_id: string | null
  campaign_id: string | null
  sub_task_id: string | null
  deliverable_id: string | null
  title: string | null
  deliverables: {
    name: string; phase_id?: string | null; priority?: unknown; streams: { campaign_id: string } | null
    sub_tasks?: { status: SubTaskStatus; assignee_id: string | null }[] | null
  } | null
  sub_tasks?: { status: SubTaskStatus; revision_number: number | null } | null
}

/**
 * The campaign a booking belongs to, worked out on read: booking → deliverable → stream →
 * campaign. `bookings.campaign_id` is NULL on every row there has ever been — nothing writes it
 * (I49.71) — so the Project view and filter read as empty until 16 Sep. Deriving it here repairs
 * history for free and cannot drift when a task moves; the column is read only as a fallback.
 */
const campaignOf = (b: BookingRow): string | null => b.campaign_id ?? b.deliverables?.streams?.campaign_id ?? null

/** The deliverables column's own check, mirrored: anything else reads as none. */
const bookingPriority = (raw: unknown): ScheduleBooking['priority'] =>
  raw === 'high' || raw === 'medium' || raw === 'low' ? raw : null

export function useScheduleBookings(window: Span, opts?: LiveOption) {
  return useQuery({
    ...liveOptions(opts?.live),
    queryKey: scheduleKeys.bookings(window),
    queryFn: async (): Promise<ScheduleBooking[]> => {
      // `supabaseUntyped` because `deliverables.priority` arrives with I54.12's migration
      // (`20260922160000`), which is still local-only — the generated types cannot see the column
      // yet and the typed client rejects the whole select for it. The row shape below is the
      // accurate one either way; narrow this back once `gen types` has run (CLAUDE.md).
      // Every page (I59.35): the four-week view held 1,351 bookings locally on 25 Sep, and the server
      // answers 1,000 at a time — the rest were simply missing from the grid and the load figures.
      const data = await allRows<BookingRow>((a, b) =>
        supabaseUntyped
          .from('bookings')
          .select('id, resource_id, state, starts_at, ends_at, load_pct, notes, series_id, campaign_id, sub_task_id, deliverable_id, title, deliverables(name, phase_id, priority, streams(campaign_id), sub_tasks(status, assignee_id)), sub_tasks(status, revision_number)')
          .in('state', ['soft_hold', 'tentative', 'confirmed'])
          .lt('starts_at', new Date(window.end).toISOString())
          .gt('ends_at', new Date(window.start).toISOString())
          .order('id')
          .range(a, b))
      return data.map((b) => ({
        id: b.id,
        resourceId: b.resource_id,
        state: b.state,
        start: Date.parse(b.starts_at),
        end: Date.parse(b.ends_at),
        loadPct: b.load_pct == null ? null : Number(b.load_pct),
        notes: b.notes,
        campaignId: campaignOf(b),
        campaignName: null,
        phaseId: b.deliverables?.phase_id ?? null,
        taskName: b.deliverables?.name ?? null,
        priority: bookingPriority(b.deliverables?.priority),
        seriesId: b.series_id,
        subTaskId: b.sub_task_id,
        deliverableId: b.deliverable_id,
        bookingTitle: b.title,
        taskStatus: b.sub_tasks?.status ?? null,
        taskRevision: b.sub_tasks?.revision_number ?? 0,
        pieceProgress: b.deliverables?.sub_tasks?.length ? workProgress(b.deliverables.sub_tasks) : null,
      }))
    },
  })
}

export function useScheduleBlackouts(window: Span, opts?: LiveOption) {
  return useQuery({
    ...liveOptions(opts?.live),
    queryKey: scheduleKeys.blackouts(window),
    queryFn: async (): Promise<ScheduleBlackout[]> => {
      const { data, error } = await supabase
        .from('resource_unavailability')
        .select('id, resource_id, kind, starts_at, ends_at, hours, reason')
        .lt('starts_at', new Date(window.end).toISOString())
        .gt('ends_at', new Date(window.start).toISOString())
      if (error) throw error
      return data.map((b) => ({
        id: b.id,
        resourceId: b.resource_id,
        kind: b.kind,
        start: Date.parse(b.starts_at),
        end: Date.parse(b.ends_at),
        hours: b.hours == null ? null : Number(b.hours),
        reason: b.reason ?? null,
      }))
    },
  })
}

/**
 * What a drag on a task's chip is measured against (I59.13, ADR-0105 d.5): the task's span — so the
 * check knows where the moved work ends — and its committed date, the L6 warning's line. Also the
 * three dates the extension ask needs, so "Ask for the extension" opens without another read.
 */
export interface TaskCommitment {
  subTaskId: string
  title: string
  startsAt: string | null
  dueAt: string | null
  committedDueAt: string | null
  deliverableDueAt: string | null
  goLiveAt: string | null
}

interface CommitmentRow {
  id: string
  title: string
  starts_at: string | null
  due_at: string | null
  committed_due_at: string | null
  deliverable: { due_at: string | null; streams: { campaigns: { go_live_at: string | null } | { go_live_at: string | null }[] | null } | null } | null
}

export function useTaskCommitments(subTaskIds: readonly string[], opts?: LiveOption) {
  const ids = [...new Set(subTaskIds)].sort()
  return useQuery({
    ...liveOptions(opts?.live),
    queryKey: [...scheduleKeys.all, 'commitments', ids] as const,
    enabled: ids.length > 0,
    queryFn: async (): Promise<Map<string, TaskCommitment>> => {
      // In batches (I49.75): a week of chips can name more tasks than one address holds.
      const rows = await inChunks<CommitmentRow>(ids, (chunk) =>
        supabaseUntyped
          .from('sub_tasks')
          .select('id, title, starts_at, due_at, committed_due_at, deliverable:deliverables(due_at, streams(campaigns(go_live_at)))')
          .in('id', chunk),
      )
      const m = new Map<string, TaskCommitment>()
      for (const r of rows) {
        const c = r.deliverable?.streams?.campaigns
        m.set(r.id, {
          subTaskId: r.id,
          title: r.title,
          startsAt: r.starts_at,
          dueAt: r.due_at,
          committedDueAt: r.committed_due_at,
          deliverableDueAt: r.deliverable?.due_at ?? null,
          goLiveAt: (Array.isArray(c) ? c[0] : c)?.go_live_at ?? null,
        })
      }
      return m
    },
  })
}

// ---------- mutations: ALWAYS through the Edge Function (authoritative) ----

export interface CreateBookingArgs {
  resourceId: string
  startsAt: string
  endsAt: string
  requested: 'tentative' | 'confirmed'
  hoursPerDay?: number
  /** project-task mode */
  deliverableId?: string
  campaignId?: string
  taskName?: string
  /** ADR-0029 (I7.2): assign a specific sub-task of the chosen deliverable (booking-transition
   *  resolves the deliverable from it). When set, deliverableId/campaignId/taskName are ignored. */
  subTaskId?: string
  /** ad-hoc mode */
  notes?: string
  title?: string
  series?: { freq: 'weekly' | 'daily'; repeatCount: number; intervalWeeks: number }
}

export interface RescheduleArgs {
  bookingId: string
  expectedState: BookingState
  startsAt: string
  endsAt: string
  resourceId?: string
}

async function invokeBooking<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('booking-transition', { body })
  if (error) {
    // FunctionsHttpError carries the response — surface the server's envelope
    const ctx = (error as { context?: Response }).context
    if (ctx) {
      const payload = await ctx.json().catch(() => null)
      throw Object.assign(new Error(payload?.error?.message ?? error.message), {
        code: payload?.error?.code,
        assessments: payload?.assessments ?? (payload?.assessment ? [payload.assessment] : undefined),
      })
    }
    throw error
  }
  return data as T
}

/** ADR-0086 d.8: a campaign or a single job — the held rule itself is answered server-side (`useProjectTasks`). */
export interface CampaignOption { id: string; name: string; kind: 'single_job' | 'campaign' }
export interface TaskOption { id: string; name: string }

/** ADR-0096 d.12: the phases of the campaign in view, for the Project view's filter. Same query
 *  key as the campaign feature's read, so one invalidation reaches both. */
export function useCampaignPhaseOptions(campaignId: string | null) {
  return useQuery({
    queryKey: ['campaign-phases', campaignId ?? ''] as const,
    enabled: Boolean(campaignId),
    queryFn: async (): Promise<{ id: string; number: number; name: string }[]> => {
      const { data, error } = await supabaseUntyped
        .from('campaign_phases')
        .select('id, number, name')
        .eq('campaign_id', campaignId!)
        .order('number')
      if (error) throw error
      return ((data ?? []) as Record<string, any>[]).map((r) => ({ id: r.id, number: r.number, name: r.name }))
    },
  })
}

/**
 * The deliverables of a campaign whose work can actually be handed out (ADR-0090 d.3a): the ones
 * the assignment gate would accept — the department's brief approved on a campaign (ADR-0070 d.4,
 * ADR-0072 d.6), the owner's task list approved on a single job (ADR-0090 d.3). Answered by the
 * database from the same function the gate reads, so this list and the trigger cannot disagree.
 * A held deliverable is absent, not disabled: offering work the gate will refuse is a dead end.
 */
export function useProjectTasks(campaignId: string | null) {
  return useQuery({
    queryKey: [...scheduleKeys.all, 'tasks', campaignId] as const,
    enabled: campaignId != null && campaignId !== '',
    queryFn: async (): Promise<TaskOption[]> => {
      const { data, error } = await supabaseUntyped.rpc('assignable_deliverables', { p_campaign: campaignId! })
      if (error) throw error
      return ((data ?? []) as { id: string; name: string }[]).map((d) => ({ id: d.id, name: d.name }))
    },
  })
}

/**
 * The campaigns whose work can actually be handed out (ADR-0060 d.2).
 *
 * **Approved only.** ADR-0048 d.8 refuses to assign or book anything on an unapproved campaign, in
 * the database, with a message naming the account manager. Listing those campaigns here would offer
 * a choice that always fails — and the failure arrives after the person has filled in a reviewer,
 * hours and dates. A surface should not present work the system is going to refuse.
 */
export function useCampaigns() {
  return useQuery({
    queryKey: [...scheduleKeys.all, 'campaigns', 'approved'] as const,
    queryFn: async (): Promise<CampaignOption[]> => {
      // `*` for `kind` (ADR-0086 d.8), which arrives with the database half of I44.
      // Every page (I59.35): 826 approved campaigns locally on 25 Sep.
      const data = await allRows<{ id: string; name: string; kind?: unknown }>((a, b) =>
        supabaseUntyped.from('campaigns').select().eq('status', 'approved').order('name').order('id').range(a, b))
      return data.map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind === 'single_job' ? 'single_job' : 'campaign',
      }))
    },
  })
}

export interface SubTaskOption { id: string; title: string }

/**
 * A deliverable's tasks that are still waiting to be given out (ADR-0060 d.3).
 *
 * Three exclusions, each for its own reason:
 *
 *   * **`done` and `cancelled`** are settled. Offering them is offering to schedule work that is
 *     over.
 *   * **Anything already assigned.** Edward, 30 Aug: *"these already surface on /schedule and can be
 *     reassigned from there."* An assigned task is a chip on the grid — drag it to move it, or open
 *     it to change who holds it, both of which move the BOOKING as well. Listing it here too would
 *     be a second route to something that already has a better one, and would let two people hand
 *     out the same task from two places.
 *
 * So this answers exactly one question: what work under this deliverable is still unassigned.
 * Ordered by `sort_order` then `created_at` — the workflow's own order (ADR-0052 d.14), so the list
 * reads the way the task table does rather than by whatever was created first.
 */
export function useAssignableSubTasks(deliverableId: string | null) {
  return useQuery({
    queryKey: [...scheduleKeys.all, 'assignable-subtasks', deliverableId] as const,
    enabled: deliverableId != null && deliverableId !== '',
    queryFn: async (): Promise<SubTaskOption[]> => {
      const { data, error } = await supabaseUntyped
        .from('sub_tasks')
        .select('id, title, sort_order, created_at')
        .eq('deliverable_id', deliverableId!)
        .is('assignee_id', null)
        .not('status', 'in', '("done","cancelled")')
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('unit_index', { ascending: true, nullsFirst: true })
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string,
        title: r.title as string,
      }))
    },
  })
}

export function useCreateBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: CreateBookingArgs) =>
      invokeBooking<{ bookings: unknown[]; needsApproval: boolean }>({ action: 'create', ...args }),
    // A booking write moves a task's person or days: every view of the task re-reads (test script step 14).
    onSettled: () => invalidateTaskViews(qc),
  })
}

export function useRescheduleBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: RescheduleArgs) => invokeBooking<{ booking: unknown }>({ action: 'reschedule', ...args }),
    // A booking write moves a task's person or days: every view of the task re-reads (test script step 14).
    onSettled: () => invalidateTaskViews(qc),
  })
}

export function useCancelBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: { bookingId: string; expectedState: BookingState }) =>
      invokeBooking<{ booking: unknown }>({ action: 'cancel', ...args }),
    // A booking write moves a task's person or days: every view of the task re-reads (test script step 14).
    onSettled: () => invalidateTaskViews(qc),
  })
}

// ---------- task-backed booking detail + edit (I11.7) -----------------------

/** The task metadata shown in the edit modal for a task-backed booking: who assigned it and when,
 *  who last modified it and when, the current assignee + reviewer, and the task's own span/hours. */
export interface BookingTaskDetail {
  subTaskId: string
  title: string
  assigneeId: string | null
  assigneeName: string | null
  creatorName: string | null
  createdAt: string | null
  modifierName: string | null
  updatedAt: string | null
  startsAt: string | null
  dueAt: string | null
  slaHours: number | null
  /** ADR-0059: digital or manual. The edit modal both shows it and sets it — assignment is where
   *  the person deciding is. */
  reviewMode: ReviewMode
  deliverableId: string | null
  /** true when the deliverable is a stream-backed project deliverable (name is NOT the task title). */
  isProjectDeliverable: boolean
  /** ADR-0043: every reviewer appointed to this task, with their own verdict. The modal both shows
   *  them and edits them. */
  reviewers: TaskReviewer[]
  /** The task's own placement — what app.in_write_scope actually tests when this task is edited.
   *  Fetched so the edit modal can mirror the real gate instead of only the permission half. */
  departmentId: string | null
  teamId: string | null
  /** ADR-0075 d.3 / ADR-0088: the committed deadline, the deliverable's promise, and the campaign's
   *  go-live — what the extension ask beside the date is measured against. */
  committedDueAt: string | null
  deliverableDueAt: string | null
  goLiveAt: string | null
}

/** Row shape for the task-detail select. sub_tasks→user_profiles has THREE FKs (assignee_id,
 *  created_by, updated_by) so every embed MUST name its FK constraint (the repeatedly-biting
 *  ambiguous-embed footgun — AGENTS/CLAUDE). */
interface TaskDetailRow {
  id: string
  title: string
  assignee_id: string | null
  created_at: string | null
  updated_at: string | null
  starts_at: string | null
  due_at: string | null
  committed_due_at: string | null
  sla_hours: number | string | null
  review_mode: ReviewMode | null
  deliverable_id: string | null
  department_id: string | null
  team_id: string | null
  assignee: { display_name: string } | null
  creator: { display_name: string } | null
  modifier: { display_name: string } | null
  deliverable:
    | {
        name: string
        stream_id: string | null
        due_at: string | null
        streams: { campaigns: { go_live_at: string | null } | { go_live_at: string | null }[] | null } | null
      }
    | null
}

export function useBookingTaskDetail(subTaskId: string | null) {
  return useQuery({
    queryKey: [...scheduleKeys.all, 'taskDetail', subTaskId] as const,
    enabled: subTaskId != null && subTaskId !== '',
    queryFn: async (): Promise<BookingTaskDetail | null> => {
      const { data, error } = await supabaseUntyped
        .from('sub_tasks')
        .select(
          'id, title, assignee_id, created_at, updated_at, starts_at, due_at, committed_due_at, sla_hours, review_mode, deliverable_id, ' +
            'department_id, team_id, ' +
            'assignee:user_profiles!sub_tasks_assignee_id_fkey(display_name), ' +
            'creator:user_profiles!sub_tasks_created_by_fkey(display_name), ' +
            'modifier:user_profiles!sub_tasks_updated_by_fkey(display_name), ' +
            'deliverable:deliverables(name, stream_id, due_at, streams(campaigns(go_live_at)))',
        )
        .eq('id', subTaskId!)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      const d = data as unknown as TaskDetailRow
      // ADR-0043: the reviewer left sub_tasks for its own table. One shared reader, so this modal
      // and the Deliverables page can never disagree about who is reviewing the task.
      const reviewers = (await fetchTaskReviewers([d.id])).get(d.id) ?? []
      return {
        subTaskId: d.id,
        title: d.title,
        assigneeId: d.assignee_id,
        assigneeName: d.assignee?.display_name ?? null,
        creatorName: d.creator?.display_name ?? null,
        createdAt: d.created_at,
        modifierName: d.modifier?.display_name ?? null,
        updatedAt: d.updated_at,
        startsAt: d.starts_at,
        dueAt: d.due_at,
        slaHours: d.sla_hours == null ? null : Number(d.sla_hours),
        reviewMode: toReviewMode(d.review_mode),
        deliverableId: d.deliverable_id,
        isProjectDeliverable: d.deliverable?.stream_id != null,
        departmentId: d.department_id,
        teamId: d.team_id,
        committedDueAt: d.committed_due_at ?? null,
        deliverableDueAt: d.deliverable?.due_at ?? null,
        goLiveAt: (() => {
          const c = d.deliverable?.streams?.campaigns
          return (Array.isArray(c) ? c[0] : c)?.go_live_at ?? null
        })(),
        // ADR-0038 d.2/d.3, widened by ADR-0043: the reviewers belong to the TASK. This once read
        // the DELIVERABLE's reviewer, which for campaign work is always null (so the modal showed
        // the retired "Any reviewer" label and blanked the select) and, where a deliverable named a
        // different person, meant saving any unrelated edit silently reassigned the task's reviewer
        // — an authority change nobody made.
        reviewers,
      }
    },
  })
}

/**
 * What `update_task_assignment` answers (ADR-0060 d.10, extended by ADR-0087 d.2). `outcome` is
 * the server's word on whether the task was ASSIGNED or a REQUEST was recorded instead; the client
 * never chooses which and never infers it from the absence of an error.
 */
export interface AssignmentRpcRow {
  sub_task_id?: string
  deliverable_id?: string | null
  reschedule_needed?: boolean
  outcome?: 'assigned' | 'requested'
  request_id?: string | null
}

export interface UpdateTaskArgs {
  subTaskId: string
  title: string
  assigneeId: string
  /** ADR-0043: the appointment list. NULL leaves the existing reviewers untouched — which is what
   *  an edit that is not about who reviews the work should do. */
  reviewers: ReviewerAppointment[] | null
  startsAt: string
  dueAt: string
  /** total effort (sla_hours) for the task — subtask-schedule spreads it across working days. */
  hours: number
  /** ADR-0059 d.4: digital or manual. NULL leaves the task's mode alone, the same convention
   *  `reviewers` uses and for the same reason. */
  reviewMode?: ReviewMode | null
}

/** Edit a task from the schedule modal (I11.7): authoritative RPC (title/assignee/reviewer/dates/hours),
 *  then re-materialise its bookings via subtask-schedule when the assignee or dates changed. */
export function useUpdateTaskAssignment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: UpdateTaskArgs) => {
      const { data, error } = await supabaseUntyped.rpc('update_task_assignment', {
        p_sub_task: a.subTaskId,
        p_title: a.title,
        p_assignee: a.assigneeId,
        p_reviewers: a.reviewers ? reviewerPayload(a.reviewers) : null,
        p_starts_at: a.startsAt,
        p_due_at: a.dueAt,
        p_hours: a.hours,
        p_review_mode: a.reviewMode ?? null,
      })
      if (error) throw error
      const row = (Array.isArray(data) ? data[0] : data) as AssignmentRpcRow | null
      // ADR-0087 d.2: the server decided whether this was an assignment or a REQUEST, and says
      // which. A request assigns nothing, so there is nothing to schedule — running the scheduler
      // here would be the half-built state the ADR exists to prevent.
      if (row?.outcome === 'requested') {
        return { ...row, outcome: 'requested' as const, requestId: row.request_id ?? null, scheduleWarning: undefined }
      }
      // ADR-0061 d.1: the answer is read. A 200 saying `scheduled: 0` used to pass for success, so
      // a task could be assigned, nothing booked, and the dialog closed on a green message.
      let scheduleWarning: string | undefined
      if (row?.reschedule_needed) {
        const { data: sched, error: schedErr } = await supabase.functions.invoke('subtask-schedule', {
          body: { subTaskId: a.subTaskId },
        })
        if (schedErr) throw schedErr
        scheduleWarning = scheduleWarningKey(sched as ScheduleOutcome) ?? undefined
      }
      return { ...(row ?? {}), outcome: 'assigned' as const, requestId: null, scheduleWarning }
    },
    // Every view of the task re-reads — the Schedule pop-up's task list too (test script step 14: a stale list
    // opened a booked task as unbooked).
    onSettled: () => {
      invalidateTaskViews(qc)
      void qc.invalidateQueries({ queryKey: assignmentRequestKeys.all })
    },
  })
}

/**
 * ADR-0039 d.6: dragging a task chip onto ANOTHER PERSON reassigns the work.
 *
 * The confirm dialog has always promised three things — the work changes hands, the new assignee is
 * notified, and their schedule is rebuilt from the task. None of them happened: the confirmed drag
 * called `booking-transition`'s reschedule, whose only writes are the booking's dates and
 * resource_id. `sub_tasks.assignee_id` never moved, so the task stayed in the ORIGINAL person's
 * queue, the new person was never told (the booking-level notify trigger deliberately skips
 * task-backed rows, deferring to the assignee trigger that never fired), and ADR-0040's
 * assignment-authority check was bypassed because assignee_id never changed.
 *
 * The authoritative path is the same one the edit modal uses. Title, reviewer and hours carry
 * through unchanged; the assignee moves, AND SO DO THE DATES — the task starts on the day it was
 * dropped, keeping its existing span length. Dropping a chip to move dates has always worked (the
 * booking write syncs the task's span through ADR-0039's envelope trigger); routing this path
 * through the RPC must not cost that, which an earlier version of this hook did by sending nulls.
 * Reassigning resets `schedule_overridden`, so `subtask-schedule` releases the old bookings and
 * re-materialises on the new assignee's calendar at the new dates.
 */
export function useReassignTaskToResource() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: {
      subTaskId: string
      targetUserId: string
      /** the day the chip was dropped on — the task's new first day */
      targetIsoDate: string
      /** the TARGET resource's office timezone, so the day means the same thing to the scheduler */
      timezone: string
    }) => {
      const { data: raw, error: readErr } = await supabaseUntyped
        .from('sub_tasks')
        .select('title, sla_hours, starts_at, due_at')
        .eq('id', a.subTaskId)
        .single()
      if (readErr) throw readErr
      const task = raw as {
        title: string
        sla_hours: number | string | null
        starts_at: string | null
        due_at: string | null
      }

      // Keep the span LENGTH, move the start to the drop day.
      // The same span rule the drop's past-commitment check measures with (I59.13), so the warning
      // and the write cannot disagree about where the work ends.
      const spanDays = taskSpanDays(task.starts_at, task.due_at)
      const totalHours = task.sla_hours == null ? null : Number(task.sla_hours)
      const perDay = totalHours == null ? 8 : totalHours / spanDays
      const lastIso = new Date(Date.parse(a.targetIsoDate) + (spanDays - 1) * 86_400_000)
        .toISOString()
        .slice(0, 10)
      const first = daySpan(a.targetIsoDate, perDay, a.timezone)
      const last = daySpan(lastIso, perDay, a.timezone)

      const { data, error } = await supabaseUntyped.rpc('update_task_assignment', {
        p_sub_task: a.subTaskId,
        p_title: task.title,
        p_assignee: a.targetUserId,
        // ADR-0043: null means "leave the appointments alone". Moving work to somebody else is not a
        // decision about who reviews it, and re-sending the list from here would make this a second
        // home for that fact — the shape of the bug ADR-0043 exists to end. The database still
        // refuses the drop if it would leave the task with no reviewer, or with its own assignee as
        // one (the deferred rule in 20260827100000).
        p_reviewers: null,
        p_starts_at: new Date(first.start).toISOString(),
        p_due_at: new Date(last.end).toISOString(),
        p_hours: totalHours,
        // A drag on the schedule moves WHO does the work and WHEN. It is not a statement about how
        // the work is reviewed, so the mode is left exactly as it is.
        p_review_mode: null,
      })
      if (error) throw error

      const row = (Array.isArray(data) ? data[0] : data) as AssignmentRpcRow | null
      // ADR-0087 d.12: a drop onto a row outside the dragger's reach is a REQUEST, decided by the
      // same RPC. Nothing moved, nothing to schedule; the chip stays where it was until the lead
      // answers. The caller reads `outcome` and says so.
      if (row?.outcome === 'requested') return { ...row, outcome: 'requested' as const }
      if (row?.reschedule_needed) {
        const { error: schedErr } = await supabase.functions.invoke('subtask-schedule', {
          body: { subTaskId: a.subTaskId },
        })
        if (schedErr) throw schedErr
      }
      return { ...(row ?? {}), outcome: 'assigned' as const }
    },
    // Every view of the task re-reads — the Schedule pop-up's task list too (test script step 14: a stale list
    // opened a booked task as unbooked).
    onSettled: () => {
      invalidateTaskViews(qc)
      void qc.invalidateQueries({ queryKey: assignmentRequestKeys.all })
    },
  })
}

/** Edit a plain reservation's title/notes (no task behind it). RLS bookings_scheduler_update:
 *  bookings:update AND app.resource_in_write_scope(resource_id), or ADR-0029's PM bypass for a
 *  booking on the caller's own project. (The temporary alpha blanket grant this comment used to
 *  describe was withdrawn in 20260823110000_revert_temp_alpha_scope.sql.) */
export function useUpdateBookingFields() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: { bookingId: string; title: string; notes: string }) => {
      const { error } = await supabaseUntyped
        .from('bookings')
        .update({ title: a.title, notes: a.notes })
        .eq('id', a.bookingId)
      if (error) throw error
    },
    onSettled: () => qc.invalidateQueries({ queryKey: scheduleKeys.all }),
  })
}

/**
 * I71.2 (Edward, 1 Oct, A): is this piece's task list approved, and who approves it?
 *
 * Read right after the booking dialog adds a NEW task: a task anyone but the owner adds re-opens an approved list
 * (ADR-0132 d.4), and work on a list waiting for approval cannot be assigned. The dialog then stops at "added" and names
 * the owner, instead of trying an assignment the gate is bound to refuse.
 */
export async function readTaskListGate(deliverableId: string): Promise<{ approved: boolean; ownerName: string | null }> {
  const { data, error } = await supabaseUntyped
    .from('deliverables')
    .select('tasks_approved_at, owner_user_id')
    .eq('id', deliverableId)
    .single()
  if (error) throw error
  const row = data as { tasks_approved_at: string | null; owner_user_id: string | null }
  let ownerName: string | null = null
  if (row.owner_user_id) {
    const { data: owner } = await supabaseUntyped.from('user_profiles').select('display_name').eq('id', row.owner_user_id).maybeSingle()
    ownerName = (owner as { display_name: string } | null)?.display_name ?? null
  }
  return { approved: row.tasks_approved_at != null, ownerName }
}
