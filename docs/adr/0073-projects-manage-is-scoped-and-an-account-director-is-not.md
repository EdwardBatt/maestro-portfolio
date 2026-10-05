# ADR-0073: `projects:manage` is scoped, and an Account Director is not

- **Status:** accepted (Edward, 5 Sep 2026)
- **Date:** 2026-09-05
- **Open Decision:** —
- **Task(s):** `I40`. Amends [ADR-0048](0048-briefs-are-generated-per-discipline-and-approved-before-work-starts.md)
  d.9 (who approves a campaign); depends on [ADR-0037](0037-one-authorization-primitive-one-call-path.md)
  (`app.in_write_scope`); relates to [ADR-0072](0072-a-department-generates-its-own-brief-after-the-campaign-is-approved.md)
  (which scopes the same grant for brief generation), [ADR-0070](0070-a-department-brief-is-approved-by-the-department.md)
  (the failsafe this reuses), [ADR-0009](0009-teams-in-departments-and-lead-roles.md) (the role set),
  [ADR-0036](0036-per-user-permission-and-scope-grants.md) (the per-user overlay).

## Context

Edward, 5 September 2026: *"scope permissions on projects:manage — with the exception of the Account
Director, the Power Admin and Traffic Manager, everyone else's project manage is restricted to their
department."*

### What `projects:manage` is, and who has it

It governs campaigns, streams and jobs — creating them, reshaping them, and (ADR-0072) generating
the department briefs beneath them. Four roles hold it:

| Role | Scope today | How it is held |
|---|---|---|
| Power Admin | `tenant` | every grant, automatically |
| Scheduler (Traffic Manager) | `tenant` | seeded directly |
| Account Manager | `account` | seeded directly |
| Department Lead | `department` | **inherited** — the seed copies every Scheduler grant to the Lead |

That last row matters and is easy to miss: `20260816110000:90` is a bulk copy, so the Department Lead
holds `projects:manage` as a side effect of holding the Scheduler's booking grants. It has been true
since 16 August. An earlier comment in `20260816090000` says the opposite —
*"department/team-scoped roles don't hold `projects:manage`"* — and is stale; it was read as current
while drafting ADR-0072 and nearly produced a migration to fix a problem that does not exist.

### The actual defect

**The grant is checked, the scope is not.** `app.in_write_scope` (ADR-0037) exists precisely to
answer "this person, over this thing", and already resolves an account manager's accounts, a
department lead's department, a team lead's team within it, and the ADR-0036 per-user overlay.
`generate-brief` does not call it — it asks `hasProjectsManage(authHeader)`, a tenant-wide boolean.
Nor does `app.approve_campaign`, which predates ADR-0070 and does its own uid comparison.

So a Department Lead in Creative can today generate Production's brief on a campaign they have
nothing to do with, and a Power Admin — holding every grant — cannot approve a campaign at all.
Both are the same omission from opposite ends.

### Why a fourth tier is needed, and why it is a role

Scoping alone does not express the agency. Below the account manager, "your department" is the right
reach. At the account manager, "your accounts" already is. But somebody has to be able to act across
**all** accounts without being a Power Admin — a systems role — or the Traffic Manager, whose remit is
scheduling rather than client work. Today that person can only be granted Power Admin, which hands
them user administration, roles and the audit log to solve a campaigns problem.

Edward: *"Account Director is a new role… to differentiate between the account managers and the
account director."* It is already assumed by shipped copy — step 1 of the wizard reads *"Only the
Account Director or assigned Account Manager can approve this campaign"* — with no such role behind
it.

### Options weighed

**Give the Account Director `tenant` scope.** Rejected. `tenant` is the systems tier: it is what makes
Power Admin pass every RLS branch, including administration this role has no business in. Scope is
about reach over *work*, and borrowing the systems tier to widen client reach is how a role acquires
powers nobody decided to give it.

**Widen the Account Manager instead, and have no new role.** Rejected — it removes the distinction
Edward is asking for. An AM restricted to their own accounts is a deliberate boundary, and the
person who oversees all of them is doing a different job.

**A new `account` -scoped role holding an `all_accounts` marker.** Chosen shape: the Account Director
is `account`-scoped like the Account Manager, and `app.in_write_scope`'s account branch passes them
for every account rather than only assigned ones. One role, one branch, no new scope tier.

## Decision

**d.1 — `projects:manage` is scoped by `app.in_write_scope`, everywhere it is checked.** Holding the
grant is necessary and never sufficient. This covers `generate-brief` (ADR-0072 d.2),
`app.approve_campaign` (d.4 below), and any future reader — the rule is the primitive, not a list.

**d.2 — Reach follows the role's existing scope, and no code names a role.** A `department`- or
`team`-scoped holder reaches their own department's work; an `account`-scoped holder reaches their
accounts; a `tenant`-scoped holder reaches everything. Power Admin and Traffic Manager keep the
built-in failsafe because they are `tenant`-scoped, exactly as ADR-0070 established — *"the failsafe
falls out of the scope model rather than being bolted beside it, which is why it cannot drift from
it."* **No function may enumerate roles**; that is what this ADR exists to prevent.

**d.3 — A new `account_director` role.** `account` scope, `/campaigns` as its landing route, holding
the Account Manager's grant set. It differs from the Account Manager in exactly one way: it passes
`app.in_write_scope`'s account branch for **every** account in the tenant, not only those where it
is the named manager. It gains no administrative grant — not users, not roles, not audit. Somebody
who needs those is a Power Admin, and this role exists so that they do not have to be.

**d.4 — Campaign approval joins the same rule, amending ADR-0048 d.9.**
`app.approve_campaign` currently refuses anyone but the campaign's account manager, by direct uid
comparison. It is rewritten to require `projects:manage` **and** `app.in_write_scope` over the
campaign. The assigned account manager still passes, by their own account scope; the Account
Director, Power Admin and Traffic Manager pass by theirs. ADR-0048 d.9 named the account manager as
the sole approver in a world that had no failsafe; ADR-0070 has since settled that gates get one,
and a campaign whose manager has left must not be unapprovable.

**d.5 — A campaign must name an account manager.** Nullable today, with the client's as a fallback
(ADR-0029). That stays, but the wizard makes the field required at step 1 rather than letting a
campaign reach step 5 with nobody named. A campaign with no manager is one whose approval depends
entirely on the failsafe, which d.4 makes possible and this makes unnecessary.

**d.6 — The Account Director holds `briefs:approve`, as a fallback and not as the default.**
Edward, 5 September: *"the account director can approve dept briefs, but intended as a fall back not
a default."* So the role is added to the `briefs:approve` seed ADR-0070 d.3 established — joining
`department_lead`, `team_lead`, `deputy_team_lead`, `account_manager`, `power_admin` and
`scheduler` — and, being `account`-scoped with d.3's all-accounts reach, passes
`app.in_write_scope` for every department's brief.

**"Fallback, not default" is enforced by three things that already exist, and by nothing new.**

1. **The notification does not reach them.** ADR-0070 d.6 sends `brief_awaiting_approval` only to
   the department's own leads, deliberately excluding the agency-wide roles because they *"can
   approve anything and would otherwise receive every brief in the agency."* The Account Director is
   such a role, so it is excluded on the same reasoning and for the same reason — no code change,
   the existing `r.key in (...)` list simply does not name it.
2. **The surface says so.** ADR-0072 d.4 already requires the department tab to present generating
   or approving on somebody's behalf as an absence fallback rather than the primary action. That
   wording covers this role without amendment.
3. **The audit answers the rest**, per d.7 below.

**What is deliberately NOT built: a restriction.** A confirmation step, a reason field, or a rule
that the department must be asked first would each turn the failsafe into a delay — and the whole
point of a failsafe is that it works at the moment somebody is absent. ADR-0070 reached the same
conclusion for Power Admin and Traffic Manager and named the residual risk as *habit, not deadlock*.
That judgement is adopted here rather than re-argued.

**d.7 — The failsafe is audited, not restricted.** Approvals already record who gave them. An
Account Director approving occasionally is the role working; approving most campaigns, or most
department briefs, is the signal that the people whose job it is are not reading them — the same
argument ADR-0070 makes for its own failsafe, and the same answer: this is a question for the audit
trail, not a permission to remove. `campaign_briefs.approved_by` already records it per brief, so
the query that answers "who is actually approving these" needs no new column.

## Consequences

**Easier.** One rule covers every check: hold the grant, be in scope. A Power Admin can approve a
campaign, which they could not; a Department Lead cannot reach another department's briefs, which
they could. The agency gains a client-oversight role without handing out systems administration.

**Harder.** Every current caller of `projects:manage` gains a scope test it did not have, so code
that worked for the wrong reason will start refusing — which is the point, and is why d.1 lists the
call sites rather than leaving them to be found. `app.in_write_scope` also gains an account branch
that reads the role's key for the all-accounts case, the one place a role is consulted, and it is in
the primitive rather than scattered through the functions that call it.

**Locked in.** Reach is a property of a role's scope, not of a list inside a function. Any future
"but X should also be able to…" is answered by scope or by ADR-0036's per-user overlay — which is
audited and revocable, unlike a role change — and never by naming a role in SQL.

**Migrations.** One seeding `account_director` with its grants and scope, including `briefs:approve` (d.6); one extending
`app.in_write_scope`'s account branch; one rewriting `app.approve_campaign` onto d.4 — reproduced
whole per the house pattern, since a bare `create or replace` resets `proconfig` and drops the
ADR-0033 `search_path` pin. `generate-brief` is ADR-0072's. Each needs its pgTAP: the cases that
matter are a Department Lead refused another department, a Power Admin approving a campaign whose
manager is null, and an Account Director reaching an account they do not manage.

**A department can never be without an approver, and campaign approval is therefore never blocked
by one.** ADR-0070 d.7 lists a department with *"no possible approver"* distinctly, which reads like
a deadlock and is not one: it means nobody IN THAT DEPARTMENT yet holds `department_lead`,
`team_lead` or `deputy_team_lead`. Three routes remain open in every such case — the failsafe roles,
which pass `app.in_write_scope` for every department; ADR-0036's per-user overlay, which grants
`briefs:approve` to one named person and is audited and revocable where a role change is not; and
simply assigning the role. So it is a staffing gap to surface, not a state to route around. Blocking
campaign approval on it was considered and rejected: it would stop an entire campaign because one
department is unstaffed, which is the ADR-0070 deadlock rebuilt one layer up.
