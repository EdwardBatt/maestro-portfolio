/**
 * The seeded people (supabase/seed.sql), by the tag in their address. Every scenario in
 * docs/E2E-PLAN.md names its actors from this list; a test never types an address or a password.
 *
 * Password is `devpassword` for all of them; the storage state per role is written by
 * `auth.setup.ts` to `e2e/.auth/<tag>.json`.
 */
export const PASSWORD = 'devpassword'

export const PEOPLE = {
  // tenant-wide
  admin:    { email: 'maestro.dev+admin@example.test',    name: 'Dev Admin',          role: 'power_admin' },
  traffic:  { email: 'maestro.dev+traffic@example.test',  name: 'Dev Traffic',        role: 'scheduler' },
  am:       { email: 'maestro.dev+am@example.test',       name: 'Dev Account Mgr',    role: 'account_manager' },
  am2:      { email: 'maestro.dev+am2@example.test',      name: 'Dev Account Mgr 2',  role: 'account_manager' },
  ad:       { email: 'maestro.dev+ad@example.test',       name: 'Dev Account Dir',    role: 'account_director' },
  ceo:      { email: 'maestro.dev+ceo@example.test',      name: 'Dev CEO',            role: 'ceo' },
  // Creative — a department WITH a lead, two team leads, a deputy, two members
  lead:     { email: 'maestro.dev+lead@example.test',     name: 'Dev Dept Lead',      role: 'department_lead', department: 'Creative' },
  tl:       { email: 'maestro.dev+tl@example.test',       name: 'Dev Team Lead',      role: 'team_lead',       department: 'Creative', team: 'Design' },
  motiontl: { email: 'maestro.dev+motiontl@example.test', name: 'Dev Motion Lead',    role: 'team_lead',       department: 'Creative', team: 'Motion' },
  deputy:   { email: 'maestro.dev+deputy@example.test',   name: 'Dev Deputy Lead',    role: 'deputy_team_lead', department: 'Creative', team: 'Design' },
  maker:    { email: 'maestro.dev+maker@example.test',    name: 'Dev Maker',          role: 'team_member',     department: 'Creative', team: 'Design' },
  animator: { email: 'maestro.dev+animator@example.test', name: 'Dev Animator',       role: 'team_member',     department: 'Creative', team: 'Motion', locale: 'ar' },
  // Content — a lead, a team lead, a member
  content:  { email: 'maestro.dev+content@example.test',  name: 'Dev Content Lead',   role: 'department_lead', department: 'Content' },
  copytl:   { email: 'maestro.dev+copytl@example.test',   name: 'Dev Copy Lead',      role: 'team_lead',       department: 'Content', team: 'Copy' },
  writer:   { email: 'maestro.dev+writer@example.test',   name: 'Dev Writer',         role: 'team_member',     department: 'Content', team: 'Copy' },
  // Production — NO department lead; two team leads; a member each (one in Dubai)
  studiotl: { email: 'maestro.dev+studiotl@example.test', name: 'Dev Studio Lead',    role: 'team_lead',       department: 'Production', team: 'Studio' },
  edittl:   { email: 'maestro.dev+edittl@example.test',   name: 'Dev Edit Lead',      role: 'team_lead',       department: 'Production', team: 'Edit' },
  producer: { email: 'maestro.dev+producer@example.test', name: 'Dev Producer',       role: 'team_member',     department: 'Production', team: 'Studio' },
  editor:   { email: 'maestro.dev+editor@example.test',   name: 'Dev Editor (Dubai)', role: 'team_member',     department: 'Production', team: 'Edit', office: 'Dubai' },
  // Strategy — nobody senior at all
  planner:  { email: 'maestro.dev+planner@example.test',  name: 'Dev Planner',        role: 'team_member',     department: 'Strategy' },
} as const

export type PersonTag = keyof typeof PEOPLE

export const OFFICES = { baghdad: 'Baghdad', dubai: 'Dubai' } as const
export const DEPARTMENTS = {
  creative: 'Creative',     // lead + team leads
  content: 'Content',       // lead + team lead
  production: 'Production', // team leads only
  strategy: 'Strategy',     // nobody senior
} as const
export const CLIENTS = {
  northwind: 'Northwind Beverages',   // AM: am
  harbour: 'Harbour Line Logistics',  // AM: am
  luma: 'Luma Retail',                // AM: am2
  orphan: 'Orphan Trading',           // no AM
} as const
export const CAMPAIGNS = {
  running: 'Northwind Summer Launch', // approved, 4 deliverables across Creative + Content
  pending: 'Harbour Line Rebrand',    // pending approval
} as const

export const authFile = (tag: PersonTag) => `e2e/.auth/${tag}.json`
