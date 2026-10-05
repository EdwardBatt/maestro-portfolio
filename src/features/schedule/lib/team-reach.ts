import type { RoleScope } from '../../../app/permissions'

/**
 * Whose week the Schedule opens on (ADR-0139 d.6, I74.6): a team lead's grid is her team, a
 * department lead's his department, Traffic's and the Power Admin's everyone.
 *
 * A DISPLAY narrowing, never an authorisation: the server decides every write. Anyone whose role
 * books nobody directly (an account manager, the account director) has no team here — `none` — and
 * the page falls back to everyone, because a view never dead-ends (the UI never blocks).
 */
export type ViewerReach =
  | { kind: 'all' }
  | { kind: 'department'; departmentId: string }
  | { kind: 'team'; teamId: string; departmentId: string | null }
  | { kind: 'none' }

export function viewerReach(scope: RoleScope | null, departmentId: string | null, teamId: string | null): ViewerReach {
  if (scope === 'tenant') return { kind: 'all' }
  if (scope === 'department' && departmentId) return { kind: 'department', departmentId }
  if (scope === 'team' && teamId) return { kind: 'team', teamId, departmentId }
  return { kind: 'none' }
}

/** A grid row: is this person on the viewer's own week? `effectiveDepartmentId` resolves a team-only row. */
export function resourceInReach(
  r: { teamId: string | null; personTeamId?: string | null },
  effectiveDepartmentId: string | null,
  reach: ViewerReach,
): boolean {
  switch (reach.kind) {
    case 'all': return true
    case 'department': return effectiveDepartmentId === reach.departmentId
    // ADR-0139 d.1: the person's own team first, the calendar's otherwise — as the server reads it.
    case 'team': return (r.personTeamId ?? r.teamId) === reach.teamId
    case 'none': return false
  }
}

/**
 * An unbooked task: is it the viewer's team's to book? A task placed on the department with no team
 * yet belongs to every team lead of that department until one books it — it is waiting on them too.
 */
export function taskInReach(task: { departmentId: string | null; teamId: string | null }, reach: ViewerReach): boolean {
  switch (reach.kind) {
    case 'all': return true
    case 'department': return task.departmentId === reach.departmentId
    case 'team':
      return task.teamId === reach.teamId || (task.teamId == null && task.departmentId != null && task.departmentId === reach.departmentId)
    case 'none': return false
  }
}
