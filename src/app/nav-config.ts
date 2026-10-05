/**
 * Sidebar navigation is grant-driven (ADR-0008): an item appears only if the
 * caller's role holds one of its view grants — absence, not hiding (§2.3).
 * Items are grouped into sections; a section renders only if it has ≥1 visible
 * item. Landing stays role-aware (roles.default_route); the Power Admin's is
 * /admin, which renders the Overview dashboard.
 */

export interface NavItem {
  to: string
  labelKey: string
  icon: string
  /** shown when the role holds ANY of these grants */
  perms: string[]
}

export interface NavSection {
  titleKey: string
  items: NavItem[]
}

export const NAV_SECTIONS: NavSection[] = [
  {
    titleKey: 'nav.sections.main',
    items: [
      { to: '/my-work', labelKey: 'nav.myWork', icon: 'mywork', perms: ['my_tasks:view', 'my_calendar:view'] },
      // Beside the notification inbox in spirit, not inside it: an inbox lists events that
      // happened to you, a chat surface lists places you can speak (ADR-0063 d.1).
      { to: '/chat', labelKey: 'nav.chat', icon: 'chat', perms: ['my_tasks:view'] },
      { to: '/clients', labelKey: 'nav.clients', icon: 'clients', perms: ['clients:view'] },
      { to: '/campaigns', labelKey: 'nav.campaigns', icon: 'campaigns', perms: ['projects:view'] },
      { to: '/deliverables', labelKey: 'nav.deliverables', icon: 'deliverables', perms: ['project_tasks:manage'] },
      { to: '/pipeline', labelKey: 'nav.pipeline', icon: 'pipeline', perms: ['project_tasks:manage'] },
      { to: '/schedule', labelKey: 'nav.schedule', icon: 'schedule', perms: ['schedule:view'] },
      { to: '/bookings', labelKey: 'nav.bookings', icon: 'bookings', perms: ['bookings_table:view'] },
      { to: '/team', labelKey: 'nav.team', icon: 'team', perms: ['team:view'] },
      { to: '/library', labelKey: 'nav.library', icon: 'library', perms: ['assets:view'] },
      { to: '/sla-profiles', labelKey: 'nav.slaProfiles', icon: 'schedule', perms: ['sla_profiles:manage'] },
      // KPIs surface removed for now (Edward, 2026-08-19): KPI targets are driven by SLA profiles /
      // set at assignment — there is no standalone KPI page or nav link. Page + api kept dormant
      // (unrouted) for the future ADR-0032 build.
    ],
  },
  {
    titleKey: 'nav.sections.admin',
    items: [
      // The Overview (/admin) is reached via the universal "Dashboard" home link
      // in the shell (→ each role's landing); admins land there by default.
      { to: '/admin/users', labelKey: 'nav.users', icon: 'users', perms: ['admin.users:view'] },
      { to: '/admin/resources', labelKey: 'nav.resources', icon: 'resources', perms: ['admin.resources:view'] },
      { to: '/admin/organization', labelKey: 'nav.organization', icon: 'organization', perms: ['admin.organization:view'] },
      // Routed since I18.4 / I19.12 and reachable only from the /admin overview cards or by typing
      // the URL. Same shape as the gap that made I19 inert: shipped, and not reachable.
      { to: '/admin/deliverable-types', labelKey: 'nav.deliverableTypes', icon: 'deliverables', perms: ['admin.organization:view'] },
      { to: '/admin/workflow-templates', labelKey: 'nav.workflowTemplates', icon: 'pipeline', perms: ['admin.organization:view'] },
      { to: '/admin/brief-templates', labelKey: 'nav.briefTemplates', icon: 'campaigns', perms: ['admin.organization:view'] },
      { to: '/admin/roles', labelKey: 'nav.roles', icon: 'roles', perms: ['admin.roles:view'] },
      { to: '/admin/audit', labelKey: 'nav.audit', icon: 'audit', perms: ['audit:view'] },
      { to: '/admin/feedback', labelKey: 'nav.feedback', icon: 'feedback', perms: ['admin.feedback:view'] },
    ],
  },
  {
    titleKey: 'nav.sections.people',
    items: [
      { to: '/people/directory', labelKey: 'nav.directory', icon: 'directory', perms: ['directory:view'] },
      { to: '/people/leave', labelKey: 'nav.leave', icon: 'leave', perms: ['leave:view'] },
    ],
  },
  {
    titleKey: 'nav.sections.portal',
    items: [{ to: '/portal', labelKey: 'nav.portal', icon: 'portal', perms: ['portal:view'] }],
  },
]

export function visibleSections(can: (key: string) => boolean): NavSection[] {
  return NAV_SECTIONS.map((s) => ({ ...s, items: s.items.filter((i) => i.perms.some(can)) })).filter(
    (s) => s.items.length > 0,
  )
}
