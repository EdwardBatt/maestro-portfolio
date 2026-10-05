/**
 * ADR-0087: a booking outside the requester's reach is a REQUEST the resource's lead answers.
 *
 * Pure data for the request record — the shape every surface reads (the grid's *requested* chip,
 * the task's *awaiting approval from …* line, the inbox actions) and the helpers that derive what
 * they show. No I/O here; `api.ts` beside it does the fetching, and is kept apart for the same
 * reason `task-reviewers.ts` is (it reaches `lib/env`, which throws in a test without VITE_ vars).
 *
 * In `src/lib/` because THREE features read it — schedule, deliverables and notifications — and a
 * feature never imports another feature's internals (AGENTS.md §3).
 */

export type AssignmentRequestStatus = 'pending' | 'approved' | 'refused' | 'withdrawn' | 'superseded'

export interface AssignmentRequest {
  id: string
  subTaskId: string
  /** The calendar asked for — the assignee's active human resource when the request was made. */
  resourceId: string
  resourceName: string | null
  assigneeId: string
  requestedBy: string
  requesterName: string | null
  requestedAt: string
  /** The payload `update_task_assignment` will apply on approval. */
  title: string
  startsAt: string | null
  dueAt: string | null
  hours: number | null
  status: AssignmentRequestStatus
  decidedBy: string | null
  decidedAt: string | null
  reason: string | null
  /** The department that will answer — the resource's own, or the one its team sits in. */
  departmentName: string | null
  taskTitle: string | null
  campaignName: string | null
  /** ADR-0139: an ask may name only a team (no person) — the team asked, and its name for "⏳ Copy · asked". */
  teamId?: string | null
  teamName?: string | null
}

/** The raw row as PostgREST returns it, with its embeds. */
export interface AssignmentRequestRow {
  id: string
  sub_task_id: string
  resource_id: string
  assignee_id: string
  requested_by: string
  requested_at: string
  title: string
  starts_at: string | null
  due_at: string | null
  hours: number | string | null
  status: AssignmentRequestStatus
  decided_by: string | null
  decided_at: string | null
  reason: string | null
  team_id?: string | null
  team?: { name: string; departments: { name: string } | { name: string }[] | null } | { name: string; departments: { name: string } | { name: string }[] | null }[] | null
  requester: { display_name: string } | { display_name: string }[] | null
  resource:
    | {
        name: string
        departments: { name: string } | { name: string }[] | null
        teams: { name: string; departments: { name: string } | { name: string }[] | null } | { name: string; departments: { name: string } | { name: string }[] | null }[] | null
      }
    | null
  sub_task:
    | {
        title: string
        deliverables: { streams: { campaigns: { name: string } | { name: string }[] | null } | { campaigns: { name: string } | { name: string }[] | null }[] | null } | { streams: { campaigns: { name: string } | { name: string }[] | null } | { campaigns: { name: string } | { name: string }[] | null }[] | null }[] | null
      }
    | null
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

/**
 * The department a request is waiting on, read the way `app.in_write_scope` reads it: the
 * resource's own department first, and where it names only a team, the department that team sits
 * in (ADR-0070 d.3's branch, the one `assignment_request_approvers` mirrors).
 */
export function requestDepartmentName(res: AssignmentRequestRow['resource']): string | null {
  if (!res) return null
  const own = one(res.departments)?.name
  if (own) return own
  const team = one(res.teams)
  return one(team?.departments)?.name ?? team?.name ?? null
}

export function toAssignmentRequest(r: AssignmentRequestRow): AssignmentRequest {
  const subTask = one(r.sub_task)
  const campaign = one(one(one(subTask?.deliverables)?.streams)?.campaigns)
  return {
    id: r.id,
    subTaskId: r.sub_task_id,
    resourceId: r.resource_id,
    resourceName: r.resource?.name ?? null,
    assigneeId: r.assignee_id,
    requestedBy: r.requested_by,
    requesterName: one(r.requester)?.display_name ?? null,
    requestedAt: r.requested_at,
    title: r.title,
    startsAt: r.starts_at,
    dueAt: r.due_at,
    hours: r.hours == null ? null : Number(r.hours),
    status: r.status,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    reason: r.reason,
    departmentName: requestDepartmentName(r.resource) ?? one(one(r.team)?.departments)?.name ?? null,
    taskTitle: subTask?.title ?? r.title,
    campaignName: campaign?.name ?? null,
    teamId: r.team_id ?? null,
    teamName: one(r.team)?.name ?? null,
  }
}

/**
 * The span a request asks for, as the grid measures bookings: epoch millis, overlap-tested per UTC
 * day column exactly as `bookingsFor` does for a booking, so a *requested* chip lands on the same
 * columns the booking would once it is approved. Null when the request carries no dates (a
 * payload that leaves the task's dates alone) — nothing to draw, and nothing is.
 */
export function requestSpan(r: Pick<AssignmentRequest, 'startsAt' | 'dueAt'>): { start: number; end: number } | null {
  if (!r.startsAt || !r.dueAt) return null
  const start = Date.parse(r.startsAt)
  const end = Date.parse(r.dueAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  return { start, end }
}

/** How many grid days the request touches — the columns its chip lands on — for a per-day figure. */
export function requestDayCount(r: Pick<AssignmentRequest, 'startsAt' | 'dueAt'>): number {
  const span = requestSpan(r)
  if (!span) return 1
  const DAY = 86_400_000
  return Math.max(1, Math.floor((span.end - 1) / DAY) - Math.floor(span.start / DAY) + 1)
}

/** Hours per requested day — the number the chip shows, never a number capacity counts (d.10). */
export function requestHoursPerDay(r: Pick<AssignmentRequest, 'startsAt' | 'dueAt' | 'hours'>): number | null {
  if (r.hours == null || !(r.hours > 0)) return null
  return Math.round((r.hours / requestDayCount(r)) * 10) / 10
}
