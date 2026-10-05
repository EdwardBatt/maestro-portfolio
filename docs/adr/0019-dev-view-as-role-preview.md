# ADR-0019: Dev "View as role" preview — a removable, Power-Admin-only client-side role override

- **Status:** accepted (Edward, 2026-08-15 — requested the feature; chose "block writes" + "role/team/department")
- **Date:** 2026-08-15
- **Relates to:** ADR-0008 (grant-driven, client-side view; RLS is the security boundary), ADR-0009/0010/0014 (write scope; JWT carries dept/team), ADR-0018 (scope-parameterized surfaces)
- **Task(s):** DEV.1 (dev tooling, removable)

## Context

During the pilot, iterating on the role-scoped UI meant repeatedly logging in and out as
different accounts. Edward asked for a way for a **Power Admin** to preview the app as any
role/team/department in-place, to accelerate UI/UX work — explicitly **removable later**.

The app is already grant-driven (ADR-0008): nav, route guards, landing route and scope-defaulting
all read from one place — `usePermissions()` — and the frontend grants were never the security
boundary ("absence, not hiding, **plus RLS beneath**"). RLS enforces data on the real JWT. That
architecture makes an in-place preview cheap **and** safe: overriding the client's *view* of a role
cannot grant data access, because the database still answers to the real token.

Two things had to be decided (both by Edward): what happens to **writes** while previewing, and what
you can **switch**.

## Decision

1. **A client-side "view as role" preview, gated to the *real* Power Admin.** A `DevPreviewProvider`
   holds an optional preview (role + team + department). When set, `PermissionsProvider` resolves the
   **effective** identity to the previewed role's grants/scope/`default_route` and the previewed
   team/department — so nav, guards, landing and scope-parameterized surfaces (ADR-0018) all re-render
   as that role would see them. The panel's own visibility keys off the *real* user's role
   (`isRealPowerAdmin`), never the preview, so it never hides itself mid-preview.

2. **It overrides only the client-side view — never data.** No token is minted or swapped; RLS runs on
   the real Power-Admin JWT throughout. A preview therefore **cannot** grant data access — it changes
   what this browser renders, not what the database returns. This is safe precisely because ADR-0008
   already made client grants non-authoritative. A true "become another user" (their data + writes)
   would need server-side token minting and is explicitly **out of scope**.

3. **Writes are blocked while previewing** (Edward's choice). A single guard on the Supabase client's
   `fetch` (`src/lib/preview-guard.ts`) refuses data (`/rest/v1/`) and edge-function (`/functions/v1/`)
   **writes** (POST/PUT/PATCH/DELETE) while a preview is active; reads (GET) and **auth** (token
   refresh, sign-out) always pass. This prevents mutating data under the previewed identity. It is a
   convenience guard, **not** a security control — RLS is.

4. **Switchable dimensions: role + team + department** (Edward's choice), so scope-defaulting is
   previewable (a Team Leader lands on their team; a Department Lead on their department).

5. **Removable by construction.** Isolated to `src/lib/preview-guard.ts`, `src/app/dev-preview.tsx`,
   `src/app/DevPanel.tsx`, plus small wiring in `permissions.tsx` (effective role/dept/team), `AppShell`
   (banner + `<DevPanel/>`), `main.tsx` (provider) and `lib/supabase.ts` (`guardedFetch`). Deleting the
   three files and reverting the wiring removes the feature with no schema or data footprint.

## Consequences

Easier: role-scoped UI/UX can be reviewed in seconds without account-juggling; because it rides the
existing `usePermissions` chokepoint, it needed almost no per-surface change (only `TeamPage` moved to
read scope from `usePermissions`, a good consolidation regardless).

Harder / watch: `PermissionsProvider` now has a preview branch; the write-guard sits on the client
fetch (must keep never blocking `/auth/`); the panel must always gate on the *real* role.

Locked in: the preview is **client-view only**, gated to a real Power Admin, with writes blocked while
active; it is **never** a security boundary (RLS on the real JWT is, unchanged); and it stays isolated
for clean removal. Any move to true server-side impersonation (data + writes) requires a new ADR.
