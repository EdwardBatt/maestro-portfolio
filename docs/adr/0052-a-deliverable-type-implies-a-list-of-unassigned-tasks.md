# ADR-0052: A deliverable type implies a list of unassigned tasks

- **Status:** accepted — **d.10 part 1 superseded for sign-off by [ADR-0118](0118-a-deliverable-is-approved-only-when-every-task-is.md) (27 Sep): an unassigned task holds its deliverable open like any other**
- **Date:** 2026-08-28
- **Open Decision:** — (specified by Edward, 28 Aug)
- **Task(s):** **I19** (new) — the two tables, the seed, the materialiser, the gate change, the
  metric and the template editor. ADR-0051 claims I18; `docs/TASKS.md` is edited **on acceptance**,
  per the ADR process, and I19 is claimed there by this ADR alone.
- **Depends on:** ADR-0051 (`deliverable_types`, and d.15's deferred foreign key, which this ADR's
  migration must add).
- **Relates to:** ADR-0050 (deliverable owner, and why a seeded list must not be structural),
  ADR-0043 (multiple reviewers), ADR-0038 (a task is approved, a deliverable is signed off),
  ADR-0030 (soft dependencies), ADR-0048 d.8 (the campaign approval gate, and the rule about where a
  rule lives), ADR-0040/0041 (assignment needs authority; role reach is chosen, not defaulted),
  ADR-0039/0042 (the task owns its dates), ADR-0024 (the deliverable transition graph).

## Context

Two reference documents landed on 28 Aug: `docs/reference/Agency Deliverable Taxonomy.md` and
`docs/reference/Production_Traffic_and_Asset_Management_Model.docx`. Between them they describe
fourteen production pipelines of eight to sixteen stages each. The system today runs every
deliverable — a billboard, a TVC, an Instagram Reel — down the same six-step path.

The gap is not cosmetic. When a producer looks at a TVC that reads `in_progress`, that state is true
from the day the script is commissioned to the day it is colour-graded. Two months, one word.

### What Edward specified

> _"all of them up front, unassigned is a metric we need. The task list can be edited … so when a
> brief is presented prior to approval, additional tasks can be added where required, and tasks can
> be removed, resequenced… etc."_

And the constraint that governs everything here, repeated across ADR-0050, ADR-0051 and again on 28
Aug:

> _"you are relying on seeded departments … not client defined departments … by mapping to seeded
> departments you are taking a solution and telling users how to structure their organisation."_

That is the load-bearing objection, and it killed the first draft of this decision. That draft put a
`responsible_department_id` on each seeded workflow stage — "Shoot → Production", "Grade → Art &
Video". To ship the seed at all, the seed would have had to invent departments, and every tenant
would have inherited the invention. A seeded template cannot name a department for the same reason a
model cannot name an owner (ADR-0050 d.6): it does not know, and guessing wrong is somebody's week.

### The mechanism that already answers it

Department and team are **derived from the person a human picks**, and this is live. From
`public.create_adhoc_deliverable`:

```sql
-- the assignee's placement, checked against the caller's write scope.
select department_id, team_id into v_dept, v_team
from user_profiles where id = p_assignee and tenant_id = v_tenant;
```

ADR-0050 d.2 does the same for the deliverable, from its owner
(`app.tg_deliverable_stamp_department`, `20260827220000`). So the organisational question is already
answered at the two points where a human makes a choice, and nothing seeded needs an opinion about
it. A TVC whose script, shoot and grade go to three different departments is not a special case — it
is three sub-tasks with three assignees, and the departments follow.

**One honest qualification, verified on 28 Aug.** For campaign work the derivation is done in the
browser, not the database: `DeliverablesPage.tsx:345` looks up the picked user and passes
`departmentId`/`teamId` into `public.save_sub_task`. `public.update_task_assignment` — the other
assignment path — does **not** restamp them, so a task reassigned from that path keeps the
department it had. That is an existing gap, not one this ADR creates; d.5 and the Testing section
name it because materialising tasks up front makes it far more common than it is today.

### What the second draft got wrong, and what the code actually says

The second draft proposed a `deliverable_stages` table: a parallel state machine, per-deliverable
stage rows, a rollup column mapping each stage to one of the seven `deliverable_state` values.

That was building a second system beside the real one. `sub_tasks` already carries status, assignee,
reviewers (ADR-0043), required resources (ADR-0042), start and due dates, SLA resolution and time
entries. A stage **is** a task. Edward's correction:

> _"the deliverables is broken into sub-tasks which is how the actual work is assigned. you have
> missed this completely."_

Reading the code afterwards produced a more useful finding still. **Unassigned sub-tasks are already
supported end to end.** Every layer was re-verified on 28 Aug:

| Layer                  | Evidence                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Column                 | `sub_tasks.assignee_id` is nullable                                                                                  |
| RPC                    | `public.save_sub_task` takes `p_assignee uuid default null` and has **no** assignee check (`20260827100000:990`)     |
| Hook                   | `useUpsertSubTask` sends `p_assignee: args.assigneeId ?? null` (`deliverables-api.ts:487`)                           |
| Form                   | the add-task form's assignee `<select>` opens on `<option value="">unassigned</option>` (`DeliverablesPage.tsx:446`) |
| Read                   | `DeliverablesPage.tsx:384` renders `s.assigneeName ?? t('deliverables.unassigned')`                                  |
| Reviewer seeding       | `app.tg_subtask_seed_reviewer` returns early when `new.assignee_id is null`                                          |
| Reviewer rule          | `app.tg_sub_task_reviewer_required` fires only `if v_assignee is not null`                                           |
| Scheduler              | `subtask-schedule` returns early when `!st.assignee_id` — no booking, no error                                       |
| Campaign approval gate | `app.tg_sub_task_assignment_gate` returns `new` when `new.assignee_id is null` (`20260827210000:70`)                 |

**A correction to an earlier draft of this table.** It claimed `DeliverablesPage` _filters_ on
unassigned. It does not. Line 446 is the assignee `<select>` inside the add-task form, and line 384
is a rendered cell. There is no unassigned filter anywhere in `src/`. d.11 says what building the
metric actually costs, now that the free lunch has been withdrawn.

Edward's own guess was right:

> _"the intent for a mandatory assignee on a task was to allow ad-hoc tasks to be created (I think),
> but sub-tasks should be either unassigned or assigned."_

The two functions that **do** raise `'an assignee is required'` are `create_adhoc_deliverable` and
`update_task_assignment`. Both are correct as they stand: the first is the ad-hoc path, where
somebody is being handed work then and there; the second **is** the assignment path. Neither is
`save_sub_task`, and neither needs changing.

### The deadlock an independent verifier found in the third draft

The third draft said, in the same document, both that every deliverable is seeded with its whole
task list unassigned **and** that `app.tg_deliverable_transition_guard` is untouched. Those two
statements cannot both hold. From the live guard
(`supabase/migrations/20260824140000_task_approval.sql:200-213`):

```sql
if new.state = 'in_review' then
  if exists (select 1 from sub_tasks st
             where st.deliverable_id = new.id and st.status in ('todo', 'in_progress', 'blocked')) then
    raise exception 'deliverable: every sub-task must be submitted before in_review (open sub-tasks remain)' …
if new.state = 'approved' then
  if exists (select 1 from sub_tasks st
             where st.deliverable_id = new.id and st.status not in ('done', 'cancelled')) then
    raise exception 'deliverable: every sub-task must be APPROVED before sign-off (ADR-0038)' …
```

An unassigned task sits at `todo`, and every supported way out of `todo` is closed to it:
`app.sub_task_start` raises `'only the assignee may start this task'` (`20260819130000:47`,
re-emitted `20260819160000:109`) and `app.sub_task_submit` raises `'only the assignee may submit this
task'` (`20260824150000:68`). So a deliverable seeded with sixteen unassigned tasks reaches neither
`in_review` nor `approved` **for anyone using the product as designed**. The feature this ADR exists
to add would have bricked the deliverable lifecycle on the day it shipped.

**"Ever, by any route" is too strong, and the exception is worth having on the record.** An earlier
draft said it; verification says otherwise. There is no status-transition trigger on `sub_tasks` —
only the value CHECK at `20260819160000:11-13` and the deliberately narrow
`sub_task_completion_guard`, which polices the single value `done` and says so in its own comment:
_"This is not a transition guard: it says nothing about todo → review or about cancellation"_
(`20260827100000:555-556`). The same file records the underlying fact even more plainly at
`:547-551`: _"nothing on sub_tasks polices which status they may progress it to."_ Meanwhile
`sub_tasks_manage_update` (`20260819100000:193`) lets any `project_tasks:manage` holder in write
scope update any column, and `public.save_sub_task` writes `status = coalesce(p_status, status)` with
no assignee check and no transition validation (`20260827100000:1048`). So `PATCH /sub_tasks
{"status":"cancelled"}` works, `save_sub_task(… p_status => 'cancelled')` works, and
`public.sub_task_cancel` (`20260824180000:40`) is a supported, scope-checked, audited path that does
the same thing one task at a time. **Cancelled tasks hold neither gate.** The escape from the
deadlock exists: cancel all sixteen.

That is a workaround and not a workflow — it records "this work was cancelled" about work nobody was
ever going to do — so the deadlock still had to be solved. But it establishes something d.10 depends
on: **the ADR-0038 guarantee was already softer than its own sentence.** "Every sub-task APPROVED
before sign-off" has always read, in the SQL, as _not in (`done`, `cancelled`)_ — approved **or**
cancelled — and `cancelled` has always been writable directly, policed by no transition check at all.
What d.10 loosens is a guarantee that was never as hard as it sounded.

**Edward's decision, 28 Aug:** unassigned tasks do **not** hold the gate — an unassigned task is a
plan, not outstanding work — **but the transition says so**: _"3 tasks were never assigned —
continue anyway?"_ That is warn-and-proceed, the same shape he required for non-working-day bookings
(`I17`, `docs/TASKS.md:845`), and the same shape `AGENTS.md` §5 already states as a principle:
_"capacity/soft violations inform and let the user proceed; hard invariants … are enforced by the
database, not the UI."_ d.10 works out exactly where each half lives, because "it warns" is the kind
of sentence that gets implemented as nothing at all.

### The campaign approval gate already permits the editing this needs

ADR-0048 d.8 gates assignment and booking on campaign approval. Its own comment, verified verbatim
in `supabase/migrations/20260827210000_campaign_approval_gate.sql:68`:

> ```sql
> -- Only an ASSIGNMENT is gated. A pending campaign's tasks can still be created, renamed and
> -- re-dated while the account manager reads them — that is what reviewing is.
> ```

Which is exactly the workflow Edward described: the task list is laid down, reviewed, edited and
resequenced while the campaign is `pending_approval`, and only becomes somebody's week on approval.
That gate was written a day before this requirement was stated and needs no change to serve it.

### Options weighed

**A parallel stage table (`deliverable_stages`) with a rollup to `deliverable_state`.** Drafted
first, rejected. It duplicates `sub_tasks` — every field it needed, `sub_tasks` already has — and it
would have produced two places to look for "what is happening on this deliverable", which diverge
the first time someone adds a task by hand. Its one apparent advantage, that stages could be
lighter-weight than tasks, is not an advantage: a stage that nobody can be assigned to, book time
against or review is not a stage anyone can run a production department on.

**Widening `deliverable_state` to carry the stage names.** Rejected. The fourteen templates yield
roughly sixty distinct stage names. As enum values they would be global across tenants — which
defeats the flexibility this ADR exists to provide — every one needs a row in the transition graph
in `app.tg_deliverable_transition_guard`, and every consumer of `state` (Pipeline, dashboards, My
Work, SLA, KPIs) would have to learn all sixty.

**All tasks up front vs. revealed as the chain progresses.** Edward chose all up front. A producer
wants the shape of the job visible on day one; a list that unfolds one step at a time cannot be
reviewed before approval, which is the point of the approval gate. The cost is that a deliverable
starts life with eleven open tasks and nobody on any of them — which is why the unassigned count has
to be a metric rather than a curiosity, and why the gate has to be reasoned about rather than
assumed.

**Merging the taxonomy and production pipelines where they overlap.** Rejected after reading both,
and after counting the steps rather than eyeballing the headings.

| Pair        | Taxonomy                         | Production model      | Relationship                                                                                                                                                              |
| ----------- | -------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Video       | WF-03 Video Production, 14 steps | LONG FORM, 16 steps   | **Neither contains the other.** LONG FORM adds Physical Media, Ingest, Backup, Archive; WF-03 has Concept, Script, Storyboard, Sound and Grade, which LONG FORM does not. |
| Photography | WF-04 Photography, 9 steps       | PHOTOGRAPHY, 12 steps | Same both ways. PHOTOGRAPHY adds Physical Media, Ingest, Amendments, Final Export, Archive; WF-04 has Creative Direction and Pre-production, which PHOTOGRAPHY does not.  |

An earlier draft called the production variants "supersets". They are not, and the corrected fact
argues the case more strongly: merging either pair would lose stages **in both directions**. The
production variants add physical-media custody; the taxonomy variants keep creative development. An
agency that outsources production wants WF-03; one that owns cameras wants LONG FORM; a shop doing
both wants both, on different jobs. Seeding both and letting the tenant pick is the same principle
as not seeding departments: offer the vocabulary, do not impose the shape.

**Where the "which steps repeat for quantity 6?" question went.** ADR-0058 answers it, and not the
way an earlier draft of ADR-0051 did. A quantity does **not** expand into separate deliverables:
"Instagram Reel × 6" is one deliverable holding six sub-tasks, each with its own artefact, its own
reviewers and its own approval, and the deliverable approves itself when the last of them lands.

So a template runs **once per deliverable**, and its steps are the shape of the work; where a step
produces N separately reviewed artefacts, that step carries N sub-tasks. No stage "repeats" in the
template — the template is not where quantity lives.

## Decision

**d.1 — A workflow template is a checklist of work to create. Nothing more.** It names _work_ —
"Storyboard", "Prepress", "Colour grade" — and never a person, department, team or role. No seeded
row introduced by this ADR refers to organisational structure of any kind. This is ADR-0050's line
and ADR-0051 d.14's line, held for a third table.

**d.2 — Two tenant-scoped tables, keyed on a code, in Arabic as well as English.**

```
workflow_templates (id, tenant_id, code, name_en, name_ar, description_en, description_ar,
                    is_system, is_active, created_at, updated_at)   unique (tenant_id, code)
workflow_steps     (id, tenant_id, template_id, sort_order, title_en, title_ar,
                    description_en, description_ar, default_hours numeric null,
                    is_active, created_at, updated_at)              unique (tenant_id, template_id, sort_order)
```

RLS enabled and forced in the same migration (`AGENTS.md` §4/§6). **Read by every member of the
tenant** — a picker that cannot read its list cannot render — and **written under
`organization:manage`**, the same authority that already writes `roles`, `offices`,
`brief_templates` and, per ADR-0051 d.3, `deliverable_types`. There is no new permission.

`code` is the key and `name_en` is not, for ADR-0051 d.4's reason: names get renamed and the seed
has to find its own rows again. `name_en` and `title_en` are `not null`; the Arabic columns are
nullable and fall back to English at render time. **The seed ships English only, and that is a
recorded debt, not a design** — identical to ADR-0051 d.6, and for the same reason: "Prepress",
"Rough Cut" and "Fine Cut" are not dictionary lookups, and this ADR does not have a native Arabic
speaker who knows the trade.

`is_system` marks a seeded row so a later seed refresh can find it and so the Admin screen can warn
before a tenant edits one.

**The column is `sort_order`, not `sequence`.** `sequence` is a Postgres keyword; it is legal
unquoted, but it reads as DDL in every query that mentions it and it has to be quoted the moment
anything builds SQL around it. An earlier draft of this decision left ADR-0051's `sequence` columns
alone on the grounds that accepted ADRs are immutable. **ADR-0051 is `proposed`, not accepted**, so
that reasoning did not apply and the reconciliation has been made rather than noted: ADR-0051 d.5 and
d.10 now name `sort_order` on `deliverable_categories` and `deliverable_attribute_values`, and all
three tables agree.

**This migration also discharges ADR-0051 d.15.** `deliverable_types.default_workflow_template_id`
was added there as a bare `uuid` with no foreign key, because `workflow_templates` did not exist
yet. The migration that creates `workflow_templates` runs, in the same file:

```sql
alter table deliverable_types
  add constraint fk_deliverable_types_workflow_template
  foreign key (default_workflow_template_id) references workflow_templates(id);
```

**d.3 — Fourteen seeded templates, 154 steps, and the overlapping pairs stay separate.** WF-01…WF-10
from the taxonomy document (8, 8, 14, 9, 11, 11, 12, 11, 11, 12 steps — 107) plus LONG FORM (16),
SHORT FORM (11), PHOTOGRAPHY (12) and ADAPTATION / VERSIONING (8) from the production model §4 — 47.
**154 seeded step rows per tenant**, counted from the two documents rather than estimated. The
overlapping pairs are kept separate for the reason recorded above. Every seeded template is
editable, renameable and deactivatable by the tenant.

**Seeded by `app.seed_tenant_workflow_templates(uuid)`, folded into the `public.seed_tenant_roles`
provisioning wrapper**, exactly as `app.seed_tenant_brief_templates` was (`20260827200000`) and
`app.seed_tenant_deliverable_types` will be (ADR-0051 d.2). **Idempotent and non-destructive: `on
conflict (tenant_id, code) do nothing` on templates and `on conflict (tenant_id, template_id,
sort_order) do nothing` on steps.** A re-run adds what a tenant does not have and overwrites nothing
they have edited. An earlier draft left this rule to be written "when the seed is first updated"; it
is written now, because the first seed update is exactly when nobody will remember it was
outstanding.

**d.4 — What a template does to a task.** `sub_tasks` gains two nullable columns: `sort_order
integer` and `workflow_step_id uuid` referencing `workflow_steps(id)`. A task added by hand carries
neither and behaves identically in every surface — the template is a convenience, never a
requirement. Reads order by `sort_order nulls last, created_at`.

**Never twice, held by the database:** `create unique index uq_sub_tasks_workflow_step on sub_tasks
(deliverable_id, workflow_step_id) where workflow_step_id is not null`. The materialiser also has a
`where not exists` guard, but the index is what makes "never duplicates" true for a caller that goes
round the materialiser.

**`workflow_steps.default_hours` is wired, and it is deliberately NOT written into
`sub_tasks.sla_hours`.** An earlier draft had materialisation copy it there, on the grounds that
`sla_hours` is "the task's own hours" — what `subtask-schedule` spreads a booking over
(`supabase/functions/subtask-schedule/index.ts:277,298`) and what `update_task_assignment` accepts as
`p_hours`. That is true of one of the column's two jobs, and fatal to the other.

**The chain that write would have defeated.** `sub_tasks.sla_hours` is **tier 1 of
`app.effective_sla`** — _"manual leaf override (beats everything)"_, in the resolver's own comment
(`20260819180000:43`) — and a non-null value returns immediately, consulting no profile at all.
ADR-0053 d.2 extends that chain to seven tiers, inserting a **deliverable-type** tier and a
**department** tier above the deprecated work-type tail that ADR-0056 then removes. If materialisation
writes `default_hours` into `sla_hours`, then the moment a tenant fills in the step defaults this
decision explicitly invites them to fill in — which is the entire reason the column exists — every
materialised task short-circuits tiers 2 through 7. After this ADR most tasks _are_ materialised
tasks, so the two tiers ADR-0053 exists to add would be unreachable for most of the work in the
system, silently. Three ADRs touch that resolver; none of them noticed.

**A second reason, found while verifying the first: these are not the same kind of number.**
`sla_hours` is read as **effort** by everything live — `subtask-schedule` spreads it across working
days, `schedule-api.ts:422` calls it _"total effort (sla_hours) for the task"_, and
`requirement-allocation.ts:15` says the same — whereas `sla_profiles.turnaround_hours`, which every
other tier of `effective_sla` returns, is **committed elapsed turnaround**. Tier 1 already conflates
the two; that predates this ADR and is not fixed here. But `default_hours` — "how long a Fine Cut
takes" — is unambiguously an effort estimate, and pushing an effort estimate into a turnaround
resolver is the same category error one level down.

**So materialisation leaves `sla_hours` null, always.** The step default reaches the task through the
`workflow_step_id` join d.4 already adds, and it is consumed at **assignment** — the moment a person
decides who does this work and what it is worth in hours. The assignment surface prefills the hours
field from the step default, visibly labelled as coming from the template, and whatever the assigner
accepts or edits is what `update_task_assignment` writes. Tier 1 then holds only what its own comment
says it holds: a number a human put on this one task.

**`app.effective_sla` is not touched by this ADR, and no tier is added for `default_hours`.** Not
touched, because ADR-0053 rewrites that same function and two migrations editing one resolver is
exactly how a tier goes missing. No tier, because of the distinction above: a step's effort estimate
does not belong in a chain of committed turnarounds.

**The residual, stated rather than glossed.** An assigner who accepts the prefilled number without
thinking still lands a value in `sla_hours` and still short-circuits the chain for that task. That is
materially different from the write this decision rejects — per task, on work somebody is actually
taking on, in front of a person who saw the number, rather than automatically on every task in the
system — but it is the same mechanism. If the deliverable-type and department tiers prove to matter
more than the convenience, the prefill is the thing to drop, and dropping it changes one surface
rather than a migration.

`default_hours` is nullable, and **every seeded step ships it null**: how long a Fine Cut takes is a
fact about this agency's editors, not something a vendor can seed, and a seeded number would be the
`work_types` mistake in units of hours. The column exists so a tenant can fill it in from their own
history and stop retyping it on every job. An earlier draft carried it with no writer and no reader —
the exact fault ADR-0051 diagnoses in quantity-in-jsonb — and it now has both: the Admin template
screen writes it, the assignment surface reads it.

**d.5 — Materialisation runs in one function, and a trigger is what calls it.**

The engine is `app.materialise_deliverable_workflow(p_deliverable uuid, p_template uuid default
null) returns integer` — the number of tasks created. It resolves the template (the argument, else
the deliverable's type's `default_workflow_template_id`), creates one `sub_tasks` row per active
`workflow_steps` row that the deliverable does not already have, and returns the count. Tasks are
created `todo`, `assignee_id` null, no reviewers, `sort_order` and `workflow_step_id` from the step,
and **`sla_hours` null** — never `default_hours`, for the reasons in d.4.

**The automatic caller is a trigger, not an RPC:** `deliverable_materialise_workflow`, `after insert
or update of deliverable_type_id on deliverables`, firing only when `deliverable_type_id` is newly
non-null, its type has a `default_workflow_template_id`, and the deliverable has no
`workflow_step_id` tasks yet. This is the whole reason it is a trigger. A plain `PATCH
/deliverables?id=eq.… {"deliverable_type_id": "…"}` from PostgREST calls no RPC, and an RPC-only
design would have set the type and silently created nothing — the exact failure ADR-0048 d.8 records
about ADR-0043's reviewer rule, where the check lived in a function and a plain table update walked
round it.

**`create_campaign_from_brief` needs no change, and that is the point.** It inserts a `deliverables`
row per line (`20260827230000:46`); once the wizard passes `deliverable_type_id` (ADR-0051's
change), the `after insert` branch fires per row and the campaign arrives with every deliverable's
task list already laid out for the Account Manager to review before approving. An RPC-based design
would have required editing that function, and would have been forgotten by the next function that
inserts a deliverable.

**`app.materialise_deliverable_workflow` is `security definer` with `set search_path = public, app,
extensions`,** per `AGENTS.md` §6, and here is why the bypass is safe and why invoker rights do not
work:

- **The authorisation happens one level up.** To reach the trigger you must already have been
  allowed to insert or update that `deliverables` row, which the `deliverables` policies decide.
  Creating the tasks is a mechanical consequence of an act that was authorised, in the same way
  `app.tg_deliverable_stamp_department` (`security definer`, ADR-0050 d.2) stamps a department as a
  consequence of naming an owner.
- **What it writes cannot hurt anyone.** The rows are unassigned, unbooked, unreviewed. They consume
  no capacity, name no person, and cannot pass the campaign approval gate or reach `review` until a
  human assigns them through the ordinary, fully-checked path.
- **Invoker rights would refuse callers who are plainly entitled — though not the ones an earlier
  draft named.** `sub_tasks_manage_insert` (`20260819100000:181`) requires
  `app.in_write_scope(department_id, team_id, …)`, and `app.in_write_scope`
  (`20260824120000:81-95`) returns false for a null department **and** a null team under `department`
  and `team` scope. The earlier draft concluded from that alone that "a department-scoped producer
  setting a type would get an opaque `42501`". That does not follow, and the correction matters
  because it is this ADR's own design that removes the case: a materialised task carries the
  **deliverable's** `department_id`, which is not null whenever the deliverable has an owner, so a
  department-scoped producer in that department passes `in_write_scope` cleanly. The genuine refusals
  are narrower, and there are four of them:
  - a **team-scoped** user — `in_write_scope` under `team` scope is `p_team is not null and p_team =
app.current_team_id()` (`20260824120000:92`), and a materialised task carries a **null team**,
    because d.1 forbids the template naming one and the deliverable has none of its own. Team scope
    therefore refuses every materialised task, always;
  - a **department-scoped** user whose department is not the one the deliverable's owner belongs to —
    which is any cross-department job, and a TVC whose script, shoot and grade sit in three
    departments is the case this ADR was written for;
  - anyone at all where the deliverable has **no owner**, because
    `app.tg_deliverable_stamp_department` sets `department_id` null when `owner_user_id` is null
    (`20260827220000:37-38`), so the task carries a null department and both department and team
    scope return false;
  - an **Account Manager who does not also hold `project_tasks:manage`**, who would find campaign
    creation itself starting to fail, because the trigger fires inside `create_campaign_from_brief`.

  The conclusion is unchanged — invoker rights would refuse work the caller was authorised to cause —
  but it rests on team scope, cross-department work and ownerless deliverables, not on the
  same-department case, which works.

- **Tenant isolation is asserted explicitly, not inherited.** The function reads the deliverable's
  `tenant_id` from its own row and raises unless it equals `app.current_tenant_id()`. A `security
definer` function that takes a uuid and trusts it is a cross-tenant write waiting to happen; this
  one refuses.

**A materialised task carries the deliverable's `department_id`.** Not the template's — the template
has none and never will (d.1). ADR-0050 d.2 derives the deliverable's department from its named
owner, so a task with nobody on it inherits the department of the person accountable for the
deliverable. This is not a seeded opinion about structure; it is the same human choice, one level
down. It also keeps the task inside somebody's write scope, so it can be retitled, re-dated and
resequenced before anyone is assigned — which a task with a null department could not be.

**Closing a hole this decision opens.** `app.tg_deliverable_transition_guard` restricts a
reviewer-only actor (`reviews:moderate` without `project_tasks:manage`) to changing workflow state
alone, by listing the columns they may not touch (`20260824140000:163-171`). `deliverable_type_id`
is not on that list, so after d.5 a reviewer could set a type and thereby create sixteen tasks. It
is added to the list in the same migration.

**d.6 — Re-running a template adds what is missing and never duplicates; changing a type never
deletes.**

- **Re-run** is `public.materialise_deliverable_workflow(p_deliverable uuid, p_template uuid default
null)` — a `security invoker` wrapper that checks `app.has_permission('project_tasks','manage')`
  **and** `app.in_write_scope(d.department_id, null, app.deliverable_account_manager(d.id))` before
  calling the engine, and raises `42501` with a sentence a person can read if not. **That is the
  named permission: re-running a template requires exactly the authority that already adds a task by
  hand.** A deliverable's owner (ADR-0050 d.1) does not automatically hold it —
  `app.caller_is_project_pm` is `jobs.owner_user_id`, the internal-project PM, and has nothing to do
  with `deliverables.owner_user_id`. That is correct and deliberate under ADR-0040/0041: reach is
  granted, not assumed, and an owner who needs it gets a scope grant (ADR-0036), not a bypass.
- **Re-run semantics: skip, add, never duplicate.** A step that already has a task on this
  deliverable is left exactly as it is — its title, dates, assignee, reviewers and time entries
  untouched. A step with no task gets one, unassigned. Nothing is deleted and nothing is renamed.
- **A type change leaves the existing list alone.** The trigger does not fire when the deliverable
  already has template-derived tasks. The surface instead offers, in words: _"the new type's
  template has 5 steps this list does not — add them?"_ Offered, never forced, and never at the cost
  of a task somebody is already working on. This is the same instinct as d.13 and d.14: the system
  does not quietly rearrange work that a person is standing on.

**d.7 — SUPERSEDED by ADR-0058. A template runs once per deliverable; quantity lives in sub-tasks.**
This decision said six Reels are six deliverables, following ADR-0051 d.11 and its reading of
`media_records unique (deliverable_id, version)`. That reading was wrong: approval was always per
sub-task, and only the *file* was attached to the wrong row. ADR-0058 moves the artefact onto the
sub-task and restores the stated model — the deliverable is a container, and six Reels are six
sub-tasks under one of them. What survives from d.7 is the part that was never about expansion: **a
template runs once per deliverable**, and a print run of 500 business cards is one deliverable, one
artwork, one approval, one template run, with `quantity = 500` carrying the number the printer needs.

**The question an earlier draft dodged, and where it is now answered.** That draft said there was
"no repeat-steps question to answer". That is true only of repetition _within_ one deliverable. The
real question is the other one: does an expanded set of six **share** one template run, or get six?
For a social calendar some steps — Brief, Copy — are arguably properties of the batch rather than the
item, and "expansion makes the question disappear" was not an answer to it. **ADR-0051 d.11 now
decides it explicitly: each expanded deliverable gets its own full template run**, because the
deliverable is the unit of review and sign-off and a step no deliverable owns is a step no gate can
hold on. The batch-step cost — thirty posts at eight steps is 240 tasks, roughly 60 of them repeats —
is recorded there, with d.12's editable list as the mitigation and a "once per batch" flag on
`workflow_steps` named as the extension if it is ever needed. It is decided in ADR-0051 rather than
here because it is a question about what a deliverable _is_; this ADR consumes the answer.

**d.8 — No new write path is built.** `public.save_sub_task` already accepts a null assignee, and
every layer above and below it already handles one (the table in Context, re-verified 28 Aug). This
decision records that as verified fact so the next person does not build the path a second time.

**d.9 — The reviewer rule is not changed, because it is already correct.** ADR-0038 requires a
reviewer from the moment a task is **assigned**, and ADR-0043 d.4 implemented it that way:
`app.tg_sub_task_reviewer_required` fires only `if v_assignee is not null`, its comment reading _"An
unassigned task has nobody whose work is waiting on a reviewer."_ `app.tg_subtask_seed_reviewer`
returns early on the same condition. An unassigned template task therefore needs no reviewer and is
refused by nothing. Nothing moves.

**d.10 — An unassigned task does not hold the approval gate. The guard stops blocking, the surface
warns, and the database records what the warning was about.**

This is the decision that makes d.5 shippable, and it has three parts because "it warns" implemented
in one place is either a blocked feature or an invisible one.

**1. The guard stops blocking — the two readiness predicates, and nothing else about readiness.**

The obvious edit is `and st.assignee_id is not null`. It is not enough, and the reason is worth
spelling out because it decides the shape of the predicate. Both **supported** unassign paths refuse
to null an assignee — `public.save_sub_task` writes `assignee_id = coalesce(p_assignee, assignee_id)`
(`20260827100000:1041`) and `public.update_task_assignment` raises `'an assignee is required'`
(`20260827100000:765`) — but a plain `PATCH /sub_tasks {"assignee_id": null}` is permitted by
`sub_tasks_manage_update` and is anticipated by the schema: `app.tg_stamp_subtask_assignment`
explicitly _"clears on unassign"_ (`20260823130000`). So an `in_progress` task with real hours in
`task_time_entries` can be unassigned, and under the naive predicate it would become invisible to
**both** gates — a deliverable signed off with started work outstanding. The predicate has to say
what "a plan" actually means:

```sql
-- in_review:
where st.deliverable_id = new.id
  and st.status in ('todo', 'in_progress')
  and (st.assignee_id is not null
       or st.status <> 'todo'
       or exists (select 1 from task_time_entries te where te.sub_task_id = st.id))
-- approved:
where st.deliverable_id = new.id
  and st.status not in ('done', 'cancelled')
  and (st.assignee_id is not null
       or st.status <> 'todo'
       or exists (select 1 from task_time_entries te where te.sub_task_id = st.id))
```

**A task is a plan only if it is unassigned, still at `todo`, and has never been worked on.** Work
that was never given to anybody is not outstanding work; work somebody started _is_, whoever holds it
now. An **assigned** task at `todo` still holds both gates exactly as today, which is the case those
checks were written for. The `exists` is on `idx_task_time_entries_sub_task (sub_task_id, round)`
(`20260819130000:26`), so it costs an index probe per open task. It is not decoration: `todo` is
reachable _after_ work — `app.sub_task_request_changes` reopens a task to `todo`
(`20260820030000`) — so "unassigned and at `todo`" alone would have let a task with three rounds of
logged time slip both gates.

**`'blocked'` comes out of the `in_review` arm at the same time, because it has been dead since 19
August.** `sub_tasks_status_check` was redefined at `20260819160000:11-13` as
`('todo','in_progress','review','done','cancelled')` — ADR-0030 dropped `blocked` as a sub-task
status and modelled waiting as a dependency instead — but the guard's `in_review` predicate has
carried `st.status in ('todo', 'in_progress', 'blocked')` ever since, most recently at
`20260824140000:202`. No row can hold that value, so the literal has matched nothing for nine days.
(`blocked` remains a legal **`deliverable_state`**, which is why the transition graph in the same
function keeps it; only the sub-task literal is dead.) It is removed here rather than left, because a
predicate nobody can satisfy is exactly the kind of thing the next reader assumes is load-bearing.

**What this still does not cover, said plainly.** `unassigned_at_signoff` (part 3) counts unassigned
sub-tasks at sign-off. It therefore _includes_ a task that was assigned, worked on and then unassigned
— so such a task is never invisible — but it records a **count and nothing else**: it cannot
distinguish "sixteen tasks nobody was ever given" from "one task somebody started and walked away
from". The predicate above stops the second case reaching sign-off at all, which is the important
half; the number is not, and is not offered as, an audit of _why_ each task was unassigned.

**2. The warning lives in the surface, and it can only live there.** A `before update` trigger has
no channel for "are you sure": PostgREST returns the row or an error, and `raise notice` reaches
nothing. Before firing the transition, the deliverable surface counts the unassigned tasks and, if
there are any, shows _"3 tasks were never assigned — continue anyway?"_ with Continue and Cancel.
Confirming proceeds; there is no hard refusal. This is `AGENTS.md` §5's warn-and-allow and `I17.2`'s
_"a warning nobody is shown is not a warning"_, applied to the same shape of problem.

**3. The ADR-0043 lesson gets its answer, in the other direction.** That lesson — quoted in ADR-0048
d.8 — is that a **rule** must not live only in a function, because a plain PostgREST update goes
round it. Here there is no rule to go round: after part 1 the transition is permitted for everyone,
dialog or no dialog. What must not be lost is the **fact**. So the guard stamps a new column on the
`-> approved` transition, following the pattern `revision_round` already establishes — not the same
branch: `revision_round` is incremented in the **`-> in_progress`** branch (`new.state =
'in_progress' and old.state in ('in_review','approved')`, `20260824140000:231-232`) and frozen as
`new.x := old.x` everywhere else, including on a no-op state change (`:176`). It is the **freeze**
that is the model here, not the branch:

```
deliverables.unassigned_at_signoff integer null   -- count of unassigned sub-tasks at sign-off
```

Not client-writable: the guard sets it on the `-> approved` transition and freezes it (`new.x :=
old.x`) on every other update, exactly as it already does for `revision_round` in its own branch. A client that skips
the confirmation still leaves the number on the row, so _"this was signed off with 3 tasks nobody
ever did"_ is a fact anyone can query afterwards rather than a dialog nobody saw. **One column, at
sign-off only** — `in_review` is a step in a conversation and gets recounted every time; sign-off is
the irreversible decision and is the one worth a permanent number.

**d.11 — Unassigned work is a metric in three places, and only the first of them is nearly free.**
The corrected position, since no filter exists anywhere today:

| Level                                          | What exists                                                                                                      | What has to be built                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deliverable — "4 of 11 unassigned"             | `SubTaskRow.assigneeId` is already selected and mapped (`deliverables-api.ts:232`), so the whole list is in hand | a count in the render and a filter toggle on the sub-task table. No query, no permission.                                                                                                                                                                                                                                                                             |
| Campaign — unassigned across every deliverable | nothing                                                                                                          | one aggregate read joining `deliverables` to `sub_tasks` for a campaign, surfaced on `CampaignPage` and on the ADR-0048 d.9 approval surface, where "you are about to approve 47 tasks nobody is on" is the sentence that matters most. Readable by any tenant member: `sub_tasks_tenant_select` is tenant-wide, so there is **no new permission**, only a new query. |
| Tenant-wide — work nobody has picked up        | nothing                                                                                                          | a counted query and a home. Until the production model's Traffic View (§8) exists, it goes on `DashboardPage` beside `CompanyHealth`, behind the grant that already gates that tile, `health:view` (`DashboardPage.tsx:50`).                                                                                                                                          |

The tenant-wide count is the first real piece of the Traffic View: work nobody has picked up,
currently invisible because until now it could barely exist.

**d.12 — The task list is editable — add, remove, retitle, re-date, resequence — both before and
after approval.** Before approval this is what the Account Manager is reviewing. After approval it
is how a job changes, which jobs do.

**d.13 — Removing an _assigned_ task warns rather than deleting silently.** Someone has it in My
Work and may have bookings against it. Deleting it takes the bookings with it —
`bookings.sub_task_id` is `on delete cascade` — and the first they learn of it is an empty day. Same
warn-and-proceed shape as d.10.

**d.14 — Resequencing never reschedules.** `sort_order` is presentation order; `starts_at` and
`due_at` are dates, owned by the task (ADR-0039) and materialised from the assignee's bookings
(ADR-0042). Moving step 4 to step 7 changes a number and nothing else. This is the `I17` lesson
stated as a rule: a system that silently moves work is worse than one that refuses it, because the
person who lost the day never finds out why.

**d.15 — The `deliverable_state` enum does not change, and the transition guard changes in exactly
four places.** The seven values remain the coarse phase that Pipeline, the dashboards, `sla_events`,
the review round-trip and the KPI rollups all read. Stages are tasks underneath it, not states beside
it. The guard's changes are enumerated so nobody has to guess:

1. the two readiness predicates gain the plan clause (d.10.1);
2. the dead `'blocked'` literal comes out of the `in_review` predicate (d.10.1) — an earlier draft
   said "exactly three places" and did not mention this, having assumed the literal was live;
3. the `unassigned_at_signoff` stamp and freeze (d.10.3);
4. `deliverable_type_id` added to the reviewer-only forbidden-column list (d.5).

The transition graph — including its `blocked` **deliverable state**, which is untouched and must not
be confused with the sub-task literal in (2) — the authority checks, the `revision_round` arithmetic
and the `sla_events` emission are all left alone.

**d.16 — `sub_task_dependencies` is not wired up here, and the reason is not that it is dead.**

A previous draft said the table has "zero readers outside `src/types/database.ts`". **That is
wrong.** Verified 28 Aug — it has three server-side readers, a cycle guard and pgTAP coverage:

| Reader                           | Where                                                | What it does                                                                                                  |
| -------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `app.sub_task_has_unmet_prereqs` | `20260819160000:86`                                  | true if a prerequisite is not yet submitted, or the deliverable has an outstanding external input             |
| `app.sub_task_start`             | `20260819160000:102`                                 | calls it and stamps `task_time_entries.started_ahead`                                                         |
| `app.sub_task_submit`            | `20260819170000:45`, re-emitted `20260824150000:106` | inserts a `dependency_ready` notification for every downstream task whose prerequisites are now all satisfied |
| `sub_task_dep_no_cycle`          | `20260819160000:44`                                  | recursive cycle guard, before insert                                                                          |
| pgTAP                            | `supabase/tests/029`, `030`                          | insert, cycle refusal, notification                                                                           |

What is true is narrower and more useful: **no reader exists in `src/` or `supabase/functions/`.**
`dependency_ready` appears in the notification type union, both locale files and `notify-email`, so
the notification is fully plumbed — but nothing in the product can _create_ a dependency row. The
engine is built; the UI to draw an edge is missing.

**The consequence, which is why this matters and is not a footnote.** Wiring up a dependency editor
later does not start from blank. The first dependency a tenant creates immediately changes two
behaviours that are live today: `started_ahead` starts being stamped `true` on time entries that
have always been `false`, and `dependency_ready` notifications start being sent where none have ever
been sent. Any task that turns the UI on has to account for both, and for what the existing rows
mean — not merely add a picker.

The table remains the correct mechanism for the production model's branching case (§5: one approved
master unlocking the 16:9, 1:1 and 9:16 versions, which is what the ADAPTATION template exists to
serve). It stays unused by the product until that work. **Nobody should create a second dependency
table.**

## Consequences

**Easier.**

A production pipeline stops being a second codebase and becomes 154 seeded rows. The sixteen-stage
LONG FORM flow and the six-step creative flow are the same mechanism with different data, which is
what makes the production work in the reference document tractable at all.

An owner opens a new deliverable and finds the job already broken down, in order, waiting for people
— instead of a blank list and eleven task names to remember. The failure mode this removes is the
quiet one: steps that get skipped because nobody wrote them down.

Unassigned work becomes countable for the first time, and — through `unassigned_at_signoff` —
_retrospectively_ countable: "how many jobs did we sign off with work nobody ever did" becomes a
`where` clause instead of an argument.

The wizard needs no change beyond the one ADR-0051 already makes. Because the materialiser hangs off
a trigger on `deliverables`, every existing and future path that creates a typed deliverable gets
its task list, including `create_campaign_from_brief` and a plain PostgREST insert.

**Harder.**

154 seeded step rows across fourteen templates, to write, review and keep in English that reads like
the agency's own words — and then in Arabic, which the seed does not ship. The taxonomy document's
stage names are good; they are not automatically right for every tenant, which is why d.3 makes all
of them editable.

**A deliverable now starts with many open tasks and nobody on any of them.** Without d.11's metric
that is a worse experience than a short list somebody typed, because the noise arrives before the
accountability does. The metric is not decoration — it is what makes d.5 safe.

**And a campaign multiplies that by its deliverables.** ADR-0051 d.11 expands a quantity into rows
and d.5 turns each row into a template's worth of tasks, so a thirty-post social calendar arrives as
thirty deliverables and 240 unassigned tasks for the Account Manager to read before approving.
ADR-0051 d.16 caps the pathological end — without it, one wizard submit could reach 2,475
deliverables and tens of thousands of sub-tasks inside the single transaction
`create_campaign_from_brief` already is — but nothing makes 240 rows small. d.11's campaign-level
count exists so the approval surface says "you are about to approve 240 tasks nobody is on" rather
than making the AM count.

**The approval gate gets weaker, on purpose, and that is a real trade.** Before this ADR, `approved`
meant every task on the deliverable had been approved or cancelled. After it, `approved` means every
task that is not **an unassigned, unstarted, never-worked-on plan** has been approved or cancelled. A
deliverable can now be signed off with sixteen tasks nobody was ever given. d.10's dialog and recorded
count are the entire mitigation, and they are a warning and an audit trail, not a barrier. The
alternative was a lifecycle nothing could exit, so the trade is forced — but it is a genuine loosening
of an ADR-0038 guarantee and it is recorded here as one.

Two honest qualifications on that sentence. **The guarantee was already softer than it read**: the
approved-side predicate has always been _not in (`done`, `cancelled`)_, and `cancelled` is directly
writable through `sub_tasks_manage_update` and `save_sub_task` with no transition check anywhere
(Context). And **the loosening is narrower than "unassigned tasks don't count"**: d.10.1's predicate
deliberately keeps any task that has been started, has time logged against it, or has left `todo`,
whoever holds it now — so unassigning an in-flight task is not a route past the gate.

**`sla_hours` stays null on a materialised task, which is a small loss on purpose.** A task that
carries no hours produces no booking: `subtask-schedule` returns early when `sla_hours` is null, the
same way it does for a null assignee. That is correct for unassigned work — an unassigned task
consumes nobody's capacity — but it means the step default does not become schedulable effort until
somebody is assigned and the hours are confirmed. d.4 explains why writing it earlier would have cost
more than it saved.

**A `security definer` function that writes `sub_tasks`.** d.5 argues why the bypass is bounded and
what refuses without it, but the honest cost is one more function in the small set that can write
past RLS, and one more thing an adversarial pgTAP suite has to prove cannot cross a tenant boundary.

**The department-derivation gap gets more exposure.** `public.update_task_assignment` does not
restamp `department_id`/`team_id` from the new assignee, so a materialised task that carries the
deliverable's department and is then assigned through the schedule path keeps the wrong one. That
gap exists today; d.5 makes it common enough to notice. It is named here, tested for in Testing, and
not fixed in this ADR because it is a change to an assignment RPC whose subject is not workflow
templates.

**Locked in.**

That a stage is a sub-task. Anything wanting per-stage behaviour — approvals, required assets, QC
gates — extends `sub_tasks` or hangs off it, and does not open a parallel table.

That nothing seeded describes an organisation. ADR-0050, ADR-0051 and this ADR now all hold that
line; a future decision wanting a seeded department mapping has to break all three.

That a template runs once per deliverable, because a quantity of reviewable things is already
separate deliverables (d.7).

That an unassigned task is a plan, not outstanding work — everywhere, not only at the gate. And that
"a plan" means unassigned **and** unstarted **and** never worked on; a task somebody started is
outstanding work whoever holds it now.

That a template default never writes tier 1 of `app.effective_sla`. `sub_tasks.sla_hours` stays what
its own comment says it is — a number a person put on one task — so the deliverable-type and
department tiers ADR-0053 adds stay reachable for materialised work.

**Still open, deliberately.**

The dependency UI (d.16), with the behaviour change it will cause spelled out so that whoever takes
it is not surprised. Whether the production model's Traffic View becomes a screen of its own or
stays a tile on the dashboard (d.11 puts the first metric on the dashboard precisely so this can be
decided later on evidence). Whether a template can carry required resources (ADR-0042) or a required
approval level per step — both are plausible extensions of `workflow_steps`, and neither is needed
to ship the list of tasks, so neither is decided here.

**Cost.**

No dependency, no service, no money. One migration: two tables, two nullable columns and one partial
unique index on `sub_tasks`, one nullable column on `deliverables`, one seed function of 14
templates and 154 steps folded into the provisioning wrapper, one `security definer` engine
function, one `security invoker` wrapper, one trigger on `deliverables`, one foreign key discharging
ADR-0051 d.15, and **four** edits inside `app.tg_deliverable_transition_guard` (d.15). One Admin
screen for the template list, which is also where `default_hours` is filled in. One confirmation
dialog and one count on the deliverable surface; one hours prefill on the assignment surface (d.4);
one aggregate query each for the campaign and tenant-wide metrics. Translation of ~170 strings (14 template names
and descriptions, 154 step titles), unpriced and unscheduled, requiring a native Arabic speaker —
the same debt ADR-0051 records, on a smaller scale.

**Testing.**

**pgTAP.** RLS allow and deny on both new tables, including cross-tenant read and write;
`organization:manage` required to write and a plain member can read. The seed is idempotent: running
`app.seed_tenant_workflow_templates` twice produces no duplicates and does not overwrite a renamed
template or an edited step title. `(tenant_id, code)` unique on templates, `(tenant_id, template_id,
sort_order)` unique on steps.

**The deadlock, as a regression test, both directions.** A deliverable with 16 unassigned tasks
reaches `in_review` and then `approved` — this is the test the third draft would have failed. A
deliverable with one _assigned_ task at `todo` is still refused `in_review`, and one with an
assigned task at `review` is still refused `approved`. `unassigned_at_signoff` is stamped with the
right count on `-> approved`, is null before it, and cannot be written by a client on any other
update.

**The plan predicate, adversarially.** A task that is assigned, started (a `task_time_entries` row
exists) and then unassigned by a plain `PATCH /sub_tasks {"assignee_id": null}` **still refuses both
gates** — the test that the naive `assignee_id is not null` predicate would have failed. So does an
unassigned task reopened to `todo` by `app.sub_task_request_changes` after a round of logged time. An
unassigned task at `todo` with no time entry does not hold either gate. A task written straight to
`cancelled` by PATCH holds neither gate, asserted as **current** behaviour with this ADR's reference
on it, so the pre-existing escape is documented rather than rediscovered. And a sub-task can still
not be written to `'blocked'`: `sub_tasks_status_check` refuses it, which is the assertion that keeps
the removed literal from being reinstated by someone who assumes it was load-bearing.

**Materialisation.** Setting `deliverable_type_id` by a **plain PostgREST-shaped update** creates
the tasks — asserted that way and not only through the RPC, per ADR-0048 d.8's rule.
`create_campaign_from_brief` with typed lines produces deliverables that each already carry their
task list. Re-running the materialiser creates nothing the second time. The partial unique index
refuses a duplicate `(deliverable_id, workflow_step_id)` inserted directly. Changing a deliverable's
type does not delete, rename or re-date an existing task. The four cases d.5 says invoker rights
would refuse all succeed under `security definer`, asserted one by one: a **team-scoped** user with
`project_tasks:manage`; a **department-scoped** user setting a type on a deliverable owned in
_another_ department; anyone setting a type on a deliverable with **no owner** (so a null
`department_id`); and an Account Manager without `project_tasks:manage` still creating a campaign.
The engine refuses a deliverable in another tenant — the adversarial test that every `security
definer` function owes.
The `security invoker` wrapper refuses a caller without `project_tasks:manage` in write scope, with
a readable message. A reviewer-only actor cannot set `deliverable_type_id`.

**Unit.** A materialised task with a null assignee renders, is never filtered out of a list, and
needs no reviewer. **A materialised task has `sla_hours` null even when its step carries a
`default_hours`** — the regression test for d.4, written so that a later "helpful" copy into
`sla_hours` fails loudly instead of quietly costing two SLA tiers. `app.effective_sla` on a
materialised task falls through tier 1 and resolves from a profile. The assignment surface prefills
the hours field from `default_hours`, shows where the number came from, and writes whatever the
assigner leaves in the field — including a value they cleared. `sort_order nulls last, created_at`
puts a hand-added task after the template's steps and keeps template steps in order. Resequencing changes `sort_order` and leaves `starts_at`/`due_at` byte-identical. The
unassigned count on the deliverable equals the number of tasks with a null `assigneeId`. A null
`name_ar` falls back to `name_en`.

**UI.** The sign-off confirmation appears when and only when there are unassigned tasks, names the
right number, and proceeds on Continue. Deleting an assigned task warns before it deletes. The
template list edits in both languages and renders correctly in RTL.

**Known gap, tested as a gap:** a task assigned through `public.update_task_assignment` keeps the
department it was materialised with. Asserted as current behaviour with the ADR reference on it, so
that whoever fixes it changes a failing expectation rather than discovering a silent one.

**Tracker.**

A new **I19** section covers the migration, the seed, the materialiser and its trigger, the
transition guard change, the confirmation dialog, the three metrics and the Admin template screen.
`docs/TASKS.md` and `docs/adr/README.md` are edited **on acceptance**, per the ADR process — not
now, while this is `proposed`.

## Addendum — 22 Sep, recording 17 Sep: a deliverable is edited on its campaign, and a type set later materialises its list (`I52.20`, `I52.21`)

**Edward, 17 Sep:** *"no type was set on the deliverables"* — so no task list had ever
materialised on a production campaign, and nothing could set one. Decided and built the same day
(`20260917150000`; pgTAP 128; `coverage/campaign-rings.spec.ts`):

- **A deliverable can be added to, and edited on, an existing campaign or job** — name, type,
  quantity — under one guard (`app.tg_deliverable_edit_guard`): its owner, the account manager,
  the leads in reach. A blank name is refused. The due date stays with *Change promise*
  (ADR-0088 d.7a).
- **Setting a type on an untyped deliverable materialises its task list then** — the production
  fix. **A type CHANGE while tasks are live is refused in words**, since a second list would land on
  the first (d.6).
- An untyped row is marked *no type — no task list* on the page.
- **20 Sep (ADR-0071 addendum d.10a):** renaming a deliverable renames its tasks' titles with it.
