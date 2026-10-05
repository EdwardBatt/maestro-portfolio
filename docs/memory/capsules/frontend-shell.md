---
type: capsule
abstract: Routing, guards, navigation, landing, i18n/RTL, and the dev role preview — everything in `src/app/`.
status: current
origin: ai-derived
verified: 2026-10-01
sources: [src/app/, src/locales/, src/features/deliverables/ReviewPanel.tsx, src/features/chat/ChatPanel.tsx, docs/adr/0008-*, 0018-*, 0019-*, AGENTS.md]
---

# Capsule — Frontend shell

## The shell

- **`router.tsx`** is the whole route table. Every screen sits behind
  `<RequirePermission perms={[...]}>`. Adding a screen means adding it here, behind a grant.
- **`permissions.tsx`** is the RBAC core — one fetch per session, exposing `can()`, `scope`,
  `roleKey`, `defaultRoute`, `departmentId`/`teamId`, `ready`, `failed`.
- **`guards.tsx`** — `RequireAuth` (no session → `/login`), `RequirePermission` (no grant → the
  role's landing route), and `PermissionsUnavailable` (the fetch **failed**, which is not the same as
  holding nothing).
- **`nav-config.ts`** — the nav is grant-driven, and `nav-config.test.ts` asserts per-role visibility.
  §2.3 of the design doc: **absence, not hiding** — a role that lacks a grant does not see a disabled
  control, it does not see the control.
- **`AppShell.tsx`** — chrome, inbox, preview banner, dev panel, and above them `EnvironmentBanner`:
  `env.ts` reads the Supabase HOST, and the bar's ABSENCE means production (ADR-0081). Not dismissible.

## Landing

Each role has `roles.default_route` (the Roles page's landing list); `IndexRedirect` sends `/` there. Since
I66.7 (29 Sep) every role is set to `/my-work`, `/dashboard` where the role holds no My Work, and the portal keeps
`/portal`. `app/landing.ts` sends anyone whose landing is My Work but who cannot open it to the Dashboard — it
reads the person's effective grants, so it never turns a `/dashboard` role back into My Work.

## Fail-closed, and the three states

`can()` is false until grants load. A surface that gates on a permission must distinguish **loading**
(render nothing), **failed** (say so, offer retry), and **refused** (redirect). Collapsing failed into
refused is what made a network error look like a logout in August.

## i18n and RTL — from the first screen, not retrofitted

No hardcoded user-facing strings. Everything through i18next with **EN and AR at parity** —
`src/lib/i18n.test.ts` fails the build otherwise. Plurals are `_one` / `_other`; a wrong suffix
silently renders the key name.

Layouts must work in RTL: logical CSS properties (`inline-size`, `margin-inline-start`), never
`left`/`right`. `dir` flips with the locale. The exception is an annotation sitting on an unmirrored
image — the review panel's pins are positioned physically on purpose, and say so.

Dates and times go through `Intl.DateTimeFormat(i18n.language === 'ar' ? 'ar' : 'en-GB', …)`, built
per component — there is no shared helper. Precedents: `AuditPage`, `FeedbackAdminPage`,
`ReviewPanel` (`useStamp`), `ChatPanel`, `NotificationInbox`. Timezone *maths* is separate and lives
inside the engines (`lib/capacity/working-week.ts`, `lib/bookings/day-span.ts`); there is no
`lib/tz`.

**A timestamp and a deadline are not the same job.** Something that *happened* — created, uploaded,
sent, posted — is stored UTC and displayed local. A **due date** is a chosen day stored as midnight
UTC, and putting one through the same formatter moves it back a day west of UTC. Read
[traps.md](../traps.md) before touching a `slice(0, 10)`: the two look identical in a diff.

Vitest pins no `TZ`, so formatted output differs by machine: a test asserting a date must read the
`datetime` attribute, or re-derive the string with the same formatter. Timestamps hours apart in UTC
can also fall on different *local* days at the extremes — worth `TZ=Pacific/Kiritimati` /
`TZ=Pacific/Midway` before trusting one.

## Dev "view as role" preview (ADR-0019, removable)

Gated to `dev_view:view` (ADR-0120 addendum: C-level, Power Admin); `view_as_options()` lists whom the REAL
person may view, by their role's reach. **A ROLE preview** overrides client-side checks only — data loads as the admin,
and `src/lib/preview-guard.ts` blocks writes and most `rpc()` reads, so personal pages look empty
([traps.md](../traps.md)). **A PERSON view** (ADR-0120) is real and read-only: `view_as_start` checks
and audits; `src/lib/view-as.ts` adds `x-maestro-view-as`; `auth-context.tsx` swaps `session`/`claims` (`realSession`/`realClaims` keep the viewer); the hook `public.view_as_pre_request` decides.

## Provider order

`QueryClientProvider` → `AuthProvider` → `DevPreviewProvider` → `PermissionsProvider` →
`RouterProvider`, in `src/main.tsx`. Permission-dependent hooks need all of them above.

## Constraints

- The frontend is presentation only. No capacity maths, no SLA rules, no authorization decisions.
- Instruction files and this capsule are routers — do not paste component code in here.

## Known problems

No e2e coverage of the dev preview. The bundle is one >500 kB chunk. An RTL visual pass on the
schedule grid has never been done.

## Related

[authorization](authorization.md) · [data-access](data-access.md).
