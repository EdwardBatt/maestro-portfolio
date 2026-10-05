---
type: capsule
abstract: Who may do what, and to which rows — the most expensive thing on this project to re-derive, and the easiest to get subtly wrong.
status: current
origin: ai-derived
verified: 2026-09-15
sources: [AGENTS.md, docs/adr/0037-*, docs/adr/0036-*, src/app/permissions.tsx, supabase/migrations/20260824120000_privatise_grant_tables.sql, supabase/migrations/20260905210000_who_will_approve_this_department_brief.sql]
---

# Capsule — Authorization

## The one idea

Authorization is **two independent axes**, and both must pass:

| Axis | Question | Primitive |
|---|---|---|
| Permission | may you do this *kind* of thing? | `app.has_permission(resource, action)` |
| Scope | may you do it to *this row*? | `app.in_write_scope(dept, team, account_manager)` |

Holding the grant and being refused is normal — it means the scope axis said no. Check scope first
when a refusal is surprising — and check **which arguments the call passes**, because each scope
branch reads only one of the three and a null makes that branch permanently false (traps.md).

**Asking about somebody else.** Both primitives answer for the *caller*. Listing who else could do a
thing uses `app.user_has_permission(user, resource, action)` — the same rule over a different input —
and mirrors the scope test in the query that needs it. Never a role list in the client: a per-user
grant is invisible to one, so it names people the RPC refuses. Worked example and its anti-drift
assertions: `public.department_brief_approvers`, test `090`.

**One call path (ADR-0037).** Nothing outside the database re-implements either primitive. Edge
Functions call `hasPermission()` (`supabase/functions/_shared/authz.ts`) on the **caller-scoped**
client, never a service-role client — service-role has no `auth.uid()`. No function, RPC or frontend
module decides access by reading `role_grants` / `user_grants` / `user_scope_grants`. Displaying a
permission matrix is the only exception. `npm run check:authz` enforces this in CI, because pgTAP
cannot execute an Edge Function.

## The layers

1. **Role** — `roles.key` + `roles.scope` (`tenant` | `department` | `team` | `account` | `self`).
   Reach is an explicit choice; new roles default to `self` (ADR-0041). Two branches carry
   exceptions: `account` passes an Account Director for every account (ADR-0073 d.3), and `team`
   answers a question asked with **no team named** for that lead's own department (ADR-0070 d.3) —
   naming a team still binds them to it.
2. **Role grants** — `role_grants`, the bundle a role carries.
3. **Per-user overlay (ADR-0036)** — `user_grants` (allow/deny, **deny wins**) and
   `user_scope_grants` (additive department/team targets). OR'd *outside* the role-scope `case`, so a
   scope grant widens reach without changing the role.

Effective permission = `(role ∪ user-allow) − user-deny`. That formula lives in exactly one place:
`public.my_permissions()`.

## Where to look

- `src/app/permissions.tsx` — the frontend's single fetch; exposes `can()`, `scope`, `roleKey`,
  `defaultRoute`, `ready`, `failed`. **Fail-closed:** everything is false until grants load.
- `src/app/guards.tsx` — `RequireAuth`, `RequirePermission`, and the failed-load state.
- `src/features/schedule/lib/write-scope.ts` — the client-side mirror of
  `app.resource_in_write_scope`, with its two deliberate lean-ALLOW asymmetries documented.
- `supabase/migrations/20260824120000_privatise_grant_tables.sql` — the primitives and the
  self-scoped RPCs (`my_permissions`, `my_scope_grants`, `users_holding_permission`).
- `supabase/migrations/*scope*`, `*grant*`, `*rbac*` — the policy history.

## Traps that bite here

See [traps.md](../traps.md): permission ≠ scope · a null argument kills a whole class of approver
(a policy reading the ROW's columns is a call site too — a blank `department_id` refused the owner,
15 Sep) · a policy copied "verbatim" from another table drifts (`campaign_brief_receipts`, ADR-0083
d.13) · fail-closed reads as refused · grant tables private since ADR-0037 · a pgTAP user added after
the seed has no JWT. **Capture is permission-governed, approval is scoped:** campaign, stream and
receipt writes ask `projects:manage` only (`20260903150000`, `20260915120000`); approving asks
scope over the responsible account manager.

## Constraints

- Never re-implement either primitive outside Postgres.
- Never read a grant table to make a decision, and never decide from a role NAME — in Postgres or in
  the client (ADR-0072).
- A UI mirror of scope may lean ALLOW when uncertain — the database still refuses. It must never lean
  DENY on incomplete data, which shows a user a dead control.
- Every new policy needs at least one allow and one deny pgTAP test.

## Related

[frontend-shell](frontend-shell.md) for guards and nav · [database-change](database-change.md) for
policy tests · ADRs 0008, 0009, 0014, 0036, 0037, 0041, 0070, 0072, 0073.
