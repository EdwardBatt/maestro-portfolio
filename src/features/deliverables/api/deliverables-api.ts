import { fetchLeavingIds, withoutLeaving } from '../../../lib/people/leaving'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { assigneeNamesOf, assignerNamesOf, blockingReviewerNamesOf } from '../lib/row-people'
import { workProgress, type WorkProgress } from '../../../lib/deliverables/work-phase'
import { supabase, supabaseUntyped } from '../../../lib/supabase'
import { fetchUserNames } from '../../../lib/users/user-names'
import { allRows } from '../../../lib/query/all-pages'
import type { DeliverableState } from '../../../lib/deliverables/state-machine'
import {
  isReviewerOutstanding,
  reviewerPayload,
  type ReviewerAppointment,
  type ReviewerResponse,
  type TaskReviewer,
} from '../../../lib/reviewers/task-reviewers'
import { fetchTaskReviewers } from '../../../lib/reviewers/task-reviewers-api'
import { orderTasks } from '../lib/task-order'
import { scheduleWarningKey, type ScheduleOutcome } from '../../../lib/bookings/schedule-outcome'
import { toReviewMode, type ReviewMode } from '../../../lib/review/review-mode'
import { RISK_KEY } from '../../../lib/brief/single-execution'
import { RULES_KEY, parseRules, type ClientRule, normalizeRules } from '../../../lib/brief/rules'
import { invalidateTaskViews } from '../../../lib/query/task-views'

/** The column's own check, mirrored: anything else reads as none. */
function priorityOf(raw: unknown): DeliverableRow['priority'] {
  return raw === 'high' || raw === 'medium' || raw === 'low' ? raw : null
}

/**
 * Deliverables & sub-tasks feature API (ADR-0024, Phase I). The only place this feature talks
 * to Supabase. Reads are tenant-wide (RLS); the deliverable lifecycle goes through the
 * deliverable-transition Edge Function (the DB guard is authoritative), and assigning/scheduling
 * a sub-task upserts the row then calls subtask-schedule to materialise its bookings. Presentation
 * layer only — the guard, RLS and capacity engine make every real decision server-side.
 */

export const deliverableKeys = {
  all: ['deliverables'] as const,
  byCampaign: (campaignId: string) => [...deliverableKeys.all, 'by-campaign', campaignId] as const,
  detail: (id: string) => [...deliverableKeys.all, 'detail', id] as const,
  /** ADR-0089 d.5: what the reviewer's Done would record — re-asked whenever they write a comment. */
  responseKind: (subTaskId?: string) =>
    subTaskId ? ([...deliverableKeys.all, 'response-kind', subTaskId] as const) : ([...deliverableKeys.all, 'response-kind'] as const),
}

// ADR-0030 (I8.3): sub-tasks are never 'blocked' — soft dependencies + external inputs replace it.
export type SubTaskStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled'

// ADR-0059: how a task is submitted for review. `digital` needs this round's own uploaded version;
// `manual` needs the assignee's written account instead, because a shoot, a print run or an
// installation produces no file to attach. Defined in `src/lib/review/review-mode` and re-exported
// here so a reader of a task row finds the type where the row is.
export type { ReviewMode }

export interface DeliverableRow {
  id: string
  name: string
  state: DeliverableState
  dueAt: string | null
  /** SJ-v3-04 (22 Sep): High / Medium / Low, set by the account manager; null where nobody did.
   *  Optional on the type so the many test fixtures that build a row by hand stay as they are. */
  priority?: 'high' | 'medium' | 'low' | null
  revisionRound: number
  revisionLimit: number | null
  streamId: string | null
  streamName: string | null
  /** ADR-0052 d.11: LIVE sub-tasks (neither done nor cancelled) and how many of them nobody is on —
   *  what the archive wording and the sign-off warning read. Both 0 where the query did not fetch
   *  tasks (the ad-hoc and detail reads). */
  taskCount: number
  unassignedCount: number
  /** I52.10 (Edward, 17 Sep): the total is EVERY task except a cancelled one — done is a status, not
   *  an exclusion — and how many of those are done. What the campaign page's rings read. Optional
   *  only so the pages' many fixtures stay valid; the mapper always sets them. */
  taskTotal?: number
  doneCount?: number
  /** ADR-0051 d.8: the deliverable's type, or null. NULL IS NORMAL — an untyped deliverable is a
   *  legal permanent state and must never be filtered out of a list it would otherwise appear in.
   *  Surfaces render "no type set"; they do not hide the row. */
  typeName: string | null
  /** I52.21: the type's id and the quantity, so the campaign page's edit dialog opens on what is set.
   *  Optional only so the pages' many fixtures stay valid; the campaign read sets them. */
  deliverableTypeId?: string | null
  quantity?: number
  /** ADR-0096 d.3: the phase this deliverable sits in, when its campaign runs in phases. */
  phaseId?: string | null
  /** ADR-0050: the person accountable. Null on ad-hoc work created before ADR-0053 d.6, and on
   *  internal-project deliverables created before I22.5. Changed through `useReassignDeliverable`. */
  ownerUserId: string | null
  /** ADR-0050 d.2 — who is accountable for this deliverable. Null where nobody was named. */
  ownerName: string | null
  /** I40.22 — where the work actually is, read from the TASKS rather than from `state`. The
   *  deliverable's own state says what the container is called; this says whether anybody has
   *  started. `no_tasks` on any read that does not fetch them. */
  progress: WorkProgress
  /** I40.22 — who is ON the live tasks. Distinct from `ownerName`, which is the person accountable
   *  for the deliverable (ADR-0050): the owner may be doing none of the work. */
  assigneeNames: string[]
  /** I40.22 — who HANDED the work out. On ad-hoc the owner and the assignee are the same person, so
   *  a column for the owner repeated the next column and said nothing; who gave the work out is the
   *  half that was missing (Edward, 8 Sep). */
  assignerNames: string[]
  /** I40.22 — who a task in review is waiting for. The MANDATORY reviewers when any are appointed,
   *  since they are the only ones that block; otherwise whoever is outstanding, because
   *  `is_mandatory` defaults to false and a blank column on work that has sat for a week is the
   *  wrong answer. `allRequired` says which of the two you are looking at. Empty when nothing is in
   *  review, which is not a reason to chase anybody. */
  blockingReviewers: { names: string[]; allRequired: boolean }
  /**
   * The label a campaign deliverable carries, sourced from the DEPARTMENT of the person who owns
   * it (`deliverables.department_id`, stamped from the owner by ADR-0050) — not from `work_types`.
   *
   * It used to read `streams.work_types(name)`. ADR-0050's rewrite of `create_campaign_from_brief`
   * stopped setting `streams.work_type_id`, so from 27 Aug every campaign deliverable rendered an
   * em-dash here. Reading the department fixes that AND fixes what the column always got wrong: it
   * showed one of six seeded words instead of the tenant's own organisation.
   *
   * Still named `discipline` because eight surfaces read it under that name; the rename belongs
   * with the taxonomy work (ADR-0053), not with a regression fix.
   */
  discipline: string | null
  /** The department that owns the work, as an id — what `discipline` is the NAME of. The campaign
   *  page groups its sections by this, so a renamed department cannot split one section in two.
   *  Fetched by the campaign read and the detail read. It was hard-coded null on the detail read
   *  until 28 Aug — the column was never selected, so the value there meant "never asked", not
   *  "no department", and any caller believing it would have grouped the work wrongly. The ad-hoc
   *  read still leaves it null and does not select the column: nothing on that tab groups by
   *  department. Select it there before reading this field off an ad-hoc row. */
  departmentId: string | null
  campaignId: string | null
  /** Highest review version on this deliverable. Once approved that IS the approved one — nothing
   *  uploads after approval — and while the work is live it is simply the latest. Shown on the
   *  Ad-hoc tab instead of the revision round. Null wherever versions were not fetched (campaign). */
  approvedVersion: number | null
  /**
   * ADR-0090 d.2: when the OWNER approved the generated task list, and who. Null until they do.
   *
   * **Every kind of work since ADR-0100 d.2** (23 Sep): the campaign's gate used to be the
   * department's brief, so this was null forever on campaign work and meant nothing there. Now it
   * is the one gate, and null means held wherever it appears.
   */
  tasksApprovedAt: string | null
  tasksApprovedBy: string | null
  /**
   * ADR-0090 d.4 (amended 12 Sep): whether THIS caller may approve this deliverable's task list —
   * the server's own answer (PostgREST computed column `can_approve_tasks`), the same predicate the
   * RPC raises on, so the "Approve task list" button is offered to exactly whom the RPC will admit
   * and never the account manager. Read only on the detail query; absent elsewhere reads as false.
   */
  canApproveTasks: boolean
  /** ADR-0086 d.8: what kind of campaign this sits under. Null on ad-hoc work, which has none. */
  campaignKind: 'single_job' | 'campaign' | null
  /** ADR-0099 d.1 (I56.3): the group this sits in, or NULL. Ungrouped is a normal, permanent
   *  state — grouping is optional — so nothing may treat null here as work half-set-up. */
  workstreamId: string | null
  /** I56.9: the per-campaign code, `DA-017`. Read on the campaign list only; absent elsewhere. */
  code?: string | null
  /**
   * The task list itself, in its order — what the owner reads before accepting it (ADR-0100 d.2).
   * Live tasks only: a cancelled one is not part of what is being agreed to. Read on the campaign
   * list only, where the department tab offers the acceptance; absent elsewhere.
   */
  taskList?: CampaignTask[]
  /** I57.5 (CG-01): where the piece runs and in which language — the grid's Channel and Languages.
   *  Read on the campaign list only. */
  channel?: string | null
  /** ADR-0132 d.2: the piece's brief lines — the brief's own words kept against it (`deliverables.notes`). */
  notes?: string | null
  /** ADR-0117 addendum (Q18, 4 Oct): the languages this deliverable is made in — its campaign's, plus any of its own. */
  languages?: string[]
}

/**
 * One task on a campaign piece, as the grid and the piece drawer show it (I57.5 / CG-04). Every task
 * carries its OWN assignee: the owner is the lead accountable for the piece, and the work is split
 * across people (Edward, 24 Sep — "all tasks and assignees should be displayed").
 */
export interface CampaignTask {
  id: string
  title: string
  hours: number | null
  status: SubTaskStatus
  assigneeName: string | null
  startsAt: string | null
  dueAt: string | null
  /** I57.45 (Edward, 26 Sep): the owner's free-text notes for whoever does it — `sub_tasks.description`. */
  notes?: string | null
}

/**
 * ADR-0090 d.3b: a held task is unassigned, but it is not yet work anybody should assign — the
 * owner has not approved the list. The surfaces that count unassigned work label these separately,
 * naming the owner.
 *
 * **ADR-0100 d.2 (23 Sep): every kind of work, not only single jobs.** The `campaignKind` test
 * came out with the fork it belonged to — a campaign deliverable's gate used to be its
 * department's brief, so its `tasks_approved_at` stayed null for ever and "held" would have been
 * true of all of it. It is the real gate now.
 *
 * Ad-hoc work (no campaign) is never held: it hangs off a job and this gate was never about it
 * (ADR-0090 d.6).
 */
export function isHeldForOwnerReview(row: Pick<DeliverableRow, 'campaignKind' | 'tasksApprovedAt'>): boolean {
  return row.campaignKind !== null && row.tasksApprovedAt === null
}

/** Read `kind`, `tasks_approved_at` and `tasks_approved_by` off a `*` row; absent means the migration has not landed. */
function heldColumns(row: Record<string, unknown>) {
  return {
    workstreamId: typeof row.workstream_id === 'string' ? row.workstream_id : null,
    tasksApprovedAt: typeof row.tasks_approved_at === 'string' ? row.tasks_approved_at : null,
    tasksApprovedBy: typeof row.tasks_approved_by === 'string' ? row.tasks_approved_by : null,
    // Only the detail query selects the computed column; a query that does not carries false, which
    // is correct — those surfaces do not offer the button.
    canApproveTasks: row.can_approve_tasks === true,
  }
}

function kindOf(campaign: unknown): 'single_job' | 'campaign' {
  const c = Array.isArray(campaign) ? campaign[0] : campaign
  return (c as { kind?: unknown } | null)?.kind === 'single_job' ? 'single_job' : 'campaign'
}

export interface SubTaskRow {
  id: string
  deliverableId: string
  /** The task's review round — 0 until a version has been handed in and sent back once. Optional so
   *  hand-built rows in tests stay valid; the detail read always sets it. */
  revisionRound?: number
  title: string
  description: string | null
  assigneeId: string | null
  assigneeName: string | null
  departmentId: string | null
  teamId: string | null
  slaHours: number | null
  slaProfileId: string | null
  slaProfileName: string | null
  slaProfileHours: number | null
  startsAt: string | null
  dueAt: string | null
  /** ADR-0075 d.3: the deadline committed to at assignment; `dueAt` is the plan (ADR-0088 d.1). */
  committedDueAt: string | null
  status: SubTaskStatus
  scheduleOverridden: boolean
  /** ADR-0052 d.14: presentation order. Null on a hand-added task — it has no workflow step, so it
   *  sorts after the template's steps (`orderTasks`). Never a date and never derived from one. */
  sortOrder: number | null
  /** The tie-break under `sortOrder`, so hand-added tasks read oldest-first. */
  createdAt: string | null
  /** ADR-0043: everyone appointed to review this task, with their own verdict. Empty for an
   *  unassigned task, which needs no reviewer yet. */
  reviewers: TaskReviewer[]
  /** ADR-0059: `digital` submits a file, `manual` submits a written account of physical work.
   *  Stamped from the workflow step at materialisation, overridable by anyone who can assign. */
  reviewMode: ReviewMode
}

export interface DeliverableDetail extends DeliverableRow {
  subTasks: SubTaskRow[]
  /** I53.15: the project's name, so every task row can say which project it belongs to — a task
   *  title is "step — deliverable n" and twelve projects can each have a Static Post. */
  campaignName?: string | null
  /** I51.1: who made it and who last changed it. Optional only so the page's many
   *  `{ ...row, subTasks }` fixtures stay valid; the mapper always sets them. */
  createdAt?: string | null
  updatedAt?: string | null
  createdByName?: string | null
  updatedByName?: string | null
  /** The campaign's go-live, for the extension arithmetic (ADR-0088 d.7). Null on ad-hoc work. */
  goLiveAt: string | null
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

/**
 * How much of a deliverable's work nobody is on (ADR-0052 d.11).
 *
 * Counted over LIVE tasks only — a cancelled task is settled, and a done one was done by somebody.
 * This is what makes ADR-0052 d.5 tolerable: laying a whole task list down at once is only safe if
 * the tasks nobody picked up are visible, otherwise "planned" and "forgotten" look identical.
 */
/** The task columns both list reads select, so the two cannot drift apart (I40.22). */
interface TaskRowRaw {
  id: string
  assignee_id: string | null
  status: SubTaskStatus
  /** Selected by the campaign list only, for the task list an owner accepts. */
  title?: string
  sort_order?: number | null
  /** I57.25: units of one step share a sort_order ("Create Artwork 1", "… 2"); this orders them. */
  unit_index?: number | null
  sla_hours?: number | null
  starts_at?: string | null
  due_at?: string | null
  description?: string | null
  assignee: { display_name: string } | { display_name: string }[] | null
  assigner: { display_name: string } | { display_name: string }[] | null
}

const taskPeople = (rows: TaskRowRaw[] | null) =>
  (rows ?? []).map((r) => ({
    id: r.id,
    status: r.status,
    assigneeName: (Array.isArray(r.assignee) ? r.assignee[0] : r.assignee)?.display_name ?? null,
    assignerName: (Array.isArray(r.assigner) ? r.assigner[0] : r.assigner)?.display_name ?? null,
  }))

function countTasks(rows: { assignee_id: string | null; status: SubTaskStatus }[] | null) {
  const counted = (rows ?? []).filter((r) => r.status !== 'cancelled')
  const live = counted.filter((r) => r.status !== 'done')
  return {
    taskCount: live.length,
    unassignedCount: live.filter((r) => !r.assignee_id).length,
    taskTotal: counted.length,
    doneCount: counted.filter((r) => r.status === 'done').length,
  }
}

// ---- Reads (tenant-wide under RLS) ----

/**
 * ADR-0096 d.12: a campaign's phases, for the Pipeline and schedule filters. The same read the
 * campaign feature makes, under the SAME query key (`campaign-phases`) so one invalidation reaches
 * both — kept here rather than imported across the feature boundary (AGENTS.md §4).
 */
export function useCampaignPhaseOptions(campaignId: string | null) {
  return useQuery({
    queryKey: ['campaign-phases', campaignId ?? ''] as const,
    enabled: Boolean(campaignId),
    queryFn: async (): Promise<{ id: string; number: number; name: string; startsOn: string; endsOn: string }[]> => {
      const { data, error } = await supabaseUntyped
        .from('campaign_phases')
        .select('id, number, name, starts_on, ends_on')
        .eq('campaign_id', campaignId!)
        .order('number')
      if (error) throw error
      return ((data ?? []) as Record<string, any>[]).map((r) => ({ id: r.id, number: r.number, name: r.name, startsOn: r.starts_on, endsOn: r.ends_on }))
    },
  })
}

/** Deliverables under a campaign (via their streams), newest first. */
export function useCampaignDeliverables(campaignId: string | null) {
  return useQuery({
    queryKey: deliverableKeys.byCampaign(campaignId ?? 'none'),
    // I52.9 (Edward, 17 Sep): the campaign page's rings went stale for as long as the page stayed
    // open — a task added in another tab or by a colleague never appeared. Re-read when the tab is
    // looked at again and on a short clock while it is open; the update-bar pattern.
    refetchOnWindowFocus: true,
    refetchInterval: 20_000,
    enabled: !!campaignId,
    queryFn: async (): Promise<DeliverableRow[]> => {
      const { data: raw, error } = await supabaseUntyped
        .from('deliverables')
        .select(// `deliverable_types(name_en)` is a LEFT embed on purpose. Written `!inner` it would silently
        // drop every untyped deliverable from this list — and ADR-0051 d.7 makes untyped a legal,
        // permanent state, so that would hide real work rather than tidy the table. Asserted in
        // DeliverablesPage.test.tsx rather than left as a comment (d.8).
        //
        // `*` for the row's own columns since ADR-0090: `tasks_approved_at`/`_by` arrive with the
        // database half of I44 and the static select guard cannot see them until the types
        // regenerate. Narrow this back to the named list then.
        // `can_approve_tasks` is a COMPUTED column, so `*` does not bring it — it has to be named.
        // The campaign page needs it per row since ADR-0100 d.2: the department tab now offers each
        // owner their own task lists to accept, and a tick the server would refuse is a dead end.
        '*, can_approve_tasks, departments(name), deliverable_types(name_en), ' +
        // The FK is NAMED. `deliverables` has TWO foreign keys to `user_profiles` (owner and the
        // legacy reviewer), and PostgREST answers an ambiguous embed with an EMPTY result rather
        // than an error — it reads as "no data" (docs/memory/traps.md).
        'owner:user_profiles!deliverables_owner_user_id_fkey(display_name), ' +
        // title / sort_order / sla_hours: the department tab shows the task list an owner is being
        // asked to accept (ADR-0100 d.2) — read here rather than one read per deliverable.
        'sub_tasks(id, assignee_id, status, title, sort_order, unit_index, sla_hours, starts_at, due_at, description, ' +
          // Named constraint: sub_tasks reaches user_profiles by SIX foreign keys, and an
          // unresolvable embed comes back EMPTY rather than erroring (traps.md).
          'assignee:user_profiles!sub_tasks_assignee_id_fkey(display_name), ' +
          'assigner:user_profiles!sub_tasks_assigned_by_fkey(display_name)), ' +
          'streams!inner(id, name, campaign_id)')
        .eq('streams.campaign_id', campaignId!)
        // `id` breaks the tie: pieces written in one statement share `created_at`, and without it
        // the page reshuffled whenever one row changed (24 Sep, approving a task list).
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
      if (error) throw error
      // ADR-0090 d.6: whether the held label applies at all depends on the campaign's kind — one
      // small read for the whole list rather than the campaign row embedded on every deliverable.
      const kindRes = await supabaseUntyped.from('campaigns').select().eq('id', campaignId!).maybeSingle()
      if (kindRes.error) throw kindRes.error
      const campaignKind = kindOf(kindRes.data)
      const rows = (raw ?? []) as unknown as ({
        id: string; name: string; state: DeliverableState; due_at: string | null
        revision_round: number; revision_limit: number | null
        owner: { display_name: string } | { display_name: string }[] | null
        department_id: string | null
        owner_user_id: string | null
        deliverable_type_id: string | null
        sub_tasks: TaskRowRaw[] | null
        departments: { name: string } | { name: string }[] | null
        deliverable_types: { name_en: string } | { name_en: string }[] | null
        streams: { id: string; name: string; campaign_id: string } | null
      } & Record<string, unknown>)[]
      // I40.22 — ONE batched read of the reviewers across every task on the page, so the list can
      // name who is blocking a task in review. Batched deliberately: per-deliverable would be N+1
      // down the list, the same trap `campaign_list_rows` exists to avoid on /campaigns.
      const reviewersByTask = await fetchTaskReviewers(
        rows.flatMap((d) => (d.sub_tasks ?? []).map((st) => st.id)),
      )
      return rows.map((d) => {
        const s = d.streams
        return {
          id: d.id,
          name: d.name,
          state: d.state,
          dueAt: d.due_at,
          priority: priorityOf((d as { priority?: unknown }).priority),
          revisionRound: d.revision_round,
          revisionLimit: d.revision_limit,
          streamId: s?.id ?? null,
          streamName: s?.name ?? null,
          ownerUserId: d.owner_user_id,
          // I34.7: the owner had an id here and no name anywhere, so no surface could say who is
          // accountable for a deliverable. The embed NAMES its constraint — `deliverables` has two
          // FKs to `user_profiles` (owner and the legacy reviewer), and an unnamed embed comes back
          // EMPTY rather than as an error (docs/memory/traps.md).
          ownerName: one(d.owner)?.display_name ?? null,
          typeName: one(d.deliverable_types)?.name_en ?? null,
          deliverableTypeId: d.deliverable_type_id ?? null,
          quantity: typeof d.quantity === 'number' ? d.quantity : 1,
          phaseId: typeof d.phase_id === 'string' ? d.phase_id : null,
          ...countTasks(d.sub_tasks),
          progress: workProgress(d.sub_tasks, d.state),
          assigneeNames: assigneeNamesOf(taskPeople(d.sub_tasks)),
          assignerNames: assignerNamesOf(taskPeople(d.sub_tasks)),
          blockingReviewers: blockingReviewerNamesOf(taskPeople(d.sub_tasks), reviewersByTask),
          discipline: one(d.departments)?.name ?? null,
          departmentId: d.department_id,
          campaignId: s?.campaign_id ?? null,
          approvedVersion: null,
          ...heldColumns(d),
          campaignKind,
          code: typeof d.code === 'string' ? d.code : null,
          taskList: (d.sub_tasks ?? [])
            .filter((st) => st.status !== 'cancelled')
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.unit_index ?? 0) - (b.unit_index ?? 0) || a.id.localeCompare(b.id))
            .map((st) => ({
              id: st.id,
              title: st.title ?? '',
              hours: st.sla_hours ?? null,
              status: st.status,
              assigneeName: (Array.isArray(st.assignee) ? st.assignee[0] : st.assignee)?.display_name ?? null,
              startsAt: st.starts_at ?? null,
              dueAt: st.due_at ?? null,
              notes: st.description?.trim() || null,
            })),
          channel: typeof d.channel === 'string' ? d.channel : null,
          notes: typeof d.notes === 'string' ? d.notes : null,
          languages: Array.isArray(d.languages) ? (d.languages as unknown[]).filter((x): x is string => typeof x === 'string') : [],
        }
      })
    },
  })
}

/**
 * APPROVED ad-hoc deliverables (no campaign/stream), newest first — the read-only archive behind the
 * Ad-hoc tab. It is deliberately not "all ad-hoc work": open ad-hoc tasks belong on My Work, where
 * they can be acted on. Named for what it returns, since the previous name promised the whole set.
 */
/**
 * ALL ad-hoc deliverables (stream_id null), live and finished alike.
 *
 * It used to hard-filter to `approved`, which made the Ad-hoc tab an archive of finished work: work
 * in flight was invisible there, and since ad-hoc work is created on the schedule rather than here,
 * there was nowhere on this page to see or manage it at all (Edward, 26 Aug). The caller splits
 * live from complete — see `isDeliverableComplete`.
 */
export function useAdhocDeliverables() {
  return useQuery({
    queryKey: [...deliverableKeys.all, 'adhoc', 'all'] as const,
    // I52.15 (Edward, 17 Sep: makers press Start and Submit and the lead's open page still says
    // "Not started"): the lists people leave open re-read when looked at and on a short clock —
    // the same policy as the campaign page's rings (I52.9).
    refetchOnWindowFocus: true,
    refetchInterval: 20_000,
    queryFn: async (): Promise<DeliverableRow[]> => {
      // Every page (I59.35): ad-hoc work is never archived off this list, so it only grows.
      const raw = await allRows((a, b) => supabaseUntyped
        .from('deliverables')
        // media_records has exactly one FK to deliverables, so this embed is unambiguous (the
        // three-FK footgun is sub_tasks→user_profiles, not this one). One query, no N+1.
        // I40.22: `sub_tasks` joined here for the first time. Without it the Ad-hoc tab could only ever
        // say what the container was called — every count was hard-zero and no status was derivable.
        .select('id, name, state, due_at, priority, revision_round, revision_limit, stream_id, ' +
          'owner:user_profiles!deliverables_owner_user_id_fkey(display_name), owner_user_id, ' +
          'sub_tasks(id, assignee_id, status, ' +
          'assignee:user_profiles!sub_tasks_assignee_id_fkey(display_name), ' +
          'assigner:user_profiles!sub_tasks_assigned_by_fkey(display_name)), media_records(version)')
        .is('stream_id', null)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(a, b))
      const rows = raw as unknown as {
        id: string; name: string; state: DeliverableState; due_at: string | null
        revision_round: number; revision_limit: number | null
        stream_id: string | null
        owner_user_id: string | null
        owner: { display_name: string } | { display_name: string }[] | null
        sub_tasks: TaskRowRaw[] | null
        media_records: { version: number }[] | null
      }[]
      // I40.22 — ONE batched read of the reviewers across every task on the page, so the list can
      // name who is blocking a task in review. Batched deliberately: per-deliverable would be N+1
      // down the list, the same trap `campaign_list_rows` exists to avoid on /campaigns.
      const reviewersByTask = await fetchTaskReviewers(
        rows.flatMap((d) => (d.sub_tasks ?? []).map((st) => st.id)),
      )
      return rows.map((d) => {
        return {
          id: d.id,
          name: d.name,
          state: d.state,
          dueAt: d.due_at,
          priority: priorityOf((d as { priority?: unknown }).priority),
          revisionRound: d.revision_round,
          revisionLimit: d.revision_limit,
          streamId: d.stream_id,
          streamName: null,
          ownerUserId: d.owner_user_id,
          ownerName: (Array.isArray(d.owner) ? d.owner[0] : d.owner)?.display_name ?? null,
          typeName: null,
          ...countTasks(d.sub_tasks),
          progress: workProgress(d.sub_tasks, d.state),
          assigneeNames: assigneeNamesOf(taskPeople(d.sub_tasks)),
          assignerNames: assignerNamesOf(taskPeople(d.sub_tasks)),
          blockingReviewers: blockingReviewerNamesOf(taskPeople(d.sub_tasks), reviewersByTask),
          discipline: null,
          departmentId: null,
          campaignId: null,
          // Ad-hoc work hangs off a job, not a campaign, so it is never in a workstream.
          workstreamId: null,
          approvedVersion: d.media_records?.length
            ? Math.max(...d.media_records.map((m) => m.version))
            : null,
          // Ad-hoc work has no campaign, so it can never be held for an owner's review.
          tasksApprovedAt: null,
          tasksApprovedBy: null,
          canApproveTasks: false,
          campaignKind: null,
        }
      })
    },
  })
}

/** One deliverable with its sub-tasks (each with the assignee's display name). */
export function useDeliverable(deliverableId: string | null) {
  return useQuery({
    queryKey: deliverableKeys.detail(deliverableId ?? 'none'),
    enabled: !!deliverableId,
    // I52.15 (Edward, 17 Sep: makers press Start and Submit and the lead's open page still says
    // "Not started"): the lists people leave open re-read when looked at and on a short clock —
    // the same policy as the campaign page's rings (I52.9).
    refetchOnWindowFocus: true,
    refetchInterval: 20_000,
    queryFn: async (): Promise<DeliverableDetail | null> => {
      const { data: raw, error } = await supabaseUntyped
        .from('deliverables')
        .select(
          // ADR-0090 / ADR-0086: `tasks_approved_at/_by` and `campaigns.kind` are declared by the I44
          // migrations (`20260911130000`, `20260911130100`), so they are named here rather than read via `*`.
          // I51.1: `created_by` / `updated_by` are ids with no foreign key (lib/users/user-names.ts
          // says why); they are named in a second flat read below.
          'id, name, state, due_at, priority, revision_round, revision_limit, stream_id, owner_user_id, department_id, tasks_approved_at, tasks_approved_by, can_approve_tasks, created_at, updated_at, created_by, updated_by, ' +
            'departments(name), streams(id, name, campaign_id, campaigns(name, go_live_at, kind)), ' +
            'sub_tasks(id, deliverable_id, title, description, assignee_id, department_id, team_id, sla_hours, sla_profile_id, starts_at, due_at, committed_due_at, status, schedule_overridden, sort_order, created_at, review_mode, revision_number, assignee:user_profiles!sub_tasks_assignee_id_fkey(display_name), sla_profiles(name, turnaround_hours))',
        )
        .eq('id', deliverableId!)
        .maybeSingle()
      if (error) throw error
      if (!raw) return null
      const who = await fetchUserNames([(raw as { created_by?: string | null }).created_by, (raw as { updated_by?: string | null }).updated_by])
      const d = raw as unknown as {
        id: string; name: string; state: DeliverableState; due_at: string | null
        revision_round: number; revision_limit: number | null; stream_id: string | null
        owner_user_id: string | null; department_id: string | null
        departments: { name: string } | { name: string }[] | null
        streams: { id: string; name: string; campaign_id: string; campaigns: CampaignBits | CampaignBits[] | null } | null
        sub_tasks: {
          id: string; deliverable_id: string; title: string; description: string | null
          assignee_id: string | null; department_id: string | null; team_id: string | null
          sla_hours: number | null; sla_profile_id: string | null; starts_at: string | null; due_at: string | null
          committed_due_at: string | null
          status: SubTaskStatus; schedule_overridden: boolean
          sort_order: number | null; created_at: string | null; review_mode: ReviewMode | null
          revision_number: number | null
          assignee: { display_name: string } | { display_name: string }[] | null
          sla_profiles: { name: string; turnaround_hours: number | null } | { name: string; turnaround_hours: number | null }[] | null
        }[] | null
      }
      const s = d.streams
      // ADR-0043 d.8: the task table names the reviewers a task in review is still waiting for.
      const reviewersByTask = await fetchTaskReviewers((d.sub_tasks ?? []).map((st) => st.id))
      return {
        id: d.id,
        name: d.name,
        state: d.state,
        dueAt: d.due_at,
        priority: priorityOf((d as { priority?: unknown }).priority),
        revisionRound: d.revision_round,
        revisionLimit: d.revision_limit,
        streamId: d.stream_id,
        streamName: s?.name ?? null,
        // The detail read fetches every task, so this is the fullest answer of the three.
        progress: workProgress(d.sub_tasks, d.state),
        assigneeNames: assigneeNamesOf(taskPeople(d.sub_tasks as unknown as TaskRowRaw[])),
        assignerNames: assignerNamesOf(taskPeople(d.sub_tasks as unknown as TaskRowRaw[])),
        blockingReviewers: blockingReviewerNamesOf(
          taskPeople(d.sub_tasks as unknown as TaskRowRaw[]), reviewersByTask),
        ownerUserId: d.owner_user_id,
        // Not embedded on the DETAIL read: the surfaces that show a name are the campaign page
        // and the pipeline, both of which use the list query above. Null here is honest.
        ownerName: null,
        departmentId: d.department_id,
        typeName: null,
        taskCount: 0,
        unassignedCount: 0,
        taskTotal: 0,
        doneCount: 0,
        discipline: one(d.departments)?.name ?? null,
        campaignId: s?.campaign_id ?? null,
        campaignName: one(s?.campaigns)?.name ?? null,
        goLiveAt: one(s?.campaigns)?.go_live_at ?? null,
        approvedVersion: null,
        ...heldColumns(d as unknown as Record<string, unknown>),
        // No stream means ad-hoc, which has no campaign and no kind.
        campaignKind: s ? kindOf(s.campaigns) : null,
        createdAt: (d as { created_at?: string | null }).created_at ?? null,
        updatedAt: (d as { updated_at?: string | null }).updated_at ?? null,
        createdByName: who.get((d as { created_by?: string | null }).created_by ?? '') ?? null,
        updatedByName: who.get((d as { updated_by?: string | null }).updated_by ?? '') ?? null,
        // ADR-0052 d.14: `sort_order nulls last, created_at`. Ordered here, once, so every reader
        // of the detail sees the same list — the reorder control writes the order back through
        // `resequence_deliverable_tasks` and reads it again from exactly this path.
        subTasks: orderTasks((d.sub_tasks ?? []).map((st) => ({
          id: st.id,
          deliverableId: st.deliverable_id,
          title: st.title,
          description: st.description,
          assigneeId: st.assignee_id,
          assigneeName: one(st.assignee)?.display_name ?? null,
          departmentId: st.department_id,
          teamId: st.team_id,
          slaHours: st.sla_hours,
          slaProfileId: st.sla_profile_id,
          slaProfileName: one(st.sla_profiles)?.name ?? null,
          slaProfileHours: one(st.sla_profiles)?.turnaround_hours ?? null,
          startsAt: st.starts_at,
          dueAt: st.due_at,
          committedDueAt: st.committed_due_at ?? null,
          revisionRound: st.revision_number ?? 0,
          status: st.status,
          scheduleOverridden: st.schedule_overridden,
          sortOrder: st.sort_order,
          createdAt: st.created_at,
          reviewers: reviewersByTask.get(st.id) ?? [],
          // Defaulted rather than trusted: the column is NOT NULL in the database, but this row
          // also arrives from `supabaseUntyped`, so a null here would mean the select list drifted
          // rather than that the task has no mode.
          reviewMode: toReviewMode(st.review_mode),
        }))),
      }
    },
  })
}

/**
 * ADR-0090 d.4: the owner approves the generated task list. Authority is the deliverable's
 * `owner_user_id`, or `deliverable_owner:manage` within scope — decided by the RPC from the row
 * and from grants, never here. Idempotent on the server; the button simply disappears.
 */
export function useApproveDeliverableTasks() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (deliverableId: string): Promise<void> => {
      const { error } = await supabaseUntyped.rpc('approve_deliverable_tasks', { p_deliverable: deliverableId })
      if (error) throw error
    },
    onSuccess: (_r, deliverableId) => {
      void qc.invalidateQueries({ queryKey: deliverableKeys.detail(deliverableId) })
      invalidateTaskViews(qc)
    },
  })
}

/**
 * ADR-0090 d.7 / ADR-0084 d.8: the "what could stop this" text from SJ-03, read off the single
 * job's brief for this department. A reminder to attach the real dependency to the right task —
 * shown above the list, never itself a dependency. Null where there is no such brief or no text.
 */
export function useTaskListReminder(campaignId: string | null, departmentId: string | null) {
  return useQuery({
    queryKey: [...deliverableKeys.all, 'task-list-reminder', campaignId ?? 'none', departmentId ?? 'none'] as const,
    enabled: Boolean(campaignId && departmentId),
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabaseUntyped
        .from('campaign_briefs')
        .select('values')
        .eq('campaign_id', campaignId!)
        .eq('department_id', departmentId!)
        // Any template since SJ-v3-01 (22 Sep) — the job and the department name the row.
        .maybeSingle()
      if (error) throw error
      const values = (data as { values?: Record<string, unknown> } | null)?.values
      const text = values?.[RISK_KEY]
      return typeof text === 'string' && text.trim() ? text : null
    },
  })
}

/**
 * SJ-v3 (22 Sep): the dos and don'ts the job carries — the client's profile rules and the
 * campaign's, snapshotted into the brief at release. Read beside the task list so the department
 * sees exactly what the account manager saw. Empty where the brief predates the snapshot.
 */
export function useTaskListRules(campaignId: string | null, deliverableId: string | null) {
  return useQuery({
    queryKey: [...deliverableKeys.all, 'task-list-rules', campaignId ?? 'none', deliverableId ?? 'none'] as const,
    enabled: Boolean(campaignId),
    queryFn: async (): Promise<ClientRule[]> => {
      // Edward, 27 Sep: a task sits under a deliverable, which carries the owner and the owner's
      // department — so a department brief is found by the DELIVERABLE's department.
      let departmentId: string | null = null
      if (deliverableId) {
        const d = await supabaseUntyped.from('deliverables').select('department_id').eq('id', deliverableId).maybeSingle()
        if (d.error) throw d.error
        departmentId = (d.data as { department_id: string | null } | null)?.department_id ?? null
      }
      if (departmentId) {
        const { data, error } = await supabaseUntyped
          .from('campaign_briefs')
          .select('values')
          .eq('campaign_id', campaignId!)
          .eq('department_id', departmentId)
          .maybeSingle()
        if (error) throw error
        const values = (data as { values?: Record<string, unknown> } | null)?.values
        // A single job's brief carries the snapshot taken at release (the client's rules in it).
        if (values && RULES_KEY in values) return parseRules(values[RULES_KEY])
      }
      // Edward, 27 Sep: "both campaign and client rules should display when they are available".
      // A campaign has no department brief since ADR-0100: its own rules on the campaign's brief,
      // then its client's (the profile's), read live.
      const c = await supabaseUntyped.from('campaigns').select('brief, clients(profile)').eq('id', campaignId!).maybeSingle()
      if (c.error) throw c.error
      const row = c.data as { brief?: { rules?: unknown } | null; clients?: { profile?: { rules?: unknown } | null } | { profile?: { rules?: unknown } | null }[] | null } | null
      const client = Array.isArray(row?.clients) ? row?.clients[0] : row?.clients
      return [...normalizeRules(row?.brief?.rules), ...normalizeRules(client?.profile?.rules)]
    },
  })
}

/** Campaign options for the surface's campaign picker (kept here so the feature never imports
 *  another feature's api internals). */
export interface CampaignOption {
  id: string
  name: string
}
/** ADR-0067: drafts are excluded — one has no deliverables, so filtering this surface by it
 *  would return an empty list and look like a bug rather than an unfinished brief. */
export function useCampaignOptions() {
  return useQuery({
    queryKey: [...deliverableKeys.all, 'campaign-options'],
    queryFn: async (): Promise<CampaignOption[]> => {
      // Every page (I59.35): 882 non-draft campaigns locally on 25 Sep, and only growing.
      return allRows<CampaignOption>((a, b) =>
        supabaseUntyped
          .from('campaigns')
          .select('id, name')
          .neq('status', 'draft')
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .range(a, b))
    },
  })
}

/** People a sub-task can be assigned to. Carries each person's org placement so assigning a
 *  sub-task can stamp department_id/team_id (derive-don't-ask) — which the scope RLS reads. */
export interface AssignableUser {
  id: string
  name: string
  departmentId: string | null
  teamId: string | null
  /** The person's role scope, where the query reads it (owner candidates). Lets a picker tell a
   *  department lead ('department') from a team lead ('team') — ADR-0083 d.12. */
  scope?: string | null
}
/**
 * Change who owns a deliverable (ADR-0055, I22.4).
 *
 * The RPC adds no authority of its own — `app.tg_deliverable_owner_guard` decides, so a direct
 * PATCH is governed identically and this is ergonomics, not enforcement. Both the outgoing and
 * incoming owner are notified by trigger; the caller is not, since they just did it.
 */
/** I52.13: rename a deliverable on its campaign or job. The trigger decides who may
 *  (`app.tg_deliverable_name_guard`); task titles composed from the old name do not follow. */
export function useRenameDeliverable() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ deliverableId, name }: { deliverableId: string; name: string }) => {
      const { error } = await supabaseUntyped.rpc('rename_deliverable', { p_deliverable: deliverableId, p_name: name })
      if (error) throw error
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: deliverableKeys.detail(v.deliverableId) })
      void qc.invalidateQueries({ queryKey: deliverableKeys.all })
    },
  })
}

export function useReassignDeliverable() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ deliverableId, ownerUserId }: { deliverableId: string; ownerUserId: string | null }) => {
      const { error } = await supabaseUntyped.rpc('reassign_deliverable', {
        p_deliverable: deliverableId,
        p_owner: ownerUserId,
      })
      if (error) throw error
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: deliverableKeys.detail(v.deliverableId) })
      void qc.invalidateQueries({ queryKey: deliverableKeys.all })
    },
  })
}

/**
 * Who may OWN a campaign deliverable (ADR-0083 d.9, held by `app.tg_deliverable_owner_is_a_lead`):
 * an active person whose ROLE reaches beyond themselves — `roles.scope <> 'self'`, read from the
 * scope model and never from a role's name (ADR-0074). A team member is `self`; a department lead,
 * a team lead, a deputy, the account manager and Traffic are not. Owning is not being booked, so
 * no calendar row is required here, unlike `useAssignableUsers`.
 *
 * This narrows what the two owner pickers OFFER (the wizard's, and Change owner on a deliverable);
 * the trigger is what refuses. A picker that offered a team member would be offering a 42501.
 */
/** A person's department's production switch, as PostgREST embeds it (object, array, or null). */
type DeptFlag = { is_production: boolean | null } | { is_production: boolean | null }[] | null
/** ADR-0115: true unless the person's department exists and is switched off. */
const takesWork = (d: DeptFlag) => (Array.isArray(d) ? d[0] : d)?.is_production !== false

export function useDeliverableOwnerCandidates() {
  return useQuery({
    queryKey: [...deliverableKeys.all, 'owner-candidates'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AssignableUser[]> => {
      const { data, error } = await supabaseUntyped
        .from('user_profiles')
        .select('id, display_name, department_id, team_id, roles!inner(scope), departments(is_production)')
        .eq('is_active', true)
        .neq('roles.scope', 'self')
        .order('display_name')
      if (error) throw error
      const leaving = await fetchLeavingIds()   // ADR-0133 d.1: nobody Leaving is offered for new work.
      // ADR-0115 d.3: nobody from a department that takes no production work owns a piece.
      return ((data ?? []) as { id: string; display_name: string; department_id: string | null; team_id: string | null; roles: { scope: string } | { scope: string }[] | null; departments: DeptFlag }[])
        .filter((u) => takesWork(u.departments) && !leaving.has(u.id))
        .map(
        (u) => ({
          id: u.id,
          name: u.display_name,
          departmentId: u.department_id,
          teamId: u.team_id,
          scope: (Array.isArray(u.roles) ? u.roles[0] : u.roles)?.scope ?? null,
        }),
      )
    },
  })
}

export function useAssignableUsers() {
  return useQuery({
    queryKey: [...deliverableKeys.all, 'assignable-users'],
    queryFn: async (): Promise<AssignableUser[]> => {
      // ADR-0061 d.5 — **bookable means one thing everywhere.** This is the single source for every
      // person-picker in the app (the Deliverables assignee list, the Brief Wizard owner picker and
      // the booking dialog), and it used to select `user_profiles` with NO filter at all — not the
      // resource, not even the user's own active flag. So a deactivated person, or one who never
      // had a calendar row, could be handed work that could never appear anywhere.
      //
      // Edward, 30 Aug: *"if I say they do not appear as a choice on /schedule this means they
      // cannot be selected or assigned to a task."*
      //
      // `!inner` is load-bearing: without it the embed is a LEFT join and everybody comes back.
      // `/schedule` filters the same flag, so the calendar and the assignment surfaces can no
      // longer disagree about who exists. The database refuses it too (app.person_is_bookable) —
      // this narrows the list, the guard closes the door.
      const { data, error } = await supabaseUntyped
        .from('user_profiles')
        .select('id, display_name, department_id, team_id, resources!inner(id, kind, is_active), departments(is_production)')
        .eq('is_active', true)
        .eq('resources.kind', 'human')
        .eq('resources.is_active', true)
        .order('display_name')
      if (error) throw error
      const leaving = await fetchLeavingIds()   // ADR-0133 d.1: nobody Leaving is offered for new work.
      // ADR-0115 d.3: nobody from a department that takes no production work is given a task or a booking.
      return ((data ?? []) as { id: string; display_name: string; department_id: string | null; team_id: string | null; departments: DeptFlag }[])
        .filter((u) => takesWork(u.departments) && !leaving.has(u.id))
        .map(
        (u) => ({ id: u.id, name: u.display_name, departmentId: u.department_id, teamId: u.team_id }),
      )
    },
  })
}

/** One row of the signed-in person's assigned work (Creative My Work, I2.2). A sub-task assigned
 *  to them, carrying just enough of its deliverable + campaign for triage and a deep link. */
export interface AssignedWorkItem {
  subTaskId: string
  title: string
  /** I57.45: the owner's notes on this task — anything relevant to it (Edward, 26 Sep). */
  notes?: string | null
  status: SubTaskStatus
  slaHours: number | null
  startsAt: string | null
  dueAt: string | null
  /** ADR-0075 d.3: the deadline this task was committed to at assignment. `dueAt` is the plan and
   *  may differ; ADR-0088 lets the two disagree on purpose until an extension is approved. */
  committedDueAt: string | null
  scheduleOverridden: boolean
  /** Null for a standalone ad-hoc task assigned on the scheduler (ADR-0034) — no parent deliverable. */
  deliverableId: string | null
  deliverableName: string | null
  deliverableState: DeliverableState | null
  /** The promise to the client — what an extension's arithmetic is shown against (ADR-0088 d.7). */
  deliverableDueAt: string | null
  /** The TASK's review round so far — `sub_tasks.revision_number`, which a send-back increments
   *  (ADR-0058 addendum d.13/d.17). Not the deliverable's `revision_round`: that moves only on the
   *  container's own transition, which a task-level send-back never fires (I48.33). */
  revisionRound: number
  campaignId: string | null
  campaignName: string | null
  goLiveAt: string | null
  discipline: string | null
  /** True when this is a standalone ad-hoc task (no deliverable). */
  isAdhoc: boolean
  /** Who gave this work out — half of what the assignee needs to know. */
  assignerName: string | null
  /** ADR-0043 d.8: and who will review it. Several people now, so the row names the ones who have
   *  not acted yet rather than a single "reviewed by" line that can no longer be written. */
  reviewers: TaskReviewer[]
  /** ADR-0059 d.9: which way this task submits. On the list, not only in the dialog — "why can I
   *  not upload here?" must have an answer on screen before the person opens anything. */
  reviewMode: ReviewMode
  /** I54.15: the DELIVERABLE's priority, shown as a mark on the row and used to break the tie
   *  between two tasks due the same day. Null for a standalone ad-hoc task, which has no
   *  deliverable to take one from. */
  priority: 'high' | 'medium' | 'low' | null
  /** I59.10 — when the task was given to its assignee (`sub_tasks.assigned_at`): "New on you".
   *  Optional so the hand-built fixtures stay valid; the mapper always sets it. */
  assignedAt?: string | null
  /** I59 (settled 25 Sep) — when the assignee first opened the task page or pressed Later
   *  (`sub_tasks.assignee_seen_at`, server-side, reset on reassignment). Null = not seen: "New on you". */
  seenAt?: string | null
  /** I59.10 — the deliverable's department, for the rules it carries (`useTaskListRules`). */
  departmentId?: string | null
  /** I59.11 — the deliverable type's round limit, for "Round 1 of 2". Null = no limit recorded. */
  revisionLimit?: number | null
  /** I59.11 — the hours the task was given: the committed hours, else its SLA hours. */
  allocatedHours?: number | null
  /** I59.11 — whose task it is. The task page is the assignee's; everyone else reads it. */
  assigneeId?: string | null
  /** I59.10 — the campaign's client, whose Library holds the campaign folder. */
  clientId?: string | null
}

interface AssignedWorkRaw {
  id: string
  title: string
  description: string | null
  status: SubTaskStatus
  sla_hours: number | null
  starts_at: string | null
  due_at: string | null
  committed_due_at: string | null
  schedule_overridden: boolean
  review_mode: ReviewMode | null
  revision_number: number | null
  assigned_at?: string | null
  assignee_seen_at?: string | null
  assignee_id?: string | null
  committed_hours?: number | null
  assigner: { display_name: string } | null
  deliverable: {
    id: string
    name: string
    state: DeliverableState
    due_at: string | null
    priority: unknown
    revision_round: number
    revision_limit?: number | null
    department_id?: string | null
    departments: { name: string } | { name: string }[] | null
    streams:
      | { campaign_id: string | null; campaigns: CampaignBits | CampaignBits[] | null }
      | { campaign_id: string | null; campaigns: CampaignBits | CampaignBits[] | null }[]
      | null
  } | null
}

interface CampaignBits {
  name: string
  go_live_at: string | null
  /** Absent on reads that do not select it. */
  client_id?: string | null
  /** ADR-0086 d.8. Absent on reads that do not select it. */
  kind?: 'single_job' | 'campaign' | null
}

/**
 * The columns one My Work row reads — shared by the list (`useMyAssignedWork`) and the task page
 * (`useAssignedTask`), so both show the same task the same way.
 */
const ASSIGNED_WORK_SELECT =
  'id, title, description, status, sla_hours, starts_at, due_at, committed_due_at, schedule_overridden, review_mode, revision_number, ' +
  'assigned_at, assignee_seen_at, assignee_id, committed_hours, ' +
  // sub_tasks → user_profiles has SIX foreign keys, so every embed MUST name its
  // constraint or PostgREST refuses the whole query as ambiguous (the footgun called out
  // in AGENTS/CLAUDE, and the reason the task-detail select does the same).
  'assigner:user_profiles!sub_tasks_assigned_by_fkey(display_name), ' +
  // LEFT join (no !inner): standalone ad-hoc tasks have no deliverable (ADR-0034) and
  // must still appear in "Assigned to me".
  'deliverable:deliverables(id, name, state, due_at, priority, revision_round, revision_limit, department_id, departments(name), ' +
  'streams(campaign_id, campaigns(name, go_live_at, client_id)))'

/** Raw rows → `AssignedWorkItem`, with each task's reviewers (a second read, see fetchTaskReviewers). */
async function toAssignedWork(rows: AssignedWorkRaw[]): Promise<AssignedWorkItem[]> {
  // ADR-0043: the reviewer left sub_tasks for its own table, so it is a second read. See
  // fetchTaskReviewers for why it is not an embed.
  const reviewersByTask = await fetchTaskReviewers(rows.map((r) => r.id))
  return rows.map((r) => {
    const d = r.deliverable
    const s = d ? one(d.streams) : null
    return {
      subTaskId: r.id,
      title: r.title,
      notes: r.description?.trim() || null,
      status: r.status,
      slaHours: r.sla_hours,
      startsAt: r.starts_at,
      dueAt: r.due_at,
      committedDueAt: r.committed_due_at,
      scheduleOverridden: r.schedule_overridden,
      deliverableId: d?.id ?? null,
      deliverableName: d?.name ?? null,
      deliverableState: d?.state ?? null,
      deliverableDueAt: d?.due_at ?? null,
      revisionRound: r.revision_number ?? 0,
      campaignId: s?.campaign_id ?? null,
      campaignName: one(s?.campaigns)?.name ?? null,
      goLiveAt: one(s?.campaigns)?.go_live_at ?? null,
      discipline: one(d?.departments)?.name ?? null,
      isAdhoc: !d,
      assignerName: r.assigner?.display_name ?? null,
      reviewers: reviewersByTask.get(r.id) ?? [],
      reviewMode: toReviewMode(r.review_mode),
      priority: priorityOf(d?.priority) ?? null,
      assignedAt: r.assigned_at ?? null,
      seenAt: r.assignee_seen_at ?? null,
      departmentId: d?.department_id ?? null,
      revisionLimit: d?.revision_limit ?? null,
      allocatedHours: r.committed_hours ?? r.sla_hours ?? null,
      assigneeId: r.assignee_id ?? null,
      clientId: one(s?.campaigns)?.client_id ?? null,
    }
  })
}

/** The sub-tasks assigned to `userId` that are still open (todo/in_progress/blocked/review).
 *  Reads are tenant-wide under RLS (sub_tasks_tenant_select); we filter to the assignee. */
export function useMyAssignedWork(userId: string | null) {
  return useQuery({
    queryKey: [...deliverableKeys.all, 'my-work', userId ?? 'none'],
    // I52.15 (Edward, 17 Sep: makers press Start and Submit and the lead's open page still says
    // "Not started"): the lists people leave open re-read when looked at and on a short clock —
    // the same policy as the campaign page's rings (I52.9).
    refetchOnWindowFocus: true,
    refetchInterval: 20_000,
    enabled: !!userId,
    queryFn: async (): Promise<AssignedWorkItem[]> => {
      // Every page (I59.35): finished tasks stay on this read, so a maker passes 1,000 within a year.
      const raw = await allRows((a, b) =>
        supabaseUntyped
          .from('sub_tasks')
          .select(ASSIGNED_WORK_SELECT)
          .eq('assignee_id', userId!)
          .neq('status', 'cancelled')
          .order('id')
          .range(a, b))
      return toAssignedWork(raw as unknown as AssignedWorkRaw[])
    },
  })
}

/**
 * One task, as its My Work row reads it — the task page (I59.11, ADR-0105 d.3). Any task the
 * viewer can read under RLS; the page decides from `assigneeId` whether it is theirs to work on.
 * Null when there is no such task (or RLS hides it).
 */
export function useAssignedTask(subTaskId: string | null) {
  return useQuery({
    queryKey: [...deliverableKeys.all, 'task-page', subTaskId ?? 'none'],
    refetchOnWindowFocus: true,
    refetchInterval: 20_000,
    enabled: !!subTaskId,
    queryFn: async (): Promise<AssignedWorkItem | null> => {
      const { data: raw, error } = await supabaseUntyped
        .from('sub_tasks')
        .select(ASSIGNED_WORK_SELECT)
        .eq('id', subTaskId!)
        .maybeSingle()
      if (error) throw error
      if (!raw) return null
      const [item] = await toAssignedWork([raw as unknown as AssignedWorkRaw])
      return item ?? null
    },
  })
}

// ---- Mutations ----

interface FnError extends Error {
  code?: string
}

/** Invoke an Edge Function, surfacing the server's { error: { code, message } } envelope. */
async function invokeFn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    // A FunctionsHttpError carries the Response in `context`; a network/CORS failure (e.g. the
    // function isn't deployed) carries no readable body — guard `.json` so we surface the real
    // message instead of a "ctx.json is not a function" TypeError.
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      const payload = await ctx.json().catch(() => null)
      const e: FnError = Object.assign(new Error(payload?.error?.message ?? error.message), {
        code: payload?.error?.code as string | undefined,
      })
      throw e
    }
    throw error
  }
  return data as T
}

export interface TransitionArgs {
  deliverableId: string
  to: DeliverableState
  expectedState: DeliverableState
}

/** Drive a deliverable lifecycle transition (deliverable-transition Edge Function). */
export function useTransitionDeliverable() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: TransitionArgs) =>
      invokeFn<{ deliverable: { id: string; state: DeliverableState; revision_round: number } }>(
        'deliverable-transition',
        { deliverableId: args.deliverableId, to: args.to, expectedState: args.expectedState },
      ),
    onSuccess: () => invalidateTaskViews(qc),
  })
}

export interface SubTaskWriteArgs {
  id?: string
  /** Null for a standalone ad-hoc task assigned on the scheduler (ADR-0034). */
  deliverableId: string | null
  title: string
  description?: string | null
  assigneeId?: string | null
  /** ADR-0038/0043: required for live work — a task may not be assigned without at least one
   *  reviewer appointed. Null leaves the existing appointments untouched. */
  reviewers?: ReviewerAppointment[] | null
  departmentId?: string | null
  teamId?: string | null
  slaHours?: number | null
  slaProfileId?: string | null
  startsAt?: string | null
  dueAt?: string | null
  status?: SubTaskStatus
  /** ADR-0059 d.4. Undefined leaves the task's mode alone — the same convention every other
   *  optional field here uses. */
  reviewMode?: ReviewMode | null
  /**
   * ADR-0087 d.12: the schedule's dialog creates a NEW task unassigned and then assigns it through
   * `update_task_assignment`, so that giving it to an out-of-reach person becomes a request
   * rather than a refusal. An unassigned task has nothing to materialise, and running the
   * scheduler on it would report "placed nothing" as if something had gone wrong. False skips it;
   * the assignment call that follows schedules.
   */
  materialise?: boolean
}

/**
 * Create or update a sub-task **and its reviewer appointments**, then (re)materialise its schedule.
 *
 * ADR-0043 turned that into one call. It used to be a direct table write, but the reviewers now live
 * in `sub_task_reviewers`, and PostgREST puts every request in its own transaction — so writing the
 * task and then appointing its reviewers would momentarily leave an assigned, reviewer-less task,
 * which the deferred required-reviewer rule refuses at commit. `public.save_sub_task` does both
 * halves together; it is SECURITY INVOKER, so RLS still decides both writes exactly as before.
 *
 * subtask-schedule then spreads the hours into bookings on the assignee's grid — unless the
 * sub-task's schedule was hand-overridden, which it respects. Scheduling is best-effort: an
 * out-of-scope assignee surfaces as a warning, the sub-task itself still saved.
 */
/**
 * I51.7: which deliverable a task belongs to — the one read behind `/deliverables?task=<id>`, the
 * door a notification about a task opens. A notification names the task (it is what happened to);
 * the page is organised by deliverable; this bridges the two so the person lands on the row itself
 * rather than on a list to search. Null when the task is gone or out of reach.
 */
export function useDeliverableOfTask(subTaskId: string | null) {
  return useQuery({
    queryKey: [...deliverableKeys.all, 'of-task', subTaskId ?? 'none'],
    enabled: Boolean(subTaskId),
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabaseUntyped
        .from('sub_tasks')
        .select('deliverable_id')
        .eq('id', subTaskId!)
        .maybeSingle()
      if (error) throw error
      return (data as { deliverable_id: string } | null)?.deliverable_id ?? null
    },
  })
}

export function useUpsertSubTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: SubTaskWriteArgs): Promise<{ id: string; scheduleWarning?: string }> => {
      const { data, error } = await supabaseUntyped.rpc('save_sub_task', {
        p_sub_task: args.id ?? null,
        p_deliverable: args.deliverableId,
        p_title: args.title.trim(),
        p_reviewers: args.reviewers ? reviewerPayload(args.reviewers) : null,
        // Undefined or null leaves the notes alone (the RPC coalesces); an empty string CLEARS them —
        // the task list editor's way to delete a note (I57.45).
        p_description: args.description == null ? null : args.description.trim(),
        p_assignee: args.assigneeId ?? null,
        p_department: args.departmentId ?? null,
        p_team: args.teamId ?? null,
        p_sla_hours: args.slaHours ?? null,
        p_sla_profile: args.slaProfileId ?? null,
        p_starts_at: args.startsAt ?? null,
        p_due_at: args.dueAt ?? null,
        // NULL, not 'todo'. `save_sub_task` defaults an INSERT to 'todo' itself; on an UPDATE it
        // coalesces, so a caller that sends 'todo' while editing something else — a title, a date
        // (I19.9) — reopens a task in review and fires app.tg_subtask_clear_approvals, destroying a
        // mandatory reviewer's recorded verdict. The function dropped its own default for exactly
        // this reason (20260827100000:997); sending one from here put it back.
        p_status: args.status ?? null,
        // ADR-0059 d.4: NULL means "leave the mode alone", so an edit about a title or a date
        // never silently changes how the task has to be submitted.
        p_review_mode: args.reviewMode ?? null,
      })
      if (error) throw error
      const subTaskId = data as unknown as string
      // Materialise the schedule; don't fail the save if scheduling is out of scope.
      //
      // ADR-0061 d.1: the RESPONSE is read, not just the absence of a throw. `subtask-schedule`
      // answers 200 with `scheduled: 0` and a reason when it places nothing, and discarding that
      // is what let a task be created, nothing booked, and success reported.
      let scheduleWarning: string | undefined
      if (args.materialise === false) return { id: subTaskId, scheduleWarning }
      try {
        const outcome = await invokeFn<ScheduleOutcome>('subtask-schedule', { subTaskId })
        scheduleWarning = scheduleWarningKey(outcome) ?? undefined
      } catch (e) {
        scheduleWarning = (e as FnError).message
      }
      return { id: subTaskId, scheduleWarning }
    },
    onSuccess: () => {
      invalidateTaskViews(qc)
    },
  })
}

/** Delete a sub-task; its materialised bookings cascade away (bookings.sub_task_id). */
/**
 * Cancel a task. Soft by design: the row survives for the record — who cancelled what and when is
 * exactly what this system exists to keep — while the task leaves every working list and count, and
 * its bookings are released so cancelled work stops consuming somebody's capacity.
 *
 * Replaces a hard DELETE that destroyed the task outright, including any trace that it had been
 * assigned to somebody and worked on. Nothing in the app could cancel a task before this: you could
 * cancel its BOOKING, which left the work alive, owed and off every calendar.
 */
/**
 * Remove a task from a deliverable's list (ADR-0052 d.12/d.13).
 *
 * The server decides WHICH removal this is and says so: a task that was only ever a plan is
 * deleted, anything somebody was given or started is cancelled so the record survives. The caller
 * shows the returned word, rather than guessing — "deleted" and "cancelled" are different promises
 * and the surface should not make one the server did not keep.
 */
export function useRemoveSubTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (subTaskId: string): Promise<'deleted' | 'cancelled'> => {
      const { data, error } = await supabaseUntyped.rpc('remove_sub_task', { p_sub_task: subTaskId })
      if (error) throw error
      return (data as 'deleted' | 'cancelled') ?? 'cancelled'
    },
    onSuccess: () => {
      invalidateTaskViews(qc)
    },
  })
}

/**
 * Set the presentation order of a deliverable's task list (ADR-0052 d.14, I19.9).
 *
 * `p_ordered_ids` is the WHOLE list in its new order — the server assigns `sort_order` from each
 * id's position and ignores any id that does not belong to this deliverable, so a stale list from
 * another screen cannot reorder somebody else's work.
 *
 * It writes `sort_order` and nothing else. **Resequencing never reschedules** — there is no
 * `subtask-schedule` call here and there must never be one. `starts_at` and `due_at` are a
 * commitment somebody has made; rearranging a list must not quietly move it (the `I17` lesson).
 * That is also why this invalidates the deliverable keys only, and not `schedule` or `bookings`:
 * nothing on a calendar changed.
 */
export function useResequenceDeliverableTasks() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { deliverableId: string; orderedIds: string[] }): Promise<number> => {
      const { data, error } = await supabaseUntyped.rpc('resequence_deliverable_tasks', {
        p_deliverable: args.deliverableId,
        p_ordered_ids: args.orderedIds,
      })
      if (error) throw error
      return (data as number) ?? 0
    },
    onSuccess: () => {
      invalidateTaskViews(qc)
    },
  })
}

/**
 * What cancelling this task will actually cost (ADR-0068 d.2, d.3).
 *
 * Two facts the row does not carry: how many bookings will be released, and whether this is a
 * PLAN — unassigned, `todo`, never worked on — which `remove_sub_task` deletes outright rather
 * than cancelling. The dialog needs both BEFORE the click, or it promises one outcome and the
 * function delivers the other.
 *
 * Fetched on demand rather than joined into the task list: it is read once, when somebody reaches
 * for a destructive control, and putting it on every row would be two more joins on a table that
 * is scanned constantly.
 */
export interface CancelImpact {
  bookings: number
  /** True when `remove_sub_task` would DELETE this row rather than cancel it (ADR-0052 d.10). */
  isPlan: boolean
  /**
   * True for AD-HOC work, where cancelling is IRREVERSIBLE — and the dialog has to say so.
   *
   * `sub_task_cancel` archives an ad-hoc deliverable once its last live task goes (ADR-0061 d.6:
   * "an ad-hoc deliverable IS its task"), and `archived` is terminal in the transition graph
   * (ADR-0024). So `sub_task_reinstate` can return the TASK to `todo` and nothing can return the
   * job it belongs to — a live task under a dead container, which is worse than no undo at all.
   *
   * Making that reversible would mean amending ADR-0024's state machine. Edward, 3 Sep: not worth
   * it, because ad-hoc assignment is being retired — *"the warning just should be modified to
   * indicate ad-hoc tasks cannot be recovered"*. So the promise changes rather than the mechanism,
   * which is the honest way round: the dialog stops offering an undo that does not exist.
   */
  isAdhoc: boolean
}

export async function fetchCancelImpact(subTaskId: string): Promise<CancelImpact> {
  const [task, bookings, worked, logged] = await Promise.all([
    // `deliverables.stream_id` is what tells ad-hoc from campaign work — the same test
    // `sub_task_cancel` makes before it archives.
    supabaseUntyped
      .from('sub_tasks')
      .select('assignee_id, status, deliverables(stream_id)')
      .eq('id', subTaskId)
      .maybeSingle(),
    supabaseUntyped.from('bookings').select('id', { count: 'exact', head: true }).eq('sub_task_id', subTaskId),
    supabaseUntyped.from('task_time_entries').select('id', { count: 'exact', head: true }).eq('sub_task_id', subTaskId),
    // I49.67: the SLA log is a record too — a commitment stamped, a deadline moved. A task the log
    // has recorded is cancelled by Remove, never deleted (the FK would refuse the delete anyway).
    supabaseUntyped.from('sla_events').select('id', { count: 'exact', head: true }).eq('sub_task_id', subTaskId),
  ])
  if (task.error) throw task.error
  if (bookings.error) throw bookings.error
  if (worked.error) throw worked.error
  if (logged.error) throw logged.error
  const row = task.data as {
    assignee_id: string | null
    status: string
    deliverables: { stream_id: string | null } | { stream_id: string | null }[] | null
  } | null
  const deliverable = Array.isArray(row?.deliverables) ? row?.deliverables[0] : row?.deliverables
  return {
    bookings: bookings.count ?? 0,
    // The same four conditions `remove_sub_task` uses, deliberately — one definition, not two
    // that can drift apart.
    isPlan: row?.assignee_id == null && row?.status === 'todo' && (worked.count ?? 0) === 0 && (logged.count ?? 0) === 0,
    // A deliverable with no stream hangs off a job: that is ad-hoc work (ADR-0034).
    isAdhoc: deliverable != null && deliverable.stream_id == null,
  }
}

/**
 * ADR-0068 d.4: bring a cancelled task back.
 *
 * It returns UNASSIGNED and UNSCHEDULED, and the surface says so — the bookings were deleted when
 * it was cancelled and are not recreated, because the calendar may since have been given to
 * somebody else (d.5). Assigning it again is a path that already exists and that checks capacity,
 * the working week, and notifies.
 */
export function useReinstateSubTask() {
  const qc = useQueryClient()
  return useMutation({
    // I52.7: `assigning` says the caller is assigning it in the same step, so reinstate itself
    // tells nobody — the assignment that follows carries the ordinary `assigned` notification.
    // Without it, the leads in reach and the deliverable's owner are told it needs assigning.
    mutationFn: async (args: { id: string; assigning?: boolean }) => {
      const { error } = await supabaseUntyped.rpc('sub_task_reinstate', {
        p_sub_task: args.id,
        p_assigning: args.assigning ?? false,
      })
      if (error) throw error
    },
    onSuccess: () => {
      invalidateTaskViews(qc)
    },
  })
}

export function useCancelSubTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabaseUntyped.rpc('sub_task_cancel', { p_sub_task: id })
      if (error) throw error
    },
    onSuccess: () => {
      invalidateTaskViews(qc)
    },
  })
}

// ---- Ad-hoc reviewable deliverables (ADR-0035, I11) ----

/** Reviewer-picker options: users who hold reviews:moderate and can be named the reviewer of an
 *  ad-hoc deliverable (ADR-0035). Overlay-aware (ADR-0036, L6.7) — mirrors the authoritative RPC
 *  check `app.user_holds_permission(reviewer,'reviews','moderate')`: holds it via ROLE **or** a
 *  per-user allow-grant, minus a per-user deny-grant. (client_portal is naturally excluded — that
 *  role never holds reviews:moderate and the overlay is fenced from portal identities.) */
export interface ReviewerOption {
  id: string
  name: string
}
export function useReviewers() {
  return useQuery({
    queryKey: [...deliverableKeys.all, 'reviewers'] as const,
    queryFn: async (): Promise<ReviewerOption[]> => {
      // ADR-0037 (L6.11): the grant tables are private, so "who can moderate reviews?" is answered
      // by an allowlisted RPC instead of three tenant-wide reads the caller may no longer make. The
      // overlay is applied server-side (role ∪ allow − deny, via app.user_holds_permission), so a
      // reviewer granted the permission individually still appears — the L6.7 behaviour, unchanged.
      const { data, error } = await supabaseUntyped.rpc('users_holding_permission', {
        p_resource: 'reviews',
        p_action: 'moderate',
      })
      if (error) throw error
      const leaving = await fetchLeavingIds()   // ADR-0133 d.1: nobody Leaving is offered for new work.
      return withoutLeaving((data ?? []) as { id: string; name: string }[], leaving, (u) => u.id).map((u) => ({ id: u.id, name: u.name }))
    },
  })
}

/** One deliverable awaiting the signed-in reviewer's sign-off (ADR-0035, I11.3). A sub-task the
 *  assignee has submitted (status 'review') whose deliverable names me as its reviewer. Carries the
 *  deliverable's state so the panel knows when Approve is available (state must be 'in_review'). */
export interface AwaitingReviewItem {
  subTaskId: string
  title: string
  dueAt: string | null
  assigneeName: string | null
  /** Null for a standalone task (ADR-0034) — it has no deliverable, but its reviewer still sees it. */
  deliverableId: string | null
  deliverableName: string | null
  deliverableState: DeliverableState | null
  /** I53.15: the project the work sits in — null for ad-hoc. Twelve projects can each have a Static
   *  Post. Optional only so the panels' fixtures stay valid; the mapper always sets it. */
  campaignName?: string | null
  /**
   * ADR-0043: is MY appointment on this task the one that cannot be skipped? ADR-0089 d.5 makes
   * this the difference between two verbs: a required reviewer approves, an optional one answers.
   */
  mineIsMandatory: boolean
  /** Everyone appointed, so the reviewer can see who else is on it and who is still owed. */
  reviewers: TaskReviewer[]
  /** ADR-0059 d.9: a manual task shows the maker's note and a comment box, never an empty version
   *  rail — which would read as a missing file rather than work that never had one. */
  reviewMode: ReviewMode
}

/**
 * The work waiting on ME to review.
 *
 * ADR-0043 d.7 makes this **per reviewer, not per task**: a task stays in my inbox until *I*
 * personally have acted, not until somebody has. With several reviewers the old "the task is in
 * review" test would drop a task off a mandatory reviewer's list the moment a colleague agreed —
 * so the one thing gating the task would be the one thing that disappeared from the queue.
 *
 * It starts from the TASKS IN REVIEW, not from my appointments, and that direction is deliberate.
 * Asking `sub_task_reviewers` for "my rows where approved_at is null" first looks narrower and is
 * actually unbounded: on a pool task the first approval completes it and every other reviewer's row
 * stays null for ever, so that list accumulates every appointment the person never personally acted
 * on, over the life of the account, and ends up as an `in.(…)` filter long enough to blow the
 * PostgREST URL. Tasks currently in review is bounded by live work instead.
 *
 * Two reads rather than one embedded query: an embed would have to traverse a composite FK, and a
 * nested embed PostgREST cannot resolve returns EMPTY rather than an error — which reads as
 * "nothing to review" instead of "broken query" (traps.md).
 *
 * ADR-0038 still holds for the deliverable: its state is NOT a precondition. Filtering on
 * `deliverables.state = 'in_review'` is what broke campaign work, since only ad-hoc deliverables
 * were ever advanced there.
 */
export function useAwaitingMyReview(userId: string | null) {
  return useQuery({
    queryKey: [...deliverableKeys.all, 'awaiting-review', userId ?? 'none'],
    // I52.15 (Edward, 17 Sep: makers press Start and Submit and the lead's open page still says
    // "Not started"): the lists people leave open re-read when looked at and on a short clock —
    // the same policy as the campaign page's rings (I52.9).
    refetchOnWindowFocus: true,
    refetchInterval: 20_000,
    enabled: !!userId,
    queryFn: async (): Promise<AwaitingReviewItem[]> => {
      // sub_tasks has SIX FKs to user_profiles, so the assignee embed MUST name its foreign key or
      // PostgREST rejects the whole query as ambiguous — which the panel would render as an empty
      // "nothing to review" (ADR-0035 I11.3 bugfix).
      // Every page (I59.35): this is every task in review across the tenant, filtered to mine below.
      const raw = await allRows((a, b) =>
        supabaseUntyped
          .from('sub_tasks')
          .select(
            'id, title, due_at, review_mode, assignee:user_profiles!sub_tasks_assignee_id_fkey(display_name), ' +
              'deliverables(id, name, state, streams(campaigns(name)))',
          )
          .eq('status', 'review')
          .order('id')
          .range(a, b))
      const rows = raw as unknown as {
        id: string; title: string; due_at: string | null; review_mode: ReviewMode | null
        assignee: { display_name: string } | { display_name: string }[] | null
        deliverables: { id: string; name: string; state: DeliverableState; streams?: { campaigns?: { name: string } | { name: string }[] | null } | { campaigns?: { name: string } | { name: string }[] | null }[] | null } | { id: string; name: string; state: DeliverableState }[] | null
      }[]
      if (rows.length === 0) return []

      // ADR-0043 d.8: the reviewer sees who else is on it, too — "to everyone, the reviewer
      // included". A reviewer who cannot see that a mandatory colleague is still owed has no way to
      // tell whether their own Approve finishes the job.
      const reviewersByTask = await fetchTaskReviewers(rows.map((r) => r.id))

      return rows.flatMap((r) => {
        const appointed = reviewersByTask.get(r.id) ?? []
        // ADR-0043 d.7: it is MY inbox until *I* have acted, not until somebody has. ADR-0089
        // d.12: "acted" is approving for a required reviewer and ANSWERING for an optional one —
        // an optional reviewer who has answered is finished with this version.
        const mine = appointed.find((a) => a.userId === userId && isReviewerOutstanding(a, appointed))
        if (!mine) return []
        const d = one(r.deliverables)
        return [{
          subTaskId: r.id,
          title: r.title,
          dueAt: r.due_at,
          assigneeName: one(r.assignee)?.display_name ?? null,
          deliverableId: d?.id ?? null,
          deliverableName: d?.name ?? null,
          deliverableState: d?.state ?? null,
          campaignName: (() => {
            const st = one((d as { streams?: { campaigns?: unknown } | { campaigns?: unknown }[] | null } | null)?.streams ?? null)
            return one((st?.campaigns as { name: string } | { name: string }[] | null | undefined) ?? null)?.name ?? null
          })(),
          mineIsMandatory: mine.isMandatory,
          reviewers: appointed,
          reviewMode: toReviewMode(r.review_mode),
        }]
      })
    },
  })
}

export interface AdhocDeliverableArgs {
  assigneeId: string
  title: string
  hours: number
  startsAt: string
  dueAt: string
  reviewerId: string | null
}

/**
 * Create an ad-hoc reviewable deliverable (ADR-0035): the RPC makes the internal job + deliverable +
 * sub-task (with the chosen reviewer), then subtask-schedule materialises the booking on the
 * assignee's grid. Best-effort scheduling — an out-of-scope assignee surfaces as a warning, the task
 * itself still created.
 */
export function useCreateAdhocDeliverable() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: AdhocDeliverableArgs): Promise<{ subTaskId: string; scheduleWarning?: string }> => {
      const { data, error } = await supabaseUntyped.rpc('create_adhoc_deliverable', {
        p_assignee: a.assigneeId,
        p_title: a.title,
        p_hours: a.hours,
        p_starts_at: a.startsAt,
        p_due_at: a.dueAt,
        p_reviewer: a.reviewerId,
      })
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      const subTaskId = (row as { sub_task_id: string }).sub_task_id
      // ADR-0061 d.1: read the answer, not just whether it threw.
      let scheduleWarning: string | undefined
      try {
        const outcome = await invokeFn<ScheduleOutcome>('subtask-schedule', { subTaskId })
        scheduleWarning = scheduleWarningKey(outcome) ?? undefined
      } catch (e) {
        scheduleWarning = (e as FnError).message
      }
      return { subTaskId, scheduleWarning }
    },
    onSuccess: () => {
      invalidateTaskViews(qc)
    },
  })
}

// ---- Task execution (ADR-0030, I8): the assignee's Start/Submit and the reviewer's Request
// Changes. These call the public wrappers over the app.* lifecycle functions (the DB carries the
// assignee-only / reviewer-only authority and the approval gate); the client only forwards. A
// raised exception surfaces as { error: { code = SQLSTATE, message } } — components show message. ----

/** Start Task — the assignee opens the single-session timer (todo → in_progress). */
/**
 * The assignee has seen their task — opened its page, or pressed Later on "New on you" (I59, settled
 * 25 Sep: seen on the server, not per device). `mark_task_seen` stamps `sub_tasks.assignee_seen_at`
 * once and refuses anybody but the assignee; the column is not client-writable.
 */
export function useMarkTaskSeen() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (subTaskId: string) => {
      const { error } = await supabaseUntyped.rpc('mark_task_seen', { p_task: subTaskId })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: deliverableKeys.all }),
  })
}

export function useStartSubTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (subTaskId: string) => {
      const { error } = await supabaseUntyped.rpc('sub_task_start', { p_id: subTaskId })
      if (error) throw error
    },
    onSuccess: () => invalidateTaskViews(qc),
  })
}

/** Submit for review — closes the running timer (its minutes less the blocked time, ADR-0107 d.3).
 *  An UNTIMED round (never started, or sent under the tenant's threshold) is refused unless
 *  `acceptUntimed` — the maker saw the warning and sent anyway; it then records the allocation
 *  (ADR-0106 d.2/d.3). `p_manual_minutes` is kept for the signature and ignored by the server. */
export function useSubmitSubTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      subTaskId,
      manualMinutes,
      acceptUntimed,
    }: { subTaskId: string; manualMinutes?: number | null; acceptUntimed?: boolean }) => {
      const { error } = await supabaseUntyped.rpc('sub_task_submit', {
        p_id: subTaskId,
        p_manual_minutes: manualMinutes ?? null,
        p_accept_untimed: acceptUntimed === true,
      })
      if (error) throw error
    },
    onSuccess: () => invalidateTaskViews(qc),
  })
}

/**
 * Approve THIS task (ADR-0038): review → done, stamping who and when. Only the task's appointed
 * reviewer may call it; the database enforces that, not this hook. Replaces the old inbox action,
 * which approved the whole parent DELIVERABLE and never touched the task that was submitted.
 */
export function useApproveSubTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (subTaskId: string) => {
      const { error } = await supabaseUntyped.rpc('sub_task_approve', { p_sub_task: subTaskId })
      if (error) throw error
    },
    onSuccess: () => invalidateTaskViews(qc),
  })
}

/**
 * ADR-0089 d.5: an OPTIONAL reviewer says they are done with this version. One press — the server
 * derives whether it was "feedback" (they commented this round) or "no comment", stamps their own
 * row, and tells the required reviewer when it was the last answer outstanding (d.9). Refused for a
 * required reviewer, whose act is to approve.
 */
export function useRespondSubTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (subTaskId: string) => {
      const { error } = await supabaseUntyped.rpc('sub_task_respond', { p_sub_task: subTaskId })
      if (error) throw error
    },
    onSuccess: () => invalidateTaskViews(qc),
  })
}

/**
 * What `sub_task_respond` WOULD record for me right now — so the Done button can read
 * "Done — feedback left" or "Done — no comment" honestly. The same derivation the RPC uses, asked
 * of the server rather than re-implemented here (one definition of "this round"). Under
 * `deliverableKeys.all` so posting a comment, which invalidates that key, refreshes the label.
 */
export function useMyResponseKind(subTaskId: string | null) {
  return useQuery({
    queryKey: deliverableKeys.responseKind(subTaskId ?? 'none'),
    enabled: !!subTaskId,
    queryFn: async (): Promise<ReviewerResponse> => {
      const { data, error } = await supabaseUntyped.rpc('sub_task_response_kind', { p_sub_task: subTaskId })
      if (error) throw error
      return data === 'feedback' ? 'feedback' : 'no_comment'
    },
  })
}

/**
 * Re-run the scheduler for a task that already exists (I12.3). The ad-hoc create commits the task
 * and then schedules it in a second call; when that second call fails the task is real but has no
 * bookings. Retrying targets the existing task, so pressing it repeatedly cannot create another —
 * which is what six duplicates of one task on 23 Aug came from.
 */
export function useRescheduleTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (subTaskId: string) => {
      // The retry path from a failed scheduling. If it places nothing AGAIN, that must be an error
      // here rather than a silent success — the person is standing in front of a dialog that told
      // them it failed and asked them to try again (ADR-0061 d.1).
      const outcome = await invokeFn<ScheduleOutcome>('subtask-schedule', { subTaskId })
      const key = scheduleWarningKey(outcome)
      if (key) throw Object.assign(new Error(key), { code: 'not_scheduled' })
    },
    onSuccess: () => {
      invalidateTaskViews(qc)
    },
  })
}

/** Request Changes — a reviewer reopens THIS sub-task (revision++), sends the deliverable back, and
 *  holds approval shut. The DB requires an unresolved review comment (the change description) first;
 *  without one it raises 55000, surfaced as an error the panel shows. */
export function useRequestChangesSubTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (subTaskId: string) => {
      const { error } = await supabaseUntyped.rpc('sub_task_request_changes', { p_sub_task: subTaskId })
      if (error) throw error
    },
    onSuccess: () => invalidateTaskViews(qc),
  })
}
