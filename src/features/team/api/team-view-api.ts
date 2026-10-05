import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { inChunks } from '../../../lib/query/in-chunks'
import { allRows, inChunksPaged } from '../../../lib/query/all-pages'
import { LIVE_REFRESH } from '../../../lib/query/live'
import type { Span } from '../../../lib/capacity/types.ts'
import { pieceThreatensDeadline } from '../../../lib/campaigns/pulse'
import { useCampaignPulse } from '../../campaigns/api/campaign-pulse-api'

/**
 * The team / department view's own reads (I59.12, ADR-0105 d.4) — the TASKS behind the bars.
 *
 * The people, their week % and their bookings come from the reads the Team page and the Schedule
 * already use (`useTeamLoad`, `useScheduleBookings`); what neither carries is the task itself:
 * its piece, its workstream (the bar's colour), its state, its committed date (the L6 warning and
 * the red outline) and the work nobody has yet (the "Nobody yet" row). That is this file.
 *
 * Flat reads joined here, per id list in batches (I49.75), as `campaign-pulse-api` does: an embed
 * PostgREST cannot resolve comes back EMPTY rather than as an error (traps.md).
 *
 * Refreshes every 20 seconds and on returning to the tab (ADR-0105 d.5).
 */

export const teamViewKeys = {
  all: ['team-view'] as const,
  tasks: (scope: TeamTaskScope, window: Span) =>
    [
      ...teamViewKeys.all,
      'tasks',
      scope.departmentId ?? '',
      [...scope.assigneeIds].sort().join(','),
      [...scope.ownerIds].sort().join(','),
      [...scope.bookedTaskIds].sort().join(','),
      window.start,
      window.end,
    ] as const,
  titles: (userIds: readonly string[]) => [...teamViewKeys.all, 'titles', [...userIds].sort().join(',')] as const,
  members: (teamId: string | null) => [...teamViewKeys.all, 'members', teamId ?? ''] as const,
}

export type TeamTaskStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled'

export interface TeamTask {
  id: string
  title: string
  deliverableId: string
  /** the piece — the deliverable's name */
  pieceName: string
  campaignId: string | null
  campaignName: string | null
  /** the campaign's client — for the timeline's hover card (Edward, 27 Sep) */
  clientName?: string | null
  workstreamId: string | null
  workstreamName: string | null
  status: TeamTaskStatus
  revisionNumber: number
  assigneeId: string | null
  startsAt: string | null
  dueAt: string | null
  committedDueAt: string | null
  /** committed hours, else its SLA hours */
  hours: number | null
  departmentId: string | null
  teamId: string | null
  deliverableDueAt: string | null
  goLiveAt: string | null
  /** what an outstanding input on the piece or this task is waiting for (ADR-0069), when one is */
  waitingOn: string | null
  /** the deliverable's owner — who assigns its unassigned work (ADR-0100, I59 E1) */
  ownerId: string | null
  /** the deliverable's department, which follows its owner (ADR-0102) */
  deliverableDepartmentId: string | null
  /** who reviews it (ADR-0043) — a drop with none opens the assignment dialog instead */
  reviewerIds: string[]
  // ---- the clocks "For" reads (I59 E2), each the start of one state, real time
  /** when the task was given to its assignee */
  assignedAt: string | null
  /** when the piece's task list was approved — the unassigned clock */
  tasksApprovedAt: string | null
  /** the current round's Start: its open time entry's `started_at` */
  roundStartedAt: string | null
  /** when the current round was sent: its latest entry's `submitted_at` */
  roundSentAt: string | null
  /** the earliest open input on the task or its piece (ADR-0107, E12) */
  blockedSince: string | null
}

/**
 * Whose work this view shows.
 *  - `assigneeIds` — the people on screen (their logins): their live tasks.
 *  - `bookedTaskIds` — tasks behind this week's bookings on those people, however dated.
 *  - Unassigned work (I59 E1, 25 Sep): for a department, every unassigned task in it — placed on
 *    it, or on a piece of it (a piece's department follows its owner, ADR-0102); for a team, ONLY
 *    the tasks on pieces a team member owns (`ownerIds`) — the owner is who assigns it (ADR-0100).
 *    There is no second rule: a task's own `team_id` does not put it on a team's view.
 */
export interface TeamTaskScope {
  assigneeIds: readonly string[]
  bookedTaskIds: readonly string[]
  ownerIds: readonly string[]
  departmentId?: string | null
}

interface TaskRaw {
  id: string
  title: string
  deliverable_id: string
  status: TeamTaskStatus
  revision_number: number | null
  assignee_id: string | null
  starts_at: string | null
  due_at: string | null
  committed_due_at: string | null
  committed_hours: number | string | null
  sla_hours: number | string | null
  department_id: string | null
  team_id: string | null
  assigned_at: string | null
}
interface PieceRaw {
  id: string
  name: string
  state: string
  workstream_id: string | null
  due_at: string | null
  stream_id: string | null
  owner_user_id: string | null
  department_id: string | null
  tasks_approved_at: string | null
}
export interface EntryRaw {
  sub_task_id: string
  round: number
  started_at: string | null
  submitted_at: string | null
}
interface InputRaw {
  deliverable_id: string
  sub_task_id: string | null
  description: string
  requested_at: string
}

const TASK_SELECT =
  'id, title, deliverable_id, status, revision_number, assignee_id, starts_at, due_at, committed_due_at, committed_hours, sla_hours, department_id, team_id, assigned_at'
const PIECE_SELECT = 'id, name, state, workstream_id, due_at, stream_id, owner_user_id, department_id, tasks_approved_at'
const LIVE_STATUS = '("done","cancelled")'

/** An unassigned task belongs to the week when its dates meet it — or when it has no dates at all. */
const overlapsOrUndated = (window: Span) => {
  const s = new Date(window.start).toISOString()
  const e = new Date(window.end).toISOString()
  return `and(starts_at.is.null,due_at.is.null),and(starts_at.lt.${e},due_at.gte.${s}),and(starts_at.is.null,due_at.gte.${s}),and(starts_at.lt.${e},due_at.is.null)`
}

const num = (v: number | string | null) => (v == null ? null : Number(v))

export function useTeamViewTasks(scope: TeamTaskScope, window: Span, enabled = true) {
  return useQuery({
    ...LIVE_REFRESH,
    queryKey: teamViewKeys.tasks(scope, window),
    enabled,
    queryFn: async (): Promise<TeamTask[]> => {
      const end = new Date(window.end).toISOString()
      const start = new Date(window.start).toISOString()
      // The pieces whose unassigned work this view shows: those a team member owns (a team), or
      // those of the department (a department) — E1. Every page of each (I59.35): one department
      // held 1,167 live pieces locally on 25 Sep, and one owner 957.
      const departmentId = scope.departmentId
      const [ownedPieces, deptPieces] = await Promise.all([
        scope.ownerIds.length
          ? inChunksPaged<{ id: string }>(scope.ownerIds, (chunk, a, b) =>
              supabaseUntyped.from('deliverables').select('id').neq('state', 'archived').in('owner_user_id', chunk).order('id').range(a, b))
          : Promise.resolve([] as { id: string }[]),
        departmentId
          ? allRows<{ id: string }>((a, b) =>
              supabaseUntyped
                .from('deliverables')
                .select('id')
                .neq('state', 'archived')
                .eq('department_id', departmentId)
                .order('id')
                .range(a, b))
          : Promise.resolve([] as { id: string }[]),
      ])
      const unassignedOn = [...new Set([...ownedPieces, ...deptPieces].map((p) => p.id))]

      const [booked, assigned, unDept, unOwned] = await Promise.all([
        inChunks<TaskRaw>(scope.bookedTaskIds, (chunk) => supabaseUntyped.from('sub_tasks').select(TASK_SELECT).in('id', chunk)),
        // Live work that has started by the week's end and is not over before it began — or is,
        // and is still open against its commitment (late work stays on screen until it is done).
        inChunksPaged<TaskRaw>(scope.assigneeIds, (chunk, a, b) =>
          supabaseUntyped
            .from('sub_tasks')
            .select(TASK_SELECT)
            .in('assignee_id', chunk)
            .not('status', 'in', LIVE_STATUS)
            .lt('starts_at', end)
            .or(`due_at.gte.${start},committed_due_at.lt.${start}`)
            .order('id')
            .range(a, b)),
        // Every page (I59.35): a department's open unassigned work, undated included, was up to
        // 4,921 tasks locally on 25 Sep.
        departmentId
          ? allRows<TaskRaw>((a, b) =>
              supabaseUntyped
                .from('sub_tasks')
                .select(TASK_SELECT)
                .is('assignee_id', null)
                .not('status', 'in', LIVE_STATUS)
                .eq('department_id', departmentId)
                .or(overlapsOrUndated(window))
                .order('id')
                .range(a, b))
          : Promise.resolve([] as TaskRaw[]),
        inChunksPaged<TaskRaw>(unassignedOn, (chunk, a, b) =>
          supabaseUntyped
            .from('sub_tasks')
            .select(TASK_SELECT)
            .is('assignee_id', null)
            .not('status', 'in', LIVE_STATUS)
            .in('deliverable_id', chunk)
            .or(overlapsOrUndated(window))
            .order('id')
            .range(a, b)),
      ])

      const byId = new Map<string, TaskRaw>()
      for (const t of [...booked, ...assigned, ...unDept, ...unOwned]) byId.set(t.id, t)
      const tasks = [...byId.values()].filter((t) => t.status !== 'cancelled')
      if (tasks.length === 0) return []

      const pieces = await inChunks<PieceRaw>(tasks.map((t) => t.deliverable_id), (chunk) =>
        supabaseUntyped.from('deliverables').select(PIECE_SELECT).in('id', chunk))
      const pieceOf = new Map(pieces.map((p) => [p.id, p]))
      const streamIds = pieces.map((p) => p.stream_id).filter((x): x is string => x != null)
      const workstreamIds = pieces.map((p) => p.workstream_id).filter((x): x is string => x != null)
      const started = tasks.filter((t) => t.status === 'in_progress' || t.status === 'review').map((t) => t.id)
      const [streams, workstreams, inputs, entries, reviewers] = await Promise.all([
        inChunks<{ id: string; campaign_id: string | null }>(streamIds, (chunk) =>
          supabaseUntyped.from('streams').select('id, campaign_id').in('id', chunk)),
        inChunks<{ id: string; name: string }>(workstreamIds, (chunk) =>
          supabaseUntyped.from('workstreams').select('id, name').in('id', chunk)),
        inChunks<InputRaw>(pieces.map((p) => p.id), (chunk) =>
          supabaseUntyped
            .from('deliverable_pending_inputs')
            .select('deliverable_id, sub_task_id, description, requested_at')
            .is('satisfied_at', null)
            .in('deliverable_id', chunk)
            .order('requested_at', { ascending: true })),
        inChunksPaged<EntryRaw>(started, (chunk, a, b) =>
          supabaseUntyped
            .from('task_time_entries')
            .select('sub_task_id, round, started_at, submitted_at')
            .in('sub_task_id', chunk)
            .order('id')
            .range(a, b)),
        inChunks<{ sub_task_id: string; user_id: string }>(tasks.map((t) => t.id), (chunk) =>
          supabaseUntyped.from('sub_task_reviewers').select('sub_task_id, user_id').in('sub_task_id', chunk)),
      ])
      const campaignOfStream = new Map(streams.map((s) => [s.id, s.campaign_id]))
      const campaignIds = [...new Set(streams.map((s) => s.campaign_id).filter((x): x is string => x != null))]
      const campaigns = await inChunks<{ id: string; name: string; status: string; go_live_at: string | null; clients: { name: string } | { name: string }[] | null }>(campaignIds, (chunk) =>
        supabaseUntyped.from('campaigns').select('id, name, status, go_live_at, clients(name)').in('id', chunk))
      const campaignOf = new Map(campaigns.map((c) => [c.id, c]))
      const wsName = new Map(workstreams.map((w) => [w.id, w.name]))
      const inputsOf = new Map<string, InputRaw[]>()
      for (const i of inputs) inputsOf.set(i.deliverable_id, [...(inputsOf.get(i.deliverable_id) ?? []), i])
      const entriesOf = new Map<string, EntryRaw[]>()
      for (const e of entries) entriesOf.set(e.sub_task_id, [...(entriesOf.get(e.sub_task_id) ?? []), e])
      const reviewersOf = new Map<string, string[]>()
      for (const r of reviewers) reviewersOf.set(r.sub_task_id, [...(reviewersOf.get(r.sub_task_id) ?? []), r.user_id])

      // I59.59 (Edward, 27 Sep — A): work with nobody on it is shown, and counted as Unassigned, only when it
      // can be handed out — a released project, a task list its owner has approved (ADR-0100's second gate),
      // on a deliverable not yet finished. On production that was 7 of the 89 the figure showed: the rest
      // sat on unreleased projects (20), unapproved task lists (57) or finished deliverables (5).
      const readyToAssign = (t: TaskRaw): boolean => {
        const piece = pieceOf.get(t.deliverable_id)
        if (!piece || piece.state === 'approved' || piece.state === 'delivered') return false
        if (piece.tasks_approved_at == null) return false
        const campaignId = piece.stream_id ? campaignOfStream.get(piece.stream_id) ?? null : null
        return campaignId == null || campaignOf.get(campaignId)?.status === 'approved'
      }
      return tasks
        .filter((t) => pieceOf.get(t.deliverable_id)?.state !== 'archived')
        .filter((t) => t.assignee_id != null || readyToAssign(t))
        .map((t): TeamTask => {
          const piece = pieceOf.get(t.deliverable_id)
          const campaignId = piece?.stream_id ? campaignOfStream.get(piece.stream_id) ?? null : null
          const campaign = campaignId ? campaignOf.get(campaignId) : undefined
          // An input applies to this task when it is on the whole piece or on this task (ADR-0107 d.1).
          const open = (inputsOf.get(t.deliverable_id) ?? []).filter((i) => i.sub_task_id == null || i.sub_task_id === t.id)
          const clocks = roundClocks(entriesOf.get(t.id) ?? [], (t.revision_number ?? 0) + 1)
          return {
            id: t.id,
            title: t.title,
            deliverableId: t.deliverable_id,
            pieceName: piece?.name ?? '',
            campaignId,
            campaignName: campaign?.name ?? null,
            clientName: (Array.isArray(campaign?.clients) ? campaign?.clients[0]?.name : campaign?.clients?.name) ?? null,
            workstreamId: piece?.workstream_id ?? null,
            workstreamName: piece?.workstream_id ? wsName.get(piece.workstream_id) ?? null : null,
            status: t.status,
            revisionNumber: t.revision_number ?? 0,
            assigneeId: t.assignee_id,
            startsAt: t.starts_at,
            dueAt: t.due_at,
            committedDueAt: t.committed_due_at,
            hours: num(t.committed_hours) ?? num(t.sla_hours),
            departmentId: t.department_id,
            teamId: t.team_id,
            deliverableDueAt: piece?.due_at ?? null,
            goLiveAt: campaign?.go_live_at ?? null,
            waitingOn: open[0]?.description ?? null,
            ownerId: piece?.owner_user_id ?? null,
            deliverableDepartmentId: piece?.department_id ?? null,
            reviewerIds: reviewersOf.get(t.id) ?? [],
            assignedAt: t.assigned_at,
            tasksApprovedAt: piece?.tasks_approved_at ?? null,
            roundStartedAt: clocks.startedAt,
            roundSentAt: clocks.sentAt,
            blockedSince: earliest(open.map((i) => i.requested_at)),
          }
        })
    },
  })
}

/**
 * The current round's two clocks, from its time entries (ADR-0030: time is measured from Start).
 * The round a task is on is its `revision_number + 1` (`app.task_review_round`). Started = the
 * round's open entry's Start; sent = the round's latest send.
 */
export function roundClocks(entries: readonly EntryRaw[], round: number): { startedAt: string | null; sentAt: string | null } {
  const mine = entries.filter((e) => e.round === round)
  const openStarts = mine.filter((e) => e.started_at && !e.submitted_at).map((e) => e.started_at!)
  const sends = mine.map((e) => e.submitted_at).filter((x): x is string => x != null)
  return { startedAt: latest(openStarts), sentAt: latest(sends) }
}
const latest = (xs: readonly string[]) => (xs.length ? xs.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a)) : null)
const earliest = (xs: readonly string[]) => (xs.length ? xs.reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a)) : null)

/**
 * The people in a team (their profiles' team) — the owners whose pieces' unassigned work a team
 * lead's view shows (I59 E1). A team member cannot own a piece, so in practice this is the lead and
 * the deputy; reading the whole team keeps the rule the one Edward stated.
 */
export function useTeamMemberIds(teamId: string | null) {
  return useQuery({
    queryKey: teamViewKeys.members(teamId),
    enabled: teamId != null,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabaseUntyped.from('user_profiles').select('id').eq('team_id', teamId!)
      if (error) throw error
      return ((data ?? []) as { id: string }[]).map((r) => r.id)
    },
  })
}

/** Each person's role title (their profile's job title), for the timeline's row label. */
export function useJobTitles(userIds: readonly string[]) {
  return useQuery({
    queryKey: teamViewKeys.titles(userIds),
    enabled: userIds.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Map<string, string>> => {
      const rows = await inChunks<{ id: string; job_title: string | null }>(userIds, (chunk) =>
        supabaseUntyped.from('user_profiles').select('id, job_title').in('id', chunk))
      return new Map(rows.filter((r) => r.job_title).map((r) => [r.id, r.job_title!]))
    },
  })
}

/**
 * The tasks of the pieces the At risk figure counts (I57.13) — the same read and the same test
 * (`pieceThreatensDeadline`), so the figure and the By piece filter it opens cannot disagree.
 * `owners` narrows to pieces those people own; undefined counts every piece.
 */
export function useAtRiskTaskIds(owners: ReadonlySet<string> | undefined): ReadonlySet<string> {
  const pulse = useCampaignPulse()
  return useMemo(() => {
    const out = new Set<string>()
    if (!pulse.data) return out
    const now = Date.now()
    for (const c of pulse.data.values()) {
      for (const p of c.pieces) {
        if (owners && (!p.ownerId || !owners.has(p.ownerId))) continue
        if (pieceThreatensDeadline(p, { now })) for (const t of p.tasks) out.add(t.id)
      }
    }
    return out
  }, [pulse.data, owners])
}
