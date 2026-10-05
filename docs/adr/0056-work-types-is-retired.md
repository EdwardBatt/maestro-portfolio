# ADR-0056: `work_types` is retired — the settings belong to the deliverable type

- **Status:** accepted
- **Date:** 2026-08-28
- **Open Decision:** resolves the **deletion half** of **ADR-0050 d.8**. The label half is
  **ADR-0053**, which is a prerequisite and ships first.
- **Task(s):** I21; closes the `M6.4` line _"work types have no CRUD; they are seeded and
  read-only"_ (`docs/TASKS.md:1272-1274`)
- **Depends on:** **ADR-0051** (`deliverable_types` must exist to receive the settings) and
  **ADR-0053** (the department must already be the label and an SLA tier)

## Context

ADR-0053 took the additive half of ADR-0050 d.8: the Discipline label became the department, and
`app.effective_sla` gained a department tier above the two work-type tiers, which it kept as a
deprecated tail. Nothing was dropped there, deliberately.

This ADR is the deletion. It is the riskiest change in this set, the only one that drops a table,
and the one whose blast radius has to be enumerated by hand — because, as §"There is no compiler
safety net" shows, nothing will tell us if the list is short.

### `work_types` is doing two unrelated jobs

The table, unchanged since `20260728110400_create_work_structure.sql` apart from `revision_limit`
added by ADR-0024:

```sql
create table work_types (
  id, tenant_id,
  name                       text not null,          -- job A: a label
  lead_time_hours            integer,                -- job B: a setting
  default_load_pct           numeric(5,1),           -- job B
  sla_profile_id             uuid,                   -- job B
  accountability_profile_id  uuid,                   -- job B
  revision_limit             integer,                -- job B (added by ADR-0024)
  is_active                  boolean,
  constraint uq_work_types_tenant_name unique (tenant_id, name)
);
```

**Job A — a label.** `name` is what `/deliverables` rendered as its _Discipline_ column, what the
bookings list shows, and what a stream was named after. In substance this is a department, which is
what ADR-0053 decided.

**Job B — a settings box.** The other five columns say how long this kind of work takes, how much of
a day it consumes, which SLA profile applies, which accountability profile applies, and how many
revision rounds are allowed. These are **not** properties of a department. How long a billboard takes
is a fact about billboards; if billboards moved from Creative to Production tomorrow, the lead time
would not change.

One table stretched between a label and a settings box is why every conversation about it has
stalled. It has been stretched since July.

### The seeded list cannot map to departments, because it is not a list of departments

`app.seed_tenant_disciplines` (`20260816090000:20-33`) seeds six rows:

> Creative · Social & Content · Production · Influencer · Activation · Paid Media

In the pilot tenant's actual organisation the **Creative** department contains two teams — Copy,
Social & Content, and Art & Video. So in that list "Creative" is a department and **"Social & Content"
is a team inside it**: two entries at two different levels of the org chart. There is no 1:1 mapping
from this list to departments, because the list is not drawn on one axis.

The reverse fails too. A TVC needs Production to shoot it, Art & Video to cut it and Copy to write
the script — one deliverable, three departments. Nothing that names a single department per piece of
work can be right.

This matters twice: once as the argument for retirement, and once as the reason the backfill in d.9
cannot be a department name match.

### Departments are tenant-authored. Nothing seeded may name one.

Verified: there is **no `insert into departments` or `insert into teams` in any migration**. They
appear only in pgTAP fixtures (ten of them — `010`, `017`, `024`, `027`, `032`, `033`, `035`, `036`,
`039`, `060`) and are authored by the tenant through `src/features/admin/OrganizationPage.tsx`. That is the correct arrangement and this
ADR does not disturb it — it is also the reason a seeded list of six discipline names is a product
telling a customer how to structure their agency.

### The blast radius, enumerated

> **Re-verify this table against `HEAD` before implementing.** It was accurate when written and one row
> went stale within hours: `useDisciplineMappings` and `useSetDisciplineTemplate` were deleted on the
> same branch, alongside the campaign-page fix, because they read a `work_types.brief_type` column that
> has never existed and made two screens fail with PostgREST 42703.
>
> That is not a footnote. This ADR's entire safety argument is that **the enumerated list is the only
> safety net** — every file touching `work_types` is on `supabaseUntyped`, and `booking-transition` is
> Deno and never type-checked against the schema, so dropping the table produces zero compile errors. A
> list that is the only safety net must be re-run, not re-read.

Verified 2026-08-28 by `grep -rn "work_type" src supabase`.

**Database — five FK columns, the table, and the seeder:**

| Object                              | Where                | Note                                                       |
| ----------------------------------- | -------------------- | ---------------------------------------------------------- |
| `streams.work_type_id`              | `20260728110400:129` | NULL for every campaign since 27 Aug (ADR-0053 Context)    |
| `jobs.work_type_id`                 | `20260728110400:162` | display only; nothing in `src/` or any RPC writes it       |
| `bookings.work_type_id`             | `20260728110500:16`  | comment _"null ⇒ never enters SLA machinery"_              |
| `sla_profiles.work_type_id`         | `20260819180000:13`  | **written from the UI** — see below                        |
| `kpi_definitions.work_type_id`      | `20260819190000:21`  | declared, read by no logic                                 |
| `app.seed_tenant_disciplines(uuid)` | `20260816090000:20`  | **and its call inside `public.seed_tenant_roles` (`:46`)** |

**`app.seed_tenant_disciplines` is the item the previous draft missed entirely, and it is the one that
breaks tenant provisioning.** `public.seed_tenant_roles` is the provisioning wrapper the bootstrap path
calls; it invokes the discipline seeder as its second statement. Drop `work_types` without rewriting
that wrapper and **creating a new tenant fails**, not on the next deploy but on the next customer.

**Application code — six files, plus two Admin/UI surfaces:**

| Call site                                            | What it does                                                      | Reached from                             |
| ---------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------- |
| `supabase/functions/booking-transition/index.ts:475` | **WRITES** `work_type_id` on every booking row it inserts         | **a deployed Edge Function**             |
| `supabase/functions/booking-transition/index.ts:32`  | `workTypeId` in the Zod input schema                              | same                                     |
| `src/features/bookings/api/bookings-api.ts:48`       | embeds `work_types(name)` in the bookings list select             | `:64`, `:75` map it to the _Type_ column |
| `src/features/campaigns/api/campaign-api.ts:49`      | `from('work_types').select('id, name')` inside `useWizardRefData` | Brief Wizard                             |
| `src/features/sla/api/sla-api.ts:51`                 | embeds `work_types!work_type_id(name)`                            | `/sla-profiles` list                     |
| `src/features/sla/api/sla-api.ts:71`                 | `useWorkTypes()` — the picker's option list                       | `SlaProfilesPage.tsx:108`                |
| `src/features/sla/api/sla-api.ts:96`                 | **WRITES** `work_type_id` on insert and update                    | `SlaProfilesPage.tsx:41`                 |
| ~~`brief-templates-api.ts:85` / `:118`~~             | ~~read and write `work_types.brief_type`~~                        | **ALREADY DELETED, 28 Aug** — see below  |
| `src/types/database.ts`                              | generated — regenerates                                           | —                                        |

Three corrections to the previous draft, all verified:

1. **`booking-transition/index.ts:475` was never mentioned.** It is a **deployed** function, and it
   writes the column on every booking insert. Nothing in `src/` currently sends `workTypeId`, so the
   value written is always `null` — which is irrelevant: the _column name_ is in the insert payload,
   and PostgREST rejects the whole statement with `42703` once the column is gone. **Every booking
   creation would fail in production, from a file no compiler and no test touches.**

2. **`campaign-api.ts:49` is not "the wizard's discipline picker".** ADR-0050 already replaced that
   picker with an owner picker (`BriefWizard.tsx:658`), and `ref.data.disciplines` is consumed
   **nowhere** — the wizard reads only `ref.data.clients` and `ref.data.brands` (`:336`, `:342`). It is
   a dead fetch. It is still fatal: the three queries run in one `Promise.all` and the whole
   `useWizardRefData` query throws on `discRes.error`, so the wizard renders `refFailed` and nobody can
   create a campaign.

3. **`campaign-detail-api.ts` no longer embeds `work_types` at all.** The previous draft listed it as a
   `brief_type` call site; that embed was removed with the 28 Aug fix to that query, and the file now
   carries a comment saying so (`:13-20`). The two remaining `brief_type` call sites are both in
   `brief-templates-api.ts`.

**Test fixtures:** 20 pgTAP files under `supabase/tests/` insert into `work_types` (`013`, `014`, `015`,
`017`, `018`, `019`, `021`, `022`, `023`, `025`, `026`, `028`, `029`, `030`, `031`, `045`, `047`, `051`,
and others). `031_sla_profiles.sql` additionally writes `work_types.sla_profile_id` at `:44` and `:54`
and asserts the old chain. Every one of these must be updated in the same change set or
`bash scripts/db/verify.sh` fails — which is the _good_ case, because it fails in CI rather than in
production.

### There is no compiler safety net. The list above is the whole of it.

The previous draft said: _"the typed call sites referencing `work_types` break at compile time. That is
the desired behaviour and is how the change is made safe."_

**That is false, and it was the most dangerous sentence in it.** Verified 2026-08-28: every one of the
six files touching `work_types` uses **`supabaseUntyped`** —

- `brief-templates-api.ts:2`, `bookings-api.ts:2`, `campaign-api.ts:2`, `sla-api.ts:2`,
  `campaign-detail-api.ts:2`, and `deliverables-api.ts` (which imports both but reads
  `departments(name)` since ADR-0053).
- `booking-transition/index.ts` is Deno on the server and is not type-checked against the schema at all.

So dropping the table produces **zero** TypeScript errors. `npm run typecheck` passes. `npm run build`
passes. `src/types/database.ts` regenerates without `work_types` and nothing complains, because no code
path is typed against it. PostgREST is the only thing that will report a missing column, and it reports
it at runtime, to a user.

This is not a footnote. It is the reason the enumerated list above must be complete, and the reason d.11
requires the migration to refuse rather than warn.

### Three readers point at a column that does not exist

`work_types` has **no `brief_type` column** — not in `20260728110400`, not in any `alter table
work_types`, not in `src/types/database.ts`. `brief_type` lives on `brief_templates` and on
`campaign_briefs`. Yet `brief-templates-api.ts:85` reads it and `:118` writes it, both ADR-0048 d.5
leftovers that ADR-0050 d.7 superseded. Both pages call these hooks from production code; the component
tests mock the hooks, so the suite is green regardless.

That is further evidence for the thesis — the table accreted a fourth job it never had a column for —
and this ADR removes the call sites rather than repairing them.

### Options weighed

**(a) Map `work_type` → `department`, keep both.** The opening instinct, and the one this ADR tests
hardest. It fails on the evidence above: the seeded list mixes departments with teams, so no 1:1 mapping
exists; and if one did, `work_types` would be `departments` written twice, leaving two lists to maintain
forever and a mapping table to keep in step. It also cannot express the TVC case, where one deliverable
spans three departments.

**(b) Leave `work_types` alone; bridge to it from `deliverable_types.work_type_id`.** Recommended earlier
on the strength of the blast radius, and **withdrawn** once the two-jobs analysis was done. It is not a
decision, it is a deferral: it leaves d.8 open a second time and pays the migration cost twice, because
the taxonomy work touches these same tables anyway.

**(c) Retire it by splitting the two jobs.** Chosen. It is the only option that ends with fewer lists
than it started with.

> **AMENDMENT, 2026-08-28 — the `app.effective_sla` rewrite in d.4 is GATED on ADR-0032.**
>
> Dropping the work-type tiers changes the resolution chain, and the chain belongs to ADR-0032,
> which is the canonical ADR for SLA and accountability and **is not finalised**. Everything else
> here — the label, the settings move, the backfill, the drop itself — is unaffected and still
> sequenced last.

## Decision

**d.1 `work_types` is retired.** Its two jobs are separated and the table is dropped. The label job was
answered by ADR-0053 d.1 (`deliverables.department_id`). This ADR moves the settings job and removes
what is left.

**d.2 Four of the five settings move to `deliverable_types`; one is left behind.**

| Column                          | Destination                          | Why                                       |
| ------------------------------- | ------------------------------------ | ----------------------------------------- |
| `lead_time_hours`               | `deliverable_types` (ADR-0051 d.9)   | a fact about the artefact                 |
| `default_load_pct`              | `deliverable_types`                  | a fact about the artefact                 |
| `revision_limit`                | `deliverable_types`                  | a fact about the artefact (ADR-0024)      |
| `sla_profile_id`                | `deliverable_types`                  | tier 4 of ADR-0053's chain resolves on it |
| **`accountability_profile_id`** | **nowhere — dropped with the table** | see d.3                                   |

ADR-0051 **d.12** declares **four** of these columns on `deliverable_types` — written but read by nothing
until this ADR — and deliberately leaves `accountability_profile_id` behind for the reason in d.3. This
ADR makes those four the live source; the fifth is dropped with the table rather than migrated.

**d.3 `accountability_profile_id` is not carried across.** Its only consumer is **`P2.2`**
(`docs/TASKS.md:1428-1431`), and `P2.2.1` is **⚠️-gated on OD 7, which is still open**
(`docs/TASKS.md:1491`). Carrying a column forward for an unbuilt feature whose shape is undecided is how
`work_types` grew a settings box in the first place. When P2.2 is designed it will attach accountability
profiles to whatever axis that ADR chooses, on evidence — and if that axis turns out to be the
deliverable type, adding one nullable column then is cheaper than guessing now and being wrong.

Nothing is lost: `accountability_profiles` remains as a table, and the FK from `work_types` is dropped
with the table. The values in the column are copied into `work_types_retirement_unmapped` (d.10) with
every other row the migration cannot place, so nothing disappears without a record.

**d.4 The deprecated work-type tier leaves `app.effective_sla`.** ADR-0053 d.2 tier 6 is deleted, leaving
the six-tier target chain:

```
1. sub_tasks.sla_hours              — manual leaf override (beats everything)
2. sub_tasks.sla_profile_id         — leaf profile
3. job.sla_profile_id               — project profile (the deliverable's job, if any)
4. deliverable type                 — explicit profile, then is_default for that type
5. department                       — is_default profile for the deliverable's department
6. tenant default                   — is_default profile with both axes null
```

The fall-through rule is unchanged: a tier whose profile carries a NULL `turnaround_hours` falls to the
next.

**d.5 `sla_profiles.work_type_id` is dropped**, along with `idx_sla_profiles_work_type_id` and the partial
unique index `uq_sla_profile_wt_default`. The `deliverable_type_id` and `department_id` columns added by
ADR-0053 d.4, their indexes and their CHECK constraint remain; the CHECK narrows from three axes to two. A
profile with both columns null remains the tenant default.

**d.6 `kpi_definitions.work_type_id` becomes `deliverable_type_id`.** The column is declared but **read by
no logic** — `app.kpi_rollup` does not reference it — so this is a rename with a backfill and no
behavioural change. Adding a department axis to KPIs is deliberately **not** decided here; it is a KPI
question, not a taxonomy one.

**d.7 `streams.work_type_id`, `jobs.work_type_id` and `bookings.work_type_id` are dropped.**
`streams.work_type_id` is already null for every campaign created since 27 Aug; `jobs` and `bookings` carry
it for display only and nothing writes either from `src/`. `bookings.work_type_id`'s comment — _"null ⇒
never enters SLA machinery"_ — is preserved in behaviour by ADR-0053 d.3, which resolves SLA through the
sub-task's deliverable and never through a booking.

**d.8 `app.seed_tenant_disciplines` is dropped and `public.seed_tenant_roles` is rewritten without it.**

**Copy from the CURRENT definition, which is `20260827200000_brief_templates.sql:105-111` — not from
`20260816090000:44-48`.** They differ, and the difference is dangerous: the current wrapper calls
`app.seed_tenant_roles`, `app.seed_tenant_disciplines` **and `app.seed_tenant_brief_templates`. Reproduce
the older two-line version and brief-template seeding silently disappears from provisioning** — a new
tenant would be created with no brief templates and nobody would find out until an Account Manager
opened the wizard.

This is a live hazard beyond this ADR: **ADR-0051, ADR-0052 and this ADR all fold a seed into the same
wrapper**, each by reproducing it whole. Three ADRs rewriting one function with no stated order is a
merge accident waiting to happen. Whichever lands last must reproduce the wrapper as it stands _after_
the others, and the implementation order is: ADR-0051 (types + attribute values + categories),
ADR-0052 (workflow templates), then this ADR (remove disciplines). Better still, and recommended:
collapse the body into a single `app.seed_tenant_reference_data(uuid)` that the wrapper calls once, so
the next seed is a line inside one function rather than a fourth rewrite of the wrapper.

**This is a provisioning path, not a display path: it is verified by creating a tenant in the pgTAP
suite, not by reading the diff.**

**d.9 The backfill maps against departments _and then teams_, because the seeded list is not one axis.**
The previous draft's Options section rejected work-type→department name-mapping as impossible and then
its step 2 did exactly that. On the pilot tenant's own data it would fail: "Social & Content" is a
**team**, and matching it against `departments` finds nothing.

For each `work_types` row with a name to place, in order:

1. Match `lower(trim(name))` against `departments.name` in the same tenant. Hit ⇒ that department.
2. Else match against `teams.name` in the same tenant. Hit ⇒ **that team's `department_id`** (`teams`
   carries `department_id not null`, `20260812100000:10`), because a profile configured for a team is
   configured for work that team does, and the department is the axis that survives.
3. Else unmapped — recorded, never guessed.

A team-name match that is ambiguous across two departments in the same tenant is treated as **unmapped**,
not resolved by picking one.

**d.10 Nothing is dropped silently: `work_types_retirement_unmapped`.** Created by the same migration,
before any column is dropped, carrying `tenant_id`, source table, source id, the work type's name, every
setting value that had nowhere to go (including `accountability_profile_id`, d.3), and a reason.

**It carries `tenant_id`, so it gets RLS in the same migration** — `enable row level security` +
`force row level security`, a tenant-scoped select policy, and no client write policy at all
(`AGENTS.md` §6: _"A table without RLS never merges"_). It is a migration artefact read by an
administrator, not a surface.

**d.11 The migration REFUSES to drop the table while anything is unmapped.** After the backfill it counts
`work_types_retirement_unmapped`; if the count is non-zero it `raise exception`s and the whole migration
rolls back, naming the count and the table to look in.

A `raise notice` — which is what the previous draft specified — scrolls past in a `supabase db push` log
and is read by nobody. Given that there is **no compiler safety net** (see Context), a notice is the
weakest possible signal on the strongest possible action.

The escape hatch is explicit and deliberate: setting `app.work_types_retirement_accept_unmapped = 'on'`
for the transaction downgrades the exception to a notice. It has to be typed by a person who has looked
at the table, which is exactly the property wanted. The migration records in the audit trail that the
flag was used.

**d.12 The `work_types.brief_type` call sites are deleted, not repaired.** `useDisciplineMappings`
(`brief-templates-api.ts:85`) and `useSetDisciplineTemplate` (`:118`) are ADR-0048 d.5 machinery that
ADR-0050 d.7 superseded: the Account Manager chooses the brief type per department on
`campaign_briefs.brief_type`, and nothing needs a discipline-to-template map. `BriefTemplatesPage`'s
discipline section (`:29`, `:54`) goes with them. Editing what a brief _contains_ — ADR-0048 d.2 — is
untouched.

**d.13 `booking-transition` stops writing `work_type_id`, and `workTypeId` leaves its Zod schema.** The
field is removed from the insert payload (`index.ts:475`) and from the input contract (`:32`). Nothing in
`src/` sends it, so no caller changes. **The function must be redeployed in the same change as the
migration** — this is the one item in the blast radius that is not deployed by `supabase db push` and not
caught by any test in the repository.

**d.14 The remaining readers become department readers or are removed.** `bookings-api.ts:48` embeds the
booking's deliverable's `departments(name)` in place of `work_types(name)` for its _Type_ column, matching
what ADR-0053 d.1 did on `/deliverables`. `campaign-api.ts:49` and the `disciplines` field of
`WizardRefData` are deleted outright — dead since ADR-0050. `sla-api.ts`'s work-type picker
(`:51`, `:71`, `:96`) and `SlaProfilesPage`'s `work_type_id` control (`:20`, `:29`, `:41`, `:108`) become
the department and deliverable-type pickers that ADR-0053 d.4's columns require.

**d.15 It ships as one migration with its pgTAP suite,** and `bash scripts/db/verify.sh` must pass before
it is proposed for a push. Migration, function redeploy and frontend land together; there is no
intermediate state in which the table is gone and a reader is not.

## Consequences

### Easier

- One list disappears. ADR-0050 d.8 closes without a mapping table to maintain.
- The settings land on the thing they describe: a billboard's lead time is a fact about billboards, and
  the per-type SLA tier becomes meaningful for the first time — `work_types` had an `sla_profile_id` but
  only six values to hang it on.
- Two call sites that read a column which has never existed go away instead of being repaired.
- `M6.4`'s outstanding _"work types have no CRUD"_ is answered by deletion; the CRUD that was owed is
  `deliverable_types` CRUD, which ADR-0051 specifies.
- Nothing seeded names an organisational unit any more.

### Harder

- **This is the riskiest change in the set and the only one that drops a table.** Five FK columns, a
  provisioning seeder, six source files, a deployed Edge Function and 20 pgTAP fixtures change together.
- **The compiler will not help.** Every affected file is on `supabaseUntyped` or is Deno; the enumerated
  list in Context is the entire safety net, and d.11 exists because of it. Anything missed from that list
  is a runtime `42703` in front of a user.
- Any tenant that configured SLA profiles per discipline has them repointed by a **name match** through
  departments and then teams. Where neither matches, the profile becomes a tenant-level default and the
  migration **stops** (d.11). **The pilot tenant's `work_types`, `departments` and `teams` rows must be
  read before this runs** — this ADR does not assume what is in them, and the escape hatch in d.11 is
  there because a human, not a migration, decides whether an unmapped row is acceptable.
- `accountability_profile_id` is deliberately dropped rather than carried (d.3). If P2.2 later wants it on
  the deliverable type, that is a new nullable column and a re-read of
  `work_types_retirement_unmapped`, which is why the values are preserved there.
- The `/sla-profiles` screen changes shape: one picker becomes two, and existing per-work-type profiles
  arrive as department profiles. A user who configured them will see them move.

### Locked in

- **Organisational structure is never seeded and never inferred.** It is authored by the tenant and derived
  onto work from the people a human names — the owner for a deliverable, the assignee for a sub-task.
  Anything seeded in this system may name work; it may not name a **person, a department or a team**.
  (Roles are the deliberate exception and always were: `app.seed_tenant_roles` ships eleven, and ADR-0055
  d.2 seeds a grant onto three of them. A role is a bundle of permissions a tenant may rename, retire or
  replace — `roles.key` is immutable but `roles.name` is not, and "Scheduler" is already displayed as
  "Traffic Manager". It is not org structure.)
- The axes are fixed: **`departments` = who**, **`deliverable_types` = what**. There is no third list, and a
  future proposal to add one must supersede this ADR.
- Cross-department reach stays a per-user grant (`user_scope_grants`, ADR-0036), never anything derived from
  a work type or an ownership role.
- A migration that cannot place every row it is asked to move **stops**. It does not warn.

## Testing

The previous draft had no Testing section, on the riskiest change in the set. This is the minimum bar.

**pgTAP — the new SLA chain, asserted tier by tier.** Six assertions, one per tier of d.4: `sla_hours`
beats a leaf profile; a leaf profile beats a job profile; a job profile beats a type profile; a type
profile beats a department profile; a department profile beats the tenant default; and with none set the
tenant default is returned. Asserted _after_ the drop, so the tests prove the chain works without
`work_types` rather than alongside it.

**pgTAP — fall-through on a NULL `turnaround_hours`.** A department profile and a type profile each with
`turnaround_hours = null` must fall to the next tier, not return null and not short-circuit. Both new
tiers, individually.

**pgTAP — the backfill (d.9).** A work type whose name matches a department maps to it; one whose name
matches a **team** maps to that team's department (the "Social & Content" case, using the pilot tenant's
actual shape); one matching neither lands in `work_types_retirement_unmapped`; one whose team name is
ambiguous across two departments lands there too rather than being resolved.

**pgTAP — the refusal (d.11).** With an unmapped row present and the flag unset, the migration's drop step
**raises**. With the flag set, it completes and the row is still in the unmapped table. This must be
asserted, not assumed — a guard nobody tested is a guard.

**pgTAP — RLS on the new axes.** `sla_profiles` rows carrying a `department_id` and rows carrying a
`deliverable_type_id`: one allow and one deny each, read tenant-wide, written only by an
`sla_profiles:manage` holder.

**pgTAP — cross-tenant denial on the audit table.** `work_types_retirement_unmapped` carries `tenant_id`;
tenant A must not read tenant B's rows, and no `authenticated` role may insert, update or delete any row in
it.

**pgTAP — provisioning still works (d.8).** Create a tenant through `public.seed_tenant_roles` after the
drop and assert it succeeds and gets its roles. This is the failure mode that would otherwise surface on a
new customer rather than in CI.

**pgTAP — no orphans.** After the migration, no `sla_profiles` row has lost its `turnaround_hours`, and
every `kpi_definitions` row that had a `work_type_id` has either a `deliverable_type_id` or a row in the
unmapped table.

**Unit (Vitest):** the bookings list renders the department in its _Type_ column and a deliberate empty
state where there is none; `useWizardRefData` no longer requests `work_types` and the wizard renders with
clients and brands alone; the SLA profile form submits a department or a deliverable type but never both.

**Manual, and it is not optional:** `booking-transition` is redeployed and a booking is created through the
scheduler against the migrated database (d.13). No test in this repository exercises that function against a
real schema.
