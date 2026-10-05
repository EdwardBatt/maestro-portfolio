/**
 * Who may own a workstream, and in what order the picker offers them (ADR-0101 d.8). Pure — no
 * query here — so the rule is testable on its own and importable anywhere.
 */
/** ADR-0101 d.8: the roles that may own a workstream. The database refuses anyone else. */
export const WORKSTREAM_OWNER_ROLES = ['department_lead', 'team_lead', 'deputy_team_lead'] as const
export type WorkstreamOwnerRole = (typeof WORKSTREAM_OWNER_ROLES)[number]

export interface WorkstreamOwnerCandidate {
  id: string
  name: string
  departmentId: string | null
  role: WorkstreamOwnerRole
}

/**
 * The picker's order for one group (ADR-0101 d.8): the group's own department first — its
 * department lead, then its team leads and deputies — then everyone else eligible, by department
 * name and the same role order. Pure, so the rule is testable without a screen.
 */
export function orderOwnerCandidates(
  people: readonly WorkstreamOwnerCandidate[],
  departmentId: string | null,
  departmentName: (id: string | null) => string,
): WorkstreamOwnerCandidate[] {
  const rank = (r: WorkstreamOwnerRole) => WORKSTREAM_OWNER_ROLES.indexOf(r)
  return [...people].sort((a, b) => {
    const own = Number(b.departmentId === departmentId && departmentId != null) - Number(a.departmentId === departmentId && departmentId != null)
    if (own !== 0) return own
    const dept = departmentName(a.departmentId).localeCompare(departmentName(b.departmentId))
    if (dept !== 0) return dept
    const role = rank(a.role) - rank(b.role)
    if (role !== 0) return role
    return a.name.localeCompare(b.name)
  })
}
