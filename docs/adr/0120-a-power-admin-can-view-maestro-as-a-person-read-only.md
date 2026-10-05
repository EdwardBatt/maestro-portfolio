# ADR-0120: A Power Admin can view Maestro as a named person, read-only

- **Status:** accepted (Edward, 27 Sep: "Yes..proceed")
- **Date:** 2026-09-27
- **Open Decision:** none
- **Extends:** the Dev "View as role" preview (DevPanel, `dev-preview.tsx`, `preview-guard.ts`)
- **Task(s):** I59.64

## Context

Edward is showing Maestro to a C-level on Wednesday 30 Sep, and wants to show it through real people's
eyes. The existing **Dev: View as** previews a **role**: it changes the menu, the page guards and the
scope filters on the screen, and it never changes whose data is loaded (`dev-preview.tsx`: *"never data
access: RLS still runs on the real JWT"*). So every "me" page (My Work, Needs you, my tasks, my
notifications) shows the Power Admin's own work, which is none: *"Nothing of yours is open right now."*

Options put to Edward, 27 Sep:

- **A. View as a person, read-only**: the whole app shows exactly what that person sees, on live data.
  Nothing can be changed. Power Admin only. Every use recorded. **Chosen.**
- **B. No build**: show company-wide pages as the Power Admin, and demo the personal pages on the local
  stack with test accounts. Rejected: the personal pages would not be live.
- Not offered: temporary passwords for real accounts. That is acting as someone, not viewing, and on live
  data every click is real.

Edward's answers: Chat needs no special handling (*"chats are not live now, so not an issue"*). The person
is **not** notified; the audit log records every use (A).

How identity works today: the database knows who is asking only from the request's JWT, through
`auth.uid()` and `auth.jwt()` (which read `request.jwt.claims`), and `app.current_identity()` reads the
person's role, department and team from `user_profiles` by `auth.uid()`. The claims that matter are
`sub` and `app_metadata.{tenant_id, app_role_id}`, which come from `auth.users.raw_app_meta_data`.

## Decision

1. **The server decides who you are, per request.** While viewing, the app sends one header,
   `x-maestro-view-as: <person id>`, on every database request. A PostgREST pre-request function,
   `public.view_as_pre_request()` (set with `pgrst.db_pre_request`), runs before each request, and when
   the header is present:
   - refuses (42501) unless the **real** caller, from the original JWT, is an active **Power Admin**;
   - refuses unless the person exists, is active and is in the **same tenant**;
   - makes the transaction **read-only** (`transaction_read_only = on`), so every write in that request
     fails in the database itself, whatever the screen allows;
   - replaces the request's claims with the person's (`sub`, `app_metadata.tenant_id`, `app_role_id`,
     from `auth.users`), so RLS, every function and every "me" query answer exactly as for that person.

   Without the header, nothing changes. It is `security definer` (it reads `auth.users` and the real
   caller's role) with a pinned `search_path`.
2. **Every use is recorded.** Starting a view calls `public.view_as_start(p_user)` (without the header), which
   checks the same rules and writes an `audit_events` row: `action = 'view_as'`, the admin as actor, the person
   as entity. The person is not notified (Edward, A).
3. **The screen follows.** Dev: View as gains a **Person** picker beside the role preview. While viewing,
   the app's own idea of "me" becomes the person (their id, role, department, team), a bar at the top
   says **"Viewing as ‹name›, read-only"** with **Exit**, and the existing write guard stays on. The role
   preview is unchanged.
4. **Limits, stated.** Edge Functions still see the admin's JWT; the write ones are already blocked while
   previewing, and the few reads through them (file links) answer as the admin. Live-update channels
   still run as the admin; they only trigger a refresh, and the refresh loads the person's data. Chat is
   shown as it is, because it is not live yet. Once it is, private messages will be visible while viewing,
   and that should be revisited.

## Consequences

*Easier:* a demo, a support question ("what does Basheer see?") or a bug report can be answered on
live data without anybody's password.

*Harder:* a Power Admin can see any person's queue. That is bounded by: Power Admin only, same tenant,
read-only in the database, and recorded every time.

*Locked in:* one pre-request function on every API request. It is a header check, and when the header is
absent it returns straight away.

*Cost:* one migration (the pre-request function, `view_as_start`, the PostgREST setting), pgTAP, the
DevPanel picker, the bar and the identity swap on the client. No licensing or money dimension.

## Addendum, 27 Sep (found building it)

- **A view survives a reload** in the same browser tab (`sessionStorage`), so a refresh mid-demo does not
  drop back to the admin. Closing the tab or signing out ends it. The database still checks every request.
- **The automatic check-in ping is not sent while viewing.** The database refused it (read-only) as it
  should; without the guard, viewing a person would have marked them present.
- **Any database function may be called while viewing**, not only the role preview's short list of
  read-only ones: the database runs every request read-only then, so a write is refused there. That
  short list is also why the role preview's Needs you and My Work came up empty.
- The test database's stand-in for Supabase's sign-in table gained the two columns the real one has
  (`raw_app_meta_data`, `raw_user_meta_data`), which the view reads.

## Addendum — 1 Oct, the Dev panel is a permission (`dev_view:view`)

**Accepted (Edward, 1 Oct).** Edward: *"the dev view needs to be added to the permissions so it can be assigned to other users"*;
one permission for the whole panel (A) — *"everything in the system is work related and this permission will only be added to
C-Level… and should C-level require maybe extend to Department Leads for their departments."*

1. **One permission, `dev_view:view`,** on the Roles screen and as a per-person grant, opens the whole Dev panel: the role preview
   and viewing as a person. The Power Admin holds it like every grant; the **CEO, COO and CFO** roles are granted it (existing
   tenants and new ones). It replaces "the real caller is a Power Admin" in d.1 and in the panel's own gate.
2. **Whom a holder may view follows their own role's reach** (`app.view_as_reaches`): an organisation-wide role (tenant,
   all accounts) anyone active in the tenant; a department-scoped role the people of their department; a team-scoped role their
   team; any other scope nobody. Never oneself. So granting it to Department Leads later needs no change.
3. **Unchanged:** read-only in the database, the claims swap, one audit row per view (d.1–d.2), the person is not notified.
4. **The panel asks the database** (`public.view_as_options()`), for the real signed-in person — also while they are viewing
   someone — whether they may use it and whom they may view.

`security definer`: `view_as_reaches`, `view_as_target` and `view_as_options` read other people's profiles and grants, which
row-level security does not show the caller; each answers only about the real caller (migration `20261001110000`, pgTAP 209).
