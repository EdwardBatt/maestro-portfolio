import type { RoleScope } from '../../../app/permissions'

/**
 * Client mirror of `app.in_write_scope(department, team, null)` as it is reached through
 * `app.resource_in_write_scope` — the server-side predicate behind every booking write policy
 * (`bookings_scheduler_insert` / `_update` / `_delete`) and behind ADR-0040's assignment-authority
 * trigger.
 *
 * It exists so the UI can refuse an impossible action BEFORE the user fills a form and presses
 * Save. Reads stay tenant-wide, so every row is still visible — only the write is gated. The
 * server remains authoritative; this never grants anything, it only declines to offer.
 *
 * Two deliberate asymmetries, both leaning ALLOW so a legitimately-scoped user is never wrongly
 * blocked (a genuinely out-of-scope attempt still gets a clean 42501 from the server):
 *
 *   - a TEAM-ONLY resource (team set, department null) is reachable by a department-scoped caller
 *     through the team's parent department, which we cannot resolve client-side;
 *   - ADR-0029's PM bypass (`app.caller_is_booking_pm`) lets a project's appointed PM write
 *     outside their scope, and whether the caller is that PM is not knowable here — callers handle
 *     that with `isPmBypassEligible`.
 *
 * On the 'account' scope: `resource_in_write_scope` passes NULL for the account manager, so
 * `in_write_scope`'s 'account' branch can never be true for a resource. An Account Manager
 * therefore reaches a resource only through an explicit `user_scope_grants` target (ADR-0036), not
 * through the accounts they own. Mirrored exactly by falling through to the grant branches — worth
 * knowing since I12.6 gave that role its booking grants.
 */

export interface WriteScopeContext {
  /** the caller role's write scope (ADR-0009); null until permissions load */
  scope: RoleScope | null
  departmentId: string | null
  teamId: string | null
  /** additive per-user write-scope targets (ADR-0036) */
  scopeGrantDepartmentIds: ReadonlySet<string>
  scopeGrantTeamIds: ReadonlySet<string>
}

/** The placement fields the predicate reads — any resource row satisfies this. */
export interface ScopedResource {
  departmentId: string | null
  teamId: string | null
}

/** May the caller WRITE bookings for this resource? Permission is a separate question. */
export function resourceInWriteScope(r: ScopedResource, ctx: WriteScopeContext): boolean {
  if (ctx.scope === 'tenant') return true
  // ADR-0074: `all_accounts` passes `app.in_write_scope` for every question, exactly as the
  // ADR-0073 role exception it replaces did. Mirrored here so the Account Director is offered the
  // controls the server will accept — leaning DENY would show them dead buttons.
  if (ctx.scope === 'all_accounts') return true
  if (ctx.scope === 'department' && r.departmentId != null && r.departmentId === ctx.departmentId) return true
  if (ctx.scope === 'team' && r.teamId != null && r.teamId === ctx.teamId) return true
  // ADR-0070 d.3 (20260906110000): a team-scoped caller answers a question that names NO team by
  // the department their team sits in — so a resource placed in the department with no team is
  // within a team lead's reach. The mirror lagged the server here (review, 11 Sep): the grid
  // promised "will be sent for approval" and hid the decide buttons from the very lead the server
  // had notified. A resource that names a SIBLING team is still out of reach, as on the server.
  if (ctx.scope === 'team' && r.teamId == null && r.departmentId != null && r.departmentId === ctx.departmentId)
    return true
  if (r.departmentId != null && ctx.scopeGrantDepartmentIds.has(r.departmentId)) return true
  if (r.teamId != null && ctx.scopeGrantTeamIds.has(r.teamId)) return true
  // Team-only resource: reachable via the team's parent department, which we can't resolve here.
  if (
    r.departmentId == null &&
    r.teamId != null &&
    (ctx.scope === 'department' || ctx.scopeGrantDepartmentIds.size > 0)
  )
    return true
  return false
}

/**
 * The placement a SCHEDULING question reads (ADR-0139 d.1): the person's own department and team
 * (`user_profiles`) first, the calendar's (`resources`) otherwise, and the department the team sits in.
 * Optional so any resource row still satisfies `ScopedResource`; absent means "the calendar's own".
 */
export interface SchedulingPlacement extends ScopedResource {
  personDepartmentId?: string | null
  personTeamId?: string | null
  /** the department of the person's team (else the calendar's team) — a department lead reaches it */
  teamDepartmentId?: string | null
}

/**
 * ADR-0139 d.1 (I74.6): reach over a calendar FOR SCHEDULING — the client mirror of
 * `app.resource_in_scheduling_scope` (`20261003110000`).
 *
 *   tenant      — Traffic and the Power Admin: every calendar.
 *   department  — the person's department (else the calendar's) is the caller's, or the person's team
 *                 sits in it.
 *   team        — the person's team (else the calendar's) is the caller's own. A sibling team in the
 *                 same department is a request.
 *   account, all_accounts, self — nobody: an account manager and the account director ask.
 *   A per-user scope grant (ADR-0036) still widens it, by department (either one) or by team.
 *
 * Leave keeps `resourceInWriteScope` (ADR-0139 d.7). The server decides every write; this only
 * chooses what the screen offers and how it words it.
 */
export function resourceInSchedulingScope(r: SchedulingPlacement, ctx: WriteScopeContext): boolean {
  const dept = r.personDepartmentId ?? r.departmentId
  const team = r.personTeamId ?? r.teamId
  const teamDept = r.teamDepartmentId ?? null
  let reach = false
  switch (ctx.scope) {
    case 'tenant':
      return true
    case 'department':
      reach = ctx.departmentId != null && (dept === ctx.departmentId || teamDept === ctx.departmentId)
      break
    case 'team':
      reach = ctx.teamId != null && team === ctx.teamId
      break
    default:
      reach = false
  }
  if (reach) return true
  if (dept != null && ctx.scopeGrantDepartmentIds.has(dept)) return true
  if (teamDept != null && ctx.scopeGrantDepartmentIds.has(teamDept)) return true
  if (team != null && ctx.scopeGrantTeamIds.has(team)) return true
  return false
}

/**
 * ADR-0087 d.2 / ADR-0139 d.2: what the server will do with an assignment to this person's calendar.
 *
 *   direct    — within the caller's scheduling reach; `update_task_assignment` assigns and schedules.
 *   request   — outside it but placed in a department or team, so a lead answers (ADR-0139 d.3): the
 *               RPC records a request and assigns nothing. The screen says so BEFORE submit.
 *   unplaced  — no department and no team: nobody to ask, so the server refuses (hint
 *               `unplaced_resource`) rather than queue a request nobody would see.
 *
 * The permission axis (`bookings:create`) is a separate question the caller asks first.
 */
export type AssignmentRoute = 'direct' | 'request' | 'unplaced'

export function assignmentRoute(r: SchedulingPlacement, ctx: WriteScopeContext): AssignmentRoute {
  if (resourceInSchedulingScope(r, ctx)) return 'direct'
  const dept = r.personDepartmentId ?? r.departmentId
  const team = r.personTeamId ?? r.teamId
  if (dept == null && team == null) return 'unplaced'
  return 'request'
}

/**
 * Could ADR-0029's PM bypass apply to this booking? True when it belongs to a project, in which
 * case that project's appointed PM may write it regardless of scope — so the caller must lean
 * ALLOW rather than mirror the scope check. Note the bypass is on the INSERT/UPDATE policies only:
 * `bookings_scheduler_delete` has no PM branch, and neither does ADR-0040's trigger.
 */
export function isPmBypassEligible(b: {
  subTaskId: string | null
  deliverableId: string | null
  campaignId: string | null
}): boolean {
  return b.subTaskId != null || b.deliverableId != null || b.campaignId != null
}

/**
 * WHY a booking write was refused, as an i18n key plus its parameters.
 *
 * The grid used to answer this with one hardcoded sentence — "You can only book resources on your
 * own team" — shown to everybody. It was wrong for most of them: a Team Member can only book
 * themselves, a Department Lead reaches a whole department, and someone lacking `bookings:create`
 * altogether has no team problem at all. Telling a person the wrong reason for a refusal is worse
 * than telling them nothing: they go and ask for the wrong thing.
 *
 * Order matters — the first true reason is the one the person can act on:
 *   1. no permission at all, so reach is beside the point;
 *   2. the RESOURCE is unplaced (no department, no team), which no scope grant can reach — only a
 *      tenant-wide role can book it, so the fix is to place the resource, not to widen the person;
 *   3. otherwise their reach, named accurately (ADR-0009/0041). Since ADR-0098 a department,
 *      team or account scope reaches every calendar for scheduling, so for those the only honest
 *      answer left is "the server disagreed" — the mirror never invents a reach it does not have.
 */
export interface RefusalContext extends WriteScopeContext {
  hasPermission: boolean
}

export function bookingRefusal(
  r: ScopedResource & { name: string },
  ctx: RefusalContext,
  action: 'create' | 'update' | 'delete' = 'create',
): { key: string; params: Record<string, string> } {
  const params = { name: r.name }
  if (!ctx.hasPermission) return { key: `schedule.refusal.noPermission.${action}`, params }
  // ADR-0139: a lead or an account manager is never refused for reach — outside it they ASK, which is
  // offered beside the refusal. A refusal here is the server's, not the reach's.
  if (ctx.scope === 'department' || ctx.scope === 'team' || ctx.scope === 'account' || ctx.scope === 'all_accounts') {
    return { key: 'schedule.refusal.unknown', params }
  }
  if (r.departmentId == null && r.teamId == null) return { key: 'schedule.refusal.unplaced', params }
  switch (ctx.scope) {
    case 'self':
      // DELIBERATE (Edward, 25 Aug): a self-scoped person books nothing at all — not even their own
      // calendar. `app.in_write_scope` returns false for 'self' and no bookings policy carries an
      // owner predicate, and that stays. Someone who needs time blocked out asks their team leader.
      // The message must NOT offer self-booking as the consolation, which is what it used to do.
      return { key: 'schedule.refusal.self', params }
    default:
      // 'tenant' reaches everything, so a refusal here means the server disagreed with the mirror —
      // say so plainly rather than inventing a reason.
      return { key: 'schedule.refusal.unknown', params }
  }
}
