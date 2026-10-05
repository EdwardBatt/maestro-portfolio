# ADR-0033: Security-advisor hardening — pinned function search_path; DEFINER RPCs locked to signed-in users

- **Status:** accepted
- **Date:** 2026-08-19
- **Relates to:** ADR-0008 (grant-driven RBAC; SECURITY DEFINER helpers), ADR-0029 (`create_internal_project` RPC), ADR-0023 (`deliver_deliverable_version` / `promote_delivered_version_to_final`).
- **Migration:** `20260819250000_security_advisor_hardening.sql` (forward-only, behaviour-preserving).

## Context

Supabase's database linter (Advisors → Security) raised WARN-level findings against the live project. None were data-exposure criticals (every `public` table has RLS enabled + forced + policies — verified). The findings fall into four families; this ADR records how each is handled.

## Decision

**1. `0011 function_search_path_mutable` — pin `search_path` on every function.** A function with no fixed `search_path` resolves unqualified names using the *caller's* path, which for a `SECURITY DEFINER` function is a privilege-escalation vector (an attacker who can create an object in an earlier schema shadows a table/function the definer calls). Every `app`/`public` function now pins **`search_path = public, app, extensions`** (fixed rather than `''` because the bodies use unqualified references; `pg_catalog` is implicitly first; `pg_temp` is deliberately excluded). The migration `ALTER`s all existing functions that lacked one.

  **Standing rule (durability):** every `create or replace function` in `app`/`public` from now on **must include `set search_path = public, app`** (add `extensions` if it calls extension functions). This matters most for functions reproduced on nearly every migration — `app.seed_tenant_roles` / `public.seed_tenant_roles` and the `protect_*` / `grant_new_catalog_to_power_admin` triggers — because a reproduction without the clause silently resets `proconfig` to null and re-raises the warning.

**2. `0028 anon_security_definer_function_executable` — real leak, fixed.** `public.create_internal_project` had been revoked from `anon` only, but `anon` is a member of `PUBLIC` and still inherited `EXECUTE` through the `PUBLIC` grant. It is now revoked from `PUBLIC` (and re-granted to `authenticated`), matching how `deliver_deliverable_version` / `promote_delivered_version_to_final` were already locked. Lesson: revoke DEFINER RPCs from `PUBLIC`, not just `anon`.

**3. `0029 authenticated_security_definer_function_executable` — accepted by design.** The same three DEFINER RPCs remain callable by `authenticated`. That is intentional: they are the caller-run write paths for signed-in users and enforce their own `app.has_permission` checks internally. Switching them to `SECURITY INVOKER` would defeat their purpose; moving them out of `public` would break the `/rest/v1/rpc/...` surface. These three advisories are acknowledged and left as-is.

**4. `0014 extension_in_public` (`btree_gist`) — deferred.** `btree_gist` provides the operator class behind the `bookings` no-overlap **exclusion constraint**. Relocating it to an `extensions` schema is the linter's preference but risks a live integrity constraint for a cosmetic warning. Left in `public`; revisit only during a deliberate maintenance window.

**5. `auth_leaked_password_protection` — enable in the dashboard.** Not SQL: turn on **Authentication → Password security → Leaked password protection** (HaveIBeenPwned check) on each project. Operational step, no migration.

## Consequences

No behaviour change — pinning `search_path` to the schemas the bodies already use, and revoking an inherited `PUBLIC` grant `anon` should never have had, are both invariant-preserving. After apply + linter rerun: `0011` clears, the `create_internal_project` `0028` clears; the three `0029` notes remain (accepted); `0014` remains (deferred). The pgTAP suite is unaffected (DDL-only). The standing rule in Decision §1 is the ongoing maintenance cost.
