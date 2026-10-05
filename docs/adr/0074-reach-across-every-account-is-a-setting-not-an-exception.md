# ADR-0074: Reach across every account is a setting, not an exception

- **Status:** accepted (Edward, 6 Sep 2026)
- **Date:** 2026-09-06
- **Open Decision:** —
- **Task(s):** `I40.16`. Amends [ADR-0073](0073-projects-manage-is-scoped-and-an-account-director-is-not.md)
  d.3 — the decision stands, the mechanism changes. Depends on
  [ADR-0037](0037-one-authorization-primitive-one-call-path.md) (`app.in_write_scope`) and
  [ADR-0041](0041-role-reach-is-chosen-not-defaulted.md) (reach is chosen, and is shown on the Roles
  screen).

## Context

Edward, 6 September 2026: *"the Account Director role is defined incorrectly. The account director
role can manage any project in the system… while account managers can only manage their assigned
projects"*, and then, after the behaviour was confirmed correct: *"The description in the Account
Director's role is incorrect."*

**The behaviour is right and is not in question.** An Account Director reaches every account; an
Account Manager reaches only the campaigns they are named on. That is live and asserted by test
`087`.

**What is wrong is that the system cannot say so.** `roles.scope` has five values, and the widest
one below "the whole organisation" is `account`, which the Roles screen renders as:

> Their own accounts — *This role can act on the clients and campaigns the person is named on.*

The Account Director is filed under that value and shows that sentence, which is the Account
Manager's rule and the exact opposite of what the role does. The two roles are indistinguishable on
the screen whose entire job is to say how far a role reaches.

The reason is ADR-0073 d.3's mechanism: the Account Director is `account`-scoped, and its extra
reach is an exception inside `app.in_write_scope` that reads `roles.key = 'account_director'`. The
role's reach is therefore not a property of the role — it is a name written into a function. ADR-0073
d.2 forbids exactly this in every other function (*"No function may enumerate roles; that is what
this ADR exists to prevent"*) and then makes one exception for itself, which its own Consequences
section flags: *"the one place a role is consulted."*

Two costs follow, and the first is the one Edward is looking at:

1. **The Roles screen lies**, and cannot be made to tell the truth while one reach value means two
   different things depending on which role holds it.
2. **The next agency-wide role needs a code change.** A Group Account Director, or a second
   oversight role of any kind, cannot be created by an administrator — it needs its name added to a
   `case` in SQL and a migration to deploy it.

## Options weighed

**Correct only the wording shown for the Account Director.** Rejected. There is no honest sentence
to write: the label belongs to the reach value, and the value is shared with the Account Manager.
Making the copy role-aware would put a role name in the frontend to paper over a role name in SQL.

**Give the Account Director `tenant` reach.** Rejected again, for ADR-0073's original reason.
`tenant` is the systems tier — it is what makes Power Admin pass every branch — and it would hand
this role user administration, role editing and the audit log to solve a client-reach problem.

**A sixth reach value, `all_accounts`.** Chosen. The thing the Account Director actually has becomes
a thing a role can be set to.

## Decision

**d.1 — `roles.scope` gains a sixth value, `all_accounts`**, sitting between `tenant` and
`department` in the reach ladder: wider than "their own accounts", narrower than "the whole
organisation". On the Roles screen it reads *"Every account — this role can act on the clients and
campaigns of the whole agency. It grants nothing administrative."*

**d.2 — The Account Director is set to it, and the role-name exception is deleted.**
`app.in_write_scope` gains an `all_accounts` branch and loses the
`roles.key = 'account_director'` test inside its `account` branch. **No behaviour changes**: the
branch returns what the exception returned, for the same people. What changes is that the reach is
declared on the role instead of being hidden in the primitive.

**d.3 — No function names a role, with no exception left.** ADR-0073 d.2 now holds everywhere, which
means the rule can be enforced rather than remembered. A future oversight role is created on the
Roles screen by choosing this reach — no migration, no deployment.

**d.4 — `all_accounts` is not an administrative tier, and nothing about it grants anything.** Reach
answers "which rows", never "which actions"; the grant axis is untouched (ADR-0037). A role set to
this reach can do only what its grants allow, over every account instead of some. The assertion in
test `087` that the Account Director holds no administrative grant stands unchanged and is what
stops the two axes being conflated later.

**d.5 — Nothing else reads `account` as a special case, and that was checked rather than assumed.**
`public.create_campaign_from_brief` once stamped an account-scoped creator as the new campaign's
manager (`if app.current_scope() = 'account' then v_am := auth.uid()`), which this change would have
altered for an Account Director. It does not any more: `20260829150000` made the manager an explicit
parameter, and the live catalogue contains no remaining reader of that branch. So this ADR changes
**no behaviour at all** — only where the Account Director's reach is written down.

## Consequences

**Easier.** The Roles screen states each role's reach truthfully, which is the whole point of
ADR-0041. Oversight roles become configuration.

**Harder.** One more value that every reader of `roles.scope` must handle. There are exactly three:
`app.in_write_scope` (the only `case` in SQL — `app.resource_in_write_scope` delegates to it),
`src/features/schedule/lib/write-scope.ts` (the client-side mirror, which must lean ALLOW here as it
does for `tenant`), and the reach ladder in `src/features/admin/lib/role-scope.ts`. The pgTAP suite
asserts the first; the `check` constraint on `roles.scope` makes a missed one fail loudly rather
than silently narrowing somebody.

**Locked in.** Reach is a property of a role, readable on one screen, and never a name in a
function.

**Migrations.** One: widen the `roles_scope_check` constraint, set the Account Director's reach,
reproduce `app.in_write_scope` whole without the exception (a bare `create or replace` resets
`proconfig` and drops the ADR-0033 `search_path` pin), and update `app.seed_account_director` so new
tenants are provisioned with the new reach.
