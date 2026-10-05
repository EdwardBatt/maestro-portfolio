# ADR-0055: a deliverable's owner can be changed

- **Status:** accepted
- **Date:** 2026-08-28
- **Open Decision:** —
- **Depends on:** nothing. Acceptable and implementable on its own.
- **Task(s):** I22

## Context

ADR-0050 made the deliverable's **owner** the organising fact of campaign work: the Account Manager
names a person, the department is stamped from that person, and that owner then breaks the
deliverable into sub-tasks and assigns them.

**There is no supported way to change that owner.** Verified 2026-08-28:

- `deliverables.owner_user_id` is written in exactly **one** place — `create_campaign_from_brief`
  (`20260827230000:46`), reached only from step 3 of the Brief Wizard.
- No RPC updates it. No screen offers it. Nothing in `src/` even _reads_ the column.
- The stamping trigger is already built for it — `app.tg_deliverable_stamp_department` fires
  `before insert or update of owner_user_id` (`20260827220000:50-52`) — so the database has been
  waiting for an update path nobody wrote.

Correcting a wrong pick, or moving work when somebody leaves, is a hand-written SQL statement
against production.

This is not a nice-to-have. **ADR-0052 assumes an owner acts on a deliverable after creation** —
materialising its task list and assigning each task. An owner who cannot be corrected is a single
point of failure on every campaign, fixed at the moment the wizard was submitted.

### It is not currently locked down either

The gap runs both ways, and this is what shapes the decision.

`deliverables_tenant_write` (`20260802102000:101-103`) is:

```sql
for all to authenticated
using (tenant_id = app.current_tenant_id() and app.has_permission('project_tasks', 'manage'))
with check ( … same … )
```

No scope test. No column restriction. **Any holder of `project_tasks:manage` can already
`PATCH /deliverables?id=eq.X {"owner_user_id": …}` anywhere in the tenant**, and the stamping
trigger will obligingly restamp the department for them.

Worse, the transition guard's reviewer-only frozen-column list
(`20260824140000:164-169` — `name`, `stream_id`, `job_id`, `due_at`, `revision_limit`, `tenant_id`)
**omits `owner_user_id` and `department_id`**. So an actor holding only `reviews:moderate` — a
reviewer, deliberately restricted to workflow state — can reassign a deliverable today.

So this ADR is not adding a capability to a locked door. It is putting a lock on a door that is
already open, and the fact that nobody has walked through it is luck.

### Who may do it — and why that is not a list of role names

Edward's answer, 28 Aug: _"Traffic Manager, Power Admin, Account Manager"_.

An earlier draft of this ADR claimed Traffic Manager did not exist. **That was wrong**, from reading
the original RBAC migration instead of the latest seed. All three exist
(`20260825130000:38-50`, the current definition of `app.seed_tenant_roles`):

| Named               | Key               | Seeded scope                                                                                 |
| ------------------- | ----------------- | -------------------------------------------------------------------------------------------- |
| Power Admin         | `power_admin`     | `tenant`, `is_system` — _"holds every grant, automatically including future ones"_           |
| **Traffic Manager** | **`scheduler`**   | **`tenant`** — _"plans and coordinates bookings and projects across the whole organization"_ |
| Account Manager     | `account_manager` | `account`                                                                                    |

The display name was changed from "Scheduler" to "Traffic Manager" after the original seed, which is
how the earlier draft missed it.

The decision is still expressed as a **permission** rather than as those three names, for a
different reason than the draft gave: `roles` is a **tenant-scoped table** with an editable `name`
and an immutable `key` (`20260802100000:74-86`). An agency that calls this job something else, or
splits it across two roles, must be able to say so. A policy naming `scheduler` would be right for
this tenant and arbitrary for the next. So the three names become the **seeded defaults** — Edward's
answer, preserved exactly — rather than a rule in the code.

Note too that "Account Manager" names two different things: the **role** `account_manager`, and the
**relationship** `campaigns.account_manager_id` — the AM of _this particular_ campaign, resolvable
through `app.deliverable_account_manager()` (`20260812120100:53-62`).

## Options weighed

**Leave it as it is.** Rejected on the Context above: the capability already exists, ungoverned and
unlogged, for a wider set of people than anyone intended.

**Let the current owner hand it on.** Recommended in conversation on 28 Aug and overruled by Edward,
correctly. Ownership is assigned _to_ someone by someone accountable for the campaign; a person
quietly passing it along is how work ends up owned by whoever was least able to refuse. Rejected —
d.4.

**Reuse `project_tasks:manage`.** Cheaper: no catalog row, no seed change. Rejected because that
permission is already the thing that lets too many people do this, and because reassignment is
exactly the narrow authority a traffic desk should hold without wider project rights.

**Name the three roles in the policy.** What was literally asked for. Rejected because `roles` is
tenant data: the policy would be right here and wrong in the next tenant. The names survive as
seeded grants instead, which is the same outcome for this agency and a working one for everybody
else.

**Enforce it only in an RPC.** What the first draft of this ADR did — and it was wrong, by the very
rule it quoted. An RPC is a front door; `deliverables_tenant_write` leaves the window open. The
ADR-0043 lesson recorded in ADR-0048 d.8 is that a rule living in a function gets walked around, and
a `security invoker` RPC guarding a table anyone can `PATCH` is decoration. Hence d.6.

**Allow reassignment to anyone in the tenant with no scope test.** Rejected: it would let a
narrow-reach user push work into a department they have no authority over, which is what
`in_write_scope` exists to stop, and it would sidestep ADR-0040's rule that assigning work requires
the authority to schedule it.

## Decision

1. **A new permission, `deliverables:reassign`**, in `permission_catalog`. Changing who is
   accountable is a distinct and consequential act, and it should be grantable on its own.

2. **Seeded to `power_admin`, `scheduler` (Traffic Manager) and `account_manager`** — Edward's three,
   by key. Any other role gets it only if the tenant grants it. A tenant that renames or replaces
   these roles keeps working, because the policy tests the permission and never the key.

3. **Two paths may reassign, and only these two:**

   a. A holder of `deliverables:reassign` **whose write scope reaches the incoming owner's
   department and team** — the same test `save_sub_task` applies to an assignee
   (`app.in_write_scope(v_dept, v_team, null)`). Reassignment pushes work into somebody's
   department; the actor must have authority there. Note this is free for Traffic Manager and
   Power Admin, both seeded at `tenant` scope.

   b. **The account manager of this deliverable's campaign** — `app.deliverable_account_manager(id)
   = auth.uid()` — regardless of scope, because it is their campaign. It mirrors the reach
   `app.is_job_pm` already grants a PM over their own project (`20260819100000:166`).

   **d.3b is an addition, not something Edward asked for.** It was added because an account manager
   at `account` scope would otherwise be unable to fix ownership on their own campaign whenever the
   incoming owner sits outside their scope — which is most of the time. Flagged here so it is
   accepted deliberately rather than absorbed.

4. **The current owner may NOT reassign their own deliverable** unless they independently hold one
   of the two paths above.

5. **One RPC, `public.reassign_deliverable(p_deliverable uuid, p_owner uuid)`**, `security invoker`
   — the supported path, which validates the incoming owner is in the tenant, applies d.3, writes
   `owner_user_id`, and leaves `department_id` to the existing stamping trigger.

6. **A `before update of owner_user_id` trigger carries the same authority test, and it is what
   actually enforces this.** The RPC is the ergonomics; the trigger is the rule. It hangs on the
   column the stamping trigger already hooks, so this is one more function on an existing hook, and
   it makes a bare `PATCH` fail with the same message the RPC would give.

7. **`owner_user_id` and `department_id` are added to the transition guard's reviewer-only frozen
   column list** (`20260824140000:164-169`). A `reviews:moderate` actor may change workflow state
   and nothing else — that was already the intent, and these two columns were missed.

8. **Reassignment does not touch sub-tasks.** A deliverable's owner and its tasks' assignees answer
   different questions. Existing assignments, their departments and their bookings are untouched;
   the new owner inherits the work as it stands. Silently reassigning somebody's booked week because
   a deliverable changed hands is the failure mode ADR-0042 and `I17` both exist to prevent.

9. **It is logged and it is visible.** The write goes through the universal audit trigger
   (`20260802103000`), and both the outgoing and incoming owners are notified. A change of
   accountability nobody is told about is one that gets discovered at a deadline.

10. **`owner_user_id` stays nullable.** ADR-0053 d.6 gives ad-hoc deliverables an owner — their
    single assignee — so after that lands the ownerless case narrows to **internal-project
    deliverables with no PM** (`public.create_internal_project`, `20260819230000:70`). It does not
    disappear, and this ADR does not close it. Reassignment must therefore work equally as a
    _first_ assignment on a deliverable that never had an owner.

## Consequences

**Easier.** A wrong pick stops being a production SQL statement, and a leaver stops orphaning every
deliverable they owned. ADR-0052's assumption that an owner acts after creation becomes true rather
than aspirational. The ADR-0053 department label becomes correctable, restamping for free on the
existing trigger.

**Harder.** One more permission to explain on the roles screen. And d.6 means a `PATCH` that
succeeds today will start failing — deliberately, but it is a behaviour change on a live table, so
it needs the pgTAP below before it ships rather than after.

**Locked in.** Ownership is granted by authority, never taken. The org-shaped half of the answer —
who counts as a traffic manager — stays tenant configuration. And the enforcement lives in Postgres,
so there is no surface to route around.

**Not addressed.** Bulk reassignment (a leaver's whole portfolio at once) is a reasonable thing to
want, is not decided here, and needs its own confirmation design — the failure mode is moving fifty
deliverables to the wrong person in one click.

## Cost

Small, and almost all of it is test. One catalog row, one seed edit, one RPC, one trigger, two
column names added to an existing list, and one surface control. No new table, no data migration,
no backfill. The pgTAP below is the bulk of the work and the reason it is not smaller: d.6 and d.7
change who may write an existing column on a live table, and that is exactly the class of change
that should not ship on a reviewer's confidence.

## Testing

- pgTAP: a `deliverables:reassign` holder **within** scope succeeds; the same holder **outside**
  scope is refused; the campaign's account manager succeeds regardless of scope; the current owner
  holding neither path is refused; a user with nothing is refused.
- pgTAP, and this is the one that matters: **a bare `update deliverables set owner_user_id = …` by a
  `project_tasks:manage` holder outside scope is refused by the trigger** — the hole in Context,
  asserted closed rather than assumed closed.
- pgTAP: a `reviews:moderate`-only actor cannot change `owner_user_id` or `department_id` (d.7),
  and can still change workflow state.
- pgTAP: cross-tenant — reassigning a deliverable in another tenant is refused, and reassigning
  **to** a user in another tenant is refused.
- pgTAP: `department_id` is restamped from the incoming owner; a null incoming owner clears it.
- pgTAP: sub-task assignees, departments and bookings are unchanged after reassignment (d.8).
- Unit: the surface offers the action only to those who can perform it, and a refusal surfaces the
  server's reason rather than a blank result.
