import { describe, expect, it } from 'vitest'
import { visibleSections } from './nav-config'

/**
 * Grant-driven navigation (ADR-0008 §2.3 — absence, not hiding). The sidebar is
 * grouped into sections (visibleSections); this flattens to the ordered route
 * list a role would see. Grant sets mirror the seeded roles.
 */
const grants = {
  // Power Admin holds the whole catalog → every nav view grant.
  power_admin: new Set([
    'my_tasks:view', 'my_calendar:view', 'clients:view', 'projects:view', 'projects:manage', 'project_tasks:manage', 'schedule:view', 'bookings_table:view', 'team:view', 'assets:view',
    'admin.users:view', 'admin.resources:view', 'admin.organization:view', 'admin.roles:view',
    'audit:view', 'admin.feedback:view', 'directory:view', 'leave:view', 'portal:view',
    'sla_profiles:manage',
  ]),
  // directory:view + assets:view are held by every internal role (ADR-0017/0022), not client_portal.
  // Scheduler holds projects:manage (ADR-0009) → Campaigns; project_tasks:manage → Deliverables; clients:view (ADR-0021) → Clients; assets:view (ADR-0022) → Library.
  scheduler: new Set(['my_tasks:view', 'my_calendar:view', 'clients:view', 'projects:view', 'projects:manage', 'project_tasks:manage', 'schedule:view', 'bookings_table:view', 'directory:view', 'assets:view']),
  // team_member holds project_tasks:manage in the seed (ADR-0024) → Deliverables surface.
  team_member: new Set(['my_tasks:view', 'my_calendar:view', 'projects:view', 'project_tasks:manage', 'directory:view']),
  client_portal: new Set(['portal:view']),
}

const canOf = (s: Set<string>) => (key: string) => s.has(key)
const routesFor = (s: Set<string>) => visibleSections(canOf(s)).flatMap((sec) => sec.items).map((i) => i.to)

describe('grant-driven navigation (ADR-0008, §2.3 absence-not-hiding)', () => {
  it('power admin sees every nav item, in section order', () => {
    expect(routesFor(grants.power_admin)).toEqual([
      '/my-work', '/chat', '/clients', '/campaigns', '/deliverables', '/pipeline', '/schedule', '/bookings', '/team', '/library', '/sla-profiles',
      // The Overview (/admin) is the universal "Dashboard" home link in the shell,
      // not a grant-driven section item — so it is not in visibleSections.
      '/admin/users', '/admin/resources', '/admin/organization',
      // I18.4 / I19.12 — routed since they shipped and, until 29 Aug, reachable only from the
      // /admin overview cards or by typing the URL.
      '/admin/deliverable-types', '/admin/workflow-templates', '/admin/brief-templates',
      '/admin/roles', '/admin/audit', '/admin/feedback',
      '/people/directory', '/people/leave',
      '/portal',
    ])
  })

  it('scheduler sees own views + schedule + bookings + directory, no team, no admin', () => {
    expect(routesFor(grants.scheduler)).toEqual(['/my-work', '/chat', '/clients', '/campaigns', '/deliverables', '/pipeline', '/schedule', '/bookings', '/library', '/people/directory'])
  })

  it('team member sees their own views + the company directory', () => {
    expect(routesFor(grants.team_member)).toEqual(['/my-work', '/chat', '/campaigns', '/deliverables', '/pipeline', '/people/directory'])
  })

  it('the KPIs surface is not in the nav for anyone (removed 2026-08-19)', () => {
    expect(routesFor(grants.power_admin)).not.toContain('/kpis')
    expect(routesFor(grants.scheduler)).not.toContain('/kpis')
    expect(routesFor(grants.team_member)).not.toContain('/kpis')
  })

  it('portal role sees only the portal (its surface is its own)', () => {
    expect(routesFor(grants.client_portal)).toEqual(['/portal'])
  })

  it('no grants → no nav (deny by default)', () => {
    expect(routesFor(new Set())).toEqual([])
  })
})
