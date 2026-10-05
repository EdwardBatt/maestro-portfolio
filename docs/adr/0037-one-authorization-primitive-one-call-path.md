# ADR-0037: One authorization primitive, one call path — and the tables behind it are private

- **Status:** accepted
- **Date:** 2026-08-24
- **Open Decision:** — (not an OD; corrects an assertion made in ADR-0036)
- **Task(s):** L6.8, L6.10, L6.11 (new); corrects `L6.2`; amends ADR-0036

## Context

ADR-0036 shipped the per-user permission overlay on an explicit claim, written into migration
`20260823100100`:

> "This is the whole enforcement change. Every RLS policy and Edge Function already funnels through
> `app.has_permission` … so extending these two functions applies the overlay everywhere with NO
> policy rewrites."

The first half is true. The second half was never verified, and is false. Verified by grep over
`supabase/functions/` — **all eight grant-checking Edge Functions hand-roll their own check** against
`role_grants`, keyed on the JWT's `app_role_id`:

| Function | Line | Grant checked |
| --- | --- | --- |
| `subtask-schedule` | 61 | `bookings:create` |
| `booking-transition` | 131 | `bookings:create` / `bookings:update` |
| `deliverable-transition` | 66 | deliverable authority |
| `asset-url` | 79 | `assets:view` / `assets:manage` |
| `review-media` | 78 | `media:manage` |
| `invite-user` | 94 | `users:manage` |
| `update-user` | 58 | `users:manage` |
| `chat` | 56 | (role lookup) |

None consult `app.has_permission`. The overlay is therefore invisible to every one of them, **in both
directions**: a per-user **allow** is ignored (403 where RLS would permit — observed live: a user
granted the whole `bookings` set through the L6.4 editor could not schedule an ad-hoc task while her
matrix read "Effective: Yes" throughout), and a per-user **deny** is ignored (**fails open** — the
more serious half).

**Why structurally, not just by oversight:** `app.has_permission` lives in schema `app`, which
PostgREST does not expose. An Edge Function running as the caller *cannot* call it. Each function
therefore grew its own inline `role_grants` query long before the overlay existed, and nothing would
break when the model changed. L6.7 hit the same wall from another angle and solved its own case in
isolation (`app.user_holds_permission`) — a second copy of the same rule, and evidence that the shape
needs deciding once.

Reviewing the surrounding RBAC design (2026-08-24) surfaced three further weaknesses. Edward's
disposition: **park** the first, **resolve** the second, **fix** the third.

1. **Permanent per-user grants sprawl** — RBAC attaches permissions to roles; a never-expiring
   per-person override is an escape hatch, and after a year "why does this person have this?" is hard
   to answer. Standard mitigations (expiry, access review, effective-permission report) are absent by
   deliberate choice in ADR-0036. **Parked** — revisit if overrides outgrow a reviewable handful.
2. **Identity claims are read from the login token, not the database.** `app.current_role_id()`,
   `current_department_id()` and `current_team_id()` all read `auth.jwt() -> app_metadata`. A role,
   department or team change therefore does not take effect until the token refreshes (default 1h) —
   producing exactly the "I changed it and nothing happened" confusion the overlay was meant to end.
   The overlay itself has no such lag: `user_grants` keys on `auth.uid()` and is read live.
3. **The grant tables are world-readable inside the tenant.** `role_grants`, `user_grants` and
   `user_scope_grants` each carry a bare `tenant_id = app.current_tenant_id()` SELECT policy, so any
   authenticated user can enumerate every role's and every colleague's permissions. Not an escalation
   route; a least-privilege failure on sensitive metadata.

Fixing (3) also supplies the strong form of the call-path rule: if ordinary callers cannot read the
grant tables at all, an Edge Function **cannot** re-implement the check even by accident. Enforcement
by capability beats enforcement by convention.

Two constraints found while scoping, both load-bearing:

- **The primitives must become `SECURITY DEFINER`, or decision 4 locks the tenant out.**
  `app.has_permission` is currently INVOKER by deliberate design: `20260823100100` records that it
  and `app.in_write_scope` "read the overlay tables under the caller's own RLS … [which] have
  grant-FREE tenant-only SELECT policies, so these reads cannot recurse back into a grant check."
  Narrowing those SELECT policies to permission-holders breaks that on both counts. (a) **Lockout:**
  an invoker check reading a table the caller may not read returns zero rows, so every permission
  evaluates false — including the administrator's, because evaluating `roles:view` would require
  reading `role_grants`, which would require `roles:view`. Circular, total, and it would bite on the
  first request after `db push`. (b) **Recursion:** a grant-dependent SELECT policy on `user_grants`
  re-enters `has_permission`, which reads `user_grants`, forever. Both dissolve if the primitives
  read the grant tables as `SECURITY DEFINER` — which is the standard Postgres pattern for exactly
  this reason, and safe here because each returns only a boolean about the caller.
- **Recursion (identity).** `user_profiles_admin_all` calls `app.has_permission`. If `current_role_id()` reads
  `user_profiles` under RLS, evaluating that policy re-enters `has_permission` forever. The live
  lookup must therefore be `SECURITY DEFINER` (bypassing RLS on that one read) with `search_path`
  pinned per ADR-0033 — the same pattern `can_moderate_deliverable` used.
- **Three ordinary-user readers.** Locking the tables breaks, fail-closed, every non-admin session
  unless replacements ship first: `permissions.tsx:74-77` (the caller's own grants, every session),
  `deliverables-api.ts:443-444` (`useReviewers` — the reviewer picker), and `clients-api.ts:142-143`
  (the account-manager list). The admin readers (`roles-api`, `user-grants-api`) legitimately require
  the new permission and are unaffected.

### Checked against the reference implementations (2026-08-24)

Rather than reason only from this codebase, the shape was compared with the published patterns.

- **Supabase's own RBAC guide** stores roles/permissions in tables and calls an `authorize()`
  function from RLS policies. That function is `SECURITY DEFINER`, `stable`, `search_path` pinned —
  and the docs state the reason plainly: definer is what lets it read the permission table **despite
  restrictive policies on that table**. Decisions 0 + 4 are therefore the vendor-canonical
  combination; ADR-0036's invoker primitive over world-readable tables is the deviation from it.
- **`point-source/supabase-tenant-rbac`**, the closest public analogue to this schema (multi-tenant,
  group-scoped, `has_permission(...)` / `has_role(...)` helpers used from RLS), resolves roles by
  **live database lookup rather than JWT claims**, for the stated reason that role changes then take
  effect on the next request instead of waiting for token expiry. That is decision 6, independently
  arrived at. It carries no per-user override layer — this overlay goes beyond it.
- **JWT-as-authorization** is widely treated as a known trap: a token is immutable until expiry, so
  embedded permissions carry revocation latency; the accepted mitigations are short-lived tokens,
  token versioning, or live lookup with caching. Supabase's guide does not address staleness at all.
  Decision 6 deviates from Supabase's default in the safer direction, and pays a lookup per check for
  it (`STABLE`, so cached per statement).
- **NIST RBAC** confirms the parked item is a real, standards-recognised risk rather than a matter of
  taste: per-user exceptions are exactly what role-based control exists to avoid ("administrators
  [specifying] access control lists for each user … make security more costly and prone to error").
  Explicit **deny** is not part of core RBAC either — it belongs to the attribute-based tradition.
  This system is therefore RBAC plus a deliberate exception layer, and that layer is the one place it
  is knowingly off-standard.
- **Externalised authorization** (OpenFGA, SpiceDB, Cedar, Casbin, OPA) was considered and rejected:
  the consistent guidance is that a separate authorization service earns its keep across many
  services, or for relationship-based permissions at scale. For a single application whose logic
  already lives in Postgres, database RLS is the fitting choice. Re-basing would trade a working
  foundation for a distributed one, and buy nothing this system needs.

**Conclusion:** the foundation — grants in tables, one primitive, RLS as the enforcement point, a
tenant column everywhere — is the standard pattern. Three specific drifts from it (invoker
primitives, world-readable grant tables, identity cached in the token) plus one implementation gap
(eight functions re-implementing the check) are what this ADR corrects. Nothing here calls for
re-basing the model.

Sources: Supabase *Custom Claims & RBAC* guide; `github.com/point-source/supabase-tenant-rbac`;
NIST RBAC FAQ and the proposed NIST RBAC standard; Permit.io *How to Use JWTs for Authorization*;
comparative surveys of OpenFGA / SpiceDB / Cerbos / OPA.

## Decision

0. **`app.has_permission` and `app.in_write_scope` become `SECURITY DEFINER`**, `search_path` pinned
   inline (ADR-0033), execute revoked from `PUBLIC`/`anon`. This reverses the invoker choice recorded
   in `20260823100100` and is a **precondition** for decision 4 — without it, privatising the grant
   tables locks out the whole tenant and reintroduces policy recursion (see Context). Each still
   returns a single boolean about the caller and reads nothing else; the definer obligation is that
   they never grow a second responsibility.
1. **`public.has_permission(p_resource text, p_action text) returns boolean`** — `STABLE`, invoker,
   `search_path` pinned inline, body exactly `select app.has_permission(p_resource, p_action)`. It
   need not be definer itself: decision 0 puts the privileged read inside the primitive, and this
   wrapper only crosses the schema boundary. `EXECUTE` revoked from `PUBLIC` and `anon`, granted to
   `authenticated` and `service_role`. It discloses nothing: a boolean about the caller, about
   themselves.
2. **Every Edge Function resolves the permission axis through that wrapper** — all eight call sites
   swap their `role_grants` query for one `rpc('has_permission', …)` on the caller-scoped client.
   Two implementation rules, both fail-closed: **(a)** an RPC error is a **denial**, never a pass —
   otherwise deploying a function before its migration fails open; **(b)** the call goes on the
   caller-scoped client, never the service-role one. `chat:54-59` currently checks grants on a
   service-role client, which has no `auth.uid()` and would evaluate false — it needs restructuring,
   not a one-line swap. Deployment order is migration first, functions second.
3. **Standing rule (binding, added to `AGENTS.md` §2):** nothing outside the database decides
   authorization by reading `role_grants` / `user_grants` / `user_scope_grants`. There is one
   permission primitive (`app.has_permission`) and one scope primitive (`app.in_write_scope`),
   reached from outside via `public` wrappers. Displaying a permission matrix is the sole exception,
   and requires the administrative grant below.
4. **The grant tables become private.** SELECT on `role_grants` narrows to holders of
   **`admin.roles:view`** (the existing gate on the Roles screen — there is no `roles:view` in the
   catalog; the write side is `roles:manage`); SELECT on `user_grants` / `user_scope_grants` narrows
   to holders of `user_grants:view`. Both stay tenant-fenced. Power Admin holds these today; any role or per-user grant may hold them.
   This is decision 3 enforced by capability: an ordinary caller — including an Edge Function running
   as one — **cannot** read the tables, so it cannot re-implement the check.
5. **Two self-scoped RPCs replace the three ordinary-user reads**, shipped in the same migration so
   there is no window where sessions fail closed:
   - `public.my_permissions()` → the caller's own effective grants and scope targets
     (`(role ∪ allow) − deny`, computed in the database, mirroring `app.has_permission` exactly).
     Requires no grant: it is self-scoped. Replaces `permissions.tsx:74-77`, and removes the last
     place the frontend re-implements the union/deny formula.
   - `public.users_holding_permission(p_resource, p_action)` → the users who hold a permission,
     wrapping `app.user_holds_permission` (L6.7). Replaces `useReviewers` and the account-manager
     list. Returns id + display name only. **Allowlisted:** it answers only for the pairs the UI
     needs (`reviews:moderate`, `account_manager:manage`) and raises otherwise. An open
     `(resource, action)` parameter would let any user ask "who holds `users:manage`?" and rebuild a
     target list — undoing the least-privilege fix decision 4 exists to make.
6. **Identity claims are resolved live from the database, not the token.**
   `app.current_role_id()`, `app.current_department_id()` and `app.current_team_id()` read
   `user_profiles` for `auth.uid()`, via a `SECURITY DEFINER` helper with `search_path` pinned (see
   the recursion constraint above), falling back to the JWT claim only when no profile row exists.
   Role, department and team changes then take effect on the next request rather than the next token
   refresh. The JWT claims remain written by `update-user` for compatibility and debugging, but are
   no longer authoritative.
7. **A CI grep** asserts no file under `supabase/functions/` references the grant tables. Redundant
   with decision 4 by design — cheap, and it fails at review time rather than at runtime. Stray
   editor artefacts (`.fuse_hidden*` in `invite-user` / `update-user`) must be cleaned first or they
   will trip it.
8. **Testing.** pgTAP covers: the wrapper (role allow · overlay allow · **deny beats a role grant** ·
   `anon` cannot execute); the narrowed SELECT policies (holder reads, non-holder gets zero rows);
   `my_permissions()` returning exactly the effective set for allow/deny/scope fixtures; and a role
   change being visible to `has_permission` **within the same session** (decision 6). pgTAP cannot
   execute an Edge Function — that boundary is held by decisions 4 and 7, not by the suite, and this
   ADR states so rather than letting a green run imply coverage it cannot provide.

No licensing or cost dimension: no new dependency, no new service.

## Consequences

**Easier.** The per-user overlay finally means what the editor says it means, everywhere. One place
to change when the authorization model next moves. Changing someone's role or department takes effect
immediately — no sign-out, no hour's wait, no "the screen says they have it". Permission metadata
stops being readable by everyone in the tenant. New Edge Functions get the check right because the
wrong way is no longer available to them.

**Harder.** Two more functions on the PostgREST-visible surface, plus two RPCs — justified above, but
it is surface, and each future addition needs the same scrutiny. Every permission check now costs a
`user_profiles` lookup (decision 6) on top of the grant lookup; both are `STABLE`, so Postgres caches
them per statement, but this is not free and should be watched on the schedule grid's larger queries.
`SECURITY DEFINER` on the identity helper is a deliberate exception to the deny-by-default instinct
and carries the usual obligation: it must read one row, return one value, and disclose nothing else.
Decision 5 must ship atomically with decision 4 or every non-admin session breaks.

**Recovery.** If the privatisation misfires, the break-glass path is the SQL editor under the
service role (which bypasses RLS): re-widen the SELECT policies in one statement. Stated here so it
is known in advance rather than discovered under pressure.

**Locked in.** Authorization decisions live in the database. An Edge Function is a caller of the
rule, never an implementer of it — now structurally, not by convention. If a future surface cannot
reach the primitive (a service-role job, an external webhook), that is a signal to move the decision
into the database, not to write a ninth copy of the rule. Identity is answered by the database, so
the token becomes a carrier of identity, not a cache of authority.

**Correction to ADR-0036.** Its claim of blanket coverage stands corrected here: the overlay covered
the policy layer only, from `20260823100100` until L6.8 lands. Accepted ADRs are immutable; this one
records the amendment. Item 1 above (grant sprawl) remains ADR-0036's position — parked, not resolved.
