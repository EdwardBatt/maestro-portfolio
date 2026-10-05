import { useCallback } from 'react'
import { usePermissions } from '../../../app/permissions'
import {
  assignmentRoute,
  bookingRefusal,
  resourceInSchedulingScope,
  resourceInWriteScope,
  type AssignmentRoute,
  type ScopedResource,
  type SchedulingPlacement,
} from '../lib/write-scope.ts'

/** The three booking writes the grid and the edit modal can attempt. */
export type BookingAction = 'create' | 'update' | 'delete'

/**
 * The one place the schedule surfaces ask "may I write this?". Both axes, together: the permission
 * (`bookings:<action>`) and the write scope over the resource being written (ADR-0009/0036).
 *
 * It was previously inlined in DayGrid and pinned to `bookings:create`, which meant the grid's
 * add button was gated correctly while chip drags (an UPDATE) borrowed the create check and the
 * edit modal had no mirror at all — an out-of-scope user filled the form and reached Save before
 * the server refused. One hook, action-aware, keeps every surface honest about the same rules.
 *
 * UNTIL PERMISSIONS LOAD, LEAN ALLOW. `can` is fail-closed and answers false before the grant
 * fetch lands, which is right for deciding whether to RUN something and wrong for deciding whether
 * to OFFER it: a not-yet-known answer rendered as a refusal is a lie, and it leaves the grid dead
 * until something forces another render. So every gate here reports "allowed" while `ready` is
 * false; the server is authoritative and refuses anything that was genuinely not permitted. This is
 * the same lean-ALLOW principle the scope mirror already applies to what it cannot resolve.
 */
export function useWriteScope() {
  const { can, ready, failed, scope, departmentId, teamId, scopeGrantDepartmentIds, scopeGrantTeamIds } =
    usePermissions()

  // ADR-0139 d.1: the SCHEDULING reach — a team lead her team, a department lead his department,
  // Traffic everyone; an account manager nobody (she asks). Leave has its own door (d.7).
  const inScope = useCallback(
    (r: SchedulingPlacement) =>
      resourceInSchedulingScope(r, {
        scope,
        departmentId,
        teamId,
        scopeGrantDepartmentIds,
        scopeGrantTeamIds,
      }),
    [scope, departmentId, teamId, scopeGrantDepartmentIds, scopeGrantTeamIds],
  )

  const canWriteResource = useCallback(
    (action: BookingAction, r: SchedulingPlacement) =>
      !ready || (can(`bookings:${action}`) && inScope(r)),
    [ready, can, inScope],
  )

  // Why a write was refused, in words that are true for THIS person. Kept beside the check that
  // does the refusing so the two can never drift into disagreeing about the reason.
  const refusalFor = useCallback(
    (r: ScopedResource & { name: string }, action: BookingAction = 'create') =>
      bookingRefusal(
        r,
        {
          hasPermission: can(`bookings:${action}`),
          scope,
          departmentId,
          teamId,
          scopeGrantDepartmentIds,
          scopeGrantTeamIds,
        },
        action,
      ),
    [can, scope, departmentId, teamId, scopeGrantDepartmentIds, scopeGrantTeamIds],
  )

  /**
   * ADR-0087: what an assignment to this person's calendar will become on the server. 'direct'
   * until permissions load, for the same lean-ALLOW reason as everything above — the server
   * decides, and a dialog that promised a request the server then assigned directly has told a
   * smaller lie than a dead button.
   */
  const routeFor = useCallback(
    (r: SchedulingPlacement): AssignmentRoute => (ready ? assignmentRoute(r, {
      scope,
      departmentId,
      teamId,
      scopeGrantDepartmentIds,
      scopeGrantTeamIds,
    }) : 'direct'),
    [ready, scope, departmentId, teamId, scopeGrantDepartmentIds, scopeGrantTeamIds],
  )

  /**
   * May the caller ASK to book this person, where they cannot book them directly? Holds the
   * booking grant (d.3 — a Team Member cannot request, exactly as they cannot book), the row is a
   * person with a login (only a task can be requested, and a task needs an assignee), and the
   * calendar is placed somewhere a lead can answer for (d.13). The grid offers the "+" and the
   * drop on this, alongside the direct check.
   */
  const canRequestResource = useCallback(
    (r: SchedulingPlacement & { kind: string; userId: string | null }) =>
      ready && can('bookings:create') && r.kind === 'human' && r.userId != null && routeFor(r) === 'request',
    [ready, can, routeFor],
  )

  /**
   * I71.4: may the caller WRITE work placed on this person's department and team (`app.in_write_scope`)? Narrower than
   * scheduling reach (ADR-0098): a lead schedules anyone, but an unassigned task in another department stays that
   * department's (d.4) — so a new task is first placed where the caller writes, and assignment moves it (ADR-0060 d.9).
   */
  const inWriteReach = useCallback(
    (r: ScopedResource) =>
      ready && resourceInWriteScope(r, { scope, departmentId, teamId, scopeGrantDepartmentIds, scopeGrantTeamIds }),
    [ready, scope, departmentId, teamId, scopeGrantDepartmentIds, scopeGrantTeamIds],
  )

  return { can, ready, failed, scope, inScope, canWriteResource, refusalFor, routeFor, canRequestResource, inWriteReach }
}
