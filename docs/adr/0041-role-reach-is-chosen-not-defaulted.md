# ADR-0041: A role's reach is chosen, never defaulted

- **Status:** accepted (Edward, 2026-08-25)
- **Date:** 2026-08-25
- **Open Decision:** — (closes a gap between ADR-0008 d.2 and ADR-0009 d.3 that neither ADR noticed)
- **Amends:** ADR-0009 (Decision 3, which set a `scope` for the seeded roles only)
- **Task(s):** L6.12 (new); relates to ADR-0008 (configurable RBAC), ADR-0036 (per-user overlay)

## Context

Two accepted decisions meet here, and the space between them was never filled.

**ADR-0008 d.2** says admins create roles from the UI — "no migration, no deploy". **ADR-0009 d.3**
then gave every role a **write reach** (`roles.scope`) and listed the value for each of the seeded
roles. Neither ADR says what reach a role created *through the UI* should have.

The database answered instead. `roles.scope` was added with `not null default 'tenant'`
(`20260812100100_add_team_lead_role.sql:12`), so a role created without naming a reach silently gets
**the whole organisation** — the widest value in the system. And the Roles screen never asks: the
word "scope" appears **zero times** in `src/features/admin/RolesPage.tsx`, and neither
`CreateRoleArgs` nor `UpdateRoleArgs` in `roles-api.ts` carries the field. A role can be named, given
a landing page, seeded from another role's grants and have its permissions ticked on and off — but
its reach is invisible and unchangeable.

**This has already happened.** Edward's tenant holds a role **CCO** (`is_system` false, scope
`tenant`) which appears in no seeder in `supabase/migrations/` — it was created through the Roles
screen. Every other role in the tenant has the reach ADR-0009 assigned it; CCO has company-wide reach
because that is what the column default hands out. The value may well be right for a Chief Creative
Officer; the point is that nobody decided it.

The failure mode is quiet by construction. Reach only bites when a grant is exercised on a row
outside the holder's slice, so an over-wide role behaves exactly like a correct one until the day
somebody edits something they should not have been able to reach — and the audit trail then shows a
permitted action, because it *was* permitted.

**What prompted this.** Edward, reviewing why four Account Managers in Client Services need
authority that no single seeded role expresses: *"users must be able to define the system roles etc.
to fit the actual work."* They can define what a role **does**. They cannot define how far it
**goes**, and the invisible default is the widest option.

**What is NOT wrong.** The per-user overlay (ADR-0036) genuinely covers both axes — verified while
investigating: `app.has_permission` is `(role OR user-allow) AND NOT user-deny`, and
`app.in_write_scope` ORs the per-user scope targets **outside** the role-scope `case`, so a
`self`-scoped Team Member given department targets reaches those departments. Every booking policy,
task RPC, ADR-0040's trigger and all eight Edge Functions go through those two primitives, and no
runtime authorization anywhere keys off a role *key* (searched: the only role-key reads are tenant
seeders, the dev-preview toggle, the invite form's default and one label). A Team Member can be given
full scheduling authority across every department today, entirely through Users → Permissions. This
ADR does not touch that; it fixes the *role* half.

### Options weighed

- **A — put the per-user scope picker on the Roles screen** (name specific departments/teams on the
  role). Edward's first instinct, and rejected on inspection: a role's reach is **relative** —
  "their own department", evaluated per holder — which is exactly why one Department Lead role serves
  every department. Absolute targets on a role force one role per department (12 roles becomes ~40),
  and permissions must then be maintained in forty places instead of twelve. Absolute targets already
  exist, per user, where the exception belongs (ADR-0036).
- **B — show the reach but keep `tenant` as the default.** Rejected: a field that can be ignored
  reproduces the CCO case for anyone who clicks past it. The safe value must be the default value.
- **C — infer the reach from the role being copied.** Rejected: silent again, and copying grants is
  optional — a role created from scratch would still fall through to the column default.
- **D — make it an explicit choice, defaulted to the narrowest (chosen).** The five values already
  exist and are already enforced; nothing new is invented. The only change is that a human names one.

## Decision

1. **Reach is an explicit field on the Roles screen**, offered as the five values ADR-0009 already
   defined and `roles_scope_check` already permits — `tenant` (whole organisation), `department`
   (their own department and its teams), `team` (their own team), `account` (the clients/campaigns
   they are named on), `self` (only themselves). No new concept, no new value.

2. **A new role starts at `self`.** The create form defaults to the narrowest reach, so a role can
   only ever be widened deliberately. The column default changes from `'tenant'` to `'self'` in the
   same migration, so a role created by any path — script, console, future code — is safe by default
   rather than wide by default.

3. **Reach is editable on an existing role**, behind a confirmation that names how many people
   currently hold it. Changing it changes what every holder can touch, immediately; it is an
   authority change and must read as one. `roles` already carries the universal `audit_row_change`
   trigger (`20260802103000`), so the before/after is recorded without new work.

4. **Power Admin and Client Portal keep their reach locked** (`tenant` and `self`), consistent with
   ADR-0008 d.2 treating them as `is_system`. Every other role is editable, including the seeded
   ones — they are `is_system` false by design, and fitting them to the actual work is the point.

5. **Reach is visible in the roles list**, so it can be read at a glance rather than by querying the
   database. An invisible authority setting is how this happened.

6. **Roles stay relative; per-user grants stay absolute.** A role may never name a specific
   department or team. Reach to a *named* department or team is granted per person through
   `user_scope_grants` (ADR-0036) and nowhere else. This is the line that keeps the role count small.

7. **No live role is re-scoped by this change.** The migration alters the column default only; it
   does not touch existing rows. CCO keeps company-wide reach until Edward sets it deliberately
   through the new field — silently narrowing a role in a migration would be the same class of
   unannounced authority change this ADR exists to prevent.

## Consequences

**Easier.** Reach becomes a visible, deliberate property of a role instead of an invisible database
default, and the CCO class of accident cannot recur — the narrow value is the one you get by doing
nothing. Custom roles become genuinely useful: a "Client Services Coordinator" can be given team
reach and the permissions its holders actually need, rather than being a permission bundle that
silently spans the company. The role count stays small because reach stays relative.

**Harder.** One more required decision when creating a role, and it is a decision that needs
understanding — "their own department" versus "the whole organisation" is not obvious to a first-time
admin, so the option labels carry the explanation. Changing reach on a live role is a real authority
change and now costs a confirmation step. **CCO must be reviewed by hand** — this ADR deliberately
leaves it alone (d.7), so it stays company-wide until someone decides otherwise, and that review is
Edward's, not the migration's.

**Locked in.** A role's reach is relative to its holder; naming a specific department or team is a
per-user exception and lives in `user_scope_grants`. Anything wanting a role pinned to one named
department is asking for a per-user grant, or for a department-shaped concept the system does not
have — not for a reason to let roles hold absolute targets. And the default for an authority setting
is the narrowest value it can take, everywhere, not only here.

**Cost.** None — no dependency, no service, no licence. One migration (column default), one screen,
one form field.

**Testing.** pgTAP: the column default is `self` (insert a role naming no scope, assert `self`);
`roles_scope_check` still rejects an unknown value; an existing role's scope is unchanged by the
migration. Unit/UI: the create form submits the chosen reach and defaults to `self`; the reach field
is disabled for `power_admin` and `client_portal`; editing reach requires the confirmation and shows
the holder count; the roles list renders each role's reach. EN + AR keys for the five labels, their
explanations, and the confirmation.
