import type { RoleScope } from '../../../app/permissions'

/**
 * The seven dashboard views (ADR-0122). One page, one layout (Figma section H) — only the rows change.
 */
export type DashboardView =
  | 'admin'
  | 'traffic'
  | 'clevel'
  | 'director'
  | 'account'
  | 'department'
  | 'team'
  | 'member'

/**
 * Which view a person gets, from their reach and permissions — never the role's name (ADR-0122 d.2,
 * ADR-0008). The rules run in order and the first match wins; anyone matching none gets the Team
 * Member view, so every signed-in person has a dashboard (the UI never dead-ends).
 *
 * `roles:manage` — not an admin *viewing* grant — marks the Power Admin: the CEO holds
 * `admin.roles:view`, and only the Power Admin may change roles (Traffic gets every permission but
 * this one, Edward 28 Sep).
 */
export function pickView(viewer: { scope: RoleScope | null; can: (key: string) => boolean }): DashboardView {
  const { scope, can } = viewer
  if (can('roles:manage')) return 'admin'
  if (scope === 'tenant' && can('projects:manage')) return 'traffic'
  if (scope === 'tenant' && can('health:view')) return 'clevel'
  if (scope === 'all_accounts') return 'director'
  if (scope === 'account') return 'account'
  if (scope === 'department') return 'department'
  if (scope === 'team') return 'team'
  return 'member'
}
