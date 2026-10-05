# ADR-0053: The Discipline label is the department, and the SLA chain gains a department tier

- **Status:** accepted
- **Date:** 2026-08-28
- **Open Decision:** resolves the **label half** of **ADR-0050 d.8**, which recorded the
  `work_types` / `departments` overlap and deliberately left it open. The **deletion half** —
  retiring `work_types` itself — is **ADR-0056**, and is deliberately not decided here.
- **Task(s):** I20
- **Related:** ADR-0050 (the owner, and the department stamped from them), ADR-0051
  (`deliverable_types`), ADR-0055 (changing a deliverable's owner), ADR-0056 (the retirement)

## Context

ADR-0050 moved the organising unit of campaign work from the seeded discipline list to the **person
the Account Manager names as owner**, and stamped `deliverables.department_id` from that person.
Its d.8 then wrote down what it had not resolved: `work_types` and `departments` are two lists for
one thing.

That single open decision contains two changes of wildly different risk. Making the department the
label is **additive**: it adds a tier to a resolver and points three queries at a column that is
already populated. Retiring `work_types` **drops a table**, five FK columns, a seeded function
folded into tenant provisioning, and reaches a deployed Edge Function. There is no reason the
second's risk should hold the first's fix hostage, and there are two live regressions arguing that
it should not.

**This ADR therefore removes nothing.** No table, no column, no function, no tier of the existing
resolver is dropped. It must be safe to accept, migrate and ship entirely on its own.

### Two live regressions, both traceable to one line

ADR-0050's migration `20260827230000_campaign_from_brief_owns_deliverables.sql` rewrote
`create_campaign_from_brief` to create one stream per campaign (`:38-40`):

```sql
insert into streams (tenant_id, campaign_id, name)
values (v_tenant, v_campaign, p_name)
returning id into v_stream;
```

The version it replaced (`20260816090000_add_campaign_brief_and_seed_disciplines.sql:104-107`) set
the column:

```sql
insert into streams (tenant_id, campaign_id, work_type_id, name)
select v_tenant, v_campaign, v_discipline, wt.name
from work_types wt
where wt.id = v_discipline and wt.tenant_id = v_tenant;
```

`streams.work_type_id` is therefore **NULL for every campaign created since that migration reached
production**. Two consequences, both live:

**(a) The Discipline column renders an em-dash.** `deliverables-api.ts` read
`streams!inner(id, name, campaign_id, work_types(name))` and mapped it to `discipline`. With a null
`work_type_id` the embed returns null and the column is empty for every campaign deliverable
created since 27 Aug.

**(b) SLA resolution silently changed.** `app.effective_sla`
(`20260819180000_sla_profiles.sql`) resolves the work type as
`coalesce(j.work_type_id, str.work_type_id)`. A campaign deliverable has no job, so `v_wt` is now
null, and steps 4 and 5 of the six-step chain match nothing:

```sql
-- 4. work type's explicitly-assigned profile
select wt.sla_profile_id into v_wt_profile from work_types wt where wt.id = v_wt;
select turnaround_hours into v_result from sla_profiles where id = v_wt_profile;
if v_result is not null then return v_result; end if;

-- 5. work type's default profile
select turnaround_hours into v_result from sla_profiles
  where work_type_id = v_wt and is_default;
```

Campaign sub-tasks fall through to step 6, the tenant-wide default. Deadlines are still set — they
are simply no longer the ones the tenant configured, and nothing says so. This surfaces only as
"the SLA looks wrong".

Neither was intended by ADR-0050. Both are d.8 doing damage while it stayed open, which is why the
fix half is separated out and taken now.

### The chain as it stands today

Quoted from the function's own comment in `20260819180000_sla_profiles.sql`:

```
--   1. sub_tasks.sla_hours        — manual leaf override (beats everything)
--   2. sub_tasks.sla_profile_id   — leaf profile
--   3. job.sla_profile_id         — project profile (the deliverable's job, if any)
--   4. work_types.sla_profile_id  — the work type's explicitly-assigned profile
--   5. is_default profile for that work type
--   6. is_default profile with work_type_id null — the tenant default
-- A tier whose profile carries a NULL turnaround falls through to the next.
```

Tiers 4 and 5 are the two that stopped matching for campaign work.

### The frontend half is already applied on this branch

Verified 2026-08-28. All three `deliverables-api.ts` query sites now embed `departments(name)` and
map it to `discipline`:

| Query                              | Select                                                                            | Mapped at |
| ---------------------------------- | --------------------------------------------------------------------------------- | --------- |
| campaign deliverables list (`:91`) | `… departments(name), streams!inner(id, name, campaign_id)`                       | `:112`    |
| deliverable + sub-tasks (`:183`)   | `… departments(name), streams(id, name, campaign_id), sub_tasks(…)`               | `:216`    |
| ad-hoc / my-work (`:353`)          | `deliverable:deliverables(id, name, state, revision_round, departments(name), …)` | `:382`    |

The field is still called `discipline` in the TypeScript because eight surfaces read it under that
name; renaming it is cosmetic and is not part of this decision. `campaign-detail-api.ts` no longer
embeds `work_types` at all — its ADR-0048 d.5 leftover was removed with the 28 Aug fix to that
query.

So the label fix is half-shipped: the client reads the department, and the database has not yet
been told that the department is what SLA resolves on. This ADR is what closes that gap.

### The gap nobody has addressed: the label goes stale when a person moves

`app.tg_deliverable_stamp_department` (`20260827220000:33`) fires
`before insert or update **of** owner_user_id`:

```sql
create trigger deliverable_stamp_department
  before insert or update of owner_user_id on deliverables
  for each row execute function app.tg_deliverable_stamp_department();
```

The trigger's only input is `new.owner_user_id`, and it only ever runs when that column is written.
So when a **person** moves from Creative to Production, every deliverable they already own keeps
`department_id = Creative` forever. Nothing restamps it, because nothing wrote `owner_user_id`.

Today that is a wrong word in a table column. After this ADR it is also a **wrong deadline**, because
the department tier resolves on the same stale value. That is the reason it has to be decided here
rather than left as tidying.

ADR-0055 does not cover it: that ADR changes _which person owns a deliverable_, and restamping falls
out of the existing trigger for free. This is the other axis — the owner is unchanged and the
_person's_ department moved.

### Ad-hoc deliverables have no owner, so no label and no department tier

Verified: exactly two functions create deliverables with no `owner_user_id`.

| Function                          | Where                                                         | Owner today                                                              |
| --------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `public.create_adhoc_deliverable` | latest definition `20260827100000_sub_task_reviewers.sql:942` | none — insert is `(tenant_id, job_id, name, state, reviewer_id, due_at)` |
| `public.create_internal_project`  | `20260819230000_create_internal_project.sql:70`               | none — insert is `(tenant_id, job_id, name)`                             |

**The previous draft of this ADR named `save_sub_task`. That is wrong** — `save_sub_task`
(`20260827100000:984`) creates no deliverables at all; it only writes `sub_tasks`. The two functions
above are the whole set (`grep "insert into deliverables" supabase/migrations/*.sql`, 2026-08-28).

For ad-hoc work the missing owner is an oversight rather than a real absence. `create_adhoc_deliverable`
already **requires** an assignee, already refuses a null one, and already resolves that person's
placement two statements before it inserts the deliverable:

```sql
select department_id, team_id into v_dept, v_team
from user_profiles where id = p_assignee and tenant_id = v_tenant;
```

An ad-hoc deliverable has exactly one sub-task and exactly one assignee. The person accountable for
it is not ambiguous; the column simply was never set.

`create_internal_project` is genuinely different: its `p_pm` parameter is `default null`, so an
internal project may be created with no PM appointed, and its deliverables are a jsonb list with no
per-row person on them.

### Options weighed

**(a) Take d.8 whole — label and retirement in one ADR.** What the previous draft did. Rejected: it
bundles a fix with no risk into a change that drops a table, five FK columns and a deployed Edge
Function's write. Neither half can then be accepted without the other, and the half that fixes two
live regressions is the one that waits.

**(b) Replace tiers 4–5 of `effective_sla` outright in this ADR.** Tempting, because those two tiers
are the ones that stopped working. Rejected: `sla_profiles.work_type_id` is writable from
`/sla-profiles` today (`sla-api.ts:96`, `SlaProfilesPage.tsx:41`), so a tenant may hold profiles that
still resolve for job-backed work. Removing the tiers would be a silent removal of working behaviour
inside an ADR whose whole premise is that it removes nothing. They stay as a deprecated tail beneath
the new tiers and are removed by ADR-0056 with the column they depend on.

**(c) Fix the label in the client only and leave SLA alone.** Already half-done, and it is what makes
regression (b) invisible: the screen looks right and the deadline is still wrong. Rejected — the
column and the resolver have to agree, or the next person to look assumes the fix landed.

**(d) Accept the stale label as history.** A real position — "this deliverable was owned by Creative
at the time" is a defensible record. Rejected for live work, accepted for finished work; see d.5.

> **AMENDMENT, 2026-08-28 — d.2 and d.4 are GATED on ADR-0032.**
>
> This ADR specifies a seven-tier resolution chain for `app.effective_sla`. **ADR-0032 is the
> canonical ADR for SLA and accountability, and it is not finalised.** Its open decisions include
> OD 6 (how SLA outcomes roll into a metric) and OD 7 (whether non-creative roles need an SLA at
> all — which determines *whether there is one engine or several*). Specifying the chain before
> OD 7 is answered decides in passing something ADR-0032 exists to decide.
>
> **d.2 (the two new tiers) and d.4 (the `sla_profiles` columns) therefore do not ship until
> ADR-0032 is agreed.** `I20.2` and `I20.3` are gated accordingly.
>
> **Nothing else in this ADR is affected.** d.1 (the label reads the department) is already merged;
> d.5 (restamp on department change) and d.6 (ad-hoc deliverables take their assignee as owner)
> stand on their own and are worth doing without the SLA half.
>
> The regression this ADR was written to fix is **half as urgent as it first appeared**:
> `app.effective_sla` has no callers, and the pilot holds a single profile with
> `is_default = false`, so no deadline is being resolved through the chain at all.

## Decision

**d.1 The Discipline label is the department.** `deliverables.department_id` — already stamped from
the owner by ADR-0050 d.2 — is the source of the label everywhere "Discipline" is rendered, in place
of `streams.work_types(name)`. The label is thereafter **the tenant's own department name**, authored
on `OrganizationPage`, never one of six seeded words. The three `deliverables-api.ts` query sites are
already on `departments(name)`; nothing further is required of the client for this decision.

**d.2 `app.effective_sla` gains a department tier, and a deliverable-type tier above it.** The chain
becomes:

```
1. sub_tasks.sla_hours              — manual leaf override (beats everything)
2. sub_tasks.sla_profile_id         — leaf profile
3. job.sla_profile_id               — project profile (the deliverable's job, if any)
4. deliverable type                 — explicit profile, then is_default for that type
5. department                       — is_default profile for the deliverable's department
6. work type                        — DEPRECATED TAIL: explicit, then is_default (removed by ADR-0056)
7. tenant default                   — is_default profile with every axis null
```

The fall-through rule is unchanged: a tier whose profile carries a NULL `turnaround_hours` falls to
the next. Tier 6 is the existing tiers 4–5 kept verbatim and moved below the new ones, so **nothing
that resolves today stops resolving**; ADR-0056 deletes it along with `sla_profiles.work_type_id`,
leaving the six-tier chain that is the actual target.

**d.3 The department is resolved from the deliverable, never from the stream or the job.**
`effective_sla` reaches it as `deliverables.department_id` on the sub-task's own deliverable. It does
not consult `streams`, and `bookings.work_type_id`'s comment — _"null ⇒ never enters SLA machinery"_ —
is preserved in behaviour, because SLA has never resolved through a booking and still does not.

**d.4 Tier 5 needs new columns on `sla_profiles`, added additively.** `sla_profiles` gains a nullable
`department_id` (and, with tier 4 of d.2, a nullable `deliverable_type_id` — see d.10). `work_type_id`
is **kept**. A CHECK
constraint allows **at most one** of the three axes to be set; a profile with all three null remains
the tenant default, exactly as now. One partial unique index and one plain index per new axis, matching
the existing `uq_sla_profile_wt_default` / `idx_sla_profiles_work_type_id` pair, which are both left in
place. No existing row changes.

**d.5 A person changing department restamps their live deliverables; finished ones keep the department
they were delivered under.** A new `after update of department_id on user_profiles` trigger restamps
`deliverables.department_id` for every deliverable that person owns whose `state` is **not** `delivered`
or `archived`.

The reasoning: the label is answering _"which department is doing this work"_, not _"who owned it in
March"_. Once the department tier is live, a stale value is a deadline computed against a department
that no longer contains the owner — a wrong answer, not a historical one. For work that is already
delivered or archived, the opposite holds: nothing is being scheduled, no deadline is being computed,
and the row is a record of what happened. Restamping it would rewrite history to tidy a column.

Terminal-state rows are therefore permitted to disagree with their owner's current department, and
that is stated here so it is not later filed as a bug. The restamp is a data correction, not an
ownership change: it does not notify anybody and does not touch `owner_user_id`, sub-task assignees,
their departments, or their bookings.

**d.6 An ad-hoc deliverable's owner is its single assignee.** `create_adhoc_deliverable` sets
`owner_user_id := p_assignee` on the deliverable it inserts. Department follows from the existing
stamp trigger — no new parameter, no new input, and no new question asked of anybody. The function
already requires the assignee and already reads their `department_id`, so the data is in scope at the
insert.

This gives ad-hoc work a Discipline label and a department SLA tier for the first time. It does **not**
give it a second person: the assignee and the owner are the same human, which is the honest description
of a deliverable with exactly one task on it. The no-self-review rule is untouched — reviewer and
assignee remain distinct, and the owner is not a reviewer.

**d.7 `create_internal_project` sets the deliverable owner to the appointed PM when there is one.**
`p_pm` is already written to `jobs.owner_user_id` (`20260819230000:63`) and is already the person
accountable for the project. Where `p_pm` is null — which the signature permits — the deliverables are
created with no owner and no department, and fall to the tenant default exactly as they do today. This
is a partial answer and is stated as one: an internal project created without a PM has nobody to derive
a department from, and inventing one would be the "derive-don't-ask" rule inverted into a guess.

**d.8 `owner_user_id` stays nullable.** d.7 leaves a legal ownerless path, so the column keeps its
nullability and `tg_deliverable_stamp_department`'s null branch (`owner null ⇒ department null`) stays
exactly as written.

**d.9 Nothing is dropped by this ADR.** `work_types` keeps its table, its five FK columns, its seed
function and every one of its readers. `sla_profiles.work_type_id` keeps its column, its index, its
unique index and its tier.

**Correction, 28 Aug:** an earlier draft said the two `work_types.brief_type` call sites were "left
alone". **They are already gone** — `useDisciplineMappings` and `useSetDisciplineTemplate`, and the
admin mapping table that called them, were deleted on this branch alongside the campaign-page fix,
because they read a column that has never existed and made two screens fail with PostgREST 42703. That
deletion is not part of this ADR and is not a regression this ADR causes; it is recorded here only so
that neither this ADR nor ADR-0056 is read as describing code that still exists.

**d.10 Sequencing against ADR-0051.** Tier 4 of d.2 needs `deliverable_types` and
`deliverables.deliverable_type_id`, which are ADR-0051's. This ADR's migration is therefore **ordered
after ADR-0051's**, and ships with tier 4 included.

If ADR-0051 is not accepted, tier 4 is **omitted entirely, not stubbed**, and the chain ships as five
tiers plus the deprecated work-type tail. A stub — a tier written against a table that does not exist,
or one that resolves to nothing by construction — is precisely the failure this ADR is fixing in
regression (b): a tier that matches nothing and says nothing about it. Half a chain that is honest is
better than a whole one that lies.

## Consequences

### Easier

- The blank Discipline column and the silent SLA fall-through, both live on production today, are
  fixed — the first change to address either.
- SLA gains a department axis it never had. A tenant can now say _"anything Creative touches defaults
  to 48 hours"_, which today cannot be expressed at all.
- The label becomes the tenant's own department name. A customer who calls their department "Studio"
  sees "Studio".
- Ad-hoc work gets a label and an SLA tier it has never had, from data the function was already
  holding.
- Every one of these is reversible by dropping two columns and restoring one function body. There is
  no data loss anywhere in this ADR.

### Harder

- `app.effective_sla` is rewritten and temporarily carries **seven** tiers, one of which is marked
  deprecated on the day it ships. That is an untidy state and it is the price of not deleting anything
  here; ADR-0056 removes it.
- `sla_profiles` grows two nullable columns and a CHECK constraint, and the admin surface at
  `/sla-profiles` will offer a work-type picker (existing), a department picker and a type picker for
  as long as all three axes exist. Which axis wins is answered by the chain order, and the screen must
  say so rather than leaving a user to guess.
- One more trigger on `user_profiles`. A department change on a person with a large portfolio now
  writes a row per live deliverable, and each of those writes goes through the universal audit trigger.
- d.6 changes the meaning of `deliverables.owner_user_id` for ad-hoc rows from "always null" to "the
  assignee". Anything that inferred "ad-hoc" from a null owner would now be wrong. Verified 2026-08-28:
  no surface reads `deliverables.owner_user_id` back from the database — the wizard only _writes_ it,
  as `ownerUserId` into `create_campaign_from_brief` — and no migration branches on it. Stated here so
  the assumption cannot quietly be made later.
- **ADR-0055 d.8 needs a one-line correction on acceptance.** It says _"Ad-hoc and internal-project
  deliverables have no owner (see ADR-0053)"_. After d.6 that is true only of internal-project
  deliverables created without a PM. Its conclusion — that `owner_user_id` stays nullable — is
  unaffected and correct, per d.8 above.

### Locked in

- **The label is derived from a person, never seeded and never asked for.** Naming an owner answers
  which department the work belongs to; the pair can never be half-set, because the trigger always wins.
- **SLA resolves on the deliverable, never on the booking or the stream.**
- **A deliverable's department follows its owner while the work is live, and freezes when the work is
  finished.** Terminal-state rows are allowed to disagree with the current org chart.
- Retiring `work_types` remains **open**, and remains ADR-0056's decision. Nothing here forecloses it,
  and nothing here depends on it.

## Cost

Moderate, and front-loaded into tests rather than code. One migration: two nullable columns and a CHECK
on `sla_profiles`, two new tiers inside `app.effective_sla`, one restamping trigger on `user_profiles`,
and one line in `create_adhoc_deliverable`. The frontend half is **already done** — all three
`deliverables-api.ts` query sites read `departments(name)` as of 28 Aug.

The real cost is confidence in `app.effective_sla`. It is a seven-tier fall-through that decides
deadlines for every task in the system, it has one existing pgTAP suite, and this ADR adds two tiers in
the middle of it. The Testing section below is deliberately longer than the change.

No data migration, no backfill, no drop — those are ADR-0056's, which is the whole reason the two were
split.

## Testing

pgTAP, in the same migration's paired test file:

- **The new chain, tier by tier.** Seven assertions: a sub-task with `sla_hours` set beats everything;
  a leaf profile beats a job profile; a job profile beats a type profile; a type profile beats a
  department profile; a department profile beats a work-type profile; a work-type profile beats the
  tenant default; and with none of them set the tenant default is returned.
- **Fall-through on a NULL `turnaround_hours`.** A department profile with `turnaround_hours = null`
  must fall to the next tier, not return null and not short-circuit. Asserted at the department tier
  specifically, because it is the new one.
- **The regression that started this.** A campaign deliverable created through
  `create_campaign_from_brief` — no job, no `streams.work_type_id` — resolves to its department's
  profile and **not** to the tenant default.
- **The restamp (d.5).** Moving a user's `department_id` restamps a `draft` and an `in_progress`
  deliverable they own, leaves a `delivered` and an `archived` one alone, and touches no sub-task
  assignee, department or booking.
- **Ad-hoc (d.6).** `create_adhoc_deliverable` returns a deliverable whose `owner_user_id` is the
  assignee and whose `department_id` equals that assignee's department; its sub-task resolves the
  department SLA tier.
- **Internal projects (d.7).** With a PM the deliverables carry that PM as owner; with `p_pm` null they
  are created ownerless with a null department and resolve to the tenant default.
- **RLS on the new axes.** `sla_profiles` rows carrying a `department_id` are readable tenant-wide and
  writable only by an `sla_profiles:manage` holder — one allow and one deny each, and a **cross-tenant
  read denial** on a profile pointing at another tenant's department.
- **The CHECK holds.** A profile setting two axes at once is refused.

Unit (Vitest): `deliverables-api`'s three query sites map `departments(name)` to `discipline` and
render a deliberate empty state, not an em-dash, when a deliverable has no department.
